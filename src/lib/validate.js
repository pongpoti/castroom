/**
 * validate.js — the server-side contract for a submitted visit.
 *
 * The client already checks HN length, name length and cast selection
 * before the submit button unlocks, but that is a convenience for the
 * operator, not a control: `api/log.js` re-checks everything here before it
 * touches either the database or the sheet, because the client's checks are
 * code a browser can be made to skip.
 */

import { CAST_TYPES } from './casts.js';
import { DOCTORS } from './doctors.js';

const HN_LEN = 7;
const MAX_CASTS = 10;
const MAX_COUNT = 20;
const MAX_NAME = 120;
const MIN_NAME = 3;
const MAX_VISIT_ID = 64;

const CAST_IDS = new Set(CAST_TYPES.map((t) => t.id));
const DOCTOR_IDS = new Set(DOCTORS.map((d) => d.id));
const SOURCES = new Set(['qr', 'manual']);

/** A plain YYYY-MM-DD, and not implausibly far from today in either direction. */
function isPlausibleDate(s, now = new Date()) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  const days = (d.getTime() - now.getTime()) / 86_400_000;
  // A day ahead covers a shift that crosses midnight before it's logged; two
  // years back covers a legitimate backfill without accepting garbage.
  return days < 2 && days > -730;
}

/**
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function validateLogPayload(body, now = new Date()) {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'invalid-body' };
  }

  const { visit_id: visitId, shift_date: shiftDate, hn, name, doctor_id: doctorId, source, casts } = body;

  if (typeof visitId !== 'string' || visitId.length === 0 || visitId.length > MAX_VISIT_ID) {
    return { ok: false, error: 'invalid-visit-id' };
  }
  if (!isPlausibleDate(shiftDate, now)) {
    return { ok: false, error: 'invalid-shift-date' };
  }
  if (typeof hn !== 'string' || !/^\d{7}$/.test(hn)) {
    return { ok: false, error: 'invalid-hn' };
  }
  if (!DOCTOR_IDS.has(doctorId)) {
    return { ok: false, error: 'invalid-doctor-id' };
  }
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (trimmedName.length < MIN_NAME || trimmedName.length > MAX_NAME) {
    return { ok: false, error: 'invalid-name' };
  }
  if (!SOURCES.has(source)) {
    return { ok: false, error: 'invalid-source' };
  }
  if (!Array.isArray(casts) || casts.length === 0 || casts.length > MAX_CASTS) {
    return { ok: false, error: 'invalid-casts' };
  }

  const seen = new Set();
  const cleanCasts = [];
  for (const c of casts) {
    if (typeof c !== 'object' || c === null) return { ok: false, error: 'invalid-casts' };
    const { id, count } = c;
    if (!CAST_IDS.has(id)) return { ok: false, error: 'invalid-cast-id' };
    if (seen.has(id)) return { ok: false, error: 'duplicate-cast-id' };
    seen.add(id);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
      return { ok: false, error: 'invalid-cast-count' };
    }
    cleanCasts.push({ id, count });
  }

  return {
    ok: true,
    value: {
      visit_id: visitId,
      shift_date: shiftDate,
      hn,
      name: trimmedName,
      doctor_id: doctorId,
      source,
      casts: cleanCasts,
    },
  };
}
