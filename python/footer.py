"""Footer-box ROI extraction, refined against the HosXP A4 template."""
import cv2
import numpy as np
from pipeline import detect_page, warp_page, A4_W, A4_H

# Template ratios measured on the canonical warp
FOOTER_TOP, FOOTER_BOT = 0.800, 0.990
TEXT_LEFT, TEXT_RIGHT = 0.045, 0.520     # left column holds QN/HN + name + rights


def _long_hlines(gray, min_frac=0.30):
    bw = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                               cv2.THRESH_BINARY_INV, 31, 10)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, int(gray.shape[1] * min_frac)), 1))
    op = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k)
    rows = op.sum(axis=1)
    thr = 0.35 * rows.max() if rows.max() else 1e9
    ys = np.where(rows > thr)[0]
    if len(ys) == 0:
        return []
    out, cur = [], [ys[0]]
    for y in ys[1:]:
        if y - cur[-1] <= 4:
            cur.append(y)
        else:
            out.append(int(np.mean(cur))); cur = [y]
    out.append(int(np.mean(cur)))
    return out


def footer_roi(page_bgr):
    """Return (y0, y1) of the footer box on a canonical-warped page."""
    H = page_bgr.shape[0]
    g = cv2.cvtColor(page_bgr, cv2.COLOR_BGR2GRAY)

    t_guess, b_guess = int(FOOTER_TOP * H), int(FOOTER_BOT * H)
    win = int(0.035 * H)

    # refine top border: search for a long horizontal rule near the guess
    top_band = g[max(0, t_guess - win):t_guess + win, :]
    lines = _long_hlines(top_band)
    y0 = (max(0, t_guess - win) + lines[0]) if lines else t_guess

    bot_band = g[b_guess - win:min(H, b_guess + win), :]
    lines = _long_hlines(bot_band)
    y1 = (b_guess - win + lines[-1]) if lines else b_guess

    if not (0.10 * H < y1 - y0 < 0.30 * H):        # sanity
        y0, y1 = t_guess, b_guess
    return y0, y1


def text_lines(gray, min_gap=4, min_height=8):
    """Segment horizontal text lines by ink projection."""
    bw = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                               cv2.THRESH_BINARY_INV, 25, 12)
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1)))
    proj = (bw > 0).sum(axis=1)
    on = proj > max(3, 0.02 * gray.shape[1])
    spans, s = [], None
    for i, v in enumerate(on):
        if v and s is None:
            s = i
        elif not v and s is not None:
            if i - s >= min_height:
                spans.append((s, i))
            s = None
    if s is not None:
        spans.append((s, len(on)))
    merged = []
    for a, b in spans:
        if merged and a - merged[-1][1] <= min_gap:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return merged


def enhance(crop, upscale=3):
    g = crop if crop.ndim == 2 else cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    g = cv2.createCLAHE(2.0, (8, 8)).apply(g)
    bg = cv2.medianBlur(g, 31)
    g = cv2.divide(g, bg, scale=255)
    return cv2.resize(g, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)


def extract(path, tag):
    img = cv2.imread(path)
    quad = detect_page(img)
    if quad is None:
        print(f"{tag}: page not found"); return
    page, _ = warp_page(img, quad)
    y0, y1 = footer_roi(page)
    box = page[y0:y1, :]
    H, W = box.shape[:2]
    left = box[:, int(TEXT_LEFT * W):int(TEXT_RIGHT * W)]
    lg = cv2.cvtColor(left, cv2.COLOR_BGR2GRAY)
    lines = text_lines(lg)

    cv2.imwrite(f"/home/claude/roi_{tag}_box.png", box)
    cv2.imwrite(f"/home/claude/roi_{tag}_left.png", enhance(left))
    print(f"{tag}: footer y=[{y0},{y1}] h={y1-y0} ({(y1-y0)/page.shape[0]:.3f} of page)"
          f"  left-col text lines={len(lines)} -> {lines}")
    for i, (a, b) in enumerate(lines):
        pad = 3
        seg = left[max(0, a - pad):min(H, b + pad), :]
        cv2.imwrite(f"/home/claude/roi_{tag}_line{i}.png", enhance(seg, 3))


if __name__ == "__main__":
    extract("/mnt/user-data/uploads/S__10018846.jpg", "full")
