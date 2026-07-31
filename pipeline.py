"""
Prototype: locate the footer box on a HosXP OPD form photo.
Stage A: detect page quad
Stage B: warp to canonical A4
Stage C: locate footer box (barcode-stripe anchor + horizontal rules)
Stage D: enhance crop for OCR
"""
import cv2
import numpy as np

A4_W, A4_H = 1240, 1754          # A4 @ ~150dpi


# ---------- Stage A: page quad ----------
def order_quad(pts):
    pts = pts.reshape(4, 2).astype(np.float32)
    s = pts.sum(1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)],
                     pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def detect_page(img, debug=None):
    h, w = img.shape[:2]
    scale = 900.0 / max(h, w)
    small = cv2.resize(img, None, fx=scale, fy=scale)

    # paper = bright + low saturation; background here is coloured fabric
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    sat, val = hsv[:, :, 1], hsv[:, :, 2]
    mask = ((sat < 60) & (val > 110)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:5]

    best = None
    for c in cnts:
        area = cv2.contourArea(c)
        if area < 0.12 * small.shape[0] * small.shape[1]:
            continue
        peri = cv2.arcLength(c, True)
        for eps in (0.02, 0.03, 0.05):
            ap = cv2.approxPolyDP(c, eps * peri, True)
            if len(ap) == 4 and cv2.isContourConvex(ap):
                best = ap
                break
        if best is None:                      # fall back to min-area rect
            best = cv2.boxPoints(cv2.minAreaRect(c)).astype(np.int32).reshape(-1, 1, 2)
        break

    if best is None:
        return None
    return order_quad(best.astype(np.float32) / scale)


def warp_page(img, quad):
    dst = np.array([[0, 0], [A4_W, 0], [A4_W, A4_H], [0, A4_H]], np.float32)
    M = cv2.getPerspectiveTransform(quad, dst)
    return cv2.warpPerspective(img, M, (A4_W, A4_H)), M


# ---------- Stage C: footer box ----------
def barcode_bands(gray):
    """Return candidate barcode-stripe bounding boxes (dense vertical edges)."""
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = cv2.convertScaleAbs(cv2.subtract(np.abs(gx), np.abs(gy)))
    grad = cv2.blur(grad, (9, 9))
    _, th = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (31, 9)))
    th = cv2.erode(th, None, iterations=3)
    th = cv2.dilate(th, None, iterations=6)
    cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if w > 90 and 12 < h < 130 and w / h > 2.2:
            out.append((x, y, w, h))
    return sorted(out, key=lambda b: b[1])


def horizontal_rules(gray, min_frac=0.45):
    """y-positions of long horizontal rules."""
    bw = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                               cv2.THRESH_BINARY_INV, 25, 12)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (int(gray.shape[1] * min_frac), 1))
    lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k)
    ys = np.where(lines.sum(axis=1) > 0)[0]
    if len(ys) == 0:
        return []
    groups, cur = [], [ys[0]]
    for y in ys[1:]:
        if y - cur[-1] <= 3:
            cur.append(y)
        else:
            groups.append(int(np.mean(cur)))
            cur = [y]
    groups.append(int(np.mean(cur)))
    return groups


def find_footer(page_bgr):
    gray = cv2.cvtColor(page_bgr, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape

    lower = gray[int(H * 0.60):, :]
    bands = barcode_bands(lower)
    bands = [(x, y + int(H * 0.60), w, h) for (x, y, w, h) in bands]

    rules = horizontal_rules(gray)
    anchor_y = bands[0][1] if bands else int(H * 0.83)

    top = max([y for y in rules if y < anchor_y - 5], default=anchor_y - 40)
    bot = min([y for y in rules if y > anchor_y + 40], default=H - 5)
    if bot - top < 80:
        bot = min(H - 1, top + int(H * 0.115))

    pad = 6
    return (max(0, top - pad), min(H, bot + pad)), bands, rules


# ---------- Stage D: enhance ----------
def enhance(crop, upscale=2):
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    g = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)
    bg = cv2.medianBlur(g, 31)
    g = cv2.divide(g, bg, scale=255)          # flatten uneven lighting
    g = cv2.resize(g, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
    return g


def run(path, tag):
    img = cv2.imread(path)
    quad = detect_page(img)
    if quad is None:
        print(f"{tag}: page NOT found")
        return None
    page, _ = warp_page(img, quad)
    (y0, y1), bands, rules = find_footer(page)
    crop = page[y0:y1, :]
    cv2.imwrite(f"/home/claude/out_{tag}_page.png", page)
    cv2.imwrite(f"/home/claude/out_{tag}_footer.png", crop)
    cv2.imwrite(f"/home/claude/out_{tag}_footer_enh.png", enhance(crop))
    print(f"{tag}: page OK  footer y=[{y0},{y1}] h={y1-y0}  "
          f"bands={len(bands)} rules={len(rules)}")
    return page


if __name__ == "__main__":
    run("/mnt/user-data/uploads/S__10018846.jpg", "full")
