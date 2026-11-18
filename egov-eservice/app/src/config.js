'use strict';
// ค่าตั้งต้นทั้งหมดอ่านจาก environment ที่นี่ที่เดียว
const path = require('path');

const bugs = new Set(
  String(process.env.BUG_MODE || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  // TEST_MODE=1 เปิด /api/test/* · ไม่ตั้ง/ค่าอื่น = ปิด (ตอบ 404)
  TEST_MODE: String(process.env.TEST_MODE || '').trim() === '1',
  // BUG_MODE=B03,B07 (ดู BUGS.md) · ใช้ require('./lib/bugs').isBug('B03')
  BUGS: bugs,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'egov.db'),
  // คีย์ทดสอบ (A-22 ลายเซ็นจำลอง · NFR-04 เข้ารหัส at rest)
  ENC_KEY: process.env.ENC_KEY || 'egov-test-enc-key-do-not-use-in-prod',
  SIGN_KEY: process.env.SIGN_KEY || 'egov-test-sign-key-do-not-use-in-prod',
  DEFAULT_CLOCK: '2026-12-01T09:00:00+07:00', // A-01 (อังคาร)
  TZ_OFFSET: '+07:00',
  OTP: '123456', // A-05
  STAFF_PASSWORD: 'Test@1234',
  BODY_LIMIT: '12mb', // CONTRACT 0.10: ต้องรับ >= 6 MB
};
