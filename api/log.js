/**
 * api/log.js — the write path for a submitted visit.
 *
 * Neon is the only store: an earlier version also mirrored every write to a
 * Google Sheet, which added a second failure mode (a mirror could silently
 * fall behind) for a benefit nobody ended up needing — the Sheet was always
 * meant for staff who wanted to browse records without a database client,
 * and that need didn't materialise, so the mirror is gone rather than kept
 * half-used. Neon plus a read UI, if one gets built, covers the same need
 * without a second system that can disagree with the first.
 *
 * Requires the session cookie api/auth.js issues. A user id posted by the
 * client would be a claim anyone could make; the cookie is signed
 * server-side and was only ever handed to a caller who passed the LIFF
 * allowlist check, so it is what actually gates this endpoint rather than
 * being a courtesy the way the LIFF environment check is.
 *
 * Rate limited per IP before any of that runs — see src/lib/ratelimit.js
 * for why the counter lives in Neon rather than in this function's memory.
 */

import { readSession } from './auth.js';
import { validateLogPayload } from '../src/lib/validate.js';
import { getSql, insertCastLog } from '../src/lib/db.js';
import { checkRateLimit, clientIp } from '../src/lib/ratelimit.js';

const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';

// A stolen session and an outright script kiddie both look the same at this
// layer: more requests than any real operator submits. 60/minute is far
// above the rate a person tapping through this form could reach, and far
// below what turns a leaked session into a flooded database.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const secret = process.env.SESSION_SECRET;
  if (!process.env.DATABASE_URL || !secret) {
    return res.status(503).json({ error: 'not-configured' });
  }

  const sql = getSql();

  // A rate-limit check that can't reach Neon means Neon is down, which the
  // insert below would fail on anyway — surfaced the same way (502) rather
  // than as an uncaught exception.
  let limit;
  try {
    limit = await checkRateLimit(sql, `log:${clientIp(req)}`, {
      limit: RATE_LIMIT,
      windowMs: RATE_WINDOW_MS,
    });
  } catch (e) {
    return res.status(502).json({ error: 'db-write-failed', detail: String(e?.message ?? e) });
  }
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(RATE_WINDOW_MS / 1000)));
    return res.status(429).json({ error: 'rate-limited' });
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
    insertedIds = await insertCastLog(sql, entry, loggedAtISO, APP_VERSION);
  } catch (e) {
    return res.status(502).json({ error: 'db-write-failed', detail: String(e?.message ?? e) });
  }

  return res.status(200).json({ ok: true, rows: insertedIds.length });
}
