import { clientIp, windowExpired, checkRateLimit } from '../src/lib/ratelimit.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

/* ---- clientIp ------------------------------------------------------------ */

eq('reads the first hop of x-forwarded-for',
   clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }, socket: {} }), '1.2.3.4');
eq('trims whitespace around the first hop',
   clientIp({ headers: { 'x-forwarded-for': '  1.2.3.4  ,10.0.0.1' }, socket: {} }), '1.2.3.4');
eq('falls back to the socket address with no header',
   clientIp({ headers: {}, socket: { remoteAddress: '5.6.7.8' } }), '5.6.7.8');
eq('falls back to "unknown" with neither', clientIp({ headers: {}, socket: {} }), 'unknown');
eq('tolerates a missing socket entirely', clientIp({ headers: {} }), 'unknown');

/* ---- windowExpired --------------------------------------------------------- */

const T0 = Date.parse('2026-08-01T00:00:00Z');

eq('not expired well inside the window', windowExpired(T0, T0 + 30_000, 60_000), false);
eq('expired once the window has fully elapsed', windowExpired(T0, T0 + 60_000, 60_000), true);
eq('expired well past the window', windowExpired(T0, T0 + 120_000, 60_000), true);
eq('not expired at the very start', windowExpired(T0, T0, 60_000), false);

/* ---- checkRateLimit: pure interaction with an injected sql tag ------------ */

// Simulates the SQL upsert's own logic in JS so the wrapper's request/response
// contract is tested without a live database — real window-rollover behavior
// is covered by windowExpired above, which mirrors the SQL's own comparison.
function fakeSql(state) {
  return async (strings, ...values) => {
    // Interpolation order in checkRateLimit's template is
    // [key, nowSeconds, nowSeconds, windowSeconds, nowSeconds, windowSeconds, nowSeconds].
    const now = values[1];
    const windowSeconds = values[3];
    const expired = state.windowStart == null || (now - state.windowStart >= windowSeconds);
    state.count = expired ? 1 : state.count + 1;
    if (expired) state.windowStart = now;
    return [{ count: state.count }];
  };
}

{
  const state = { windowStart: null, count: 0, windowSeconds: 60 };
  const sql = fakeSql(state);
  const r1 = await checkRateLimit(sql, 'log:1.2.3.4', { limit: 3, windowMs: 60_000, now: 0 });
  eq('first request in a window is allowed', r1, { allowed: true, count: 1, limit: 3 });

  const r2 = await checkRateLimit(sql, 'log:1.2.3.4', { limit: 3, windowMs: 60_000, now: 1000 });
  const r3 = await checkRateLimit(sql, 'log:1.2.3.4', { limit: 3, windowMs: 60_000, now: 2000 });
  eq('third request still within limit', r3, { allowed: true, count: 3, limit: 3 });

  const r4 = await checkRateLimit(sql, 'log:1.2.3.4', { limit: 3, windowMs: 60_000, now: 3000 });
  eq('fourth request in the same window is refused', r4, { allowed: false, count: 4, limit: 3 });

  const r5 = await checkRateLimit(sql, 'log:1.2.3.4', { limit: 3, windowMs: 60_000, now: 61_000 });
  eq('a request in the next window is allowed again', r5, { allowed: true, count: 1, limit: 3 });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
