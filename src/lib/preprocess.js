/**
 * preprocess.js — cut the name line out of a HosXP footer box.
 *
 * Everything here is plain canvas work. The barcode anchors supply the
 * geometry, so there is no page detection or template warp to do, and no
 * OpenCV build to ship.
 */

import { readSymbols, resolveHn, frameFromSymbols, rotateCanvas } from './anchors';

/** Name-line window, in units of u, relative to the HN barcode centre. */
export const NAME_X = [-7.0, 7.0];
export const NAME_Y = [1.4, 3.1];

/** Below roughly this width the symbols stop decoding. */
export const MIN_FOOTER_WIDTH = 1500;

const TARGET_LINE_HEIGHT = 96;

function toCanvas(source) {
  if (source instanceof HTMLCanvasElement) return source;
  const c = document.createElement('canvas');
  c.width = source.width ?? source.naturalWidth;
  c.height = source.height ?? source.naturalHeight;
  c.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0);
  return c;
}

/** Separable box blur — a cheap stand-in for the median blur used to
 *  estimate background illumination. */
function boxBlur(data, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const span = radius * 2 + 1;
  const clamp = (v, max) => Math.min(max - 1, Math.max(0, v));

  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += data[y * w + clamp(x, w)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / span;
      acc += data[y * w + clamp(x + radius + 1, w)] - data[y * w + clamp(x - radius, w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[clamp(y, h) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / span;
      acc += tmp[clamp(y + radius + 1, h) * w + x] - tmp[clamp(y - radius, h) * w + x];
    }
  }
  return out;
}

/**
 * Flatten uneven lighting and stretch contrast.
 * Dividing by a blurred copy removes the shading gradient a phone camera
 * leaves across a sheet, which matters more here than any sharpening would.
 */
export function enhance(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    gray[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }

  const bg = boxBlur(gray, w, h, Math.max(4, Math.round(h / 3)));

  let lo = 255;
  let hi = 0;
  const flat = new Float32Array(w * h);
  for (let p = 0; p < gray.length; p++) {
    const v = bg[p] > 1 ? (gray[p] / bg[p]) * 255 : gray[p];
    flat[p] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = Math.max(1, hi - lo);

  for (let p = 0, i = 0; p < flat.length; p++, i += 4) {
    const v = Math.max(0, Math.min(255, ((flat[p] - lo) / range) * 255));
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // upscale short lines — recognition is markedly better above ~64px tall
  const scale = Math.max(1, TARGET_LINE_HEIGHT / h);
  if (scale === 1) return canvas;
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/**
 * How far apart the two independent scale estimates may drift before the frame
 * is treated as untrustworthy. On the reference capture they agree to within
 * 0.3%; a factor of 1.5 leaves room for point-estimation noise while still
 * catching a frame built from anchors that are not the footer pair.
 */
export const MAX_SCALE_DISAGREEMENT = 1.5;

/** Rotate about the frame origin, then cut the window in barcode units. */
function cropName(canvas, frame) {
  const { originX, originY, u, angleDeg } = frame;
  const rad = (-angleDeg * Math.PI) / 180;

  const x0 = NAME_X[0] * u;
  const y0 = NAME_Y[0] * u;
  const w = (NAME_X[1] - NAME_X[0]) * u;
  const h = (NAME_Y[1] - NAME_Y[0]) * u;

  const out = document.createElement('canvas');
  out.width = Math.round(w);
  out.height = Math.round(h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);

  ctx.translate(-x0, -y0);
  ctx.rotate(rad);
  ctx.translate(-originX, -originY);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/**
 * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} source
 * @returns {{ok, error, hn, hnSources, warnings, nameCanvas, frame}}
 */
export function preprocess(source) {
  const warnings = [];
  const canvas = toCanvas(source);

  if (canvas.width < MIN_FOOTER_WIDTH) {
    warnings.push(
      `ภาพกว้าง ${canvas.width}px — ต่ำกว่าประมาณ ${MIN_FOOTER_WIDTH}px ` +
      `บาร์โค้ดจะอ่านไม่ออก ถ่ายให้ใกล้ขึ้นหรือปิดการย่อภาพ`
    );
  }

  let { symbols, canvas: working, attempts } = readSymbols(canvas);
  let { hn, sources, error } = resolveHn(symbols);

  if (error === 'image-upside-down') {
    working = rotateCanvas(working, 180);
    const retried = readSymbols(working);
    symbols = retried.symbols;
    attempts = attempts.concat(retried.attempts);
    ({ hn, sources, error } = resolveHn(symbols));
  }

  const frame = frameFromSymbols(symbols, hn);
  const debug = { width: canvas.width, height: canvas.height, attempts };

  if (!hn) {
    return {
      ok: false,
      error: error ?? 'no-identifiable-hn',
      hn: null,
      hnSources: sources,
      warnings,
      nameCanvas: null,
      frame: null,
      debug,
    };
  }

  // A usable frame is what the name crop needs, not what the record needs. HN
  // is decoded and cross-validated, so once it is settled the capture is worth
  // keeping even if the anchors were too scattered to place the name window —
  // the operator types the name instead of reshooting a good HN.
  const unreliableFrame = frame !== null
    && frame.scaleRatio !== null
    && frame.scaleRatio > MAX_SCALE_DISAGREEMENT;

  if (frame === null || unreliableFrame) {
    warnings.push(
      'วางกรอบชื่อไม่ได้จากภาพนี้ — HN ยืนยันแล้วและใช้ได้ แต่ต้องพิมพ์ชื่อเอง'
    );
  }
  debug.scaleRatio = frame?.scaleRatio == null ? null : Number(frame.scaleRatio.toFixed(2));
  debug.frameUsable = frame !== null && !unreliableFrame;

  return {
    ok: true,
    error: null,
    hn,
    hnSources: sources,
    warnings,
    nameCanvas: debug.frameUsable ? enhance(cropName(working, frame)) : null,
    frame,
    debug,
  };
}
