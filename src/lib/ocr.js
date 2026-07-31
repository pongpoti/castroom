/**
 * ocr.js — recognise the patient name from a preprocessed name-line crop.
 *
 * HN is not read here. It arrives already decoded from the barcodes, where
 * it is exact and cross-validated, so text recognition only ever has to
 * handle the one field that has no machine-readable source.
 */

const THAI_TITLES = ['นางสาว', 'เด็กชาย', 'เด็กหญิง', 'นาย', 'นาง', 'ด.ช.', 'ด.ญ.'];

let servicePromise = null;

/** Load the PP-OCRv5 Thai recognition model once, then reuse it. */
export function initOcr() {
  if (servicePromise) return servicePromise;
  servicePromise = (async () => {
    const { PaddleOcrService, V5_THAI_MOBILE_MODEL } = await import('ppu-paddle-ocr/web');
    const service = new PaddleOcrService({ recognitionModel: V5_THAI_MOBILE_MODEL });
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
      if (value.length >= 3) return { name: value, confidence: line.confidence };
    }
  }
  for (const line of lines) {
    const t = line.text.trim();
    if (THAI_TITLES.some((title) => t.startsWith(title))) {
      return { name: t, confidence: line.confidence };
    }
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
 * @param {HTMLCanvasElement} nameCanvas  enhanced name-line crop
 * @returns {{name, confidence, lines, flags, needsReview}}
 */
export async function readName(nameCanvas) {
  const service = await initOcr();
  const raw = await service.recognize(nameCanvas);

  const lines = (raw?.lines ?? []).map((l) => ({
    text: String(l.text ?? l),
    confidence: l.score ?? l.confidence ?? null,
  }));

  const hit = parseName(lines);
  const check = validateName(hit?.name);
  const flags = [];
  if (!check.valid) flags.push(`ตรวจสอบชื่อ: ${check.reason}`);
  if (hit?.confidence != null && hit.confidence < 0.85) {
    flags.push('ความมั่นใจในการอ่านต่ำ — ตรวจกับภาพ');
  }

  return {
    name: hit?.name ?? '',
    confidence: hit?.confidence ?? null,
    lines,
    flags,
    needsReview: flags.length > 0,
  };
}
