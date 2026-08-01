/**
 * CastIcons.jsx — one pictogram per cast type.
 *
 * The thing that makes a cast recognisable is the limb it is on. Earlier
 * versions drew the cast alone, as a capsule on a bare vertical line, and it
 * read as a thermometer: a straight line carries no anatomy, so there was
 * nothing for the cast to be a cast *of*. So each icon here starts from an
 * actual silhouette — an arm bent at the elbow, a leg with a knee and a foot,
 * a hand with fingers and a thumb — drawn faintly, and then lays the cast over
 * the segment that type covers.
 *
 * The cast is drawn deliberately much thicker than the limb underneath, which
 * is what a cast looks like in life: a bulky sleeve swallowing a thin limb.
 * Thin seams run across it at regular intervals, the way a bandage shows where
 * each turn of the roll overlaps the last.
 *
 * Two colors do all the state handling. The sleeve is currentColor, so it
 * follows the badge's text color through default, hover, and selected. The
 * seams are painted in --icon-bg, which each badge sets to its own background,
 * so they read as gaps cut out of the sleeve on any badge state without the
 * icon needing to know which state it is in.
 */

const LIMB_W = 4.2;
const LIMB_OPACITY = 0.3;
const SEAMS = '1.4 3.8';

/** The limb under the cast. Group opacity so overlapping parts don't darken. */
function Ghost({ children }) {
  return <g opacity={LIMB_OPACITY}>{children}</g>;
}

function Svg({ children }) {
  return (
    <svg width="34" height="38" viewBox="0 0 34 38" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

/** A wrapped sleeve along `d`: solid stroke, then seams cut across it. */
function Cast({ d, w = 9 }) {
  return (
    <>
      <path d={d} stroke="currentColor" strokeWidth={w}
        strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d={d} strokeWidth={w} strokeLinecap="butt" strokeDasharray={SEAMS}
        fill="none" style={{ stroke: 'var(--icon-bg,#F8FAF3)' }} />
    </>
  );
}

/* ---- the three silhouettes ------------------------------------------- */

/** Hip, knee, shin, ankle, foot. Toes stay clear of every leg cast. */
function LegGhost() {
  return (
    <Ghost>
      <path d="M15 4 L15 19 L13 30.5 L22.5 32.5" stroke="currentColor"
        strokeWidth={LIMB_W} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Ghost>
  );
}

/** Shoulder, elbow, forearm, hand — hanging and bent, as an arm is held. */
function ArmGhost() {
  return (
    <Ghost>
      <path d="M11 4 L10 22 L25 28" stroke="currentColor"
        strokeWidth={LIMB_W} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="27.6" cy="29" r="3.5" fill="currentColor" />
    </Ghost>
  );
}

/** Wrist, palm, four fingers, thumb out to the left. */
function HandGhost() {
  return (
    <Ghost>
      <path d="M17 4 L17 13" stroke="currentColor" strokeWidth="6"
        strokeLinecap="round" fill="none" />
      <rect x="9" y="11" width="16" height="13" rx="5.5" fill="currentColor" />
      <path d="M9.6 16.4 L5.4 21.4" stroke="currentColor" strokeWidth="3.4"
        strokeLinecap="round" fill="none" />
      <path d="M11.5 22 L11.5 31.5 M15.5 22 L15.5 33 M19.5 22 L19.5 32 M23.5 22 L23.5 29.5"
        stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Ghost>
  );
}

/* ---- the ten types ---------------------------------------------------- */

const ICONS = {
  // Leg: thigh-to-foot, below-knee-to-foot, and the knee on its own.
  longLeg: () => (
    <Svg><LegGhost /><Cast d="M15 6.5 L15 19 L13 30.5 L20.5 32.1" /></Svg>
  ),
  shortLeg: () => (
    <Svg><LegGhost /><Cast d="M14.5 22 L13 30.5 L20.5 32.1" /></Svg>
  ),
  kneeSlab: () => (
    <Svg><LegGhost /><Cast d="M15 12.5 L15 19 L14.15 24" /></Svg>
  ),

  // Arm: over the elbow, forearm only, and the U wrapping the elbow itself.
  longArm: () => (
    <Svg><ArmGhost /><Cast d="M10.8 7 L10 22 L24 27.6" /></Svg>
  ),
  shortArm: () => (
    <Svg><ArmGhost /><Cast d="M16 24.4 L24 27.6" /></Svg>
  ),
  uSlab: () => (
    <Svg><ArmGhost /><Cast d="M11 14 L10 22 L17 24.8" /></Svg>
  ),

  // Hand: thumb side, little-finger side, taped pair, single finger.
  thumbSpica: () => (
    <Svg><HandGhost /><Cast d="M6 20.6 L10 16 L15.5 12.5 L17 5.5" w={7.5} /></Svg>
  ),
  ulnaGutter: () => (
    <Svg><HandGhost /><Cast d="M21.5 29 L21.5 22 L18.5 14 L17 5.5" w={8.5} /></Svg>
  ),
  buddy: () => (
    <Svg>
      <HandGhost />
      <Cast d="M14.5 26 L20.5 26" w={4.2} />
      <Cast d="M14.5 31 L20.5 31" w={4.2} />
    </Svg>
  ),
  fingerSplint: () => (
    <Svg><HandGhost /><Cast d="M15.5 21 L15.5 31" w={6} /></Svg>
  ),
};

export default function CastIcon({ id }) {
  const Icon = ICONS[id];
  return Icon ? <Icon /> : null;
}
