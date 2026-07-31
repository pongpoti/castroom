# Patient log — footer box capture

Reads **HN** and **ชื่อ-สกุล** from the footer box of a HosXP OPD record.
Capture the bordered box only; the full A4 page is not needed. Everything
runs in the browser and no image or identifier leaves the device.

## What the reference capture established

`IMG_3830.jpg` (3024×4032, uncompressed) decodes cleanly where the earlier
1108px samples did not. The failure there was resolution alone: the
narrowest Code128 module measured **1 px** against the 2–3 px a decoder
needs, with contrast perfectly healthy at 25/229. The `S__` prefix on those
files points at LINE, which recompresses on send.

At full resolution the footer yields three symbols, and **HN appears in all
of them**:

| Source | Payload | Carries HN |
|---|---|---|
| Footer Code128 (right of the pair) | 7 digits | direct |
| Footer QR | `http://…/drugboard/<HN>` | as the URL tail |
| Header Code128 | `<HN>%<date>%…` | before the first `%` |

All three agreed on the reference capture. **HN is therefore never OCR'd** —
it is decoded and cross-validated, so the only field text recognition has to
handle is the name.

## Why the design changed

The earlier pipeline detected the page, warped it to a canonical A4 and cut
the footer by template ratio. That is unnecessary once the footer's own
symbols are readable: the QN barcode, HN barcode and QR code between them
supply origin, scale and rotation directly.

Consequences:

- Full-page capture is no longer required — framing the box is enough.
- Page detection, A4 warping and template ratios are all gone.
- **OpenCV.js is gone**, roughly 8 MB off the bundle. The remaining geometry
  is a canvas rotate and a crop.

### The coordinate frame

```
u  = HN barcode height
u  = 0.373  × QR side length              primary scale, rotation-invariant
u  = 0.2218 × QN→HN left-edge span        fallback when the QR is unreadable
origin = HN barcode centre
angle  = QN → QR baseline
name ROI = x ∈ [−7.0u, +7.0u], y ∈ [+1.4u, +3.1u] from origin
```

Scale comes from the QR because its side length does not vary with payload
length, unlike barcode width. The fallback uses barcode **left edges**,
which the template fixes, rather than centres, which shift with digit count.

## Measured behaviour

| Condition | Result |
|---|---|
| Footer box only | OK — 2 independent HN sources |
| Rotation 0–45°, and 90° | OK, via a rotation retry sweep |
| Upside down (180°) | detected and auto-corrected |
| QR unreadable | OK — fallback scale within 0.3% of truth |
| Footer width ≥ 1500 px | OK |
| Footer width ≤ 1361 px | fails cleanly |

Rotation beyond about 12° needs the retry sweep: readers tolerate only mild
skew, so failed passes are retried on rotated copies before giving up.

### One safety rule worth keeping

A single unidentified footer barcode is **never** accepted as the HN. The
footer holds a QN barcode as well, and with only one symbol decoded there is
no way to tell which is which — an early version returned a 4-digit queue
number as an HN under rotation. A lone barcode is now accepted only when it
matches a value another source already confirmed.

The same ordering logic detects an inverted capture: if the *left* barcode
matches the QR's HN, the image is upside down, and it is rotated and reread
rather than rejected.

## Verification stays mandatory

Thai recognition on photographed forms lands roughly in the 85–95% range on
clean crops — enough to save typing, not enough to commit a patient identity
unattended. The name sits directly beneath the pixels it was read from, so
the check is visual rather than remembered. HN, being decoded rather than
recognised, is the reliable half of the record.

## Setup

```bash
npm install @zxing/library ppu-paddle-ocr onnxruntime-web
```

The model is warmed on mount so the first capture is not the slow one. Move
`readName` into a Web Worker before production — model load and inference
will otherwise block the UI.

## What still needs measuring

Model download was blocked in the build sandbox, so **name recognition
accuracy is unverified**. The geometry is validated; the recognition is not.
Run a batch in the browser and record:

- Name character error rate
- Anchor-detection rate across real captures, by operator and lighting
- How often `sources-disagree` fires — it should be near zero, and anything
  else points at a form variant worth looking at

If name CER disappoints, tighten the ROI to the value after the `:` before
reaching for a different model. Recognition quality at this size responds
far more to crop tightness and resolution than to model choice.
