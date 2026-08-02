import { validateLogPayload } from '../src/lib/validate.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const NOW = new Date('2026-08-01T12:00:00Z');

const VALID = {
  visit_id: '01J2FQ8Z',
  shift_date: '2026-08-01',
  hn: '1234567',
  name: 'สมชาย ใจดี',
  doctor_id: 'doc01',
  source: 'manual',
  casts: [{ id: 'shortLeg', count: 2 }, { id: 'longLeg', count: 1 }],
};

eq('a well-formed visit passes', validateLogPayload(VALID, NOW).ok, true);
eq('trims the name', validateLogPayload({ ...VALID, name: '  สมชาย ใจดี  ' }, NOW).value.name, 'สมชาย ใจดี');

eq('rejects a non-object body', validateLogPayload(null, NOW), { ok: false, error: 'invalid-body' });
eq('rejects a missing visit_id', validateLogPayload({ ...VALID, visit_id: '' }, NOW).error, 'invalid-visit-id');
eq('rejects an oversized visit_id',
   validateLogPayload({ ...VALID, visit_id: 'x'.repeat(65) }, NOW).error, 'invalid-visit-id');

eq('rejects a malformed date', validateLogPayload({ ...VALID, shift_date: '2026-8-1' }, NOW).error, 'invalid-shift-date');
eq('rejects an impossible date', validateLogPayload({ ...VALID, shift_date: '2026-02-30' }, NOW).error, 'invalid-shift-date');
eq('rejects a date far in the future',
   validateLogPayload({ ...VALID, shift_date: '2026-08-10' }, NOW).error, 'invalid-shift-date');
eq('accepts a date one day ahead (shift crossing midnight)',
   validateLogPayload({ ...VALID, shift_date: '2026-08-02' }, NOW).ok, true);
eq('rejects a date more than two years back',
   validateLogPayload({ ...VALID, shift_date: '2024-01-01' }, NOW).error, 'invalid-shift-date');

eq('rejects a short HN', validateLogPayload({ ...VALID, hn: '123456' }, NOW).error, 'invalid-hn');
eq('rejects a long HN', validateLogPayload({ ...VALID, hn: '12345678' }, NOW).error, 'invalid-hn');
eq('rejects a non-numeric HN', validateLogPayload({ ...VALID, hn: '123456a' }, NOW).error, 'invalid-hn');

eq('rejects a too-short name', validateLogPayload({ ...VALID, name: 'AB' }, NOW).error, 'invalid-name');
eq('rejects a whitespace-only name', validateLogPayload({ ...VALID, name: '   ' }, NOW).error, 'invalid-name');
eq('rejects an oversized name', validateLogPayload({ ...VALID, name: 'A'.repeat(121) }, NOW).error, 'invalid-name');

eq('rejects a missing doctor_id', validateLogPayload({ ...VALID, doctor_id: undefined }, NOW).error, 'invalid-doctor-id');
eq('rejects an unknown doctor_id', validateLogPayload({ ...VALID, doctor_id: 'doc99' }, NOW).error, 'invalid-doctor-id');

eq('rejects an unknown source', validateLogPayload({ ...VALID, source: 'phone' }, NOW).error, 'invalid-source');

eq('rejects an empty casts array', validateLogPayload({ ...VALID, casts: [] }, NOW).error, 'invalid-casts');
eq('rejects too many cast entries',
   validateLogPayload({ ...VALID, casts: Array(11).fill({ id: 'shortLeg', count: 1 }) }, NOW).error, 'invalid-casts');
eq('rejects an unknown cast id',
   validateLogPayload({ ...VALID, casts: [{ id: 'brokenArm', count: 1 }] }, NOW).error, 'invalid-cast-id');
eq('rejects a duplicate cast id',
   validateLogPayload({ ...VALID, casts: [{ id: 'shortLeg', count: 1 }, { id: 'shortLeg', count: 2 }] }, NOW).error,
   'duplicate-cast-id');
eq('rejects a zero count', validateLogPayload({ ...VALID, casts: [{ id: 'shortLeg', count: 0 }] }, NOW).error, 'invalid-cast-count');
eq('rejects a non-integer count',
   validateLogPayload({ ...VALID, casts: [{ id: 'shortLeg', count: 1.5 }] }, NOW).error, 'invalid-cast-count');
eq('rejects a count over the ceiling',
   validateLogPayload({ ...VALID, casts: [{ id: 'shortLeg', count: 21 }] }, NOW).error, 'invalid-cast-count');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
