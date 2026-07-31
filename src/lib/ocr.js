/**
 * ocr.js — read the patient name from a straightened footer band.
 *
 * The band is several lines tall rather than a single pre-cut line, so the
 * detection stage locates the text and the name is picked out by its printed
 * label. That way a few tenths of a unit of geometry error costs nothing,
 * where a tight crop would have missed the line entirely.
 *
 * HN arrives already decoded from the QR, which is error-corrected, so
 * recognition never has to produce it — only to confirm it against the digits
 * printed in the same band.
 */

import { readBandRemote } from './typhoon.js';

const THAI_TITLES = ['นางสาว', 'เด็กชาย', 'เด็กหญิง', 'นาย', 'นาง', 'ด.ช.', 'ด.ญ.'];

let servicePromise = null;

/**
 * Library defaults are used deliberately.
 *
 * An attempt to tune for Thai diacritics made things worse, and it is worth
 * recording why so it is not repeated:
 *
 * - `recognition.imageHeight: 64` was the main fault. PP-OCRv5 recognition is
 *   trained at 48px input height, so raising it puts every crop out of the
 *   distribution the model was fitted on and degrades all text, not just the
 *   marks it was meant to rescue.
 * - `detection.paddingVertical: 0.9` makes a crop 2.8x the height of its line.
 *   The rows in this band are closely spaced, so the crop swallows its
 *   neighbours and recognition reads several lines superimposed.
 * - `recognition.minimumConfidence: 0.6` then discarded the resulting garbage,
 *   which is why the failure showed up as no lines at all rather than as bad
 *   ones — the HN line disappeared alongside the name.
 *
 * The lesson is that these are not knobs to turn from first principles without
 * being able to run the model. Confidence per line is now reported in the
 * debug panel so any future change can be judged against real output.
 */

/**
 * Load the PP-OCRv5 Thai models once, then reuse them.
 *
 * The preset goes under `model`, which is the option the service actually
 * reads. Passing it as `recognitionModel` silently left the default English
 * model in place, so Thai was never being recognised at all. The preset also
 * carries a detection model, which is what lets a whole band be handed over
 * and the name line found by its label rather than by an exact crop.
 */
export function initOcr() {
  if (servicePromise) return servicePromise;
  servicePromise = (async () => {
    const { PaddleOcrService, V5_THAI_MOBILE_MODEL } = await import('ppu-paddle-ocr/web');
    const service = new PaddleOcrService({ model: V5_THAI_MOBILE_MODEL });
    await service.initialize();
    return service;
  })();
  return servicePromise;
}

/**
 * Drop a leading field label such as "ชื่อ-สกุลผู้ป่วย :".
 *
 * The colon is the usual separator, but recognition drops thin punctuation
 * often enough to be worth a second route: if there is no colon, start from
 * the title instead, since every name on this form carries one.
 */
function stripLabel(text) {
  const i = text.search(/[:：]/);
  if (i >= 0) return text.slice(i + 1).trim();

  let best = -1;
  for (const title of THAI_TITLES) {
    const at = text.indexOf(title);
    if (at > 0 && (best < 0 || at < best)) best = at;
  }
  return (best > 0 ? text.slice(best) : text).trim();
}

/** Smallest box covering every word on a line. */
function unionBox(boxes) {
  const valid = boxes.filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.width));
  if (!valid.length) return null;
  const x = Math.min(...valid.map((b) => b.x));
  const y = Math.min(...valid.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...valid.map((b) => b.x + b.width)) - x,
    height: Math.max(...valid.map((b) => b.y + b.height)) - y,
  };
}

/**
 * Drop detached tone marks that were detected as words in their own right.
 *
 * Thai stacks marks above the line, and detection sometimes gives one its own
 * small box. Recognition then reads that box as a syllable and the line
 * grouping sorts it into reading order, so วิสุทธิ์ สายแวว comes back as
 * "วิสุทธิ ซี อ สายแวว" — the karan arriving as two spurious words wedged
 * between the real ones.
 *
 * A fragment has to fail all three tests to be dropped: a box much shorter
 * than the line's own text, sitting clear of the baseline, carrying only a
 * character or two. A real short word sits on the baseline at full height, so
 * it survives.
 */
export function dropFloatingMarks(words) {
  const boxed = words.filter((w) => w?.box && Number.isFinite(w.box.height) && w.box.height > 0);
  if (boxed.length < 2) return words;

  const heights = boxed.map((w) => w.box.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const baseline = Math.max(...boxed.map((w) => w.box.y + w.box.height));

  const kept = words.filter((w, i) => {
    const b = w?.box;
    if (!b || !Number.isFinite(b.height)) return true;

    const text = String(w?.text ?? '').trim();
    // ณ is a real one-letter word and turns up in surnames such as
    // "ณ อยุธยา", so nothing here may discard a token on length alone.
    if (text.length > 2 || text === 'ณ') return true;

    const short = b.height < median * 0.55;
    const floating = b.y + b.height < baseline - median * 0.25;
    if (short && floating) return false;

    // Second signal, independent of height: a mark sits on top of the letter
    // it belongs to, so its box falls almost entirely within a neighbour's
    // horizontal span. Words are set side by side and only ever touch at the
    // edges, even after the detector pads them.
    const swallowed = [words[i - 1], words[i + 1]].some((n) => {
      const nb = n?.box;
      if (!nb || !Number.isFinite(nb.width) || !(b.width > 0)) return false;
      const overlap = Math.min(b.x + b.width, nb.x + nb.width) - Math.max(b.x, nb.x);
      return overlap > b.width * 0.8;
    });
    return !swallowed;
  });

  // Never let the filter empty a line: if every part looks like a fragment,
  // the assumption was wrong and the raw reading is better than nothing.
  return kept.length ? kept : words;
}

/**
 * Flatten a recognition result into one entry per printed line.
 *
 * `recognize` returns `lines` as RecognitionResult[][] — each line is the list
 * of words on it, not a line object. Treating an entry as a line yields
 * "[object Object]" and every label match fails, so the words are joined here.
 */
export function toLines(raw) {
  if (Array.isArray(raw?.lines)) {
    return raw.lines
      .filter((words) => Array.isArray(words) && words.length)
      .map((words) => {
        const kept = dropFloatingMarks(words);
        return {
          text: kept.map((w) => String(w?.text ?? '')).join(' ').replace(/\s+/g, ' ').trim(),
          confidence: kept.reduce((a, w) => a + (w?.confidence ?? 0), 0) / kept.length,
          // How many marks came off this line. They were misread rather than
          // absent, so the spelling underneath them is the part to check.
          dropped: words.length - kept.length,
          // The box still spans every part, marks included, so the evidence
          // strip shows the whole line rather than a clipped version of it.
          box: unionBox(words.map((w) => w?.box)),
        };
      });
  }
  const flat = Array.isArray(raw?.results) ? raw.results : (Array.isArray(raw) ? raw : []);
  return flat.map((w) => ({
    text: String(w?.text ?? ''),
    confidence: w?.confidence ?? null,
    box: w?.box ?? null,
  }));
}

/**
 * Remove stray single letters left in a name.
 *
 * Recognition turns a mark it cannot place into a letter of its own: the karan
 * on วิสุทธิ์ came back as a separate "ส", and the same run produced "d บ e" on
 * the line below. Whatever the detector's boxes looked like, a lone letter is
 * not a word in a Thai name, so the name value can be cleaned without knowing
 * anything about the geometry.
 *
 * Length is counted in code points, so a syllable carrying its own marks is
 * more than one character and stays. ณ is the one genuine single-letter word,
 * as in "ณ อยุธยา", and is always kept.
 */
export function dropStrayLetters(value) {
  const tokens = value.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => [...t].length > 1 || t === 'ณ');
  return {
    text: kept.join(' '),
    dropped: tokens.length - kept.length,
  };
}

/**
 * Pick the name out of the recognised lines.
 * Matching is on the field label rather than line order, because a wrapped
 * row would shift every index.
 */
export function parseName(lines) {
  for (const line of lines) {
    if (/ชื่อ|สกุล/.test(line.text)) {
      const cleaned = dropStrayLetters(stripLabel(line.text));
      if (cleaned.text.length >= 3) {
        return {
          name: cleaned.text, confidence: line.confidence, box: line.box,
          dropped: (line.dropped ?? 0) + cleaned.dropped,
        };
      }
    }
  }
  for (const line of lines) {
    const t = line.text.trim();
    if (THAI_TITLES.some((title) => t.startsWith(title))) {
      const cleaned = dropStrayLetters(t);
      return {
        name: cleaned.text, confidence: line.confidence, box: line.box,
        dropped: (line.dropped ?? 0) + cleaned.dropped,
      };
    }
  }
  return null;
}

/**
 * Read the HN printed as text beside the footer barcodes.
 *
 * This is the cross-check on a decoded HN. The footer's Code128 pair is the
 * obvious candidate, but its modules measure about 2.5px on a whole-page
 * photograph — under the 2–3px a decoder needs — so it does not read reliably.
 * The same number is printed in plain digits right next to it, and the band is
 * already being recognised, so verifying against that costs nothing.
 */
export function parseHn(lines) {
  for (const line of lines) {
    const m = /HN\s*[:：]?\s*(\d{4,})/i.exec(line.text.replace(/\s+/g, ' '));
    if (m) return m[1];
  }
  return null;
}

/** Shape checks that catch a clipped crop or dropped leading characters. */
export function validateName(name) {
  if (!name) return { valid: false, reason: 'ไม่พบชื่อ' };
  if (!/[\u0E00-\u0E7F]/.test(name)) return { valid: false, reason: 'ไม่พบอักษรไทย' };
  if (!THAI_TITLES.some((t) => name.startsWith(t))) {
    return { valid: false, reason: 'ไม่มีคำนำหน้าชื่อ' };
  }
  if (name.split(/\s+/).length < 2) return { valid: false, reason: 'ไม่พบนามสกุล' };
  return { valid: true, reason: null };
}

/**
 * Read the band, preferring Typhoon and falling back to the local model.
 *
 * Typhoon is the reason this reads Thai marks at all, but it needs the network
 * and a configured key. When it is unavailable the local model still produces
 * a usable name, so a failed call degrades rather than blocking the capture —
 * `backend` records which one answered.
 *
 * @param {HTMLCanvasElement} band  straightened footer band, several lines tall
 */
export async function readName(band) {
  let lines = [];
  let rawText = null;
  let backend = 'typhoon';
  let backendError = null;

  try {
    ({ lines, rawText } = await readBandRemote(band));
  } catch (e) {
    backendError = String(e?.message ?? e);
    backend = 'paddle';
    const service = await initOcr();
    const raw = await service.recognize(band);
    lines = toLines(raw);
    rawText = typeof raw?.text === 'string' ? raw.text : null;
  }

  const hit = parseName(lines);
  const printedHn = parseHn(lines);
  const check = validateName(hit?.name);
  const flags = [];
  if (!check.valid) flags.push(`ตรวจสอบชื่อ: ${check.reason}`);
  if (hit?.confidence != null && hit.confidence < 0.85) {
    flags.push('ความมั่นใจในการอ่านต่ำ — ตรวจกับภาพ');
  }
  if (hit?.dropped > 0) {
    flags.push('มีวรรณยุกต์หรือการันต์ที่อ่านไม่ออกและถูกตัดทิ้ง — ตรวจการสะกดกับภาพ');
  }
  if (backend === 'paddle') {
    flags.push('อ่านชื่อด้วยโมเดลในเครื่อง (ต่อ Typhoon ไม่ได้) — วรรณยุกต์อาจตกหล่น');
  }

  return {
    name: hit?.name ?? '',
    confidence: hit?.confidence ?? null,
    box: hit?.box ?? null,
    droppedMarks: hit?.dropped ?? 0,
    backend,
    backendError,
    rawText,
    printedHn,
    lines,
    flags,
    needsReview: flags.length > 0,
  };
}
