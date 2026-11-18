'use strict';
// Mount from src/routes: module.exports = require('../admin').
const { requireRole, ROLE_TH } = require('./auth');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESSAGES = {
  INVALID_FEE: 'ค่าธรรมเนียมต้องเป็นจำนวนเต็ม 0–100,000 บาท',
  INVALID_SLA: 'SLA ต้องเป็นจำนวนเต็ม 1–60 วันทำการ',
  DUPLICATE_HOLIDAY: 'มีวันหยุดนี้อยู่แล้ว',
  SELF_ROLE_CHANGE: 'ไม่สามารถเปลี่ยนบทบาทของตัวเองได้',
  INVALID_HOLIDAY: 'กรุณาระบุวันที่และชื่อวันหยุดให้ถูกต้อง',
  INVALID_ROLE: 'กรุณาระบุบทบาทและแผนกให้ถูกต้อง',
  NOT_FOUND: 'ไม่พบข้อมูลที่ร้องขอ',
};
function integer(value, min, max) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}
const serviceJSON = (s) => ({ id: s.id, name: s.name, fee: s.id === 'SV-03' ? s.fee_base : s.fee, feeBase: s.fee_base, feePerSqm: s.fee_per_sqm, sla: s.sla_days });

function mount(app, ctx = {}) {
  const db = ctx.db || require('./db').db;
  const clock = ctx.clock || require('./lib/clock');
  const fail = (res, status, code) => res.status(status).json({ code, message: MESSAGES[code] });
  const audit = (req, detail) => db.prepare('INSERT INTO audit(time,username,role,event,detail) VALUES(?,?,?,?,?)')
    .run(clock.now(), req.user.username, req.user.role, 'ADMIN_CHANGE', detail);
  const admin = requireRole('admin');
  const services = () => db.prepare('SELECT * FROM services ORDER BY id').all();
  const holidays = () => db.prepare('SELECT date,name FROM holidays ORDER BY date').all();
  const users = () => db.prepare('SELECT username,name,role,dept,active FROM users ORDER BY username').all();

  app.get('/api/admin/services', admin, (_req, res) => res.json({ items: services().map(serviceJSON) }));
  app.put('/api/admin/services/:id', admin, (req, res) => {
    const old = db.prepare('SELECT * FROM services WHERE id=?').get(req.params.id);
    if (!old) return fail(res, 404, 'NOT_FOUND');
    const b = req.body || {};
    const building = old.id === 'SV-03';
    const fee = integer(building ? b.feeBase === undefined ? old.fee_base : b.feeBase : b.fee === undefined ? old.fee : b.fee, 0, 100000);
    const per = building ? integer(b.feePerSqm === undefined ? old.fee_per_sqm : b.feePerSqm, 0, 100000) : null;
    if (fee === null || (building && per === null)) return fail(res, 400, 'INVALID_FEE');
    const sla = integer(b.sla === undefined ? old.sla_days : b.sla, 1, 60);
    if (sla === null) return fail(res, 400, 'INVALID_SLA');
    const changes = [];
    const add = (key, before, after) => { if (before !== after) changes.push(`${old.id} ${key} ${before} → ${after}`); };
    add(building ? 'feeBase' : 'fee', building ? old.fee_base : old.fee, fee);
    if (building) add('feePerSqm', old.fee_per_sqm, per);
    add('sla', old.sla_days, sla);
    db.transaction(() => {
      db.prepare('UPDATE services SET fee=?,fee_base=?,fee_per_sqm=?,sla_days=? WHERE id=?')
        .run(building ? old.fee : fee, building ? fee : old.fee_base, building ? per : old.fee_per_sqm, sla, old.id);
      if (changes.length) audit(req, changes.join('; '));
    })();
    res.json(serviceJSON(db.prepare('SELECT * FROM services WHERE id=?').get(old.id)));
  });
  app.get('/api/admin/holidays', admin, (_req, res) => res.json({ items: holidays() }));
  app.post('/api/admin/holidays', admin, (req, res) => {
    const b = req.body || {};
    if (!validDate(b.date) || typeof b.name !== 'string' || !b.name.trim()) return fail(res, 400, 'INVALID_HOLIDAY');
    if (db.prepare('SELECT 1 FROM holidays WHERE date=?').get(b.date)) return fail(res, 409, 'DUPLICATE_HOLIDAY');
    db.transaction(() => {
      db.prepare('INSERT INTO holidays(date,name) VALUES(?,?)').run(b.date, b.name.trim());
      audit(req, `holiday add ${b.date}`);
    })();
    res.status(201).json({ date: b.date, name: b.name.trim() });
  });
  app.delete('/api/admin/holidays/:date', admin, (req, res) => {
    if (!db.prepare('SELECT 1 FROM holidays WHERE date=?').get(req.params.date)) return fail(res, 404, 'NOT_FOUND');
    db.transaction(() => {
      db.prepare('DELETE FROM holidays WHERE date=?').run(req.params.date);
      audit(req, `holiday delete ${req.params.date}`);
    })();
    res.json({ deleted: true });
  });
  app.get('/api/admin/users', admin, (_req, res) => res.json({ items: users() }));
  app.put('/api/admin/users/:username', admin, (req, res) => {
    if (req.params.username === req.user.username) return fail(res, 409, 'SELF_ROLE_CHANGE');
    const old = db.prepare('SELECT username,role,dept FROM users WHERE username=?').get(req.params.username);
    if (!old) return fail(res, 404, 'NOT_FOUND');
    const b = req.body || {};
    const role = b.role ?? old.role;
    const dept = b.dept ?? old.dept;
    // Citizen accounts are managed through ThaiD; staff roles obey the users schema.
    if (!['officer', 'head', 'executive', 'auditor', 'admin'].includes(role) || !['', 'registry', 'works'].includes(dept) || (role === 'officer' && !dept)) return fail(res, 400, 'INVALID_ROLE');
    const changes = [];
    if (role !== old.role) changes.push(`${old.username} role ${old.role} → ${role}`);
    if (dept !== old.dept) changes.push(`${old.username} dept ${old.dept} → ${dept}`);
    db.transaction(() => {
      db.prepare('UPDATE users SET role=?,dept=? WHERE username=?').run(role, dept, old.username);
      if (changes.length) audit(req, changes.join('; '));
    })();
    res.json(db.prepare('SELECT username,name,role,dept,active FROM users WHERE username=?').get(old.username));
  });

  const pageAdmin = (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (req.user.role !== 'admin') return res.status(403).type('html').send('<!doctype html><html lang="th"><meta charset="utf-8"><title>ไม่มีสิทธิ์</title><main><h1 data-testid="forbidden-msg">ไม่มีสิทธิ์เข้าถึงหน้านี้</h1></main></html>');
    next();
  };
  function page(req, title, content) {
    return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | e-Service</title>
    <style>*{box-sizing:border-box}body{margin:0;font:16px system-ui,sans-serif;color:#172b42;background:#f4f7fb}header,main{padding:20px;max-width:1100px;margin:auto}nav{display:flex;flex-wrap:wrap;gap:16px;margin-top:16px}a{color:#174c91}section,form[data-service-id],article{background:white;padding:20px;margin:16px 0;border:1px solid #c4cfdd;border-radius:10px}label{display:block;margin:12px 0}input,select,button{font:inherit;padding:10px;max-width:100%}input,select{display:block;width:100%;margin-top:6px}button{background:#174c91;color:white;border:0;border-radius:5px;cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #995300;outline-offset:3px}[role=alert]{color:#a31919}h1{font-size:1.7rem}h2{font-size:1.2rem}</style></head><body>
    <header data-testid="app-header"><strong>เทศบาลนครตัวอย่าง · e-Service</strong><p><span data-testid="user-name">${esc(req.user.name)}</span> · <span data-testid="user-role" data-role="admin">ผู้ดูแลระบบ</span></p><nav aria-label="เมนูผู้ดูแลระบบ"><a data-testid="nav-admin-services" href="/admin/services">ค่าธรรมเนียมและ SLA</a><a data-testid="nav-admin-holidays" href="/admin/holidays">วันหยุด</a><a data-testid="nav-admin-users" href="/admin/users">ผู้ใช้และบทบาท</a><a data-testid="logout-btn" href="/api/auth/logout-page">ออกจากระบบ</a></nav></header>
    <main><h1>${title}</h1><p data-testid="action-error" role="alert" hidden></p><p data-testid="action-success" role="status" hidden></p>${content}</main><script>
    const error=document.querySelector('[data-testid="action-error"]'),success=document.querySelector('[data-testid="action-success"]');
    async function send(url,method,body){error.hidden=true;success.hidden=true;try{const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.message);success.textContent='บันทึกสำเร็จ';success.hidden=false;return data}catch(e){error.textContent=e.message;error.hidden=false;return null}}
    document.addEventListener('submit',async e=>{const f=e.target;if(!f.dataset.kind)return;e.preventDefault();const v=Object.fromEntries(new FormData(f));let result;if(f.dataset.kind==='service'){for(const k in v)v[k]=v[k]===''?null:Number(v[k]);result=await send('/api/admin/services/'+f.dataset.serviceId,'PUT',v)}if(f.dataset.kind==='holiday'){result=await send('/api/admin/holidays','POST',v);if(result){const row=document.createElement('article');row.dataset.testid='holiday-row';row.dataset.date=result.date;const text=document.createElement('p');text.textContent=result.date+' '+result.name;row.append(text);const btn=document.createElement('button');btn.type='button';btn.dataset.testid='holiday-delete-btn';btn.dataset.date=result.date;btn.textContent='ลบวันหยุด';row.append(btn);document.getElementById('holidays').append(row);f.reset()}}if(f.dataset.kind==='user')result=await send('/api/admin/users/'+encodeURIComponent(f.dataset.username),'PUT',v)});
    document.addEventListener('click',async e=>{const btn=e.target.closest('[data-testid="holiday-delete-btn"]');if(btn){const result=await send('/api/admin/holidays/'+encodeURIComponent(btn.dataset.date),'DELETE');if(result)btn.closest('[data-testid="holiday-row"]').remove()}});
    </script></body></html>`;
  }
  const field = (testid, label, name, value) => `<label>${label}<input type="number" step="any" data-testid="${testid}" name="${name}" value="${esc(value)}"></label>`;
  app.get('/admin/services', pageAdmin, (req, res) => res.type('html').send(page(req, 'ค่าธรรมเนียมและ SLA', services().map(s => `<form novalidate data-kind="service" data-testid="service-row" data-service-id="${s.id}"><h2>${esc(s.name)} (${s.id})</h2>${field('svc-fee-' + s.id, s.id === 'SV-03' ? 'ค่าธรรมเนียมฐาน (บาท)' : 'ค่าธรรมเนียม (บาท)', s.id === 'SV-03' ? 'feeBase' : 'fee', s.id === 'SV-03' ? s.fee_base : s.fee)}${s.id === 'SV-03' ? field('svc-fee-per-sqm-SV-03', 'ค่าธรรมเนียมต่อพื้นที่ส่วนเกิน (บาท/ตร.ม.)', 'feePerSqm', s.fee_per_sqm) : ''}${field('svc-sla-' + s.id, 'SLA (วันทำการ)', 'sla', s.sla_days)}<button data-testid="svc-save-${s.id}" type="submit">บันทึก</button></form>`).join(''))));
  app.get('/admin/holidays', pageAdmin, (req, res) => res.type('html').send(page(req, 'จัดการวันหยุด', `<section><h2>เพิ่มวันหยุด</h2><form novalidate data-kind="holiday"><label>วันที่ (ค.ศ.)<input data-testid="holiday-date-input" type="date" name="date"></label><label>ชื่อวันหยุด<input data-testid="holiday-name-input" name="name"></label><button data-testid="holiday-add-btn">เพิ่มวันหยุด</button></form></section><div id="holidays">${holidays().map(h => `<article data-testid="holiday-row" data-date="${h.date}"><p>${h.date} ${esc(h.name)}</p><button type="button" data-testid="holiday-delete-btn" data-date="${h.date}" aria-label="ลบวันหยุด ${h.date}">ลบวันหยุด</button></article>`).join('')}</div>`)));
  const options = (values, current, labels = {}) => values.map(v => `<option value="${v}"${v === current ? ' selected' : ''}>${esc(labels[v] || v || 'ไม่มีแผนก')}</option>`).join('');
  app.get('/admin/users', pageAdmin, (req, res) => res.type('html').send(page(req, 'จัดการผู้ใช้และบทบาท', users().map(u => `<article data-testid="user-row" data-username="${esc(u.username)}"><h2>${esc(u.name)} (${esc(u.username)})</h2><form data-kind="user" data-username="${esc(u.username)}"><label>บทบาท<select data-testid="user-role-select" name="role">${options(['citizen', 'officer', 'head', 'executive', 'auditor', 'admin'], u.role, ROLE_TH)}</select></label><label>แผนก<select data-testid="user-dept-select" name="dept">${options(['', 'registry', 'works'], u.dept, { registry: 'ทะเบียน', works: 'โยธา' })}</select></label><button data-testid="user-save-btn">บันทึก</button></form></article>`).join(''))));
}
module.exports = mount;
Object.assign(mount, { mount, MESSAGES });
