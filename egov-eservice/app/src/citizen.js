'use strict';
// B04 · ฝั่งประชาชน: แคตตาล็อก/ฟอร์ม/ร่าง/อัปโหลดไฟล์/เอกสารบังคับ (FR-04..07 · BR-04..08)
//   mount:  สร้าง src/routes/02-citizen.js  ->  module.exports = require('../citizen');   (module.exports เป็นฟังก์ชัน (app, ctx))
//   หน้า:   GET /citizen · GET /citizen/new/:service[?draft=DR-0003]   (CONTRACT §2.4–2.5)
//   API:    GET /api/fee · POST/GET /api/drafts · GET/PUT/DELETE /api/drafts/:id
//           POST /api/drafts/:id/files (multipart) · DELETE /api/drafts/:id/files/:fileId   (CONTRACT §6.2)
//   ไม่รวม: POST /api/drafts/:id/payment · GET /api/payments/:ref (บล็อกชำระเงิน) — หน้าขั้น 3 เรียกสองตัวนี้
//   helper: require('./citizen').missingDocs(draftId) -> ['แบบแปลน', ...] (บล็อกชำระเงินใช้ตอบ 409 MISSING_DOCS)
//           require('./citizen').checkFile(buf, docKey) -> {ok, mime} | {ok:false, status, code, message}
const { db } = require('./db');
const clock = require('./lib/clock');
const ids = require('./lib/ids');
const T = require('./lib/time');
const { isBug } = require('./lib/bugs');
const rules = require('./rules');
const auth = require('./auth');

const MAX_FILE = 5242880; // BR-07 · 5 MB
const MAX_FILES = 5;
const MAX_BODY = 20 * 1024 * 1024;

const MSG = {
  FILE_TOO_LARGE: 'ไฟล์ใหญ่เกิน 5 MB',
  FILE_TYPE: 'รองรับเฉพาะไฟล์ PDF, JPG, PNG',
  FILE_COUNT: 'แนบได้สูงสุด 5 ไฟล์ต่อคำขอ',
  PLAN_NOT_PDF: 'แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น',
  NOT_FOUND: 'ไม่พบข้อมูลที่ร้องขอ',
  INVALID_STATE: 'สถานะคำขอไม่ถูกต้องสำหรับรายการนี้',
  INVALID_DOCKEY: 'ประเภทเอกสารไม่ถูกต้อง',
  BAD_REQUEST: 'รูปแบบข้อมูลไม่ถูกต้อง',
};
const STATUS_TH = {
  DRAFT: 'ร่าง', PENDING_PAYMENT: 'รอชำระเงิน', SUBMITTED: 'ส่งคำขอแล้ว', IN_REVIEW: 'กำลังตรวจสอบ',
  NEED_FIX: 'รอแก้ไขเอกสาร', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติ', COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jerr = (res, status, code, extra) => res.status(status).json({ code, message: MSG[code] || rules.MSG[code] || code, ...(extra || {}) });

// ---------- ข้อมูลบริการ ----------
const getService = (id) => db.prepare('SELECT * FROM services WHERE id=?').get(id);
const docsOf = (sid) => db.prepare('SELECT * FROM service_docs WHERE service_id=? ORDER BY ord').all(sid);

// ---------- ชนิดไฟล์จากเนื้อไฟล์ (BR-06) ----------
function sniff(buf) {
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  return null;
}
// ตรวจขนาด -> ชนิด -> แบบแปลนต้อง PDF  (ไม่รวมจำนวนไฟล์)
function checkFile(buf, docKey) {
  const tooLarge = isBug('B02') ? buf.length >= MAX_FILE : buf.length > MAX_FILE; // B02: ใช้ < แทน ≤
  if (tooLarge) return { ok: false, status: 400, code: 'FILE_TOO_LARGE', message: MSG.FILE_TOO_LARGE };
  const mime = sniff(buf);
  if (!mime) return { ok: false, status: 400, code: 'FILE_TYPE', message: MSG.FILE_TYPE };
  if (docKey === 'plan' && mime !== 'application/pdf') return { ok: false, status: 400, code: 'PLAN_NOT_PDF', message: MSG.PLAN_NOT_PDF };
  return { ok: true, mime };
}

// ---------- เอกสารบังคับที่ขาด (BR-08) · คืนชื่อเรียงตามตาราง 4.3 ----------
function missingDocs(draftId) {
  const d = db.prepare('SELECT service_id FROM drafts WHERE id=?').get(draftId);
  if (!d) return [];
  const have = new Set(db.prepare('SELECT doc_key FROM files WHERE draft_id=?').all(draftId).map((r) => r.doc_key));
  return docsOf(d.service_id).filter((x) => x.required && !have.has(x.doc_key)).map((x) => x.name);
}

// ---------- ร่าง ----------
function ownDraft(req, id) {
  return db.prepare('SELECT * FROM drafts WHERE id=? AND citizen_id=?').get(id, req.user.citizenId);
}
function draftFiles(id) {
  return db.prepare('SELECT id,name,doc_key,size FROM files WHERE draft_id=? ORDER BY rowid').all(id)
    .map((f) => ({ fileId: f.id, name: f.name, docKey: f.doc_key, size: f.size }));
}
function draftJson(d) {
  return {
    draftId: d.id, serviceId: d.service_id, status: d.status, fee: d.fee,
    qty: d.qty, areaSqm: d.area_sqm, caseNo: d.case_no || null,
    createdAt: d.created_at, updatedAt: d.updated_at,
    files: draftFiles(d.id), missing: missingDocs(d.id),
  };
}
function feeFor(serviceId, body) {
  const svc = getService(serviceId);
  if (!svc) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'ไม่พบบริการ' };
  return rules.calcFee(serviceId, { qty: body.qty, area: body.areaSqm }, svc);
}
const normQty = (v) => (v === undefined || v === null || v === '' ? null : Number.isInteger(+v) ? +v : null);

// ---------- multipart (ไม่พึ่ง lib ภายนอก) ----------
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    let over = false;
    req.on('data', (c) => {
      n += c.length;
      if (over) return;
      if (n > limit) { over = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => (over ? reject(Object.assign(new Error('too large'), { tooLarge: true })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
function parseMultipart(buf, boundary) {
  const fields = {};
  let file = null;
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    pos += delim.length;
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // --boundary--
    if (buf[pos] === 0x0d) pos += 2;
    const hEnd = buf.indexOf('\r\n\r\n', pos);
    if (hEnd === -1) break;
    const head = buf.slice(pos, hEnd).toString('utf8');
    const next = buf.indexOf(Buffer.concat([Buffer.from('\r\n'), delim]), hEnd + 4);
    const end = next === -1 ? buf.length : next;
    const data = buf.slice(hEnd + 4, end);
    const cd = /content-disposition:[^\r\n]*/i.exec(head);
    const name = cd && /\bname="([^"]*)"/i.exec(cd[0]);
    const fn = cd && /\bfilename="([^"]*)"/i.exec(cd[0]);
    if (name) {
      if (fn) { if (!file) file = { field: name[1], filename: fn[1], data }; } else fields[name[1]] = data.toString('utf8');
    }
    pos = next === -1 ? -1 : next + 2;
  }
  return { fields, file };
}

function mountApi(app) {
  const citizenOnly = auth.requireRole('citizen');

  // คำนวณค่าธรรมเนียมแบบทันที (ใช้กับ fee-total/fee-error)
  app.get('/api/fee', citizenOnly, (req, res) => {
    const r = feeFor(String(req.query.serviceId || ''), { qty: req.query.qty, areaSqm: req.query.areaSqm });
    if (!r.ok) return res.status(r.status || 400).json({ code: r.code, message: r.message });
    res.json({ fee: r.fee });
  });

  app.post('/api/drafts', citizenOnly, (req, res) => {
    const b = req.body || {};
    const sid = String(b.serviceId || '');
    const r = feeFor(sid, b);
    if (!r.ok) return res.status(r.status || 400).json({ code: r.code, message: r.message });
    const now = clock.now();
    const id = ids.nextDraftId();
    db.prepare(`INSERT INTO drafts(id,citizen_id,service_id,qty,area_sqm,fee,status,created_at,updated_at)
                VALUES(?,?,?,?,?,?, 'DRAFT', ?, ?)`)
      .run(id, req.user.citizenId, sid, sid === 'SV-01' ? normQty(b.qty) : null, sid === 'SV-03' ? normQty(b.areaSqm) : null, r.fee, now, now);
    res.status(201).json({ draftId: id, fee: r.fee });
  });

  app.get('/api/drafts', citizenOnly, (req, res) => {
    const rows = db.prepare("SELECT * FROM drafts WHERE citizen_id=? AND status IN ('DRAFT','PENDING_PAYMENT') ORDER BY rowid").all(req.user.citizenId);
    res.json({ items: rows.map((d) => ({ draftId: d.id, serviceId: d.service_id, status: d.status, fee: d.fee, qty: d.qty, areaSqm: d.area_sqm })) });
  });

  app.get('/api/drafts/:id', citizenOnly, (req, res) => {
    const d = ownDraft(req, req.params.id);
    if (!d) return jerr(res, 404, 'NOT_FOUND');
    res.json(draftJson(d));
  });

  // แก้จำนวน/พื้นที่ของร่างที่ยังไม่ชำระ (ค่าธรรมเนียมคำนวณใหม่)
  app.put('/api/drafts/:id', citizenOnly, (req, res) => {
    const d = ownDraft(req, req.params.id);
    if (!d) return jerr(res, 404, 'NOT_FOUND');
    if (d.status !== 'DRAFT' && d.status !== 'PENDING_PAYMENT') return jerr(res, 409, 'INVALID_STATE');
    const b = req.body || {};
    const r = feeFor(d.service_id, b);
    if (!r.ok) return res.status(r.status || 400).json({ code: r.code, message: r.message });
    db.prepare('UPDATE drafts SET qty=?, area_sqm=?, fee=?, updated_at=? WHERE id=?')
      .run(d.service_id === 'SV-01' ? normQty(b.qty) : null, d.service_id === 'SV-03' ? normQty(b.areaSqm) : null, r.fee, clock.now(), d.id);
    res.json({ draftId: d.id, fee: r.fee });
  });

  app.delete('/api/drafts/:id', citizenOnly, (req, res) => {
    const d = ownDraft(req, req.params.id);
    if (!d) return jerr(res, 404, 'NOT_FOUND');
    if (d.status !== 'DRAFT' && d.status !== 'PENDING_PAYMENT') return jerr(res, 409, 'INVALID_STATE');
    db.transaction(() => {
      db.prepare('DELETE FROM files WHERE draft_id=? AND case_no IS NULL').run(d.id);
      db.prepare("DELETE FROM payments WHERE draft_id=? AND status<>'PAID'").run(d.id);
      db.prepare('DELETE FROM drafts WHERE id=?').run(d.id);
    })();
    res.status(204).end();
  });

  // อัปโหลด (multipart: file, docKey)
  app.post('/api/drafts/:id/files', citizenOnly, async (req, res) => {
    let body;
    try {
      body = await readBody(req, MAX_BODY);
    } catch (e) {
      return e.tooLarge ? jerr(res, 400, 'FILE_TOO_LARGE') : jerr(res, 400, 'BAD_REQUEST');
    }
    const d = ownDraft(req, req.params.id);
    if (!d) return jerr(res, 404, 'NOT_FOUND');
    if (d.status !== 'DRAFT' && d.status !== 'PENDING_PAYMENT') return jerr(res, 409, 'INVALID_STATE');
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers['content-type'] || '');
    if (!m || !/multipart\/form-data/i.test(req.headers['content-type'])) return jerr(res, 400, 'BAD_REQUEST');
    const { fields, file } = parseMultipart(body, (m[1] || m[2]).trim());
    if (!file) return jerr(res, 400, 'BAD_REQUEST');
    const docKey = String(fields.docKey || '').trim();
    const docs = docsOf(d.service_id);
    if (docKey !== 'extra' && !docs.some((x) => x.doc_key === docKey)) return jerr(res, 400, 'INVALID_DOCKEY');

    const chk = checkFile(file.data, docKey);
    if (!chk.ok) return res.status(chk.status).json({ code: chk.code, message: chk.message });

    const existing = docKey === 'extra' ? null : db.prepare('SELECT id FROM files WHERE draft_id=? AND doc_key=?').get(d.id, docKey);
    const count = db.prepare('SELECT COUNT(*) n FROM files WHERE draft_id=?').get(d.id).n;
    if (!existing && count >= MAX_FILES) return jerr(res, 400, 'FILE_COUNT');

    const fileId = ids.nextFileId();
    const name = (file.filename || 'file').split(/[\\/]/).pop();
    db.transaction(() => {
      if (existing) db.prepare('DELETE FROM files WHERE id=?').run(existing.id); // ช่องเอกสารเดี่ยว = แทนที่ไฟล์เดิม
      db.prepare(`INSERT INTO files(id,citizen_id,draft_id,case_no,doc_key,name,mime,size,data,created_at)
                  VALUES(?,?,?,NULL,?,?,?,?,?,?)`).run(fileId, req.user.citizenId, d.id, docKey, name, chk.mime, file.data.length, file.data, clock.now());
      db.prepare('UPDATE drafts SET updated_at=? WHERE id=?').run(clock.now(), d.id);
    })();
    res.status(201).json({ fileId, name, docKey, size: file.data.length });
  });

  app.delete('/api/drafts/:id/files/:fileId', citizenOnly, (req, res) => {
    const d = ownDraft(req, req.params.id);
    if (!d) return jerr(res, 404, 'NOT_FOUND');
    if (d.status !== 'DRAFT' && d.status !== 'PENDING_PAYMENT') return jerr(res, 409, 'INVALID_STATE');
    const r = db.prepare('DELETE FROM files WHERE id=? AND draft_id=?').run(req.params.fileId, d.id);
    if (!r.changes) return jerr(res, 404, 'NOT_FOUND');
    db.prepare('UPDATE drafts SET updated_at=? WHERE id=?').run(clock.now(), d.id);
    res.status(204).end();
  });
}

// ---------- หน้า ----------
function layout(req, title, body) {
  const u = req.user;
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · e-Service กลาง</title>
<style>body{font-family:system-ui,"Noto Sans Thai",sans-serif;margin:0;color:#222}header{display:flex;gap:1rem;align-items:center;padding:.6rem 1rem;background:#0b3d6e;color:#fff}
header a{color:#fff}main{max-width:960px;margin:1rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}.tw{overflow-x:auto;max-width:100%}td,th{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}
button,input{font:inherit;padding:.35rem .6rem}.err{color:#b00020}.ok{color:#0a6b2d}.card{border:1px solid #ccc;border-radius:6px;padding:.8rem;margin:.6rem 0}.docs>div{margin:.5rem 0}</style></head><body>
<header data-testid="app-header"><strong>e-Service กลาง</strong>
<a href="/citizen" data-testid="nav-my-cases">คำขอของฉัน</a><span style="flex:1"></span>
<span data-testid="user-name">${esc(u.name)}</span>
<span data-testid="user-role" data-role="citizen">${auth.ROLE_TH.citizen}</span>
<a href="/api/auth/logout-page" data-testid="logout-btn">ออกจากระบบ</a></header>
<main>${body}</main></body></html>`;
}
function notFoundPage(req, res) {
  res.status(404).type('html').send(layout(req, 'ไม่พบหน้า', '<h1 data-testid="not-found-msg">ไม่พบคำขอ</h1>'));
}

function listPage(req, res) {
  const cid = req.user.citizenId;
  const names = Object.fromEntries(db.prepare('SELECT id,name FROM services').all().map((s) => [s.id, s.name]));
  const services = db.prepare('SELECT id,name FROM services ORDER BY id').all();
  const cases = db.prepare('SELECT * FROM cases WHERE citizen_id=? ORDER BY case_no DESC').all(cid);
  const drafts = db.prepare("SELECT * FROM drafts WHERE citizen_id=? AND status IN ('DRAFT','PENDING_PAYMENT') ORDER BY rowid").all(cid);

  const catalog = services.map((s) => {
    const svc = getService(s.id);
    const fee = s.id === 'SV-03' ? `เริ่มต้น ${T.fmtBaht(svc.fee_base)}` : T.fmtBaht(svc.fee);
    return `<div class="card"><h3>${esc(s.id)} · ${esc(s.name)}</h3><p>ค่าธรรมเนียม ${esc(fee)} · ระยะเวลา ${svc.sla_days} วันทำการ</p>
<a href="/citizen/new/${s.id}"><button type="button" data-testid="start-service-${s.id}" onclick="location.href='/citizen/new/${s.id}'">เริ่มยื่นคำขอ</button></a></div>`;
  }).join('');

  const caseRows = cases.map((c) => `<tr data-testid="my-case-row" data-case-no="${esc(c.case_no)}" data-status="${esc(c.status)}">
<td data-testid="row-case-no"><a href="/citizen/cases/${esc(c.case_no)}">${esc(c.case_no)}</a></td><td data-testid="row-service">${esc(names[c.service_id] || c.service_id)}</td>
<td data-testid="row-status">${esc(STATUS_TH[c.status] || c.status)}</td><td data-testid="row-due" data-iso="${esc(c.due_at)}">${esc(T.fmtThai(c.due_at))}</td></tr>`).join('');

  const draftRows = drafts.map((d) => `<tr data-testid="my-draft-row" data-draft-id="${esc(d.id)}" data-status="${esc(d.status)}">
<td data-testid="row-draft-id">${esc(d.id)}</td><td data-testid="row-service">${esc(names[d.service_id] || d.service_id)}</td>
<td data-testid="row-status">${esc(STATUS_TH[d.status] || d.status)}</td><td>${T.fmtBaht(d.fee)}</td>
<td><a href="/citizen/new/${esc(d.service_id)}?draft=${esc(d.id)}" data-testid="open-draft-btn">เปิดร่าง</a></td></tr>`).join('');

  res.type('html').send(layout(req, 'คำขอของฉัน', `
<h1 data-testid="citizen-welcome">สวัสดี ${esc(req.user.name)}</h1>
<h2>เริ่มบริการ</h2>${catalog}
<h2>ร่างและรอชำระเงิน</h2>
<div class="tw"><table><thead><tr><th>รหัสร่าง</th><th>บริการ</th><th>สถานะ</th><th>ยอด</th><th></th></tr></thead><tbody>${draftRows}</tbody></table></div>
<h2>คำขอของฉัน</h2>
<div class="tw"><table><thead><tr><th>เลขคำขอ</th><th>บริการ</th><th>สถานะ</th><th>กำหนดเสร็จ</th></tr></thead><tbody>${caseRows}</tbody></table></div>`));
}

function wizardPage(req, res) {
  const sid = req.params.service;
  const svc = getService(sid);
  if (!svc) return notFoundPage(req, res);
  let draft = null;
  if (req.query.draft) {
    const d = ownDraft(req, String(req.query.draft));
    if (!d || d.service_id !== sid || (d.status !== 'DRAFT' && d.status !== 'PENDING_PAYMENT')) return notFoundPage(req, res);
    draft = draftJson(d);
  }
  const docs = docsOf(sid).map((x) => ({ key: x.doc_key, name: x.name, required: !!x.required, pdfOnly: !!x.pdf_only }));
  // ร่างที่สร้าง QR แล้ว -> เปิดหน้าที่ขั้นชำระเงินพร้อมสถานะ QR ล่าสุด (เช่น QR หมดอายุ)
  const lastPay = draft && draft.status === 'PENDING_PAYMENT'
    ? db.prepare('SELECT ref FROM payments WHERE draft_id=? ORDER BY qr_created_at DESC, rowid DESC LIMIT 1').get(draft.draftId)
    : null;
  const boot = { serviceId: sid, serviceName: svc.name, docs, draft, payRef: lastPay ? lastPay.ref : null };
  const feeInput = sid === 'SV-01'
    ? '<label>จำนวนฉบับ <input data-testid="qty-input" id="qty" type="text" inputmode="numeric" value="1" autocomplete="off"></label>'
    : sid === 'SV-03'
      ? '<label>พื้นที่ (ตร.ม.) <input data-testid="area-input" id="area" type="text" inputmode="numeric" value="" autocomplete="off"></label>'
      : '<p>ค่าธรรมเนียมคงที่</p>';
  const uploads = docs.map((x) => `<div><label>${esc(x.name)}${x.required ? ' ✱' : ''}${x.pdfOnly ? ' (PDF เท่านั้น)' : ''}
<input type="file" data-testid="upload-input-${esc(x.key)}" data-doc="${esc(x.key)}" class="up"></label></div>`).join('')
    + '<div><label>เอกสารเพิ่มเติม <input type="file" multiple data-testid="upload-input-extra" data-doc="extra" class="up"></label></div>';

  const script = `
const BOOT=${JSON.stringify(boot).replace(/</g, '\\u003c')};
const $=(id)=>document.getElementById(id);
const MO=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const thai=(iso)=>{const m=/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/.exec(iso||'');return m?(+m[3])+' '+MO[+m[2]-1]+' '+(+m[1]+543)+' '+m[4]+':'+m[5]:''};
const baht=(n)=>'฿'+Number(n).toLocaleString('en-US');
const STEPS={1:'1/3 กรอกข้อมูล',2:'2/3 แนบเอกสาร',3:'3/3 ชำระเงิน'};
let draft=BOOT.draft, fee=null, seq=0, step=1, pollT=null, curRef=null;
const api=async(method,url,body)=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let j=null;try{j=await r.json()}catch(e){}return{status:r.status,body:j}};
function show(n){step=n;$('wizard-step').textContent=STEPS[n];for(const i of [1,2,3])$('step'+i).hidden=(i!==n)}
function inputs(){return BOOT.serviceId==='SV-01'?{serviceId:'SV-01',qty:$('qty').value.trim()}:BOOT.serviceId==='SV-03'?{serviceId:'SV-03',areaSqm:$('area').value.trim()}:{serviceId:'SV-02'}}
async function recalc(){
  const my=++seq,q=inputs();
  const p=new URLSearchParams({serviceId:q.serviceId});if(q.qty!==undefined)p.set('qty',q.qty);if(q.areaSqm!==undefined)p.set('areaSqm',q.areaSqm);
  const r=await api('GET','/api/fee?'+p);if(my!==seq)return;
  const err=$('fee-error-box');
  if(r.status===200){fee=r.body.fee;$('fee-total').textContent=baht(fee);err.innerHTML='';$('to-upload-btn').disabled=false}
  else{fee=null;$('fee-total').textContent='–';err.innerHTML='<span data-testid="fee-error" class="err" role="alert"></span>';err.firstChild.textContent=(r.body&&r.body.message)||'ข้อมูลไม่ถูกต้อง';$('to-upload-btn').disabled=true}
}
function payload(){const q=inputs();return BOOT.serviceId==='SV-01'?{serviceId:q.serviceId,qty:+q.qty}:BOOT.serviceId==='SV-03'?{serviceId:q.serviceId,areaSqm:+q.areaSqm}:{serviceId:q.serviceId}}
async function saveDraft(){
  if(fee===null)return false;
  const b=payload();
  if(draft){const r=await api('PUT','/api/drafts/'+draft.draftId,b);if(r.status!==200)return false}
  else{const r=await api('POST','/api/drafts',b);if(r.status!==201)return false;draft={draftId:r.body.draftId,files:[],missing:[]}}
  $('draft-box').innerHTML='<span data-testid="draft-id"></span>';$('draft-box').firstChild.textContent=draft.draftId;
  const u=new URL(location.href);u.searchParams.set('draft',draft.draftId);history.replaceState(null,'',u);
  return true;
}
function renderFiles(){
  const ul=$('files');ul.innerHTML='';
  for(const f of draft.files){
    const li=document.createElement('li');li.setAttribute('data-testid','file-item');li.setAttribute('data-name',f.name);li.setAttribute('data-doc-key',f.docKey);
    const s=document.createElement('span');s.textContent=f.name+' ('+f.size+' B) ';li.appendChild(s);
    const b=document.createElement('button');b.type='button';b.setAttribute('data-testid','file-remove-btn');b.textContent='ลบ';
    b.onclick=async()=>{await api('DELETE','/api/drafts/'+draft.draftId+'/files/'+f.fileId);setErr('');await reload()};
    li.appendChild(b);ul.appendChild(li);
  }
  const mb=$('missing-box');mb.innerHTML='';
  if(draft.missing.length){const sp=document.createElement('p');sp.setAttribute('data-testid','missing-docs');sp.className='err';sp.textContent='ยังขาดเอกสาร: '+draft.missing.join(', ');mb.appendChild(sp)}
  $('to-payment-btn').disabled=draft.missing.length>0;
}
function setErr(t){const b=$('upload-err-box');b.innerHTML='';if(t){const s=document.createElement('p');s.setAttribute('data-testid','upload-error');s.className='err';s.setAttribute('role','alert');s.textContent=t;b.appendChild(s)}}
async function reload(){const r=await api('GET','/api/drafts/'+draft.draftId);if(r.status===200){draft=r.body;renderFiles()}}
async function upload(file,docKey){
  const fd=new FormData();fd.append('docKey',docKey);fd.append('file',file,file.name);
  const r=await fetch('/api/drafts/'+draft.draftId+'/files',{method:'POST',body:fd});let j=null;try{j=await r.json()}catch(e){}
  return{status:r.status,body:j};
}
for(const el of document.querySelectorAll('input.up')){
  el.addEventListener('change',async()=>{
    const files=[...el.files];el.value='';setErr('');
    for(const f of files){const r=await upload(f,el.dataset.doc);if(r.status!==201)setErr((r.body&&r.body.message)||'แนบไฟล์ไม่สำเร็จ');await reload()}
  });
}
$('qty')&&$('qty').addEventListener('input',recalc);
$('area')&&$('area').addEventListener('input',recalc);
$('save-draft-btn').onclick=async()=>{await recalc();await saveDraft()};
$('to-upload-btn').onclick=async()=>{if(!(await saveDraft()))return;await reload();setErr('');show(2)};
$('to-payment-btn').onclick=async()=>{await reload();if(draft.missing.length)return;$('payment-amount').textContent=baht(draft.fee);show(3);showPay(null)};
function showPay(p){
  const box=$('pay-box');box.innerHTML='';
  if(!p)return;
  const st=p.status,lab=st==='PAID'?'ชำระแล้ว':st==='EXPIRED'?'QR หมดอายุ':'รอชำระ';
  const h=(tid,txt,extra)=>{const e=document.createElement('p');e.setAttribute('data-testid',tid);e.textContent=txt;if(extra)for(const k in extra)e.setAttribute(k,extra[k]);box.appendChild(e);return e};
  const q=document.createElement('div');q.setAttribute('data-testid','qr-image');q.textContent='[QR PromptPay จำลอง]';box.appendChild(q);
  h('qr-ref',p.ref);h('qr-expires','หมดอายุ '+thai(p.qrExpiresAt),{'data-iso':p.qrExpiresAt});
  h('payment-status',lab,{'data-status':st});
  if(st==='EXPIRED'){h('qr-expired-msg','QR หมดอายุ กรุณาสร้าง QR ใหม่');const b=document.createElement('button');b.type='button';b.setAttribute('data-testid','regenerate-qr-btn');b.textContent='สร้าง QR ใหม่';b.onclick=createQr;box.appendChild(b)}
  if(st==='PAID'){
    h('submitted-case-no',p.caseNo||'');h('receipt-no',p.receiptNo||'');h('receipt-amount',baht(p.amount));
    h('receipt-paid-at',thai(p.paidAt),{'data-iso':p.paidAt||''});
    const a=document.createElement('a');a.href='/citizen/cases/'+p.caseNo;a.setAttribute('data-testid','go-case-btn');a.textContent='ดูคำขอ';box.appendChild(a);
    $('create-qr-btn').hidden=true;$('refresh-payment-btn').hidden=true;clearInterval(pollT);
  }
}
async function createQr(){
  const r=await api('POST','/api/drafts/'+draft.draftId+'/payment');
  if(r.status!==201){const e=$('pay-err');e.textContent=(r.body&&r.body.message)||'สร้าง QR ไม่สำเร็จ';return}
  $('pay-err').textContent='';curRef=r.body.ref;await refreshPay();
  clearInterval(pollT);pollT=setInterval(refreshPay,3000);
}
async function refreshPay(){
  if(!curRef)return;const r=await api('GET','/api/payments/'+curRef);if(r.status===200)showPay(r.body);
}
$('create-qr-btn').onclick=createQr;
$('refresh-payment-btn').onclick=refreshPay;
// เริ่มต้น
if(draft){
  if(BOOT.serviceId==='SV-01')$('qty').value=draft.qty??'';
  if(BOOT.serviceId==='SV-03')$('area').value=draft.areaSqm??'';
  $('draft-box').innerHTML='<span data-testid="draft-id"></span>';$('draft-box').firstChild.textContent=draft.draftId;
  renderFiles();
}
show(1);recalc();
if(BOOT.payRef){$('payment-amount').textContent=baht(draft.fee);show(3);curRef=BOOT.payRef;refreshPay()}
`;
  res.type('html').send(layout(req, svc.name, `
<h1 data-testid="service-name">${esc(svc.name)}</h1>
<p>ขั้นตอน: <strong data-testid="wizard-step" id="wizard-step">1/3 กรอกข้อมูล</strong></p>
<section id="step1"><div class="card">${feeInput}
<p>ค่าธรรมเนียม: <strong data-testid="fee-total" id="fee-total">–</strong></p><div id="fee-error-box"></div>
<p id="draft-box"></p>
<button type="button" data-testid="save-draft-btn" id="save-draft-btn">บันทึกร่าง</button>
<button type="button" data-testid="to-upload-btn" id="to-upload-btn" disabled>ไปขั้นแนบเอกสาร</button></div></section>
<section id="step2" hidden><div class="card docs"><p>แนบไฟล์ PDF/JPG/PNG ไม่เกิน 5 MB · ไม่เกิน 5 ไฟล์ต่อคำขอ</p>${uploads}
<div id="upload-err-box"></div><ul id="files"></ul><div id="missing-box"></div>
<button type="button" data-testid="to-payment-btn" id="to-payment-btn" disabled>ไปชำระเงิน</button></div></section>
<section id="step3" hidden><div class="card"><p>ยอดที่ต้องชำระ: <strong data-testid="payment-amount" id="payment-amount"></strong></p>
<p id="pay-err" class="err" role="alert"></p>
<button type="button" data-testid="create-qr-btn" id="create-qr-btn">สร้าง QR</button>
<button type="button" data-testid="refresh-payment-btn" id="refresh-payment-btn">ตรวจสอบการชำระเงิน</button>
<div id="pay-box"></div></div></section>
<script>${script}</script>`));
}

module.exports = function mount(app) {
  mountApi(app);
  app.get('/citizen', (req, res) => auth.pageGuard(req, res, () => listPage(req, res)));
  app.get('/citizen/new/:service', (req, res) => auth.pageGuard(req, res, () => wizardPage(req, res)));
};
Object.assign(module.exports, { mount: module.exports, missingDocs, checkFile, sniff, parseMultipart, STATUS_TH });
