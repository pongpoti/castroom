/**
 * api/log.js — the write path for a submitted visit.
 *
 * Neon is the source of truth; the Google Sheet is a best-effort mirror for
 * staff who want to open a spreadsheet rather than a database console. A
 * visit is only ever lost from Neon, never silently dropped because the
 * sheet append failed — Neon is written first, and a mirror failure is
 * logged and reported in the response but does not fail the request.
 *
 * Requires the session cookie api/auth.js issues. A user id posted by the
 * client would be a claim anyone could make; the cookie is signed server
 * -side and was only ever handed to a caller who passed the LIFF allowlist
 * check, so it is what actually gates this endpoint rather than being a
 * courtesy the way the LIFF environment check is.
 */

import { readSession } from './auth.js';
import { validateLogPayload } from '../src/lib/validate.js';
import { getSql, insertCastLog } from '../src/lib/db.js';
import { mintAccessToken, appendToSheet, toSheetRows } from '../src/lib/sheets.js';

const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';

// Warm invocations reuse this; a cold start pays for one token mint. Module
// scope survives between requests on the same warm instance, not across
// deploys or scale-to-zero — that's fine, the alternative is minting a
// token on every request, which the 5-minute headroom below already avoids
// for the common case.
let cachedToken = null; // { accessToken, exp } | null

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

async function getSheetsToken(email, key) {
  const now = Date.now();
  if (cachedToken && cachedToken.exp * 1000 - now > 5 * 60 * 1000) {
    return cachedToken.accessToken;
  }
  cachedToken = await mintAccessToken(email, key, now);
  return cachedToken.accessToken;
}

/** Best-effort: caller catches, a failure here must not fail the request. */
async function mirrorToSheet(entry, loggedAtISO) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  const range = process.env.SHEETS_RANGE || 'cast_log!A:J';
  if (!email || !key || !spreadsheetId) return 'skipped';

  const accessToken = await getSheetsToken(email, key);
  await appendToSheet({
    accessToken,
    spreadsheetId,
    range,
    rows: toSheetRows(entry, loggedAtISO, APP_VERSION),
  });
  return 'ok';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const secret = process.env.SESSION_SECRET;
  if (!process.env.DATABASE_URL || !secret) {
    return res.status(503).json({ error: 'not-configured' });
  }

  const token = readCookie(req, 'castroom_session');
  const session = token ? readSession(token, secret) : null;
  if (!session) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const result = validateLogPayload(req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  const entry = result.value;
  const loggedAtISO = new Date().toISOString();

  let insertedIds;
  try {
    const sql = getSql();
    insertedIds = await insertCastLog(sql, entry, loggedAtISO, APP_VERSION);
  } catch (e) {
    return res.status(502).json({ error: 'db-write-failed', detail: String(e?.message ?? e) });
  }

  let sheet = 'skipped';
  try {
    sheet = await mirrorToSheet(entry, loggedAtISO);
  } catch (e) {
    sheet = 'failed';
    console.error('api/log: sheet mirror failed:', e?.message ?? e);
  }

  return res.status(200).json({ ok: true, rows: insertedIds.length, sheet });
}
