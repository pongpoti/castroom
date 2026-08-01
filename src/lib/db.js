/**
 * db.js — Neon is the source of truth; the Sheets mirror in sheets.js is
 * best-effort. If a submit writes here and the sheet append then fails, the
 * visit is still safe — that ordering is why api/log.js calls this first.
 *
 * @neondatabase/serverless talks to Neon over HTTP rather than a TCP pool,
 * which is what makes it usable from a Vercel function: a serverless
 * invocation that opened a real Postgres connection per request would
 * exhaust the database's connection limit under any real concurrency.
 */

import { neon } from '@neondatabase/serverless';
import { castLabel } from './casts.js';

let client;

/** Lazily constructed so importing this module never requires DATABASE_URL. */
export function getSql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL not set');
    client = neon(url);
  }
  return client;
}

/**
 * One row per cast in the visit, written in a single transaction — a visit
 * that fails partway through must not leave some of its cast types logged
 * and others silently missing.
 */
export async function insertCastLog(sql, entry, loggedAtISO, appVersion) {
  const queries = entry.casts.map((c) => sql`
    insert into cast_log
      (logged_at, visit_id, shift_date, hn, patient_name, cast_type, cast_label, count, source, app_version)
    values
      (${loggedAtISO}, ${entry.visit_id}, ${entry.shift_date}, ${entry.hn}, ${entry.name},
       ${c.id}, ${castLabel(c.id)}, ${c.count}, ${entry.source}, ${appVersion ?? null})
    returning id
  `);
  const results = await sql.transaction(queries);
  return results.flat().map((row) => row.id);
}
