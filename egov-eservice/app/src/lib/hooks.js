'use strict';
// จุดเสียบให้บล็อกอื่น ไม่ต้องแก้ server.js
//  - onReset(fn): เรียกหลัง POST /api/test/reset seed เสร็จ (ล้าง cache/ตัวนับในหน่วยความจำ)
//  - onTick(fn):  เรียกทุก HTTP request ยกเว้น /api/test/* (CONTRACT 0.7: ประเมินแจ้งเตือน SLA + ยกเลิกอัตโนมัติ)
//                 fn(req) ทำงานแบบ sync หลัง session โหลดแล้ว (req.user พร้อมใช้)
const resetFns = [];
const tickFns = [];

module.exports = {
  onReset(fn) { resetFns.push(fn); },
  onTick(fn) { tickFns.push(fn); },
  runReset() { for (const fn of resetFns) fn(); },
  runTick(req) { for (const fn of tickFns) fn(req); },
};
