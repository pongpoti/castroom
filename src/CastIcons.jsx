/**
 * CastIcons.jsx — one small pictogram per cast type, styled to actually read
 * as a wrapped cast rather than an abstract capsule.
 *
 * A thin line is the limb. Where the cast sits, the line thickens into a
 * rounded shape with evenly spaced rings drawn across it — the same visual
 * cue the header's own bandage icon uses (a wrap of material has rings/
 * stripes where it overlaps itself), just oriented around a vertical limb
 * instead of a horizontal roll. Position and length of that wrapped segment
 * are what distinguish the ten icons, so the icon still carries the same
 * information the badge's name does.
 *
 * Every stroke uses currentColor, so an icon matches its badge's default,
 * hover, and active (white-on-fill) state automatically.
 */

const STROKE = 2.6;
const RING_STROKE = 1.6;

/** The wrapped cast segment: a rounded capsule with horizontal wrap-rings. */
function Wrap({ x, y, w, h, rings = 3 }) {
  const step = h / (rings + 1);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={w / 2}
        stroke="currentColor" strokeWidth={STROKE} fill="none" />
      {Array.from({ length: rings }, (_, i) => y + step * (i + 1)).map((ry) => (
        <line key={ry} x1={x + 1.5} y1={ry} x2={x + w - 1.5} y2={ry}
          stroke="currentColor" strokeWidth={RING_STROKE} opacity=".7" />
      ))}
    </g>
  );
}

function Limb({ wrapY, wrapH, wrapX = 11, wrapW = 6, rings }) {
  return (
    <svg width="26" height="42" viewBox="0 0 26 42" fill="none" aria-hidden="true">
      <line x1="13" y1="3" x2="13" y2="39" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".4" />
      <Wrap x={wrapX} y={wrapY} w={wrapW} h={wrapH} rings={rings} />
    </svg>
  );
}

function Hand({ markX }) {
  return (
    <svg width="26" height="42" viewBox="0 0 26 42" fill="none" aria-hidden="true">
      <line x1="13" y1="3" x2="13" y2="27" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".4" />
      <rect x="6" y="24" width="14" height="13" rx="6" stroke="currentColor" strokeWidth="1.8" fill="none" opacity=".4" />
      <circle cx={markX} cy="30.5" r="4.6" stroke="currentColor" strokeWidth={STROKE} fill="none" />
      <line x1={markX - 2.4} y1="30.5" x2={markX + 2.4} y2="30.5" stroke="currentColor" strokeWidth={RING_STROKE} opacity=".7" />
    </svg>
  );
}

function Fingers({ count }) {
  const xs = count === 2 ? [9, 17] : [13];
  return (
    <svg width="26" height="42" viewBox="0 0 26 42" fill="none" aria-hidden="true">
      {xs.map((x) => (
        <g key={x}>
          <line x1={x} y1="4" x2={x} y2="36" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".4" />
          <Wrap x={x - 3} y="10" w="6" h="18" rings={2} />
        </g>
      ))}
      {count === 2 && (
        <line x1="9" y1="19" x2="17" y2="19" stroke="currentColor" strokeWidth={RING_STROKE} opacity=".7" />
      )}
    </svg>
  );
}

const ICONS = {
  uSlab: () => <Limb wrapY={3} wrapH={11} rings={2} />,
  longArm: () => <Limb wrapY={4} wrapH={32} rings={5} />,
  shortArm: () => <Limb wrapY={24} wrapH={15} rings={2} />,
  thumbSpica: () => <Hand markX={8} />,
  ulnaGutter: () => <Hand markX={18} />,
  longLeg: () => <Limb wrapY={4} wrapH={34} wrapX={10} wrapW={7} rings={5} />,
  kneeSlab: () => <Limb wrapY={15} wrapH={12} wrapX={10} wrapW={7} rings={2} />,
  shortLeg: () => <Limb wrapY={28} wrapH={12} wrapX={10} wrapW={7} rings={2} />,
  buddy: () => <Fingers count={2} />,
  fingerSplint: () => <Fingers count={1} />,
};

export default function CastIcon({ id }) {
  const Icon = ICONS[id];
  return Icon ? <Icon /> : null;
}
