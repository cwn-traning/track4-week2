'use strict';
// B09 · Dashboard ผู้บริหาร + ส่งออกรายงาน Excel/PDF (FR-22, FR-23 · BR-24, BR-25, BR-26 · CONTRACT 2.9, 6.4, 7)
//   mount:  สร้าง src/routes/NN-dashboard.js  ->  module.exports = require('../dashboard');   (module.exports เป็นฟังก์ชัน (app, ctx))
//   หน้า:   GET /dashboard                        (executive เท่านั้น · บทบาทอื่น 403 หน้า "ไม่มีสิทธิ์เข้าถึงหน้านี้" ผ่าน auth.pageGuard)
//   API:    GET /api/dashboard?period=2026-11&service=ALL
//           GET /api/dashboard/export?format=xlsx|pdf&period=…&service=…   (+ Audit EXPORT `<format> <period> <service>`)
//   ไม่มีไลบรารีภายนอก: xlsx (zip + OOXML) และ pdf เขียนเองในไฟล์นี้ (ไม่ต้องเพิ่ม dependency)
//   ไม่มีข้อมูลส่วนบุคคล: ไม่ query ชื่อผู้ยื่น/เลขบัตร/เบอร์เลย (BR-24) · งานในมือแสดงเฉพาะ username/ชื่อเจ้าหน้าที่
//   BUG_MODE ที่ใช้: B10 (ทันกำหนด % หารด้วยรับเรื่องแทนปิดงาน)
const zlib = require('zlib');
const { db } = require('./db');
const clock = require('./lib/clock');
const T = require('./lib/time');
const { isBug } = require('./lib/bugs');
const rules = require('./rules');
const auth = require('./auth');

const BACKLOG = ['SUBMITTED', 'IN_REVIEW', 'NEED_FIX', 'PENDING_APPROVAL', 'APPROVED']; // BR-25
const CLOSED_STATUS = ['COMPLETED', 'REJECTED']; // CANCELLED ไม่ใช่ปิดงาน
const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
const DASH = '–'; // en dash (CONTRACT: ปิดงาน 0 → `–`)

const MSG = {
  INVALID_PERIOD: 'ช่วงเวลาไม่ถูกต้อง (ใช้ YYYY-MM หรือ YYYY)',
  INVALID_SERVICE: 'บริการไม่ถูกต้อง',
  INVALID_FORMAT: 'รูปแบบไฟล์ไม่ถูกต้อง (xlsx หรือ pdf)',
};
const bad = (res, code) => res.status(400).json({ code, message: MSG[code] });

// ---------------------------------------------------------------- คำนวณตัวชี้วัด
const serviceIds = () => db.prepare('SELECT id FROM services ORDER BY id').all().map((r) => r.id);
const defaultPeriod = () => clock.now().slice(0, 7);

// % ทันกำหนด: ทัน ÷ ปิดงาน × 100 ทศนิยม 1 ตำแหน่ง ปัดครึ่งขึ้น (จำนวนเต็มล้วน ไม่มีปัญหาทศนิยมลอยตัว) · ปิดงาน 0 → null
function pct(num, den) {
  if (!den) return null;
  return Math.floor((num * 2000 + den) / (2 * den)) / 10;
}
const fmtPct = (v) => (v == null ? DASH : `${v.toFixed(1)}%`);

function compute(period, service) {
  const len = period.length; // 7 = เดือน · 4 = ทั้งปี (รวมตัวเลขทุกเดือนแล้วคิด % จากยอดรวม · BR-26)
  const svc = service === 'ALL' ? '' : ' AND service_id=?';
  const args = (...a) => (service === 'ALL' ? a : [...a, service]);

  const received = db.prepare(`SELECT COUNT(*) n FROM cases WHERE substr(paid_at,1,?)=?${svc}`).get(...args(len, period)).n;
  const closedRows = db.prepare(
    `SELECT closed_at, due_at FROM cases WHERE status IN ('COMPLETED','REJECTED') AND closed_at IS NOT NULL AND substr(closed_at,1,?)=?${svc}`,
  ).all(...args(len, period));
  const closed = closedRows.length;
  const onTime = closedRows.filter((r) => rules.isOnTime(r.closed_at, r.due_at)).length; // closed_at <= กำหนด (รวม 16:30:00)

  // คงค้าง/เกินกำหนด = ณ ตอนนี้ ไม่ขึ้นกับช่วง (A-41) แต่ขึ้นกับบริการ
  const open = db.prepare(`SELECT status, due_at FROM cases WHERE status IN (${BACKLOG.map(() => '?').join(',')})${svc}`).all(...args(...BACKLOG));
  const now = clock.now();
  const backlog = open.length;
  const overdue = open.filter((r) => rules.isOverdue(r.status, r.due_at, now)).length; // ไม่รวม NEED_FIX

  // BUG B10: หารด้วย "รับเรื่อง" แทน "ปิดงาน" (พ.ย. 6÷26 = 23.1% · ธ.ค. 0÷3 = 0.0%)
  const ontimePct = isBug('B10') ? pct(onTime, received) : pct(onTime, closed);

  // งานในมือรายเจ้าหน้าที่ = IN_REVIEW ที่ตัวเองถือ (BR-18) · ไม่ขึ้นกับตัวกรอง · แสดงเจ้าหน้าที่ทุกคนแม้ 0
  const counts = Object.fromEntries(
    db.prepare("SELECT owner, COUNT(*) n FROM cases WHERE status='IN_REVIEW' AND owner IS NOT NULL GROUP BY owner").all().map((r) => [r.owner, r.n]),
  );
  const staff = db.prepare("SELECT username, name FROM users WHERE role='officer' AND active=1 ORDER BY username").all();
  const workload = staff.map((u) => ({ username: u.username, count: counts[u.username] || 0 }));
  const names = Object.fromEntries(staff.map((u) => [u.username, u.name]));
  return { received, closed, onTime, ontimePct, backlog, overdue, workload, _names: names };
}

// ตรวจพารามิเตอร์ -> { period, service } หรือ { error }
function params(q) {
  const period = q.period === undefined || q.period === '' ? defaultPeriod() : String(q.period);
  const service = q.service === undefined || q.service === '' ? 'ALL' : String(q.service);
  if (!PERIOD_RE.test(period)) return { error: 'INVALID_PERIOD' };
  if (service !== 'ALL' && !serviceIds().includes(service)) return { error: 'INVALID_SERVICE' };
  return { period, service };
}
const publicJson = (r) => ({
  received: r.received, closed: r.closed, onTime: r.onTime, ontimePct: r.ontimePct,
  backlog: r.backlog, overdue: r.overdue, workload: r.workload,
});

// ค่าที่แสดงบนจอ (ข้อความ) · ใช้ร่วมกับไฟล์ส่งออกเพื่อให้ "เท่าจอทุกช่อง" (BR-26)
function displayRows(r) {
  return [
    ['รับเรื่อง', String(r.received)],
    ['ปิดงาน', String(r.closed)],
    ['ทันกำหนด %', fmtPct(r.ontimePct)],
    ['งานคงค้าง', String(r.backlog)],
    ['เกินกำหนดคงค้าง', String(r.overdue)],
  ];
}

// ---------------------------------------------------------------- xlsx (OOXML ใน zip เขียนเอง)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(0, 10); // time
    lh.writeUInt16LE(0x21, 12); // date 1980-01-01
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colName = (i) => String.fromCharCode(65 + i); // A, B (พอสำหรับ 2 คอลัมน์)

// sheets: [{ name, rows: string[][] }] · ทุกเซลล์เป็นข้อความ (shared strings) — ค่า B ตรงกับที่แสดงบนจอ
function buildXlsx(sheets) {
  const sst = [];
  const idx = new Map();
  const sid = (s) => {
    if (!idx.has(s)) { idx.set(s, sst.length); sst.push(s); }
    return idx.get(s);
  };
  const sheetXml = (rows) => {
    const body = rows.map((cells, ri) => `<row r="${ri + 1}">${cells.map((v, ci) => (
      v === '' || v == null ? '' : `<c r="${colName(ci)}${ri + 1}" t="s"><v>${sid(String(v))}</v></c>`)).join('')}</row>`).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/></cols>'
      + `<sheetData>${body}</sheetData></worksheet>`;
  };
  const sheetFiles = sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) }));
  const n = sheets.length;
  const files = [
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + sheets.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        + '</Types>',
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + `<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
        + '</Relationships>',
    },
    {
      name: 'xl/styles.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>',
    },
    ...sheetFiles,
  ];
  // sharedStrings ต้องสร้างหลัง sheet (sid() ถูกเรียกตอน sheetXml)
  files.push({
    name: 'xl/sharedStrings.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">`
      + sst.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('') + '</sst>',
  });
  return zip(files);
}

function xlsxFor(r, period, service) {
  return buildXlsx([
    { name: 'สรุป', rows: [['ตัวชี้วัด', 'ค่า'], ...displayRows(r)] },
    {
      name: 'รายละเอียด',
      rows: [
        ['ช่วงเวลา', period],
        ['บริการ', service],
        [],
        ['งานในมือรายเจ้าหน้าที่', 'จำนวน'],
        ...r.workload.map((w) => [w.username, String(w.count)]),
      ],
    },
  ]);
}

// ---------------------------------------------------------------- pdf (เขียนเอง · Helvetica · ข้อความ ASCII ล้วน)
const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '?');
const pdfStr = (s) => ascii(s).replace(/[\\()]/g, (c) => `\\${c}`);

function buildPdf(lines) {
  const content = `BT /F1 12 Tf 16 TL 50 790 Td ${lines.map((l) => `(${pdfStr(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function pdfFor(r, period, service) {
  const lines = [
    'e-Service Dashboard Report',
    `period ${period} service ${service}`,
    // บรรทัดเดียวที่เครื่องอ่านได้ (CONTRACT 7) · ปิดงาน 0 -> ontime=-
    `kpi received=${r.received} closed=${r.closed} ontime=${r.ontimePct == null ? '-' : `${r.ontimePct.toFixed(1)}%`} backlog=${r.backlog} overdue=${r.overdue}`,
    ...r.workload.map((w) => `workload ${w.username}=${w.count}`),
  ];
  return buildPdf(lines);
}

// ---------------------------------------------------------------- หน้า /dashboard
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function periodOptions() {
  const months = new Set([defaultPeriod()]);
  for (const col of ['paid_at', 'closed_at']) {
    for (const r of db.prepare(`SELECT DISTINCT substr(${col},1,7) m FROM cases WHERE ${col} IS NOT NULL`).all()) if (r.m) months.add(r.m);
  }
  const ms = [...months].sort().reverse();
  const years = [...new Set(ms.map((m) => m.slice(0, 4)))].sort().reverse();
  const label = (m) => `${T.THAI_MONTHS[+m.slice(5, 7) - 1]} ${+m.slice(0, 4) + 543}`;
  return [...ms.map((m) => ({ value: m, text: label(m) })), ...years.map((y) => ({ value: y, text: `ทั้งปี ${+y + 543}` }))];
}

const CSS = `*{box-sizing:border-box}body{font-family:system-ui,"Noto Sans Thai",sans-serif;margin:0;color:#1b1b1b;background:#fff}
header{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;padding:.6rem 1rem;background:#0b3d6e;color:#fff}header a{color:#fff}
main{max-width:1000px;margin:1rem auto;padding:0 1rem;overflow-wrap:anywhere}.tw{overflow-x:auto;max-width:100%}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #767676;padding:.4rem .6rem;text-align:left;vertical-align:top}
button,select{font:inherit;padding:.4rem .6rem;max-width:100%}.row{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;margin:.6rem 0}
.kpis{display:flex;flex-wrap:wrap;gap:.8rem;margin:.8rem 0}.kpi{border:1px solid #767676;border-radius:6px;padding:.6rem .9rem;min-width:9rem;flex:1 1 9rem}
.kpi .lbl{display:block;font-size:.9rem}.kpi .val{display:block;font-size:1.8rem;font-weight:700}.note{color:#444;font-size:.9rem}.err{color:#a30018}`;

const CLIENT_JS = `(function(){
var $=function(id){return document.querySelector('[data-testid="'+id+'"]')};
var per=$('period-select'),svc=$('service-select'),seq=0;
function msg(t){var m=document.getElementById('dash-msg');if(m)m.textContent=t}
function pct(v){return v==null?'\\u2013':v.toFixed(1)+'%'}
function paint(d){
  $('kpi-received').textContent=String(d.received);$('kpi-closed').textContent=String(d.closed);
  $('kpi-ontime-pct').textContent=pct(d.ontimePct);$('kpi-backlog').textContent=String(d.backlog);$('kpi-overdue').textContent=String(d.overdue);
  d.workload.forEach(function(w){
    var row=document.querySelector('[data-testid="workload-row"][data-username="'+w.username+'"]');
    if(row)row.querySelector('[data-testid="workload-value"]').textContent=String(w.count);
  });
}
function q(){return 'period='+encodeURIComponent(per.value)+'&service='+encodeURIComponent(svc.value)}
function load(){
  var n=++seq;
  fetch('/api/dashboard?'+q(),{credentials:'same-origin'}).then(function(r){return r.ok?r.json():Promise.reject(r.status)}).then(function(d){
    if(n===seq){paint(d);msg('');}
  }).catch(function(){msg('โหลดข้อมูลไม่สำเร็จ')});
}
per.addEventListener('change',load);svc.addEventListener('change',load);
function exp(fmt){
  var a=document.createElement('a');a.href='/api/dashboard/export?format='+fmt+'&'+q();a.download='';
  document.body.appendChild(a);a.click();a.remove();
}
$('export-xlsx-btn').addEventListener('click',function(){exp('xlsx')});
$('export-pdf-btn').addEventListener('click',function(){exp('pdf')});
})();`;

function dashboardPage(req, res) {
  const p = params(req.query);
  const period = p.error ? defaultPeriod() : p.period;
  const service = p.error ? 'ALL' : p.service;
  const r = compute(period, service);
  const u = req.user;
  const periods = periodOptions();
  if (!periods.some((o) => o.value === period)) periods.unshift({ value: period, text: period });
  const opts = periods.map((o) => `<option value="${esc(o.value)}"${o.value === period ? ' selected' : ''}>${esc(o.text)}</option>`).join('');
  const sopts = ['ALL', ...serviceIds()].map((s) => `<option value="${esc(s)}"${s === service ? ' selected' : ''}>${s === 'ALL' ? 'ทุกบริการ' : esc(s)}</option>`).join('');
  const kpi = (id, label, val) => `<div class="kpi"><span class="lbl">${label}</span><span class="val" data-testid="${id}">${esc(val)}</span></div>`;
  const rows = r.workload.map((w) => `<tr data-testid="workload-row" data-username="${esc(w.username)}"><td>${esc(w.username)} (${esc(r._names[w.username] || '')})</td><td data-testid="workload-value">${w.count}</td></tr>`).join('');
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard · e-Service กลาง</title><style>${CSS}</style></head><body>
<header data-testid="app-header"><strong>e-Service กลาง</strong><a href="/dashboard" data-testid="nav-dashboard">Dashboard</a><span style="flex:1"></span>
<span data-testid="user-name">${esc(u.name)}</span><span data-testid="user-role" data-role="${esc(u.role)}">${esc(auth.ROLE_TH[u.role])}</span>
<a href="/api/auth/logout-page" data-testid="logout-btn">ออกจากระบบ</a></header>
<main><h1>Dashboard ผู้บริหาร</h1>
<div class="row"><label for="period-select">ช่วงเวลา</label><select id="period-select" data-testid="period-select">${opts}</select>
<label for="service-select">บริการ</label><select id="service-select" data-testid="service-select">${sopts}</select>
<button type="button" data-testid="export-xlsx-btn">ส่งออก Excel</button><button type="button" data-testid="export-pdf-btn">ส่งออก PDF</button></div>
<div id="dash-msg" class="err" role="status" aria-live="polite"></div>
<div class="kpis">${kpi('kpi-received', 'รับเรื่อง', String(r.received))}${kpi('kpi-closed', 'ปิดงาน', String(r.closed))}${kpi('kpi-ontime-pct', 'ทันกำหนด %', fmtPct(r.ontimePct))}${kpi('kpi-backlog', 'งานคงค้าง', String(r.backlog))}${kpi('kpi-overdue', 'เกินกำหนดคงค้าง', String(r.overdue))}</div>
<p class="note">งานคงค้างและเกินกำหนดคงค้างคิด ณ ตอนนี้ ไม่ขึ้นกับช่วงเวลา · งานในมือรายเจ้าหน้าที่ไม่ขึ้นกับตัวกรอง</p>
<h2>งานในมือรายเจ้าหน้าที่</h2>
<div class="tw"><table><caption class="note">จำนวนคำขอที่เจ้าหน้าที่กำลังตรวจ (IN_REVIEW)</caption><thead><tr><th scope="col">เจ้าหน้าที่</th><th scope="col">งานในมือ</th></tr></thead><tbody>${rows}</tbody></table></div>
</main><script>${CLIENT_JS}</script></body></html>`;
  res.status(200).type('html').send(html);
}

// ---------------------------------------------------------------- mount
module.exports = function mount(app) {
  const execOnly = auth.requireRole('executive');

  app.get('/dashboard', (req, res) => auth.pageGuard(req, res, () => dashboardPage(req, res)));

  app.get('/api/dashboard', execOnly, (req, res) => {
    const p = params(req.query);
    if (p.error) return bad(res, p.error);
    res.status(200).json(publicJson(compute(p.period, p.service)));
  });

  app.get('/api/dashboard/export', execOnly, (req, res) => {
    const format = String(req.query.format || '').toLowerCase();
    if (format !== 'xlsx' && format !== 'pdf') return bad(res, 'INVALID_FORMAT');
    const p = params(req.query);
    if (p.error) return bad(res, p.error);
    const r = compute(p.period, p.service);
    const body = format === 'xlsx' ? xlsxFor(r, p.period, p.service) : pdfFor(r, p.period, p.service);
    db.prepare('INSERT INTO audit(time,username,role,event,case_no,from_status,to_status,detail) VALUES(?,?,?,?,?,?,?,?)')
      .run(clock.now(), req.user.username, req.user.role, 'EXPORT', '', '', '', `${format} ${p.period} ${p.service}`);
    res.set({
      'Content-Type': format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
      'Content-Disposition': `attachment; filename="dashboard-${p.period}-${p.service}.${format}"`,
      'Content-Length': String(body.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.status(200).end(body);
  });
};

Object.assign(module.exports, { mount: module.exports, compute, pct, fmtPct, buildXlsx, buildPdf, zip, crc32 });
