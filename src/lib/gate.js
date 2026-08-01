/**
 * gate.js — who is allowed to run this app, decided as plain data.
 *
 * The rules live here rather than inside the LIFF callbacks so they can be
 * tested without a browser or a LINE client: every function takes the facts
 * it needs and returns a verdict, and the component layer is left with
 * nothing but rendering.
 *
 * Two separate gates, deliberately not merged:
 *
 *   1. `environmentVerdict` — is this the right *place* to be running? LIFF
 *      inside the LINE app on a phone or tablet, and nowhere else.
 *   2. the allowlist — is this the right *person*? That one cannot be decided
 *      here at all. It is answered by the server in `api/auth.js` against
 *      the `allowed_line_users` table (see `src/lib/allowlist.js`), because
 *      a check the browser performs is a check the browser can be edited to
 *      skip. `isLineUserId` below is the one piece of that shared with the
 *      client-independent code: the shape a valid id has, so a malformed
 *      entry is an obvious failure rather than an id that silently never
 *      matches.
 */

/** LIFF reports the host OS; only a real phone or tablet client counts. */
const MOBILE_OS = new Set(['ios', 'android']);

/**
 * @param {object} facts
 * @param {boolean} facts.configured  a LIFF id was built into the bundle
 * @param {boolean} facts.initFailed  liff.init() threw
 * @param {boolean} facts.inClient    liff.isInClient()
 * @param {string=} facts.os          liff.getOS()
 * @returns {'not-configured'|'init-failed'|'external-browser'|'desktop'|'ok'}
 */
export function environmentVerdict({ configured, initFailed, inClient, os }) {
  // Fail closed. A build with no LIFF id cannot identify anyone, so it must
  // not fall through to a usable form — that would be the one configuration
  // where the gate silently isn't there.
  if (!configured) return 'not-configured';
  if (initFailed) return 'init-failed';

  // Opened in Safari/Chrome rather than through the LINE app. Even a LINE
  // login here is not enough: outside the client there is no guarantee the
  // session belongs to the person holding the phone.
  if (!inClient) return 'external-browser';

  // LINE's desktop client runs LIFF too and reports its OS as 'web'. The
  // cast room works from a phone or a ward tablet, so desktop is refused
  // rather than left as an untested path.
  if (!MOBILE_OS.has(os)) return 'desktop';

  return 'ok';
}

/** LINE user ids are `U` followed by 32 hex characters. */
export function isLineUserId(value) {
  return typeof value === 'string' && /^U[0-9a-f]{32}$/.test(value);
}
