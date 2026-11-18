'use strict';
// B01: /api/health + test hook (CONTRACT 6.6, 8)
//   /api/health            ไม่ขึ้นกับ TEST_MODE · ตอบ {"status":"ok"} ตรงตัว
//   /api/test/*            เฉพาะ TEST_MODE=1 (ไม่ตั้ง -> 404 ทุก path/method)
//   POST /api/test/reset · GET|PUT /api/test/clock
//   (POST /api/test/payments/:ref/pay และ POST /api/test/documents/:docNo/tamper เป็นของบล็อกชำระเงิน/เอกสาร:
//    ประกาศใน routes/*.js ของตนได้เลย — gate TEST_MODE ด้านล่างครอบ /api/test/* ทั้งหมดแล้ว)
const express = require('express');
const cfg = require('../config');
const clock = require('../lib/clock');
const { db } = require('../db');
const { resetAll } = require('../seed');

module.exports = function mount(app) {
  app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  // gate: ปิด hook = 404 (ไม่เผยว่ามี route)
  app.use('/api/test', (req, res, next) => {
    if (!cfg.TEST_MODE) return res.status(404).json({ code: 'NOT_FOUND', message: 'ไม่พบหน้านี้' });
    next();
  });

  const t = express.Router();
  t.post('/reset', (_req, res) => {
    const now = resetAll();
    res.status(200).json({ ok: true, now });
  });
  t.get('/clock', (_req, res) => res.status(200).json({ now: clock.now() }));
  t.put('/clock', (req, res) => {
    const now = clock.set(req.body && req.body.now);
    if (now == null) return res.status(400).json({ code: 'INVALID_TIME', message: 'รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น ISO 8601 พร้อม offset)' });
    db.prepare("INSERT INTO meta(key,value) VALUES('clock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(now);
    res.status(200).json({ now });
  });
  app.use('/api/test', t);
};
