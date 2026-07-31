/**
 * typhoon.js — read the footer band with Typhoon OCR, via the server proxy.
 *
 * PP-OCR reads this form confidently and still drops Thai marks: a real
 * capture returned the name line at 0.923 with the karan on วิสุทธิ์ arriving
 * as a stray "ส", and แพทย์ผู้สั่ง as แพทย์ผู้สัง. That is a limit of the model
 * rather than a threshold to tune, so the name is read by a model that handles
 * Thai diacritics — at the cost of the image leaving the device.
 */

/** Upstream recommends keeping the longest side at or under this. */
export const MAX_UPLOAD_PX = 1800;

/** JPEG rather than PNG: the band is a photograph, and size matters on 4G. */
export const UPLOAD_QUALITY = 0.9;

/**
 * The model is trained to answer with a JSON object carrying `natural_text`,
 * but it is still a language model and may return the text bare, or fenced.
 * Every shape ends up as plain text here rather than throwing.
 */
export function extractText(content) {
  if (typeof content !== 'string') return '';
  const trimmed = content.trim();

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;

  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      const parsed = JSON.parse(body);
      const found = Array.isArray(parsed)
        ? parsed.map((p) => p?.natural_text ?? p?.text ?? '').join('\n')
        : parsed?.natural_text ?? parsed?.text ?? null;
      if (typeof found === 'string' && found.trim()) return found.trim();
    } catch {
      // Not JSON after all; fall through and use it as text.
    }
  }
  return body;
}

/** Split a markdown-ish answer into the lines the parsers expect. */
export function toLinesFromText(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((raw) => raw
      // Strip table pipes and list/heading markers the model may add.
      .replace(/^\s*[|>#*-]+\s*/, '')
      .replace(/\s*\|\s*$/, '')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((t) => t.length > 0)
    .map((t) => ({ text: t, confidence: null, box: null }));
}

/** Shrink for upload, and flatten to JPEG. */
export function toUpload(canvas, maxPx = MAX_UPLOAD_PX, quality = UPLOAD_QUALITY) {
  const longest = Math.max(canvas.width, canvas.height);
  const scale = longest > maxPx ? maxPx / longest : 1;
  if (scale === 1) return canvas.toDataURL('image/jpeg', quality);

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', quality);
}

/**
 * @returns {Promise<{lines: Array, rawText: string}>}
 * @throws when the proxy is unconfigured or the call fails, so the caller can
 *   fall back rather than present an empty name as a clean read.
 */
export async function readBandRemote(band, { signal } = {}) {
  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: toUpload(band) }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const err = new Error(detail?.error ?? `http-${res.status}`);
    err.status = res.status;
    throw err;
  }

  const { content } = await res.json();
  const rawText = extractText(content);
  return { lines: toLinesFromText(rawText), rawText };
}
