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
 * @zxing/library never exports its internal GenericMultipleBarcodeReader, so
 * this reimplements the same crop-and-recurse idea: decode once, then recurse
 * into the four regions around the found symbol's bounding box until no new
 * symbol turns up.
 *
 * The recursion crops *canvases* rather than BinaryBitmaps on purpose.
 * BinaryBitmap.crop() delegates to the luminance source, and zxing's
 * HTMLCanvasElementLuminanceSource.crop() calls the base implementation, which
 * unconditionally throws UnsupportedOperationException — so the bitmap-level
 * recursion the upstream reader uses cannot work with a canvas source at all.
 */
const MAX_RECUR_DEPTH = 4;
const MIN_DIMENSION_TO_RECUR = 100;
const MIN_DECODABLE_PX = 40;

function cropCanvas(source, x, y, w, h) {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
  return out;
}

class MultiSymbolReader {
  constructor(delegate, hints) {
    this.delegate = delegate;
    this.hints = hints;
  }

  /**
   * @param {(results: Result[]) => boolean} [isEnough] stops the search as soon
   *   as the caller has what it needs, so a frame that decodes early does not
   *   pay for the remaining branches.
   */
  decodeCanvas(canvas, isEnough) {
    const results = [];
    this.isEnough = isEnough ?? (() => false);
    this.recurse(canvas, results, 0, 0, 0);
    return results;
  }

  decodeOne(canvas) {
    const source = new HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new BinaryBitmap(new HybridBinarizer(source));
    // Hints must be passed on every call: MultiFormatReader.decode(image)
    // with no hints argument resets its reader set, losing both
    // POSSIBLE_FORMATS and TRY_HARDER.
    return this.delegate.decode(bitmap, this.hints);
  }

  recurse(canvas, results, xOffset, yOffset, depth) {
    if (depth > MAX_RECUR_DEPTH) return;
    if (canvas.width < MIN_DECODABLE_PX || canvas.height < MIN_DECODABLE_PX) return;
    if (this.isEnough(results)) return;

    let result;
    try {
      result = this.decodeOne(canvas);
    } catch {
      return;
    }

    if (!results.some((r) => r.getText() === result.getText())) {
      results.push(translateResultPoints(result, xOffset, yOffset));
    }

    const points = result.getResultPoints();
    if (!points || points.length === 0) return;

    const width = canvas.width;
    const height = canvas.height;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (const p of points) {
      if (!p) continue;
      const x = p.getX(), y = p.getY();
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    minX = Math.max(0, Math.floor(minX));
    minY = Math.max(0, Math.floor(minY));
    maxX = Math.min(width, Math.ceil(maxX));
    maxY = Math.min(height, Math.ceil(maxY));

    if (minX > MIN_DIMENSION_TO_RECUR) {
      this.recurse(cropCanvas(canvas, 0, 0, minX, height),
        results, xOffset, yOffset, depth + 1);
    }
    if (minY > MIN_DIMENSION_TO_RECUR) {
      this.recurse(cropCanvas(canvas, 0, 0, width, minY),
        results, xOffset, yOffset, depth + 1);
    }
    if (maxX < width - MIN_DIMENSION_TO_RECUR) {
      this.recurse(cropCanvas(canvas, maxX, 0, width - maxX, height),
        results, xOffset + maxX, yOffset, depth + 1);
    }
    if (maxY < height - MIN_DIMENSION_TO_RECUR) {
      this.recurse(cropCanvas(canvas, 0, maxY, width, height - maxY),
        results, xOffset, yOffset + maxY, depth + 1);
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

/**
 * Rotations tried in order when the first decode pass comes up short.
 *
 * Cardinal turns come before the small skews: a QR decodes at almost any
 * angle, but a Code128 only reads when its bars are roughly perpendicular to
 * the scan lines, so the orientation that yields the two footer barcodes is
 * nearly always a quarter turn rather than a few degrees of skew. Trying the
 * skews first meant paying for a full recursive search at every one of them
 * before reaching the angle that actually works.
 */
const RETRY_ANGLES = [0, 90, -90, -12, 12, -25, 25, -40, 40];

function buildReader() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.QR_CODE,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return new MultiSymbolReader(reader, hints);
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

/** A QR plus both footer barcodes is everything the frame needs. */
function enoughForFrame(results) {
  let qr = 0;
  let footer = 0;
  for (const r of results) {
    if (r.getBarcodeFormat() === BarcodeFormat.QR_CODE) qr++;
    else if (/^\d+$/.test(r.getText())) footer++;
  }
  return qr >= 1 && footer >= 2;
}

function decodeOnce(canvas) {
  try {
    return buildReader().decodeCanvas(canvas, enoughForFrame) ?? [];
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

function summarizeAttempt(angle, results, sym, ms) {
  return {
    angle,
    ms,
    decoded: results.map((r) => ({
      format: BarcodeFormat[r.getBarcodeFormat()] ?? String(r.getBarcodeFormat()),
      text: r.getText(),
    })),
    qr: !!sym.qr,
    footerCount: sym.footer.length,
    header: !!sym.header,
  };
}

/** How much of the frame a decode pass recovered, for picking a fallback. */
function symbolScore(sym) {
  return (sym.qr ? 1 : 0) + sym.footer.length + (sym.header ? 1 : 0);
}

/** Decode with a rotation sweep; returns the canvas that actually worked. */
export function readSymbols(canvas) {
  const attempts = [];
  let best = null;

  for (const angle of RETRY_ANGLES) {
    const probe = rotateCanvas(canvas, angle);
    const started = Date.now();
    const results = decodeOnce(probe);
    const sym = classify(results);
    attempts.push(summarizeAttempt(angle, results, sym, Date.now() - started));

    if (sym.qr && sym.footer.length >= 2) {
      return { symbols: sym, canvas: probe, retryAngle: angle, attempts };
    }
    if (!best || symbolScore(sym) > symbolScore(best.symbols)) {
      best = { symbols: sym, canvas: probe, retryAngle: angle };
    }
  }

  // No angle gave a full frame. Return the richest pass rather than re-running
  // angle 0, which the sweep already tried as its first attempt.
  return { ...best, attempts };
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
  if (known.size) {
    // Pick the footer barcode by value rather than by position. Which barcode
    // sits "right" of the other depends on how the capture is rotated, and the
    // footer reads vertically on a quarter-turned photo, so ordering by x is
    // meaningless there. Matching against a value the QR or header already
    // established keeps the safety rule intact: an unidentified barcode is
    // still never promoted to HN on its own.
    const match = sym.footer.find((f) => known.has(f.text));
    if (match) sources.footer = match.text;
  } else if (sym.footer.length >= 2) {
    // Nothing independent to check against, so fall back to the printed
    // convention that the HN barcode is the far one from the QN.
    sources.footer = sym.footer[sym.footer.length - 1].text;
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
 *
 * `hnText` names which footer barcode is the HN. Without it the origin would
 * have to be guessed from position, which only holds while the footer reads
 * left-to-right — on a quarter-turned capture it silently anchors the frame to
 * the QN barcode instead and the name window lands on blank paper.
 *
 * @returns {{originX, originY, u, angleDeg}|null}
 */
export function frameFromSymbols(sym, hnText) {
  if (sym.footer.length < 2) return null;

  const hnIndex = hnText == null
    ? sym.footer.length - 1
    : sym.footer.findIndex((f) => f.text === hnText);
  if (hnIndex < 0) return null;
  const qnIndex = hnIndex === 0 ? sym.footer.length - 1 : 0;

  let uQr = null;
  if (sym.qr) {
    const { minX, maxX, minY, maxY } = sym.qr.stats;
    const side = ((maxX - minX) + (maxY - minY)) / 2;
    if (side >= MIN_QR_PX) uQr = U_PER_QR * side;
  }

  let uSpan = null;
  {
    const a = sym.footer[qnIndex].stats;
    const b = sym.footer[hnIndex].stats;
    const span = Math.hypot(b.minX - a.minX, b.minY - a.minY);
    if (span >= 120) uSpan = U_PER_BARCODE_SPAN * span;
  }

  const u = uQr ?? uSpan;
  if (u === null) return null;

  const hn = sym.footer[hnIndex].stats;
  const p0 = sym.footer[qnIndex].stats;
  const p1 = sym.qr ? sym.qr.stats : hn;
  const angleDeg = (Math.atan2(p1.cy - p0.cy, p1.cx - p0.cx) * 180) / Math.PI;

  // The two scale estimates are independent: one comes from the QR's side
  // length, the other from the span between the footer barcodes. On a genuine
  // footer they agree closely, so a wide disagreement means the anchors used
  // here are not the pair the constants were measured against.
  const scaleRatio = uQr !== null && uSpan !== null
    ? Math.max(uQr / uSpan, uSpan / uQr)
    : null;

  return { originX: hn.cx, originY: hn.cy, u, angleDeg, uQr, uSpan, scaleRatio };
}
