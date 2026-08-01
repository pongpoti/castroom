import { useState } from 'react';

/**
 * A front-facing body chart mapping tap zones directly to cast types, rather
 * than to generic anatomy. Eight of the ten types name a site precisely
 * enough to place on a figure (long arm slab = the whole arm+forearm, thumb
 * spica = the thumb); the other two — buddy splint and finger splint — were
 * explicitly decided to need no location at all, so they are not on the
 * diagram and stay as plain badges next to it.
 *
 * Left and right sides both toggle the SAME id: laterality was removed from
 * this form earlier, so tapping either arm just means "long arm slab", full
 * stop. Both sides light up together when that id is selected.
 *
 * Mirrored the way clinical charts conventionally are: it faces the viewer,
 * so the patient's own right side is drawn on the left of the image.
 */

const DIAGRAM_LABEL = {
  uSlab: 'U Slab — ไหล่',
  longArm: 'Long Arm Slab — ทั้งแขน',
  shortArm: 'Short Arm Slab — ข้อมือ',
  thumbSpica: 'Thumb Spica — นิ้วโป้ง',
  ulnaGutter: 'Ulna Gutter — ฝั่งก้อย',
  longLeg: 'Long Leg Slab — ทั้งขา',
  kneeSlab: 'Knee Slab — เข่า',
  shortLeg: 'Short Leg Slab — ข้อเท้า',
};

function Zone({ id, shape, selected, onToggle, active }) {
  return (
    <g
      className={`cd-zone${active ? ' active' : ''}`}
      onClick={() => onToggle(id)}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={DIAGRAM_LABEL[id]}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle(id))}
    >
      {shape}
      <title>{DIAGRAM_LABEL[id]}</title>
    </g>
  );
}

/** One arm or leg, drawn pointing straight down in local space, then rotated
 *  as a group so every zone follows the same pivot without per-shape trig.
 *  SVG rotate() is clockwise, so the screen-left pivot needs a POSITIVE
 *  angle to swing outward and the screen-right pivot a NEGATIVE one. */
function Limb({ kind, pivot, angle, selected, onToggle }) {
  const has = (id) => selected.has(id);
  const isArm = kind === 'arm';
  return (
    <g transform={`translate(${pivot[0]},${pivot[1]}) rotate(${angle})`}>
      {isArm ? (
        <>
          {/* big background zone: the whole arm+forearm span */}
          <Zone id="longArm" active={has('longArm')} selected={selected} onToggle={onToggle}
            shape={<rect x="-8" y="0" width="16" height="90" rx="8" className="cd-shape cd-big" />} />
          {/* precise markers, painted on top so they win the hit-test */}
          <Zone id="uSlab" active={has('uSlab')} selected={selected} onToggle={onToggle}
            shape={<circle cx="0" cy="-6" r="10" className="cd-shape cd-marker" />} />
          <Zone id="shortArm" active={has('shortArm')} selected={selected} onToggle={onToggle}
            shape={<circle cx="0" cy="86" r="10" className="cd-shape cd-marker" />} />
          <Zone id="thumbSpica" active={has('thumbSpica')} selected={selected} onToggle={onToggle}
            shape={<circle cx="-7" cy="104" r="8" className="cd-shape cd-marker" />} />
          <Zone id="ulnaGutter" active={has('ulnaGutter')} selected={selected} onToggle={onToggle}
            shape={<circle cx="7" cy="104" r="8" className="cd-shape cd-marker" />} />
        </>
      ) : (
        <>
          <Zone id="longLeg" active={has('longLeg')} selected={selected} onToggle={onToggle}
            shape={<rect x="-11" y="0" width="22" height="128" rx="11" className="cd-shape cd-big" />} />
          <Zone id="kneeSlab" active={has('kneeSlab')} selected={selected} onToggle={onToggle}
            shape={<circle cx="0" cy="68" r="11" className="cd-shape cd-marker" />} />
          <Zone id="shortLeg" active={has('shortLeg')} selected={selected} onToggle={onToggle}
            shape={<circle cx="0" cy="138" r="12" className="cd-shape cd-marker" />} />
        </>
      )}
    </g>
  );
}

export default function CastDiagram({ selected, onToggle }) {
  const sel = selected instanceof Set ? selected : new Set(selected);

  return (
    <div className="cd">
      <svg viewBox="0 0 200 320" className="cd-svg" role="group" aria-label="แผนภาพเลือกชนิดเฝือก">
        <rect x="92" y="48" width="16" height="14" rx="6" className="cd-shape cd-static" />
        <rect x="66" y="58" width="68" height="94" rx="26" className="cd-shape cd-static" />
        <ellipse cx="100" cy="30" rx="19" ry="21" className="cd-shape cd-static" />

        <Limb kind="arm" pivot={[68, 64]} angle={12} selected={sel} onToggle={onToggle} />
        <Limb kind="arm" pivot={[132, 64]} angle={-12} selected={sel} onToggle={onToggle} />
        <Limb kind="leg" pivot={[83, 148]} angle={5} selected={sel} onToggle={onToggle} />
        <Limb kind="leg" pivot={[117, 148]} angle={-5} selected={sel} onToggle={onToggle} />
      </svg>
      <p className="cd-caption">
        แผนภาพหันหน้าเข้าหาผู้ใช้ · แตะจุดหรือแขน/ขาเพื่อเลือกชนิดเฝือก
      </p>
    </div>
  );
}
