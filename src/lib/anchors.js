/**
 * anchors.js — read the three symbols in a HosXP footer box and turn them
 * into a coordinate frame.
 *
 * The footer carries a QN barcode, an HN barcode and a QR code. Together
 * they give origin, scale and rotation, so no page detection, A4 template
 * or full-page capture is needed — framing the bordered box is enough.
 *
 * Constants measured against a 3024x4032 reference capture:
 *   u = HN barcode height
 *   u = 0.373  x QR side length                     (primary scale)
 *   u = 0.2218 x QN-to-HN left-edge span            (fallback scale)
 */

import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  HybridBinarizer,
  BinaryBitmap,
  HTMLCanvasElementLuminanceSource,
  Result,
  ResultPoint,
} from '@zxing/library';

/**
 * @zxing/library never exports its internal GenericMultipleBarcodeReader,
 * so this ports the same crop-and-recurse algorithm: decode once, then
 * recurse into the four regions around the found symbol's bounding box
 * until no new symbol turns up.
 */
const MAX_MULTIPLE_BARCODES = 10;
const MIN_DIMENSION_TO_RECUR = 100;

class GenericMultipleBarcodeReader {
  constructor(delegate) {
    this.delegate = delegate;
  }

  decodeMultiple(image) {
    const results = [];
    this.doDecodeMultiple(image, results, 0, 0, 0);
    return results;
  }

  doDecodeMultiple(image, results, xOffset, yOffset, currentDepth) {
    if (currentDepth > MAX_MULTIPLE_BARCODES) return;
    let result;
    try {
      result = this.delegate.decode(image);
    } catch {
      return;
    }
    const alreadyFound = results.some((r) => r.getText() === result.getText());
    if (!alreadyFound) results.push(translateResultPoints(result, xOffset, yOffset));

    const points = result.getResultPoints();
    if (!points || points.length === 0) return;

    const width = image.getWidth();
    const height = image.getHeight();
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (const p of points) {
      if (!p) continue;
      const x = p.getX(), y = p.getY();
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    if (minX > MIN_DIMENSION_TO_RECUR) {
      this.doDecodeMultiple(
        image.crop(0, 0, Math.floor(minX), height),
        results, xOffset, yOffset, currentDepth + 1,
      );
    }
    if (minY > MIN_DIMENSION_TO_RECUR) {
      this.doDecodeMultiple(
        image.crop(0, 0, width, Math.floor(minY)),
        results, xOffset, yOffset, currentDepth + 1,
      );
    }
    if (maxX < width - MIN_DIMENSION_TO_RECUR) {
      this.doDecodeMultiple(
        image.crop(Math.floor(maxX), 0, width - Math.floor(maxX), height),
        results, xOffset + Math.floor(maxX), yOffset, currentDepth + 1,
      );
    }
    if (maxY < height - MIN_DIMENSION_TO_RECUR) {
      this.doDecodeMultiple(
        image.crop(0, Math.floor(maxY), width, height - Math.floor(maxY)),
        results, xOffset, yOffset + Math.floor(maxY), currentDepth + 1,
      );
    }
  }
}

function translateResultPoints(result, xOffset, yOffset) {
  const oldPoints = result.getResultPoints();
  if (!oldPoints) return result;
  const newPoints = oldPoints.map((p) => (p ? new ResultPoint(p.getX() + xOffset, p.getY() + yOffset) : p));
  const newResult = new Result(
    result.getText(), result.getRawBytes(), result.getNumBits(),
    newPoints, result.getBarcodeFormat(), result.getTimestamp(),
  );
  newResult.putAllMetadata(result.getResultMetadata());
  return newResult;
}

export const U_PER_QR = 0.373;
export const U_PER_BARCODE_SPAN = 0.2218;
export const MIN_QR_PX = 60;

/** Rotations tried in order when the first decode pass comes up short. */
const RETRY_ANGLES = [0, -12, 12, -25, 25, -40, 40, 90, -90];

function buildReader() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.QR_CODE,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return new GenericMultipleBarcodeReader(reader);
}

/** Rotate a canvas by `deg`, growing the output so nothing is clipped. */
export function rotateCanvas(source, deg) {
  if (!deg) return source;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = source.width;
  const h = source.height;
  const out = document.createElement('canvas');
  out.width = Math.round(w * cos + h * sin);
  out.height = Math.round(w * sin + h * cos);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -w / 2, -h / 2);
  return out;
}

function decodeOnce(canvas) {
  const source = new HTMLCanvasElementLuminanceSource(canvas);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  try {
    return buildReader().decodeMultiple(bitmap) ?? [];
  } catch {
    return [];
  }
}

function pointStats(points) {
  const xs = points.map((p) => p.getX());
  const ys = points.map((p) => p.getY());
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cy: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/** Sort raw decode results into the roles the footer defines. */
function classify(results) {
  const out = { qr: null, footer: [], header: null };
  for (const r of results) {
    const text = r.getText();
    const pts = r.getResultPoints?.() ?? [];
    if (!pts.length) continue;
    const s = pointStats(pts);
    const entry = { text, stats: s, points: pts };

    if (r.getBarcodeFormat() === BarcodeFormat.QR_CODE) {
      out.qr = entry;
    } else if (/^\d+$/.test(text)) {
      out.footer.push(entry);
    } else {
      out.header = entry;               // long delimited header payload
    }
  }
  out.footer.sort((a, b) => a.stats.minX - b.stats.minX);
  return out;
}

function summarizeAttempt(angle, results, sym) {
  return {
    angle,
    decoded: results.map((r) => ({
      format: BarcodeFormat[r.getBarcodeFormat()] ?? String(r.getBarcodeFormat()),
      text: r.getText(),
    })),
    qr: !!sym.qr,
    footerCount: sym.footer.length,
    header: !!sym.header,
  };
}

/** Decode with a rotation sweep; returns the canvas that actually worked. */
export function readSymbols(canvas) {
  const attempts = [];
  for (const angle of RETRY_ANGLES) {
    const probe = rotateCanvas(canvas, angle);
    const results = decodeOnce(probe);
    const sym = classify(results);
    attempts.push(summarizeAttempt(angle, results, sym));
    if (sym.qr && sym.footer.length >= 2) {
      return { symbols: sym, canvas: probe, retryAngle: angle, attempts };
    }
  }
  const results = decodeOnce(canvas);
  const sym = classify(results);
  attempts.push(summarizeAttempt(0, results, sym));
  return { symbols: sym, canvas, retryAngle: 0, attempts };
}

/**
 * Resolve HN, cross-validating every source that carries it.
 *
 * A lone unidentified footer barcode is never accepted: the footer holds a
 * QN barcode too, and with one symbol decoded there is no way to tell them
 * apart. Returning a queue number as an HN would attach the record to the
 * wrong patient.
 */
export function resolveHn(sym) {
  const sources = {};

  if (sym.qr) {
    const tail = sym.qr.text.replace(/\/+$/, '').split('/').pop();
    if (/^\d+$/.test(tail)) sources.qr = tail;
  }
  if (sym.header) {
    const head = sym.header.text.split('%')[0];
    if (/^\d+$/.test(head)) sources.header = head;
  }

  const known = new Set(Object.values(sources));
  if (sym.footer.length >= 2) {
    const rightmost = sym.footer[sym.footer.length - 1].text;
    const leftmost = sym.footer[0].text;
    if (known.size && !known.has(rightmost) && known.has(leftmost)) {
      return { hn: null, sources: Object.keys(sources), error: 'image-upside-down' };
    }
    sources.footer = rightmost;
  } else if (sym.footer.length === 1 && known.size) {
    const lone = sym.footer[0].text;
    if (known.has(lone)) sources.footer = lone;
  }

  const values = new Set(Object.values(sources));
  if (!values.size) {
    return { hn: null, sources: [], error: 'no-identifiable-hn' };
  }
  if (values.size > 1) {
    return { hn: null, sources: Object.keys(sources), error: 'sources-disagree' };
  }
  return { hn: [...values][0], sources: Object.keys(sources), error: null };
}

/**
 * Build the coordinate frame.
 * @returns {{originX, originY, u, angleDeg}|null}
 */
export function frameFromSymbols(sym) {
  if (sym.footer.length < 2) return null;

  let u = null;
  if (sym.qr) {
    const { minX, maxX, minY, maxY } = sym.qr.stats;
    const side = ((maxX - minX) + (maxY - minY)) / 2;
    if (side >= MIN_QR_PX) u = U_PER_QR * side;
  }
  if (u === null) {
    const a = sym.footer[0].stats;
    const b = sym.footer[sym.footer.length - 1].stats;
    const span = Math.hypot(b.minX - a.minX, b.minY - a.minY);
    if (span < 120) return null;
    u = U_PER_BARCODE_SPAN * span;
  }

  const hn = sym.footer[sym.footer.length - 1].stats;
  const p0 = sym.footer[0].stats;
  const p1 = sym.qr ? sym.qr.stats : hn;
  const angleDeg = (Math.atan2(p1.cy - p0.cy, p1.cx - p0.cx) * 180) / Math.PI;

  return { originX: hn.cx, originY: hn.cy, u, angleDeg };
}
