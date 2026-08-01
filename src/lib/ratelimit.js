/**
 * ratelimit.js — a fixed-window limiter backed by Neon, not memory.
 *
 * A counter kept in the function's own memory would reset on every cold
 * start and give false confidence — the exact gap docs/backend.md flagged
 * before this existed. Neon is already the store this app depends on for
 * everything else, so the counter lives in a table there instead of
 * reaching for a second piece of infrastructure (Redis/Upstash) just for
 * this.
 *
 * The window-rollover decision is pure and tested directly; the increment
 * itself is one atomic upsert so concurrent requests for the same key
 * can't race each other into both reading "under the limit".
 */

/** IPv4/IPv6, optionally with a trailing :port a proxy sometimes adds. */
export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const first = typeof fwd === 'string' ? fwd.split(',')[0].trim() : null;
  return first || req.socket?.remoteAddress || 'unknown';
}

/**
 * Whether `windowStart` is old enough that a new window should begin.
 * Exposed mainly so the rollover boundary itself can be tested without a
 * database — the SQL in `checkRateLimit` encodes the identical comparison.
 */
export function windowExpired(windowStart, now, windowMs) {
  return now - new Date(windowStart).getTime() >= windowMs;
}

/**
 * Atomically increments `key`'s counter, resetting it first if the window
 * has rolled over, and reports whether this request is still within limit.
 *
 * One SQL statement rather than a read-then-write: two concurrent requests
 * for the same key each running their own select-then-update could both
 * read "count 59" and both proceed, which is exactly the race a rate
 * limiter exists to prevent. The `on conflict` upsert takes a row lock, so
 * Postgres serialises the two increments instead.
 */
export async function checkRateLimit(sql, key, { limit, windowMs, now = Date.now() }) {
  const nowSeconds = now / 1000;
  const windowSeconds = windowMs / 1000;
  const [row] = await sql`
    insert into api_rate_limit (key, window_start, count)
    values (${key}, to_timestamp(${nowSeconds}), 1)
    on conflict (key) do update set
      count = case
        when api_rate_limit.window_start <= to_timestamp(${nowSeconds}) - make_interval(secs => ${windowSeconds})
          then 1
        else api_rate_limit.count + 1
      end,
      window_start = case
        when api_rate_limit.window_start <= to_timestamp(${nowSeconds}) - make_interval(secs => ${windowSeconds})
          then to_timestamp(${nowSeconds})
        else api_rate_limit.window_start
      end
    returning count
  `;
  return { allowed: row.count <= limit, count: row.count, limit };
}
