# Saving the shift log to Google Sheets

Design for persisting submitted records. Nothing here is built yet — this is
the shape of the thing and the reasoning behind each choice, so the decisions
can be argued with before any of it is written.

## Where records live today

They don't. `CastForm` keeps submitted entries in a `useState` array and
renders them under the form as "N รายการในรอบนี้". A refresh loses the shift.
`onLog` is a prop the component already calls on every submit and that
`main.jsx` does not pass — that callback is the seam this design plugs into.

## What we are building

```mermaid
flowchart LR
  A["Browser<br/>CastForm"] -->|"POST /api/log<br/>visit JSON"| B["Vercel function<br/>api/log.js"]
  A -.->|"queued while offline"| Q[("localStorage<br/>outbox")]
  Q -.->|"flush + retry"| B
  B -->|"service-account JWT"| C["Google OAuth<br/>token endpoint"]
  C -->|"access token (~55 min)"| B
  B -->|"values.append"| D[("Google Sheet<br/>cast_log")]
```

The browser never talks to Google. A service-account key that reached the
bundle would let anyone who loads the page write to the sheet, which is the
same reason `api/ocr.js` exists for the Typhoon key. One more serverless
function, same pattern.

## Decision 1 — how the function authenticates

| | Service account + Sheets REST | Apps Script web app |
|---|---|---|
| Setup | GCP project, SA key, share sheet with SA email | Script bound to the sheet, deploy as web app |
| Secret storage | Vercel env vars | Shared secret in the URL/body |
| Latency | ~200–400 ms | ~1–3 s, cold starts are worse |
| Access model | Sheet shared with one robot identity | Must be "anyone with the link can execute" |
| Versioning | In this repo, reviewable | Manual, lives in the Apps Script editor |

**Recommended: service account.** It keeps the credential in the same place
as the existing one, keeps the code in the repo where it gets reviewed, and
avoids an endpoint that by construction has to be world-executable. Apps
Script is the faster path to a working prototype if you want to see rows
land today — it is a reasonable Phase 0, not a destination.

### Minting the token without an SDK

`googleapis` and `google-auth-library` are large dependencies for one call.
A service-account token is a self-signed JWT exchanged for an access token,
which is about thirty lines against Node's built-in `crypto`:

1. Build `{alg:"RS256",typ:"JWT"}` and a claim set with `iss` (SA email),
   `scope: "https://www.googleapis.com/auth/spreadsheets"`,
   `aud: "https://oauth2.googleapis.com/token"`, `iat`, `exp` (+1 h).
2. Sign `base64url(header).base64url(claims)` with `crypto.createSign('RSA-SHA256')`.
3. POST to the token endpoint with
   `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>`.
4. Cache the returned token in module scope until ~5 min before `exp`. Warm
   Vercel invocations reuse it, so most requests skip steps 1–3 entirely.

This keeps `api/log.js` dependency-free like `api/ocr.js`.

## Decision 2 — sheet schema

**One row per (visit × cast type)**, not one row per visit:

| Column | Example | Notes |
|---|---|---|
| `logged_at` | `2026-08-01T14:32:05+07:00` | Server clock, Asia/Bangkok offset |
| `visit_id` | `01J2F...` | Client-generated, identical across a visit's rows |
| `shift_date` | `2026-08-01` | The date the operator picked in step 1 |
| `hn` | `1234567` | Text-formatted column, or leading zeros die |
| `patient_name` | `สมชาย ใจดี` | |
| `cast_type` | `shortLeg` | Stable id from `CAST_TYPES` |
| `cast_label` | `Short Leg Slab` | Denormalised so the sheet reads without a lookup |
| `count` | `2` | |
| `source` | `qr` \| `manual` | Whether the patient came from a scan or was typed |
| `app_version` | `2026.08.01-a1b2c3d` | Commit of the build that wrote the row |

A visit with two cast types writes two rows sharing a `visit_id`. Long format
because every question anyone will ask of this sheet is an aggregate over cast
types — "how many short leg slabs last month" is one `SUMIF`, and a pivot on
`cast_type` needs no formula at all. The wide alternative (one row, casts
packed into a cell) makes the common case a string-splitting exercise.
Counting visits stays easy: `COUNTUNIQUE(visit_id)`.

Format the `hn` column as plain text in the sheet before the first write.
Sheets will otherwise coerce a numeric-looking HN and drop a leading zero.

## Decision 3 — the API contract

`POST /api/log`

```json
{
  "visit_id": "01J2FQ8Z...",
  "shift_date": "2026-08-01",
  "hn": "1234567",
  "name": "สมชาย ใจดี",
  "source": "manual",
  "casts": [
    { "id": "shortLeg", "count": 2 },
    { "id": "longLeg",  "count": 1 }
  ]
}
```

Responses: `200 {ok:true, rows:2}` · `400 {error:"invalid-…"}` (do not retry)
· `401` (bad/absent session) · `429` (rate limited, retry with backoff) ·
`503 {error:"not-configured"}` when env vars are missing, mirroring
`api/ocr.js` · `502` when Google itself failed (retry).

**The server re-validates everything.** HN exactly 7 digits, name 3–120 chars,
`shift_date` a real ISO date within a sane window, every `cast.id` a member of
the known set, every `count` an integer 1–20, at most 10 cast entries. The
client's validation is a convenience for the operator; it is not a control.

## Decision 4 — duplicates

`values.append` has no unique key, and the dangerous case is real: the append
succeeds, the response is lost to a dropped connection, the client retries.

The client generates `visit_id` **once per submit** and reuses it across every
retry of that submit. Given that, two options:

- **Accept at-least-once** and dedupe when reading. Analysis reads through a
  view that takes the first row per `(visit_id, cast_type)`. Cheap, no extra
  API call, correct under any concurrency.
- **Read-before-write.** Fetch the `visit_id` column, skip the append if the
  id is already there. One extra call per submit and racy if two devices ever
  submit at once — for a single cast room with one operator at a time, that
  race is theoretical.

**Recommended: at-least-once plus a dedupe view.** It is the option that stays
correct when a second device eventually appears, and duplicate rows are
recoverable where lost rows are not.

## Decision 5 — offline and retry

Ward wifi drops. Losing a submitted patient because of it is the worst
outcome this app has, so the write is queued, not fired and forgotten:

1. On submit, append the visit to an **outbox** in `localStorage` and render
   it immediately with `status: "pending"`.
2. Flush the outbox: POST each entry oldest-first. `200` → mark `saved` and
   drop it. `4xx` → mark `failed` and drop it (retrying will not help); surface
   it to the operator. `5xx`/network → leave it queued.
3. Re-flush on the `online` event, on the next submit, and on a timer with
   exponential backoff (2s, 4s, 8s… capped at ~2 min).
4. Show the pending count in the UI. An operator ending a shift needs to know
   whether anything is still unsent — a silent queue is a lost queue.

`localStorage` rather than IndexedDB: these are small JSON records and the
synchronous API removes a class of write-during-unload bugs. Note the trade —
this stores patient names on the device until the flush succeeds.

## Decision 6 — access control, and the thing to decide first

**The deployment is public today.** `castroom-skh.vercel.app` answers to
anyone, which means anyone who finds the URL can open a patient-data entry
form, and once `/api/log` exists, write into the hospital's sheet. A shared
secret compiled into the bundle does not fix this: whatever the browser can
send, a reader of the bundle can send too. It stops bots, not people.

Proportionate options, cheapest first:

1. **PIN → signed cookie.** A ward PIN is POSTed to `/api/session`, verified
   server-side against an env var, and exchanged for an HMAC-signed
   `httpOnly` cookie with a shift-length expiry. `/api/log` rejects requests
   without a valid cookie. One shared secret to rotate, no accounts, works on
   a shared ward tablet. **Recommended.**
2. **Vercel Password Protection** — a deployment setting, no code, but needs a
   Pro plan and gates the whole site including the camera step.
3. **Cloudflare Access / an identity proxy** — per-person accounts and an
   audit trail. Correct for the long run, heavier than this app currently is.

Add a per-IP rate limit on `/api/log` regardless (e.g. 60 writes/minute), so a
leaked PIN cannot become a flooded sheet.

**On the sheet itself:** share it with named hospital accounts and the service
account only. Never "anyone with the link". Keep it in a hospital-controlled
Google Workspace rather than a personal Gmail — `hn` plus `patient_name` is
identifiable health data under Thailand's PDPA, so where it lives, who can
open it, and how long it is kept are decisions with legal weight, not just
operational ones. Worth confirming with whoever owns data governance at the
hospital before the first real patient is written.

## Environment

```
GOOGLE_SERVICE_ACCOUNT_EMAIL   cast-log@<project>.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY             -----BEGIN PRIVATE KEY-----\n…   (escaped \n)
SHEETS_SPREADSHEET_ID          from the sheet URL
SHEETS_RANGE                   cast_log!A:J            (optional, default)
WARD_PIN                       shared PIN for the session gate
SESSION_SECRET                 HMAC key for the session cookie
```

`GOOGLE_PRIVATE_KEY` arrives from Vercel with literal `\n`; the function must
`.replace(/\\n/g, '\n')` before handing it to `crypto`. This is the single
most common reason a first deploy fails with an opaque signature error.

Absent config, `/api/log` answers `503 not-configured` and the client keeps
everything in the outbox — the same shape of degradation `api/ocr.js` already
has, so a misconfigured deploy is inert rather than lossy.

## Implementation plan

| Phase | Work | Ships |
|---|---|---|
| 1 | `api/log.js`: JWT mint, token cache, validation, `values.append`. Unit tests for validation and JWT assembly against a stubbed fetch. | Rows land when called directly |
| 2 | Outbox module + `onLog` wired in `main.jsx`; `pending`/`saved`/`failed` in the entry list. | Submitting writes to the sheet |
| 3 | `api/session.js`, PIN gate, cookie check in `api/log.js`, rate limit. | Endpoint is no longer open |
| 4 | Dedupe view in the sheet, a pivot per cast type, retention note. | The sheet is usable as a report |

Phases 1 and 2 are the working feature; **phase 3 is what makes it safe to put
real patients through**, and should not trail far behind. Phase 4 is
spreadsheet work, no code.

## What this design does not do

- **No read path.** The app never lists past shifts from the sheet. Adding one
  means a second endpoint and a real decision about who may read what.
- **No edit or delete.** A wrong row is corrected in the sheet by hand. Making
  the app able to mutate history is a much larger surface than appending.
- **No photo storage.** The captured footer image stays on the device and is
  not uploaded, unchanged from today. Storing it would put an image containing
  both identifiers into Drive, which is a separate decision with its own
  retention question.
