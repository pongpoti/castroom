import { useState } from 'react';

/**
 * A front-facing body chart, mirrored the way clinical charts conventionally
 * are: it faces the viewer, so the patient's own right side is drawn on the
 * left of the image. Labels say "left"/"right" from the patient's point of
 * view, not the screen's, and a caption under the diagram says so.
 */
export const REGIONS = [
  { id: 'head', label: 'ศีรษะ' },
  { id: 'torso', label: 'ลำตัว' },
  { id: 'upperArmR', label: 'ต้นแขนขวา' },
  { id: 'upperArmL', label: 'ต้นแขนซ้าย' },
  { id: 'forearmR', label: 'แขนท่อนล่างขวา' },
  { id: 'forearmL', label: 'แขนท่อนล่างซ้าย' },
  { id: 'handR', label: 'มือขวา' },
  { id: 'handL', label: 'มือซ้าย' },
  { id: 'thighR', label: 'ต้นขาขวา' },
  { id: 'thighL', label: 'ต้นขาซ้าย' },
  { id: 'shinR', label: 'ขาท่อนล่างขวา' },
  { id: 'shinL', label: 'ขาท่อนล่างซ้าย' },
  { id: 'footR', label: 'เท้าขวา' },
  { id: 'footL', label: 'เท้าซ้าย' },
];

const LABEL = Object.fromEntries(REGIONS.map((r) => [r.id, r.label]));
export function regionLabel(id) {
  return LABEL[id] ?? id;
}

/** One arm or leg, drawn pointing straight down in local space, then rotated
 *  as a group so every segment follows the same pivot without per-part trig. */
function Limb({ kind, pivot, angle, ids, selected, onToggle, hover, setHover }) {
  const isArm = kind === 'arm';
  const seg = (id, shape) => {
    const isSel = selected.has(id);
    const isHover = hover === id;
    return (
      <g
        key={id}
        className="bd-seg"
        onClick={() => onToggle(id)}
        onPointerEnter={() => setHover(id)}
        onPointerLeave={() => setHover((h) => (h === id ? null : h))}
        role="button"
        tabIndex={0}
        aria-pressed={isSel}
        aria-label={regionLabel(id)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle(id))}
      >
        {shape}
        {(isSel || isHover) && (
          <title>{regionLabel(id)}</title>
        )}
      </g>
    );
  };

  return (
    <g transform={`translate(${pivot[0]},${pivot[1]}) rotate(${angle})`}>
      {isArm ? (
        <>
          {seg(ids[0], <rect x="-7" y="0" width="14" height="50" rx="7"
            className={`bd-shape ${selected.has(ids[0]) ? 'sel' : ''}`} />)}
          {seg(ids[1], <rect x="-6" y="48" width="12" height="42" rx="6"
            className={`bd-shape ${selected.has(ids[1]) ? 'sel' : ''}`} />)}
          {seg(ids[2], <ellipse cx="0" cy="100" rx="9" ry="11"
            className={`bd-shape ${selected.has(ids[2]) ? 'sel' : ''}`} />)}
        </>
      ) : (
        <>
          {seg(ids[0], <rect x="-11" y="0" width="22" height="70" rx="11"
            className={`bd-shape ${selected.has(ids[0]) ? 'sel' : ''}`} />)}
          {seg(ids[1], <rect x="-9" y="68" width="18" height="60" rx="9"
            className={`bd-shape ${selected.has(ids[1]) ? 'sel' : ''}`} />)}
          {seg(ids[2], <ellipse cx="0" cy="140" rx="13" ry="9"
            className={`bd-shape ${selected.has(ids[2]) ? 'sel' : ''}`} />)}
        </>
      )}
    </g>
  );
}

export default function BodyDiagram({ selected, onToggle }) {
  const [hover, setHover] = useState(null);
  const sel = selected instanceof Set ? selected : new Set(selected);

  const seg = (id, shape) => (
    <g
      key={id}
      className="bd-seg"
      onClick={() => onToggle(id)}
      onPointerEnter={() => setHover(id)}
      onPointerLeave={() => setHover((h) => (h === id ? null : h))}
      role="button"
      tabIndex={0}
      aria-pressed={sel.has(id)}
      aria-label={regionLabel(id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle(id))}
    >
      {shape}
    </g>
  );

  return (
    <div className="bd">
      <svg viewBox="0 0 200 320" className="bd-svg" role="group" aria-label="แผนภาพร่างกาย">
        {/* neck, purely decorative */}
        <rect x="92" y="48" width="16" height="14" rx="6" className="bd-shape bd-static" />

        {/* Torso first: limbs are drawn afterwards so they sit visibly on top
            of it rather than being covered where a shoulder or hip pivot
            falls inside the torso's own silhouette. */}
        {seg('torso', <rect x="66" y="58" width="68" height="92" rx="26"
          className={`bd-shape ${sel.has('torso') ? 'sel' : ''}`} />)}

        {/* SVG rotate() is clockwise, so a limb pointing straight down needs a
            POSITIVE angle at the screen-left pivot to swing further left
            (outward) and a NEGATIVE angle at the screen-right pivot to swing
            further right — the opposite of what "tilt left/right" suggests
            at a glance, which is what made the first pass cross the arms and
            legs in front of the body instead of spreading them. */}
        <Limb kind="arm" pivot={[68, 64]} angle={12}
          ids={['upperArmR', 'forearmR', 'handR']}
          selected={sel} onToggle={onToggle} hover={hover} setHover={setHover} />
        <Limb kind="arm" pivot={[132, 64]} angle={-12}
          ids={['upperArmL', 'forearmL', 'handL']}
          selected={sel} onToggle={onToggle} hover={hover} setHover={setHover} />

        <Limb kind="leg" pivot={[83, 148]} angle={5}
          ids={['thighR', 'shinR', 'footR']}
          selected={sel} onToggle={onToggle} hover={hover} setHover={setHover} />
        <Limb kind="leg" pivot={[117, 148]} angle={-5}
          ids={['thighL', 'shinL', 'footL']}
          selected={sel} onToggle={onToggle} hover={hover} setHover={setHover} />

        {seg('head', <ellipse cx="100" cy="30" rx="19" ry="21"
          className={`bd-shape ${sel.has('head') ? 'sel' : ''}`} />)}
      </svg>
      <p className="bd-caption">
        แผนภาพหันหน้าเข้าหาผู้ใช้ — ซ้าย/ขวาเป็นของผู้ป่วย · แตะได้หลายจุด
      </p>
    </div>
  );
}
