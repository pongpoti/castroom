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

const THAI_TITLES = ['นางสาว', 'เด็กชาย', 'เด็กหญิง', 'นาย', 'นาง', 'ด.ช.', 'ด.ญ.'];

let servicePromise = null;

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
      .map((words) => ({
        text: words.map((w) => String(w?.text ?? '')).join(' ').replace(/\s+/g, ' ').trim(),
        confidence: words.reduce((a, w) => a + (w?.confidence ?? 0), 0) / words.length,
        box: unionBox(words.map((w) => w?.box)),
      }));
  }
  const flat = Array.isArray(raw?.results) ? raw.results : (Array.isArray(raw) ? raw : []);
  return flat.map((w) => ({
    text: String(w?.text ?? ''),
    confidence: w?.confidence ?? null,
    box: w?.box ?? null,
  }));
}

/**
 * Pick the name out of the recognised lines.
 * Matching is on the field label rather than line order, because a wrapped
 * row would shift every index.
 */
export function parseName(lines) {
  for (const line of lines) {
    if (/ชื่อ|สกุล/.test(line.text)) {
      const value = stripLabel(line.text);
      if (value.length >= 3) {
        return { name: value, confidence: line.confidence, box: line.box };
      }
    }
  }
  for (const line of lines) {
    const t = line.text.trim();
    if (THAI_TITLES.some((title) => t.startsWith(title))) {
      return { name: t, confidence: line.confidence, box: line.box };
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
 * @param {HTMLCanvasElement} band  straightened footer band, several lines tall
 * @returns {{name, confidence, box, lines, flags, needsReview}}
 */
export async function readName(band) {
  const service = await initOcr();
  const raw = await service.recognize(band);

  const lines = toLines(raw);

  const hit = parseName(lines);
  const printedHn = parseHn(lines);
  const check = validateName(hit?.name);
  const flags = [];
  if (!check.valid) flags.push(`ตรวจสอบชื่อ: ${check.reason}`);
  if (hit?.confidence != null && hit.confidence < 0.85) {
    flags.push('ความมั่นใจในการอ่านต่ำ — ตรวจกับภาพ');
  }

  return {
    name: hit?.name ?? '',
    confidence: hit?.confidence ?? null,
    box: hit?.box ?? null,
    printedHn,
    lines,
    flags,
    needsReview: flags.length > 0,
  };
}
