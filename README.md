# Patient log — footer capture

Reads **HN** and **ชื่อ-สกุล** from the footer of a HosXP OPD record.
Everything runs in the browser; no image or identifier leaves the device.

## How it works

The QR code in the footer carries the whole coordinate frame. Its three finder
patterns give an origin, a scale and a rotation in a single decode, and its
payload — `http://…/drugboard/<HN>` — carries the HN directly.

```
origin = top-left finder pattern
unit   = distance between adjacent finder centres
axes   = top-left → top-right, top-left → bottom-left
HN     = last path segment of the QR URL
```

So the pipeline is:

1. Decode the QR. This yields the HN and the pose together.
2. Straighten and cut the footer band using that pose, measured in `unit`.
3. Recognise the band and pick the name out by its printed label.

**HN is never OCR'd.** It is decoded from a Reed–Solomon protected symbol, so
a successful decode is the strong half of the record. The name is the only
field that has no machine-readable source.

### Why the QR alone

An earlier version built the frame from the footer's QN and HN Code128 pair
and used the QR only for scale. That does not survive a whole-page photograph:
on both reference captures the footer barcode modules measure about **2.5px**,
under the 2–3px a decoder needs, so the pair either failed outright or decoded
through a rotated retry that returned coordinates outside the image.

Anchoring on the QR removes that dependency. It also removes the rotation
sweep: a QR decodes at essentially any orientation, so rotation is *measured*
from the finder patterns rather than searched for over nine candidate angles.

### Why a band, not a line

The name sits roughly 13 units from the QR, so a small angular error in the
pose is amplified across that gap — the two reference captures disagree on the
name line's position by about 0.2 units. Cutting a tight line at a fixed offset
would be fitting to one capture.

Instead the band spans `x ∈ [-15.2, -7.6]`, `y ∈ [-0.7, 1.8]` and is handed to
the detector whole. Recognition finds the text lines; the name is selected by
matching `ชื่อ-สกุล` and taking the value after the colon. Geometry only has to
get the line *into frame*, which is a far weaker requirement.

## Measured behaviour

Against `IMG_3830` and `IMG_3831`, both whole-page captures at native
resolution:

| | IMG_3830 | IMG_3831 |
|---|---|---|
| HN | 1636405 | 1636405 |
| QR decode | 296 ms | 510 ms |
| Rotation recovered | 1.09° | 1.49° |
| Squareness | 0.997 | 0.980 |
| `unit` | 158 px | 253 px |
| Total preprocess | 1.1 s | 3.5 s |

The previous barcode-anchored pipeline took 15 s and 67 s on the same two
captures and placed the name window on neither.

## Cross-checking the HN

The QR's error correction is the primary guarantee. As a second source, the HN
is also printed in plain digits inside the band, so `parseHn` reads it back
from the same recognition pass and compares. Agreement adds a source;
disagreement is surfaced as a flag rather than silently resolved.

Decoding the footer Code128 pair as a cross-check was tried and removed: it did
not decode on either reference capture, at any scale, deskewed or raw. Shipping
a check that never fires would have been worse than saying so.

## Setup

```bash
npm install
npm run dev
```

Models are warmed on mount so the first capture is not the slow one. Move
`readName` into a Web Worker before production — model load and inference will
otherwise block the UI.

## What still needs measuring

The geometry, the HN path and the timings above are verified. **Recognition is
not** — model download is blocked in the build sandbox, so no name has been
recognised end to end. Run a batch in the browser and record:

- Name character error rate
- How often `parseName` falls through to the title-prefix fallback, which
  indicates the label itself was misread
- How often the printed HN disagrees with the QR — this should be near zero,
  and anything else points at a form variant worth looking at

If name CER disappoints, tighten the ROI to the value after the `:` before
reaching for a different model. Recognition quality at this size responds far
more to crop tightness and resolution than to model choice.
