# Backend: Neon, rate limiting, and a Neon-backed allowlist

**Status: built.** Every decision below is implemented, not proposed —
`api/log.js`, `api/auth.js`, `api/line-webhook.js`, `api/telegram-webhook.js`,
`src/lib/db.js`, `src/lib/validate.js`, `src/lib/ratelimit.js`,
`src/lib/allowlist.js`, `src/lib/outbox.js`, `api/db/schema.sql`. The
reasoning stays here because disagreeing with a decision is still useful
after it ships; it just means opening a PR against the code instead of the
doc.

**Revision note.** This doc originally specified Neon plus a Google Sheets
mirror, and an allowlist kept in a checked-in JSON file. Both changed:
the Sheets mirror was removed entirely — a second store that could silently
disagree with the first was a cost nobody ended up needing, since the need
it existed for (staff browsing records without a database client) never
materialised into a read UI or a real workflow. And the allowlist moved
from `config/allowed-line-users.json` to a Neon table, because "add an
accept/reject step" is a feature a table supports and a file reviewed by
commit does not.

## Where records live

**Neon (Postgres) is the only store.** A submitted visit is not considered
saved until it is a row in Neon's `cast_log` table. There is no mirror —
losing a write means the 502 `api/log.js` returns, which the client's
outbox (`src/lib/outbox.js`) keeps retrying, not a second system quietly
falling behind the first.

## What is built

```mermaid
flowchart LR
  A["Browser<br/>CastForm"] -->|"POST /api/log<br/>+ session cookie"| B["Vercel function<br/>api/log.js"]
  A -.->|"queued while offline"| Q[("localStorage<br/>outbox")]
  Q -.->|"flush + backoff"| B
  B -->|"rate-limit check"| RL[("Neon<br/>api_rate_limit")]
  B -->|"insert, one transaction"| N[("Neon<br/>cast_log")]

  U["LINE user"] -->|"messages the OA"| LW["api/line-webhook.js"]
  LW -->|"already allowed?"| AL[("Neon<br/>allowed_line_users")]
  LW -->|"get profile"| LP["LINE profile API"]
  LW -->|"2-line message + buttons"| TG["Telegram admin chat"]
  TG -->|"tap Accept/Reject"| TW["api/telegram-webhook.js"]
  TW -->|"insert on Accept"| AL

  LF["LiffGate"] -->|"POST /api/auth { idToken }"| AU["api/auth.js"]
  AU -->|"check"| AL
  AU -->|"Set-Cookie castroom_session"| LF
```

The browser never talks to Neon directly. A database connection string that
reached the bundle would let anyone who loads the page read or write it,
the same reason `api/ocr.js` keeps the Typhoon key server-side.

## Decision 1 — schema

**One row per (visit × cast type)** in `cast_log` (`api/db/schema.sql`):

| Column | Example | Notes |
|---|---|---|
| `logged_at` | `2026-08-01T14:32:05.000Z` | Server clock |
| `visit_id` | `a1b2c3d4-…` | `crypto.randomUUID()`, identical across a visit's rows |
| `shift_date` | `2026-08-01` | The date the operator picked in step 1 |
| `hn` | `1234567` | Exactly 7 digits, enforced by `validateLogPayload` |
| `patient_name` / `cast_type` / `cast_label` / `count` | | |
| `source` | `qr` \| `manual` | Whether the patient came from a scan or was typed |
| `app_version` | `a1b2c3d` | `VERCEL_GIT_COMMIT_SHA`, short form |

A visit with two cast types writes two rows sharing a `visit_id`. Long
format because every question anyone asks of this data is an aggregate over
cast types — one `GROUP BY cast_type` away.

Run `api/db/schema.sql` once against the Neon database before the first
deploy that sets `DATABASE_URL` — `api/log.js` does not create tables
itself.

## Decision 2 — the API contract

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

Responses: `200 {ok:true, rows:2}` · `400 {error:"invalid-…"}` (client bug,
do not retry — see the full list of error codes in `src/lib/validate.js`) ·
`401 {error:"unauthorized"}` (no valid session cookie) ·
`429 {error:"rate-limited"}` (retry after the `Retry-After` header's
seconds) · `502 {error:"db-write-failed"}` (Neon unreachable, retry) ·
`503 {error:"not-configured"}` when `DATABASE_URL` or `SESSION_SECRET` is
missing, mirroring `api/ocr.js`.

**The server re-validates everything** in `validateLogPayload` — HN exactly
7 digits, name 3–120 chars, `shift_date` a real date within about two years
back to one day ahead, every `cast.id` a member of `CAST_TYPES`, no repeated
cast id in one visit, every `count` an integer 1–20, at most 10 cast
entries. The client's checks are a convenience for the operator; this is
the control.

## Decision 3 — duplicates

A plain `insert` has no natural unique key, and the dangerous case is real:
the write succeeds, the response is lost to a dropped connection, the
client's outbox retries.

The client generates `visit_id` once per submit and reuses it across every
retry — `outbox.enqueue` is called once, before the first send attempt.
**`cast_log_deduped`** (a view in `api/db/schema.sql`) keeps the first row
per `(visit_id, cast_type)` via `distinct on`, so at-least-once writes read
as exactly-once.

## Decision 4 — offline and retry (`src/lib/outbox.js`)

Ward wifi drops. Losing a submitted patient because of it is the worst
outcome this app has, so a submit is queued, not fired and forgotten:

1. `submit()` calls `outbox.enqueue(visit)` — a `localStorage` write —
   before it calls the server at all.
2. `outbox.flush(sendToServer)` POSTs each pending entry oldest-first,
   stopping at the first network/5xx failure rather than skipping ahead. A
   4xx is marked `failed` and left visible rather than retried forever.
3. A `useEffect` in `CastForm` re-flushes on mount, on the browser's
   `online` event, and on a `setTimeout` chain using `outbox.backoffMs()` —
   2s, 4s, 8s, capped at 2 minutes.
4. Each visible log entry carries a `รอส่ง` (pending) or `ส่งไม่สำเร็จ`
   (failed) badge; a sent entry carries none. `.cf2-outbox-note` above the
   submit button shows a running "กำลังส่งข้อมูล N รายการ" count.

`localStorage` rather than IndexedDB: these are small JSON records and the
synchronous API avoids a class of write-during-unload bugs. The trade
stands — a patient name sits in `localStorage` on the device until the
flush succeeds.

## Decision 5 — rate limiting (`src/lib/ratelimit.js`)

`/api/log` is rate limited to **60 requests/minute per IP**, checked before
the session cookie is even read. The counter lives in a Neon table
(`api_rate_limit`), not in the function's own memory — an in-memory counter
resets on every cold start, which is exactly the false confidence this
exists to avoid.

The increment is one atomic SQL upsert rather than a read-then-write:

```sql
insert into api_rate_limit (key, window_start, count)
values ($key, now(), 1)
on conflict (key) do update set
  count = case when <window expired> then 1 else count + 1 end,
  window_start = case when <window expired> then now() else window_start end
returning count
```

Two concurrent requests for the same key each running their own
select-then-update could both read "count 59" and both proceed — the exact
race a rate limiter exists to prevent. The `on conflict` upsert takes a row
lock, so Postgres serialises the two increments instead.

**Known limitation: the key is the request's IP address**, `x-forwarded-for`
minus any hop after the first. A hospital ward's shared wifi may NAT every
device on the floor to one public IP, in which case the limit is shared
across everyone on that connection rather than enforced per person. At
60/minute this is far above what a person tapping through the form could
reach even sharing the budget with coworkers, so it functions as an
anti-abuse ceiling rather than a constraint on real use — but it is worth
knowing before assuming "per IP" means "per operator."

## Decision 6 — the allowlist lives in Neon (`src/lib/allowlist.js`)

`allowed_line_users` (`api/db/schema.sql`) replaces
`config/allowed-line-users.json`. `api/auth.js` checks a login's LINE user
id against this table instead of a file baked into the deployment, and the
table is what `api/telegram-webhook.js` writes to when an admin taps
Accept.

```sql
create table allowed_line_users (
  line_user_id  text primary key,
  display_name  text,
  added_at      timestamptz not null default now()
);
```

## Decision 7 — enrolment: LINE OA → Telegram → Accept/Reject

```mermaid
sequenceDiagram
  participant U as New LINE user
  participant LW as api/line-webhook.js
  participant L as LINE profile API
  participant T as Admin's Telegram
  participant TW as api/telegram-webhook.js
  participant DB as Neon: allowed_line_users

  U->>LW: messages the OA
  LW->>DB: already allowed?
  DB-->>LW: no
  LW->>L: GET /v2/bot/profile/{userId}
  L-->>LW: { displayName }
  LW->>T: sendMessage(id + "\n" + name, [Accept] [Reject])
  T->>TW: admin taps Accept
  TW->>DB: insert line_user_id, display_name
  TW->>T: editMessageText — buttons removed, decision shown
```

**The Telegram message is exactly two lines** — the LINE user id, then the
display name — nothing else. The decision itself is the two inline buttons
underneath, built by `buildDecisionKeyboard` in `src/lib/telegram.js`:
`callback_data` is `accept:<userId>` or `reject:<userId>`, round-tripping
the id through Telegram rather than needing a lookup table to resolve it
back later.

**Already-allowed users are not re-notified.** `api/line-webhook.js` checks
`allowed_line_users` before sending anything to Telegram — someone who
already has access messaging the OA again produces no notification and no
repeated accept/reject prompt.

**Accepting** parses the display name back off the second line of the
*original* Telegram message (`displayNameFromMessage`) rather than
re-fetching the LINE profile a second time, and inserts
`(line_user_id, display_name)` with `on conflict do nothing` — tapping
Accept twice is a no-op, not an error. **Rejecting** writes nothing; both
actions edit the original message to show the decision and remove the
buttons, so the admin's chat reads as a log of who was let in and when
rather than a pile of still-active buttons.

### Why Telegram webhook security is a chat check, not just a secret

LINE's webhook carries a per-request HMAC (`x-line-signature`) computed
over the exact bytes sent, verified in `api/line-webhook.js`. Telegram's
webhook has no equivalent — only a shared secret string, set once via
`setWebhook`, that Telegram echoes back on every delivery as
`X-Telegram-Bot-Api-Secret-Token`. That is a weaker guarantee (a static
string compare, not a signature over the payload), so
`api/telegram-webhook.js` adds a second check: the callback's `chat.id`
must match the configured `TELEGRAM_CHAT_ID`. A leaked webhook secret alone
should not be enough to grant access through some other chat.

## Still to do

- **No read path in the app.** `CastForm` still only shows what was
  submitted this session, from its own `log` state — nothing reads Neon
  back. Building one is a second endpoint and a real decision about who may
  read what.
- **No edit or delete.** A wrong `cast_log` row, or an allowlist entry that
  needs revoking, is corrected by hand in Neon. Making the app able to
  mutate either is a much larger surface than appending.
- **No revoke flow.** Removing someone's access today means deleting their
  row from `allowed_line_users` directly — there is no admin-facing "remove
  access" action anywhere in the app or the Telegram flow.
- **No photo storage.** The captured footer image stays on the device and
  is never uploaded.
- **The rate limit key is IP-based**, with the shared-NAT caveat in
  Decision 5. Keying on the authenticated session instead would isolate
  users from each other but would not catch pre-auth abuse of the endpoint
  itself — the tradeoff wasn't forced either way, IP was simply the
  literal ask.

`hn` plus `patient_name` is identifiable health data under Thailand's
PDPA — where it lives, who can query Neon directly, and how long it is kept
are decisions with legal weight, worth confirming with whoever owns data
governance at the hospital before the first real patient is written.

## Environment

```
# Neon — required; /api/log and /api/auth answer 503 without it
DATABASE_URL                   postgresql://user:pass@host.neon.tech/db

# LIFF access control
VITE_LIFF_ID                   build-time; the LIFF app id
LINE_LIFF_CHANNEL_ID           the LIFF channel id, checked as the token audience
SESSION_SECRET                 HMAC key for the session cookie

# Enrolment: LINE OA -> Telegram
LINE_CHANNEL_SECRET            verifies x-line-signature on OA deliveries
LINE_CHANNEL_ACCESS_TOKEN      Messaging API channel access token, for the profile lookup
TELEGRAM_BOT_TOKEN             the admin notification bot
TELEGRAM_CHAT_ID               the admin chat enrolment messages go to

# Enrolment: Telegram -> Neon (the Accept/Reject webhook)
TELEGRAM_WEBHOOK_SECRET        shared secret registered via setWebhook's secret_token
```

Missing `DATABASE_URL` or `SESSION_SECRET` → `/api/log` and `/api/auth`
answer `503 not-configured`; the client keeps everything in the outbox,
same degradation shape as `api/ocr.js`. Missing any of the Telegram/LINE
enrolment vars → both webhooks answer `503` rather than half-processing a
delivery.

## Implementation plan (as shipped)

| Area | Work | Status |
|---|---|---|
| Store | `api/log.js`: session check, rate limit, validation, Neon insert (transactional) | Built |
| Offline | `src/lib/outbox.js` + wired into `CastForm`; pending/sent/failed badges | Built |
| Access control | LIFF gate, Neon-backed allowlist, cookie check on `/api/log` | Built |
| Enrolment | Two-line Telegram message, Accept/Reject buttons, `api/telegram-webhook.js` | Built |
| Rate limiting | Neon-table fixed window, 60/min per IP | Built |
| Dedup | `cast_log_deduped` view | Built |
| Read UI | A page that lists submitted visits from Neon | Not built |
| Revoke flow | Removing allowlist access from the app/Telegram, not just the DB | Not built |
