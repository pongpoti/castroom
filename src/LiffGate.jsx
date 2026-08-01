import { useState, useEffect } from 'react';
import { environmentVerdict } from './lib/gate';

/**
 * LiffGate — nothing renders until this says who is holding the phone.
 *
 * Two checks in order. First the environment: the app must be running inside
 * the LINE client on a phone or tablet, which is `environmentVerdict`. Then
 * the person: the ID token LIFF issued goes to /api/auth, which is where the
 * allowlist actually lives. Only the second check is authoritative — this
 * component runs in a browser the user controls, so treat everything it
 * decides as a courtesy to honest users rather than a barrier to dishonest
 * ones. The barrier is the session cookie /api/auth sets and the server
 * requiring it.
 */

const STYLE = `
.lg{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:16px;padding:36px 28px;text-align:center;
    font-family:'Noto Sans Thai',system-ui,sans-serif;letter-spacing:.015em;
    background:linear-gradient(135deg,#06543A 0%,#0E7A3F 55%,#12873C 100%);color:#fff}
.lg-icon{width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,.94);
         display:flex;align-items:center;justify-content:center;flex:none}
.lg-t{font-size:21px;font-weight:700}
.lg-m{font-size:15.5px;line-height:1.75;max-width:34ch}
.lg-hint{font-size:13.5px;line-height:1.7;max-width:34ch;opacity:.85}
.lg-code{font-family:'IBM Plex Mono',monospace;font-size:12.5px;opacity:.7;margin-top:4px}
.lg-btn{margin-top:6px;background:#fff;color:#06543A;border:none;border-radius:12px;
        padding:13px 26px;font-family:inherit;font-size:15.5px;font-weight:600;cursor:pointer}
`;

/* Deliberately no "open anyway". A blocked state that offers a way past
   itself is decoration, so each of these ends the road. */
const BLOCKED = {
  'not-configured': {
    title: 'ยังไม่ได้ตั้งค่า',
    message: 'แอปนี้ยังไม่ได้ตั้งค่า LIFF — ติดต่อผู้ดูแลระบบ',
  },
  'init-failed': {
    title: 'เชื่อมต่อ LINE ไม่สำเร็จ',
    message: 'เปิดแอปใหม่อีกครั้ง หากยังไม่ได้ ให้ติดต่อผู้ดูแลระบบ',
  },
  'external-browser': {
    title: 'เปิดผ่าน LINE เท่านั้น',
    message: 'กรุณาเปิดแอปนี้จากแชท LINE ของห้องเฝือก ไม่สามารถใช้ผ่านเบราว์เซอร์ทั่วไปได้',
  },
  desktop: {
    title: 'ใช้บนมือถือหรือแท็บเล็ตเท่านั้น',
    message: 'กรุณาเปิดแอปนี้ใน LINE บนมือถือหรือแท็บเล็ต ไม่รองรับบนคอมพิวเตอร์',
  },
  'not-allowed': {
    title: 'ไม่มีสิทธิ์เข้าใช้งาน',
    message: 'บัญชี LINE นี้ยังไม่ได้รับสิทธิ์ — ทักแชทหาบัญชีทางการของห้องเฝือก แล้วแจ้งผู้ดูแลระบบเพื่อเพิ่มสิทธิ์',
  },
  'auth-failed': {
    title: 'ตรวจสอบสิทธิ์ไม่สำเร็จ',
    message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง',
  },
};

function Screen({ verdict, onRetry }) {
  const { title, message } = BLOCKED[verdict] ?? BLOCKED['auth-failed'];
  const retryable = verdict === 'auth-failed' || verdict === 'init-failed';
  return (
    <div className="lg">
      <style>{STYLE}</style>
      <div className="lg-icon">
        <svg width="34" height="34" viewBox="0 0 64 64" fill="none">
          <rect x="10" y="24" width="44" height="20" rx="10" fill="#fff" stroke="#06543A" strokeWidth="3.5" />
          <path d="M18 24v20M28 24v20M38 24v20M48 24v20" stroke="#06543A" strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      </div>
      <div className="lg-t">{title}</div>
      <div className="lg-m">{message}</div>
      {retryable && <button className="lg-btn" onClick={onRetry}>ลองใหม่</button>}
      <div className="lg-code">{verdict}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className="lg">
      <style>{STYLE}</style>
      <div className="lg-m">กำลังตรวจสอบสิทธิ์…</div>
    </div>
  );
}

export default function LiffGate({ children }) {
  const [verdict, setVerdict] = useState('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const settle = (v) => { if (!cancelled) setVerdict(v); };

    (async () => {
      setVerdict('checking');
      const liffId = import.meta.env.VITE_LIFF_ID;

      // A dev build may skip the gate so the form can be worked on without a
      // phone. import.meta.env.DEV is compiled to a literal false by
      // `vite build`, so this branch cannot exist in a deployed bundle.
      if (import.meta.env.DEV && import.meta.env.VITE_LIFF_DEV_BYPASS === '1') {
        return settle('ok');
      }

      if (!liffId) return settle('not-configured');

      let liff;
      try {
        ({ default: liff } = await import('@line/liff'));
        await liff.init({ liffId });
      } catch {
        return settle('init-failed');
      }

      const env = environmentVerdict({
        configured: true,
        initFailed: false,
        inClient: liff.isInClient(),
        os: liff.getOS(),
      });
      if (env !== 'ok') return settle(env);

      if (!liff.isLoggedIn()) {
        liff.login();       // navigates away; nothing after this runs
        return undefined;
      }

      // The user id is never sent from here. The ID token is, and the server
      // asks LINE what it means — see api/auth.js.
      let idToken;
      try {
        idToken = liff.getIDToken();
      } catch {
        return settle('auth-failed');
      }
      if (!idToken) return settle('auth-failed');

      try {
        const r = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });
        if (r.ok) return settle('ok');
        if (r.status === 403) return settle('not-allowed');
        return settle('auth-failed');
      } catch {
        return settle('auth-failed');
      }
    })();

    return () => { cancelled = true; };
  }, [attempt]);

  if (verdict === 'checking') return <Loading />;
  if (verdict === 'ok') return children;
  return <Screen verdict={verdict} onRetry={() => setAttempt((n) => n + 1)} />;
}
