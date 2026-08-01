/**
 * api/telegram-webhook.js — where an admin's tap on Accept/Reject actually
 * changes anything.
 *
 * api/line-webhook.js only ever asks; this is what answers. A callback
 * query for "accept" writes the LINE user id into `allowed_line_users`
 * (see src/lib/allowlist.js) and edits the original message to show the
 * decision with its buttons removed, so the admin's chat stays a readable
 * log of who was let in and when rather than a pile of still-active buttons.
 *
 * Telegram's webhook has no per-request signature the way LINE's does —
 * only a shared secret, set once via setWebhook, that Telegram echoes back
 * on every delivery as a header. That is weaker than an HMAC, which is why
 * this also checks the callback came from the configured admin chat before
 * acting on it: a leaked secret alone should not be enough to grant access
 * to some other chat entirely.
 */

import { getSql } from '../src/lib/db.js';
import { addAllowedUser } from '../src/lib/allowlist.js';
import { isLineUserId } from '../src/lib/gate.js';
import {
  verifyWebhookSecret, parseCallbackData, displayNameFromMessage,
  decidedText, editMessageText, answerCallbackQuery,
} from '../src/lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const adminChatId = process.env.TELEGRAM_CHAT_ID;
  if (!tgToken || !webhookSecret || !adminChatId || !process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'not-configured' });
  }

  if (!verifyWebhookSecret(req.headers['x-telegram-bot-api-secret-token'], webhookSecret)) {
    return res.status(401).json({ error: 'bad-secret' });
  }

  const callback = req.body?.callback_query;
  // Telegram delivers every update type it's subscribed to, not just button
  // taps — a plain message to the bot arrives here too. Nothing to do with
  // those, and 200 says so without Telegram retrying a delivery it
  // misunderstood as a failure.
  if (!callback) {
    return res.status(200).json({ ok: true });
  }

  // The callback_data alone is not enough to trust: it round-trips through
  // the admin's own Telegram client, but the chat it came from is the
  // actual boundary — this must be the configured admin chat, not merely
  // "some chat holding a valid secret token".
  if (String(callback.message?.chat?.id) !== String(adminChatId)) {
    console.error('telegram-webhook: callback from unexpected chat', callback.message?.chat?.id);
    return res.status(200).json({ ok: true });
  }

  const parsed = parseCallbackData(callback.data);
  const messageId = callback.message?.message_id;
  const originalText = callback.message?.text ?? '';

  if (!parsed || !isLineUserId(parsed.userId)) {
    await answerCallbackQuery(tgToken, {
      callbackQueryId: callback.id,
      text: 'ข้อมูลไม่ถูกต้อง',
    }).catch((e) => console.error('telegram-webhook: answerCallbackQuery failed:', e?.message ?? e));
    return res.status(200).json({ ok: true });
  }

  const { action, userId } = parsed;

  try {
    if (action === 'accept') {
      await addAllowedUser(getSql(), userId, displayNameFromMessage(originalText));
    }
    await editMessageText(tgToken, {
      chatId: adminChatId,
      messageId,
      text: decidedText(originalText, action),
      replyMarkup: { inline_keyboard: [] },
    });
    await answerCallbackQuery(tgToken, {
      callbackQueryId: callback.id,
      text: action === 'accept' ? 'เพิ่มสิทธิ์แล้ว' : 'ปฏิเสธแล้ว',
    });
  } catch (e) {
    console.error('telegram-webhook: decision failed:', e?.message ?? e);
    await answerCallbackQuery(tgToken, {
      callbackQueryId: callback.id,
      text: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง',
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true });
}
