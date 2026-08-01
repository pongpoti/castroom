# Persisting the shift log: Neon + a Google Sheets mirror

**Status: built.** Every decision below is implemented, not proposed —
`api/log.js`, `src/lib/db.js`, `src/lib/sheets.js`, `src/lib/validate.js`,
`src/lib/outbox.js`, `api/db/schema.sql`. The reasoning stays here because
disagreeing with a decision is still useful after it ships; it just means
opening a PR against the code instead of the doc.

## Where records live

**Neon (Postgres) is the source of truth.** A submitted visit is not
considered saved until it is a row in Neon's `cast_log` table. A Google
Sheet is written too, as a best-effort mirror for staff who want to open a
spreadsheet rather than a database console — but a visit is never lost
because the sheet append failed, only because the Neon write failed, and
that failure is loud (502, kept in the outbox, retried) rather than quiet.

This replaces an earlier design that used the Sheet as the only store. It
changed because "what database do you use" turned out to have an easy
answer once asked: Vercel's storage marketplace makes Neon a few clicks away
(`vercel.com` → Storage → Neon, or provision directly at neon.tech and paste
the connection string), and a real schema with a `count between 1 and 20`
constraint at the database level beats trusting every future write path to
re-derive the same validation a spreadsheet cannot enforce.

## What is built

```mermaid
flowchart LR
  A["Browser<br/>CastForm"] -->|"POST /api/log<br/>+ session cookie"| B["Vercel function<br/>api/log.js"]
  A -.->|"queued while offline"| Q[("localStorage<br/>outbox")]
  Q -.->|"flush + backoff"| B
  B -->|"insert, one transaction"| N[("Neon<br/>cast_log")]
  B -.->|"best-effort mirror"| C["Google OAuth<br/>token endpoint"]
  C -.->|"access token (~1h)"| B
  B -.->|"values.append"| D[("Google Sheet")]
```

The browser never talks to Neon or Google directly. A database connection
string or a service-account key that reached the bundle would let anyone
who loads the page read or write either store, the same reason `api/ocr.js`
keeps the Typhoon key server-side.

## Decision 1 — Neon over the Sheets-only design

| | Neon (Postgres) | Sheets only (the original design) |
|---|---|---|
| Schema enforcement | Real constraints (`count between 1 and 20`, etc.) | None — a formula or manual edit can put anything in a cell |
| Concurrent writes | Transactional | `values.append` has no isolation guarantee |
| Query | SQL, indexed | Formulas, or export-and-analyze |
| Staff access | Needs a client (or a thin read UI, not built) | Already how staff read a spreadsheet |
| Setup | A connection string | A service account + a shared sheet |

Neither replaces the other's strength, which is why both exist: Neon is
where correctness lives, the Sheet is where a shift-lead who has never
opened a database console can still see the day's rows.

### Minting the Sheets token without an SDK

`googleapis`/`google-auth-library` are large dependencies for one call. A
service-account token is a self-signed JWT exchanged for an OAuth access
token — `src/lib/sheets.js` hand-rolls this against Node's built-in `crypto`,
about seventy lines including the append call. `api/log.js` caches the
minted token in module scope with 5 minutes of headroom before `exp`, so a
warm invocation skips the mint entirely; only a cold start pays for it.

## Decision 2 — schema

**One row per (visit × cast type)**, in both stores — `api/db/schema.sql`
for Neon, the same columns in the Sheet:

| Column | Example | Notes |
|---|---|---|
| `logged_at` | `2026-08-01T14:32:05.000Z` | Server clock |
| `visit_id` | `a1b2c3d4-…` | `crypto.randomUUID()`, identical across a visit's rows |
| `shift_date` | `2026-08-01` | The date the operator picked in step 1 |
| `hn` | `1234567` | Exactly 7 digits, enforced by `validateLogPayload` |
| `patient_name` / `cast_type` / `cast_label` / `count` | | `cast_label` is denormalised so the sheet reads without a lookup |
| `source` | `qr` \| `manual` | Whether the patient came from a scan or was typed |
| `app_version` | `a1b2c3d` | `VERCEL_GIT_COMMIT_SHA`, short form |

A visit with two cast types writes two rows sharing a `visit_id`. Long
format because every question anyone asks of this data is an aggregate over
cast types — `GROUP BY cast_type` in Neon, one `SUMIF` in the Sheet.

Run `api/db/schema.sql` once against the Neon database before the first
deploy that sets `DATABASE_URL`. Format the Sheet's `hn` column as plain
text before the first write, or leading zeros die.

## Decision 3 — the API contract

`POST /api/log`, session cookie required.

```json
{
  "visit_id": "a1b2c3d4-...",
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

Responses: `200 {ok:true, rows:2, sheet:"ok"|"skipped"|"failed"}` ·
`400 {error:"invalid-…"}` (client bug, do not retry — see the full list of
error codes in `src/lib/validate.js`) · `401 {error:"unauthorized"}` (no
valid session cookie) · `502 {error:"db-write-failed"}` (Neon unreachable,
retry) · `503 {error:"not-configured"}` when `DATABASE_URL` or
`SESSION_SECRET` is missing, mirroring `api/ocr.js`.

**The server re-validates everything** in `validateLogPayload` — HN exactly
7 digits, name 3–120 chars, `shift_date` a real date within about two years
back to one day ahead, every `cast.id` a member of `CAST_TYPES`, no repeated
cast id in one visit, every `count` an integer 1–20, at most 10 cast
entries. The client's checks are a convenience for the operator; this is
the control.

**A mirror failure does not change the HTTP status.** `sheet:"failed"` can
appear on an otherwise-`200` response — the row is safely in Neon, but the
client's outbox sees `r.ok` and marks the visit sent. Nothing on the client
side ever retries a sheet mirror on its own; the only record of the failure
is the `console.error` in `api/log.js`'s Vercel logs. Worth knowing before
trusting the Sheet as complete — right now the mirror can lag Neon
silently, and closing that gap means either surfacing `sheet:"failed"` to
the operator or building a small reconciliation job that reads Neon and
backfills whatever the Sheet is missing. Neither exists yet.

## Decision 4 — duplicates

`values.append` and a plain `insert` both lack a natural unique key, and the
dangerous case is real: the write succeeds, the response is lost to a
dropped connection, the client's outbox retries.

The client generates `visit_id` once per submit and reuses it across every
retry — `outbox.enqueue` is called once, before the first send attempt.
Given that, **`cast_log_deduped`** (a view in `api/db/schema.sql`) keeps the
first row per `(visit_id, cast_type)` via `distinct on`, so at-least-once
writes read as exactly-once. The Sheet has no equivalent view; a formula
doing the same `distinct on` over `visit_id` + `cast_type` would need to be
added by hand if duplicate rows there ever become a real problem instead of
a theoretical one (this is a single-operator ward tablet — concurrent
retries from two devices at once is the case this exists for, not the
common one).

## Decision 5 — offline and retry (built: `src/lib/outbox.js`)

Ward wifi drops. Losing a submitted patient because of it is the worst
outcome this app has, so a submit is queued, not fired and forgotten:

1. `submit()` calls `outbox.enqueue(visit)` — a `localStorage` write — before
   it calls the server at all. The visit is safe on the device even if the
   very first send attempt never leaves it.
2. `outbox.flush(sendToServer)` POSTs each pending entry oldest-first,
   stopping at the first network/5xx failure rather than skipping ahead —
   sending visit B before a stalled visit A would reorder the shift log for
   no good reason. A 4xx is marked `failed` and left visible rather than
   retried forever, since the server has already said retrying will not
   help.
3. A `useEffect` in `CastForm` re-flushes on mount (catches anything left
   over from a previous page load), on the browser's `online` event, and on
   a `setTimeout` chain using `outbox.backoffMs()` — 2s, 4s, 8s, capped at 2
   minutes.
4. Each visible log entry carries a `รอส่ง` (pending) or `ส่งไม่สำเร็จ`
   (failed) badge; a sent entry carries none, so the expected outcome does
   not compete for attention with the two that need it. `.cf2-outbox-note`
   above the submit button shows a running "กำลังส่งข้อมูล N รายการ" count so
   an operator ending a shift can see whether anything is still unsent
   before they close the tab.

`localStorage` rather than IndexedDB, as designed: these are small JSON
records and the synchronous API avoids a class of write-during-unload bugs.
The trade stands too — a patient name sits in `localStorage` on the device
until the flush succeeds.

## Decision 6 — access control (built: LINE LIFF)

Unchanged from the original design. The app runs as a **LIFF app inside
LINE**; see `src/LiffGate.jsx`, `src/lib/gate.js`, `api/auth.js`, and
`docs/setup.md` for the full walkthrough.

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

`api/log.js` requires the same cookie: a request with no valid
`castroom_session` gets `401` before validation or a database call ever
runs. That closes the gap the original design flagged as "should require it
when it is built."

### Enrolment: LINE OA → Telegram → the list

Unchanged — see `docs/setup.md`.

## Still to do

- **Per-IP rate limiting on `/api/log`.** Not built. A real implementation
  needs a store that survives across serverless invocations (Upstash Redis,
  a Neon table, Vercel's own rate-limit primitive) — an in-memory counter in
  `api/log.js` would reset on every cold start and give false confidence.
  Flagged rather than faked.
- **Sheet mirror reconciliation.** As above: a failed mirror is logged, not
  retried, and not surfaced to the operator. Fine for a mirror that exists
  for convenience; worth revisiting if staff start treating the Sheet as
  authoritative.
- **No read path in the app.** `CastForm` still only shows what was
  submitted this session, from its own `log` state — nothing reads Neon
  back. Building one is a second endpoint and a real decision about who may
  read what, same as the original design's stance on this.
- **No edit or delete.** A wrong row is corrected by hand, in Neon or the
  Sheet. Making the app able to mutate history is a much larger surface
  than appending.
- **No photo storage.** The captured footer image stays on the device and
  is never uploaded, in either store.

**On the Sheet itself:** share it with named hospital accounts and the
service account only, never "anyone with the link," and keep it in a
hospital-controlled Google Workspace rather than a personal Gmail. `hn` plus
`patient_name` is identifiable health data under Thailand's PDPA in both
stores — where each lives, who can open it, and how long it is kept are
decisions with legal weight, worth confirming with whoever owns data
governance at the hospital before the first real patient is written.

## Environment

```
# Neon — required; /api/log answers 503 without it
DATABASE_URL                   postgresql://user:pass@host.neon.tech/db

# Google Sheets mirror — optional; skipped (not failed) if any are missing
GOOGLE_SERVICE_ACCOUNT_EMAIL   cast-log@<project>.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY             -----BEGIN PRIVATE KEY-----\n…   (escaped \n)
SHEETS_SPREADSHEET_ID          from the sheet URL
SHEETS_RANGE                   cast_log!A:J            (optional, default)

# LIFF access control — required; api/log.js needs SESSION_SECRET too
VITE_LIFF_ID                   build-time; the LIFF app id
LINE_LIFF_CHANNEL_ID           the LIFF channel id, checked as the token audience
SESSION_SECRET                 HMAC key for the session cookie
LINE_ALLOWED_USER_IDS          optional, merged with config/allowed-line-users.json

# Enrolment webhook
LINE_CHANNEL_SECRET            verifies x-line-signature on OA deliveries
TELEGRAM_BOT_TOKEN             admin notification bot
TELEGRAM_CHAT_ID               where enrolment ids are sent
```

`GOOGLE_PRIVATE_KEY` arrives from Vercel with literal `\n`;
`src/lib/sheets.js`'s `normalizePrivateKey` turns those into real newlines
before handing the key to `crypto` — this was the single most common reason
a first Sheets deploy failed with an opaque signature error, so the fix now
lives right next to the thing that needs it rather than in a setup note
someone has to remember.

Missing `DATABASE_URL` or `SESSION_SECRET` → `/api/log` answers
`503 not-configured` and the client keeps everything in the outbox, same
degradation shape as `api/ocr.js`. Missing Sheets vars → the mirror is
silently skipped (`sheet:"skipped"`), not an error; the Sheet was always
the part of this that could be absent without anyone losing data.

## Implementation plan (as shipped)

| Phase | Work | Status |
|---|---|---|
| 1 | `api/log.js`: session check, validation, Neon insert (transactional), best-effort Sheets mirror | Built |
| 2 | `src/lib/outbox.js` + wired into `CastForm`; pending/sent/failed badges | Built |
| 3 | Cookie check in `api/log.js` (LIFF gate, allowlist, webhook already built) | Built |
| 4 | `cast_log_deduped` view; a Sheet pivot per cast type is spreadsheet work, not code | View built, pivot not done |
| 5 | Per-IP rate limiting | Not built |
