/**
 * casts.js — the fixed list of slab/splint types the cast room applies.
 *
 * Most types already name their own site (long arm slab implies arm and
 * forearm, thumb spica implies the thumb), so the only extra fact worth
 * capturing is which side of the body — `needsSide` marks the nine types
 * where that is meaningful. Buddy splint and finger splint are explicitly
 * exempt: which digit, and which hand or foot, is not tracked here.
 */
export const CAST_TYPES = [
  { id: 'uSlab', label: 'U Slab', thai: 'เฝือกยู', site: 'ไหล่', needsSide: true },
  { id: 'longArm', label: 'Long Arm Slab', thai: 'เฝือกแขนยาว', site: 'แขน-ปลายแขนทั้งท่อน', needsSide: true },
  { id: 'shortArm', label: 'Short Arm Slab', thai: 'เฝือกแขนสั้น', site: 'ข้อมือ', needsSide: true },
  { id: 'shortArmAP', label: 'Short Arm AP Slab', thai: 'เฝือกแขนสั้น AP', site: 'ข้อมือ (ประกบหน้า-หลัง)', needsSide: true },
  { id: 'thumbSpica', label: 'Thumb Spica Slab', thai: 'เฝือกโป้งมือ', site: 'นิ้วโป้ง', needsSide: true },
  { id: 'ulnaGutter', label: 'Ulna Gutter Slab', thai: 'เฝือกร่องอัลนา', site: 'นิ้วฝั่งอัลนา', needsSide: true },
  { id: 'longLeg', label: 'Long Leg Slab', thai: 'เฝือกขายาว', site: 'ขาทั้งท่อน', needsSide: true },
  { id: 'kneeSlab', label: 'Knee Slab', thai: 'เฝือกเข่า', site: 'ข้อเข่า (เว้นข้อเท้า)', needsSide: true },
  { id: 'shortLeg', label: 'Short Leg Slab', thai: 'เฝือกขาสั้น', site: 'ข้อเท้า', needsSide: true },
  { id: 'buddy', label: 'Buddy Splint', thai: 'เฝือกดามคู่นิ้ว', site: null, needsSide: false },
  { id: 'fingerSplint', label: 'Finger Splint', thai: 'เฝือกดามนิ้ว', site: null, needsSide: false },
];

const BY_ID = Object.fromEntries(CAST_TYPES.map((c) => [c.id, c]));

export function castType(id) {
  return BY_ID[id] ?? null;
}

const SIDE_LABEL = { left: 'ซ้าย', right: 'ขวา' };

/** Human-readable summary for a chip or a log entry: "เฝือกแขนยาว ขวา". */
export function castItemLabel(item) {
  const type = castType(item.type);
  if (!type) return item.type;
  return item.side ? `${type.thai} ${SIDE_LABEL[item.side] ?? item.side}` : type.thai;
}
