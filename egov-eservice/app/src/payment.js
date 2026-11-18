'use strict';
// B05 · ชำระ PromptPay จำลอง + เลขคำขอ/ใบเสร็จ + ยกเลิกคำขอ (FR-08, FR-10 · BR-09 BR-10 BR-11 BR-22 · CONTRACT 6.2, 8)
//   mount:  สร้าง src/routes/03-payment.js  ->  module.exports = require('../payment');   (module.exports เป็นฟังก์ชัน (app, ctx))
//   API:    POST /api/drafts/:id/payment · GET /api/payments/:ref · POST /api/cases/:caseNo/cancel
//   hook:   POST /api/test/payments/:ref/pay   (gate TEST_MODE อยู่ที่ routes/00-health-test.js แล้ว)
//   ไม่รวม: DELETE /api/drafts/:id (อยู่ใน citizen.js — ลบ payments ที่ยังไม่ชำระของร่างนั้นด้วย → ref กลายเป็น 404)
//   เลขที่ทุกชนิดออกใน db.transaction เดียวกับการสร้างคำขอ (better-sqlite3 sync = atomic) จึงไม่ซ้ำเมื่อชำระพร้อมกัน
//   ยกเลิกใช้ UPDATE ... WHERE status='SUBMITTED' AND owner IS NULL เป็นตัวตัดสิน (สำเร็จฝั่งเดียวเมื่อชนกับรับเรื่อง)
const { db } = require('./db');
const clock = require('./lib/clock');
const ids = require('./lib/ids');
const T = require('./lib/time');
const { isBug } = require('./lib/bugs');
const rules = require('./rules');
const auth = require('./auth');
const citizen = require('./citizen');

const QR_TTL_MS = 15 * 60 * 1000; // BR-10 · อายุ QR 15:00

const MSG = {
  NOT_FOUND: 'ไม่พบคำขอ',
  INVALID_STATE: 'สถานะคำขอไม่ถูกต้องสำหรับรายการนี้',
  QR_EXPIRED: 'QR หมดอายุ กรุณาสร้าง QR ใหม่',
  AMOUNT_MISMATCH: 'ยอดเงินไม่ตรงกับค่าธรรมเนียม',
  CANNOT_CANCEL: 'ยกเลิกไม่ได้ คำขอมีเจ้าหน้าที่รับเรื่องแล้ว',
  MISSING_DOCS: 'ยังขาดเอกสาร',
  ALREADY_CLAIMED: 'มีเจ้าหน้าที่รับเรื่องนี้แล้ว',
  WORKLOAD_LIMIT: 'รับงานได้สูงสุด 10 เรื่อง',
  FORBIDDEN: 'ไม่มีสิทธิ์ดำเนินการ',
};
const WORKLOAD_MAX = 10;
const jerr = (res, status, code, extra, message) =>
  res.status(status).json({ code, message: message || MSG[code] || code, ...(extra || {}) });

// ---------- QR ----------
// หมดอายุเมื่อ (เวลาชำระ − เวลาสร้าง) >= 15:00 · BUG B05: ใช้ > แทน >= (15:00 พอดียังจ่ายได้)
function isExpired(p, nowMs) {
  const age = nowMs - T.parseIso(p.qr_created_at);
  return isBug('B05') ? age > QR_TTL_MS : age >= QR_TTL_MS;
}
function statusOf(p, nowMs) {
  if (p.status === 'PAID') return 'PAID';
  return isExpired(p, nowMs) ? 'EXPIRED' : 'PENDING';
}
function paymentJson(p) {
  return {
    ref: p.ref, amount: p.amount, status: statusOf(p, clock.nowMs()),
    qrCreatedAt: p.qr_created_at, qrExpiresAt: p.qr_expires_at,
    paidAt: p.paid_at || null, caseNo: p.case_no || null, receiptNo: p.receipt_no || null,
  };
}

// ---------- ชำระสำเร็จ → ออกเลขคำขอ + ใบเสร็จ (atomic) ----------
// คืน { ok:true, duplicate, caseNo, receiptNo } | { ok:false, status, code }
const settle = db.transaction((ref, amount) => {
  const p = db.prepare('SELECT * FROM payments WHERE ref=?').get(ref);
  if (!p) return { ok: false, status: 404, code: 'NOT_FOUND' };
  if (p.status === 'PAID') return { ok: true, duplicate: true, caseNo: p.case_no, receiptNo: p.receipt_no }; // idempotent

  const nowMs = clock.nowMs();
  if (isExpired(p, nowMs)) return { ok: false, status: 410, code: 'QR_EXPIRED' };
  if (!Number.isInteger(amount) || amount !== p.amount) return { ok: false, status: 422, code: 'AMOUNT_MISMATCH' };

  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(p.draft_id);
  if (!d) return { ok: false, status: 404, code: 'NOT_FOUND' };
  if (d.status === 'PAID') { // ร่างนี้ชำระด้วย QR อื่นไปแล้ว → ไม่ออกเลขซ้ำ
    return { ok: false, status: 409, code: 'INVALID_STATE' };
  }
  if (d.status !== 'PENDING_PAYMENT') return { ok: false, status: 409, code: 'INVALID_STATE' };

  const svc = db.prepare('SELECT * FROM services WHERE id=?').get(d.service_id);
  const paidAt = clock.now();
  const caseNo = ids.nextCaseNo(paidAt);
  const receiptNo = ids.nextReceiptNo(paidAt);
  const dueAt = rules.computeDueAt(d.service_id, paidAt, svc.sla_days); // คำนวณครั้งเดียวตอนชำระ (BR-12)
  const who = db.prepare('SELECT name FROM citizens WHERE id=?').get(d.citizen_id);

  db.prepare(`INSERT INTO cases(case_no,label,service_id,citizen_id,draft_id,qty,area_sqm,fee,status,step,dept,owner,issuer,works_owner,
      return_count,paid_at,receipt_no,due_at,closed_at,fix_deadline,approved_by,approved_at,doc_no,verify_code)
      VALUES(?,NULL,?,?,?,?,?,?,'SUBMITTED',?,?,NULL,NULL,NULL,0,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL)`)
    .run(caseNo, d.service_id, d.citizen_id, d.id, d.qty, d.area_sqm, p.amount,
      d.service_id === 'SV-03' ? 1 : null, 'registry', paidAt, receiptNo, dueAt);
  db.prepare('UPDATE files SET case_no=?, draft_id=NULL WHERE draft_id=?').run(caseNo, d.id);
  db.prepare("UPDATE drafts SET status='PAID', case_no=?, updated_at=? WHERE id=?").run(caseNo, paidAt, d.id);
  db.prepare("UPDATE payments SET status='PAID', case_no=?, receipt_no=?, paid_at=? WHERE ref=?").run(caseNo, receiptNo, paidAt, ref);
  db.prepare('INSERT INTO case_timeline(case_no,time,event,actor,detail) VALUES(?,?,?,?,?)')
    .run(caseNo, paidAt, 'PAID', who ? who.name : '', receiptNo);
  return { ok: true, duplicate: false, caseNo, receiptNo };
});

// ---------- ยกเลิกคำขอ (FR-10) ----------
const cancelCase = db.transaction((caseNo, citizenId, actorName) => {
  const c = db.prepare('SELECT case_no, status FROM cases WHERE case_no=? AND citizen_id=?').get(caseNo, citizenId);
  if (!c) return { ok: false, status: 404, code: 'NOT_FOUND' };
  const now = clock.now();
  // ตัวตัดสิน: เงื่อนไขอยู่ใน UPDATE เดียว — ถ้าเจ้าหน้าที่รับเรื่องไปก่อน (owner/สถานะเปลี่ยน) จะไม่มีแถวถูกแก้
  const r = db.prepare("UPDATE cases SET status='CANCELLED', dept=NULL, closed_at=? WHERE case_no=? AND status='SUBMITTED' AND owner IS NULL")
    .run(now, caseNo);
  if (r.changes !== 1) return { ok: false, status: 409, code: 'CANNOT_CANCEL' };
  db.prepare('INSERT INTO case_timeline(case_no,time,event,actor,detail) VALUES(?,?,?,?,?)')
    .run(caseNo, now, 'CANCELLED', actorName || '', 'ผู้ยื่นคำขอยกเลิก');
  return { ok: true };
});

// ---------- เจ้าหน้าที่รับเรื่อง (BR-17/18) ----------
// ลำดับ: สิทธิ์ → ALREADY_CLAIMED → WORKLOAD_LIMIT · ตัวตัดสินคือ UPDATE เดียวที่เช็ก owner IS NULL + สถานะ แล้วดู changes
// (ยกเลิกชนะก่อน → สถานะ CANCELLED → 409 INVALID_STATE · รับเรื่องชนะก่อน → ยกเลิกได้ 409 CANNOT_CANCEL)
const claimCase = db.transaction((caseNo, user) => {
  const c = db.prepare('SELECT * FROM cases WHERE case_no=?').get(caseNo);
  if (!c) return { ok: false, status: 404, code: 'NOT_FOUND' };
  if (user.role !== 'officer' || (c.dept && c.dept !== user.dept)) return { ok: false, status: 403, code: 'FORBIDDEN' };
  if (c.owner && !isBug('B08')) return { ok: false, status: 409, code: 'ALREADY_CLAIMED' }; // BUG B08: ข้ามการตรวจผู้ถือเดิม
  if (c.status !== 'SUBMITTED' && c.status !== 'IN_REVIEW') return { ok: false, status: 409, code: 'INVALID_STATE' };
  const load = db.prepare("SELECT COUNT(*) n FROM cases WHERE status='IN_REVIEW' AND owner=?").get(user.username).n;
  if (load >= WORKLOAD_MAX) return { ok: false, status: 409, code: 'WORKLOAD_LIMIT' };

  const now = clock.now();
  const guard = isBug('B08') ? '' : ' AND owner IS NULL';
  const r = db.prepare(`UPDATE cases SET status='IN_REVIEW', owner=?, dept=COALESCE(dept,?)
                        WHERE case_no=? AND status IN ('SUBMITTED','IN_REVIEW')${guard}`)
    .run(user.username, user.dept, caseNo);
  if (r.changes !== 1) return { ok: false, status: 409, code: 'INVALID_STATE' };
  db.prepare('INSERT INTO case_timeline(case_no,time,event,actor,detail) VALUES(?,?,?,?,?)')
    .run(caseNo, now, 'RECEIVED', user.name || user.username, '');
  db.prepare('INSERT INTO audit(time,username,role,event,case_no,from_status,to_status,detail) VALUES(?,?,?,?,?,?,?,?)')
    .run(now, user.username, user.role, 'CLAIM', caseNo, c.status, 'IN_REVIEW', '');
  return { ok: true, owner: user.username };
});

module.exports = function mount(app) {
  const citizenOnly = auth.requireRole('citizen');

  // สร้าง QR (สร้างใหม่ได้ซ้ำ → ref ใหม่) · ยอดถูกล็อกตอนเข้า PENDING_PAYMENT (BR-11 / A-42)
  app.post('/api/drafts/:id/payment', citizenOnly, (req, res) => {
    const out = db.transaction(() => {
      const d = db.prepare('SELECT * FROM drafts WHERE id=? AND citizen_id=?').get(req.params.id, req.user.citizenId);
      if (!d) return { status: 404, code: 'NOT_FOUND' };
      if (d.status !== 'DRAFT' && d.status !== 'PENDING_PAYMENT') return { status: 409, code: 'INVALID_STATE' };
      const missing = citizen.missingDocs(d.id);
      if (missing.length) {
        return { status: 409, code: 'MISSING_DOCS', extra: { missing }, message: `ยังขาดเอกสาร: ${missing.join(', ')}` };
      }
      const now = clock.now();
      let fee = d.fee;
      if (d.status === 'DRAFT') { // เข้า PENDING_PAYMENT ครั้งแรก → คิดตามอัตราปัจจุบันแล้วล็อกยอด
        const svc = db.prepare('SELECT * FROM services WHERE id=?').get(d.service_id);
        const r = rules.calcFee(d.service_id, { qty: d.qty, area: d.area_sqm }, svc);
        if (!r.ok) return { status: r.status || 400, code: r.code, message: r.message };
        fee = r.fee;
        db.prepare("UPDATE drafts SET status='PENDING_PAYMENT', fee=?, updated_at=? WHERE id=?").run(fee, now, d.id);
      }
      const ref = ids.nextPaymentRef();
      const expires = T.fromMs(clock.nowMs() + QR_TTL_MS);
      db.prepare('INSERT INTO payments(ref,draft_id,amount,status,qr_created_at,qr_expires_at) VALUES(?,?,?,?,?,?)')
        .run(ref, d.id, fee, 'PENDING', now, expires);
      return { ok: true, body: { ref, amount: fee, qrCreatedAt: now, qrExpiresAt: expires } };
    })();
    if (!out.ok) return jerr(res, out.status, out.code, out.extra, out.message);
    res.status(201).json(out.body);
  });

  // สถานะการชำระ (เฉพาะเจ้าของร่าง/คำขอ · อื่น ๆ 404)
  app.get('/api/payments/:ref', citizenOnly, (req, res) => {
    const p = db.prepare(`SELECT p.* FROM payments p JOIN drafts d ON d.id=p.draft_id
                          WHERE p.ref=? AND d.citizen_id=?`).get(req.params.ref, req.user.citizenId);
    if (!p) return jerr(res, 404, 'NOT_FOUND');
    res.json(paymentJson(p));
  });

  // ประชาชนยกเลิกคำขอที่ SUBMITTED และยังไม่มีผู้รับเรื่อง
  app.post('/api/cases/:caseNo/cancel', citizenOnly, (req, res) => {
    const r = cancelCase(req.params.caseNo, req.user.citizenId, req.user.name);
    if (!r.ok) return jerr(res, r.status, r.code);
    res.status(200).json({ status: 'CANCELLED' });
  });

  // เจ้าหน้าที่แผนกที่ถือเรื่องรับเรื่อง (หัวหน้า/บทบาทอื่น → 403)
  app.post('/api/officer/cases/:caseNo/claim', auth.requireRole('officer'), (req, res) => {
    const r = claimCase(req.params.caseNo, req.user);
    if (!r.ok) return jerr(res, r.status, r.code);
    res.status(200).json({ owner: r.owner });
  });

  // ---- test hook: callback ชำระเงินจำลอง (TEST_MODE) ----
  app.post('/api/test/payments/:ref/pay', (req, res) => {
    const amount = req.body ? req.body.amount : undefined;
    const r = settle(req.params.ref, typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : amount);
    if (!r.ok) return jerr(res, r.status, r.code);
    res.status(200).json({ status: 'PAID', caseNo: r.caseNo, receiptNo: r.receiptNo, duplicate: r.duplicate });
  });
};
Object.assign(module.exports, { mount: module.exports, settle, isExpired, statusOf });
