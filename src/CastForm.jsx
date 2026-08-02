import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import { preprocess, cropBox } from './lib/preprocess';
import { readName } from './lib/ocr';
import CameraFrame from './CameraFrame';
import CastIcon from './CastIcons';
import { CAST_TYPES, castLabel } from './lib/casts';
import { DOCTORS, doctorFullName } from './lib/doctors';
import BrandMark from './BrandMark';
import * as outbox from './lib/outbox';

/*
 * Palette taken from a four-swatch reference: a pale yellow, a yellow-green,
 * a mid green, and a near-black deep teal. The teal is the only swatch dark
 * enough to carry text or sit under white (12.9:1) — it is the single color
 * every interactive/selected/header surface agrees on. The three light
 * swatches are luminance-close to white (1.1-1.9:1 against it) and are used
 * only as soft tints, never for text: text on those tints is always the
 * teal, checked at 6.9:1 or better in every case.
 *
 * The hero stays plain per the last pass — solid teal, no gradient — but
 * now curves at the bottom rather than ending in a hard edge.
 */
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

.cf2{--primary:#073835;--primary-700:#052624;--primary-100:#E9F7ED;
     --pale:#FAFFA3;--pale-100:#FCFFCE;
     --moss:#C6E772;--moss-100:#EAF6CE;
     --leaf:#66D47E;--leaf-100:#DCF5E2;
     --warn:#C2410C;--warn-soft:#FFEDD5;
     --ink:#181B24;--ink-2:#585F6E;
     --surface:#F8FAF3;--card:#FFFFFF;--border:#E3E6ED;--border-strong:#7A9B93;
     font-family:'Noto Sans Thai',system-ui,sans-serif;color:var(--ink);letter-spacing:.015em;
     background:var(--surface);min-height:100vh;padding-bottom:100px}
.cf2 *{box-sizing:border-box}
.cf2 :focus-visible{outline:2.5px solid var(--primary);outline-offset:2px}

/* A livelier header than the near-black teal it replaces: a three-stop sweep
   from deep emerald through to a bright grass green, shifting hue as well as
   lightness so it reads as a real gradient rather than one colour fading.
   #12873C is as bright as this can go — at 4.61:1 against white it is the
   last step that still clears AA for normal text, and every stop is checked
   against white rather than only the endpoints. The header is the one place
   these greens appear; --primary stays the teal everything else agrees on. */
.cf2-hero{background:linear-gradient(135deg,#06543A 0%,#0E7A3F 55%,#12873C 100%);
          border-radius:0 0 28px 28px;
          padding:22px 20px 26px;display:flex;align-items:center;gap:14px;
          box-shadow:0 4px 16px rgba(6,84,58,.22)}
.cf2-title{font-size:24px;font-weight:700;letter-spacing:.02em;color:#fff}
/* Full white, not the .88 it used to carry: against the brighter end of the
   new gradient that fade dropped the subtitle to 3.95:1, under the 4.5:1 it
   needs at this size. Hierarchy comes from size and weight instead. */
.cf2-sub{font-size:15px;color:#fff;margin-top:3px}

.cf2-shell{max-width:640px;margin:0 auto;padding:16px;
           display:flex;flex-direction:column;gap:14px}

.cf2-card{background:var(--card);border:1px solid var(--border);
          border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(24,27,36,.04)}
.cf2-step{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.cf2-step-n{width:26px;height:26px;border-radius:50%;background:var(--primary-100);
            color:var(--primary-700);font-weight:600;font-size:13px;flex:none;
            display:flex;align-items:center;justify-content:center}
.cf2-step-n.pale{background:var(--pale-100);color:var(--primary)}
.cf2-step-n.moss{background:var(--moss-100);color:var(--primary)}
.cf2-step-t{font-size:15.5px;font-weight:600}

/* iOS Safari renders <input type="date"> as its own control with a fixed
   minimum height and internal line-height; when the box didn't leave room
   for that, the rendered value sat taller than the field and visually broke
   out past the rounded border on top and bottom. appearance:none hands the
   box model fully to this CSS, min-height matches what iOS actually needs,
   and the value pseudo-element is pinned to left-align at normal line-height
   instead of being centered against the native control's own metrics. */
.cf2-date{-webkit-appearance:none;appearance:none;
          width:100%;min-height:48px;box-sizing:border-box;
          border:1.5px solid var(--border-strong);border-radius:12px;
          background:var(--surface);padding:12px 14px;font-family:inherit;
          font-size:16px;font-weight:500;line-height:1.3;color:var(--ink)}
.cf2-date::-webkit-date-and-time-value{text-align:left;min-height:20px}
.cf2-date:focus-visible{outline:none;border-color:var(--primary);
                        box-shadow:0 0 0 3px var(--primary-100)}

/* Doctor picker is a native <select> rather than a badge grid: one large,
   high-contrast control reads far more easily for elderly staff than a
   14-item grid of small pill buttons, and a dropdown scales to any list
   length without the layout getting cramped. Sized well past the 44px
   touch-target minimum and set in large, bold text for readability. */
.cf2-doctorlabel{font-size:17px;font-weight:700;letter-spacing:normal;
                 text-transform:none;color:var(--ink);margin-bottom:8px;display:block}
.cf2-selectwrap{position:relative;margin-top:0}
.cf2-doctorselect{-webkit-appearance:none;appearance:none;width:100%;
                  border:2px solid var(--border-strong);border-radius:14px;
                  background:var(--surface);color:var(--ink);font-family:inherit;
                  padding:16px 46px 16px 18px;font-size:20px;font-weight:600;
                  line-height:1.3;cursor:pointer}
.cf2-doctorselect:hover{border-color:var(--primary)}
.cf2-doctorselect:focus-visible{outline:none;border-color:var(--primary);
                                box-shadow:0 0 0 4px var(--primary-100)}
.cf2-selectwrap::after{content:'';position:absolute;right:20px;top:50%;
                       width:12px;height:12px;border-right:3px solid var(--primary);
                       border-bottom:3px solid var(--primary);
                       transform:translateY(-70%) rotate(45deg);pointer-events:none}

.cf2-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:8px;min-height:140px;border:1.5px dashed var(--border-strong);border-radius:14px;
          background:var(--surface);text-align:center;padding:24px;cursor:pointer}
.cf2-drop:hover,.cf2-drop:focus-visible{border-color:var(--primary);outline:none}
.cf2-drop b{font-size:18px;font-weight:600;color:var(--ink)}
.cf2-drop span{font-size:15px;color:var(--ink-2);max-width:36ch;line-height:1.6}
.cf2-linkbtn{display:block;margin:12px auto 0;background:none;border:none;
             font-family:inherit;font-size:14px;color:var(--primary);
             text-decoration:underline;cursor:pointer;padding:6px}

.cf2-evidence{border-radius:12px;overflow:hidden;background:#fff;
              border:1.5px solid var(--border);line-height:0;margin:10px 0}
.cf2-evidence canvas{width:100%;display:block}
.cf2-field{margin-top:12px}
.cf2-label{display:flex;justify-content:space-between;align-items:baseline;
           font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
           color:var(--ink-2);margin-bottom:6px}
.cf2-src{font-weight:600;text-transform:none;letter-spacing:inherit;color:var(--primary)}
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
/* Sits directly under the field it belongs to, left-aligned with the box, so
   it reads as that field's problem rather than the form's. The soft variant is
   the still-incomplete nudge, which is not yet a mistake. */
.cf2-fielderr{font-size:13px;line-height:1.6;margin-top:6px;color:var(--warn);font-weight:500}
.cf2-fielderr.soft{color:var(--ink-2);font-weight:400}
.cf2-status{font-size:13.5px;color:var(--primary);text-align:center;padding:10px 0;font-weight:500}

.cf2-castgrid{display:flex;flex-wrap:wrap;gap:18px 26px}
.cf2-castrow{display:flex;align-items:center;gap:10px}
/* --icon-bg is the badge's own background, handed to the icon so the seams
   it cuts across each cast read as gaps on both the unselected and the
   selected badge without the icon tracking state itself. */
.cf2-castbtn{--icon-bg:var(--surface);
            flex:none;width:fit-content;white-space:nowrap;
            border:1.5px solid var(--border-strong);
            background:var(--surface);color:var(--ink);
            border-radius:999px;padding:10px 20px;cursor:pointer;font-family:inherit;
            font-size:16px;font-weight:500;text-align:center;
            display:inline-flex;align-items:center;justify-content:center;gap:14px}
.cf2-castbtn:hover{border-color:var(--primary);color:var(--primary-700)}
.cf2-castbtn.active{--icon-bg:var(--primary);
                    border-color:var(--primary);background:var(--primary);color:#fff;
                    font-weight:600;box-shadow:0 3px 10px rgba(7,56,53,.28)}
.cf2-castbtn-icon{flex:none;display:flex;align-items:center;color:inherit}

/* The quantity stepper sits to the right of its badge. Zero-state is
   deliberately faint — the count only earns full contrast once a tap has
   made it mean something. */
.cf2-counter{flex:none;display:flex;align-items:center;gap:2px;
            border:1.5px solid var(--border-strong);border-radius:999px;
            padding:3px;background:var(--surface)}
.cf2-counter.zero{opacity:.5}
.cf2-counter-btn{width:26px;height:26px;border-radius:50%;border:none;background:none;
                 color:var(--primary);font-size:16px;font-weight:700;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;line-height:1}
.cf2-counter-btn:hover:not(:disabled){background:var(--primary-100)}
.cf2-counter-btn:disabled{color:var(--ink-2);cursor:not-allowed}
.cf2-counter-n{min-width:18px;text-align:center;font-size:14px;font-weight:600;color:var(--ink)}

/* One column per row on a phone: badges are easier to hit and read stacked
   than wrapped into a ragged multi-per-row grid at narrow widths. Each row
   centers in the column rather than stretching full width, so a short label
   like "U Slab" doesn't turn into an oddly empty bar. */
@media (max-width:480px){
  .cf2-castgrid{flex-direction:column;align-items:center}
}


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
         display:flex;flex-direction:column;align-items:center;z-index:10}
.cf2-submit{width:100%;max-width:608px;padding:15px;border-radius:14px;border:none;
           background:var(--primary);color:#fff;font-family:inherit;font-size:16px;
           font-weight:600;cursor:pointer}
.cf2-submit:hover:not(:disabled){background:var(--primary-700)}
.cf2-submit:disabled{background:#DDE0E7;color:#9AA0AC;cursor:not-allowed}

.cf2-log{margin-top:4px}
.cf2-log-title{font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:10px}
.cf2-entry{background:var(--card);border:1px solid var(--border);
          border-radius:14px;padding:14px 16px;margin-bottom:10px;position:relative}
.cf2-entry-top{display:flex;justify-content:space-between;align-items:baseline;
               font-size:13px;color:var(--ink-2);margin-bottom:4px}
.cf2-entry-name{font-size:15px;font-weight:600}
.cf2-entry-doctor{font-size:12.5px;color:var(--ink-2);margin-top:2px}
.cf2-entry-hn{font-family:'IBM Plex Mono',monospace;font-weight:600;color:var(--primary)}
.cf2-entry-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.cf2-entry-chip{background:var(--primary-100);color:var(--primary-700);border-radius:999px;
                padding:4px 10px;font-size:11.5px;font-weight:500}
/* A "sent" entry carries no badge at all — that is the expected outcome and
   does not need to compete for attention with the two that do. */
.cf2-sync{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;flex:none}
.cf2-sync.pending{background:var(--pale-100);color:#8A6D1A}
.cf2-sync.failed{background:var(--warn-soft);color:var(--warn)}
.cf2-outbox-note{font-size:12.5px;color:var(--ink-2);text-align:center;padding:0 0 8px}

/* The record just saved gets a halo that cycles through the app's own
   four-swatch palette (pale → moss → leaf), then settles to a plain leaf
   border once it's made its point — a logging screen with a permanent
   pulse turns into noise. Because each new record is a fresh DOM node
   (prepended, keyed by id), the animation always plays once from the
   start; it never replays on unrelated re-renders. */
.cf2-entry.is-new{border-color:var(--leaf)}
.cf2-entry.is-new::before{
  content:'';position:absolute;inset:-9px;border-radius:21px;
  background:linear-gradient(120deg,var(--leaf),var(--moss),var(--pale),var(--leaf-100),var(--leaf));
  background-size:300% 300%;filter:blur(14px);z-index:-1;pointer-events:none;
  animation:cf2-glow-hue 2s ease-in-out 2, cf2-glow-fade 4s ease-out forwards;
}
.cf2-entry.is-new::after{
  content:'ล่าสุด';position:absolute;top:-9px;left:14px;
  background:var(--leaf);color:#05301A;font-size:11px;font-weight:700;
  letter-spacing:.03em;padding:2px 9px;border-radius:999px;
}
@keyframes cf2-glow-hue{
  0%,100%{background-position:0% 50%}
  50%{background-position:100% 50%}
}
@keyframes cf2-glow-fade{
  0%{opacity:.9}
  70%{opacity:.6}
  100%{opacity:0}
}
@media (prefers-reduced-motion: reduce){
  .cf2-entry.is-new::before{animation:none;opacity:.5;filter:blur(10px)}
}

/* Sits directly under the last submitted card rather than floating over
   the page — its place in the list is what tells you it belongs to what's
   above. The ongoing pulse is deliberately gentle: this button lives for
   as long as the log does, so unlike the one-shot card glow it can't just
   play once and settle — it has to stay legible without becoming noise. */
.cf2-totop{width:100%;margin-top:2px;display:flex;align-items:center;justify-content:center;
          gap:8px;height:56px;border:none;border-radius:14px;
          background:var(--leaf);color:#05301A;
          font-family:inherit;font-size:17px;font-weight:700;cursor:pointer;
          animation:cf2-totop-glow 2.6s ease-in-out infinite}
.cf2-totop:active{background:var(--moss)}
.cf2-totop svg{flex:none}
@keyframes cf2-totop-glow{
  0%,100%{box-shadow:0 0 0 0 rgba(102,212,126,.5),0 2px 8px rgba(7,56,53,.16)}
  50%{box-shadow:0 0 20px 7px rgba(102,212,126,.5),0 2px 8px rgba(7,56,53,.16)}
}
@media (prefers-reduced-motion: reduce){
  .cf2-totop{animation:none;box-shadow:0 2px 8px rgba(7,56,53,.16)}
}
`;

// HN at this hospital is always a 7-digit number. Both the manual-entry
// field and the field showing a QR-read HN funnel through this on every
// keystroke, so a pasted or mistyped non-digit — or an 8th digit — is
// rejected with the same message everywhere rather than silently truncated.
const HN_LEN = 7;
function sanitizeHn(raw) {
  const digits = raw.replace(/\D/g, '');
  // Report the reason, not just that something was wrong: "only digits" and
  // "no more than 7" are different mistakes and the field says which.
  const error = digits.length !== raw.length ? 'กรอกได้เฉพาะตัวเลข 0-9 เท่านั้น'
    : digits.length > HN_LEN ? `HN ยาวเกิน — ต้องมี ${HN_LEN} หลัก`
    : null;
  return { value: digits.slice(0, HN_LEN), error };
}

/** What to say under the box about the value currently in it. */
function hnHint(value) {
  if (!value) return null;
  return value.length < HN_LEN ? `ต้องมีให้ครบ ${HN_LEN} หลัก` : null;
}

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
  const [doctorId, setDoctorId] = useState(null);

  const [photoStage, setPhotoStage] = useState('idle');
  const [photoError, setPhotoError] = useState(null);
  const [capture, setCapture] = useState(null);
  const [hn, setHn] = useState('');
  const [hnError, setHnError] = useState(null);
  const [name, setName] = useState('');
  const [camera, setCamera] = useState(false);

  // Typing the patient in by hand, for when there is no slip to photograph
  // or the QR simply will not read. Same two fields the photo path fills in,
  // so a hand-entered record carries exactly what a scanned one does.
  const [manual, setManual] = useState(false);

  // A count per cast type rather than a plain selection, so the same badge
  // can record e.g. two buddy splints in one visit. The badge is still a
  // single tap target: tapping it steps the count 0→1 or back to 0, while a
  // +/− stepper to its right reaches counts beyond 1.
  const [castItems, setCastItems] = useState(new Map());
  const [log, setLog] = useState([]);
  const [outboxPending, setOutboxPending] = useState(0);

  const scrollToTop = () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const setCastCount = (id, count) => {
    setCastItems((prev) => {
      const next = new Map(prev);
      count > 0 ? next.set(id, count) : next.delete(id);
      return next;
    });
  };

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
    setHnError(null);
    setManual(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const toggleCastType = (id) => {
    setCastCount(id, castItems.has(id) ? 0 : 1);
  };

  // A rejected keystroke leaves a message under the box rather than a modal:
  // the operator is mid-typing, and a dialog steals the keyboard to say
  // something the field itself can say without interrupting anyone.
  const changeHn = (raw) => {
    const { value, error } = sanitizeHn(raw);
    setHn(value);
    setHnError(error);
  };

  const photoBusy = photoStage === 'reading-barcode' || photoStage === 'reading-name';
  const photoStatus = photoStage === 'reading-barcode' ? 'กำลังอ่าน QR code…'
    : photoStage === 'reading-name' ? 'กำลังอ่านชื่อ…' : '';

  const canSubmit = date && doctorId && hn.trim().length === HN_LEN && name.trim().length >= 3
    && castItems.size > 0 && !photoBusy;

  // POSTs one queued visit. The outbox decides whether a failure here is
  // worth retrying: a 4xx means the server already rejected the shape of
  // the data, and sending the same bytes again would just fail again.
  const sendToServer = useCallback(async (visit) => {
    try {
      const r = await fetch('/api/log', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(visit),
      });
      if (r.ok) return { ok: true };
      return { ok: false, retry: r.status >= 500 || r.status === 429 };
    } catch {
      return { ok: false, retry: true };
    }
  }, []);

  // Flushes the outbox, then reconciles each visible log entry's sync badge
  // against what is still queued — anything no longer pending or failed in
  // the outbox has been confirmed sent, and clearSettled() lets it drop out
  // of localStorage once the UI no longer needs it there.
  const syncOutbox = useCallback(async () => {
    await outbox.flush(sendToServer);
    const stillQueued = new Map(outbox.list().map((r) => [r.visit.visit_id, r.status]));
    setLog((l) => l.map((entry) => ({
      ...entry,
      sync: stillQueued.get(entry.visitId) ?? 'sent',
    })));
    outbox.clearSettled();
    setOutboxPending(outbox.pendingCount());
  }, [sendToServer]);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const scheduleNext = () => {
      if (cancelled) return;
      const queued = outbox.list().filter((r) => r.status === 'pending');
      if (queued.length === 0) return;
      const attempts = Math.max(...queued.map((r) => r.attempts));
      timer = setTimeout(runSync, outbox.backoffMs(attempts + 1));
    };
    const runSync = async () => {
      await syncOutbox();
      scheduleNext();
    };

    runSync(); // catches anything left queued from a previous page load
    window.addEventListener('online', runSync);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('online', runSync);
    };
  }, [syncOutbox]);

  const submit = () => {
    if (!canSubmit) return;
    const visitId = crypto.randomUUID();
    const casts = [...castItems].map(([id, count]) => ({ id, count }));
    const entry = {
      id: `${Date.now()}`,
      visitId,
      date,
      hn: hn.trim(),
      name: name.trim(),
      doctorName: doctorFullName(doctorId),
      casts,
      at: new Date().toISOString(),
      sync: 'pending',
    };
    outbox.enqueue({
      visit_id: visitId,
      shift_date: date,
      hn: hn.trim(),
      name: name.trim(),
      doctor_id: doctorId,
      source: manual ? 'manual' : 'qr',
      casts,
    });
    setOutboxPending(outbox.pendingCount());
    setLog((l) => [entry, ...l]);
    onLog?.(entry);
    resetPhoto();
    setCastItems(new Map());
    syncOutbox();
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
        <BrandMark size={44} />
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

          <div className="cf2-field">
            <label className="cf2-doctorlabel" htmlFor="cf2-doctor-select">เลือกแพทย์</label>
            <div className="cf2-selectwrap">
              <select
                id="cf2-doctor-select"
                className="cf2-doctorselect"
                value={doctorId ?? ''}
                onChange={(e) => setDoctorId(e.target.value || null)}
              >
                <option value="" disabled>-- เลือกแพทย์ --</option>
                {DOCTORS.map((d) => (
                  <option key={d.id} value={d.id}>{d.fullName}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="cf2-card">
          <div className="cf2-step">
            <span className="cf2-step-n pale">2</span>
            <span className="cf2-step-t">ถ่ายรูปใบรับยา</span>
          </div>

          {/* Mounted whatever the step is showing: the camera screen's own
              "เลือกไฟล์" fallback reaches this input through the same ref.
              No `capture` attribute — that was tried as a workaround for a
              suspected getUserMedia gap in the LIFF-iOS webview, but the
              live preview turned out to work fine, and `capture` forced this
              button (labelled "choose a file") straight into the camera
              instead of the actual file/photo picker it's supposed to open. */}
          <input ref={fileRef} type="file" accept="image/*" hidden
                 onChange={(e) => handleFile(e.target.files?.[0])} />

          {!capture && manual ? (
            <>
              <div className="cf2-field">
                <div className="cf2-label"><span>HN</span></div>
                <input className="cf2-input mono" value={hn} inputMode="numeric"
                       onChange={(e) => changeHn(e.target.value)} aria-label="HN"
                       aria-invalid={Boolean(hnError)}
                       aria-describedby={hnError || hnHint(hn) ? 'cf2-hn-msg' : undefined} />
                {(hnError || hnHint(hn)) && (
                  <div id="cf2-hn-msg" className={`cf2-fielderr ${hnError ? '' : 'soft'}`} role="status">
                    {hnError ?? hnHint(hn)}
                  </div>
                )}
              </div>
              <div className="cf2-field">
                <div className="cf2-label"><span>ชื่อ-สกุล</span></div>
                <input className="cf2-input" value={name}
                       onChange={(e) => setName(e.target.value)} aria-label="ชื่อ-สกุล" />
                <div className="cf2-fielderr soft">อย่าลืมใส่คำนำหน้านะ</div>
              </div>
              <button className="cf2-linkbtn"
                      onClick={() => { setManual(false); setHn(''); setName(''); setHnError(null); }}>
                หรือถ่ายภาพ
              </button>
            </>
          ) : !capture ? (
            <>
              <div
                className="cf2-drop"
                role="button"
                tabIndex={0}
                onClick={() => !photoBusy && setCamera(true)}
                onKeyDown={(e) => e.key === 'Enter' && !photoBusy && setCamera(true)}
              >
                <b>{photoBusy ? photoStatus : 'แตะเพื่อถ่ายภาพ'}</b>
                <span>ถ่ายให้เห็นกรอบสีดำ</span>
              </div>
              <button className="cf2-linkbtn" onClick={() => !photoBusy && setManual(true)}>
                หรือกรอกชื่อ
              </button>
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
                       onChange={(e) => changeHn(e.target.value)} aria-label="HN"
                       aria-invalid={Boolean(hnError)}
                       aria-describedby={hnError || hnHint(hn) ? 'cf2-hn-msg' : undefined} />
                {(hnError || hnHint(hn)) && (
                  <div id="cf2-hn-msg" className={`cf2-fielderr ${hnError ? '' : 'soft'}`} role="status">
                    {hnError ?? hnHint(hn)}
                  </div>
                )}
              </div>

              <div className="cf2-field">
                <div className="cf2-label">
                  <span>ชื่อ-สกุล</span>
                  <span className="cf2-src">ตรวจกับภาพด้านล่าง</span>
                </div>
                {capture.evidence && <div className="cf2-evidence" ref={evidenceRef} />}
                <input className="cf2-input" value={name}
                       onChange={(e) => setName(e.target.value)} aria-label="ชื่อ-สกุล" />
                <div className="cf2-fielderr soft">อย่าลืมใส่คำนำหน้านะ</div>
              </div>

              <button className="cf2-retake" onClick={resetPhoto}>ถ่ายใหม่</button>
            </>
          )}
        </section>

        <section className="cf2-card">
          <div className="cf2-step">
            <span className="cf2-step-n moss">3</span>
            <span className="cf2-step-t">ใส่เฝือกแบบไหน ?</span>
          </div>

          <div className="cf2-castgrid">
            {CAST_TYPES.map((t, i) => {
              // Alternate which edge the icon sits at, badge by badge: right
              // on the 1st, left on the 2nd, right on the 3rd, and so on.
              const iconRight = i % 2 === 0;
              const icon = <span className="cf2-castbtn-icon"><CastIcon id={t.id} /></span>;
              const count = castItems.get(t.id) ?? 0;
              return (
                <div className="cf2-castrow" key={t.id}>
                  <button
                    type="button"
                    className={`cf2-castbtn ${count > 0 ? 'active' : ''}`}
                    aria-pressed={count > 0}
                    onClick={() => toggleCastType(t.id)}
                  >
                    {iconRight ? <>{t.label}{icon}</> : <>{icon}{t.label}</>}
                  </button>
                  <div className={`cf2-counter ${count > 0 ? '' : 'zero'}`}>
                    <button type="button" className="cf2-counter-btn" disabled={count === 0}
                            onClick={() => setCastCount(t.id, count - 1)}
                            aria-label={`ลดจำนวน ${t.label}`}>−</button>
                    <span className="cf2-counter-n">{count}</span>
                    <button type="button" className="cf2-counter-btn"
                            onClick={() => setCastCount(t.id, count + 1)}
                            aria-label={`เพิ่มจำนวน ${t.label}`}>+</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="cf2-chips">
            {castItems.size === 0
              ? <span className="cf2-empty">ยังไม่ได้เลือกเฝือก — แตะที่รายการด้านบน</span>
              : [...castItems].map(([id, count]) => (
                <span className="cf2-chip" key={id}>
                  {castLabel(id)}{count > 1 ? ` ×${count}` : ''}
                  <button onClick={() => setCastCount(id, 0)} aria-label={`เอา ${castLabel(id)} ออก`}>×</button>
                </span>
              ))}
          </div>
        </section>

        {log.length > 0 && (
          <section className="cf2-log">
            <div className="cf2-log-title">{log.length} รายการในรอบนี้</div>
            {log.map((r, i) => (
              <Fragment key={r.id}>
                <div className={`cf2-entry ${i === 0 ? 'is-new' : ''}`}>
                  <div className="cf2-entry-top">
                    <span>{r.date}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.sync === 'pending' && <span className="cf2-sync pending">รอส่ง</span>}
                      {r.sync === 'failed' && <span className="cf2-sync failed">ส่งไม่สำเร็จ</span>}
                      <span className="cf2-entry-hn">{r.hn}</span>
                    </span>
                  </div>
                  <div className="cf2-entry-name">{r.name}</div>
                  <div className="cf2-entry-doctor">{r.doctorName}</div>
                  <div className="cf2-entry-chips">
                    {r.casts.map(({ id, count }) => (
                      <span className="cf2-entry-chip" key={id}>
                        {castLabel(id)}{count > 1 ? ` ×${count}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
                {i === 0 && log.length > 1 && (
                  <button
                    type="button"
                    className="cf2-totop"
                    onClick={scrollToTop}
                    aria-label="เลื่อนขึ้นบนสุด"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor"
                            strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>ขึ้นบน</span>
                  </button>
                )}
              </Fragment>
            ))}
          </section>
        )}
      </div>

      <div className="cf2-bar">
        {outboxPending > 0 && (
          <div className="cf2-outbox-note">
            กำลังส่งข้อมูล {outboxPending} รายการ — อย่าปิดแอปจนกว่าจะส่งครบ
          </div>
        )}
        <button className="cf2-submit" disabled={!canSubmit} onClick={submit}>
          บันทึกข้อมูล
        </button>
      </div>
    </div>
  );
}
