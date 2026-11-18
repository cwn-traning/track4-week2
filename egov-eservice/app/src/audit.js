'use strict';
// Mount with module.exports(app, ctx). Existing action modules own their audit writes.
const { db } = require('./db');
const clock = require('./lib/clock');
const time = require('./lib/time');
const auth = require('./auth');

const EVENTS = ['STAFF_LOGIN', 'CLAIM', 'RETURN', 'FORWARD', 'APPROVE', 'REJECT', 'ISSUE', 'UNMASK', 'EXPORT', 'ADMIN_CHANGE'];
const COLUMNS = ['time', 'username', 'role', 'event', 'caseNo', 'fromStatus', 'toStatus', 'detail'];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function filters(query = {}) {
  const text = key => typeof query[key] === 'string' ? query[key].trim() : '';
  const date = key => {
    const s = text(key);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && time.parseIso(s + 'T00:00:00+07:00') !== null ? s : '';
  };
  return { actor: text('actor'), event: text('event'), from: date('from'), to: date('to') };
}

function listAudit(query) {
  const f = filters(query);
  const where = [], params = [];
  if (f.actor) { where.push('username = ?'); params.push(f.actor); }
  if (f.event) { where.push('event = ?'); params.push(f.event); }
  // Persisted times are normalized +07:00; substr includes the whole Thai day,
  // including fractional seconds at the end of the requested date.
  if (f.from) { where.push('substr(time,1,10) >= ?'); params.push(f.from); }
  if (f.to) { where.push('substr(time,1,10) <= ?'); params.push(f.to); }
  const rows = db.prepare(`SELECT * FROM audit${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY time DESC, id DESC`).all(...params);
  return rows.map(r => ({ id: r.id, time: r.time, username: r.username, role: r.role, event: r.event,
    caseNo: r.case_no, fromStatus: r.from_status, toStatus: r.to_status, detail: r.detail }));
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(items) {
  return [COLUMNS.join(','), ...items.map(r => COLUMNS.map(k => csvCell(r[k])).join(','))].join('\r\n') + '\r\n';
}

function rowHtml(r) {
  const transition = r.fromStatus || r.toStatus ? `${r.fromStatus || '–'} → ${r.toStatus || '–'}` : '–';
  return `<tr data-testid="audit-row" data-id="${esc(r.id)}" data-event="${esc(r.event)}" data-actor="${esc(r.username)}" data-case-no="${esc(r.caseNo)}">
<td data-testid="audit-time" data-iso="${esc(r.time)}">${esc(time.fmtThai(r.time))}</td>
<td data-testid="audit-actor">${esc(r.username)}</td><td data-testid="audit-role">${esc(r.role)}</td>
<td data-testid="audit-event">${esc(r.event)}</td><td data-testid="audit-case-no">${esc(r.caseNo || '–')}</td>
<td data-testid="audit-transition">${esc(transition)}</td><td data-testid="audit-detail">${esc(r.detail)}</td></tr>`;
}

function auditPage(req, res) {
  const f = filters(req.query), items = listAudit(f);
  const query = new URLSearchParams(f).toString();
  res.set('Cache-Control', 'private, no-store').type('html').send(`<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit Trail · เทศบาลนครตัวอย่าง</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#172b40;background:#f5f7fa;margin:0}header,main{padding:1.25rem;max-width:1400px;margin:auto}header{display:flex;gap:1rem;flex-wrap:wrap}a{color:#164f91}form{display:flex;gap:1rem;flex-wrap:wrap;align-items:end}label{display:block}input,select,button{font:inherit;padding:.5rem;max-width:100%;box-sizing:border-box}button{cursor:pointer;background:#174e7a;color:white;border:1px solid #174e7a;border-radius:4px}a:focus-visible,input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid #8b4100;outline-offset:3px}.table-wrap{overflow:auto;background:white}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #c4ced8;padding:.65rem;vertical-align:top;overflow-wrap:anywhere}caption{text-align:left;font-weight:bold;padding:.6rem}#export-error{color:#a31515}</style></head><body>
<header data-testid="app-header"><span data-testid="user-name">${esc(req.user.name)}</span>
<span data-testid="user-role" data-role="auditor">ผู้ตรวจสอบภายใน</span>
<nav aria-label="เมนูหลัก"><a href="/audit" data-testid="nav-audit" aria-current="page">Audit Trail</a></nav>
<a href="/api/auth/logout-page" data-testid="logout-btn">ออกจากระบบ</a></header>
<main><h1>Audit Trail</h1><p>ประวัติการทำรายการ (อ่านอย่างเดียว)</p>
<form action="/audit" method="get">
<div><label for="actor">ผู้ทำรายการ (username)</label><input id="actor" name="actor" data-testid="audit-filter-actor" value="${esc(f.actor)}"></div>
<div><label for="event">เหตุการณ์</label><select id="event" name="event" data-testid="audit-filter-event"><option value="">ทั้งหมด</option>${EVENTS.map(e => `<option value="${e}"${f.event === e ? ' selected' : ''}>${e}</option>`).join('')}</select></div>
<div><label for="from">ตั้งแต่วันที่</label><input id="from" name="from" type="date" data-testid="audit-filter-from" value="${esc(f.from)}"></div>
<div><label for="to">ถึงวันที่</label><input id="to" name="to" type="date" data-testid="audit-filter-to" value="${esc(f.to)}"></div>
<button type="submit" data-testid="audit-apply-btn">ค้นหา</button></form>
<p>จำนวนรายการ: <strong data-testid="audit-count">${items.length}</strong></p>
<a id="export" href="/api/audit/export.csv?${esc(query)}" data-testid="audit-export-csv-btn" download="audit.csv">ส่งออก CSV</a>
<p id="export-error" role="alert"></p>
<div class="table-wrap"><table><caption>ประวัติเรียงจากใหม่ไปเก่า</caption><thead><tr>${['เวลา', 'ผู้ทำรายการ', 'บทบาท', 'เหตุการณ์', 'เลขคำขอ', 'สถานะก่อน → หลัง', 'รายละเอียด'].map(s => `<th scope="col">${s}</th>`).join('')}</tr></thead><tbody id="audit-rows">${items.map(rowHtml).join('')}</tbody></table></div></main>
<script>document.getElementById('export').addEventListener('click',async function(e){
e.preventDefault();if(this.dataset.busy)return;this.dataset.busy='1';
try{var r=await fetch(this.href,{credentials:'same-origin'});if(!r.ok)throw new Error('ส่งออกไม่สำเร็จ');
var url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='audit.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},30000);
var page=await fetch(location.href,{credentials:'same-origin'});if(!page.ok)throw new Error('โหลดประวัติไม่สำเร็จ');
var d=new DOMParser().parseFromString(await page.text(),'text/html');document.getElementById('audit-rows').innerHTML=d.getElementById('audit-rows').innerHTML;
document.querySelector('[data-testid="audit-count"]').textContent=d.querySelector('[data-testid="audit-count"]').textContent;
}catch(err){document.getElementById('export-error').textContent=err.message}finally{delete this.dataset.busy}});</script></body></html>`);
}

function mount(app) {
  // Append-only even for administrators and nonexistent IDs. No role middleware
  // here: these methods always return 405, as required by CONTRACT 6.4.
  for (const method of ['put', 'patch', 'delete']) {
    app[method](['/api/audit', '/api/audit/:id'], (_req, res) => res.status(405)
      .set('Allow', 'GET, HEAD').json({ code: 'METHOD_NOT_ALLOWED', message: 'ไม่อนุญาตให้แก้ไขหรือลบ Audit Trail' }));
  }
  app.get('/audit', auth.pageGuard, auditPage);
  app.get('/api/audit', auth.requireRole('auditor'), (req, res) => {
    const items = listAudit(req.query);
    res.set('Cache-Control', 'private, no-store').json({ count: items.length, items });
  });
  const exportCsv = db.transaction((query, user) => {
    // Snapshot before EXPORT so the download exactly matches the screen.
    const csv = toCsv(listAudit(query));
    db.prepare('INSERT INTO audit(time,username,role,event,case_no,from_status,to_status,detail) VALUES(?,?,?,?,?,?,?,?)')
      .run(clock.now(), user.username, user.role, 'EXPORT', '', '', '', 'audit-csv');
    return csv;
  });
  app.get('/api/audit/export.csv', auth.requireRole('auditor'), (req, res) => {
    const csv = exportCsv(req.query, req.user);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit.csv"',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(csv);
  });
}

module.exports = mount;
Object.assign(module.exports, { mount, listAudit, filters, toCsv, EVENTS });
