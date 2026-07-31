import { toLines, parseName, parseHn, validateName } from '../src/lib/ocr.js';

const b = (x,y,w,h) => ({ x, y, width: w, height: h });
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// The real grouped shape: lines is RecognitionResult[][]
const grouped = { text: '...', confidence: 0.9, lines: [
  [ {text:'QN', box:b(10,10,40,30), confidence:0.98},
    {text:':', box:b(52,10,8,30), confidence:0.9},
    {text:'3430', box:b(64,10,70,30), confidence:0.99},
    {text:'HN', box:b(300,10,40,30), confidence:0.98},
    {text:':', box:b(344,10,8,30), confidence:0.9},
    {text:'1636405', box:b(356,10,120,30), confidence:0.97} ],
  [ {text:'ชื่อ-สกุลผู้ป่วย', box:b(10,60,180,34), confidence:0.93},
    {text:':', box:b(196,60,8,34), confidence:0.8},
    {text:'นายวิสุทธิ์', box:b(210,60,120,34), confidence:0.95},
    {text:'สายแวว', box:b(336,60,110,34), confidence:0.94} ],
  [ {text:'สิทธิการรักษา', box:b(10,110,160,34), confidence:0.9},
    {text:':', box:b(176,110,8,34), confidence:0.8},
    {text:'ประกันสังคม', box:b(190,110,150,34), confidence:0.92} ],
]};

const lines = toLines(grouped);
eq('line texts joined', lines.map(l => l.text), [
  'QN : 3430 HN : 1636405',
  'ชื่อ-สกุลผู้ป่วย : นายวิสุทธิ์ สายแวว',
  'สิทธิการรักษา : ประกันสังคม',
]);
eq('name parsed', parseName(lines)?.name, 'นายวิสุทธิ์ สายแวว');
eq('name box is union of the line', parseName(lines)?.box, b(10,60,436,34));
eq('printed HN', parseHn(lines), '1636405');
eq('name validates', validateName(parseName(lines)?.name).valid, true);

// The bug that shipped: entries treated as line objects stringify to junk.
eq('old-shape junk no longer matches', /\[object Object\]/.test(lines[0].text), false);

// Flattened shape (options.flatten)
const flat = { text:'...', confidence:0.9, results: [
  {text:'ชื่อ-สกุลผู้ป่วย : นายวิสุทธิ์ สายแวว', box:b(10,60,436,34), confidence:0.94},
]};
eq('flattened shape', parseName(toLines(flat))?.name, 'นายวิสุทธิ์ สายแวว');

// Colon dropped by recognition -> fall back to the title
const noColon = { lines: [[ {text:'ชื่อ-สกุลผู้ป่วย', box:b(10,60,180,34), confidence:.9},
                            {text:'นายวิสุทธิ์', box:b(200,60,120,34), confidence:.9},
                            {text:'สายแวว', box:b(326,60,110,34), confidence:.9} ]] };
eq('missing colon falls back to title', parseName(toLines(noColon))?.name, 'นายวิสุทธิ์ สายแวว');

// Female title, and HN with Thai colon
const alt = { lines: [
  [ {text:'HN', box:b(0,0,10,10), confidence:.9}, {text:'：1636405', box:b(12,0,80,10), confidence:.9} ],
  [ {text:'ชื่อ-สกุลผู้ป่วย', box:b(0,40,90,20), confidence:.9}, {text:':', box:b(94,40,6,20), confidence:.9},
    {text:'นางสาวมาลี', box:b(104,40,90,20), confidence:.9}, {text:'ใจดี', box:b(198,40,40,20), confidence:.9} ],
]};
eq('thai colon HN', parseHn(toLines(alt)), '1636405');
eq('female title name', parseName(toLines(alt))?.name, 'นางสาวมาลี ใจดี');

// Degenerate inputs must not throw
eq('empty', parseName(toLines({})), null);
eq('null raw', parseName(toLines(null)), null);
eq('empty line arrays skipped', toLines({ lines: [[], null] }).length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
