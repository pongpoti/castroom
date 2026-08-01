import { environmentVerdict, allowedFrom, isLineUserId, isAllowed } from '../src/lib/gate.js';
import { signSession, readSession } from '../api/auth.js';
import { verifySignature, userIdsFrom, enrolmentMessage } from '../api/line-webhook.js';
import crypto from 'node:crypto';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const ID = 'U' + 'a1b2c3d4'.repeat(4);          // valid shape: U + 32 hex
const OTHER = 'U' + 'f0e1d2c3'.repeat(4);

/* ---- environment gate ------------------------------------------------- */

const inLine = { configured: true, initFailed: false, inClient: true, os: 'ios' };

eq('LINE app on iOS passes', environmentVerdict(inLine), 'ok');
eq('LINE app on Android passes', environmentVerdict({ ...inLine, os: 'android' }), 'ok');

// An unconfigured build must not fall through to a usable form.
eq('no LIFF id fails closed',
   environmentVerdict({ ...inLine, configured: false }), 'not-configured');
eq('unconfigured beats every other fault',
   environmentVerdict({ configured: false, initFailed: true, inClient: false, os: 'web' }),
   'not-configured');
eq('init failure is its own verdict',
   environmentVerdict({ ...inLine, initFailed: true }), 'init-failed');

// Outside the LINE client there is no trustworthy identity, whatever the OS.
eq('external mobile browser blocked',
   environmentVerdict({ ...inLine, inClient: false }), 'external-browser');
eq('external browser beats desktop',
   environmentVerdict({ ...inLine, inClient: false, os: 'web' }), 'external-browser');

// LINE's desktop client reports os 'web' while still being "in client".
eq('LINE desktop blocked', environmentVerdict({ ...inLine, os: 'web' }), 'desktop');
eq('unknown OS blocked', environmentVerdict({ ...inLine, os: undefined }), 'desktop');

/* ---- allowlist parsing ------------------------------------------------ */

eq('array parsed', [...allowedFrom([ID, OTHER])], [ID, OTHER]);
eq('comma string parsed', [...allowedFrom(`${ID},${OTHER}`)], [ID, OTHER]);
eq('newlines and padding tolerated', [...allowedFrom(` ${ID} \n ${OTHER}\n`)], [ID, OTHER]);
// A hand-edited list should survive a trailing comma rather than fail closed.
eq('blanks dropped', [...allowedFrom(`${ID},,`)], [ID]);
eq('comments dropped', [...allowedFrom(`# a note\n${ID}`)], [ID]);
eq('duplicates collapse', [...allowedFrom([ID, ID])], [ID]);
eq('nothing parses to empty', [...allowedFrom(undefined)], []);

eq('well-formed id accepted', isLineUserId(ID), true);
eq('wrong prefix rejected', isLineUserId('X' + 'a1b2c3d4'.repeat(4)), false);
eq('too short rejected', isLineUserId('U' + 'a1b2c3d4'.repeat(3)), false);
eq('uppercase hex rejected', isLineUserId('U' + 'A1B2C3D4'.repeat(4)), false);
eq('non-string rejected', isLineUserId(null), false);

const list = allowedFrom([ID]);
eq('listed user allowed', isAllowed(ID, list), true);
eq('unlisted user refused', isAllowed(OTHER, list), false);
// A malformed entry must never become a wildcard.
eq('malformed id refused even if listed', isAllowed('nonsense', allowedFrom(['nonsense'])), false);
eq('empty list refuses everyone', isAllowed(ID, allowedFrom([])), false);

/* ---- session cookie --------------------------------------------------- */

const SECRET = 'test-secret';
const future = Math.floor(Date.now() / 1000) + 60;

const token = signSession({ sub: ID, exp: future }, SECRET);
eq('round trips', readSession(token, SECRET)?.sub, ID);
eq('rejects a different secret', readSession(token, 'other'), null);
eq('rejects an expired session',
   readSession(signSession({ sub: ID, exp: future }, SECRET), SECRET, (future + 1) * 1000), null);
eq('rejects a session with no expiry',
   readSession(signSession({ sub: ID }, SECRET), SECRET), null);
eq('rejects a malformed token', readSession('garbage', SECRET), null);
eq('rejects an empty token', readSession('', SECRET), null);

// The payload must not be editable without invalidating the signature.
const [body] = token.split('.');
const swapped = Buffer.from(JSON.stringify({ sub: OTHER, exp: future })).toString('base64url');
eq('rejects a swapped payload', readSession(`${swapped}.${token.split('.')[1]}`, SECRET), null);
eq('rejects a truncated signature', readSession(`${body}.short`, SECRET), null);

/* ---- LINE webhook ----------------------------------------------------- */

const raw = Buffer.from(JSON.stringify({ events: [] }));
const sig = crypto.createHmac('sha256', 'chsecret').update(raw).digest('base64');
eq('valid signature accepted', verifySignature(raw, sig, 'chsecret'), true);
eq('wrong channel secret rejected', verifySignature(raw, sig, 'nope'), false);
eq('tampered body rejected', verifySignature(Buffer.from('{}'), sig, 'chsecret'), false);
eq('absent signature rejected', verifySignature(raw, undefined, 'chsecret'), false);

eq('user id extracted from a direct message',
   userIdsFrom([{ source: { type: 'user', userId: ID } }]), [ID]);
// Being spoken to in a group is not the deliberate enrolment act.
eq('group events ignored',
   userIdsFrom([{ source: { type: 'group', userId: ID, groupId: 'C1' } }]), []);
eq('repeat senders reported once',
   userIdsFrom([{ source: { type: 'user', userId: ID } }, { source: { type: 'user', userId: ID } }]),
   [ID]);
eq('several senders all reported',
   userIdsFrom([{ source: { type: 'user', userId: ID } }, { source: { type: 'user', userId: OTHER } }]),
   [ID, OTHER]);
eq('sourceless events skipped', userIdsFrom([{}, { source: {} }]), []);
eq('non-array tolerated', userIdsFrom(null), []);

eq('message carries the raw id', enrolmentMessage(ID).includes(ID), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
