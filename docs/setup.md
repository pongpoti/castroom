# Setup

Getting the app running for real: two LINE channels, a Telegram bot, a Neon
database, and ten environment variables.

Allow about 45 minutes. Do the steps in this order — the Telegram webhook
(step 4) needs the LINE webhook (step 3) already sending it messages, and
the allowlist (step 6) needs both working, because the only way onto it is
tapping Accept on a Telegram message.

---

## Read this first: both LINE channels must share one provider

You will create **two** LINE channels: a **LINE Login** channel (which hosts
the LIFF app) and a **Messaging API** channel (the official account people
message). They must sit under the **same provider**.

LINE user ids are scoped to the provider, not the channel. Put the two
channels under different providers and the same person gets two different
ids — the id the enrolment message shows will never match the id the login
produces, the allowlist will never match, and everyone is locked out with no
error message explaining why. It is the single most expensive mistake
available here, and it is invisible until the end.

---

## 1. Provider and the two channels

At <https://developers.line.biz/console/>:

1. **Create a provider** (or pick an existing one). Name it after the
   hospital or the department.
2. Inside it, **Create a new channel → LINE Login**.
   - App types: tick **Web app**.
3. Inside the *same provider*, **Create a new channel → Messaging API**.
   - This one becomes the official account staff will message.

Confirm both channels appear under the same provider name before continuing.

## 2. The LIFF app

In the **LINE Login** channel → **LIFF** tab → **Add**:

| Field | Value |
|---|---|
| LIFF app name | `Cast room log` |
| Size | **Full** |
| Endpoint URL | `https://<your-app>.vercel.app` |
| Scopes | **`openid`** and `profile` |
| Bot link feature | Off (or link the OA if you want the add-friend prompt) |

**`openid` is not optional.** Without it `liff.getIDToken()` returns nothing,
`/api/auth` gets no token to verify, and the app stops at
"ตรวจสอบสิทธิ์ไม่สำเร็จ". If you hit that screen later, this scope is the first
thing to check.

Two values come out of this step, and they are **different numbers** —
mixing them up is a common failure:

- **LIFF ID** — on the LIFF tab, looks like `2001234567-AbCdEfGh` → `VITE_LIFF_ID`
- **Channel ID** — on the *Basic settings* tab of the **LINE Login** channel,
  a plain number like `2001234567` → `LINE_LIFF_CHANNEL_ID`

`LINE_LIFF_CHANNEL_ID` must be the **LINE Login** channel's id, not the
Messaging API one. It is checked as the ID token's audience, which is what
stops a token minted for someone else's LIFF app from working here.

## 3. The Messaging API channel and its webhook

**Channel access token** (for looking up a display name during enrolment):

1. In the **Messaging API** channel → *Messaging API* tab → scroll to
   **Channel access token** → **Issue**. This long token is
   `LINE_CHANNEL_ACCESS_TOKEN`.

**The webhook:**

1. *Basic settings* → copy the **Channel secret** → `LINE_CHANNEL_SECRET`.
   (This is the Messaging API channel's secret. The LINE Login channel has
   its own separate secret, which this app does not use.)
2. *Messaging API* tab → **Webhook URL**:
   `https://<your-app>.vercel.app/api/line-webhook`
3. Turn **Use webhook** on.
4. In [LINE Official Account Manager](https://manager.line.biz/) → Settings →
   Response settings: set **Chat** off / **Webhook** on, and turn off
   auto-reply and greeting messages. Left on, the OA answers with canned text
   and the webhook still fires — harmless, just noisy.

Do not press *Verify* yet — it will fail until the environment variables in
the next step are set and the app is redeployed.

## 4. Telegram bot and its webhook

**The bot:**

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow
   prompts. The token it gives you is `TELEGRAM_BOT_TOKEN`.
2. Send your new bot any message (it will not reply yet — that is expected).
3. Fetch your chat id:
   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" \
     | grep -o '"chat":{"id":[-0-9]*' | head -1
   ```
   That number is `TELEGRAM_CHAT_ID`.

**The webhook secret** — Telegram has no per-request signature the way LINE
does, only a shared string it echoes back on every delivery:

```bash
openssl rand -hex 24
```

Save that as `TELEGRAM_WEBHOOK_SECRET`. You'll register it with Telegram in
step 5, after the environment variables are set and the app is deployed
(the `setWebhook` call needs the deployed URL to point at).

## 5. Environment variables and registering the Telegram webhook

In Vercel → your project → **Settings → Environment Variables**, add all of
these to **Production** (and Preview, if you use it):

```
VITE_LIFF_ID              2001234567-AbCdEfGh     LIFF tab
LINE_LIFF_CHANNEL_ID      2001234567              LINE Login → Basic settings
LINE_CHANNEL_SECRET       <32 hex chars>          Messaging API → Basic settings
LINE_CHANNEL_ACCESS_TOKEN <long token>            Messaging API → Messaging API tab
SESSION_SECRET            <see below>
TELEGRAM_BOT_TOKEN        123456:AA...            BotFather
TELEGRAM_CHAT_ID          123456789               getUpdates
TELEGRAM_WEBHOOK_SECRET   <see step 4>
DATABASE_URL              <see step 6>
TYPHOON_API_KEY           <existing>              already set, for the name OCR
```

Generate the session secret with:

```bash
openssl rand -base64 32
```

Then **redeploy**. `VITE_LIFF_ID` is baked in at build time, so changing it
in the dashboard does nothing until a new build runs.

**Register the Telegram webhook** (once, after the deploy that has
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` set):

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-app>.vercel.app/api/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

A `{"ok":true,...}` response means Telegram will now call your app when the
admin taps a button. There is no dashboard equivalent for this step — it is
a one-time API call, not a setting in BotFather.

Now go back to the LINE Messaging API tab and press **Verify** on the LINE
webhook. It should go green.

## 6. Neon (required — nothing saves without this)

Without this, `/api/log` and `/api/auth` answer `503` and every submit sits
in the browser's outbox forever — visible in the UI, never lost, but never
saved either, and nobody can log in at all.

1. **Provision the database.** Either path lands on the same connection
   string:
   - From Vercel: your project → **Storage** tab → **Create Database** →
     **Neon (Postgres)**. Vercel sets `DATABASE_URL` for you.
   - Directly at [neon.tech](https://neon.tech): create a project, then
     **Connection Details** → copy the connection string (starts
     `postgresql://`) → add it as `DATABASE_URL` in Vercel yourself.
2. **Run the schema once.** Open the Neon console's **SQL Editor** (or
   `psql "$DATABASE_URL"`) and run everything in `api/db/schema.sql`. This
   creates `cast_log`, `cast_log_deduped`, `api_rate_limit`, and
   `allowed_line_users` — the app does not create its own tables.
3. **Redeploy** if you added `DATABASE_URL` by hand (Vercel's own "Create
   Database" flow triggers this automatically).

## 7. Get your own LINE id onto the allowlist

The chicken-and-egg step: the app refuses everyone not on the list, and the
list starts empty.

1. Add your new official account as a friend (QR code is on the *Messaging
   API* tab).
2. Send it any message.
3. A two-line message arrives in your Telegram: your LINE user id, then
   your LINE display name, with **✅ Accept** / **❌ Reject** buttons
   underneath.
4. Tap **Accept**. The message updates to show "✅ อนุมัติแล้ว" with the
   buttons removed — you're in immediately, no deploy needed.

> **If nothing arrives in Telegram**, the *Messaging API* tab shows **Your
> user ID** for the channel's own owner. Insert that row directly in the
> Neon SQL Editor to bootstrap yourself, then fix the webhook chain
> afterward: `insert into allowed_line_users (line_user_id, display_name)
> values ('U...', 'admin');`

## 8. Open it

From your phone, in LINE, open:

```
https://liff.line.me/<VITE_LIFF_ID>
```

Share that link in the ward's LINE group — it is the URL staff use every
day. Opening the `vercel.app` URL directly in Safari or Chrome is refused
by design.

Expected: a brief "กำลังตรวจสอบสิทธิ์…", then the form. Submit a visit, then
in the Neon SQL Editor run `select * from cast_log order by id desc limit
5;` — the row should be there within a second or two of the "กำลังส่งข้อมูล 1
รายการ" note disappearing.

---

## When it does not work

Every block screen but one prints its verdict in small type at the bottom —
`external-browser` shows just the "เปิดใน LINE OA เวรห้องเฝือก" message, since
that screen's own text already says what to do. The word on the others tells
you which step below to revisit.

| Verdict on screen | Meaning | Fix |
|---|---|---|
| `not-configured` | No `VITE_LIFF_ID` (or `DATABASE_URL`/`SESSION_SECRET` for the server side) | Set it, then **redeploy** — `VITE_LIFF_ID` is build-time |
| (shown as "เปิดใน LINE OA เวรห้องเฝือก", no code) | Not opened through LINE | Use the `liff.line.me` link, not the vercel.app one |
| `desktop` | LINE's desktop client | Use a phone or tablet |
| `init-failed` | `liff.init()` threw | LIFF ID wrong, or the LIFF **Endpoint URL** does not match the deployment |
| `not-allowed` | Login worked, id not on the allowlist | Step 7. Check the two channels share a provider |
| `auth-failed` | `/api/auth` refused or was unreachable | Missing env vars (503), or the `openid` scope is off |

**Nothing arrives in Telegram from a LINE message.** Check in order:
webhook URL exact and ends `/api/line-webhook`; *Use webhook* is on;
`LINE_CHANNEL_SECRET` is the Messaging API channel's secret, not the login
channel's; `LINE_CHANNEL_ACCESS_TOKEN` is set (its absence answers `503`
before anything is attempted); the bot has been messaged at least once by
you, or it cannot message you back. `api/line-webhook.js` answers `200` to
LINE even when the Telegram send fails, deliberately — LINE retries hard on
non-200s, and a retry storm is worse than a missed notification — so a
green *Verify* does not prove Telegram works. Check the Vercel function
logs for `line-webhook: enrolment failed:` to see the real reason.

**Tapping Accept/Reject does nothing.** The Telegram webhook is a separate
registration from the LINE one (step 5's `curl … setWebhook` call) — check
it actually returned `{"ok":true}` when you ran it. If it did, check
`TELEGRAM_WEBHOOK_SECRET` matches between Vercel's env var and what you
registered, and that `DATABASE_URL` is set (both answer `503` otherwise).

**`not-allowed` for someone you definitely tapped Accept for.** Almost
always the provider mismatch from the top of this page. Compare the id in
the Telegram message against the *Your user ID* shown on the Messaging API
tab: if the same person has two different ids, the channels are under
different providers and one of them has to be recreated.

---

## Local development

```bash
npm install
VITE_LIFF_DEV_BYPASS=1 npm run dev
```

That skips the gate so the form can be worked on without a phone. The bypass
is guarded by `import.meta.env.DEV`, which `vite build` compiles to a literal
`false` — it cannot exist in a deployed bundle, so there is no way to leave it
on by accident.

`npm test` runs without any of this configured.

## Granting or revoking access later

**Granting**: message the OA again from the person's LINE account and tap
Accept on the Telegram message — no deploy needed. Directly in Neon works
too: `insert into allowed_line_users (line_user_id, display_name) values
('U...', 'Name') on conflict (line_user_id) do nothing;`

**Revoking**: `delete from allowed_line_users where line_user_id = 'U...';`
in the Neon SQL Editor. There is no button for this anywhere in the app or
the Telegram flow yet — see `docs/backend.md`'s "Still to do". An
already-issued session cookie stays valid for up to 12 hours after
revoking.
