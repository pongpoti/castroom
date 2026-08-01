/**
 * CastIcons.jsx — one small pictogram per cast type.
 *
 * Same visual language throughout: a thin line is the limb, a thick rounded
 * capsule is where the cast actually sits on it. Position and length of that
 * capsule are what distinguish the ten icons — U Slab's capsule sits only at
 * the very top (shoulder), Long Arm's spans nearly the whole line, Short Arm's
 * sits low (wrist) — so the icon carries real information rather than being
 * decoration, and needs no separate legend.
 *
 * Every stroke uses currentColor, so an icon automatically matches its badge's
 * text color in every state (default, hover, active/white) with no extra CSS.
 */

const STROKE = 2.4;

function Limb({ capsuleY, capsuleH, capsuleX = 8, capsuleW = 4 }) {
  return (
    <svg width="18" height="30" viewBox="0 0 18 30" fill="none" aria-hidden="true">
      <line x1="9" y1="2" x2="9" y2="28" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".45" />
      <rect x={capsuleX} y={capsuleY} width={capsuleW} height={capsuleH} rx={capsuleW / 2}
        stroke="currentColor" strokeWidth={STROKE} fill="none" />
    </svg>
  );
}

function Hand({ markX }) {
  return (
    <svg width="18" height="30" viewBox="0 0 18 30" fill="none" aria-hidden="true">
      <line x1="9" y1="2" x2="9" y2="20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".45" />
      <rect x="4" y="18" width="10" height="9" rx="4" stroke="currentColor" strokeWidth="1.6" fill="none" opacity=".45" />
      <circle cx={markX} cy="22.5" r="3.2" stroke="currentColor" strokeWidth={STROKE} fill="none" />
    </svg>
  );
}

function Fingers({ count }) {
  const xs = count === 2 ? [6, 12] : [9];
  return (
    <svg width="18" height="30" viewBox="0 0 18 30" fill="none" aria-hidden="true">
      {xs.map((x) => (
        <rect key={x} x={x - 2} y="6" width="4" height="18" rx="2"
          stroke="currentColor" strokeWidth={STROKE} fill="none" />
      ))}
    </svg>
  );
}

const ICONS = {
  uSlab: () => <Limb capsuleY={2} capsuleH={8} />,
  longArm: () => <Limb capsuleY={3} capsuleH={22} />,
  shortArm: () => <Limb capsuleY={17} capsuleH={11} />,
  thumbSpica: () => <Hand markX={5.5} />,
  ulnaGutter: () => <Hand markX={12.5} />,
  longLeg: () => <Limb capsuleY={3} capsuleH={24} capsuleW={5} capsuleX={7.5} />,
  kneeSlab: () => <Limb capsuleY={11} capsuleH={9} capsuleW={5} capsuleX={7.5} />,
  shortLeg: () => <Limb capsuleY={20} capsuleH={9} capsuleW={5} capsuleX={7.5} />,
  buddy: () => <Fingers count={2} />,
  fingerSplint: () => <Fingers count={1} />,
};

export default function CastIcon({ id }) {
  const Icon = ICONS[id];
  return Icon ? <Icon /> : null;
}
