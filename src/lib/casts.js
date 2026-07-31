/**
 * casts.js — the fixed list of slab/splint types the cast room applies.
 *
 * Deliberately just a type and a label. An earlier version also tracked
 * which side of the body and showed each type's anatomical site as a
 * subtitle, but for how this list is actually used that was detail nobody
 * needed to record — the type name is enough on its own.
 */
export const CAST_TYPES = [
  { id: 'uSlab', label: 'U Slab' },
  { id: 'longArm', label: 'Long Arm Slab' },
  { id: 'shortArm', label: 'Short Arm Slab' },
  { id: 'shortArmAP', label: 'Short Arm AP Slab' },
  { id: 'thumbSpica', label: 'Thumb Spica Slab' },
  { id: 'ulnaGutter', label: 'Ulna Gutter Slab' },
  { id: 'longLeg', label: 'Long Leg Slab' },
  { id: 'kneeSlab', label: 'Knee Slab' },
  { id: 'shortLeg', label: 'Short Leg Slab' },
  { id: 'buddy', label: 'Buddy Splint' },
  { id: 'fingerSplint', label: 'Finger Splint' },
];

const BY_ID = Object.fromEntries(CAST_TYPES.map((c) => [c.id, c]));

export function castLabel(id) {
  return BY_ID[id]?.label ?? id;
}
