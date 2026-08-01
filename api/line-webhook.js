/**
 * api/line-webhook.js — turn "someone messaged the OA" into an id in Telegram.
 *
 * This is the enrolment path. A new user messages the official account, their
 * LINE user id arrives in the admin's Telegram, and the admin pastes it into
 * config/allowed-line-users.json. Nothing here grants access on its own —
 * that stays a deliberate, reviewed edit.
 *
 * The endpoint is public, because LINE has to be able to reach it. What keeps
 * it honest is the signature: every real delivery carries an HMAC of the raw
 * body under the channel secret, so a forged POST cannot inject an id into
 * the admin's chat and social-engineer its way onto the list.
 */

import crypto from 'node:crypto';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Vercel parses JSON bodies before the handler sees them, but the signature
 * covers the exact bytes LINE sent — re-serialising loses key order and
 * whitespace and would never match. This reads the raw stream instead.
 */
export const config = { api: { bodyParser: false } };

export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Timing-safe compare of LINE's x-line-signature against the body's HMAC. */
export function verifySignature(rawBody, signature, channelSecret) {
  if (typeof signature !== 'string' || !signature) return false;
  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The user ids worth reporting: one per distinct human in this delivery. */
export function userIdsFrom(events) {
  const ids = new Set();
  for (const ev of Array.isArray(events) ? events : []) {
    const id = ev?.source?.userId;
    // Only direct messages. A group or room event carries a userId too, but
    // enrolling someone because they spoke in a group they were added to is
    // not the deliberate act this flow is meant to capture.
    if (typeof id === 'string' && id && ev?.source?.type === 'user') ids.add(id);
  }
  return [...ids];
}

export function enrolmentMessage(userId) {
  return [
    'castroom — LINE user id',
    '',
    userId,
    '',
    'Add to config/allowed-line-users.json to grant access.',
  ].join('\n');
}

async function notifyTelegram(token, chatId, text) {
  const r = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`telegram ${r.status}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  if (!channelSecret || !tgToken || !tgChat) {
    return res.status(503).json({ error: 'not-configured' });
  }

  const raw = await readRawBody(req);
  if (!verifySignature(raw, req.headers['x-line-signature'], channelSecret)) {
    return res.status(401).json({ error: 'bad-signature' });
  }

  let events;
  try {
    ({ events } = JSON.parse(raw.toString('utf8')));
  } catch {
    return res.status(400).json({ error: 'bad-body' });
  }

  // LINE retries a delivery it does not get a prompt 200 for, and a retry
  // storm is worse than a missed notification: the id is still recoverable by
  // asking the person to message again. So failures are swallowed after the
  // signature has been checked.
  try {
    for (const id of userIdsFrom(events)) {
      await notifyTelegram(tgToken, tgChat, enrolmentMessage(id));
    }
  } catch { /* reported as 200 below; see above */ }

  return res.status(200).json({ ok: true });
}
