'use strict';
// seed ตาม TEST-DATA.md ทุกค่า (ตรงตัว) · reset = ล้างทุกตาราง (DROP) → สร้างใหม่ → seed → นาฬิกา 2026-12-01T09:00:00+07:00
// ข้อมูลประวัติไม่สร้างแจ้งเตือน/Audit (A-35) · กำหนดเสร็จ (due_at) เป็นค่าตายตัวไม่คำนวณใหม่
const { db, dropAll, createSchema } = require('./db');
const cfg = require('./config');
const clock = require('./lib/clock');
const hooks = require('./lib/hooks');
const C = require('./lib/crypto');
const pwd = require('./lib/password');

const T = (s) => s.replace(' ', 'T') + ':00+07:00'; // '2026-11-05 10:00' -> ISO +07:00

// ---------- 1. บัญชี ----------
const CITIZENS = [
  { id: 1, idNo: '1101700123456', name: 'สมชาย ใจดี',  mobile: '0812345678', registered: 1 },
  { id: 2, idNo: '3100600987659', name: 'สมหญิง รักไทย', mobile: '0823456789', registered: 1 },
  { id: 3, idNo: '5500400111221', name: 'มานะ ตั้งใจ',  mobile: null,         registered: 0 }, // เข้าครั้งแรก
  { id: 4, idNo: '1909900555015', name: 'ปิติ มีสุข',   mobile: '0834567890', registered: 1 },
];
const [SOMCHAI, SOMYING, , PITI] = [1, 2, 3, 4];

const STAFF = [
  ['off.reg1',   'เจ้าหน้าที่ทะเบียน 1', 'officer',   'registry'],
  ['off.reg2',   'เจ้าหน้าที่ทะเบียน 2', 'officer',   'registry'],
  ['off.works1', 'เจ้าหน้าที่โยธา 1',    'officer',   'works'],
  ['head1',      'หัวหน้าฝ่าย',          'head',      ''],
  ['exec1',      'ผู้บริหาร',            'executive', ''],
  ['audit1',     'ผู้ตรวจสอบภายใน',      'auditor',   ''],
  ['admin1',     'ผู้ดูแลระบบ',          'admin',     ''],
];
const pwCache = new Map(); // scrypt ช้า: คำนวณครั้งเดียวต่อ user ต่อ process
const staffHash = (u) => { if (!pwCache.has(u)) pwCache.set(u, pwd.hash(cfg.STAFF_PASSWORD)); return pwCache.get(u); };

// ---------- 2-3. บริการ / เอกสาร / วันหยุด ----------
const SERVICES = [
  ['SV-01', 'ขอหนังสือรับรอง', 20, null, null, 3],
  ['SV-02', 'ขออนุญาตประกอบกิจการ', 500, null, null, 10],
  ['SV-03', 'ขออนุญาตก่อสร้าง/ต่อเติมอาคาร', null, 1000, 10, 15],
];
const SERVICE_DOCS = [ // [service, docKey, ชื่อ, required, pdfOnly, ord]
  ['SV-01', 'id-card', 'บัตรประชาชน', 1, 0, 1],
  ['SV-02', 'id-card', 'บัตรประชาชน', 1, 0, 1],
  ['SV-02', 'map', 'แผนที่ตั้ง', 1, 0, 2],
  ['SV-02', 'site-photo', 'ภาพสถานที่', 0, 0, 3],
  ['SV-03', 'id-card', 'บัตรประชาชน', 1, 0, 1],
  ['SV-03', 'plan', 'แบบแปลน', 1, 1, 2],
  ['SV-03', 'deed', 'โฉนด', 1, 0, 3],
];
const HOLIDAYS = [
  ['2026-12-07', 'ชดเชยวันหยุดทดสอบ (สมมติ)'],
  ['2026-12-10', 'วันรัฐธรรมนูญทดสอบ (สมมติ)'],
  ['2026-12-31', 'วันสิ้นปีทดสอบ (สมมติ)'],
  ['2027-01-01', 'วันขึ้นปีใหม่ทดสอบ (สมมติ)'],
];
const DOC_FILE = { 'id-card': 'id-card.pdf', map: 'map.pdf', plan: 'plan.pdf', deed: 'deed.pdf' };
const DOCS_OF = { 'SV-01': ['id-card'], 'SV-02': ['id-card', 'map'], 'SV-03': ['id-card', 'plan', 'deed'] };

// ---------- 4. คำขอ 30 ใบ ----------
// c(n, label, sv, qty|area, fee, citizen, status, extra)
// extra: step dept owner issuer wo(works_owner) rc(return_count) paid due closed fix ab(approved_by) aa(approved_at)
const REG = 'registry';
const CASES = [
  [1,  'H01', 'SV-01', { qty: 1 },    20,   SOMYING, 'COMPLETED', { paid: '2026-10-14 10:00', due: '2026-10-19 16:30', closed: '2026-10-16 14:00' }],
  [2,  'H05', 'SV-03', { area: 120 }, 1200, PITI,    'COMPLETED', { step: 3, paid: '2026-11-02 09:00', due: '2026-11-23 16:30', closed: '2026-11-20 11:00' }],
  [3,  'H02', 'SV-01', { qty: 2 },    40,   PITI,    'COMPLETED', { paid: '2026-11-02 09:30', due: '2026-11-05 16:30', closed: '2026-11-04 15:00' }],
  [4,  'H06', 'SV-02', {},            500,  SOMCHAI, 'COMPLETED', { paid: '2026-11-02 14:00', due: '2026-11-16 16:30', closed: '2026-11-13 15:00' }],
  [5,  'H03', 'SV-01', { qty: 1 },    20,   SOMCHAI, 'COMPLETED', { paid: '2026-11-03 11:00', due: '2026-11-06 16:30', closed: '2026-11-05 10:00', issuer: 'off.reg1', doc: true }],
  [6,  'H08', 'SV-02', {},            500,  PITI,    'COMPLETED', { paid: '2026-11-03 15:00', due: '2026-11-17 16:30', closed: '2026-11-19 10:00' }], // ไม่ทัน
  [7,  'H07', 'SV-02', {},            500,  SOMYING, 'COMPLETED', { paid: '2026-11-04 10:00', due: '2026-11-18 16:30', closed: '2026-11-18 16:00' }],
  [8,  'H04', 'SV-01', { qty: 1 },    20,   SOMYING, 'REJECTED',  { paid: '2026-11-09 10:00', due: '2026-11-12 16:30', closed: '2026-11-11 09:00' }],
  [9,  'X01', 'SV-01', { qty: 1 },    20,   SOMCHAI, 'CANCELLED', { paid: '2026-11-09 14:30', due: '2026-11-12 16:30', closed: '2026-11-09 15:00' }],
  [10, 'W01', 'SV-03', { area: 80 },  1000, SOMYING, 'IN_REVIEW', { step: 2, dept: 'works', issuer: 'off.reg1', paid: '2026-11-12 10:00', due: '2026-12-03 16:30' }],
  [11, 'P02', 'SV-03', { area: 150 }, 1500, SOMCHAI, 'PENDING_APPROVAL', { step: 3, dept: 'head', issuer: 'off.reg1', wo: 'off.works1', paid: '2026-11-16 10:00', due: '2026-12-08 16:30' }],
  [12, 'R09', 'SV-03', { area: 101 }, 1010, PITI,    'IN_REVIEW', { step: 1, dept: REG, owner: 'off.reg2', issuer: 'off.reg2', paid: '2026-11-18 10:00', due: '2026-12-11 16:30' }],
  [13, 'R01', 'SV-02', {},            500,  SOMCHAI, 'IN_REVIEW', { dept: REG, owner: 'off.reg2', issuer: 'off.reg2', paid: '2026-11-20 10:00', due: '2026-12-04 16:30' }],
  [14, 'P01', 'SV-02', {},            500,  PITI,    'PENDING_APPROVAL', { dept: 'head', issuer: 'off.reg1', paid: '2026-11-20 11:00', due: '2026-12-04 16:30' }],
  [15, 'R02', 'SV-02', {},            500,  SOMYING, 'IN_REVIEW', { dept: REG, owner: 'off.reg2', issuer: 'off.reg2', paid: '2026-11-20 15:00', due: '2026-12-04 16:30' }],
  [16, 'R03', 'SV-02', {},            500,  PITI,    'IN_REVIEW', { dept: REG, owner: 'off.reg2', issuer: 'off.reg2', paid: '2026-11-23 09:00', due: '2026-12-08 16:30' }],
  [17, 'F01', 'SV-01', { qty: 1 },    20,   SOMCHAI, 'NEED_FIX',  { dept: REG, owner: 'off.reg1', issuer: 'off.reg1', rc: 2, paid: '2026-11-23 10:00', due: '2026-11-27 16:30', fix: '2026-12-04 14:00' }],
  [18, 'R04', 'SV-02', {},            500,  SOMCHAI, 'IN_REVIEW', { dept: REG, owner: 'off.reg2', issuer: 'off.reg2', paid: '2026-11-24 10:00', due: '2026-12-09 16:30' }],
  [19, 'A01', 'SV-02', {},            500,  SOMYING, 'APPROVED',  { dept: REG, issuer: 'off.reg1', paid: '2026-11-24 14:00', due: '2026-12-09 16:30', ab: 'head1', aa: '2026-11-30 15:00' }],
  [20, 'O01', 'SV-01', { qty: 1 },    20,   SOMCHAI, 'IN_REVIEW', { dept: REG, owner: 'off.reg1', issuer: 'off.reg1', paid: '2026-11-25 10:00', due: '2026-11-30 16:30' }],
  [21, 'R08', 'SV-02', {},            500,  SOMYING, 'IN_REVIEW', { dept: REG, owner: 'off.reg2', issuer: 'off.reg2', paid: '2026-11-25 12:00', due: '2026-12-11 16:30' }],
  [22, 'N02', 'SV-01', { qty: 2 },    40,   SOMYING, 'IN_REVIEW', { dept: REG, owner: 'off.reg1', issuer: 'off.reg1', paid: '2026-11-26 10:00', due: '2026-12-01 16:30' }],
  [23, 'F02', 'SV-01', { qty: 1 },    20,   SOMYING, 'IN_REVIEW', { dept: REG, owner: 'off.reg1', issuer: 'off.reg1', rc: 2, paid: '2026-11-26 10:30', due: '2026-12-03 16:30' }],
  [24, 'N01', 'SV-01', { qty: 1 },    20,   PITI,    'SUBMITTED', { dept: REG, paid: '2026-11-27 11:00', due: '2026-12-02 16:30' }],
  [25, 'R05', 'SV-01', { qty: 3 },    60,   SOMYING, 'IN_REVIEW', { dept: REG, owner: 'off.reg2', issuer: 'off.reg2', paid: '2026-11-30 10:00', due: '2026-12-03 16:30' }],
  [26, 'R07', 'SV-01', { qty: 5 },    100,  SOMCHAI, 'IN_REVIEW', { dept: REG, owner: 'off.reg2', issuer: 'off.reg2', paid: '2026-11-30 16:29', due: '2026-12-03 16:30' }],
  [27, 'R06', 'SV-01', { qty: 1 },    20,   PITI,    'IN_REVIEW', { dept: REG, owner: 'off.reg2', issuer: 'off.reg2', paid: '2026-11-30 16:30', due: '2026-12-04 16:30' }],
  [28, 'S01', 'SV-01', { qty: 1 },    20,   SOMYING, 'SUBMITTED', { dept: REG, paid: '2026-12-01 08:10', due: '2026-12-04 16:30' }],
  [29, 'S02', 'SV-01', { qty: 1 },    20,   PITI,    'SUBMITTED', { dept: REG, paid: '2026-12-01 08:20', due: '2026-12-04 16:30' }],
  [30, 'S03', 'SV-01', { qty: 1 },    20,   SOMCHAI, 'SUBMITTED', { dept: REG, paid: '2026-12-01 08:30', due: '2026-12-04 16:30' }],
];

// 4.4 ประวัติตีกลับ [case, seq, returnedAt, resubmittedAt|null, pausedDays|null, reason, by]
const RETURNS = [
  [17, 1, '2026-11-24 11:00', '2026-11-25 10:00', 1, 'ภาพบัตรประชาชนไม่ชัด กรุณาถ่ายใหม่', 'off.reg1'],
  [17, 2, '2026-11-27 14:00', null, null, 'ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข', 'off.reg1'],
  [23, 1, '2026-11-27 10:00', '2026-11-30 10:00', 1, 'ภาพเอกสารเบลอ อ่านเลขไม่ได้', 'off.reg1'],
  [23, 2, '2026-11-30 14:00', '2026-12-01 08:30', 1, 'ข้อมูลในแบบฟอร์มไม่ครบถ้วน', 'off.reg1'],
];

// 5. เอกสารที่ออกแล้ว 1 ใบ
const SEED_DOC = {
  docNo: 'DOC-2569-000001', caseNo: 'EG-2569-000005', applicant: 'สมชาย ใจดี', serviceId: 'SV-01',
  issuedAt: T('2026-11-05 10:00'), validUntil: '2027-02-02', signer: 'เจ้าหน้าที่ทะเบียน 1', verifyCode: 'K7M2Q9XA',
};

const caseNo = (n) => `EG-2569-${String(n).padStart(6, '0')}`;
const receiptNo = (n) => `RC-2569-${String(n).padStart(6, '0')}`;

// PDF จริงขนาดเล็ก (หัว %PDF) สำหรับไฟล์แนบของ seed
function tinyPdf(label) {
  return Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% seed file: ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`, 'latin1');
}

function seedTx() {
  dropAll();
  createSchema();

  const insCit = db.prepare('INSERT INTO citizens(id,id_hash,id_enc,id_masked,name,mobile_enc,email,registered,consent,registered_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const c of CITIZENS) {
    insCit.run(c.id, C.blindIndex(c.idNo), C.encrypt(c.idNo), C.maskIdNo(c.idNo), c.name,
      c.mobile ? C.encrypt(c.mobile) : null, '', c.registered, c.registered, c.registered ? T('2026-10-01 09:00') : null);
  }

  const insUser = db.prepare('INSERT INTO users(username,password_hash,name,role,dept,active) VALUES(?,?,?,?,?,1)');
  for (const [u, name, role, dept] of STAFF) insUser.run(u, staffHash(u), name, role, dept);

  const insSv = db.prepare('INSERT INTO services(id,name,fee,fee_base,fee_per_sqm,sla_days) VALUES(?,?,?,?,?,?)');
  for (const s of SERVICES) insSv.run(...s);
  const insSd = db.prepare('INSERT INTO service_docs(service_id,doc_key,name,required,pdf_only,ord) VALUES(?,?,?,?,?,?)');
  for (const d of SERVICE_DOCS) insSd.run(...d);
  const insHol = db.prepare('INSERT INTO holidays(date,name) VALUES(?,?)');
  for (const h of HOLIDAYS) insHol.run(...h);

  // ไฟล์แนบ: ลำดับ fileId ตามเลขคำขอ แล้วต่อด้วยไฟล์ของร่าง
  let fileSeq = 0;
  const insFile = db.prepare('INSERT INTO files(id,citizen_id,draft_id,case_no,doc_key,name,mime,size,data,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const addFile = (citizen, draftId, cNo, docKey, at) => {
    const name = DOC_FILE[docKey];
    const data = tinyPdf(`${cNo || draftId} ${name}`);
    insFile.run(`F-${String(++fileSeq).padStart(4, '0')}`, citizen, draftId, cNo, docKey, name, 'application/pdf', data.length, data, at);
  };

  const insCase = db.prepare(`INSERT INTO cases(case_no,label,service_id,citizen_id,draft_id,qty,area_sqm,fee,status,step,dept,owner,issuer,works_owner,
      return_count,paid_at,receipt_no,due_at,closed_at,fix_deadline,approved_by,approved_at,doc_no,verify_code)
      VALUES(?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insTl = db.prepare('INSERT INTO case_timeline(case_no,time,event,actor,detail) VALUES(?,?,?,?,?)');
  const nameOf = Object.fromEntries(CITIZENS.map((c) => [c.id, c.name]));
  for (const [n, label, sv, qa, fee, cit, status, x] of CASES) {
    const no = caseNo(n);
    insCase.run(no, label, sv, cit, qa.qty ?? null, qa.area ?? null, fee, status, x.step ?? null, x.dept ?? null, x.owner ?? null,
      x.issuer ?? null, x.wo ?? null, x.rc ?? 0, T(x.paid), receiptNo(n), T(x.due), x.closed ? T(x.closed) : null,
      x.fix ? T(x.fix) : null, x.ab ?? null, x.aa ? T(x.aa) : null, x.doc ? SEED_DOC.docNo : null, x.doc ? SEED_DOC.verifyCode : null);
    for (const k of DOCS_OF[sv]) addFile(cit, null, no, k, T(x.paid));
    insTl.run(no, T(x.paid), 'PAID', nameOf[cit], `${receiptNo(n)}`);
    if (x.aa) insTl.run(no, T(x.aa), 'APPROVED', x.ab, '');
    if (x.closed) insTl.run(no, T(x.closed), status === 'CANCELLED' ? 'CANCELLED' : status === 'REJECTED' ? 'REJECTED' : 'COMPLETED', status === 'CANCELLED' ? nameOf[cit] : '', '');
  }
  const insRet = db.prepare('INSERT INTO case_returns(case_no,seq,returned_at,returned_by,reason,resubmitted_at,paused_days) VALUES(?,?,?,?,?,?,?)');
  for (const [n, seq, at, re, pd, reason, by] of RETURNS) {
    insRet.run(caseNo(n), seq, T(at), by, reason, re ? T(re) : null, pd);
    insTl.run(caseNo(n), T(at), 'RETURNED', by, reason);
    if (re) insTl.run(caseNo(n), T(re), 'RESUBMITTED', nameOf[CASES[n - 1][5]], '');
  }

  // เอกสารที่ออกแล้ว (ลายเซ็นคำนวณจริงด้วยคีย์ทดสอบ)
  db.prepare('INSERT INTO documents(doc_no,case_no,applicant,service_id,issued_at,valid_until,signer,verify_code,signature) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(SEED_DOC.docNo, SEED_DOC.caseNo, SEED_DOC.applicant, SEED_DOC.serviceId, SEED_DOC.issuedAt, SEED_DOC.validUntil,
      SEED_DOC.signer, SEED_DOC.verifyCode, C.signDoc(SEED_DOC));
  db.prepare('INSERT INTO case_timeline(case_no,time,event,actor,detail) VALUES(?,?,?,?,?)').run(SEED_DOC.caseNo, SEED_DOC.issuedAt, 'ISSUED', 'off.reg1', SEED_DOC.docNo);

  // 4.2 ร่างของสมชาย + รอชำระ
  const insDraft = db.prepare('INSERT INTO drafts(id,citizen_id,service_id,qty,area_sqm,fee,status,case_no,created_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,?,?)');
  insDraft.run('DR-0001', SOMCHAI, 'SV-01', 2, null, 40, 'DRAFT', T('2026-12-01 08:40'), T('2026-12-01 08:40'));
  insDraft.run('DR-0002', SOMCHAI, 'SV-02', null, null, 500, 'PENDING_PAYMENT', T('2026-12-01 08:50'), T('2026-12-01 08:55'));
  addFile(SOMCHAI, 'DR-0002', null, 'id-card', T('2026-12-01 08:51'));
  addFile(SOMCHAI, 'DR-0002', null, 'map', T('2026-12-01 08:52'));
  db.prepare('INSERT INTO payments(ref,draft_id,amount,status,qr_created_at,qr_expires_at) VALUES(?,?,?,?,?,?)')
    .run('PP-0001', 'DR-0002', 500, 'PENDING', '2026-12-01T08:55:00+07:00', '2026-12-01T09:10:00+07:00');

  // ตัวนับ: ถัดไป EG-2569-000031 · RC-2569-000031 · DOC-2569-000002 · DR-0003 · PP-0002
  const insCnt = db.prepare('INSERT INTO counters(name,value) VALUES(?,?)');
  insCnt.run('case_2569', 30); insCnt.run('receipt_2569', 30); insCnt.run('doc_2569', 1);
  insCnt.run('draft', 2); insCnt.run('payment', 1); insCnt.run('file', fileSeq);

  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('clock', cfg.DEFAULT_CLOCK);
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('seeded', '1');
}

const seedAll = db.transaction(seedTx);

// ล้าง + seed + นาฬิกาเริ่มต้น + แจ้งโมดูลอื่นให้ล้างสถานะในหน่วยความจำ
function resetAll() {
  clock.reset();
  seedAll();
  hooks.runReset();
  return clock.now();
}

module.exports = { resetAll, seedAll, caseNo, CITIZENS, STAFF, SEED_DOC };
