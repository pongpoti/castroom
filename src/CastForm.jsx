import { useState, useRef, useEffect, useCallback } from 'react';
import { preprocess, cropBox } from './lib/preprocess';
import { readName } from './lib/ocr';
import CameraFrame from './CameraFrame';
import { CAST_TYPES, castType, castItemLabel } from './lib/casts';

/* Palette: Play Blue (primary), Nude Stone (surfaces/body fill),
   Stained Cork (accent/selected). Cartoonish but restrained — big
   rounded corners and soft shadows carry the "friendly" feel rather
   than illustration, so the form still reads as a working tool. */
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

.cf2{--blue:#4F67B1;--blue-dark:#3C4F8F;--nude:#FFD7B9;--nude-soft:#FFE8D6;
     --cork:#B44B28;--cork-soft:#F4DDD3;--ink:#2A2C33;--ink-2:#6B6F7A;
     --surface:#FBF8F5;--card:#FFFFFF;
     font-family:'Sarabun',system-ui,sans-serif;color:var(--ink);
     background:var(--surface);min-height:100vh;padding-bottom:100px}
.cf2 *{box-sizing:border-box}

.cf2-hero{background:var(--blue);color:#fff;padding:28px 20px 40px;
          border-radius:0 0 32px 32px;text-align:center}
.cf2-hero-icon{width:52px;height:52px;margin:0 auto 10px}
.cf2-title{font-size:26px;font-weight:700;letter-spacing:-.01em}
.cf2-sub{font-size:13.5px;opacity:.85;margin-top:4px}

.cf2-shell{max-width:640px;margin:-20px auto 0;padding:0 16px;
           display:flex;flex-direction:column;gap:16px}

.cf2-card{background:var(--card);border-radius:24px;padding:22px;
          box-shadow:0 6px 20px rgba(79,103,177,.12)}
.cf2-step{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.cf2-step-n{width:28px;height:28px;border-radius:50%;background:var(--nude);
            color:var(--cork);font-weight:700;font-size:14px;flex:none;
            display:flex;align-items:center;justify-content:center}
.cf2-step-t{font-size:16px;font-weight:700}

.cf2-date{width:100%;border:2px solid var(--nude);border-radius:16px;
          background:var(--nude-soft);padding:13px 16px;font-family:inherit;
          font-size:17px;font-weight:600;color:var(--ink)}
.cf2-date:focus-visible{outline:none;border-color:var(--blue)}

.cf2-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:8px;min-height:150px;border:2.5px dashed var(--nude);border-radius:18px;
          background:var(--nude-soft);text-align:center;padding:24px;cursor:pointer}
.cf2-drop:hover,.cf2-drop:focus-visible{border-color:var(--blue);outline:none}
.cf2-drop b{font-size:15.5px;font-weight:700;color:var(--ink)}
.cf2-drop span{font-size:12.5px;color:var(--ink-2);max-width:36ch;line-height:1.6}
.cf2-linkbtn{display:block;margin:12px auto 0;background:none;border:none;
             font-family:inherit;font-size:13px;color:var(--blue);
             text-decoration:underline;cursor:pointer;padding:6px}

.cf2-evidence{border-radius:14px;overflow:hidden;background:#fff;
              border:2px solid var(--nude);line-height:0;margin:10px 0}
.cf2-evidence canvas{width:100%;display:block}
.cf2-field{margin-top:12px}
.cf2-label{display:flex;justify-content:space-between;align-items:baseline;
           font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
           color:var(--ink-2);margin-bottom:6px}
.cf2-src{font-weight:600;text-transform:none;letter-spacing:0;color:var(--blue)}
.cf2-input{width:100%;border:2px solid var(--nude);border-radius:14px;background:#fff;
           padding:11px 14px;font-family:inherit;font-size:16px;color:var(--ink)}
.cf2-input:focus-visible{outline:none;border-color:var(--blue)}
.cf2-input.mono{font-family:'IBM Plex Mono',monospace;font-size:18px;
                letter-spacing:.06em;font-weight:600}
.cf2-retake{margin-top:12px;background:none;border:2px solid var(--cork);
            color:var(--cork);border-radius:12px;padding:9px 16px;font-family:inherit;
            font-size:13.5px;font-weight:600;cursor:pointer}
.cf2-flags{background:var(--cork-soft);border-radius:12px;padding:10px 14px;margin-top:12px}
.cf2-flags li{font-size:12.5px;line-height:1.6;margin-left:14px;color:var(--cork)}
.cf2-err{font-size:13px;color:var(--cork);line-height:1.6;margin-top:10px;text-align:center}
.cf2-status{font-size:13.5px;color:var(--blue);text-align:center;padding:10px 0;font-weight:600}

.cf2-castgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.cf2-castbtn{display:flex;flex-direction:column;align-items:flex-start;gap:2px;
            border:2.5px solid var(--nude);background:var(--nude-soft);border-radius:16px;
            padding:12px 14px;cursor:pointer;font-family:inherit;text-align:left}
.cf2-castbtn:hover{border-color:var(--blue)}
.cf2-castbtn.active{border-color:var(--blue);background:#fff;
                    box-shadow:0 0 0 2px var(--blue) inset}
.cf2-castbtn-th{font-size:14px;font-weight:700;color:var(--ink)}
.cf2-castbtn-site{font-size:11.5px;color:var(--ink-2)}

.cf2-sideprompt{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
                background:var(--cork-soft);border-radius:14px;padding:12px 14px;margin-top:12px}
.cf2-sideprompt b{font-size:13.5px;color:var(--cork);flex:1 1 auto;min-width:120px}
.cf2-sidebtn{border:2px solid var(--cork);background:#fff;color:var(--cork);
            border-radius:12px;padding:8px 16px;font-family:inherit;font-size:14px;
            font-weight:700;cursor:pointer}
.cf2-sidebtn:hover{background:var(--cork);color:#fff}
.cf2-sidecancel{background:none;border:none;color:var(--ink-2);font-family:inherit;
                font-size:13px;text-decoration:underline;cursor:pointer;padding:6px}

.cf2-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;min-height:1px}
.cf2-chip{display:inline-flex;align-items:center;gap:6px;background:var(--cork-soft);
         color:var(--cork);border-radius:999px;padding:7px 8px 7px 14px;
         font-size:13px;font-weight:600}
.cf2-chip button{background:var(--cork);color:#fff;border:none;border-radius:50%;
                 width:18px;height:18px;font-size:12px;line-height:1;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;flex:none}
.cf2-empty{font-size:13px;color:var(--ink-2)}

.cf2-bar{position:fixed;left:0;right:0;bottom:0;background:#fff;
         box-shadow:0 -6px 20px rgba(42,44,51,.08);padding:14px 16px calc(14px + env(safe-area-inset-bottom));
         display:flex;justify-content:center;z-index:10}
.cf2-submit{width:100%;max-width:608px;padding:16px;border-radius:18px;border:none;
           background:var(--blue);color:#fff;font-family:inherit;font-size:16.5px;
           font-weight:700;cursor:pointer}
.cf2-submit:disabled{background:#D8DBE4;color:#9AA0AC;cursor:not-allowed}

.cf2-log{margin-top:4px}
.cf2-log-title{font-size:13px;font-weight:700;color:var(--ink-2);margin-bottom:10px}
.cf2-entry{background:var(--nude-soft);border-radius:16px;padding:14px 16px;margin-bottom:10px}
.cf2-entry-top{display:flex;justify-content:space-between;align-items:baseline;
               font-size:13px;color:var(--ink-2);margin-bottom:4px}
.cf2-entry-name{font-size:15.5px;font-weight:700}
.cf2-entry-hn{font-family:'IBM Plex Mono',monospace;font-weight:600;color:var(--blue)}
.cf2-entry-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.cf2-entry-chip{background:var(--cork-soft);color:var(--cork);border-radius:999px;
                padding:4px 10px;font-size:11.5px;font-weight:600}
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

  // Each item is {id, type, side}; side is null for the two types that don't
  // track laterality. `pendingType` holds a side-requiring type the operator
  // has tapped but not yet resolved to a side.
  const [castItems, setCastItems] = useState([]);
  const [pendingType, setPendingType] = useState(null);
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

  /** Tapping a badge either adds it directly or opens the side prompt. */
  const pickCastType = (id) => {
    const type = castType(id);
    if (!type) return;
    if (!type.needsSide) {
      setCastItems((prev) => [...prev, { id: `${Date.now()}-${id}`, type: id, side: null }]);
      return;
    }
    setPendingType(id);
  };

  const resolveSide = (side) => {
    if (!pendingType) return;
    setCastItems((prev) => [...prev, { id: `${Date.now()}-${pendingType}`, type: pendingType, side }]);
    setPendingType(null);
  };

  const removeCastItem = (id) => {
    setCastItems((prev) => prev.filter((it) => it.id !== id));
  };

  const photoBusy = photoStage === 'reading-barcode' || photoStage === 'reading-name';
  const photoStatus = photoStage === 'reading-barcode' ? 'กำลังอ่าน QR code…'
    : photoStage === 'reading-name' ? 'กำลังอ่านชื่อ…' : '';

  const canSubmit = date && hn.trim().length >= 4 && name.trim().length >= 3
    && castItems.length > 0 && !photoBusy;

  const submit = () => {
    if (!canSubmit) return;
    const entry = {
      id: `${Date.now()}`,
      date,
      hn: hn.trim(),
      name: name.trim(),
      casts: castItems,
      at: new Date().toISOString(),
    };
    setLog((l) => [entry, ...l]);
    onLog?.(entry);
    resetPhoto();
    setCastItems([]);
    setPendingType(null);
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
        <svg className="cf2-hero-icon" viewBox="0 0 64 64" fill="none">
          <rect x="10" y="24" width="44" height="20" rx="10" fill="#FFD7B9" stroke="#fff" strokeWidth="3" />
          <path d="M18 24v20M28 24v20M38 24v20M48 24v20" stroke="#4F67B1" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div className="cf2-title">เวรห้องเฝือก</div>
        <div className="cf2-sub">บันทึกผู้ป่วยใส่เฝือกประจำเวร</div>
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
            <span className="cf2-step-t">ชนิดเฝือกที่ใส่</span>
          </div>

          <div className="cf2-castgrid">
            {CAST_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`cf2-castbtn ${pendingType === t.id ? 'active' : ''}`}
                onClick={() => pickCastType(t.id)}
              >
                <span className="cf2-castbtn-th">{t.thai}</span>
                <span className="cf2-castbtn-site">{t.site ?? t.label}</span>
              </button>
            ))}
          </div>

          {pendingType && (
            <div className="cf2-sideprompt">
              <b>{castType(pendingType)?.thai} — ข้างไหน?</b>
              <button className="cf2-sidebtn" onClick={() => resolveSide('left')}>ซ้าย</button>
              <button className="cf2-sidebtn" onClick={() => resolveSide('right')}>ขวา</button>
              <button className="cf2-sidecancel" onClick={() => setPendingType(null)}>ยกเลิก</button>
            </div>
          )}

          <div className="cf2-chips">
            {castItems.length === 0
              ? <span className="cf2-empty">ยังไม่ได้เลือกเฝือก — แตะที่รายการด้านบน</span>
              : castItems.map((it) => (
                <span className="cf2-chip" key={it.id}>
                  {castItemLabel(it)}
                  <button onClick={() => removeCastItem(it.id)} aria-label={`เอา ${castItemLabel(it)} ออก`}>×</button>
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
                  {r.casts.map((it) => (
                    <span className="cf2-entry-chip" key={it.id}>{castItemLabel(it)}</span>
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
