'use strict';
// B08 · แจ้งเตือน SLA (กระดิ่ง) (FR-19 FR-20 · BR-14 BR-15 · A-30 A-31 · CONTRACT 0.7, 2.12, 4.2, 6.3)
//   mount:  สร้าง src/routes/05-notifications.js  ->  module.exports = require('../notifications');   (module.exports เป็นฟังก์ชัน (app, ctx))
//   หน้า:   GET /notifications  (officer · head)  -> noti-item (data-case-no, data-level) / noti-empty
//   API:    GET /api/notifications -> 200 {"items":[{id,caseNo,level,text,createdAt}]} เฉพาะของผู้ใช้ที่ล็อกอิน · 403 บทบาทอื่น
//   hook:   onTick -> evaluate() ทุก request ที่ไม่ใช่ /api/test/* (ผ่าน lib/hooks; server.js เรียกให้)
//
// กติกา
//   - ประเมินเฉพาะ "ระดับปัจจุบัน" ของคำขอที่ยังเปิดและไม่ NEED_FIX (rules.slaLevel) · ระดับ normal ไม่แจ้ง · ไม่ย้อนแจ้งระดับที่ข้ามไป (A-30)
//   - ผู้รับ (A-31): PENDING_APPROVAL → head ทุกคน · APPROVED → ผู้ออกเอกสาร (issuer) · มีผู้ถือ → ผู้ถือ · ไม่มีผู้ถือ → เจ้าหน้าที่ทุกคนของแผนกที่เรื่องอยู่
//                    ระดับ overdue → เพิ่ม head ทุกคน (Set จึงไม่ซ้ำถ้าเป็นผู้รับอยู่แล้ว)
//   - 1 ครั้งต่อ (คำขอ, ระดับ, ผู้ใช้) — ตรวจก่อน INSERT ใน transaction เดียว (better-sqlite3 sync) · reset ล้างตาราง notifications (seed) จึงไม่มีอะไรค้างในหน่วยความจำ
const { db } = require('./db');
const clock = require('./lib/clock');
const hooks = require('./lib/hooks');
const rules = require('./rules');
const auth = require('./auth');

const OPEN_ACTIVE = ['SUBMITTED', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED'];
const LEVEL_TH = { near: rules.LEVEL_LABEL.near, overdue: rules.LEVEL_LABEL.overdue };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const activeStaff = (role, dept) => (dept === undefined
  ? db.prepare("SELECT username FROM users WHERE role=? AND active=1 ORDER BY username").all(role)
  : db.prepare("SELECT username FROM users WHERE role=? AND dept=? AND active=1 ORDER BY username").all(role, dept)
).map((r) => r.username);

// ผู้รับตามสถานะ/ผู้ถือ (A-31) + head เพิ่มเมื่อ overdue
function recipientsOf(c, level, heads) {
  const set = new Set();
  if (c.status === 'PENDING_APPROVAL') heads.forEach((u) => set.add(u));
  else if (c.status === 'APPROVED') {
    if (c.issuer) set.add(c.issuer); // ผู้ออกเอกสารเท่านั้น · ไม่มี issuer ไม่ fallback ไปเจ้าหน้าที่ทะเบียนคนอื่น
  } else if (c.owner) set.add(c.owner);
  else if (c.dept) activeStaff('officer', c.dept).forEach((u) => set.add(u));
  if (level === 'overdue') heads.forEach((u) => set.add(u));
  return [...set];
}

const evaluate = db.transaction(() => {
  const nowIso = clock.now();
  const cases = db.prepare(
    `SELECT case_no, status, dept, owner, issuer, due_at FROM cases
      WHERE status IN (${OPEN_ACTIVE.map(() => '?').join(',')}) ORDER BY case_no`).all(...OPEN_ACTIVE);
  if (!cases.length) return;
  const holidays = rules.loadHolidays();
  const heads = activeStaff('head');
  const exists = db.prepare('SELECT 1 FROM notifications WHERE username=? AND case_no=? AND level=? LIMIT 1');
  const insert = db.prepare('INSERT INTO notifications(username,case_no,level,text,created_at) VALUES(?,?,?,?,?)');
  for (const c of cases) {
    const { level } = rules.slaLevel(c.status, c.due_at, nowIso, holidays);
    if (level !== 'near' && level !== 'overdue') continue;
    const text = `คำขอ ${c.case_no} ${LEVEL_TH[level]}`;
    for (const u of recipientsOf(c, level, heads)) {
      if (exists.get(u, c.case_no, level)) continue;
      insert.run(u, c.case_no, level, text, nowIso);
    }
  }
});

function listFor(username) {
  return db.prepare('SELECT id, case_no, level, text, created_at FROM notifications WHERE username=? ORDER BY id').all(username)
    .map((r) => ({ id: r.id, caseNo: r.case_no, level: r.level, text: r.text, createdAt: r.created_at }));
}

// ---------------------------------------------------------------- หน้า /notifications
function page(req, res) {
  const u = req.user;
  const items = listFor(u.username);
  const body = items.length
    ? `<ul style="list-style:none;padding:0">${items.map((i) => `<li class="card" data-testid="noti-item" data-case-no="${esc(i.caseNo)}" data-level="${esc(i.level)}"><a href="/officer/cases/${esc(i.caseNo)}">${esc(i.text)}</a> <small><time data-iso="${esc(i.createdAt)}" datetime="${esc(i.createdAt)}">${esc(i.createdAt)}</time></small></li>`).join('')}</ul>`
    : '<p data-testid="noti-empty">ไม่มีแจ้งเตือน</p>';
  const nav = `<a href="/officer/queue" data-testid="nav-queue">คิวงาน</a>${u.role === 'head' ? '<a href="/head/approvals" data-testid="nav-approvals">รออนุมัติ</a>' : ''}`
    + `<a href="/notifications" data-testid="nav-bell">แจ้งเตือน <span data-testid="bell-count">${items.length}</span></a>`;
  res.status(200).type('html').send(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>แจ้งเตือน · e-Service กลาง</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,"Noto Sans Thai",sans-serif;margin:0;color:#1b1b1b;background:#fff}
header{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;padding:.6rem 1rem;background:#0b3d6e;color:#fff}header a{color:#fff}
main{max-width:1000px;margin:1rem auto;padding:0 1rem;overflow-wrap:anywhere}.card{border:1px solid #767676;border-radius:6px;padding:.8rem;margin:.8rem 0}a{color:#0b3d6e}</style></head><body>
<header data-testid="app-header"><strong>e-Service กลาง</strong>${nav}<span style="flex:1"></span>
<span data-testid="user-name">${esc(u.name)}</span>
<span data-testid="user-role" data-role="${esc(u.role)}"${u.role === 'officer' ? ` data-dept="${esc(u.dept)}"` : ''}>${esc(auth.ROLE_TH[u.role])}</span>
<a href="/api/auth/logout-page" data-testid="logout-btn">ออกจากระบบ</a></header>
<main><h1>แจ้งเตือน</h1>${body}</main></body></html>`);
}

// ---------------------------------------------------------------- ระดับเตือนในทุกแถวคำขอ (FR-19 · CONTRACT 4.2)
// หน้า /citizen (my-case-row) และ /head/approvals (approval-row) เป็นของบล็อกอื่น ห้ามแก้ไฟล์ จึงเติมคอลัมน์ระดับเตือนที่นี่
// ผ่าน onTick: ครอบ res.send ของ request นั้น แล้วเติม <th>/<td data-testid="row-sla-level" data-level> ให้ทุกแถว
// (ระดับ = rules.slaLevel ตามสถานะจริง: normal/near/overdue/paused/closed) · แถวที่มี row-sla-level อยู่แล้วจะไม่เติมซ้ำ
const SLA_PAGES = new Set(['/citizen', '/head/approvals']);
const ROW_RE = /<tr\b[^>]*data-testid="(?:my-case-row|approval-row)"[^>]*data-case-no="([^"]*)"[^>]*>[\s\S]*?<\/tr>/g;

function addSlaColumn(html) {
  if (typeof html !== 'string' || !html.includes('data-case-no=')) return html;
  const holidays = rules.loadHolidays();
  const get = db.prepare('SELECT status, due_at FROM cases WHERE case_no=?');
  const nowIso = clock.now();
  let touched = false;
  let out = html.replace(ROW_RE, (row, no) => {
    if (row.includes('data-testid="row-sla-level"')) return row;
    const c = get.get(String(no).replace(/&amp;/g, '&'));
    if (!c) return row;
    touched = true;
    const sla = rules.slaLevel(c.status, c.due_at, nowIso, holidays);
    const cell = `<td data-testid="row-sla-level" data-level="${esc(sla.level)}">${esc(sla.label)}</td>`;
    // วางต่อจากเซลล์ กำหนดเสร็จ (row-due) ให้ตรงหัวคอลัมน์ ระดับเตือน; ไม่พบ row-due ค่อยต่อท้ายแถว
    const withDue = row.replace(/(<td\b[^>]*data-testid="row-due"[^>]*>[\s\S]*?<\/td>)/, `$1${cell}`);
    return withDue !== row ? withDue : row.replace(/<\/tr>$/, `${cell}</tr>`);
  });
  if (touched) out = out.replace(/(<th\b[^>]*>กำหนดเสร็จ<\/th>)/g, '$1<th scope="col">ระดับเตือน</th>');
  return out;
}

function decorateSla(req) {
  const res = req.res;
  if (!res || req.method !== 'GET' || !SLA_PAGES.has(String(req.path || '').replace(/\/+$/, '') || '/')) return;
  const send = res.send.bind(res);
  res.send = (body) => {
    let b = body;
    try { b = addSlaColumn(body); } catch (e) { console.error('notifications.addSlaColumn', e && e.stack ? e.stack : e); }
    return send(b);
  };
}

// ---------------------------------------------------------------- mount
module.exports = function mount(app) {
  hooks.onTick((req) => {
    try { evaluate(); } catch (e) { console.error('notifications.evaluate', e && e.stack ? e.stack : e); }
    try { decorateSla(req); } catch (e) { console.error('notifications.decorateSla', e && e.stack ? e.stack : e); }
  });
  app.get('/notifications', (req, res) => auth.pageGuard(req, res, () => page(req, res)));
  app.get('/api/notifications', auth.requireRole('officer', 'head'), (req, res) => {
    res.status(200).json({ items: listFor(req.user.username) });
  });
};

Object.assign(module.exports, { mount: module.exports, evaluate, listFor, recipientsOf, addSlaColumn });
