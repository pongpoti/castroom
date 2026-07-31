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

/** Drop a leading field label such as "ชื่อ-สกุลผู้ป่วย :". */
function stripLabel(text) {
  const i = text.indexOf(':');
  return (i >= 0 ? text.slice(i + 1) : text).trim();
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

/** Normalise the various box shapes the detector may hand back. */
function toBox(l) {
  const b = l.box ?? l.bbox ?? l.boundingBox ?? l.points ?? null;
  if (!b) return null;
  if (Array.isArray(b) && b.length && Array.isArray(b[0])) {
    const xs = b.map((p) => p[0]);
    const ys = b.map((p) => p[1]);
    return {
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
  if (typeof b === 'object' && 'x' in b && 'width' in b) return b;
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

  const rawLines = raw?.lines ?? raw?.results ?? (Array.isArray(raw) ? raw : []);
  const lines = rawLines.map((l) => ({
    text: String(l.text ?? l),
    confidence: l.score ?? l.confidence ?? null,
    box: toBox(l),
  }));

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
