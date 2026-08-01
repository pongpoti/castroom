import { useState, useRef, useEffect, useCallback } from 'react';
import { probeQr } from './lib/anchors';
import { CAPTURE_ASPECT, GOOD_UNIT_PX } from './lib/preprocess';
import { MIN_UNIT_PX } from './lib/anchors';

const STYLE = `
.cf{position:fixed;inset:0;z-index:50;background:#000;display:flex;
    flex-direction:column;font-family:'Noto Sans Thai',system-ui,sans-serif;letter-spacing:.015em}
.cf-stage{position:relative;flex:1;overflow:hidden;background:#000}
.cf-stage video{width:100%;height:100%;object-fit:cover;display:block}

/* The guide. A huge outer shadow darkens everything except the cut-out, so
   the operator sees exactly which part of the page has to be filled. */
.cf-guide{position:absolute;border:2px solid rgba(255,255,255,.9);border-radius:3px;
          box-shadow:0 0 0 9999px rgba(0,0,0,.58);pointer-events:none;
          transition:border-color .18s ease}
.cf-guide.ready{border-color:#3DDC84}
.cf-corner{position:absolute;width:22px;height:22px;border:3px solid #fff;
           pointer-events:none;transition:border-color .18s ease}
.cf-guide.ready .cf-corner{border-color:#3DDC84}
.cf-corner.tl{top:-3px;left:-3px;border-right:none;border-bottom:none}
.cf-corner.tr{top:-3px;right:-3px;border-left:none;border-bottom:none}
.cf-corner.bl{bottom:-3px;left:-3px;border-right:none;border-top:none}
.cf-corner.br{bottom:-3px;right:-3px;border-left:none;border-top:none}

.cf-caption{position:absolute;left:0;right:0;text-align:center;color:#fff;
            font-size:13.5px;line-height:1.55;text-shadow:0 1px 3px rgba(0,0,0,.85);
            padding:0 20px;pointer-events:none}
.cf-hint{position:absolute;left:0;right:0;display:flex;justify-content:center;
         pointer-events:none;padding:0 16px}
.cf-pill{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;
         border-radius:999px;font-size:13px;font-weight:600;
         background:rgba(20,22,26,.82);color:#fff;backdrop-filter:blur(6px)}
.cf-pill.ready{background:rgba(22,101,52,.9)}
.cf-pill.warn{background:rgba(146,64,14,.9)}
.cf-dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:none}

.cf-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;
        padding:18px 22px calc(18px + env(safe-area-inset-bottom));background:#0B0C0E}
.cf-shutter{width:68px;height:68px;border-radius:50%;border:4px solid rgba(255,255,255,.35);
            background:#fff;cursor:pointer;flex:none}
.cf-shutter:disabled{opacity:.4;cursor:not-allowed}
.cf-text{background:none;border:none;color:#fff;font-family:inherit;font-size:15px;
         cursor:pointer;padding:10px 4px;min-width:74px}
.cf-text.right{text-align:right}
.cf-err{color:#fff;padding:28px 24px;text-align:center;font-size:14.5px;line-height:1.7}
`;

/** Preview frames are downscaled before decoding; full detail is not needed. */
const PROBE_WIDTH = 1280;
const PROBE_INTERVAL_MS = 700;

export default function CameraFrame({ onCapture, onCancel, onFallback }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const stageRef = useRef(null);
  const probeCanvas = useRef(null);
  const busy = useRef(false);

  const [error, setError] = useState(null);
  const [live, setLive] = useState(null);       // latest probe result
  const [guide, setGuide] = useState(null);     // guide rect in CSS px
  const [shooting, setShooting] = useState(false);

  // Size the guide to CAPTURE_ASPECT, inset from the stage. Always horizontal
  // — a wide, short strip — regardless of whether the phone is held upright:
  // the operator is expected to turn the page (or the phone) to line the
  // footer up with it, not the guide to turn and fill a portrait screen.
  useEffect(() => {
    const fit = () => {
      const el = stageRef.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      let w = width * 0.92;
      let h = w / CAPTURE_ASPECT;
      const maxH = height * 0.42;
      if (h > maxH) { h = maxH; w = h * CAPTURE_ASPECT; }
      setGuide({ w, h, left: (width - w) / 2, top: (height - h) / 2 });
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Some in-app browsers (LINE's LIFF webview on iOS has shipped versions
      // that do this) don't expose getUserMedia at all rather than rejecting
      // it — calling straight through would throw a bare TypeError with no
      // useful name to branch on. Checking first gives a specific, actionable
      // message instead of the generic catch-all below.
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          console.error('camera: getUserMedia unavailable in this webview');
          setError('เบราว์เซอร์นี้ไม่รองรับกล้องแบบสด — กด "เลือกไฟล์" เพื่อเลือกภาพแทน');
        }
        return;
      }
      try {
        // Ask for as much sensor as the device will give: the name line is
        // only about a fifth of a QR width tall, so preview resolution is the
        // difference between a readable crop and a blurred one.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        // Logged with its real name/message — the UI only ever showed a
        // generic Thai sentence, which made "camera doesn't work" reports
        // undiagnosable without this line in the console.
        console.error('camera: getUserMedia failed:', e?.name, e?.message);
        if (!cancelled) setError(e?.name === 'NotAllowedError'
          ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องในเบราว์เซอร์ หรือกด "เลือกไฟล์" เพื่อเลือกภาพแทน'
          : 'เปิดกล้องไม่สำเร็จ — กด "เลือกไฟล์" เพื่อเลือกภาพแทน');
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Tell the operator whether this shot would actually work, before they take it.
  useEffect(() => {
    if (error) return undefined;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || busy.current || !video.videoWidth) return;
      busy.current = true;
      try {
        if (!probeCanvas.current) probeCanvas.current = document.createElement('canvas');
        const c = probeCanvas.current;
        const scale = Math.min(1, PROBE_WIDTH / video.videoWidth);
        c.width = Math.round(video.videoWidth * scale);
        c.height = Math.round(video.videoHeight * scale);
        c.getContext('2d', { willReadFrequently: true })
          .drawImage(video, 0, 0, c.width, c.height);
        const hit = probeQr(c);
        // Scale the probe's unit back up to what a full capture would give.
        setLive(hit ? { ...hit, unit: hit.unit / scale } : null);
      } catch {
        setLive(null);
      } finally {
        busy.current = false;
      }
    }, PROBE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [error]);

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!video || !track) return;
    setShooting(true);
    try {
      // takePhoto reaches the full still-image sensor, which is typically well
      // beyond the preview stream. Its field of view can be wider than the
      // preview, which costs nothing here: the QR pose finds the footer
      // wherever it landed, so a looser frame is harmless.
      if (typeof window.ImageCapture === 'function') {
        try {
          const blob = await new window.ImageCapture(track).takePhoto();
          onCapture(await createImageBitmap(blob));
          return;
        } catch { /* fall through to a preview-resolution grab */ }
      }
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      onCapture(await createImageBitmap(c));
    } finally {
      setShooting(false);
    }
  }, [onCapture]);

  const status = (() => {
    if (!live) return { cls: '', text: 'เล็ง QR code และบรรทัดชื่อให้อยู่ในกรอบ' };
    if (live.unit < MIN_UNIT_PX) {
      return { cls: 'warn', text: `ไกลเกินไป (QR ${Math.round(live.unit)}px) — เข้าใกล้อีก` };
    }
    const skew = Math.max(live.squareness, 1 / live.squareness);
    if (skew > 1.12) return { cls: 'warn', text: 'ถ่ายเฉียงเกินไป — ถือให้ขนานกับกระดาษ' };
    if (live.unit < GOOD_UNIT_PX) {
      return { cls: 'warn', text: `พอถ่ายได้ แต่เข้าใกล้อีกจะแม่นกว่า (QR ${Math.round(live.unit)}px)` };
    }
    return { cls: 'ready', text: `พร้อมถ่าย — พบ HN ${live.hn ?? '—'}` };
  })();

  const ready = status.cls === 'ready';

  return (
    <div className="cf">
      <style>{STYLE}</style>
      {error ? (
        <>
          <div className="cf-err">{error}</div>
          <div className="cf-bar">
            <button className="cf-text" onClick={onCancel}>ปิด</button>
            <button className="cf-text right" onClick={onFallback}>เลือกไฟล์</button>
          </div>
        </>
      ) : (
        <>
          <div className="cf-stage" ref={stageRef}>
            <video ref={videoRef} playsInline muted autoPlay />
            {guide && (
              <>
                <div
                  className={`cf-guide${ready ? ' ready' : ''}`}
                  style={{ left: guide.left, top: guide.top, width: guide.w, height: guide.h }}
                >
                  <span className="cf-corner tl" /><span className="cf-corner tr" />
                  <span className="cf-corner bl" /><span className="cf-corner br" />
                </div>
                <div className="cf-caption" style={{ top: guide.top + guide.h + 16 }}>
                  วางกรอบล่างของใบบันทึกให้เต็มกรอบนี้ —
                  ต้องเห็นทั้ง QR code และบรรทัด “ชื่อ-สกุลผู้ป่วย”
                </div>
                <div className="cf-hint" style={{ top: Math.max(12, guide.top - 46) }}>
                  <span className={`cf-pill ${status.cls}`}>
                    <span className="cf-dot" />{status.text}
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="cf-bar">
            <button className="cf-text" onClick={onCancel}>ยกเลิก</button>
            <button
              className="cf-shutter"
              onClick={shoot}
              disabled={shooting}
              aria-label="ถ่ายภาพ"
            />
            <button className="cf-text right" onClick={onFallback}>เลือกไฟล์</button>
          </div>
        </>
      )}
    </div>
  );
}
