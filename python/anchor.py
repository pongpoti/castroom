"""
Barcode-anchored extraction of the name line from a HosXP footer box.

No page detection, no A4 template, no full-page capture required. The three
symbols inside the footer box (QN barcode, HN barcode, QR code) define a
complete coordinate frame: origin, scale and rotation.

Measured constants (from IMG_3830.jpg, 3024x4032):
    u  = HN barcode height = 75 px
    u  = 0.373 x QR side length          <- rotation-invariant scale
    name ROI, in units of u, relative to HN barcode centre:
        x in [-7.0, +7.0],  y in [+1.4, +3.1]
"""
import re
import cv2
import numpy as np
from pyzbar import pyzbar

U_PER_QR = 0.373          # HN barcode height / QR side
U_PER_BARCODE_SPAN = 0.2218  # HN barcode height / QN-to-HN left-edge span
NAME_X = (-7.0, 7.0)      # in u, relative to HN barcode centre
NAME_Y = (1.4, 3.1)
MIN_QR_PX = 60            # below this the capture is too small to trust


def _centre(rect):
    return np.array([rect.left + rect.width / 2.0,
                     rect.top + rect.height / 2.0])


RETRY_ANGLES = (0, -12, 12, -25, 25, -40, 40, 90, -90, 180)


def read_symbols_robust(img):
    """
    Decode with a rotation sweep. Symbol readers tolerate only mild skew,
    so a failed first pass is retried on rotated copies before giving up.
    Returns (symbols, applied_angle).
    """
    for angle in RETRY_ANGLES:
        probe = img if angle == 0 else _rotate(img, angle)
        sym = read_symbols(probe)
        if sym['qr'] and len(sym['footer']) >= 2:
            return sym, angle, probe
    return read_symbols(img), 0, img


def _rotate(img, deg):
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), deg, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    M[0, 2] += nw / 2.0 - w / 2.0
    M[1, 2] += nh / 2.0 - h / 2.0
    return cv2.warpAffine(img, M, (nw, nh), flags=cv2.INTER_CUBIC,
                          borderValue=(255, 255, 255))


def read_symbols(img):
    """Decode every symbol and sort them into the roles the footer defines."""
    found = pyzbar.decode(img)
    qr = next((s for s in found if s.type == 'QRCODE'), None)
    codes = sorted([s for s in found if s.type == 'CODE128'],
                   key=lambda s: s.rect.left)
    # the header barcode carries a long delimited payload; the footer pair
    # carries bare digits
    footer = [s for s in codes if s.data.decode().isdigit()]
    header = next((s for s in codes if not s.data.decode().isdigit()), None)
    return {'qr': qr, 'footer': footer, 'header': header}


def resolve_hn(sym):
    """
    HN with cross-validation across every source that carries it.

    A single unidentified footer Code128 is never accepted on its own: the
    footer holds a QN barcode as well, and with only one symbol decoded
    there is no way to tell which of the two it is. Returning a queue
    number as an HN would attach a record to the wrong patient, so an
    uncorroborated lone barcode is treated as a failure.
    """
    sources = {}

    if sym['qr']:
        tail = sym['qr'].data.decode().rstrip('/').split('/')[-1]
        if tail.isdigit():
            sources['qr'] = tail
    if sym['header']:
        head = sym['header'].data.decode().split('%')[0]
        if head.isdigit():
            sources['header_barcode'] = head

    if len(sym['footer']) >= 2:
        # both present, so left-to-right ordering identifies them: QN then HN
        rightmost = sym['footer'][-1].data.decode()
        leftmost = sym['footer'][0].data.decode()
        if sources and rightmost not in set(sources.values()) \
                and leftmost in set(sources.values()):
            # ordering is reversed: the capture is upside down
            return None, list(sources) + ['footer_barcode'], 'image-upside-down'
        sources['footer_barcode'] = rightmost
    elif len(sym['footer']) == 1 and sources:
        # one symbol only — accept it just if it matches a known-good source
        lone = sym['footer'][0].data.decode()
        if lone in set(sources.values()):
            sources['footer_barcode'] = lone

    if not sources:
        return None, [], 'no barcode carried an identifiable HN'

    values = set(sources.values())
    if len(values) > 1:
        return None, list(sources), f'sources disagree: {sorted(sources)}'
    return values.pop(), list(sources), None


def _left_edge_mid(sym_obj):
    """Midpoint of a symbol's left edge — template-fixed, unlike its centre,
    which shifts with the number of encoded digits."""
    p = np.array([[pt.x, pt.y] for pt in sym_obj.polygon], dtype=float)
    return p[np.argsort(p[:, 0])][:2].mean(axis=0)


def frame_from_symbols(sym):
    """
    Return (origin, u, angle_deg) or None.

    Scale comes from the QR side length, which is rotation-invariant and
    does not vary with payload length. When the QR is unreadable, the span
    between the two footer barcodes' left edges serves as a fallback — those
    left edges are fixed by the template even though barcode widths are not.
    """
    if len(sym['footer']) < 2:
        return None

    u = None
    if sym['qr']:
        qr = sym['qr'].rect
        qr_side = (qr.width + qr.height) / 2.0
        if qr_side >= MIN_QR_PX:
            u = U_PER_QR * qr_side
    if u is None:
        span = np.linalg.norm(_left_edge_mid(sym['footer'][-1])
                              - _left_edge_mid(sym['footer'][0]))
        if span < 120:
            return None
        u = U_PER_BARCODE_SPAN * span

    origin = _centre(sym['footer'][-1].rect)

    # rotation from the longest available baseline
    p0 = _centre(sym['footer'][0].rect)
    p1 = _centre(sym['qr'].rect) if sym['qr'] else _centre(sym['footer'][-1].rect)
    angle = np.degrees(np.arctan2(p1[1] - p0[1], p1[0] - p0[0]))
    return origin, u, angle


def crop_name(img, origin, u, angle):
    """Rotate about the origin, then cut the name line in barcode units."""
    M = cv2.getRotationMatrix2D(tuple(origin), angle, 1.0)
    h, w = img.shape[:2]
    rot = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC,
                         borderMode=cv2.BORDER_REPLICATE)
    x0 = int(origin[0] + NAME_X[0] * u)
    x1 = int(origin[0] + NAME_X[1] * u)
    y0 = int(origin[1] + NAME_Y[0] * u)
    y1 = int(origin[1] + NAME_Y[1] * u)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    return rot[y0:y1, x0:x1], (x0, y0, x1, y1)


def enhance(crop, target_h=96):
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    g = cv2.createCLAHE(2.0, (8, 8)).apply(g)
    g = cv2.divide(g, cv2.medianBlur(g, 31), scale=255)
    s = max(1.0, target_h / g.shape[0])
    return cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)


def process(path_or_img, _flipped=False):
    img = cv2.imread(path_or_img) if isinstance(path_or_img, str) else path_or_img
    sym, retry_angle, img = read_symbols_robust(img)
    hn, sources, err = resolve_hn(sym)

    if err == 'image-upside-down' and not _flipped:
        # barcode ordering was reversed, so the capture is inverted
        return process(_rotate(img, 180), _flipped=True)

    frame = frame_from_symbols(sym)

    report = {
        'symbols': {'qr': bool(sym['qr']),
                    'footer_barcodes': len(sym['footer']),
                    'header_barcode': bool(sym['header'])},
        'hn_found': hn is not None,
        'hn_digits': len(hn) if hn else 0,
        'hn_sources': sources,
        'hn_error': err,
    }
    if frame is None:
        report['frame'] = None
        return report, None

    origin, u, angle = frame
    report['frame'] = {'u_px': round(u, 1), 'angle_deg': round(angle, 2)}
    crop, box = crop_name(img, origin, u, angle)
    report['name_roi'] = {'box': box, 'size': crop.shape[:2]}
    return report, enhance(crop)


if __name__ == '__main__':
    rep, roi = process('/mnt/user-data/uploads/IMG_3830.jpg')
    for k, v in rep.items():
        print(f'{k}: {v}')
    if roi is not None:
        cv2.imwrite('/home/claude/name_final.png', roi)
        print('name ROI written, shape', roi.shape)
