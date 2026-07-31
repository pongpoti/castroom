/**
 * preprocess.js — turn a photograph of the record into an HN and a
 * straightened footer band for recognition.
 *
 * The QR supplies the whole coordinate frame, so there is no page detection,
 * no template warp, no rotation search and no dependency on the footer's
 * Code128 pair. Skew is measured from the QR's own axes and removed by the
 * crop itself.
 */

import { readQrPose, cropPoseRegion, MIN_UNIT_PX } from './anchors';

/**
 * The footer band, in units of the QR's finder span, relative to its top-left
 * finder pattern. Measured against two independent captures, where the name
 * line landed at x -13.3..-10.1 and y 0.68..1.04; the window is widened from
 * there so that recognition, not the geometry, decides where the line is.
 */
export const FOOTER_X = [-15.2, -7.6];
export const FOOTER_Y = [-0.7, 1.8];

/** The band is recognised at this multiple of capture resolution. */
export const BAND_SCALE = 3;

/**
 * Beyond this the capture is angled enough that the pose, extrapolated across
 * the ~13 units between the QR and the name, stops being trustworthy.
 */
export const MAX_SKEW = 1.12;

function toCanvas(source) {
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    return source;
  }
  const c = document.createElement('canvas');
  c.width = source.width ?? source.naturalWidth;
  c.height = source.height ?? source.naturalHeight;
  c.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0);
  return c;
}

/** Separable box blur — a cheap stand-in for a median blur. */
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
 * Flatten uneven lighting and stretch contrast. Dividing by a blurred copy
 * removes the shading gradient a phone camera leaves across a sheet, which
 * matters more here than any sharpening would.
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

  const bg = boxBlur(gray, w, h, Math.max(8, Math.round(h / 4)));

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
  return canvas;
}

/** Cut a sub-rectangle, used to show the recognised line as evidence. */
export function cropBox(canvas, box, pad = 6) {
  const x = Math.max(0, Math.round(box.x - pad));
  const y = Math.max(0, Math.round(box.y - pad));
  const w = Math.min(canvas.width - x, Math.round(box.width + pad * 2));
  const h = Math.min(canvas.height - y, Math.round(box.height + pad * 2));
  if (w <= 0 || h <= 0) return null;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d', { willReadFrequently: true })
    .drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

/**
 * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} source
 * @returns {{ok, error, hn, hnSources, warnings, band, pose, debug}}
 */
export function preprocess(source) {
  const warnings = [];
  const canvas = toCanvas(source);
  const started = Date.now();

  const qr = readQrPose(canvas);
  const debug = {
    width: canvas.width,
    height: canvas.height,
    qrAttempts: qr.attempts,
    angleTried: qr.angleTried,
  };

  if (!qr.pose) {
    return {
      ok: false, error: 'no-qr', hn: null, hnSources: [],
      warnings, band: null, pose: null, debug,
    };
  }

  const { pose } = qr;
  debug.unit = Math.round(pose.unit);
  debug.rotationDeg = Number(pose.rotationDeg.toFixed(2));
  debug.squareness = Number(pose.squareness.toFixed(3));

  const hn = qr.hn;
  if (!hn) {
    return {
      ok: false, error: 'no-identifiable-hn', hn: null, hnSources: [],
      warnings, band: null, pose, debug,
    };
  }
  const hnSources = ['qr'];

  if (pose.unit < MIN_UNIT_PX) {
    warnings.push(
      `QR ในภาพเล็กเกินไป (${Math.round(pose.unit)}px) — ชื่ออาจอ่านไม่ออก ` +
      'ถ่ายให้ใกล้ขึ้นหรือปิดการย่อภาพ'
    );
  }
  const skew = Math.max(pose.squareness, 1 / pose.squareness);
  if (skew > MAX_SKEW) {
    warnings.push('ภาพเอียงมาก — กรอบชื่ออาจคลาดเคลื่อน ตรวจกับภาพด้านล่าง');
  }

  const band = enhance(
    cropPoseRegion(qr.canvas, pose, FOOTER_X, FOOTER_Y, BAND_SCALE)
  );

  debug.ms = Date.now() - started;
  return {
    ok: true, error: null, hn, hnSources, warnings, band, pose, debug,
  };
}
