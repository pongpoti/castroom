import { toLines, parseName, parseHn, validateName, dropFloatingMarks } from '../src/lib/ocr.js';

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


// --- detached tone marks (the "ซี อ" failure) ---------------------------
// Real capture: นายวิสุทธิ์ สายแวว read as "นายวิสุทธิ ซี อ สายแวว". The karan
// on ธิ์ is detected as its own small box high above the baseline and read as
// two stray syllables, which line-ordering wedges between the real words.
const withMarks = { lines: [[
  {text:'ชื่อ-สกุลผู้ป่วย', box:b(10,100,180,60), confidence:0.93},
  {text:':',              box:b(196,100,8,60),   confidence:0.80},
  {text:'นายวิสุทธิ',      box:b(210,100,150,60), confidence:0.90},
  {text:'ซี',             box:b(330,88,16,18),   confidence:0.41},   // floating mark
  {text:'อ',              box:b(350,86,14,16),   confidence:0.38},   // floating mark
  {text:'สายแวว',         box:b(380,100,120,60), confidence:0.94},
]]};
eq('floating marks dropped from text',
   toLines(withMarks)[0].text, 'ชื่อ-สกุลผู้ป่วย : นายวิสุทธิ สายแวว');
eq('name is clean of stray syllables',
   parseName(toLines(withMarks))?.name, 'นายวิสุทธิ สายแวว');
eq('box still spans the marks so evidence is not clipped',
   toLines(withMarks)[0].box, b(10,86,490,74));

// Must not eat legitimate short words that sit on the baseline at full height.
const shortWords = [
  {text:'รวม', box:b(0,100,80,60), confidence:.9},
  {text:'0',   box:b(90,100,20,60), confidence:.9},   // short text, full height
  {text:'รายการ', box:b(120,100,120,60), confidence:.9},
];
eq('short baseline word kept',
   dropFloatingMarks(shortWords).map(w=>w.text), ['รวม','0','รายการ']);

// A tall-but-narrow word is not a mark.
const narrow = [
  {text:'ก', box:b(0,100,18,60), confidence:.9},
  {text:'ขคง', box:b(30,100,90,60), confidence:.9},
];
eq('narrow full-height word kept', dropFloatingMarks(narrow).map(w=>w.text), ['ก','ขคง']);

// A longer string high on the line is not a tone mark either.
const highWord = [
  {text:'สมุทรสาคร', box:b(0,80,200,60), confidence:.9},
  {text:'รพ.',       box:b(210,100,60,60), confidence:.9},
];
eq('multi-char high word kept', dropFloatingMarks(highWord).length, 2);

// Degenerate: everything looks like a fragment -> keep the raw reading.
const allTiny = [
  {text:'อ', box:b(0,0,10,10), confidence:.3},
  {text:'ซี', box:b(20,0,10,10), confidence:.3},
];
eq('never empties a line', dropFloatingMarks(allTiny).length, 2);
eq('missing boxes are left alone',
   dropFloatingMarks([{text:'ก'},{text:'ข'}]).length, 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
