'use strict';
// หน้า /login (ThaiD จำลอง + SSO เจ้าหน้าที่) และ /register (ลงทะเบียนครั้งแรก)
// API อยู่ที่ src/auth.js · ไฟล์นี้เป็นแค่ SSR + JS ฝั่ง client ที่เรียก /api/auth/*
// mount: src/routes/01a-auth-pages.js (ต้องโหลดหลัง 01-auth.js ซึ่งจัดการ redirect เมื่อล็อกอินอยู่แล้ว)
const { MSG } = require('./auth');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `body{font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 16px}
label{display:block;margin:.75rem 0 .25rem}input[type=text],input[type=password],input[type=tel],input[type=email]{width:100%;padding:.5rem;box-sizing:border-box}
button{margin-top:1rem;padding:.5rem 1rem}.err{color:#b00020}[role=tablist] button[aria-selected=true]{font-weight:bold}`;

const shell = (title, body, script) => `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head>
<body><header><strong>เทศบาลนครตัวอย่าง · e-Service</strong></header><main>${body}</main><script>${script}</script></body></html>`;

// ส่ง JSON และคืน {status, body} — ใช้ซ้ำในทั้งสองหน้า
const CLIENT_POST = `async function post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});let b={};try{b=await r.json()}catch(e){}return{status:r.status,body:b}}
function showErr(el,msg){el.textContent=msg;el.hidden=false}`;

function loginPage() {
  const body = `<h1>เข้าสู่ระบบ</h1>
<div role="tablist"><button type="button" role="tab" data-testid="login-tab-citizen" aria-selected="true" data-tab="citizen">ประชาชน (ThaiD)</button>
<button type="button" role="tab" data-testid="login-tab-staff" aria-selected="false" data-tab="staff">เจ้าหน้าที่</button></div>
<section id="panel-citizen">
  <form id="thaid-form" novalidate><label for="idNo">เลขบัตรประชาชน 13 หลัก</label>
  <input type="text" id="idNo" inputmode="numeric" autocomplete="off" data-testid="thaid-id-input">
  <button type="submit" data-testid="thaid-submit">ยืนยันตัวตนด้วย ThaiD (จำลอง)</button></form>
  <div id="otp-slot"></div>
</section>
<section id="panel-staff" hidden>
  <form id="staff-form" novalidate><label for="su">ชื่อผู้ใช้</label><input type="text" id="su" autocomplete="username" data-testid="staff-username">
  <label for="sp">รหัสผ่าน</label><input type="password" id="sp" autocomplete="current-password" data-testid="staff-password">
  <button type="submit" data-testid="staff-submit">เข้าสู่ระบบเจ้าหน้าที่ (SSO ภาครัฐ จำลอง)</button></form>
  <div id="staff-err-slot"></div>
</section>`;
  const script = `${CLIENT_POST}
const M=${JSON.stringify({ INVALID_ID: MSG.INVALID_ID, OTP_INVALID: MSG.OTP_INVALID, LOCKED: MSG.LOCKED, INVALID_CREDENTIALS: MSG.INVALID_CREDENTIALS })};
const $=s=>document.querySelector(s);
document.querySelectorAll('[role=tab]').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('[role=tab]').forEach(x=>x.setAttribute('aria-selected',String(x===t)));
  $('#panel-citizen').hidden=t.dataset.tab!=='citizen';$('#panel-staff').hidden=t.dataset.tab!=='staff';}));
// แสดงข้อความผิดพลาด: element ถูกสร้าง/ลบทั้งก้อน เพื่อให้ "ไม่มี error" = ไม่มี element
function setMsg(slot,testid,msg){slot.innerHTML='';if(!msg)return;const p=document.createElement('p');p.className='err';p.setAttribute('role','alert');p.dataset.testid=testid;p.textContent=msg;slot.appendChild(p)}
// LOCKED -> lock-message + lock-until(data-iso) · OTP_INVALID -> otp-error + otp-attempts-left
function el(tag,testid,text){const e=document.createElement(tag);e.dataset.testid=testid;e.textContent=text;return e}
function renderOtpError(slot,b){slot.innerHTML='';const box=document.createElement('div');box.className='err';box.setAttribute('role','alert');
  if(b.code==='LOCKED'){box.appendChild(el('p','lock-message',M.LOCKED));
    const t=el('p','lock-until','ล็อกถึง '+new Date(b.lockedUntil).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}));t.dataset.iso=b.lockedUntil;box.appendChild(t);}
  else{box.appendChild(el('p','otp-error',M[b.code]||b.message||M.OTP_INVALID));
    if(b.attemptsLeft!=null)box.appendChild(el('p','otp-attempts-left','เหลือ '+b.attemptsLeft+' ครั้ง'));}
  slot.appendChild(box)}
let idNo='';
$('#thaid-form').addEventListener('submit',async e=>{e.preventDefault();
  idNo=$('#idNo').value.trim();const slot=$('#otp-slot');
  const r=await post('/api/auth/thaid/start',{idNo});
  if(r.body.code==='LOCKED'){renderOtpError(slot,r.body);return}
  if(r.status!==200){slot.innerHTML='';const p=document.createElement('p');p.className='err';p.setAttribute('role','alert');p.dataset.testid='thaid-error';p.textContent=M[r.body.code]||r.body.message||M.INVALID_ID;slot.appendChild(p);return}
  slot.innerHTML='<form id="otp-form" data-testid="otp-step" novalidate><label for="otp">รหัส OTP 6 หลัก</label><input type="text" id="otp" inputmode="numeric" autocomplete="one-time-code" data-testid="otp-input"><button type="submit" data-testid="otp-submit">ยืนยัน OTP</button><div id="otp-err"></div></form>';
  $('#otp-form').addEventListener('submit',async ev=>{ev.preventDefault();
    const v=await post('/api/auth/thaid/verify',{idNo,otp:$('#otp').value.trim()});
    if(v.status===200){location.href=v.body.registered?'/citizen':'/register';return}
    renderOtpError($('#otp-err'),v.body);});
});
$('#staff-form').addEventListener('submit',async e=>{e.preventDefault();
  const r=await post('/api/auth/staff/login',{username:$('#su').value.trim(),password:$('#sp').value});
  if(r.status===200){location.href=r.body.landing;return}
  setMsg($('#staff-err-slot'),'staff-error',M.INVALID_CREDENTIALS);});`;
  return shell('เข้าสู่ระบบ', body, script);
}

function registerPage(name) {
  const body = `<h1>ลงทะเบียนครั้งแรก</h1>
<form id="reg-form" novalidate>
<label for="rn">ชื่อ-นามสกุล (จาก ThaiD)</label><input type="text" id="rn" readonly data-testid="reg-name" value="${esc(name)}">
<label for="rm">เบอร์มือถือ</label><input type="tel" id="rm" inputmode="numeric" data-testid="reg-mobile">
<p class="err" role="alert" data-testid="reg-error-mobile" hidden></p>
<label for="re">อีเมล (ไม่บังคับ)</label><input type="email" id="re" data-testid="reg-email">
<label><input type="checkbox" id="rc" data-testid="reg-consent"> ยินยอมให้ประมวลผลข้อมูลส่วนบุคคลตาม PDPA</label>
<p class="err" role="alert" data-testid="reg-error-consent" hidden></p>
<p class="err" role="alert" data-testid="reg-error" hidden></p>
<button type="submit" data-testid="reg-submit">ลงทะเบียน</button></form>`;
  const script = `${CLIENT_POST}
const M=${JSON.stringify({ INVALID_MOBILE: MSG.INVALID_MOBILE, CONSENT_REQUIRED: MSG.CONSENT_REQUIRED })};
const $=s=>document.querySelector(s);
const em=$('[data-testid=reg-error-mobile]'),ec=$('[data-testid=reg-error-consent]'),eg=$('[data-testid=reg-error]');
$('#reg-form').addEventListener('submit',async e=>{e.preventDefault();
  [em,ec,eg].forEach(x=>{x.hidden=true;x.textContent=''});
  const mobile=$('#rm').value.trim(),consent=$('#rc').checked;let bad=false;
  if(!/^0\\d{9}$/.test(mobile)){showErr(em,M.INVALID_MOBILE);bad=true}
  if(!consent){showErr(ec,M.CONSENT_REQUIRED);bad=true}
  if(bad)return;
  const r=await post('/api/auth/register',{mobile,email:$('#re').value.trim(),consent:true});
  if(r.status===201){location.href=r.body.landing||'/citizen';return}
  if(r.body.code==='INVALID_MOBILE')return showErr(em,M.INVALID_MOBILE);
  if(r.body.code==='CONSENT_REQUIRED')return showErr(ec,M.CONSENT_REQUIRED);
  showErr(eg,r.body.message||'ลงทะเบียนไม่สำเร็จ');});`;
  return shell('ลงทะเบียน', body, script);
}

function mount(app) {
  // 01-auth.js redirect ผู้ที่ล็อกอินแล้วไปก่อน (ยกเว้น ?force=1) ที่เหลือมาถึงตรงนี้
  app.get('/login', (_req, res) => res.type('html').set('Cache-Control', 'no-store').send(loginPage()));
  // pageGuard ใน auth.js กรองแล้ว: มาถึงตรงนี้ได้เฉพาะประชาชนที่ยังไม่ลงทะเบียน
  app.get('/register', (req, res) => res.type('html').set('Cache-Control', 'no-store').send(registerPage(req.user.name)));
}

module.exports = mount;
