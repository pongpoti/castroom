/**
 * allowlist.js — who may use the app, as rows in Neon instead of a checked
 * -in JSON file.
 *
 * The JSON file (config/allowed-line-users.json) meant every grant was a
 * commit and a deploy, which was fine for the first few names and not for
 * an ongoing enrolment flow with an accept/reject step. This is the same
 * question — "is this LINE user id on the list?" — asked of a table that
 * api/telegram-webhook.js can write to directly.
 */

import { isLineUserId } from './gate.js';

/** Whether a verified LINE user id may use the app. */
export async function isAllowedInDb(sql, userId) {
  if (!isLineUserId(userId)) return false;
  const rows = await sql`select 1 from allowed_line_users where line_user_id = ${userId} limit 1`;
  return rows.length > 0;
}

/**
 * Grants access. Idempotent — accepting the same enrolment twice (a
 * double-tap on the Telegram button, say) is a no-op rather than an error.
 */
export async function addAllowedUser(sql, userId, displayName) {
  await sql`
    insert into allowed_line_users (line_user_id, display_name)
    values (${userId}, ${displayName ?? null})
    on conflict (line_user_id) do nothing
  `;
}
