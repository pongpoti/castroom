/**
 * telegram.js — the enrolment notification, and the accept/reject reply.
 *
 * The message itself is deliberately just two lines — the LINE user id and
 * their display name — with the accept/reject decision as inline buttons
 * underneath rather than a third line of instructions, since the buttons
 * are the entire admin action available here.
 *
 * Verification is a shared-secret header comparison rather than an HMAC:
 * Telegram's webhook has no signature scheme of its own, only the
 * `secret_token` an admin sets once via setWebhook and Telegram echoes back
 * on every delivery as `X-Telegram-Bot-Api-Secret-Token`. That is weaker
 * than LINE's per-request HMAC, which is why `api/telegram-webhook.js`
 * additionally checks the callback came from the configured admin chat
 * before acting on it.
 */

import crypto from 'node:crypto';

const API = 'https://api.telegram.org';

/** The two-line notification body: id, then display name (or blank). */
export function enrolmentText(userId, displayName) {
  return `${userId}\n${displayName ?? ''}`;
}

/** Accept/reject as inline buttons, the userId round-tripped through callback_data. */
export function buildDecisionKeyboard(userId) {
  return {
    inline_keyboard: [[
      { text: '✅ Accept', callback_data: `accept:${userId}` },
      { text: '❌ Reject', callback_data: `reject:${userId}` },
    ]],
  };
}

/** `"accept:U1234..."` -> `{action:"accept", userId:"U1234..."}`, or null if malformed. */
export function parseCallbackData(data) {
  if (typeof data !== 'string') return null;
  const i = data.indexOf(':');
  if (i === -1) return null;
  const action = data.slice(0, i);
  const userId = data.slice(i + 1);
  if (action !== 'accept' && action !== 'reject') return null;
  if (!userId) return null;
  return { action, userId };
}

/** The display name off line two of the original two-line notification. */
export function displayNameFromMessage(messageText) {
  if (typeof messageText !== 'string') return null;
  const [, name] = messageText.split('\n');
  return name?.trim() || null;
}

/** The message text after a decision, buttons removed, decision appended. */
export function decidedText(originalText, action) {
  const suffix = action === 'accept' ? '✅ อนุมัติแล้ว' : '❌ ปฏิเสธแล้ว';
  return `${originalText}\n\n${suffix}`;
}

/** Timing-safe compare of Telegram's shared-secret webhook header. */
export function verifyWebhookSecret(header, secret) {
  if (typeof header !== 'string' || !header || typeof secret !== 'string' || !secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function call(token, method, body) {
  const r = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`telegram ${method} ${r.status}: ${detail.slice(0, 200)}`);
  }
  return r.json();
}

export function sendMessage(token, { chatId, text, replyMarkup }) {
  return call(token, 'sendMessage', {
    chat_id: chatId, text, reply_markup: replyMarkup, disable_web_page_preview: true,
  });
}

export function editMessageText(token, { chatId, messageId, text, replyMarkup }) {
  return call(token, 'editMessageText', {
    chat_id: chatId, message_id: messageId, text, reply_markup: replyMarkup,
  });
}

export function answerCallbackQuery(token, { callbackQueryId, text }) {
  return call(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}
