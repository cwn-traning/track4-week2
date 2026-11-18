'use strict';
// B06 · งานเจ้าหน้าที่/หัวหน้า + หน้ารายละเอียดคำขอ (FR-09, FR-11..16, FR-29 · BR-16..21, BR-24, BR-29 · REQUIREMENTS §4 · CONTRACT 2.6-2.8, 4.1, 6.2-6.3, 6.7)
//   mount:  สร้าง src/routes/04-workflow.js  ->  module.exports = require('../workflow');   (module.exports เป็นฟังก์ชัน (app, ctx))
//   หน้า:   GET /officer/queue · /officer/cases/:caseNo · /head/approvals · /citizen/cases/:caseNo
//   API:    GET  /api/officer/queue · GET /api/cases · GET /api/cases/:caseNo
//           POST /api/officer/cases/:caseNo/{return,forward,unmask} · POST /api/cases/:caseNo/{approve,reject,resubmit}
//           GET  /api/cases/:caseNo/files · GET /api/files/:fileId
//   hook:   onTick -> ยกเลิกอัตโนมัติเมื่อ NEED_FIX เลย 168 ชม. (A-46)
//   ไม่รวม: claim (อยู่ใน payment.js แล้ว — ห้ามประกาศซ้ำ) · cancel (payment.js) · issue / PDF / verify (documents.js)
//   หน้ารายละเอียดแสดง doc-no / verify-code / doc-qr / download-doc-btn จากตาราง documents (เขียนโดยบล็อกเอกสาร)
//   BUG_MODE ที่ใช้: B06 (IDOR) · B07 (เจ้าหน้าที่อนุมัติ SV-02/03) · B09 (คิวส่ง idNo) · B11 (unmask ไม่บันทึก Audit) · B12 (ตีกลับครั้งที่ 3)
const nodeCrypto = require('crypto');
const { db } = require('./db');
const clock = require('./lib/clock');
const hooks = require('./lib/hooks');
const ids = require('./lib/ids');
const T = require('./lib/time');
const C = require('./lib/crypto');
const { isBug } = require('./lib/bugs');
const rules = require('./rules');
const auth = require('./auth');
const citizen = require('./citizen');

const MAX_RETURNS = 2; // BR-19
const FIX_MS = 168 * 3600 * 1000; // BR-20
const MIN_REASON = 10;
const MAX_FILES = 5;
const MAX_BODY = 12 * 1024 * 1024;

const MSG = {
  NOT_FOUND: 'ไม่พบคำขอ',
  FILE_NOT_FOUND: 'ไม่พบไฟล์',
  FORBIDDEN: 'ไม่มีสิทธิ์ทำรายการนี้',
  INVALID_STATE: 'สถานะคำขอไม่ถูกต้องสำหรับรายการนี้',
  RETURN_LIMIT: 'ตีกลับได้สูงสุด 2 ครั้ง',
  REASON_TOO_SHORT: 'กรุณากรอกเหตุผลอย่างน้อย 10 ตัวอักษร',
  REASON_REQUIRED: 'กรุณากรอกเหตุผล',
  FIX_WINDOW_EXPIRED: 'หมดเวลาแก้ไขแล้ว คำขอถูกยกเลิก',
  FILE_TOO_LARGE: 'ไฟล์ใหญ่เกิน 5 MB',
  FILE_TYPE: 'รองรับเฉพาะไฟล์ PDF, JPG, PNG',
  FILE_COUNT: 'แนบได้สูงสุด 5 ไฟล์ต่อคำขอ',
  PLAN_NOT_PDF: 'แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น',
  BAD_REQUEST: 'รูปแบบข้อมูลไม่ถูกต้อง',
};
const STATUS_TH = citizen.STATUS_TH || {
  DRAFT: 'ร่าง', PENDING_PAYMENT: 'รอชำระเงิน', SUBMITTED: 'ส่งคำขอแล้ว', IN_REVIEW: 'กำลังตรวจสอบ',
  NEED_FIX: 'รอแก้ไขเอกสาร', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติ', COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก',
};
const STEP_TH = { 1: 'ขั้นตอน 1/3 · ฝ่ายทะเบียน', 2: 'ขั้นตอน 2/3 · ฝ่ายโยธา', 3: 'ขั้นตอน 3/3 · หัวหน้าฝ่าย' };
const EVENT_TH = {
  PAID: 'ชำระเงิน', RECEIVED: 'รับเรื่อง', RETURNED: 'ตีกลับ', RESUBMITTED: 'ส่งแก้ไข', FORWARDED: 'ส่งต่อ',
  APPROVED: 'อนุมัติ', REJECTED: 'ไม่อนุมัติ', ISSUED: 'ออกเอกสาร', COMPLETED: 'เสร็จสิ้น', CANCELLED: 'ยกเลิก',
};
const DEPT_TH = { registry: 'ฝ่ายทะเบียน', works: 'ฝ่ายโยธา', head: 'หัวหน้าฝ่าย' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jerr = (res, status, code, extra) => res.status(status).json({ code, message: MSG[code] || code, ...(extra || {}) });
const fail = (res, r) => jerr(res, r.status, r.code, r.extra);
const err = (status, code, extra) => ({ ok: false, status, code, extra });

// ---------------------------------------------------------------- ข้อมูล
const CASE_SQL = `SELECT c.*, z.name AS applicant, z.id_masked AS id_masked, z.id_enc AS id_enc, s.name AS service_name
  FROM cases c JOIN citizens z ON z.id=c.citizen_id LEFT JOIN services s ON s.id=c.service_id`;
const getCase = (caseNo) => db.prepare(`${CASE_SQL} WHERE c.case_no=?`).get(String(caseNo));
const userNames = () => Object.fromEntries(db.prepare('SELECT username,name FROM users').all().map((u) => [u.username, u.name]));
const workloadOf = (username) => db.prepare("SELECT COUNT(*) n FROM cases WHERE status='IN_REVIEW' AND owner=?").get(username).n;
const reasonOf = (v) => (typeof v === 'string' ? v.trim() : '');
const reasonLen = (s) => Array.from(s).length;
const slaOf = (c, holidays) => rules.slaLevel(c.status, c.due_at, undefined, holidays);
const caseDoc = (c) => (c.doc_no ? db.prepare('SELECT * FROM documents WHERE doc_no=?').get(c.doc_no) : null)
  || db.prepare('SELECT * FROM documents WHERE case_no=? ORDER BY rowid DESC').get(c.case_no) || null;

function writeAudit(user, event, c, from, to, detail) {
  db.prepare('INSERT INTO audit(time,username,role,event,case_no,from_status,to_status,detail) VALUES(?,?,?,?,?,?,?,?)')
    .run(clock.now(), user.username, user.role, event, c.case_no, from || '', to || '', detail || '');
}
function writeTimeline(caseNo, time, event, actor, detail) {
  db.prepare('INSERT INTO case_timeline(case_no,time,event,actor,detail) VALUES(?,?,?,?,?)').run(caseNo, time, event, actor || '', detail || '');
}

// เรียงคิว BR-16: กำหนดเสร็จเร็วสุดก่อน · เท่ากันเลขคำขอน้อยก่อน
const byQueue = (a, b) => (T.parseIso(a.due_at) - T.parseIso(b.due_at)) || (a.case_no < b.case_no ? -1 : a.case_no > b.case_no ? 1 : 0);

// ---------------------------------------------------------------- ยกเลิกอัตโนมัติ (A-46 · BR-20)
const cancelOne = db.transaction((caseNo, at) => {
  const u = db.prepare("UPDATE cases SET status='CANCELLED', dept=NULL, closed_at=? WHERE case_no=? AND status='NEED_FIX'").run(at, caseNo);
  if (u.changes === 1) writeTimeline(caseNo, at, 'CANCELLED', 'ระบบ', 'หมดเวลาแก้ไข 168 ชั่วโมง ระบบยกเลิกอัตโนมัติ');
  return u.changes === 1;
});
function autoCancelExpired() {
  const rows = db.prepare("SELECT case_no, fix_deadline FROM cases WHERE status='NEED_FIX'").all();
  if (!rows.length) return 0;
  const nowMs = clock.nowMs();
  let n = 0;
  for (const r of rows) {
    const dl = r.fix_deadline ? T.parseIso(r.fix_deadline) : null;
    if (dl == null || nowMs < dl) continue; // 167:59 ยังส่งแก้ได้ · 168:00 ยกเลิก
    if (cancelOne(r.case_no, T.fromMs(dl))) n++;
  }
  return n;
}

// ---------------------------------------------------------------- สิทธิ์
// เจ้าหน้าที่ถือเรื่อง: ต้องเป็น officer แผนกเดียวกับที่เรื่องอยู่ และ (ถ้ามีผู้ถือ) เป็นผู้ถือเอง (A-28)
function holderError(c, u) {
  if (!u || u.role !== 'officer') return 'FORBIDDEN';
  if (c.dept && c.dept !== u.dept) return 'FORBIDDEN';
  if (c.owner && c.owner !== u.username) return 'FORBIDDEN';
  return null;
}
const isHolder = (c, u) => !!u && u.role === 'officer' && c.status === 'IN_REVIEW' && c.owner === u.username;

// BR-29: ไฟล์แนบ
//   officer ทะเบียน = ทุกใบที่ชำระแล้ว · officer โยธา = SV-03 ที่ถึงขั้น 2 แล้ว · head ทุกใบ · citizen ของตัวเอง
function officerSeesFiles(c, u) {
  if (u.dept === 'registry') return true;
  if (u.dept === 'works') return c.service_id === 'SV-03' && (c.step || 0) >= 2;
  return false;
}
// คืน null = ผ่าน · หรือ {status, code}
function fileAccess(user, c) {
  if (user.role === 'citizen') return c && c.citizen_id === user.citizenId ? null : { status: 404, code: 'NOT_FOUND' };
  if (user.role !== 'officer' && user.role !== 'head') return { status: 403, code: 'FORBIDDEN' };
  if (!c) return { status: 404, code: 'NOT_FOUND' };
  if (user.role === 'head') return null;
  return officerSeesFiles(c, user) ? null : { status: 403, code: 'FORBIDDEN' };
}

// ---------------------------------------------------------------- JSON ของคำขอ (CONTRACT 6.7)
function decryptIdNo(c) {
  return C.decrypt(c.id_enc);
}
function caseJson(c, viewer, holidays) {
  const sla = slaOf(c, holidays);
  const doc = caseDoc(c);
  const out = {
    caseNo: c.case_no, serviceId: c.service_id, status: c.status, step: c.step ?? null, fee: c.fee,
    paidAt: c.paid_at, dueAt: c.due_at, slaLevel: sla.level, owner: c.owner || null, returnCount: c.return_count,
    closedAt: c.status === 'COMPLETED' || c.status === 'REJECTED' ? c.closed_at : null,
    applicantName: c.applicant,
    fixDeadline: c.status === 'NEED_FIX' ? c.fix_deadline : null,
    docNo: c.doc_no || (doc && doc.doc_no) || null, verifyCode: c.verify_code || (doc && doc.verify_code) || null,
  };
  if (viewer.role === 'citizen' && viewer.citizenId === c.citizen_id) out.idNo = decryptIdNo(c); // เจ้าของเห็นเต็ม
  else out.idMasked = c.id_masked; // เจ้าหน้าที่/หัวหน้า: ห้ามมี idNo
  return out;
}

// ---------------------------------------------------------------- คิว (FR-12 · A-34)
function queueRows(user, filter) {
  const args = [];
  let where = "c.status IN ('SUBMITTED','IN_REVIEW','APPROVED')";
  if (user.role === 'officer') { where += ' AND c.dept = ?'; args.push(user.dept); } else where += " AND c.dept IN ('registry','works')";
  if (filter === 'unclaimed') where += " AND c.status IN ('SUBMITTED','IN_REVIEW') AND c.owner IS NULL";
  else if (filter === 'mine') { where += " AND c.status='IN_REVIEW' AND c.owner = ?"; args.push(user.username || ''); }
  return db.prepare(`${CASE_SQL} WHERE ${where}`).all(...args).sort(byQueue);
}
const canClaim = (c, u) => !!u && u.role === 'officer' && !c.owner && (c.status === 'SUBMITTED' || c.status === 'IN_REVIEW') && c.dept === u.dept;
const FILTERS = new Set(['all', 'unclaimed', 'mine']);

// ---------------------------------------------------------------- การกระทำ (atomic)
const returnCase = db.transaction((caseNo, user, reason) => {
  const c = getCase(caseNo);
  if (!c) return err(404, 'NOT_FOUND');
  if (holderError(c, user)) return err(403, 'FORBIDDEN');
  if (c.status !== 'IN_REVIEW' || c.owner !== user.username) return err(409, 'INVALID_STATE');
  if (!isBug('B12') && c.return_count >= MAX_RETURNS) return err(409, 'RETURN_LIMIT'); // BUG B12: ตีกลับครั้งที่ 3 ได้
  const text = reasonOf(reason);
  if (reasonLen(text) < MIN_REASON) return err(400, 'REASON_TOO_SHORT');
  const now = clock.now();
  const deadline = T.fromMs(clock.nowMs() + FIX_MS);
  const lim = isBug('B12') ? '' : ` AND return_count < ${MAX_RETURNS}`;
  const u = db.prepare(`UPDATE cases SET status='NEED_FIX', return_count=return_count+1, fix_deadline=?
                        WHERE case_no=? AND status='IN_REVIEW' AND owner=?${lim}`).run(deadline, caseNo, user.username);
  if (u.changes !== 1) return err(409, 'INVALID_STATE');
  const seq = c.return_count + 1;
  db.prepare('INSERT INTO case_returns(case_no,seq,returned_at,returned_by,reason,resubmitted_at,paused_days) VALUES(?,?,?,?,?,NULL,NULL)')
    .run(caseNo, seq, now, user.username, text);
  writeTimeline(caseNo, now, 'RETURNED', user.name || user.username, text);
  writeAudit(user, 'RETURN', c, 'IN_REVIEW', 'NEED_FIX', text);
  return { ok: true, body: { status: 'NEED_FIX', returnCount: seq } };
});

const forwardCase = db.transaction((caseNo, user, note) => {
  const c = getCase(caseNo);
  if (!c) return err(404, 'NOT_FOUND');
  if (holderError(c, user)) return err(403, 'FORBIDDEN');
  if (c.status !== 'IN_REVIEW' || c.owner !== user.username) return err(409, 'INVALID_STATE');
  if (c.service_id === 'SV-01' || c.dept === 'head') return err(409, 'INVALID_STATE'); // SV-01 ตัดสินเองที่ขั้นทะเบียน ไม่มีส่งต่อ
  const text = typeof note === 'string' ? note.trim() : '';
  const now = clock.now();
  let to; // { status, step, dept, works }
  let body;
  if (c.service_id === 'SV-02') { // ทะเบียน → หัวหน้า
    to = { status: 'PENDING_APPROVAL', step: null, dept: 'head', works: c.works_owner };
    body = { status: 'PENDING_APPROVAL' };
  } else if (c.dept === 'registry') { // SV-03 ขั้น 1 ทะเบียน → ขั้น 2 โยธา (ยัง IN_REVIEW ไม่มีผู้ถือ)
    to = { status: 'IN_REVIEW', step: 2, dept: 'works', works: c.works_owner };
    body = { status: 'IN_REVIEW', step: 2 };
  } else { // SV-03 ขั้น 2 โยธา → ขั้น 3 หัวหน้า
    to = { status: 'PENDING_APPROVAL', step: 3, dept: 'head', works: user.username };
    body = { status: 'PENDING_APPROVAL', step: 3 };
  }
  const issuer = c.dept === 'registry' ? (c.issuer || user.username) : c.issuer; // A-27 ผู้ออกเอกสาร = ทะเบียนที่รับเรื่องขั้นแรก
  const u = db.prepare(`UPDATE cases SET status=?, step=?, dept=?, owner=NULL, issuer=?, works_owner=?
                        WHERE case_no=? AND status='IN_REVIEW' AND owner=?`)
    .run(to.status, to.step, to.dept, issuer, to.works, caseNo, user.username);
  if (u.changes !== 1) return err(409, 'INVALID_STATE');
  writeTimeline(caseNo, now, 'FORWARDED', user.name || user.username, text);
  writeAudit(user, 'FORWARD', c, 'IN_REVIEW', to.status, text);
  return { ok: true, body };
});

// อำนาจตัดสิน (FR-16 · BR-21): SV-01 = ผู้ถือเรื่อง (IN_REVIEW) · SV-02/03 = head ที่ PENDING_APPROVAL เท่านั้น
function decideGuard(c, user) {
  if (!user || (user.role !== 'officer' && user.role !== 'head')) return err(403, 'FORBIDDEN');
  if (c.service_id === 'SV-01') {
    if (user.role !== 'officer' || holderError(c, user)) return err(403, 'FORBIDDEN');
    if (c.status !== 'IN_REVIEW' || c.owner !== user.username) return err(409, 'INVALID_STATE');
    return null;
  }
  const bug = isBug('B07') && user.role === 'officer'; // BUG B07: เจ้าหน้าที่ตัดสิน SV-02/03 ได้เอง
  if (user.role !== 'head' && !bug) return err(403, 'FORBIDDEN');
  if (c.status !== 'PENDING_APPROVAL' && !(bug && c.status === 'IN_REVIEW')) return err(409, 'INVALID_STATE');
  return null;
}
const OPEN_FOR_DECISION = "('PENDING_APPROVAL','IN_REVIEW')";

const approveCase = db.transaction((caseNo, user) => {
  const c = getCase(caseNo);
  if (!c) return err(404, 'NOT_FOUND');
  const g = decideGuard(c, user);
  if (g) return g;
  const now = clock.now();
  let u;
  if (c.service_id === 'SV-01') { // ผู้ถือเรื่องอนุมัติ → เป็นผู้ออกเอกสาร (A-27) · APPROVED ไม่มีผู้ถือ (A-34)
    u = db.prepare(`UPDATE cases SET status='APPROVED', owner=NULL, issuer=?, approved_by=?, approved_at=?
                    WHERE case_no=? AND status='IN_REVIEW' AND owner=?`).run(user.username, user.username, now, caseNo, user.username);
  } else { // หัวหน้าอนุมัติ → กลับไปที่ทะเบียนเพื่อออกเอกสาร
    const states = c.status === 'PENDING_APPROVAL' ? "('PENDING_APPROVAL')" : OPEN_FOR_DECISION;
    u = db.prepare(`UPDATE cases SET status='APPROVED', dept='registry', owner=NULL, issuer=COALESCE(issuer, owner), approved_by=?, approved_at=?
                    WHERE case_no=? AND status IN ${states}`).run(user.username, now, caseNo);
  }
  if (u.changes !== 1) return err(409, 'INVALID_STATE');
  writeTimeline(caseNo, now, 'APPROVED', user.name || user.username, '');
  writeAudit(user, 'APPROVE', c, c.status, 'APPROVED', '');
  return { ok: true, body: { status: 'APPROVED' } };
});

const rejectCase = db.transaction((caseNo, user, reason) => {
  const c = getCase(caseNo);
  if (!c) return err(404, 'NOT_FOUND');
  const g = decideGuard(c, user);
  if (g) return g;
  const text = reasonOf(reason);
  if (reasonLen(text) < MIN_REASON) return err(400, 'REASON_TOO_SHORT');
  const now = clock.now();
  const u = c.service_id === 'SV-01'
    ? db.prepare("UPDATE cases SET status='REJECTED', dept=NULL, closed_at=? WHERE case_no=? AND status='IN_REVIEW' AND owner=?").run(now, caseNo, user.username)
    : db.prepare(`UPDATE cases SET status='REJECTED', dept=NULL, closed_at=? WHERE case_no=? AND status IN ${c.status === 'PENDING_APPROVAL' ? "('PENDING_APPROVAL')" : OPEN_FOR_DECISION}`).run(now, caseNo);
  if (u.changes !== 1) return err(409, 'INVALID_STATE');
  writeTimeline(caseNo, now, 'REJECTED', user.name || user.username, text);
  writeAudit(user, 'REJECT', c, c.status, 'REJECTED', text);
  return { ok: true, body: { status: 'REJECTED', closedAt: now } };
});

// ประชาชนส่งแก้ไข (FR-11 · BR-13 · BR-20 · A-29): กลับ IN_REVIEW กับผู้ถือเดิม ไม่ตรวจเพดาน 10 งาน
const resubmitCase = db.transaction((caseNo, citizenId, file) => {
  autoCancelExpired();
  const c = getCase(caseNo);
  if (!c || c.citizen_id !== citizenId) return err(404, 'NOT_FOUND');
  if (c.status === 'CANCELLED') {
    const last = db.prepare('SELECT resubmitted_at FROM case_returns WHERE case_no=? ORDER BY seq DESC LIMIT 1').get(caseNo);
    if (last && !last.resubmitted_at && c.fix_deadline) return err(409, 'FIX_WINDOW_EXPIRED');
    return err(409, 'INVALID_STATE');
  }
  if (c.status !== 'NEED_FIX') return err(409, 'INVALID_STATE');
  const nowMs = clock.nowMs();
  if (c.fix_deadline && nowMs >= T.parseIso(c.fix_deadline)) return err(409, 'FIX_WINDOW_EXPIRED');
  const now = clock.now();

  if (file) {
    const have = db.prepare('SELECT COUNT(*) n FROM files WHERE case_no=?').get(caseNo).n;
    if (have >= MAX_FILES) return err(400, 'FILE_COUNT');
    const keys = new Set(db.prepare('SELECT doc_key FROM service_docs WHERE service_id=?').all(c.service_id).map((r) => r.doc_key));
    const docKey = keys.has(file.docKey) || file.docKey === 'extra' ? file.docKey : 'extra';
    const chk = citizen.checkFile(file.data, docKey);
    if (!chk.ok) return err(chk.status || 400, chk.code);
    const name = String(file.filename || 'file').split(/[\\/]/).pop().slice(0, 200) || 'file';
    db.prepare('INSERT INTO files(id,citizen_id,draft_id,case_no,doc_key,name,mime,size,data,created_at) VALUES(?,?,NULL,?,?,?,?,?,?,?)')
      .run(ids.nextFileId(), c.citizen_id, caseNo, docKey, name, chk.mime, file.data.length, file.data, now);
  }

  const ret = db.prepare('SELECT * FROM case_returns WHERE case_no=? AND resubmitted_at IS NULL ORDER BY seq DESC LIMIT 1').get(caseNo);
  const returnedAt = ret ? ret.returned_at : T.fromMs(T.parseIso(c.fix_deadline) - FIX_MS);
  const holidays = rules.loadHolidays();
  const paused = rules.pausedBusinessDays(returnedAt, now, holidays);
  const dueAt = rules.extendDueAt(c.due_at, returnedAt, now, holidays); // หยุดนับ SLA ระหว่าง NEED_FIX
  const u = db.prepare("UPDATE cases SET status='IN_REVIEW', due_at=?, fix_deadline=NULL WHERE case_no=? AND status='NEED_FIX'").run(dueAt, caseNo);
  if (u.changes !== 1) return err(409, 'INVALID_STATE');
  if (ret) db.prepare('UPDATE case_returns SET resubmitted_at=?, paused_days=? WHERE id=?').run(now, paused, ret.id);
  writeTimeline(caseNo, now, 'RESUBMITTED', c.applicant, file ? `แนบไฟล์ ${file.filename || ''}`.trim() : '');
  return { ok: true, body: { status: 'IN_REVIEW', dueAt } };
});

// ---------------------------------------------------------------- multipart (ไม่บังคับ) ของ resubmit
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    let over = false;
    req.on('data', (ch) => { n += ch.length; if (over) return; if (n > limit) { over = true; chunks.length = 0; return; } chunks.push(ch); });
    req.on('end', () => (over ? reject(Object.assign(new Error('too large'), { tooLarge: true })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
async function readOptionalFile(req) {
  const ct = String(req.headers['content-type'] || '');
  const m = /^multipart\/form-data;.*boundary=("?)([^";]+)\1/i.exec(ct);
  if (!m) return { file: null };
  const buf = await readRaw(req, MAX_BODY);
  const { fields, file } = citizen.parseMultipart(buf, m[2]);
  if (!file || !file.data || file.data.length === 0) return { file: null };
  return { file: { filename: file.filename, data: file.data, docKey: String(fields.docKey || 'extra') } };
}

// ---------------------------------------------------------------- หน้า
const fmtId = (id) => C.formatIdNo(String(id));
function bellCount(user) {
  try { return db.prepare('SELECT COUNT(*) n FROM notifications WHERE username=?').get(user.username).n; } catch (_e) { return 0; }
}
function layout(req, title, body) {
  const u = req.user;
  const staff = u.role === 'officer' || u.role === 'head';
  const nav = u.role === 'citizen'
    ? '<a href="/citizen" data-testid="nav-my-cases">คำขอของฉัน</a>'
    : `<a href="/officer/queue" data-testid="nav-queue">คิวงาน</a>${u.role === 'head' ? '<a href="/head/approvals" data-testid="nav-approvals">รออนุมัติ</a>' : ''}`
      + (staff ? `<a href="/notifications" data-testid="nav-bell">แจ้งเตือน <span data-testid="bell-count">${bellCount(u)}</span></a>` : '');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · e-Service กลาง</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,"Noto Sans Thai",sans-serif;margin:0;color:#1b1b1b;background:#fff}
header{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;padding:.6rem 1rem;background:#0b3d6e;color:#fff}header a{color:#fff}
main{max-width:1000px;margin:1rem auto;padding:0 1rem;overflow-wrap:anywhere}.tw{overflow-x:auto;max-width:100%}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #767676;padding:.4rem .6rem;text-align:left;vertical-align:top}
button,input,select,textarea{font:inherit;padding:.4rem .6rem;max-width:100%}textarea{width:100%}
.err{color:#a30018}.ok{color:#0a5c28}.card{border:1px solid #767676;border-radius:6px;padding:.8rem;margin:.8rem 0}
.row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.4rem 0}dl{margin:0}dt{font-weight:600}dd{margin:0 0 .5rem}</style></head><body>
<header data-testid="app-header"><strong>e-Service กลาง</strong>${nav}<span style="flex:1"></span>
<span data-testid="user-name">${esc(u.name)}</span>
<span data-testid="user-role" data-role="${esc(u.role)}"${u.role === 'officer' ? ` data-dept="${esc(u.dept)}"` : ''}>${esc(auth.ROLE_TH[u.role])}</span>
<a href="/api/auth/logout-page" data-testid="logout-btn">ออกจากระบบ</a></header>
<main><div id="msg" aria-live="polite"></div><div id="content">${body}</div></main><script>${CLIENT_JS}</script></body></html>`;
}
function notFoundPage(req, res) {
  res.status(404).type('html').send(layout(req, 'ไม่พบคำขอ', '<h1 data-testid="not-found-msg">ไม่พบคำขอ</h1>'));
}

// QR จำลอง (ลวดลายจากรหัสตรวจสอบ ไม่ใช่ QR จริง)
function qrDataUri(text) {
  const n = 21;
  const h = Buffer.concat([nodeCrypto.createHash('sha256').update(text).digest(), nodeCrypto.createHash('sha256').update('2' + text).digest(), nodeCrypto.createHash('sha256').update('3' + text).digest()]);
  const finder = (x, y) => { for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) { const dx = x - fx; const dy = y - fy; if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4); } return null; };
  let r = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const f = finder(x, y);
    const on = f !== null ? f : ((h[(y * n + x) >> 3] >> ((y * n + x) & 7)) & 1) === 1;
    if (on) r += `<rect x="${x + 2}" y="${y + 2}" width="1" height="1"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" width="120" height="120"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${r}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const baseUrl = (req) => String(process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

function timelineHtml(caseNo) {
  const rows = db.prepare('SELECT * FROM case_timeline WHERE case_no=? ORDER BY time, id').all(caseNo);
  return `<ol data-testid="case-timeline">${rows.map((t) => `<li data-testid="timeline-item" data-iso="${esc(t.time)}" data-event="${esc(t.event)}"><time datetime="${esc(t.time)}">${esc(T.fmtThai(t.time))}</time> · <strong>${esc(EVENT_TH[t.event] || t.event)}</strong>${t.actor ? ` · ${esc(t.actor)}` : ''}${t.detail ? ` · ${esc(t.detail)}` : ''}</li>`).join('')}</ol>`;
}
function filesHtml(c) {
  const files = db.prepare('SELECT id,name,doc_key,size FROM files WHERE case_no=? ORDER BY rowid').all(c.case_no);
  if (!files.length) return '<p>ไม่มีไฟล์แนบ</p>';
  return `<ul>${files.map((f) => `<li data-testid="doc-item" data-name="${esc(f.name)}" data-file-id="${esc(f.id)}" data-doc-key="${esc(f.doc_key)}">${esc(f.name)} (${f.size} ไบต์) <a data-testid="doc-download-link" href="/api/files/${esc(f.id)}" download aria-label="ดาวน์โหลด ${esc(f.name)}">ดาวน์โหลด</a></li>`).join('')}</ul>`;
}
function docHtml(req, c, isCitizen) {
  const d = caseDoc(c);
  if (!d && !c.doc_no) return '';
  const docNo = c.doc_no || d.doc_no;
  const code = c.verify_code || (d && d.verify_code) || '';
  return `<section class="card" aria-label="เอกสารดิจิทัล"><h2>เอกสารดิจิทัล</h2>
<p>เลขเอกสาร: <strong data-testid="doc-no">${esc(docNo)}</strong></p>
<p>รหัสตรวจสอบ: <strong data-testid="verify-code">${esc(code)}</strong></p>
<img data-testid="doc-qr" alt="QR ตรวจสอบเอกสาร" data-url="${esc(baseUrl(req))}/verify/${esc(code)}" src="${qrDataUri(code)}" width="120" height="120">
${isCitizen ? `<p><a data-testid="download-doc-btn" href="/api/documents/${esc(docNo)}/pdf" download="${esc(docNo)}.pdf">ดาวน์โหลดเอกสาร</a></p>` : ''}</section>`;
}

function commonFields(c, holidays) {
  const sla = slaOf(c, holidays);
  return `<dl>
<dt>เลขคำขอ</dt><dd data-testid="case-no">${esc(c.case_no)}</dd>
<dt>สถานะ</dt><dd data-testid="case-status" data-status="${esc(c.status)}">${esc(STATUS_TH[c.status] || c.status)}</dd>
<dt>บริการ</dt><dd data-testid="case-service">${esc(c.service_id)} ${esc(c.service_name)}</dd>
${c.service_id === 'SV-03' && STEP_TH[c.step] ? `<dt>ขั้นตอน</dt><dd data-testid="case-step">${esc(STEP_TH[c.step])}</dd>` : ''}
<dt>ค่าธรรมเนียม</dt><dd data-testid="case-fee">${esc(T.fmtBaht(c.fee))}</dd>
<dt>กำหนดเสร็จ</dt><dd data-testid="sla-due" data-iso="${esc(c.due_at)}">${esc(T.fmtThai(c.due_at))}</dd>
<dt>ระดับเตือน</dt><dd data-testid="sla-level" data-level="${esc(sla.level)}">${esc(sla.label)}</dd>
${(c.status === 'COMPLETED' || c.status === 'REJECTED') && c.closed_at ? `<dt>ปิดงานเมื่อ</dt><dd data-testid="closed-at" data-iso="${esc(c.closed_at)}">${esc(T.fmtThai(c.closed_at))}</dd>` : ''}
<dt>ผู้ถือเรื่อง</dt><dd data-testid="case-owner">${c.owner ? esc(c.owner) : 'ยังไม่มีผู้รับ'}</dd>
</dl>`;
}

// ---- หน้ารายละเอียดฝั่งเจ้าหน้าที่/หัวหน้า
function officerCasePage(req, res) {
  const u = req.user;
  const c = getCase(req.params.caseNo);
  if (!c) return notFoundPage(req, res);
  const holidays = rules.loadHolidays();
  const decide = (c.service_id === 'SV-01' ? isHolder(c, u) : u.role === 'head' && c.status === 'PENDING_APPROVAL');
  const canReturn = isHolder(c, u) && (isBug('B12') || c.return_count < MAX_RETURNS);
  const canForward = isHolder(c, u) && c.service_id !== 'SV-01';
  const canIssue = c.status === 'APPROVED' && u.role === 'officer' && c.issuer === u.username;
  const no = esc(c.case_no);
  const canSeeFiles = fileAccess(u, c) === null;

  const actions = [];
  if (canClaim(c, u)) actions.push(`<div class="row"><button type="button" data-testid="claim-btn" data-act="claim" data-case="${no}">รับเรื่อง</button></div>`);
  if (canForward) {
    actions.push(`<div class="row"><label for="forward-note">หมายเหตุส่งต่อ (ไม่บังคับ)</label><input id="forward-note" data-testid="forward-note" maxlength="500">
<button type="button" data-testid="forward-btn" data-act="forward" data-case="${no}">ผ่าน/ส่งต่อ</button></div>`);
  }
  if (decide) actions.push(`<div class="row"><button type="button" data-testid="approve-btn" data-act="approve" data-case="${no}">อนุมัติ</button></div>`);
  if (canReturn) {
    actions.push(`<section class="card" aria-label="ตีกลับ"><button type="button" data-testid="return-btn" data-act="open" data-target="return-reason">ตีกลับ</button>
<p><label for="return-reason">เหตุผลการตีกลับ (อย่างน้อย 10 ตัวอักษร)</label><textarea id="return-reason" data-testid="return-reason" rows="2"></textarea></p>
<div id="return-err"></div><button type="button" data-testid="return-submit" data-act="return" data-case="${no}">ยืนยันตีกลับ</button></section>`);
  }
  if (decide) {
    actions.push(`<section class="card" aria-label="ไม่อนุมัติ"><button type="button" data-testid="reject-btn" data-act="open" data-target="reject-reason">ไม่อนุมัติ</button>
<p><label for="reject-reason">เหตุผลที่ไม่อนุมัติ (อย่างน้อย 10 ตัวอักษร)</label><textarea id="reject-reason" data-testid="reject-reason" rows="2"></textarea></p>
<div id="reject-err"></div><button type="button" data-testid="reject-submit" data-act="reject" data-case="${no}">ยืนยันไม่อนุมัติ</button></section>`);
  }
  if (canIssue) actions.push(`<div class="row"><button type="button" data-testid="issue-btn" data-act="issue" data-case="${no}">ออกเอกสาร</button></div>`);

  const body = `<h1>คำขอ ${no}</h1>
${u.role === 'officer' ? `<p>งานในมือของฉัน: <strong data-testid="workload-count">${workloadOf(u.username)}</strong></p>` : ''}
<section class="card" aria-label="ข้อมูลคำขอ">${commonFields(c, holidays)}
<dl><dt>ผู้ยื่น</dt><dd data-testid="applicant-name">${esc(c.applicant)}</dd>
<dt>เลขบัตรประชาชน</dt><dd><span data-testid="applicant-id">${esc(c.id_masked)}</span> <span id="full-id-box"></span></dd>
<dt>ตีกลับแล้ว (ครั้ง)</dt><dd data-testid="return-count">${c.return_count}</dd></dl></section>
<section class="card" aria-label="แสดงเลขเต็ม"><button type="button" data-testid="show-full-id-btn" data-act="open" data-target="unmask-reason">แสดงเลขเต็ม</button>
<p><label for="unmask-reason">เหตุผลที่ขอดูเลขเต็ม</label><input id="unmask-reason" data-testid="unmask-reason"></p>
<div id="unmask-err"></div><button type="button" data-testid="unmask-submit" data-act="unmask" data-case="${no}">ยืนยัน</button></section>
${actions.length ? `<section aria-label="ดำเนินการ"><h2>ดำเนินการ</h2>${actions.join('')}</section>` : ''}
${docHtml(req, c, false)}
<section aria-label="ไฟล์แนบ"><h2>เอกสารแนบ</h2>${canSeeFiles ? filesHtml(c) : '<p>ไม่มีสิทธิ์ดูไฟล์แนบ</p>'}</section>
<section aria-label="ไทม์ไลน์"><h2>ไทม์ไลน์</h2>${timelineHtml(c.case_no)}</section>`;
  res.type('html').send(layout(req, `คำขอ ${c.case_no}`, body));
}

// ---- หน้ารายละเอียดฝั่งประชาชน
function citizenCasePage(req, res) {
  const u = req.user;
  const c = getCase(req.params.caseNo);
  if (!c || (c.citizen_id !== u.citizenId && !isBug('B06'))) return notFoundPage(req, res); // BUG B06: ไม่ตรวจเจ้าของ (IDOR)
  const holidays = rules.loadHolidays();
  const own = c.citizen_id === u.citizenId;
  const no = esc(c.case_no);
  const nowMs = clock.nowMs();
  const lastReturn = db.prepare('SELECT reason FROM case_returns WHERE case_no=? ORDER BY seq DESC LIMIT 1').get(c.case_no);
  const canFix = own && c.status === 'NEED_FIX' && c.fix_deadline && nowMs < T.parseIso(c.fix_deadline);
  const canCancel = own && c.status === 'SUBMITTED' && !c.owner;

  const body = `<h1>คำขอ ${no}</h1>
<section class="card" aria-label="ข้อมูลคำขอ">${commonFields(c, holidays)}
<dl><dt>เลขบัตรประชาชน</dt><dd data-testid="case-id-full">${own ? esc(fmtId(decryptIdNo(c))) : esc(c.id_masked)}</dd></dl>
${c.status === 'NEED_FIX' ? `<dl><dt>เหตุผลที่ถูกตีกลับ</dt><dd data-testid="return-reason-display">${esc(lastReturn ? lastReturn.reason : '')}</dd>
<dt>แก้ไขได้ถึง</dt><dd data-testid="fix-deadline" data-iso="${esc(c.fix_deadline)}">${esc(T.fmtThai(c.fix_deadline))}</dd></dl>` : ''}
${c.status === 'REJECTED' || c.status === 'CANCELLED' ? '<p data-testid="no-refund-note">ค่าธรรมเนียมที่ชำระแล้วไม่คืน</p>' : ''}</section>
${canFix ? `<section class="card" aria-label="ส่งแก้ไข"><p><label for="fix-file">แนบไฟล์ใหม่ (ไม่บังคับ)</label> <input type="file" id="fix-file" data-testid="fix-upload-input" accept=".pdf,.jpg,.jpeg,.png"></p>
<button type="button" data-testid="submit-fix-btn" data-act="resubmit" data-case="${no}">ส่งแก้ไข</button></section>` : ''}
${canCancel ? `<section class="card" aria-label="ยกเลิกคำขอ"><button type="button" data-testid="cancel-case-btn" data-act="cancel-open">ยกเลิกคำขอ</button>
<div id="cancel-box" hidden><p data-testid="cancel-confirm-text">ค่าธรรมเนียมที่ชำระแล้วไม่คืน</p>
<button type="button" data-testid="confirm-cancel-btn" data-act="cancel" data-case="${no}">ยืนยันยกเลิก</button></div></section>` : ''}
${docHtml(req, c, own)}
<section aria-label="ไฟล์แนบ"><h2>เอกสารแนบ</h2>${own ? filesHtml(c) : '<p>ไม่มีไฟล์แนบ</p>'}</section>
<section aria-label="ไทม์ไลน์"><h2>ไทม์ไลน์</h2>${timelineHtml(c.case_no)}</section>`;
  res.type('html').send(layout(req, `คำขอ ${c.case_no}`, body));
}

// ---- คิวงาน
function queuePage(req, res) {
  const u = req.user;
  const filter = FILTERS.has(req.query.filter) ? req.query.filter : 'all';
  const rows = queueRows(u, filter);
  const names = userNames();
  const holidays = rules.loadHolidays();
  const tr = rows.map((c) => {
    const sla = slaOf(c, holidays);
    return `<tr data-testid="queue-row" data-case-no="${esc(c.case_no)}" data-owner="${esc(c.owner || '')}" data-status="${esc(c.status)}" data-sla-level="${esc(sla.level)}">
<td data-testid="row-case-no"><a href="/officer/cases/${esc(c.case_no)}">${esc(c.case_no)}</a></td>
<td data-testid="row-service">${esc(c.service_id)} ${esc(c.service_name)}</td><td data-testid="row-applicant">${esc(c.applicant)}</td>
<td data-testid="row-id-masked">${esc(c.id_masked)}</td><td data-testid="row-status">${esc(STATUS_TH[c.status] || c.status)}</td>
<td data-testid="row-due" data-iso="${esc(c.due_at)}">${esc(T.fmtThai(c.due_at))}</td>
<td data-testid="row-sla-level" data-level="${esc(sla.level)}">${esc(sla.label)}</td>
<td data-testid="row-owner">${c.owner ? esc(names[c.owner] || c.owner) : ''}</td>
<td>${canClaim(c, u) ? `<button type="button" data-testid="claim-btn" data-act="claim" data-case="${esc(c.case_no)}">รับเรื่อง</button>` : ''}</td></tr>`;
  }).join('');
  const opt = (v, t) => `<option value="${v}"${filter === v ? ' selected' : ''}>${t}</option>`;
  const body = `<h1>คิวงาน${u.role === 'head' ? ' (อ่านอย่างเดียว)' : ''}</h1>
${u.role === 'officer' ? `<p>งานในมือของฉัน: <strong data-testid="workload-count">${workloadOf(u.username)}</strong> / 10</p>` : ''}
<p><label for="queue-filter">แสดง</label> <select id="queue-filter" data-testid="queue-filter">${opt('all', 'ทั้งหมด')}${opt('unclaimed', 'ยังไม่มีผู้รับ')}${opt('mine', 'ของฉัน')}</select></p>
<div class="tw"><table data-testid="queue-table"><caption>รายการงานในคิว${u.role === 'officer' ? ` (${esc(DEPT_TH[u.dept] || u.dept)})` : ''}</caption><thead><tr><th scope="col">เลขคำขอ</th><th scope="col">บริการ</th><th scope="col">ผู้ยื่น</th><th scope="col">เลขบัตร</th><th scope="col">สถานะ</th><th scope="col">กำหนดเสร็จ</th><th scope="col">ระดับเตือน</th><th scope="col">ผู้ถือเรื่อง</th><th scope="col">ดำเนินการ</th></tr></thead>
<tbody>${tr}</tbody></table></div>
${rows.length ? '' : '<p data-testid="queue-empty">ไม่มีงานในคิว</p>'}`;
  res.type('html').send(layout(req, 'คิวงาน', body));
}

// ---- รออนุมัติของหัวหน้า
function approvalsPage(req, res) {
  const rows = db.prepare(`${CASE_SQL} WHERE c.status='PENDING_APPROVAL'`).all().sort(byQueue);
  const tr = rows.map((c) => `<tr data-testid="approval-row" data-case-no="${esc(c.case_no)}">
<td data-testid="row-case-no">${esc(c.case_no)}</td><td data-testid="row-service">${esc(c.service_id)} ${esc(c.service_name)}</td>
<td data-testid="row-applicant">${esc(c.applicant)}</td><td data-testid="row-due" data-iso="${esc(c.due_at)}">${esc(T.fmtThai(c.due_at))}</td>
<td><a data-testid="approval-open" href="/officer/cases/${esc(c.case_no)}">เปิดคำขอ</a></td></tr>`).join('');
  const body = `<h1>รออนุมัติ</h1><div class="tw"><table><caption>คำขอที่รอหัวหน้าฝ่ายอนุมัติ</caption><thead><tr><th scope="col">เลขคำขอ</th><th scope="col">บริการ</th><th scope="col">ผู้ยื่น</th><th scope="col">กำหนดเสร็จ</th><th scope="col">เปิด</th></tr></thead><tbody>${tr}</tbody></table></div>
${rows.length ? '' : '<p>ไม่มีรายการรออนุมัติ</p>'}`;
  res.type('html').send(layout(req, 'รออนุมัติ', body));
}

// ---------------------------------------------------------------- สคริปต์ฝั่งหน้า (event delegation · แทนที่ #content หลังทำสำเร็จ)
const CLIENT_JS = `(function(){
var msg=document.getElementById('msg');
function say(kind,text){msg.textContent='';var p=document.createElement('p');p.className=kind==='err'?'err':'ok';
p.setAttribute('data-testid',kind==='err'?'action-error':'action-success');p.setAttribute('role',kind==='err'?'alert':'status');p.textContent=text;msg.appendChild(p)}
function post(url,body,form){var o={method:'POST',credentials:'same-origin',headers:{}};
if(form){o.body=body}else{o.headers['Content-Type']='application/json';o.body=JSON.stringify(body||{})}
return fetch(url,o).then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {ok:r.ok,status:r.status,json:j}})})}
function refresh(){return fetch(location.href,{credentials:'same-origin'}).then(function(r){return r.text()}).then(function(t){
var d=new DOMParser().parseFromString(t,'text/html');var n=d.getElementById('content');var c=document.getElementById('content');if(n&&c)c.innerHTML=n.innerHTML;
var b=d.querySelector('[data-testid=bell-count]'),cb=document.querySelector('[data-testid=bell-count]');if(b&&cb)cb.textContent=b.textContent})}
function fieldErr(boxId,testid,text){var box=document.getElementById(boxId);if(!box)return;box.textContent='';
if(text){var p=document.createElement('p');p.className='err';p.setAttribute('role','alert');p.setAttribute('data-testid',testid);p.textContent=text;box.appendChild(p)}}
function val(id){var e=document.getElementById(id);return e?e.value:''}
function fmtId(s){return s.length===13?s[0]+'-'+s.slice(1,5)+'-'+s.slice(5,10)+'-'+s.slice(10,12)+'-'+s[12]:s}
function done(b,r,okText,refreshOnErr){
if(r.ok){say('ok',okText);return refresh()}
say('err',(r.json&&r.json.message)||'เกิดข้อผิดพลาด');if(b)b.disabled=false;return refreshOnErr?refresh():null}
document.addEventListener('change',function(e){if(e.target&&e.target.id==='queue-filter')location.search='?filter='+encodeURIComponent(e.target.value)});
document.addEventListener('click',function(e){
var b=e.target.closest?e.target.closest('[data-act]'):null;if(!b||b.disabled)return;
var act=b.getAttribute('data-act'),no=b.getAttribute('data-case');
if(act==='open'){var t=document.getElementById(b.getAttribute('data-target'));if(t)t.focus();return}
if(act==='cancel-open'){var bx=document.getElementById('cancel-box');if(bx)bx.hidden=false;return}
b.disabled=true;
if(act==='claim'){post('/api/officer/cases/'+no+'/claim').then(function(r){return done(b,r,'รับเรื่องแล้ว',true)});return}
if(act==='forward'){post('/api/officer/cases/'+no+'/forward',{note:val('forward-note')}).then(function(r){return done(b,r,'ส่งต่อแล้ว')});return}
if(act==='approve'){post('/api/cases/'+no+'/approve').then(function(r){return done(b,r,'อนุมัติแล้ว')});return}
if(act==='issue'){post('/api/officer/cases/'+no+'/issue').then(function(r){return done(b,r,'ออกเอกสารแล้ว')});return}
if(act==='cancel'){post('/api/cases/'+no+'/cancel').then(function(r){return done(b,r,'ยกเลิกคำขอแล้ว',true)});return}
if(act==='return'||act==='reject'){var p=act==='return'?'return':'reject';fieldErr(p+'-err',p+'-reason-error','');
post(act==='return'?'/api/officer/cases/'+no+'/return':'/api/cases/'+no+'/reject',{reason:val(p+'-reason')}).then(function(r){
if(!r.ok&&r.json&&r.json.code==='REASON_TOO_SHORT'){b.disabled=false;fieldErr(p+'-err',p+'-reason-error',r.json.message);return}
return done(b,r,act==='return'?'ตีกลับแล้ว':'ไม่อนุมัติแล้ว')});return}
if(act==='unmask'){fieldErr('unmask-err','unmask-error','');
post('/api/officer/cases/'+no+'/unmask',{reason:val('unmask-reason')}).then(function(r){b.disabled=false;
if(r.ok){var box=document.getElementById('full-id-box');if(box){box.textContent='';var s=document.createElement('strong');s.setAttribute('data-testid','full-id');s.textContent=fmtId(String(r.json.idNo||''));box.appendChild(s)}return}
if(r.json&&r.json.code==='REASON_REQUIRED'){fieldErr('unmask-err','unmask-error',r.json.message);return}
say('err',(r.json&&r.json.message)||'เกิดข้อผิดพลาด')});return}
if(act==='resubmit'){var f=document.getElementById('fix-file');var fd=null;
if(f&&f.files&&f.files.length){fd=new FormData();fd.append('docKey','extra');fd.append('file',f.files[0])}
(fd?post('/api/cases/'+no+'/resubmit',fd,true):post('/api/cases/'+no+'/resubmit')).then(function(r){return done(b,r,'ส่งแก้ไขแล้ว',true)});return}
});
})();`;

// ---------------------------------------------------------------- mount
module.exports = function mount(app) {
  hooks.onTick(() => { try { autoCancelExpired(); } catch (e) { console.error('autoCancelExpired', e && e.stack ? e.stack : e); } });

  const staffOnly = auth.requireRole('officer', 'head');
  const officerOnly = auth.requireRole('officer');
  const guard = (fn) => (req, res) => auth.pageGuard(req, res, () => fn(req, res));

  // ---- หน้า
  app.get('/officer/queue', guard(queuePage));
  app.get('/officer/cases/:caseNo', guard(officerCasePage));
  app.get('/head/approvals', guard(approvalsPage));
  app.get('/citizen/cases/:caseNo', guard(citizenCasePage));

  // ---- คิว (FR-12) · ห้ามมี idNo (BR-24) ยกเว้น BUG B09
  app.get('/api/officer/queue', staffOnly, (req, res) => {
    const filter = FILTERS.has(req.query.filter) ? req.query.filter : 'all';
    const holidays = rules.loadHolidays();
    const items = queueRows(req.user, filter).map((c) => {
      const it = {
        caseNo: c.case_no, serviceId: c.service_id, applicantName: c.applicant, idMasked: c.id_masked, status: c.status,
        step: c.step ?? null, owner: c.owner || null, dueAt: c.due_at, slaLevel: slaOf(c, holidays).level,
      };
      if (isBug('B09')) it.idNo = decryptIdNo(c); // BUG B09: คิวส่งเลขบัตรเต็ม
      return it;
    });
    res.json({ items });
  });

  // ---- คำขอของฉัน / รายละเอียด (FR-09)
  app.get('/api/cases', auth.requireRole('citizen'), (req, res) => {
    const holidays = rules.loadHolidays();
    const items = db.prepare('SELECT * FROM cases WHERE citizen_id=? ORDER BY case_no DESC').all(req.user.citizenId)
      .map((c) => ({ caseNo: c.case_no, serviceId: c.service_id, status: c.status, dueAt: c.due_at, slaLevel: slaOf(c, holidays).level }));
    res.json({ items });
  });

  app.get('/api/cases/:caseNo', auth.requireLogin, (req, res) => {
    const u = req.user;
    if (u.role !== 'citizen' && u.role !== 'officer' && u.role !== 'head') return jerr(res, 403, 'FORBIDDEN');
    const c = getCase(req.params.caseNo);
    if (!c) return jerr(res, 404, 'NOT_FOUND');
    if (u.role === 'citizen' && c.citizen_id !== u.citizenId && !isBug('B06')) return jerr(res, 404, 'NOT_FOUND'); // เหมือนเลขที่ไม่มีจริงทุกตัวอักษร
    res.json(caseJson(c, u, rules.loadHolidays()));
  });

  // ---- ตีกลับ / ส่งต่อ (FR-14, FR-15)
  app.post('/api/officer/cases/:caseNo/return', officerOnly, (req, res) => {
    const r = returnCase(req.params.caseNo, req.user, req.body && req.body.reason);
    if (!r.ok) return fail(res, r);
    res.status(200).json(r.body);
  });
  app.post('/api/officer/cases/:caseNo/forward', officerOnly, (req, res) => {
    const r = forwardCase(req.params.caseNo, req.user, req.body && req.body.note);
    if (!r.ok) return fail(res, r);
    res.status(200).json(r.body);
  });

  // ---- อนุมัติ / ไม่อนุมัติ (FR-16)
  app.post('/api/cases/:caseNo/approve', staffOnly, (req, res) => {
    const r = approveCase(req.params.caseNo, req.user);
    if (!r.ok) return fail(res, r);
    res.status(200).json(r.body);
  });
  app.post('/api/cases/:caseNo/reject', staffOnly, (req, res) => {
    const r = rejectCase(req.params.caseNo, req.user, req.body && req.body.reason);
    if (!r.ok) return fail(res, r);
    res.status(200).json(r.body);
  });

  // ---- ประชาชนส่งแก้ไข (FR-11) · multipart ไม่บังคับ
  app.post('/api/cases/:caseNo/resubmit', auth.requireRole('citizen'), async (req, res) => {
    let upload;
    try {
      upload = await readOptionalFile(req);
    } catch (e) {
      if (e && e.tooLarge) return jerr(res, 400, 'FILE_TOO_LARGE');
      return jerr(res, 400, 'BAD_REQUEST');
    }
    const r = resubmitCase(req.params.caseNo, req.user.citizenId, upload.file);
    if (!r.ok) {
      if (r.code === 'FIX_WINDOW_EXPIRED') autoCancelExpired();
      return fail(res, r);
    }
    res.status(200).json(r.body);
  });

  // ---- แสดงเลขเต็ม (FR-21 · BR-24) · ต้องมีเหตุผล + Audit UNMASK
  app.post('/api/officer/cases/:caseNo/unmask', staffOnly, (req, res) => {
    const c = getCase(req.params.caseNo);
    if (!c) return jerr(res, 404, 'NOT_FOUND');
    const reason = reasonOf(req.body && req.body.reason);
    if (!reason) return jerr(res, 400, 'REASON_REQUIRED');
    db.transaction(() => {
      if (!isBug('B11')) writeAudit(req.user, 'UNMASK', c, '', '', reason); // BUG B11: ไม่บันทึก Audit
    })();
    res.status(200).json({ idNo: decryptIdNo(c) });
  });

  // ---- ไฟล์แนบ (FR-29 · BR-29)
  app.get('/api/cases/:caseNo/files', auth.requireLogin, (req, res) => {
    const c = getCase(req.params.caseNo);
    const deny = fileAccess(req.user, c);
    if (deny) return jerr(res, deny.status, deny.code);
    const items = db.prepare('SELECT id,name,doc_key,size FROM files WHERE case_no=? ORDER BY rowid').all(c.case_no)
      .map((f) => ({ fileId: f.id, name: f.name, docKey: f.doc_key, size: f.size }));
    res.json({ items });
  });

  app.get('/api/files/:fileId', auth.requireLogin, (req, res) => {
    const u = req.user;
    if (u.role !== 'citizen' && u.role !== 'officer' && u.role !== 'head') return jerr(res, 403, 'FORBIDDEN');
    const f = db.prepare('SELECT * FROM files WHERE id=?').get(String(req.params.fileId));
    const notFound = () => res.status(404).json({ code: 'NOT_FOUND', message: MSG.FILE_NOT_FOUND });
    if (!f) return notFound();
    if (u.role === 'citizen') {
      if (f.citizen_id !== u.citizenId) return notFound(); // ของคนอื่น = เหมือนไม่มีไฟล์
    } else {
      const c = f.case_no ? getCase(f.case_no) : null;
      if (!c) return notFound(); // ไฟล์ของร่าง (ยังไม่มีเลขคำขอ) เจ้าหน้าที่ไม่เห็น
      const deny = fileAccess(u, c);
      if (deny) return jerr(res, deny.status, deny.code);
    }
    const ascii = String(f.name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.set({
      'Content-Type': f.mime,
      'Content-Length': String(f.data.length),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.status(200).end(f.data);
  });
};

Object.assign(module.exports, {
  mount: module.exports,
  autoCancelExpired, queueRows, caseJson, fileAccess, officerSeesFiles, canClaim, getCase,
  returnCase, forwardCase, approveCase, rejectCase, resubmitCase, STATUS_TH, STEP_TH,
});
