import { extractText, toLinesFromText } from '../src/lib/typhoon.js';
import { parseName, parseHn } from '../src/lib/ocr.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const NAME = 'ชื่อ-สกุลผู้ป่วย : นายวิสุทธิ์ สายแวว';

// The documented shape: content is JSON carrying natural_text.
eq('natural_text unwrapped',
   extractText(JSON.stringify({ natural_text: `QN :3430 HN : 1636405\n${NAME}` })),
   `QN :3430 HN : 1636405\n${NAME}`);

// Same, wrapped in a markdown fence, which chat models add unprompted.
eq('fenced json unwrapped',
   extractText('```json\n{"natural_text":"' + NAME + '"}\n```'), NAME);
eq('fenced plain text unwrapped', extractText('```\n' + NAME + '\n```'), NAME);

// Bare text must survive untouched rather than throwing.
eq('bare text passes through', extractText(NAME), NAME);
eq('malformed json falls back to text', extractText('{not json'), '{not json');
eq('empty natural_text falls back to the body',
   extractText('{"natural_text":"   "}'), '{"natural_text":"   "}');
eq('non-string is empty', extractText(null), '');

// Markdown table rows: the model may format the footer as a table.
eq('table pipes stripped',
   toLinesFromText('| QN :3430 | HN : 1636405 |\n| ' + NAME + ' |').map(l => l.text),
   ['QN :3430 HN : 1636405', NAME]);
eq('list and heading markers stripped',
   toLinesFromText('- ' + NAME + '\n## หัวข้อ').map(l => l.text), [NAME, 'หัวข้อ']);
eq('blank lines dropped', toLinesFromText('a\n\n\nb').length, 2);

// End to end: the existing parsers must work on Typhoon output unchanged,
// including keeping the karan that PP-OCR was dropping.
const lines = toLinesFromText(extractText(JSON.stringify({
  natural_text: `ห้องตรวจ :1\nQN :3430 HN : 1636405\n${NAME}\nสิทธิการรักษา : ประกันสังคมเลือก รพ.สมุทรสาคร`,
})));
eq('name parsed from typhoon output', parseName(lines)?.name, 'นายวิสุทธิ์ สายแวว');
eq('karan preserved', parseName(lines)?.name.includes('์'), true);
eq('no stray letters to drop', parseName(lines)?.dropped, 0);
eq('printed HN cross-check still works', parseHn(lines), '1636405');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
