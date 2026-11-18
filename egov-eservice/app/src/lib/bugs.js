'use strict';
// BUG_MODE: ใช้ในบล็อกที่คำนวณ/ตรวจสิทธิ์เท่านั้น (ห้ามกระทบ seed · A-35)
//   const { isBug } = require('../lib/bugs');  if (isBug('B03')) { ...พฤติกรรมผิดตาม BUGS.md... }
const { BUGS } = require('../config');

function isBug(code) {
  return BUGS.has(String(code).toUpperCase());
}

module.exports = { isBug, list: () => [...BUGS] };
