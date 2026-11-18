'use strict';
// นาฬิกาทดสอบ "แช่แข็ง" (A-37): เปลี่ยนเฉพาะ PUT /api/test/clock และกลับเป็น 2026-12-01T09:00:00+07:00 หลัง reset
// TEST_MODE ปิด -> ใช้เวลาจริง (แต่ยังผ่าน module นี้เสมอ)
// กฎธุรกิจทุกข้อต้องเรียก clock.now() / clock.nowMs() ห้ามใช้ Date.now() / new Date() โดยตรง
const { TEST_MODE, DEFAULT_CLOCK } = require('../config');
const T = require('./time');

let frozenMs = T.parseIso(DEFAULT_CLOCK);

function nowMs() {
  return TEST_MODE ? frozenMs : Date.now();
}
const now = () => T.fromMs(nowMs()); // ISO +07:00
const today = () => T.dateOf(now()); // YYYY-MM-DD (เวลาไทย)

// คืน ISO +07:00 ที่ตั้งจริง หรือ null ถ้ารูปแบบไม่ถูกต้อง (ต้องมี offset)
function set(iso) {
  const ms = T.parseIso(iso);
  if (ms == null) return null;
  frozenMs = ms;
  return now();
}
function reset() {
  frozenMs = T.parseIso(DEFAULT_CLOCK);
}
// โหลดนาฬิกาที่เก็บไว้ (ให้รอดการ restart ระหว่างทดสอบ)
function restore(iso) {
  const ms = T.parseIso(iso);
  if (ms != null) frozenMs = ms;
}

module.exports = { now, nowMs, today, set, reset, restore };
