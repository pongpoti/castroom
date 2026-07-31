import { useState, useRef, useEffect, useCallback } from 'react';
import { preprocess, cropBox } from './lib/preprocess';
import { readName } from './lib/ocr';
import CameraFrame from './CameraFrame';
import { CAST_TYPES, castLabel } from './lib/casts';

/*
 * Palette: a single accessible indigo (--primary) carries every
 * interactive and selected state, checked against white at both text and
 * large-element sizes; amber is reserved for warnings so it never competes
 * with "selected." Neutral surfaces and a visible border keep cards legible
 * without leaning on color the way the first pass did.
 */
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Mitr:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

.cf2{--primary:#3457D5;--primary-700:#25409E;--primary-100:#E8ECFC;
     --warn:#9A5B12;--warn-soft:#FBF0DE;
     --ink:#181B24;--ink-2:#585F6E;
     --surface:#F5F6F9;--card:#FFFFFF;--border:#E3E6ED;--border-strong:#8B95AC;
     font-family:'Mitr',system-ui,sans-serif;color:var(--ink);
     background:var(--surface);min-height:100vh;padding-bottom:100px}
.cf2 *{box-sizing:border-box}
.cf2 :focus-visible{outline:2.5px solid var(--primary);outline-offset:2px}

.cf2-hero{background:var(--card);border-bottom:1px solid var(--border);
          padding:18px 20px;display:flex;align-items:center;gap:14px}
.cf2-hero-icon{width:44px;height:44px;flex:none;border-radius:14px;
               background:var(--primary-100);display:flex;
               align-items:center;justify-content:center}
.cf2-title{font-size:20px;font-weight:600;letter-spacing:-.01em}
.cf2-sub{font-size:13px;color:var(--ink-2);margin-top:1px}

.cf2-shell{max-width:640px;margin:0 auto;padding:16px;
           display:flex;flex-direction:column;gap:14px}

.cf2-card{background:var(--card);border:1px solid var(--border);
          border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(24,27,36,.04)}
.cf2-step{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.cf2-step-n{width:26px;height:26px;border-radius:50%;background:var(--primary-100);
            color:var(--primary-700);font-weight:600;font-size:13px;flex:none;
            display:flex;align-items:center;justify-content:center}
.cf2-step-t{font-size:15.5px;font-weight:600}

.cf2-date{width:100%;border:1.5px solid var(--border-strong);border-radius:12px;
          background:var(--surface);padding:12px 14px;font-family:inherit;
          font-size:16px;font-weight:500;color:var(--ink)}
.cf2-date:focus-visible{outline:none;border-color:var(--primary);
                        box-shadow:0 0 0 3px var(--primary-100)}

.cf2-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:8px;min-height:140px;border:1.5px dashed var(--border-strong);border-radius:14px;
          background:var(--surface);text-align:center;padding:24px;cursor:pointer}
.cf2-drop:hover,.cf2-drop:focus-visible{border-color:var(--primary);outline:none}
.cf2-drop b{font-size:15px;font-weight:600;color:var(--ink)}
.cf2-drop span{font-size:12.5px;color:var(--ink-2);max-width:36ch;line-height:1.6}
.cf2-linkbtn{display:block;margin:12px auto 0;background:none;border:none;
             font-family:inherit;font-size:13px;color:var(--primary);
             text-decoration:underline;cursor:pointer;padding:6px}

.cf2-evidence{border-radius:12px;overflow:hidden;background:#fff;
              border:1.5px solid var(--border);line-height:0;margin:10px 0}
.cf2-evidence canvas{width:100%;display:block}
.cf2-field{margin-top:12px}
.cf2-label{display:flex;justify-content:space-between;align-items:baseline;
           font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
           color:var(--ink-2);margin-bottom:6px}
.cf2-src{font-weight:600;text-transform:none;letter-spacing:0;color:var(--primary)}
.cf2-input{width:100%;border:1.5px solid var(--border-strong);border-radius:12px;background:#fff;
           padding:11px 14px;font-family:inherit;font-size:16px;color:var(--ink)}
.cf2-input:focus-visible{outline:none;border-color:var(--primary);
                         box-shadow:0 0 0 3px var(--primary-100)}
.cf2-input.mono{font-family:'IBM Plex Mono',monospace;font-size:18px;
                letter-spacing:.06em;font-weight:600}
.cf2-retake{margin-top:12px;background:none;border:1.5px solid var(--border-strong);
            color:var(--ink-2);border-radius:10px;padding:9px 16px;font-family:inherit;
            font-size:13.5px;font-weight:500;cursor:pointer}
.cf2-retake:hover{border-color:var(--primary);color:var(--primary)}
.cf2-flags{background:var(--warn-soft);border-radius:10px;padding:10px 14px;margin-top:12px}
.cf2-flags li{font-size:12.5px;line-height:1.6;margin-left:14px;color:var(--warn)}
.cf2-err{font-size:13px;color:var(--warn);line-height:1.6;margin-top:10px;text-align:center}
.cf2-status{font-size:13.5px;color:var(--primary);text-align:center;padding:10px 0;font-weight:500}

.cf2-castgrid{display:flex;flex-wrap:wrap;gap:8px}
.cf2-castbtn{border:1.5px solid var(--border-strong);background:var(--surface);color:var(--ink);
            border-radius:999px;padding:9px 16px;cursor:pointer;font-family:inherit;
            font-size:13.5px;font-weight:500}
.cf2-castbtn:hover{border-color:var(--primary)}
.cf2-castbtn.active{border-color:var(--primary);background:var(--primary);color:#fff;
                    font-weight:600}

.cf2-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;min-height:1px}
.cf2-chip{display:inline-flex;align-items:center;gap:6px;background:var(--primary-100);
         color:var(--primary-700);border-radius:999px;padding:7px 8px 7px 14px;
         font-size:13px;font-weight:500}
.cf2-chip button{background:var(--primary);color:#fff;border:none;border-radius:50%;
                 width:18px;height:18px;font-size:12px;line-height:1;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;flex:none}
.cf2-empty{font-size:13px;color:var(--ink-2)}

.cf2-bar{position:fixed;left:0;right:0;bottom:0;background:#fff;
         border-top:1px solid var(--border);
         padding:14px 16px calc(14px + env(safe-area-inset-bottom));
         display:flex;justify-content:center;z-index:10}
.cf2-submit{width:100%;max-width:608px;padding:15px;border-radius:14px;border:none;
           background:var(--primary);color:#fff;font-family:inherit;font-size:16px;
           font-weight:600;cursor:pointer}
.cf2-submit:hover:not(:disabled){background:var(--primary-700)}
.cf2-submit:disabled{background:#DDE0E7;color:#9AA0AC;cursor:not-allowed}

.cf2-log{margin-top:4px}
.cf2-log-title{font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:10px}
.cf2-entry{background:var(--card);border:1px solid var(--border);
          border-radius:14px;padding:14px 16px;margin-bottom:10px}
.cf2-entry-top{display:flex;justify-content:space-between;align-items:baseline;
               font-size:13px;color:var(--ink-2);margin-bottom:4px}
.cf2-entry-name{font-size:15px;font-weight:600}
.cf2-entry-hn{font-family:'IBM Plex Mono',monospace;font-weight:600;color:var(--primary)}
.cf2-entry-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.cf2-entry-chip{background:var(--primary-100);color:var(--primary-700);border-radius:999px;
                padding:4px 10px;font-size:11.5px;font-weight:500}
`;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ERRORS = {
  'no-qr': 'อ่าน QR code ไม่ได้ — ต้องเห็น QR ในกรอบล่างทั้งอัน ชัดและใกล้ขึ้น',
  'no-identifiable-hn': 'QR อ่านได้แต่ไม่มี HN อยู่ในนั้น — ตรวจสอบว่าเป็นเอกสารที่ถูกต้อง',
  'sources-disagree': 'บาร์โค้ดกับ QR ให้ HN ไม่ตรงกัน — ตรวจสอบเอกสารแล้วถ่ายใหม่',
};

export default function CastForm({ onLog }) {
  const [date, setDate] = useState(todayISO());

  const [photoStage, setPhotoStage] = useState('idle');
  const [photoError, setPhotoError] = useState(null);
  const [capture, setCapture] = useState(null);
  const [hn, setHn] = useState('');
  const [name, setName] = useState('');
  const [camera, setCamera] = useState(false);

  const [castItems, setCastItems] = useState(new Set());
  const [log, setLog] = useState([]);

  const evidenceRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!evidenceRef.current) return;
    if (!capture?.evidence) { evidenceRef.current.replaceChildren(); return; }
    evidenceRef.current.replaceChildren(capture.evidence);
  }, [capture]);

  const handleImage = useCallback(async (bitmap, meta = {}) => {
    if (!bitmap) return;
    setPhotoError(null);
    setCapture(null);
    setPhotoStage('reading-barcode');

    try {
      const pre = preprocess(bitmap);
      if (!pre.ok) {
        setPhotoError(ERRORS[pre.error] ?? 'ประมวลผลภาพไม่สำเร็จ');
        setPhotoStage('idle');
        return;
      }

      setHn(pre.hn);
      setPhotoStage('reading-name');
      const read = await readName(pre.band);
      setName(read.name);

      const sources = [...pre.hnSources];
      const extraFlags = [];
      if (read.printedHn === pre.hn) sources.push('ตัวเลขในภาพ');
      else if (read.printedHn) {
        extraFlags.push(`HN ในภาพอ่านได้เป็น ${read.printedHn} ไม่ตรงกับ QR (${pre.hn}) — ตรวจสอบก่อนบันทึก`);
      }

      setCapture({
        ...pre,
        ...read,
        hnSources: sources,
        evidence: (read.box && cropBox(pre.band, read.box)) ?? pre.band,
        flags: [...pre.warnings, ...read.flags, ...extraFlags],
      });
      setPhotoStage('done');
    } catch (e) {
      setPhotoError(e.message ?? 'ประมวลผลภาพไม่สำเร็จ');
      setPhotoStage('idle');
    }
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      await handleImage(bitmap, { via: 'file' });
    } catch {
      setPhotoError('เปิดไฟล์ภาพไม่ได้');
      setPhotoStage('idle');
    }
  }, [handleImage]);

  const handleShot = useCallback(async (bitmap) => {
    setCamera(false);
    await handleImage(bitmap, { via: 'camera' });
  }, [handleImage]);

  const resetPhoto = () => {
    setCapture(null); setHn(''); setName(''); setPhotoError(null); setPhotoStage('idle');
    if (fileRef.current) fileRef.current.value = '';
  };

  const toggleCastType = (id) => {
    setCastItems((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const photoBusy = photoStage === 'reading-barcode' || photoStage === 'reading-name';
  const photoStatus = photoStage === 'reading-barcode' ? 'กำลังอ่าน QR code…'
    : photoStage === 'reading-name' ? 'กำลังอ่านชื่อ…' : '';

  const canSubmit = date && hn.trim().length >= 4 && name.trim().length >= 3
    && castItems.size > 0 && !photoBusy;

  const submit = () => {
    if (!canSubmit) return;
    const entry = {
      id: `${Date.now()}`,
      date,
      hn: hn.trim(),
      name: name.trim(),
      casts: [...castItems],
      at: new Date().toISOString(),
    };
    setLog((l) => [entry, ...l]);
    onLog?.(entry);
    resetPhoto();
    setCastItems(new Set());
  };

  return (
    <div className="cf2">
      <style>{STYLE}</style>
      {camera && (
        <CameraFrame
          onCapture={handleShot}
          onCancel={() => setCamera(false)}
          onFallback={() => { setCamera(false); fileRef.current?.click(); }}
        />
      )}

      <header className="cf2-hero">
        <div className="cf2-hero-icon">
          <svg width="24" height="24" viewBox="0 0 64 64" fill="none">
            <rect x="10" y="24" width="44" height="20" rx="10" fill="#fff" stroke="#3457D5" strokeWidth="3.5" />
            <path d="M18 24v20M28 24v20M38 24v20M48 24v20" stroke="#3457D5" strokeWidth="3.5" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <div className="cf2-title">เวรห้องเฝือก</div>
          <div className="cf2-sub">บันทึกผู้ป่วยใส่เฝือกประจำเวร</div>
        </div>
      </header>

      <div className="cf2-shell">
        <section className="cf2-card">
          <div className="cf2-step">
            <span className="cf2-step-n">1</span>
            <span className="cf2-step-t">วันที่</span>
          </div>
          <input type="date" className="cf2-date" value={date}
                 onChange={(e) => setDate(e.target.value)} />
        </section>

        <section className="cf2-card">
          <div className="cf2-step">
            <span className="cf2-step-n">2</span>
            <span className="cf2-step-t">ถ่ายภาพกรอบล่างใบบันทึก</span>
          </div>

          {!capture ? (
            <>
              <div
                className="cf2-drop"
                role="button"
                tabIndex={0}
                onClick={() => !photoBusy && setCamera(true)}
                onKeyDown={(e) => e.key === 'Enter' && !photoBusy && setCamera(true)}
              >
                <b>{photoBusy ? photoStatus : 'แตะเพื่อถ่ายภาพ'}</b>
                <span>ต้องเห็นทั้ง QR code และบรรทัด “ชื่อ-สกุลผู้ป่วย” ในภาพเดียว</span>
              </div>
              <button className="cf2-linkbtn" onClick={() => !photoBusy && fileRef.current?.click()}>
                หรือเลือกไฟล์ภาพที่ถ่ายไว้แล้ว
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden
                     onChange={(e) => handleFile(e.target.files?.[0])} />
              {photoError && <div className="cf2-err">{photoError}</div>}
            </>
          ) : (
            <>
              {capture.flags?.length > 0 && (
                <div className="cf2-flags">
                  <ul>{capture.flags.map((f) => <li key={f}>{f}</li>)}</ul>
                </div>
              )}

              <div className="cf2-field">
                <div className="cf2-label">
                  <span>HN</span>
                  <span className="cf2-src">
                    {capture.hnSources.length > 1 ? `ยืนยันตรงกัน ${capture.hnSources.length} แหล่ง` : 'จาก QR code'}
                  </span>
                </div>
                <input className="cf2-input mono" value={hn} inputMode="numeric"
                       onChange={(e) => setHn(e.target.value.replace(/\D/g, ''))} aria-label="HN" />
              </div>

              <div className="cf2-field">
                <div className="cf2-label">
                  <span>ชื่อ-สกุล</span>
                  <span className="cf2-src">ตรวจกับภาพด้านล่าง</span>
                </div>
                {capture.evidence && <div className="cf2-evidence" ref={evidenceRef} />}
                <input className="cf2-input" value={name}
                       onChange={(e) => setName(e.target.value)} aria-label="ชื่อ-สกุล" />
              </div>

              <button className="cf2-retake" onClick={resetPhoto}>ถ่ายใหม่</button>
            </>
          )}
        </section>

        <section className="cf2-card">
          <div className="cf2-step">
            <span className="cf2-step-n">3</span>
            <span className="cf2-step-t">Cast Type</span>
          </div>

          <div className="cf2-castgrid">
            {CAST_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`cf2-castbtn ${castItems.has(t.id) ? 'active' : ''}`}
                aria-pressed={castItems.has(t.id)}
                onClick={() => toggleCastType(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="cf2-chips">
            {castItems.size === 0
              ? <span className="cf2-empty">ยังไม่ได้เลือกเฝือก — แตะที่รายการด้านบน</span>
              : [...castItems].map((id) => (
                <span className="cf2-chip" key={id}>
                  {castLabel(id)}
                  <button onClick={() => toggleCastType(id)} aria-label={`เอา ${castLabel(id)} ออก`}>×</button>
                </span>
              ))}
          </div>
        </section>

        {log.length > 0 && (
          <section className="cf2-log">
            <div className="cf2-log-title">{log.length} รายการในรอบนี้</div>
            {log.map((r) => (
              <div className="cf2-entry" key={r.id}>
                <div className="cf2-entry-top">
                  <span>{r.date}</span>
                  <span className="cf2-entry-hn">{r.hn}</span>
                </div>
                <div className="cf2-entry-name">{r.name}</div>
                <div className="cf2-entry-chips">
                  {r.casts.map((id) => (
                    <span className="cf2-entry-chip" key={id}>{castLabel(id)}</span>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="cf2-bar">
        <button className="cf2-submit" disabled={!canSubmit} onClick={submit}>
          บันทึกข้อมูล
        </button>
      </div>
    </div>
  );
}
