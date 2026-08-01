import {
  enrolmentText, buildDecisionKeyboard, parseCallbackData,
  displayNameFromMessage, decidedText, verifyWebhookSecret,
} from '../src/lib/telegram.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const ID = 'U' + 'a1b2c3d4'.repeat(4);

/* ---- enrolmentText: exactly two lines ------------------------------------ */

eq('id then display name, two lines', enrolmentText(ID, 'สมชาย ใจดี'), `${ID}\nสมชาย ใจดี`);
eq('a missing display name leaves the second line blank rather than "undefined"',
   enrolmentText(ID, null), `${ID}\n`);
eq('exactly one newline — two lines, nothing more', enrolmentText(ID, 'Name').split('\n').length, 2);

/* ---- buildDecisionKeyboard ------------------------------------------------ */

eq('one row, two buttons, both carrying the id',
   buildDecisionKeyboard(ID),
   { inline_keyboard: [[
     { text: '✅ Accept', callback_data: `accept:${ID}` },
     { text: '❌ Reject', callback_data: `reject:${ID}` },
   ]] });

/* ---- parseCallbackData ---------------------------------------------------- */

eq('accept parses', parseCallbackData(`accept:${ID}`), { action: 'accept', userId: ID });
eq('reject parses', parseCallbackData(`reject:${ID}`), { action: 'reject', userId: ID });
eq('unknown action rejected', parseCallbackData(`delete:${ID}`), null);
eq('missing colon rejected', parseCallbackData('acceptU123'), null);
eq('missing id rejected', parseCallbackData('accept:'), null);
eq('non-string rejected', parseCallbackData(undefined), null);
eq('a colon inside the id is kept, not split again',
   parseCallbackData('accept:U:with:colons').userId, 'U:with:colons');

/* ---- displayNameFromMessage ------------------------------------------------ */

eq('reads the second line', displayNameFromMessage(`${ID}\nสมชาย ใจดี`), 'สมชาย ใจดี');
eq('trims the second line', displayNameFromMessage(`${ID}\n  Name  `), 'Name');
eq('a blank second line is null, not an empty string', displayNameFromMessage(`${ID}\n`), null);
eq('a single-line message has no name', displayNameFromMessage(ID), null);
eq('non-string is null', displayNameFromMessage(undefined), null);

/* ---- decidedText ------------------------------------------------------------ */

eq('accept appends the Thai approval line',
   decidedText(`${ID}\nName`, 'accept'), `${ID}\nName\n\n✅ อนุมัติแล้ว`);
eq('reject appends the Thai rejection line',
   decidedText(`${ID}\nName`, 'reject'), `${ID}\nName\n\n❌ ปฏิเสธแล้ว`);

/* ---- verifyWebhookSecret ---------------------------------------------------- */

eq('matching secret accepted', verifyWebhookSecret('shh', 'shh'), true);
eq('wrong secret rejected', verifyWebhookSecret('nope', 'shh'), false);
eq('different-length header rejected', verifyWebhookSecret('sh', 'shh'), false);
eq('missing header rejected', verifyWebhookSecret(undefined, 'shh'), false);
eq('empty configured secret never matches', verifyWebhookSecret('', ''), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
