# Setup

Getting the app running for real: two LINE channels, a Telegram bot, seven
environment variables, and your own LINE id in the allowlist.

Allow about 30 minutes. Do the steps in this order — step 4 needs step 3 to
already work, because the only way onto the allowlist is through the webhook.

---

## Read this first: both channels must share one provider

You will create **two** LINE channels: a **LINE Login** channel (which hosts
the LIFF app) and a **Messaging API** channel (the official account people
message). They must sit under the **same provider**.

LINE user ids are scoped to the provider, not the channel. Put the two
channels under different providers and the same person gets two different
ids — the id the webhook sends to Telegram will never match the id the login
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
mixing them up is the second most common failure:

- **LIFF ID** — on the LIFF tab, looks like `2001234567-AbCdEfGh` → `VITE_LIFF_ID`
- **Channel ID** — on the *Basic settings* tab of the **LINE Login** channel,
  a plain number like `2001234567` → `LINE_LIFF_CHANNEL_ID`

`LINE_LIFF_CHANNEL_ID` must be the **LINE Login** channel's id, not the
Messaging API one. It is checked as the ID token's audience, which is what
stops a token minted for someone else's LIFF app from working here.

## 3. Telegram bot and the webhook

**The bot:**

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts.
   The token it gives you is `TELEGRAM_BOT_TOKEN`.
2. Send your new bot any message (it will not reply — that is expected).
3. Fetch your chat id:
   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" \
     | grep -o '"chat":{"id":[-0-9]*' | head -1
   ```
   That number is `TELEGRAM_CHAT_ID`.

**The webhook**, in the **Messaging API** channel:

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

Do not press *Verify* yet. It will fail until the environment variables are
set and the app is redeployed.

## 4. Environment variables

In Vercel → your project → **Settings → Environment Variables**. Add all of
these to **Production** (and Preview, if you use preview deployments):

```
VITE_LIFF_ID            2001234567-AbCdEfGh     LIFF tab
LINE_LIFF_CHANNEL_ID    2001234567              LINE Login → Basic settings
LINE_CHANNEL_SECRET     <32 hex chars>          Messaging API → Basic settings
SESSION_SECRET          <see below>
TELEGRAM_BOT_TOKEN      123456:AA...            BotFather
TELEGRAM_CHAT_ID        123456789               getUpdates
TYPHOON_API_KEY         <existing>              already set, for the name OCR
```

Generate the session secret with:

```bash
openssl rand -base64 32
```

Then **redeploy**. `VITE_LIFF_ID` is baked in at build time, so changing it in
the dashboard does nothing until a new build runs.

Now press **Verify** on the webhook. It should go green.

## 5. Get your own LINE id onto the allowlist

The chicken-and-egg step: the app refuses everyone not on the list, and the
list starts empty.

1. Add your new official account as a friend (QR code is on the *Messaging
   API* tab).
2. Send it any message.
3. Your LINE user id arrives in Telegram, looking like
   `U1234567890abcdef1234567890abcdef`.
4. Put it in `config/allowed-line-users.json`:

```json
{
  "allow": [
    "U1234567890abcdef1234567890abcdef"
  ],
  "who": {
    "U1234567890abcdef1234567890abcdef": "หมอสมชาย (admin)"
  }
}
```

5. Commit and deploy.

`who` is only documentation, but write it anyway — a bare list of 32-character
hex strings is unmaintainable within a month.

> **Shortcut if Telegram is not working yet:** the *Messaging API* tab of the
> channel shows **Your user ID** for the channel's own owner. That is the same
> id, so you can bootstrap yourself from there and fix Telegram after.

## 6. Open it

From your phone, in LINE, open:

```
https://liff.line.me/<VITE_LIFF_ID>
```

Share that link in the ward's LINE group — it is the URL staff use every day.
Opening the `vercel.app` URL directly in Safari or Chrome is refused by
design.

Expected: a brief "กำลังตรวจสอบสิทธิ์…", then the form.

---

## When it does not work

Every block screen prints its verdict in small type at the bottom. That word
tells you which step to revisit.

| Verdict on screen | Meaning | Fix |
|---|---|---|
| `not-configured` | No `VITE_LIFF_ID` in the build | Set it, then **redeploy** — it is build-time |
| `external-browser` | Not opened through LINE | Use the `liff.line.me` link, not the vercel.app one |
| `desktop` | LINE's desktop client | Use a phone or tablet |
| `init-failed` | `liff.init()` threw | LIFF ID wrong, or the LIFF **Endpoint URL** does not match the deployment |
| `not-allowed` | Login worked, id not on the list | Step 5. Check the two channels share a provider |
| `auth-failed` | `/api/auth` refused or was unreachable | Missing `LINE_LIFF_CHANNEL_ID` / `SESSION_SECRET` (503), or the `openid` scope is off |

**Nothing arrives in Telegram.** Check in order: webhook URL exact and
`/api/line-webhook`; *Use webhook* on; `LINE_CHANNEL_SECRET` is the Messaging
API channel's secret, not the login channel's; the bot has been messaged at
least once by you, or it cannot message you back. The endpoint answers `200`
to LINE even when Telegram fails, deliberately — LINE retries hard on
non-200s, and a retry storm is worse than a missed notification. So a green
*Verify* does not prove Telegram works; send a real message to test.

**`not-allowed` for someone whose id you definitely added.** Almost always the
provider mismatch from the top of this page. Compare the id in Telegram
against the *Your user ID* shown on the Messaging API tab: if the same person
has two different ids, the channels are under different providers and one of
them has to be recreated.

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

## Granting access later

Two ways:

- **The file** — add the id to `config/allowed-line-users.json` and deploy.
  Reviewable, and the `who` map keeps it readable. Preferred.
- **The environment** — add to `LINE_ALLOWED_USER_IDS` (comma-separated) in
  Vercel. Merged with the file, takes effect on redeploy without a commit.
  Useful in a hurry; the file is where the list should actually live.

Removing access is the same edit in reverse. An already-issued session cookie
stays valid for up to 12 hours after removal.
