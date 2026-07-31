/**
 * anchors.js — locate the footer from the QR code alone.
 *
 * The QR carries everything the geometry needs. Its three finder patterns give
 * an origin, a scale and a rotation in one decode, and the payload's URL tail
 * carries the HN. Nothing else on the page has to be read for the record to be
 * correct, which matters because the footer's Code128 pair is the one thing
 * that does not decode reliably from a whole-page photograph.
 *
 * Everything below is measured in `unit`: the distance between adjacent finder
 * pattern centres. It is a stable, rotation-independent scale that does not
 * change with payload length the way a barcode's width does.
 */

import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  HybridBinarizer,
  BinaryBitmap,
  HTMLCanvasElementLuminanceSource,
} from '@zxing/library';

/**
 * A QR decodes at essentially any orientation, so the common case needs no
 * sweep at all. These are a cheap safety net for the awkward angles where
 * resampling blur can defeat detection; a QR-only pass is fast enough that
 * trying a few costs little.
 */
const QR_FALLBACK_ANGLES = [0, 90, -90, 180, 45, -45];

/** Below this the footer text is too coarse to recognise. */
export const MIN_UNIT_PX = 80;

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

function buildReader(formats) {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return { reader, hints };
}

function decodeOne(canvas, formats) {
  const { reader, hints } = buildReader(formats);
  const source = new HTMLCanvasElementLuminanceSource(canvas);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  // Hints must be passed on the call too: MultiFormatReader.decode(image) with
  // no hints argument resets its reader set, losing POSSIBLE_FORMATS and
  // TRY_HARDER.
  return reader.decode(bitmap, hints);
}

/** The HN is the last path segment of the QR's drugboard URL. */
export function hnFromQrText(text) {
  if (typeof text !== 'string') return null;
  const tail = text.replace(/[/\s]+$/, '').split('/').pop();
  return /^\d{4,}$/.test(tail) ? tail : null;
}

/**
 * Pose from the finder patterns.
 *
 * zxing returns QR result points as [bottomLeft, topLeft, topRight] with an
 * optional fourth alignment pattern. Two edges off the top-left corner give
 * the QR's own axes directly, so rotation is measured rather than searched.
 */
function poseFromPoints(points) {
  if (!points || points.length < 3) return null;
  const [BL, TL, TR] = points.map((p) => [p.getX(), p.getY()]);

  const ex = [TR[0] - TL[0], TR[1] - TL[1]];
  const ey = [BL[0] - TL[0], BL[1] - TL[1]];
  const lx = Math.hypot(ex[0], ex[1]);
  const ly = Math.hypot(ey[0], ey[1]);
  if (!(lx > 1) || !(ly > 1)) return null;

  return {
    originX: TL[0],
    originY: TL[1],
    ux: [ex[0] / lx, ex[1] / lx],
    uy: [ey[0] / ly, ey[1] / ly],
    unit: (lx + ly) / 2,
    rotationDeg: (Math.atan2(ex[1], ex[0]) * 180) / Math.PI,
    // 1.0 is a square-on capture. Drifting away means the page was shot at an
    // angle, and since the name sits many units from the QR, that error is
    // amplified across the gap.
    squareness: lx / ly,
  };
}

/**
 * Decode the QR and derive the footer pose from it.
 * @returns {{text, hn, pose, angleTried, attempts}|null}
 */
export function readQrPose(canvas) {
  const attempts = [];
  for (const angle of QR_FALLBACK_ANGLES) {
    const probe = rotateCanvas(canvas, angle);
    const started = Date.now();
    let result = null;
    try {
      result = decodeOne(probe, [BarcodeFormat.QR_CODE]);
    } catch {
      result = null;
    }
    attempts.push({ angle, ms: Date.now() - started, ok: !!result });
    if (!result) continue;

    const pose = poseFromPoints(result.getResultPoints());
    if (!pose) continue;
    return {
      text: result.getText(),
      hn: hnFromQrText(result.getText()),
      pose,
      canvas: probe,
      angleTried: angle,
      attempts,
    };
  }
  return { text: null, hn: null, pose: null, canvas, angleTried: null, attempts };
}

/**
 * Cut a rectangle expressed in pose units, straightening it on the way out.
 *
 * The pose's axes are mapped onto the output axes, so whatever rotation the
 * capture had is removed here rather than searched for earlier.
 *
 * @param {number[]} X  [from, to] along the QR's own x axis, in units
 * @param {number[]} Y  [from, to] along the QR's own y axis, in units
 */
export function cropPoseRegion(canvas, pose, X, Y, scale = 1) {
  const { originX, originY, ux, uy, unit } = pose;
  const w = Math.max(1, Math.round((X[1] - X[0]) * unit * scale));
  const h = Math.max(1, Math.round((Y[1] - Y[0]) * unit * scale));

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';

  // Image point p maps to output as
  //   out = scale * ( (p - origin)·û  -  offset·unit )
  // which is exactly a setTransform with the axes as the matrix rows.
  const dotX = ux[0] * originX + ux[1] * originY;
  const dotY = uy[0] * originX + uy[1] * originY;
  ctx.setTransform(
    scale * ux[0], scale * uy[0],
    scale * ux[1], scale * uy[1],
    -scale * (dotX + X[0] * unit),
    -scale * (dotY + Y[0] * unit),
  );
  ctx.drawImage(canvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}
