'use strict';
// B02: ThaiD จำลอง + SSO เจ้าหน้าที่ + RBAC + ปิดบังเลขบัตร (FR-01..03, FR-21 · BR-01 BR-02 · CONTRACT §1, 2.1-2.3, 5, 6.1)
//
// การใช้งาน:
//   mount:  สร้าง src/routes/01-auth.js  ->  module.exports = require('../auth');   (module.exports เป็นฟังก์ชัน (app, ctx))
//   helper: const auth = require('../auth');
//     auth.requireLogin / auth.requireRole('officer','head')   -> middleware ของ API (401 UNAUTHENTICATED / 403 FORBIDDEN)
//     auth.landingOf(role, registered)                         -> หน้าตั้งต้นของบทบาท
//     auth.maskIdNo / auth.formatIdNo / auth.checkIdNo         -> ปิดบัง/จัดรูป/ตรวจ checksum เลขบัตร
//     auth.ROLE_TH                                             -> ชื่อบทบาทภาษาไทย (user-role)
//   mount นี้ติดตั้ง page guard ตาราง CONTRACT §1 ให้ด้วย (ยังไม่ล็อกอิน -> redirect /login · บทบาทไม่ตรง -> 403 forbidden-msg)
const express = require('express');
const { db } = require('./db');
const clock = require('./lib/clock');
const T = require('./lib/time');
const crypto = require('./lib/crypto');
const pw = require('./lib/password');
const { createSession, destroySession } = require('./lib/session');
const cfg = require('./config');

const ROLE_TH = {
  citizen: 'ประชาชน', officer: 'เจ้าหน้าที่', head: 'หัวหน้าฝ่าย',
  executive: 'ผู้บริหาร', auditor: 'ผู้ตรวจสอบภายใน', admin: 'ผู้ดูแลระบบ',
};
const LANDING = {
  citizen: '/citizen', officer: '/officer/queue', head: '/head/approvals',
  executive: '/dashboard', auditor: '/audit', admin: '/admin/services',
};
const MSG = {
  INVALID_ID: 'เลขบัตรประชาชนไม่ถูกต้อง',
  OTP_INVALID: 'รหัส OTP ไม่ถูกต้อง',
  LOCKED: 'ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที',
  INVALID_CREDENTIALS: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  INVALID_MOBILE: 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0',
  CONSENT_REQUIRED: 'กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบ',
  FORBIDDEN: 'ไม่มีสิทธิ์ทำรายการนี้',
  FORBIDDEN_PAGE: 'ไม่มีสิทธิ์เข้าถึงหน้านี้',
};
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILS = 3;

const landingOf = (role, registered = true) =>
  role === 'citizen' && registered === false ? '/register' : LANDING[role] || '/login';
const err = (res, status, code, extra) => res.status(status).json({ code, message: MSG[code], ...(extra || {}) });

// ---------- RBAC สำหรับ API ----------
function requireLogin(req, res, next) {
  if (!req.user) return err(res, 401, 'UNAUTHENTICATED');
  next();
}
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return err(res, 401, 'UNAUTHENTICATED');
  if (!roles.includes(req.user.role)) return err(res, 403, 'FORBIDDEN');
  next();
};

// ---------- ThaiD จำลอง ----------
const idHash = (id) => crypto.blindIndex(id);

function getLock(hash) {
  const row = db.prepare('SELECT fails, locked_until FROM otp_state WHERE id_hash=?').get(hash);
  if (!row) return { fails: 0, lockedUntil: null };
  if (row.locked_until) {
    if (clock.nowMs() >= T.parseIso(row.locked_until)) { // ครบ 15:00 -> ปลดล็อก ตัวนับเริ่มที่ 0
      db.prepare('UPDATE otp_state SET fails=0, locked_until=NULL WHERE id_hash=?').run(hash);
      return { fails: 0, lockedUntil: null };
    }
    return { fails: row.fails, lockedUntil: row.locked_until };
  }
  return { fails: row.fails, lockedUntil: null };
}
function saveState(hash, fails, lockedUntil) {
  db.prepare(`INSERT INTO otp_state(id_hash,fails,locked_until) VALUES(?,?,?)
              ON CONFLICT(id_hash) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until`)
    .run(hash, fails, lockedUntil);
}
const lockedResponse = (res, lockedUntil) => err(res, 423, 'LOCKED', { lockedUntil });

function findOrCreateCitizen(idNo) {
  const hash = idHash(idNo);
  let c = db.prepare('SELECT * FROM citizens WHERE id_hash=?').get(hash);
  if (!c) { // เลขบัตรถูกต้องแต่ไม่เคยเข้า -> ThaiD จำลองคืนชื่อทั่วไป (ยังไม่ลงทะเบียน)
    const info = db.prepare(`INSERT INTO citizens(id_hash,id_enc,id_masked,name,registered,consent) VALUES(?,?,?,?,0,0)`)
      .run(hash, crypto.encrypt(idNo), crypto.maskIdNo(idNo), 'ผู้ใช้ ThaiD ' + idNo.slice(10));
    c = db.prepare('SELECT * FROM citizens WHERE id=?').get(info.lastInsertRowid);
  }
  return c;
}

// ---------- page guard (CONTRACT §1) ----------
const PAGE_RULES = [
  [/^\/citizen$/, ['citizen']],
  [/^\/citizen\/new\/[^/]+$/, ['citizen']],
  [/^\/citizen\/cases\/[^/]+$/, ['citizen']],
  [/^\/officer\/queue$/, ['officer', 'head']],
  [/^\/officer\/cases\/[^/]+$/, ['officer', 'head']],
  [/^\/head\/approvals$/, ['head']],
  [/^\/dashboard$/, ['executive']],
  [/^\/audit$/, ['auditor']],
  [/^\/admin\/(services|holidays|users)$/, ['admin']],
  [/^\/notifications$/, ['officer', 'head']],
];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function forbiddenPage(req, res) {
  const u = req.user;
  res.status(403).type('html').send(`<!doctype html><html lang="th"><meta charset="utf-8"><title>ไม่มีสิทธิ์เข้าถึง</title>
<header data-testid="app-header"><span data-testid="user-name">${esc(u.name)}</span>
<span data-testid="user-role" data-role="${u.role}"${u.role === 'officer' ? ` data-dept="${esc(u.dept)}"` : ''}>${ROLE_TH[u.role]}</span>
<a href="/api/auth/logout-page" data-testid="logout-btn">ออกจากระบบ</a></header>
<main><h1 data-testid="forbidden-msg">${MSG.FORBIDDEN_PAGE}</h1></main></html>`);
}
function pageGuard(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const p = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  if (p === '/register') {
    if (!req.user) return res.redirect('/login');
    if (req.user.kind !== 'citizen' || req.user.registered) return res.redirect(landingOf(req.user.role, true));
    return next();
  }
  const rule = PAGE_RULES.find(([re]) => re.test(p));
  if (!rule) return next();
  if (!req.user) return res.redirect('/login');
  if (req.user.role === 'citizen' && !req.user.registered) return res.redirect('/register');
  if (!rule[1].includes(req.user.role)) return forbiddenPage(req, res);
  next();
}

// ---------- routes ----------
function mount(app) {
  app.get('/', (req, res) => res.redirect(req.user ? landingOf(req.user.role, req.user.registered) : '/login'));
  app.get('/login', (req, res, next) => {
    // ล็อกอินแล้ว -> ไปหน้าตั้งต้น (หน้า login จริงเป็นของบล็อก UI ถ้าไม่ต้องการ redirect ให้ลบ handler นี้ออกในบล็อกนั้น)
    if (req.user && req.query.force !== '1') return res.redirect(landingOf(req.user.role, req.user.registered));
    next();
  });
  app.use(pageGuard);

  const r = express.Router();

  r.post('/thaid/start', (req, res) => {
    const idNo = String((req.body && req.body.idNo) ?? '');
    if (!crypto.checkIdNo(idNo)) return err(res, 400, 'INVALID_ID');
    const st = getLock(idHash(idNo));
    if (st.lockedUntil) return lockedResponse(res, st.lockedUntil);
    res.status(200).json({ status: 'OTP_SENT' });
  });

  r.post('/thaid/verify', (req, res) => {
    const idNo = String((req.body && req.body.idNo) ?? '');
    const otp = String((req.body && req.body.otp) ?? '');
    if (!crypto.checkIdNo(idNo)) return err(res, 400, 'INVALID_ID');
    const hash = idHash(idNo);
    const st = getLock(hash);
    if (st.lockedUntil) return lockedResponse(res, st.lockedUntil); // ล็อกอยู่ แม้ OTP ถูกก็ไม่ผ่าน
    if (otp !== cfg.OTP) {
      const fails = st.fails + 1;
      if (fails >= MAX_FAILS) {
        const until = T.fromMs(clock.nowMs() + LOCK_MS); // นับจากครั้งที่ 3
        saveState(hash, fails, until);
        return lockedResponse(res, until);
      }
      saveState(hash, fails, null);
      return err(res, 401, 'OTP_INVALID', { attemptsLeft: MAX_FAILS - fails });
    }
    saveState(hash, 0, null); // OTP ถูก -> รีเซ็ตตัวนับ
    const c = findOrCreateCitizen(idNo);
    if (req.sid) destroySession(req, res);
    createSession(res, { kind: 'citizen', role: 'citizen', citizenId: c.id, name: c.name, registered: !!c.registered });
    res.status(200).json({ registered: !!c.registered });
  });

  r.post('/register', (req, res) => {
    if (!req.user) return err(res, 401, 'UNAUTHENTICATED');
    if (req.user.kind !== 'citizen') return err(res, 403, 'FORBIDDEN');
    const c = db.prepare('SELECT * FROM citizens WHERE id=?').get(req.user.citizenId);
    if (!c) return err(res, 401, 'UNAUTHENTICATED');
    if (c.registered) return res.status(409).json({ code: 'ALREADY_REGISTERED', message: 'ลงทะเบียนแล้ว' });
    const b = req.body || {};
    const mobile = String(b.mobile ?? '');
    if (!/^0\d{9}$/.test(mobile)) return err(res, 400, 'INVALID_MOBILE');
    if (b.consent !== true && b.consent !== 'true' && b.consent !== 'on') return err(res, 400, 'CONSENT_REQUIRED');
    db.prepare('UPDATE citizens SET mobile_enc=?, email=?, registered=1, consent=1, registered_at=? WHERE id=?')
      .run(crypto.encrypt(mobile), String(b.email ?? '').trim(), clock.now(), c.id);
    db.prepare('UPDATE sessions SET registered=1 WHERE sid=?').run(req.sid);
    res.status(201).json({ registered: true, landing: LANDING.citizen });
  });

  r.post('/staff/login', (req, res) => {
    const b = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(b.username ?? ''));
    // ตรวจรหัสเสมอ (เวลาใกล้เคียงกัน) เพื่อไม่เผยว่าบัญชีมีอยู่
    const ok = pw.verify(String(b.password ?? ''), u ? u.password_hash : 'scrypt$00$00');
    if (!u || !ok) return err(res, 401, 'INVALID_CREDENTIALS');
    if (req.sid) destroySession(req, res);
    createSession(res, { kind: 'staff', role: u.role, username: u.username, name: u.name, dept: u.dept });
    // Audit: ล็อกอินเจ้าหน้าที่สำเร็จ (ไม่ผูกคำขอ)
    db.prepare('INSERT INTO audit(time,username,role,event) VALUES(?,?,?,?)').run(clock.now(), u.username, u.role, 'STAFF_LOGIN');
    res.status(200).json({ role: u.role, dept: u.dept, landing: landingOf(u.role) });
  });

  r.post('/logout', (req, res) => {
    destroySession(req, res);
    res.status(204).end();
  });
  // ลิงก์ออกจากระบบสำหรับหน้า 403 (GET) -> ล้าง session แล้วไป /login
  r.get('/logout-page', (req, res) => {
    destroySession(req, res);
    res.redirect('/login');
  });

  app.use('/api/auth', r);

  app.get('/api/me', requireLogin, (req, res) => {
    const u = req.user;
    res.status(200).json({
      username: u.username || (u.citizenId != null ? `citizen-${u.citizenId}` : ''),
      name: u.name, role: u.role, dept: u.dept || '', registered: u.registered,
    });
  });
}

module.exports = mount;
Object.assign(mount, {
  mount, requireLogin, requireRole, landingOf, pageGuard,
  ROLE_TH, LANDING, MSG,
  checkIdNo: crypto.checkIdNo, maskIdNo: crypto.maskIdNo, formatIdNo: crypto.formatIdNo,
});
