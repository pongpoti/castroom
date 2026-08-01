# Patient log — footer capture

Reads **HN** and **ชื่อ-สกุล** from the footer of a HosXP OPD record.

HN is decoded in the browser from the QR and never leaves the device. The
footer band **is** sent to Typhoon OCR to read the name — see *Where the data
goes* below before deploying this anywhere real.

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

## Why the name is not read on device

PP-OCRv5 Thai mobile reads this form well and still loses the marks. From a
real capture's debug output:

| Printed | Read | Confidence |
|---|---|---|
| `วิสุทธิ์` | `วิสุทธิ` plus a stray `ส` | 0.923 |
| `แพทย์ผู้สั่ง` | `แพทย์ผู้สัง` | 0.936 |
| `จิราพัฒนพงศ์` | `จิราพัฒเนพงศ์` | 0.936 |

The model is confident and drops the mark anyway, so this is a capability
limit rather than a threshold to tune. An earlier attempt to tune it — padding,
input height, confidence floor — made things strictly worse and is recorded in
`ocr.js` so it is not repeated.

Stray letters left behind by either model are still cleaned up: a lone letter
is not a word in a Thai name, with `ณ` exempt as a genuine one-letter word.

## Cross-checking the HN

The QR's error correction is the primary guarantee. As a second source, the HN
is also printed in plain digits inside the band, so `parseHn` reads it back
from the same recognition pass and compares. Agreement adds a source;
disagreement is surfaced as a flag rather than silently resolved.

Decoding the footer Code128 pair as a cross-check was tried and removed: it did
not decode on either reference capture, at any scale, deskewed or raw. Shipping
a check that never fires would have been worse than saying so.

## Where the data goes

| | Stays on device | Leaves the device |
|---|---|---|
| HN | decoded from the QR, error-corrected | — |
| Name | — | the footer band image goes to Typhoon OCR |

The band contains the patient's name **and** their HN in printed digits, so a
capture sent for recognition carries both identifiers. That is a deliberate
trade: PP-OCR reads this form confidently and still drops Thai tone marks, and
no amount of tuning recovers a character the model does not emit.

The API key is held by `api/ocr.js`, a serverless function. It is never shipped
to the browser, because anything in the bundle can be read and spent by anyone
who loads the page.

## Setup

```bash
npm install
npm run dev
npm test
```

Set `TYPHOON_API_KEY` in the deployment's environment. Without it `/api/ocr`
answers 503 and the app falls back to the local model, which still reads the
name but drops diacritics. `TYPHOON_MODEL` overrides the model id, which
defaults to `typhoon-ocr`.

### Access

The app only runs as a LIFF app inside LINE, on a phone or tablet — an
external browser and LINE's desktop client are both refused. Who may use it
is the `allowed_line_users` table in Neon, checked by `api/auth.js` against
the ID token LINE signed, never against a user id the browser claims.

To add someone: have them message the LINE official account. A two-line
Telegram message arrives — their LINE user id, then their display name —
with Accept/Reject buttons underneath. Tapping Accept inserts them into the
table immediately, no deploy needed.

```
VITE_LIFF_ID               build-time, the LIFF app id
LINE_LIFF_CHANNEL_ID       checked as the ID token's audience
LINE_CHANNEL_SECRET        verifies x-line-signature on OA deliveries
LINE_CHANNEL_ACCESS_TOKEN  looks up a display name for the enrolment message
SESSION_SECRET             HMAC key for the session cookie
TELEGRAM_BOT_TOKEN         admin notification bot
TELEGRAM_CHAT_ID           where enrolment messages are sent
TELEGRAM_WEBHOOK_SECRET    verifies Accept/Reject callbacks are really from Telegram
DATABASE_URL               Neon — also where the allowlist itself lives
```

Without `VITE_LIFF_ID` the app shows a "not configured" screen rather than the
form — it fails closed, so a misconfigured deploy is never an open one. For
local work, `npm run dev` with `VITE_LIFF_DEV_BYPASS=1` skips the gate;
`vite build` compiles that branch out, so it cannot exist in a deployed bundle.

**[docs/setup.md](docs/setup.md) is the step-by-step guide** — two LINE
channels, a Telegram bot, Neon, the environment variables, and how to get
the first person onto the allowlist.

See `docs/backend.md` for how submitted records are persisted (Neon,
rate limited, no other store) and how the Telegram enrolment flow works.

The local model is no longer fetched on mount — it is tens of megabytes and
most captures never need it. Move recognition into a Web Worker before
production if the fallback path is expected to be common; the remote path does
not block the UI, but local inference does.

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
