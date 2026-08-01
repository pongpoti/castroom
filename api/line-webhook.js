/**
 * api/line-webhook.js — turn "someone messaged the OA" into a decision for
 * an admin to make, in Telegram.
 *
 * A new user messages the official account; this fetches their display
 * name and sends the admin a two-line Telegram message — the LINE user id,
 * then the name — with Accept/Reject buttons underneath.
 * `api/telegram-webhook.js` is where a tap on either button actually
 * changes anything; nothing here grants access on its own.
 *
 * The endpoint is public, because LINE has to be able to reach it. What
 * keeps it honest is the signature: every real delivery carries an HMAC of
 * the raw body under the channel secret, so a forged POST cannot inject an
 * id into the admin's chat and social-engineer its way onto the list.
 */

import crypto from 'node:crypto';
import { getSql } from '../src/lib/db.js';
import { isAllowedInDb } from '../src/lib/allowlist.js';
import { getLineDisplayName } from '../src/lib/line.js';
import { sendMessage, enrolmentText, buildDecisionKeyboard } from '../src/lib/telegram.js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  if (!channelSecret || !channelAccessToken || !tgToken || !tgChat || !process.env.DATABASE_URL) {
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

  // A delivery LINE itself sends is not necessarily a message: the console's
  // own "Verify" button posts { events: [] } to test connectivity, and a
  // follow/unfollow carries events that userIdsFrom deliberately excludes.
  // Logging the shape — never the message text — is what makes "nothing
  // arrived in Telegram" diagnosable from Vercel's logs instead of guessed at.
  const summary = (Array.isArray(events) ? events : [])
    .map((e) => `${e?.type ?? '?'}/${e?.source?.type ?? '?'}`);
  console.log(`line-webhook: ${summary.length} event(s) [${summary.join(', ')}]`);

  // LINE retries a delivery it does not get a prompt 200 for, and a retry
  // storm is worse than a missed notification: the id is still recoverable by
  // asking the person to message again. So failures are swallowed after the
  // signature has been checked, but logged first.
  try {
    const sql = getSql();
    const ids = userIdsFrom(events);
    let notified = 0;
    for (const id of ids) {
      // Already approved: nothing for an admin to decide, so nothing to ask.
      // Without this, an already-allowed person messaging again pointlessly
      // re-prompts the same accept/reject choice every time.
      if (await isAllowedInDb(sql, id)) continue;

      const displayName = await getLineDisplayName(id, channelAccessToken);
      await sendMessage(tgToken, {
        chatId: tgChat,
        text: enrolmentText(id, displayName),
        replyMarkup: buildDecisionKeyboard(id),
      });
      notified++;
    }
    if (notified > 0) console.log(`line-webhook: notified Telegram for ${notified} id(s)`);
  } catch (e) {
    console.error('line-webhook: enrolment failed:', e?.message ?? e);
  }

  return res.status(200).json({ ok: true });
}
