/**
 * outbox.js — a submit is queued, not fired and forgotten.
 *
 * Ward wifi drops. Losing a submitted patient because of it is the worst
 * outcome this app has, so every submit lands in a localStorage queue
 * first and is only removed once the server has actually accepted it.
 * `localStorage` rather than IndexedDB: these are small JSON records and
 * the synchronous API removes a class of write-during-unload bugs — the
 * trade is that a patient name sits on the device until the flush succeeds.
 *
 * This module owns the queue and the retry loop; it does not own when to
 * call flush() — CastForm does that on submit, on the browser's `online`
 * event, and on a backoff timer, matching the design in
 * docs/backend.md Decision 5.
 */

const KEY = 'castroom.outbox.v1';
const MAX_BACKOFF_MS = 2 * 60_000;

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or unavailable (private browsing). The in-memory caller
    // still has the entry for this session; it just won't survive a reload.
  }
}

/** Queue a visit for sending. Returns the queued record, status "pending". */
export function enqueue(visit) {
  const items = readAll();
  const record = { visit, status: 'pending', attempts: 0, queuedAt: Date.now() };
  items.push(record);
  writeAll(items);
  return record;
}

export function pendingCount() {
  return readAll().filter((r) => r.status === 'pending').length;
}

export function list() {
  return readAll();
}

/**
 * Send every pending entry, oldest first, stopping to leave later ones
 * queued if an earlier one hits a network failure — sending out of order
 * is more confusing to debug later than a short delay is costly now.
 *
 * @param {(visit: object) => Promise<{ok: true} | {ok: false, retry: boolean}>} send
 * @returns {{sent: number, failed: number, remaining: number}}
 */
export async function flush(send) {
  const items = readAll();
  let sent = 0;
  let failed = 0;

  for (const record of items) {
    if (record.status !== 'pending') continue;
    let result;
    try {
      result = await send(record.visit);
    } catch {
      result = { ok: false, retry: true };
    }
    if (result.ok) {
      record.status = 'sent';
      sent++;
    } else if (!result.retry) {
      // 4xx: the server has already told us retrying will not help. Marked
      // failed rather than removed, so the operator can see what needs
      // manual attention instead of it vanishing silently.
      record.status = 'failed';
      failed++;
    } else {
      // 5xx/network: stop here and leave this one and everything after it
      // queued for the next flush, rather than reordering around a stall.
      record.attempts += 1;
      break;
    }
  }

  const remaining = items.filter((r) => r.status === 'pending');
  writeAll([...remaining, ...items.filter((r) => r.status !== 'pending')]);
  return { sent, failed, remaining: remaining.length };
}

/** Exponential backoff for the retry timer, capped so a bad night doesn't spin. */
export function backoffMs(attempts) {
  return Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.max(0, attempts - 1));
}

/** Drop entries the server has confirmed sent or permanently rejected. */
export function clearSettled() {
  writeAll(readAll().filter((r) => r.status === 'pending'));
}
