import { useState, useRef, useCallback, useEffect } from 'react';
import { preprocess, cropBox } from './lib/preprocess';
import { readName } from './lib/ocr';
import CameraFrame from './CameraFrame';

/* Palette taken from the document itself: laser toner on office paper,
   annotated in blue ballpoint. Sarabun is the typeface Thai government
   forms are set in; Plex Mono keeps HN digits unambiguous under review. */
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

.pc{--paper:#FBFBF9;--ink:#14161A;--ink-2:#5A6169;--ballpoint:#1B3FA8;
    --rule:#D2D5DB;--flag:#A65200;--flag-bg:#FDF3E4;--surface:#EDEEF0;
    font-family:'Sarabun',system-ui,sans-serif;color:var(--ink);
    background:var(--surface);min-height:100vh;padding:24px}
.pc *{box-sizing:border-box}
.pc-shell{max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:20px}

.pc-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;
         flex-wrap:wrap;border-bottom:1px solid var(--rule);padding-bottom:14px}
.pc-title{font-size:19px;font-weight:700;letter-spacing:-.01em}
.pc-sub{font-size:13px;color:var(--ink-2)}

.pc-panel{background:var(--paper);border:1px solid var(--rule);padding:20px}

.pc-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;
         gap:10px;min-height:220px;border:1.5px dashed var(--rule);
         background:var(--paper);text-align:center;padding:32px;cursor:pointer}
.pc-drop:hover,.pc-drop:focus-visible{border-color:var(--ballpoint);outline:none}
.pc-drop b{font-size:16px;font-weight:600}
.pc-drop span{font-size:13px;color:var(--ink-2);max-width:40ch;line-height:1.6}
.pc-drop .pc-alt{font-size:12px;color:var(--ink-2);opacity:.8}
.pc-linkbtn{display:block;margin:14px auto 0;background:none;border:none;
            font-family:inherit;font-size:13.5px;color:var(--ballpoint);
            text-decoration:underline;cursor:pointer;padding:6px}

/* Signature element: the evidence strip. Each field sits directly under the
   pixels it was read from, so checking is visual rather than remembered. */
.pc-field{margin-bottom:22px}
.pc-label{display:flex;justify-content:space-between;align-items:baseline;
          font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
          color:var(--ink-2);margin-bottom:6px}
.pc-src{font-weight:500;text-transform:none;letter-spacing:0}
.pc-src.ok{color:var(--ballpoint)}
.pc-src.weak{color:var(--flag)}
.pc-evidence{border:1px solid var(--rule);border-bottom:none;background:#fff;
             overflow:hidden;line-height:0}
.pc-evidence canvas{width:100%;display:block}
.pc-input{width:100%;border:1px solid var(--rule);background:#fff;padding:11px 12px;
          font-family:inherit;font-size:17px;color:var(--ink)}
.pc-input:focus-visible{outline:2px solid var(--ballpoint);outline-offset:-2px}
.pc-input.mono{font-family:'IBM Plex Mono',monospace;font-size:20px;
               letter-spacing:.08em;font-weight:600}

.pc-flags{background:var(--flag-bg);border-left:3px solid var(--flag);
          padding:12px 14px;margin-bottom:20px}
.pc-flags li{font-size:13.5px;line-height:1.6;margin-left:16px;color:var(--flag)}

.pc-actions{display:flex;gap:10px}
.pc-btn{flex:1;padding:13px 16px;font-family:inherit;font-size:15px;font-weight:600;
        border:1px solid var(--ballpoint);background:var(--ballpoint);color:#fff;cursor:pointer}
.pc-btn.ghost{background:transparent;color:var(--ballpoint)}
.pc-btn:disabled{opacity:.45;cursor:not-allowed}
.pc-btn:focus-visible{outline:2px solid var(--ink);outline-offset:2px}

.pc-status{font-size:14px;color:var(--ink-2);text-align:center;padding:14px 0}
.pc-err{font-size:13.5px;color:var(--flag);line-height:1.6;margin-top:10px;text-align:center}

.pc-log table{width:100%;border-collapse:collapse;font-size:14px}
.pc-log th{text-align:left;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;
           color:var(--ink-2);padding:8px 10px;border-bottom:1px solid var(--rule)}
.pc-log td{padding:9px 10px;border-bottom:1px solid var(--rule)}
.pc-log td.hn{font-family:'IBM Plex Mono',monospace;font-weight:600}

.pc-debug{margin-top:8px}
.pc-debug summary{cursor:pointer;font-size:12.5px;color:var(--ink-2);
                   padding:8px 0;user-select:none}
.pc-debug-body{font-family:'IBM Plex Mono',monospace;font-size:11.5px;
               line-height:1.6;white-space:pre-wrap;word-break:break-word;
               background:#fff;border:1px solid var(--rule);padding:12px;
               max-height:320px;overflow:auto}
`;

const ERRORS = {
  'no-qr': 'อ่าน QR code ไม่ได้ — ต้องเห็น QR ในกรอบล่างทั้งอัน ชัดและใกล้ขึ้น',
  'no-identifiable-hn': 'QR อ่านได้แต่ไม่มี HN อยู่ในนั้น — ตรวจสอบว่าเป็นเอกสารที่ถูกต้อง',
  'sources-disagree': 'บาร์โค้ดกับ QR ให้ HN ไม่ตรงกัน — ตรวจสอบเอกสารแล้วถ่ายใหม่',
};

export default function PatientCapture({ onLog }) {
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [hn, setHn] = useState('');
  const [name, setName] = useState('');
  const [log, setLog] = useState([]);
  const [debug, setDebug] = useState(null);
  const [camera, setCamera] = useState(false);

  const evidenceRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!evidenceRef.current) return;
    if (!result?.evidence) { evidenceRef.current.replaceChildren(); return; }
    evidenceRef.current.replaceChildren(result.evidence);
  }, [result]);

  // Warm the model up front so the first capture is not the slow one.
  useEffect(() => { import('./lib/ocr').then((m) => m.initOcr()).catch(() => {}); }, []);

  const handleImage = useCallback(async (bitmap, meta = {}) => {
    if (!bitmap) return;
    setError(null);
    setResult(null);
    setStage('reading-barcode');

    try {
      const pre = preprocess(bitmap);
      setDebug({ at: new Date().toISOString(), ...meta, ...pre.debug, ok: pre.ok, error: pre.error, hn: pre.hn });

      if (!pre.ok) {
        setError(ERRORS[pre.error] ?? 'ประมวลผลภาพไม่สำเร็จ');
        setStage('idle');
        return;
      }

      // HN is settled by the QR before recognition is even loaded, so it is
      // shown straight away rather than waiting on the name.
      setHn(pre.hn);
      setStage('reading-name');
      const read = await readName(pre.band);
      setName(read.name);

      // The HN is also printed in plain digits in the band. Agreement makes it
      // a second independent source; disagreement is worth surfacing loudly,
      // since one of the two readings is wrong.
      const extraFlags = [];
      const sources = [...pre.hnSources];
      if (read.printedHn === pre.hn) sources.push('ตัวเลขในภาพ');
      else if (read.printedHn) {
        extraFlags.push(`HN ในภาพอ่านได้เป็น ${read.printedHn} ไม่ตรงกับ QR (${pre.hn}) — ตรวจสอบก่อนบันทึก`);
      }

      // Recording what recognition actually returned makes a parsing failure
      // visible in the panel instead of only showing up as an empty field.
      setDebug((d) => ({
        ...d,
        ocrLines: read.lines.map((l) => l.text),
        ocrName: read.name,
        ocrPrintedHn: read.printedHn,
      }));

      setResult({
        ...pre,
        ...read,
        hnSources: sources,
        evidence: (read.box && cropBox(pre.band, read.box)) ?? pre.band,
        flags: [...pre.warnings, ...read.flags, ...extraFlags],
      });
      setStage('done');
    } catch (e) {
      setDebug((d) => d ?? { at: new Date().toISOString(), ...meta, error: 'exception' });
      setError(e.message ?? 'ประมวลผลภาพไม่สำเร็จ');
      setStage('idle');
    }
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      await handleImage(bitmap, { fileName: file.name, fileSize: file.size, via: 'file' });
    } catch {
      setError('เปิดไฟล์ภาพไม่ได้');
      setStage('idle');
    }
  }, [handleImage]);

  const handleShot = useCallback(async (bitmap) => {
    setCamera(false);
    await handleImage(bitmap, { via: 'camera' });
  }, [handleImage]);

  const reset = () => {
    setResult(null); setHn(''); setName(''); setError(null); setStage('idle');
    if (fileRef.current) fileRef.current.value = '';
  };

  const commit = () => {
    const row = { hn, name, at: new Date().toISOString() };
    setLog((l) => [row, ...l]);
    onLog?.(row);
    reset();
  };

  const ready = hn.trim().length >= 4 && name.trim().length >= 3;
  const busy = stage === 'reading-barcode' || stage === 'reading-name';
  const status = stage === 'reading-barcode' ? 'กำลังอ่าน QR code…'
    : stage === 'reading-name' ? 'กำลังอ่านชื่อ…' : '';

  return (
    <div className="pc">
      <style>{STYLE}</style>
      {camera && (
        <CameraFrame
          onCapture={handleShot}
          onCancel={() => setCamera(false)}
          onFallback={() => { setCamera(false); fileRef.current?.click(); }}
        />
      )}
      <div className="pc-shell">
        <header className="pc-head">
          <div>
            <div className="pc-title">ลงทะเบียนผู้ป่วย</div>
            <div className="pc-sub">
              ถ่ายเฉพาะกรอบล่างของใบบันทึกการตรวจรักษา · ประมวลผลในเครื่อง ไม่ส่งข้อมูลออก
            </div>
          </div>
          <div className="pc-sub">{log.length} รายการในรอบนี้</div>
        </header>

        {!result ? (
          <section className="pc-panel">
            <div
              className="pc-drop"
              role="button"
              tabIndex={0}
              onClick={() => !busy && setCamera(true)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && setCamera(true)}
            >
              <b>{busy ? status : 'ถ่ายภาพกรอบล่าง'}</b>
              <span>
                ต้องเห็น <b>ทั้ง QR code และบรรทัด “ชื่อ-สกุลผู้ป่วย”</b> ในภาพเดียว
                คือกรอบล่างทั้งกรอบ · เอียงกี่องศาก็ได้ แต่ถือให้ขนานกับกระดาษ
              </span>
              <span className="pc-alt">
                กล้องจะขึ้นกรอบนำและบอกให้ก่อนกดถ่ายว่าภาพนี้อ่านได้หรือไม่
              </span>
            </div>
            <button className="pc-linkbtn" onClick={() => !busy && fileRef.current?.click()}>
              หรือเลือกไฟล์ภาพที่ถ่ายไว้แล้ว
            </button>
            <input ref={fileRef} type="file" accept="image/*"
                   hidden onChange={(e) => handleFile(e.target.files?.[0])} />
            {error && <div className="pc-err">{error}</div>}
          </section>
        ) : (
          <section className="pc-panel">
            {result.flags?.length > 0 && (
              <div className="pc-flags">
                <ul>{result.flags.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            )}

            <div className="pc-field">
              <div className="pc-label">
                <span>HN</span>
                <span className="pc-src ok">
                  {result.hnSources.length > 1
                    ? `ยืนยันตรงกัน ${result.hnSources.length} แหล่ง`
                    : 'จาก QR code (มีเช็คซัม)'}
                </span>
              </div>
              <input className="pc-input mono" value={hn} inputMode="numeric"
                     onChange={(e) => setHn(e.target.value.replace(/\D/g, ''))} aria-label="HN" />
            </div>

            <div className="pc-field">
              <div className="pc-label">
                <span>ชื่อ-สกุล</span>
                <span className="pc-src">ตรวจกับภาพด้านล่าง</span>
              </div>
              {result.evidence && <div className="pc-evidence" ref={evidenceRef} />}
              <input className="pc-input" value={name}
                     onChange={(e) => setName(e.target.value)} aria-label="ชื่อ-สกุล" />
            </div>

            <div className="pc-actions">
              <button className="pc-btn ghost" onClick={reset}>ถ่ายใหม่</button>
              <button className="pc-btn" disabled={!ready} onClick={commit}>
                ยืนยันและบันทึก
              </button>
            </div>
          </section>
        )}

        {log.length > 0 && (
          <section className="pc-panel pc-log">
            <table>
              <thead><tr><th>HN</th><th>ชื่อ-สกุล</th><th>เวลา</th></tr></thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.at}>
                    <td className="hn">{r.hn}</td>
                    <td>{r.name}</td>
                    <td>{new Date(r.at).toLocaleTimeString('th-TH')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {debug && (
          <details className="pc-panel pc-debug">
            <summary>
              ข้อมูลดีบัก ({debug.width}×{debug.height}px, {debug.attempts?.length ?? 0} ครั้ง)
            </summary>
            <pre className="pc-debug-body">{JSON.stringify(debug, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
