import { toLines, parseName, parseHn, validateName, dropFloatingMarks, dropStrayLetters } from '../src/lib/ocr.js';

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


// --- marks that keep full height but sit inside their letter --------------
// Second observed reading: "นายวิสุทธิ ส สายแวว". The stray ส was not short
// enough for the height test, but its box falls inside the preceding word's
// span, which a separate word never does.
const swallowed = { lines: [[
  {text:'ชื่อ-สกุลผู้ป่วย', box:b(10,100,180,60), confidence:0.93},
  {text:':',              box:b(196,100,8,60),   confidence:0.80},
  {text:'นายวิสุทธิ',      box:b(210,100,150,60), confidence:0.90},
  {text:'ส',              box:b(300,96,20,58),   confidence:0.55},  // inside the word above
  {text:'สายแวว',         box:b(380,100,120,60), confidence:0.94},
]]};
eq('mark inside its letter dropped',
   parseName(toLines(swallowed))?.name, 'นายวิสุทธิ สายแวว');
eq('drop is reported for the flag', toLines(swallowed)[0].dropped, 1);

// ณ is a real one-letter word in Thai surnames and must never be eaten.
const naAyutthaya = [
  {text:'นายสมชาย', box:b(0,100,160,60), confidence:.95},
  {text:'ณ',        box:b(180,100,30,60), confidence:.9},
  {text:'อยุธยา',    box:b(220,100,110,60), confidence:.95},
];
eq('ณ between words kept', dropFloatingMarks(naAyutthaya).map(w=>w.text),
   ['นายสมชาย','ณ','อยุธยา']);
// Even squeezed against a neighbour, ณ survives on the name exemption.
const naTight = [
  {text:'นายสมชาย', box:b(0,100,160,60), confidence:.95},
  {text:'ณ',        box:b(100,96,30,58), confidence:.9},
  {text:'อยุธยา',    box:b(220,100,110,60), confidence:.95},
];
eq('ณ kept even when overlapping', dropFloatingMarks(naTight).length, 3);

// Detector padding makes neighbours touch; that is not containment.
const padded = [
  {text:'รพ.',       box:b(0,100,70,60),   confidence:.9},
  {text:'ก',         box:b(60,100,40,60),  confidence:.9},   // 25% edge overlap only
  {text:'สมุทรสาคร', box:b(105,100,200,60), confidence:.9},
];
eq('edge overlap from padding is not a mark',
   dropFloatingMarks(padded).map(w=>w.text), ['รพ.','ก','สมุทรสาคร']);


// --- stray single letters, from a real debug dump -------------------------
// Recognition reported the name line at conf 0.923 as one string, with the
// karan on วิสุทธิ์ arriving as a separate "ส". No box test can reach it here
// because the whole line came back already joined.
const real = { lines: [
  [{text:'ห้องตรวจ :1', box:b(0,0,200,50), confidence:0.98}],
  [{text:'QN :3430 HN : 1636405', box:b(0,60,400,50), confidence:0.986}],
  [{text:'ชื่อ-สกุลผู้ป่วย : นายวิสุทธิ ส สายแวว', box:b(0,120,600,50), confidence:0.923}],
  [{text:'สิทธิการรักษา : ประกันสังคมเลือก รพ.สมุทรสาคร', box:b(0,180,700,50), confidence:0.972}],
  [{text:'1', box:b(0,240,20,50), confidence:0.501}],
]};
eq('stray letter removed from the real reading',
   parseName(toLines(real))?.name, 'นายวิสุทธิ สายแวว');
eq('the removal is counted so the flag fires',
   parseName(toLines(real))?.dropped, 1);
eq('printed HN still read from the same dump', parseHn(toLines(real)), '1636405');

// The rule itself.
eq('single letter dropped', dropStrayLetters('นายวิสุทธิ ส สายแวว').text, 'นายวิสุทธิ สายแวว');
eq('latin fragments dropped', dropStrayLetters('กิตติ d บ e').text, 'กิตติ');
eq('ณ survives', dropStrayLetters('นายสมชาย ณ อยุธยา').text, 'นายสมชาย ณ อยุธยา');
eq('ณ survives and nothing counted', dropStrayLetters('นายสมชาย ณ อยุธยา').dropped, 0);
// A syllable carrying its own marks is more than one code point and stays.
eq('marked syllable is not a single letter', dropStrayLetters('นาย ธิ์ สาย').text, 'นาย ธิ์ สาย');
eq('clean name untouched', dropStrayLetters('นายวิสุทธิ์ สายแวว').text, 'นายวิสุทธิ์ สายแวว');
eq('nothing to do reports zero', dropStrayLetters('นายวิสุทธิ์ สายแวว').dropped, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
