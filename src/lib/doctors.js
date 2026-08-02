/**
 * doctors.js — the fixed staff list shown as "เลือกแพทย์" badges.
 *
 * Each badge shows only the first name (firstName) so the grid stays
 * scannable, but the database stores the full name (fullName) — the client
 * only ever sends the id, and the server looks up fullName before writing,
 * the same split casts.js/db.js already use for cast_label.
 */
export const DOCTORS = [
  { id: 'doc01', firstName: 'เฉลิมพล', fullName: 'เฉลิมพล กินรี' },
  { id: 'doc02', firstName: 'ชวพล', fullName: 'ชวพล กิตตินภดล' },
  { id: 'doc03', firstName: 'ชัยวัฒน์', fullName: 'ชัยวัฒน์ ล้อพงศ์ไพบูลย์' },
  { id: 'doc04', firstName: 'เทพรักษา', fullName: 'เทพรักษา เหมพรหมราช' },
  { id: 'doc05', firstName: 'ธนกร', fullName: 'ธนกร วงศ์สล้างกุล' },
  { id: 'doc06', firstName: 'ธีรฉัตต์', fullName: 'ธีรฉัตต์ ธนะสารสมบูรณ์' },
  { id: 'doc07', firstName: 'ปราการ', fullName: 'ปราการ ชุมภูปัน' },
  { id: 'doc08', firstName: 'ปองสิทธิ์', fullName: 'ปองสิทธิ์ โพธิคุณ' },
  { id: 'doc09', firstName: 'ปิติพงศ์', fullName: 'ปิติพงศ์ จู่ภิบาล' },
  { id: 'doc10', firstName: 'พลสันต์', fullName: 'พลสันต์ สันธนพิพัฒน์กุล' },
  { id: 'doc11', firstName: 'วรงค์พร', fullName: 'วรงค์พร พงศ์ภิญโญภาพ' },
  { id: 'doc12', firstName: 'วันทนันท์', fullName: 'วันทนันท์ หล่อวัฒนากิจชัย' },
  { id: 'doc13', firstName: 'วิฑูรย์', fullName: 'วิฑูรย์ กิตติพิชัย' },
  { id: 'doc14', firstName: 'สิทธิพงศ์', fullName: 'สิทธิพงศ์ เกตุวงศ์วิริยะ' },
  { id: 'doc15', firstName: 'โอภาส', fullName: 'โอภาส ไชยมหาพฤกษ์' },
];

const BY_ID = Object.fromEntries(DOCTORS.map((d) => [d.id, d]));

export function doctorFullName(id) {
  return BY_ID[id]?.fullName ?? id;
}
