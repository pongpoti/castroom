import crypto from 'node:crypto';
import { validateLogPayload } from '../src/lib/validate.js';
import { buildAssertion, normalizePrivateKey, toSheetRows } from '../src/lib/sheets.js';

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
  source: 'manual',
  casts: [{ id: 'shortLeg', count: 2 }, { id: 'longLeg', count: 1 }],
};

/* ---- validateLogPayload ------------------------------------------------ */

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

/* ---- sheets.js: JWT assertion round-trips through real RSA -------------- */

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const { jwt, exp } = buildAssertion('svc@project.iam.gserviceaccount.com', privateKey, Date.parse('2026-08-01T00:00:00Z'));
const [headerB64, claimsB64, sigB64] = jwt.split('.');
const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString());

eq('assertion header names RS256', header, { alg: 'RS256', typ: 'JWT' });
eq('assertion claims carry the service account as issuer', claims.iss, 'svc@project.iam.gserviceaccount.com');
eq('assertion claims target the Sheets scope', claims.scope, 'https://www.googleapis.com/auth/spreadsheets');
eq('assertion claims target the token endpoint as audience', claims.aud, 'https://oauth2.googleapis.com/token');
eq('assertion expires one hour after issue', claims.exp - claims.iat, 3600);
eq('returned exp matches the claim', exp, claims.exp);

const verifier = crypto.createVerify('RSA-SHA256');
verifier.update(`${headerB64}.${claimsB64}`);
eq('signature verifies against the matching public key',
   verifier.verify(publicKey, Buffer.from(sigB64, 'base64url')), true);

const forgedVerifier = crypto.createVerify('RSA-SHA256');
forgedVerifier.update(`${headerB64}.${claimsB64}`);
const { publicKey: otherPublicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
eq('signature does not verify against an unrelated key',
   forgedVerifier.verify(otherPublicKey, Buffer.from(sigB64, 'base64url')), false);

/* ---- normalizePrivateKey ------------------------------------------------ */

eq('escaped newlines become real ones',
   normalizePrivateKey('-----BEGIN KEY-----\\nabc\\n-----END KEY-----'),
   '-----BEGIN KEY-----\nabc\n-----END KEY-----');
eq('a key with real newlines already is untouched',
   normalizePrivateKey('-----BEGIN KEY-----\nabc\n-----END KEY-----'),
   '-----BEGIN KEY-----\nabc\n-----END KEY-----');
eq('non-string passes through', normalizePrivateKey(undefined), undefined);

/* ---- toSheetRows --------------------------------------------------------- */

eq('one row per cast, in schema column order',
   toSheetRows(VALID, '2026-08-01T12:00:00.000Z', 'abc1234'),
   [
     ['2026-08-01T12:00:00.000Z', '01J2FQ8Z', '2026-08-01', '1234567', 'สมชาย ใจดี', 'shortLeg', 'Short Leg Slab', 2, 'manual', 'abc1234'],
     ['2026-08-01T12:00:00.000Z', '01J2FQ8Z', '2026-08-01', '1234567', 'สมชาย ใจดี', 'longLeg', 'Long Leg Slab', 1, 'manual', 'abc1234'],
   ]);
eq('app version defaults to an empty string', toSheetRows(VALID, '2026-08-01T12:00:00.000Z')[0].at(-1), '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
