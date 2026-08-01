/**
 * sheets.js — mint a Google service-account access token and shape a
 * values.append call, without the googleapis or google-auth-library SDKs.
 *
 * A service-account token is a self-signed JWT (RS256) exchanged for an
 * OAuth access token. `googleapis`/`google-auth-library` are large
 * dependencies to pull in for that one exchange, so this hand-rolls it
 * against Node's built-in crypto — about the same size as `api/auth.js`'s
 * own JWT handling for LINE.
 *
 * The signing and payload shaping below are pure and tested directly
 * (RS256/PKCS1v15 signatures are deterministic for a given key and input,
 * so a real keypair generated at test time is enough to round-trip through
 * crypto.verify without a network call). Only the two actual HTTP calls —
 * the token exchange and the append itself — are untested here, the same
 * boundary `api/auth.js` draws around LINE's verify endpoint.
 */

import crypto from 'node:crypto';
import { castLabel } from './casts.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * The signed JWT assertion Google's token endpoint expects for a
 * service-account exchange, plus the `exp` it carries so callers can cache
 * the access token they trade it for without re-decoding anything.
 */
export function buildAssertion(email, privateKeyPem, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: email, scope: SHEETS_SCOPE, aud: TOKEN_URL, iat, exp };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(privateKeyPem).toString('base64url');

  return { jwt: `${signingInput}.${signature}`, exp };
}

/**
 * Vercel stores a multi-line PEM as a single env var with literal `\n`
 * sequences rather than real newlines — this is the single most common
 * reason a first deploy fails with an opaque signature error, so the fix
 * lives right next to the thing that needs the real key.
 */
export function normalizePrivateKey(raw) {
  return typeof raw === 'string' ? raw.replace(/\\n/g, '\n') : raw;
}

/** One row per (visit × cast type), in the column order api/db/schema.sql uses. */
export function toSheetRows(entry, loggedAtISO, appVersion = '') {
  return entry.casts.map((c) => [
    loggedAtISO,
    entry.visit_id,
    entry.shift_date,
    entry.hn,
    entry.name,
    c.id,
    castLabel(c.id),
    c.count,
    entry.source,
    appVersion,
  ]);
}

/** Exchange a signed assertion for an access token. Network call, untested. */
export async function mintAccessToken(email, privateKeyPem, now = Date.now()) {
  const { jwt, exp } = buildAssertion(email, normalizePrivateKey(privateKeyPem), now);
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`token exchange failed: ${r.status} ${detail.slice(0, 200)}`);
  }
  const { access_token: accessToken } = await r.json();
  return { accessToken, exp };
}

/** Append rows to a sheet range. Network call, untested. */
export async function appendToSheet({ accessToken, spreadsheetId, range, rows }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`sheets append failed: ${r.status} ${detail.slice(0, 200)}`);
  }
  return r.json();
}
