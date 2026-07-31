import { useState, useRef, useCallback, useEffect } from 'react';
import { preprocess } from '../lib/preprocess';
import { readName } from '../lib/ocr';

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
.pc-drop span{font-size:13px;color:var(--ink-2);max-width:38ch;line-height:1.6}

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
`;

const ERRORS = {
  'no-identifiable-hn': 'อ่านบาร์โค้ดไม่ได้ — ถ่ายให้เห็นกรอบล่างทั้งกรอบ ชัดและใกล้ขึ้น',
  'sources-disagree': 'บาร์โค้ดกับ QR ให้ HN ไม่ตรงกัน — ตรวจสอบเอกสารแล้วถ่ายใหม่',
  'image-upside-down': 'ภาพกลับหัวและแก้อัตโนมัติไม่สำเร็จ — ถ่ายใหม่',
  'no-frame': 'หาตำแหน่งอ้างอิงไม่ครบ — ต้องเห็นบาร์โค้ดทั้งสองและ QR ในภาพเดียว',
};

export default function PatientCapture({ onLog }) {
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [hn, setHn] = useState('');
  const [name, setName] = useState('');
  const [log, setLog] = useState([]);

  const evidenceRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!result?.nameCanvas || !evidenceRef.current) return;
    evidenceRef.current.replaceChildren(result.nameCanvas);
  }, [result]);

  // Warm the model up front so the first capture is not the slow one.
  useEffect(() => { import('../lib/ocr').then((m) => m.initOcr()).catch(() => {}); }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setStage('reading-barcode');

    try {
      const bitmap = await createImageBitmap(file);
      const pre = preprocess(bitmap);

      if (!pre.ok) {
        setError(ERRORS[pre.error] ?? 'ประมวลผลภาพไม่สำเร็จ');
        setStage('idle');
        return;
      }

      setHn(pre.hn);
      setStage('reading-name');
      const read = await readName(pre.nameCanvas);
      setName(read.name);
      setResult({ ...pre, ...read, flags: [...pre.warnings, ...read.flags] });
      setStage('done');
    } catch (e) {
      setError(e.message ?? 'ประมวลผลภาพไม่สำเร็จ');
      setStage('idle');
    }
  }, []);

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
  const status = stage === 'reading-barcode' ? 'กำลังอ่านบาร์โค้ด…'
    : stage === 'reading-name' ? 'กำลังอ่านชื่อ…' : '';

  return (
    <div className="pc">
      <style>{STYLE}</style>
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
              onClick={() => !busy && fileRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && !busy && fileRef.current?.click()}
            >
              <b>{busy ? status : 'ถ่ายภาพกรอบล่าง'}</b>
              <span>
                ให้เห็นบาร์โค้ดทั้งสองและ QR code ในภาพเดียว
                เอียงได้ถึงประมาณ 45 องศา กว้างอย่างน้อย 1500 พิกเซล
              </span>
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment"
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
                <span className={`pc-src ${result.hnSources.length > 1 ? 'ok' : 'weak'}`}>
                  ยืนยันตรงกัน {result.hnSources.length} แหล่ง
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
              <div className="pc-evidence" ref={evidenceRef} />
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
      </div>
    </div>
  );
}
