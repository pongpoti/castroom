// A minimal synchronous localStorage, enough for outbox.js's get/set/remove
// usage — Node has no localStorage, and outbox.js is meant to run in a
// browser, so the test supplies the same interface rather than the module
// growing an injectable-storage parameter it doesn't otherwise need.
class FakeStorage {
  #store = new Map();
  getItem(k) { return this.#store.has(k) ? this.#store.get(k) : null; }
  setItem(k, v) { this.#store.set(k, String(v)); }
  removeItem(k) { this.#store.delete(k); }
  clear() { this.#store.clear(); }
}
globalThis.localStorage = new FakeStorage();

const { enqueue, pendingCount, list, flush, backoffMs, clearSettled } =
  await import('../src/lib/outbox.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const visitA = { visit_id: 'a', hn: '1234567' };
const visitB = { visit_id: 'b', hn: '7654321' };

/* ---- enqueue / pendingCount / list -------------------------------------- */

localStorage.clear();
eq('starts empty', pendingCount(), 0);

const recA = enqueue(visitA);
eq('enqueue returns a pending record', recA.status, 'pending');
eq('pending count after one enqueue', pendingCount(), 1);

enqueue(visitB);
eq('pending count after two enqueues', pendingCount(), 2);
eq('list preserves queue order', list().map((r) => r.visit.visit_id), ['a', 'b']);

/* ---- flush: all succeed -------------------------------------------------- */

localStorage.clear();
enqueue(visitA);
enqueue(visitB);
{
  const sentIds = [];
  const result = await flush(async (v) => { sentIds.push(v.visit_id); return { ok: true }; });
  eq('both sent', result, { sent: 2, failed: 0, remaining: 0 });
  eq('sent in queue order', sentIds, ['a', 'b']);
  eq('nothing left pending', pendingCount(), 0);
}

/* ---- flush: a 4xx is marked failed, not retried ------------------------- */

localStorage.clear();
enqueue(visitA);
{
  const result = await flush(async () => ({ ok: false, retry: false }));
  eq('failed entry counted', result, { sent: 0, failed: 1, remaining: 0 });
  eq('failed entry kept for the operator to see, not silently dropped',
     list().map((r) => r.status), ['failed']);
}

/* ---- flush: a network failure stops and leaves the rest queued ---------- */

localStorage.clear();
enqueue(visitA);
enqueue(visitB);
{
  const attempted = [];
  const result = await flush(async (v) => {
    attempted.push(v.visit_id);
    if (v.visit_id === 'a') throw new Error('network down');
    return { ok: true };
  });
  eq('stops at the failing entry, does not skip ahead to send b out of order',
     attempted, ['a']);
  eq('a stays pending, b never attempted', result, { sent: 0, failed: 0, remaining: 2 });
  eq('attempt count incremented on the stalled entry', list()[0].attempts, 1);
}

/* ---- flush: resumes after a prior stall ---------------------------------- */

{
  const attempted = [];
  const result = await flush(async (v) => { attempted.push(v.visit_id); return { ok: true }; });
  eq('resumes from where it stalled', attempted, ['a', 'b']);
  eq('both eventually sent', result, { sent: 2, failed: 0, remaining: 0 });
}

/* ---- clearSettled --------------------------------------------------------- */

localStorage.clear();
enqueue(visitA);
await flush(async () => ({ ok: false, retry: false })); // -> failed
enqueue(visitB);                                        // -> pending
clearSettled();
eq('clearSettled drops failed/sent, keeps pending', list().map((r) => r.visit.visit_id), ['b']);

/* ---- backoffMs ------------------------------------------------------------ */

eq('first retry waits 2s', backoffMs(1), 2000);
eq('backoff doubles', backoffMs(2), 4000);
eq('backoff doubles again', backoffMs(3), 8000);
eq('backoff is capped', backoffMs(20), 120000);
eq('zero/negative attempts do not underflow', backoffMs(0), 2000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
