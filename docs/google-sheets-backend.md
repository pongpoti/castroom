# Saving the shift log to Google Sheets

Design for persisting submitted records, and the reasoning behind each choice.

**Status.** Decision 6 — access control — is built: the LIFF gate, the
allowlist and the enrolment webhook are in the repo. Everything about the
sheet itself (decisions 1–5) is still a proposal, so those decisions can be
argued with before any of it is written.

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

## Decision 6 — access control (built: LINE LIFF)

The app runs as a **LIFF app inside LINE**, and identity comes from the LINE
account holding the phone. This is implemented — see `src/LiffGate.jsx`,
`src/lib/gate.js` and `api/auth.js`.

```mermaid
sequenceDiagram
  participant U as User in LINE
  participant A as App (LiffGate)
  participant S as api/auth.js
  participant L as LINE platform
  U->>A: opens LIFF url
  A->>A: environmentVerdict — in LINE client? phone/tablet?
  A->>L: liff.login() if needed
  L-->>A: ID token (JWT signed by LINE)
  A->>S: POST /api/auth { idToken }
  S->>L: verify id_token + client_id
  L-->>S: { sub: <user id> }
  S->>S: sub in allowlist?
  S-->>A: Set-Cookie castroom_session (HMAC, httpOnly, 12h)
  A->>U: form renders
```

Two gates, and only the second one counts:

- **Environment** (`environmentVerdict`) — refuses anything that is not the
  LINE client on iOS or Android. An external browser is refused even when the
  user is logged into LINE, and LINE's desktop client is refused because it
  reports its OS as `web`. This runs in a browser the user controls, so it is
  a courtesy to honest users, not a barrier to dishonest ones.
- **Allowlist** (`api/auth.js`) — the real control. The browser sends the
  **ID token**, never a user id: a user id posted by a client is a claim
  anyone can make, while an ID token is a JWT that LINE's own verify endpoint
  turns back into a `sub`. Passing `client_id` is what stops a token minted
  for some other LIFF app being replayed here.

The session is an HMAC-signed `httpOnly` cookie, compared timing-safely, with
a 12-hour expiry. `/api/log` should require it when it is built — that is the
last step of phase 3 below.

### Enrolment: LINE OA → Telegram → the list

`api/line-webhook.js`. A new user messages the official account; the webhook
verifies LINE's `x-line-signature` over the **raw** body, pulls
`source.userId`, and sends it to the admin's Telegram. The admin pastes the id
into `config/allowed-line-users.json` and deploys.

Nothing in that path grants access on its own — enrolment stays a deliberate,
reviewed edit, and the webhook only ever *reports* an id. Group events are
ignored: being spoken to in a group someone was added to is not the deliberate
act this is meant to capture. Signature verification matters more than it
looks, because without it a forged POST could drop an attacker's id into the
admin's chat looking exactly like a legitimate request to be added.

`LINE_ALLOWED_USER_IDS` in the environment is merged with the file, for
granting access without a deploy.

### Still to do

Add a per-IP rate limit on `/api/log` when it is built, so a stolen session
cannot become a flooded sheet.

**On the sheet itself:** share it with named hospital accounts and the service
account only. Never "anyone with the link". Keep it in a hospital-controlled
Google Workspace rather than a personal Gmail — `hn` plus `patient_name` is
identifiable health data under Thailand's PDPA, so where it lives, who can
open it, and how long it is kept are decisions with legal weight, not just
operational ones. Worth confirming with whoever owns data governance at the
hospital before the first real patient is written.

## Environment

```
# Sheets (phase 1, not built yet)
GOOGLE_SERVICE_ACCOUNT_EMAIL   cast-log@<project>.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY             -----BEGIN PRIVATE KEY-----\n…   (escaped \n)
SHEETS_SPREADSHEET_ID          from the sheet URL
SHEETS_RANGE                   cast_log!A:J            (optional, default)

# LIFF access control (built)
VITE_LIFF_ID                   build-time; the LIFF app id
LINE_LIFF_CHANNEL_ID           the LIFF channel id, checked as the token audience
SESSION_SECRET                 HMAC key for the session cookie
LINE_ALLOWED_USER_IDS          optional, merged with config/allowed-line-users.json

# Enrolment webhook (built)
LINE_CHANNEL_SECRET            verifies x-line-signature on OA deliveries
TELEGRAM_BOT_TOKEN             admin notification bot
TELEGRAM_CHAT_ID               where enrolment ids are sent
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
| 3 | Cookie check in `api/log.js` + per-IP rate limit. (LIFF gate, allowlist and enrolment webhook are already in.) | Endpoint is no longer open |
| 4 | Dedupe view in the sheet, a pivot per cast type, retention note. | The sheet is usable as a report |

Phases 1 and 2 are the working feature. Phase 3 is small now that the LIFF
gate exists — `/api/log` just has to require the session cookie `api/auth.js`
already issues — but **it is what makes the endpoint safe to expose**, so it
ships with phase 1 rather than after it. Phase 4 is spreadsheet work, no code.

## What this design does not do

- **No read path.** The app never lists past shifts from the sheet. Adding one
  means a second endpoint and a real decision about who may read what.
- **No edit or delete.** A wrong row is corrected in the sheet by hand. Making
  the app able to mutate history is a much larger surface than appending.
- **No photo storage.** The captured footer image stays on the device and is
  not uploaded, unchanged from today. Storing it would put an image containing
  both identifiers into Drive, which is a separate decision with its own
  retention question.
