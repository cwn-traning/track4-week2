'use strict';
// e-Service กลาง · เทศบาลนครตัวอย่าง (ระบบสมมติ) — Node.js + Express + SQLite
//
// การต่อโมดูล (บล็อกอื่นไม่ต้องแก้ไฟล์นี้):
//   src/routes/*.js  ทุกไฟล์ export function (app, ctx) ถูกโหลดตามลำดับชื่อไฟล์ (00-… ก่อน)
//                    ctx = { db, clock, cfg, hooks }  · เพิ่มได้ทั้ง API (/api/...) และหน้า (SSR/redirect)
//   src/hooks/*.js   ทุกไฟล์ export function (ctx) ใช้ลงทะเบียน hooks.onTick / hooks.onReset
//   public/          ไฟล์ static (css/js) เสิร์ฟที่ /static
//   ลำดับ middleware: body parser → session (req.user) → tick (SLA/auto-cancel ทุก request ยกเว้น /api/test/*) → routes → 404
const fs = require('fs');
const path = require('path');
const express = require('express');
const cfg = require('./config');
const { db, isInitialized } = require('./db');
const clock = require('./lib/clock');
const hooks = require('./lib/hooks');
const { loadSession } = require('./lib/session');
const { resetAll } = require('./seed');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

// CONTRACT 0.10: ต้องรับ body >= 6 MB (ไฟล์ 5,242,881 ไบต์ต้องได้ 400 FILE_TOO_LARGE จาก handler ไม่ใช่ 413)
app.use(express.json({ limit: cfg.BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: cfg.BODY_LIMIT }));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use(loadSession);

// CONTRACT 0.7: ทุก request ยกเว้น /api/test/* ประเมินแจ้งเตือน SLA + ยกเลิกอัตโนมัติ
app.use((req, _res, next) => {
  if (!req.path.startsWith('/api/test/') && req.path !== '/api/test') hooks.runTick(req);
  next();
});

const ctx = { db, clock, cfg, hooks, app };
function loadDir(dir, call) {
  const abs = path.join(__dirname, dir);
  if (!fs.existsSync(abs)) return;
  for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.js')).sort()) {
    const mod = require(path.join(abs, f));
    if (typeof mod === 'function') call(mod);
  }
}
loadDir('hooks', (m) => m(ctx));
loadDir('routes', (m) => m(app, ctx));

// 404 · API เป็น JSON {"code","message"} (A-38)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ code: 'NOT_FOUND', message: 'ไม่พบข้อมูลที่ร้องขอ' });
  res.status(404).type('html').send('<!doctype html><html lang="th"><meta charset="utf-8"><title>ไม่พบหน้า</title><h1 data-testid="not-found-msg">ไม่พบหน้า</h1>');
});

// error handler: JSON พัง/ใหญ่เกิน -> รูปแบบเดียวกับ API อื่น
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (res.headersSent) return;
  if (err && err.type === 'entity.too.large') return res.status(400).json({ code: 'BODY_TOO_LARGE', message: 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป' });
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) return res.status(400).json({ code: 'BAD_REQUEST', message: 'รูปแบบข้อมูลไม่ถูกต้อง' });
  console.error(err && err.stack ? err.stack : err);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาดภายในระบบ' });
});

function start() {
  if (!isInitialized()) resetAll(); // ครั้งแรก (ฐานข้อมูลว่าง) seed ตาม TEST-DATA
  else if (cfg.TEST_MODE) {
    const row = db.prepare("SELECT value FROM meta WHERE key='clock'").get();
    if (row) clock.restore(row.value);
  }
  const server = app.listen(cfg.PORT, '0.0.0.0', () => {
    console.log(`e-Service listening on :${cfg.PORT} TEST_MODE=${cfg.TEST_MODE ? 1 : 0} BUG_MODE=${[...cfg.BUGS].join(',') || '-'} DB_PATH=${cfg.DB_PATH}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) start();
module.exports = { app, start };
