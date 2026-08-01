/**
 * casts.js — the fixed list of slab/splint types the cast room applies.
 *
 * Deliberately just a type and a label. An earlier version also tracked
 * which side of the body and showed each type's anatomical site as a
 * subtitle, but for how this list is actually used that was detail nobody
 * needed to record — the type name is enough on its own.
 */
export const CAST_TYPES = [
  { id: 'shortLeg', label: 'Short Leg Slab' },
  { id: 'longLeg', label: 'Long Leg Slab' },
  { id: 'shortArm', label: 'Short Arm Slab' },
  { id: 'longArm', label: 'Long Arm Slab' },
  { id: 'buddy', label: 'Buddy Splint' },
  { id: 'fingerSplint', label: 'Finger Splint' },
  { id: 'thumbSpica', label: 'Thumb Spica Slab' },
  { id: 'ulnaGutter', label: 'Ulna Gutter Slab' },
  { id: 'uSlab', label: 'U Slab' },
  { id: 'kneeSlab', label: 'Knee Slab' },
];

const BY_ID = Object.fromEntries(CAST_TYPES.map((c) => [c.id, c]));

export function castLabel(id) {
  return BY_ID[id]?.label ?? id;
}

/**
 * The two types with no fixed anatomical site — CastDiagram has nowhere
 * principled to put them, so they stay as plain badges next to it rather
 * than being forced onto a made-up spot on the figure.
 */
export const STANDALONE_CAST_IDS = ['buddy', 'fingerSplint'];
