/**
 * api/auth.js — verify a LIFF login and decide whether it may use the app.
 *
 * The browser sends the ID token LIFF issued it, never a user id. A user id
 * posted by the client is a claim, and anyone can post a claim; an ID token
 * is a JWT signed by LINE, and LINE's own endpoint is what turns it back into
 * a user id here. That difference is the whole reason this endpoint exists
 * rather than the allowlist being checked in the bundle.
 *
 * On success the caller gets an httpOnly session cookie. The browser cannot
 * read or forge it, so later writes can be authorised without going back to
 * LINE on every request.
 */

import crypto from 'node:crypto';
import { allowedFrom, isAllowed } from '../src/lib/gate.js';
import allowlist from '../config/allowed-line-users.json' with { type: 'json' };

const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

/** A shift is long; a day is a safe outer bound for one login. */
export const SESSION_MAX_AGE_S = 12 * 60 * 60;

/** The checked-in list plus anything granted through the environment. */
export function allowedUsers(env = process.env) {
  return allowedFrom([
    ...allowedFrom(allowlist.allow),
    ...allowedFrom(env.LINE_ALLOWED_USER_IDS ?? ''),
  ]);
}

/** `<payload>.<hmac>`, base64url, so the cookie cannot be edited client-side. */
export function signSession(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/**
 * Verify and decode a session cookie. Returns null for anything that is not
 * a currently valid signature, including an expired one.
 *
 * The comparison is timing-safe: a byte-by-byte early exit would leak how
 * much of a guessed signature was right, which is enough to forge one.
 */
export function readSession(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload?.exp !== 'number' || payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const channelId = process.env.LINE_LIFF_CHANNEL_ID;
  const secret = process.env.SESSION_SECRET;
  if (!channelId || !secret) {
    // Same shape as api/ocr.js: an unconfigured deployment is inert, not buggy.
    return res.status(503).json({ error: 'not-configured' });
  }

  const idToken = req.body?.idToken;
  if (typeof idToken !== 'string' || !idToken) {
    return res.status(400).json({ error: 'missing-id-token' });
  }

  let sub;
  try {
    // LINE checks the signature, the expiry and that the token was minted for
    // this channel. Sending client_id is what stops a token issued to some
    // other LIFF app from being replayed at ours.
    const upstream = await fetch(LINE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (!upstream.ok) {
      return res.status(401).json({ error: 'bad-id-token' });
    }
    ({ sub } = await upstream.json());
  } catch (e) {
    return res.status(502).json({ error: 'verify-failed', detail: String(e?.message ?? e) });
  }

  if (!isAllowed(sub, allowedUsers())) {
    // 403, not 401: the login worked, this person is simply not on the list.
    // The response deliberately does not say whether the list is empty or
    // long — that is not something an unauthorised caller needs to learn.
    return res.status(403).json({ error: 'not-allowed' });
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S;
  const token = signSession({ sub, exp }, secret);
  res.setHeader('Set-Cookie', [
    `castroom_session=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_S}`,
  ].join('; '));

  return res.status(200).json({ ok: true });
}
