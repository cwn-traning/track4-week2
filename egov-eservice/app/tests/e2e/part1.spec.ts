// Playwright part 1: AUTH FEE SUBMIT UPLOAD PAY QUEUE (17 TC) — derived only from TEST-PLAN / CONTRACT / TEST-DATA.
// Requires a single worker (every TC starts with POST /api/test/reset which wipes shared server state).
import {
  test,
  expect,
  request as pwRequest,
  APIRequestContext,
  APIResponse,
  Browser,
  Page,
} from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const NOW0 = '2026-12-01T09:00:00+07:00';

test.use({ baseURL: BASE });
test.describe.configure({ timeout: 180_000 });

// ───────────────────────── constants ─────────────────────────
const SOMCHAI = '1101700123456';
const SOMYING = '3100600987659';
const MANA = '5500400111221';
const PITI = '1909900555015';
const NAMES: Record<string, string> = {
  'off.reg1': 'เจ้าหน้าที่ทะเบียน 1',
  'off.reg2': 'เจ้าหน้าที่ทะเบียน 2',
  'off.works1': 'เจ้าหน้าที่โยธา 1',
  head1: 'หัวหน้าฝ่าย',
  exec1: 'ผู้บริหาร',
  audit1: 'ผู้ตรวจสอบภายใน',
  admin1: 'ผู้ดูแลระบบ',
};
const cn = (n: number) => `EG-2569-${String(n).padStart(6, '0')}`;
const short = (c: string | null) => (c ?? '').slice(-6);

// ───────────────────────── test files (TEST-DATA ข้อ 11, in memory) ─────────────────────────
function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pdf(n: number): Buffer {
  const head = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n');
  const tail = Buffer.from('\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const pad = n - head.length - tail.length;
  return Buffer.concat([head, Buffer.alloc(pad, 0x20), tail]);
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(n: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = Buffer.from([0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00]);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const base = Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat)]);
  const iend = pngChunk('IEND', Buffer.alloc(0));
  const pad = n - base.length - iend.length - 12;
  const text = pngChunk('tEXt', Buffer.concat([Buffer.from('k\0'), Buffer.alloc(pad - 2, 0x78)]));
  return Buffer.concat([base, text, iend]);
}
function jpg(n: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const pad = n - soi.length - app0.length - 2 - 4;
  const com = Buffer.alloc(4);
  com[0] = 0xff;
  com[1] = 0xfe;
  com.writeUInt16BE(pad + 2, 2);
  return Buffer.concat([soi, app0, com, Buffer.alloc(pad, 0x78), Buffer.from([0xff, 0xd9])]);
}
type F = { name: string; mimeType: string; buffer: Buffer };
const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', txt: 'text/plain' };
function file(name: string): F {
  const ext = name.split('.').pop()!;
  let buffer: Buffer;
  const m = /^size-(\d+)\.pdf$/.exec(name);
  if (m) buffer = pdf(Number(m[1]));
  else if (name === 'fake-text.pdf' || name === 'fake-text.jpg' || name === 'notes.txt') buffer = Buffer.from('hello');
  else if (name === 'exe-as.png') buffer = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1022)]);
  else if (name === 'real.jpg' || name === 'plan-as-jpg.jpg') buffer = jpg(1024);
  else if (name === 'real.png') buffer = png(1024);
  else buffer = pdf(1024);
  return { name, mimeType: MIME[ext], buffer };
}

// ───────────────────────── API helpers ─────────────────────────
let opened: APIRequestContext[] = [];
async function newApi(): Promise<APIRequestContext> {
  const c = await pwRequest.newContext({ baseURL: BASE });
  opened.push(c);
  return c;
}
async function reset() {
  const c = await newApi();
  const r = await c.post('/api/test/reset');
  expect(r.status()).toBe(200);
  expect((await r.json()).now).toBe(NOW0);
}
async function setClock(now: string) {
  const c = await newApi();
  const r = await c.put('/api/test/clock', { data: { now } });
  expect(r.status()).toBe(200);
}
async function otpStart(ctx: APIRequestContext, idNo: string) {
  return ctx.post('/api/auth/thaid/start', { data: { idNo } });
}
async function otpVerify(ctx: APIRequestContext, idNo: string, otp: string) {
  return ctx.post('/api/auth/thaid/verify', { data: { idNo, otp } });
}
async function apiCitizen(idNo: string): Promise<APIRequestContext> {
  const c = await newApi();
  expect((await otpStart(c, idNo)).status()).toBe(200);
  expect((await otpVerify(c, idNo, '123456')).status()).toBe(200);
  return c;
}
async function apiStaff(username: string): Promise<APIRequestContext> {
  const c = await newApi();
  const r = await c.post('/api/auth/staff/login', { data: { username, password: 'Test@1234' } });
  expect(r.status()).toBe(200);
  return c;
}
const REQUIRED: Record<string, [string, string][]> = {
  'SV-01': [['id-card', 'id-card.pdf']],
  'SV-02': [['id-card', 'id-card.pdf'], ['map', 'map.pdf']],
  'SV-03': [['id-card', 'id-card.pdf'], ['plan', 'plan.pdf'], ['deed', 'deed.pdf']],
};
async function apiDraft(ctx: APIRequestContext, body: Record<string, unknown>) {
  const r = await ctx.post('/api/drafts', { data: body });
  expect(r.status()).toBe(201);
  return (await r.json()) as { draftId: string; fee: number };
}
async function apiUpload(ctx: APIRequestContext, draftId: string, name: string, docKey: string, f: F = file(name)) {
  return ctx.post(`/api/drafts/${draftId}/files`, {
    multipart: { file: { name: f.name, mimeType: f.mimeType, buffer: f.buffer }, docKey },
  });
}
async function apiAttachRequired(ctx: APIRequestContext, draftId: string, svc: string) {
  for (const [k, n] of REQUIRED[svc]) expect((await apiUpload(ctx, draftId, n, k)).status()).toBe(201);
}
async function apiQr(ctx: APIRequestContext, draftId: string) {
  const r = await ctx.post(`/api/drafts/${draftId}/payment`);
  expect(r.status()).toBe(201);
  return (await r.json()) as { ref: string; amount: number; qrCreatedAt: string; qrExpiresAt: string };
}
function apiPay(ctx: APIRequestContext, ref: string, amount: number): Promise<APIResponse> {
  return ctx.post(`/api/test/payments/${ref}/pay`, { data: { amount } });
}
// draft + docs + QR (not yet paid)
async function apiPrepare(ctx: APIRequestContext, svc: 'SV-01' | 'SV-02' | 'SV-03', val?: number) {
  const body: Record<string, unknown> = { serviceId: svc };
  if (svc === 'SV-01') body.qty = val ?? 1;
  if (svc === 'SV-03') body.areaSqm = val ?? 100;
  const d = await apiDraft(ctx, body);
  await apiAttachRequired(ctx, d.draftId, svc);
  const q = await apiQr(ctx, d.draftId);
  return { draftId: d.draftId, fee: d.fee, ref: q.ref, qr: q };
}
async function apiNewPaid(ctx: APIRequestContext, svc: 'SV-01' | 'SV-02' | 'SV-03', val?: number) {
  const p = await apiPrepare(ctx, svc, val);
  const r = await apiPay(ctx, p.ref, p.fee);
  expect(r.status()).toBe(200);
  return { ...p, pay: await r.json() };
}
async function apiCases(ctx: APIRequestContext): Promise<any[]> {
  const r = await ctx.get('/api/cases');
  expect(r.status()).toBe(200);
  return (await r.json()).items;
}

// ───────────────────────── UI helpers ─────────────────────────
async function newPage(browser: Browser): Promise<Page> {
  const c = await browser.newContext({ baseURL: BASE, ...(process.env.REPORT === '1' ? { recordVideo: { dir: test.info().outputDir, size: { width: 800, height: 600 } } } : {}) });
  return c.newPage();
}
async function uiCitizen(page: Page, idNo: string, landing = /\/citizen/) {
  await page.goto('/login');
  await page.getByTestId('login-tab-citizen').click();
  await page.getByTestId('thaid-id-input').fill(idNo);
  await page.getByTestId('thaid-submit').click();
  await expect(page.getByTestId('otp-step')).toBeVisible();
  await page.getByTestId('otp-input').fill('123456');
  await page.getByTestId('otp-submit').click();
  await expect(page).toHaveURL(landing);
}
async function uiStaff(page: Page, username: string, landing?: RegExp) {
  await page.goto('/login');
  await page.getByTestId('login-tab-staff').click();
  await page.getByTestId('staff-username').fill(username);
  await page.getByTestId('staff-password').fill('Test@1234');
  await page.getByTestId('staff-submit').click();
  await expect(page).not.toHaveURL(/\/login/);
  if (landing) await expect(page).toHaveURL(landing);
}
async function uiWizard(page: Page, svc: 'SV-01' | 'SV-02' | 'SV-03', val?: number) {
  await page.goto('/citizen');
  await page.getByTestId(`start-service-${svc}`).click();
  await expect(page.getByTestId('wizard-step')).toHaveText('1/3 กรอกข้อมูล');
  if (svc === 'SV-01' && val !== undefined) await page.getByTestId('qty-input').fill(String(val));
  if (svc === 'SV-03') await page.getByTestId('area-input').fill(String(val ?? 100));
  await page.getByTestId('to-upload-btn').click();
  await expect(page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');
}
async function uiUpload(page: Page, inputId: string, name: string | string[]) {
  const names = Array.isArray(name) ? name : [name];
  await page.getByTestId(inputId).setInputFiles(names.map(file));
}
const queueRow = (page: Page, n: number) =>
  page.locator(`[data-testid="queue-row"][data-case-no="${cn(n)}"]`);
async function queueCaseNos(page: Page): Promise<string[]> {
  return page.getByTestId('queue-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-case-no') as string));
}
async function auditEvents(event: string, caseNo?: string) {
  const a = await apiStaff('audit1');
  const r = await a.get(`/api/audit?event=${event}`);
  expect(r.status()).toBe(200);
  const items: any[] = (await r.json()).items;
  return caseNo ? items.filter((i) => i.caseNo === caseNo) : items;
}

test.beforeEach(async () => {
  await reset();
});
test.afterEach(async () => {
  const list = opened;
  opened = [];
  await Promise.all(list.map((c) => c.dispose().catch(() => undefined)));
});

// ═════════════════════════ AUTH ═════════════════════════

test('TC-AUTH-01 เลขบัตร 13 หลัก + checksum', async ({ page }) => {
  const api = await newApi();
  const invalid = ['110170012345', '11017001234567', '1101700123457', '11017001234ab'];
  const valid = ['1101700123456', '3100600987659', '1909900555015', '5500400111221'];

  for (const v of invalid) {
    await page.goto('/login');
    await page.getByTestId('login-tab-citizen').click();
    await page.getByTestId('thaid-id-input').fill(v);
    await page.getByTestId('thaid-submit').click();
    await expect(page.getByTestId('thaid-error')).toHaveText('เลขบัตรประชาชนไม่ถูกต้อง');
    await expect(page.getByTestId('otp-step')).toHaveCount(0);
    const r = await otpStart(api, v);
    expect(r.status(), v).toBe(400);
    expect((await r.json()).code).toBe('INVALID_ID');
  }
  for (const v of valid) {
    await page.goto('/login');
    await page.getByTestId('login-tab-citizen').click();
    await page.getByTestId('thaid-id-input').fill(v);
    await page.getByTestId('thaid-submit').click();
    await expect(page.getByTestId('otp-step')).toBeVisible();
    await expect(page.getByTestId('thaid-error')).toHaveCount(0);
    const r = await otpStart(api, v);
    expect(r.status(), v).toBe(200);
    expect(await r.json()).toEqual({ status: 'OTP_SENT' });
  }
});

test('TC-AUTH-02 OTP ผิด 3 ครั้งล็อก 15 นาที', async ({ page }) => {
  const api = await newApi();
  const uiOtp = async (otp: string) => {
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/thaid/verify') && r.request().method() === 'POST'),
      (async () => {
        await page.getByTestId('otp-input').fill(otp);
        await page.getByTestId('otp-submit').click();
      })(),
    ]);
    return resp;
  };
  const uiStartPiti = async () => {
    await page.goto('/login');
    await page.getByTestId('login-tab-citizen').click();
    await page.getByTestId('thaid-id-input').fill(PITI);
    await page.getByTestId('thaid-submit').click();
    await expect(page.getByTestId('otp-step')).toBeVisible();
  };

  // 1-3
  await uiStartPiti();
  let r = await uiOtp('000000');
  expect(r.status()).toBe(401);
  let body = await r.json();
  expect(body.code).toBe('OTP_INVALID');
  expect(body.attemptsLeft).toBe(2);
  await expect(page.getByTestId('otp-error')).toHaveText('รหัส OTP ไม่ถูกต้อง');
  await expect(page.getByTestId('otp-attempts-left')).toHaveText('เหลือ 2 ครั้ง');

  r = await uiOtp('000000');
  expect(r.status()).toBe(401);
  expect((await r.json()).attemptsLeft).toBe(1);
  await expect(page.getByTestId('otp-attempts-left')).toHaveText('เหลือ 1 ครั้ง');

  r = await uiOtp('000000');
  expect(r.status()).toBe(423);
  expect((await r.json()).code).toBe('LOCKED');
  await expect(page.getByTestId('lock-message')).toHaveText('ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที');
  await expect(page.getByTestId('lock-until')).toHaveAttribute('data-iso', '2026-12-01T09:15:00+07:00');

  // 4 OTP ถูกทันที ยัง 423
  await otpStart(api, PITI); // 423 ได้
  let v = await otpVerify(api, PITI, '123456');
  expect(v.status()).toBe(423);

  // 5 สมชายล็อกอินปกติ
  const somchai = await apiCitizen(SOMCHAI);
  expect((await somchai.get('/api/me')).status()).toBe(200);

  // 6 09:14:59
  await setClock('2026-12-01T09:14:59+07:00');
  await otpStart(api, PITI);
  v = await otpVerify(api, PITI, '123456');
  expect(v.status()).toBe(423);

  // 7 09:15:00 ปลดล็อก
  await setClock('2026-12-01T09:15:00+07:00');
  await uiStartPiti();
  r = await uiOtp('000000');
  expect(r.status()).toBe(401);
  body = await r.json();
  expect(body.code).toBe('OTP_INVALID');
  expect(body.attemptsLeft).toBe(2);
  await expect(page.getByTestId('otp-attempts-left')).toHaveText('เหลือ 2 ครั้ง');

  // 8 OTP ถูก
  v = await otpVerify(api, PITI, '123456');
  expect(v.status()).toBe(200);

  // 9 RESET: ผิด 2 → ถูก → logout → ผิด 2 ไม่ล็อก
  await reset();
  const p = await newApi();
  expect((await otpStart(p, PITI)).status()).toBe(200);
  expect((await otpVerify(p, PITI, '000000')).status()).toBe(401);
  v = await otpVerify(p, PITI, '000000');
  expect(v.status()).toBe(401);
  expect((await v.json()).attemptsLeft).toBe(1);
  expect((await otpVerify(p, PITI, '123456')).status()).toBe(200);
  expect((await p.post('/api/auth/logout')).status()).toBe(204);
  expect((await otpStart(p, PITI)).status()).toBe(200);
  v = await otpVerify(p, PITI, '000000');
  expect(v.status()).toBe(401);
  expect((await v.json()).attemptsLeft).toBe(2);
  v = await otpVerify(p, PITI, '000000');
  expect(v.status()).toBe(401);
  expect((await v.json()).attemptsLeft).toBe(1);
});

test('TC-AUTH-03 ลงทะเบียนครั้งแรก', async ({ page }) => {
  await uiCitizen(page, MANA, /\/register/);
  await page.goto('/register');
  const name = page.getByTestId('reg-name');
  await expect(name).toHaveValue('มานะ ตั้งใจ');
  await expect(name).toHaveJSProperty('readOnly', true);
  await name.focus();
  await page.keyboard.type('zzz');
  await expect(name).toHaveValue('มานะ ตั้งใจ');

  const mobileErr = 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0';
  await page.getByTestId('reg-consent').check();
  for (const m of ['081234567', '08123456789', '1812345678', '08123abcde']) {
    await page.getByTestId('reg-mobile').fill(m);
    await page.getByTestId('reg-submit').click();
    await expect(page.getByTestId('reg-error-mobile'), m).toHaveText(mobileErr);
    await expect(page).toHaveURL(/\/register/);
  }

  await page.getByTestId('reg-mobile').fill('0845678901');
  await page.getByTestId('reg-consent').setChecked(false);
  await page.getByTestId('reg-submit').click();
  await expect(page.getByTestId('reg-error-consent')).toHaveText('กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)');
  await expect(page).toHaveURL(/\/register/);

  await page.getByTestId('reg-consent').check();
  await page.getByTestId('reg-email').fill('');
  await page.getByTestId('reg-submit').click();
  await expect(page).toHaveURL(/\/citizen/);
  await expect(page.getByTestId('citizen-welcome')).toHaveText('สวัสดี มานะ ตั้งใจ');

  // 7 ออกจากระบบ → login ใหม่เข้า /citizen ตรง
  await page.getByTestId('logout-btn').click();
  await expect(page).toHaveURL(/\/login/);
  await uiCitizen(page, MANA, /\/citizen/);
  await expect(page).not.toHaveURL(/\/register/);

  // 8 RESET + API
  await reset();
  const api = await newApi();
  expect((await otpStart(api, MANA)).status()).toBe(200);
  const v = await otpVerify(api, MANA, '123456');
  expect(v.status()).toBe(200);
  expect((await v.json()).registered).toBe(false);
  let r = await api.post('/api/auth/register', { data: { mobile: '081234567', email: '', consent: true } });
  expect(r.status()).toBe(400);
  expect((await r.json()).code).toBe('INVALID_MOBILE');
  r = await api.post('/api/auth/register', { data: { mobile: '0845678901', email: '', consent: false } });
  expect(r.status()).toBe(400);
  expect((await r.json()).code).toBe('CONSENT_REQUIRED');
});

test('TC-AUTH-04 เจ้าหน้าที่ SSO จำลองและหน้าตั้งต้นตามบทบาท', async ({ page }) => {
  const rows: [string, RegExp, string, string, string, string | null][] = [
    ['off.reg1', /\/officer\/queue/, 'เจ้าหน้าที่ทะเบียน 1', 'เจ้าหน้าที่', 'officer', 'registry'],
    ['off.reg2', /\/officer\/queue/, 'เจ้าหน้าที่ทะเบียน 2', 'เจ้าหน้าที่', 'officer', 'registry'],
    ['off.works1', /\/officer\/queue/, 'เจ้าหน้าที่โยธา 1', 'เจ้าหน้าที่', 'officer', 'works'],
    ['head1', /\/head\/approvals/, 'หัวหน้าฝ่าย', 'หัวหน้าฝ่าย', 'head', null],
    ['exec1', /\/dashboard/, 'ผู้บริหาร', 'ผู้บริหาร', 'executive', null],
    ['audit1', /\/audit/, 'ผู้ตรวจสอบภายใน', 'ผู้ตรวจสอบภายใน', 'auditor', null],
    ['admin1', /\/admin\/services/, 'ผู้ดูแลระบบ', 'ผู้ดูแลระบบ', 'admin', null],
  ];
  await page.goto('/login');
  await page.getByTestId('login-tab-staff').click();
  await expect(page.getByTestId('staff-submit')).toHaveText('เข้าสู่ระบบเจ้าหน้าที่ (SSO ภาครัฐ จำลอง)');

  for (const [u, url, uname, roleText, role, dept] of rows) {
    await uiStaff(page, u, url);
    await expect(page.getByTestId('user-name'), u).toHaveText(uname);
    const ur = page.getByTestId('user-role');
    await expect(ur, u).toHaveText(roleText);
    await expect(ur).toHaveAttribute('data-role', role);
    if (dept) await expect(ur).toHaveAttribute('data-dept', dept);
    await page.getByTestId('logout-btn').click();
    await expect(page).toHaveURL(/\/login/);
  }

  const api = await newApi();
  for (const [u, p] of [['off.reg1', 'wrong'], ['nobody', 'Test@1234'], [SOMCHAI, 'Test@1234']]) {
    await page.goto('/login');
    await page.getByTestId('login-tab-staff').click();
    await page.getByTestId('staff-username').fill(u);
    await page.getByTestId('staff-password').fill(p);
    await page.getByTestId('staff-submit').click();
    await expect(page.getByTestId('staff-error'), u).toHaveText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    const r = await api.post('/api/auth/staff/login', { data: { username: u, password: p } });
    expect(r.status()).toBe(401);
    expect((await r.json()).code).toBe('INVALID_CREDENTIALS');
  }

  await page.goto('/officer/queue');
  await expect(page).toHaveURL(/\/login/);
});

// ═════════════════════════ FEE ═════════════════════════

test('TC-FEE-01 ค่าธรรมเนียม SV-01/SV-02/SV-03', async ({ page }) => {
  const api = await apiCitizen(SOMCHAI);
  await uiCitizen(page, SOMCHAI);

  // SV-03
  await page.goto('/citizen/new/SV-03');
  const area = page.getByTestId('area-input');
  const fee = page.getByTestId('fee-total');
  const feeErr = page.getByTestId('fee-error');
  const toUp = page.getByTestId('to-upload-btn');
  const sv3: [number, number | null, string?][] = [
    [0, null, 'กรุณาระบุพื้นที่ 1–500 ตร.ม.'],
    [-1, null, 'กรุณาระบุพื้นที่ 1–500 ตร.ม.'],
    [1, 1000],
    [100, 1000],
    [101, 1010],
    [102, 1020],
    [250, 2500],
    [300, 3000],
    [499, 4990],
    [500, 5000],
    [501, null, 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน'],
  ];
  for (const [a, f, err] of sv3) {
    await area.fill(String(a));
    if (f === null) {
      await expect(fee, `area ${a}`).toHaveText('–');
      await expect(feeErr, `area ${a}`).toHaveText(err!);
      await expect(toUp).toBeDisabled();
    } else {
      await expect(fee, `area ${a}`).toHaveText(`฿${f.toLocaleString('en-US')}`);
      await expect(feeErr).toHaveCount(0);
      await expect(toUp).toBeEnabled();
    }
    const r = await api.post('/api/drafts', { data: { serviceId: 'SV-03', areaSqm: a } });
    if (f === null) {
      expect(r.status(), `api area ${a}`).toBe(400);
      expect((await r.json()).code).toBe(a === 501 ? 'AREA_TOO_LARGE' : 'INVALID_AREA');
    } else {
      expect(r.status(), `api area ${a}`).toBe(201);
      expect((await r.json()).fee).toBe(f);
    }
  }

  // SV-01
  await page.goto('/citizen/new/SV-01');
  const qty = page.getByTestId('qty-input');
  for (const q of [0, 1, 2, 3, 4, 5, 6]) {
    await qty.fill(String(q));
    if (q < 1 || q > 5) {
      await expect(page.getByTestId('fee-error'), `qty ${q}`).toHaveText('จำนวนฉบับต้อง 1–5 ฉบับ');
      await expect(page.getByTestId('fee-total')).toHaveText('–');
      await expect(page.getByTestId('to-upload-btn')).toBeDisabled();
    } else {
      await expect(page.getByTestId('fee-total'), `qty ${q}`).toHaveText(`฿${20 * q}`);
      await expect(page.getByTestId('fee-error')).toHaveCount(0);
    }
    const r = await api.post('/api/drafts', { data: { serviceId: 'SV-01', qty: q } });
    if (q < 1 || q > 5) {
      expect(r.status(), `api qty ${q}`).toBe(400);
      expect((await r.json()).code).toBe('INVALID_QTY');
    } else {
      expect(r.status()).toBe(201);
      expect((await r.json()).fee).toBe(20 * q);
    }
  }

  // SV-02
  await page.goto('/citizen/new/SV-02');
  await expect(page.getByTestId('fee-total')).toHaveText('฿500');
  const r2 = await api.post('/api/drafts', { data: { serviceId: 'SV-02' } });
  expect(r2.status()).toBe(201);
  expect((await r2.json()).fee).toBe(500);
});

// ═════════════════════════ SUBMIT ═════════════════════════

test('TC-SUBMIT-01 ยื่นคำขอ SV-01 ครบวงจร', async ({ page, browser }) => {
  const api = await apiCitizen(SOMCHAI);
  await uiCitizen(page, SOMCHAI);
  await page.goto('/citizen');
  await page.getByTestId('start-service-SV-01').click();
  await expect(page.getByTestId('wizard-step')).toHaveText('1/3 กรอกข้อมูล');
  await page.getByTestId('qty-input').fill('2');
  await expect(page.getByTestId('fee-total')).toHaveText('฿40');
  await page.getByTestId('to-upload-btn').click();

  await expect(page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');
  await expect(page.getByTestId('to-payment-btn')).toBeDisabled();
  await uiUpload(page, 'upload-input-id-card', 'id-card.pdf');
  await expect(page.getByTestId('file-item')).toHaveCount(1);
  await expect(page.getByTestId('file-item')).toHaveAttribute('data-doc-key', 'id-card');
  await expect(page.getByTestId('to-payment-btn')).toBeEnabled();
  await page.getByTestId('to-payment-btn').click();

  await expect(page.getByTestId('wizard-step')).toHaveText('3/3 ชำระเงิน');
  await expect(page.getByTestId('payment-amount')).toHaveText('฿40');
  await page.getByTestId('create-qr-btn').click();
  await expect(page.getByTestId('qr-ref')).toHaveText('PP-0002');
  await expect(page.getByTestId('qr-expires')).toHaveAttribute('data-iso', '2026-12-01T09:15:00+07:00');
  await expect(page.getByTestId('payment-status')).toHaveText('รอชำระ');

  const pay = await apiPay(api, 'PP-0002', 40);
  expect(pay.status()).toBe(200);
  expect(await pay.json()).toEqual({ status: 'PAID', caseNo: 'EG-2569-000031', receiptNo: 'RC-2569-000031', duplicate: false });
  await page.getByTestId('refresh-payment-btn').click();

  await expect(page.getByTestId('payment-status')).toHaveText('ชำระแล้ว');
  await expect(page.getByTestId('submitted-case-no')).toHaveText('EG-2569-000031');
  await expect(page.getByTestId('receipt-no')).toHaveText('RC-2569-000031');
  await expect(page.getByTestId('receipt-amount')).toHaveText('฿40');
  await expect(page.getByTestId('receipt-paid-at')).toHaveAttribute('data-iso', '2026-12-01T09:00:00+07:00');

  await page.getByTestId('go-case-btn').click();
  await expect(page).toHaveURL(/\/citizen\/cases\/EG-2569-000031/);
  await expect(page.getByTestId('case-status')).toHaveText('ส่งคำขอแล้ว');
  await expect(page.getByTestId('case-status')).toHaveAttribute('data-status', 'SUBMITTED');
  await expect(page.getByTestId('case-fee')).toHaveText('฿40');
  await expect(page.getByTestId('sla-due')).toHaveText('4 ธ.ค. 2569 16:30');
  await expect(page.getByTestId('sla-due')).toHaveAttribute('data-iso', '2026-12-04T16:30:00+07:00');
  await expect(page.getByTestId('sla-level')).toHaveText('ปกติ');
  await expect(page.getByTestId('cancel-case-btn')).toHaveCount(1);
  await expect(page.getByTestId('case-step')).toHaveCount(0);

  const op = await newPage(browser);
  await uiStaff(op, 'off.reg1', /\/officer\/queue/);
  const row = queueRow(op, 31);
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('row-owner')).toHaveText('');
  await expect(row.getByTestId('claim-btn')).toHaveCount(1);
  const order = (await queueCaseNos(op)).map(short);
  expect(order.indexOf('000031')).toBe(order.indexOf('000030') + 1);
});

test('TC-SUBMIT-02 เอกสารบังคับครบก่อนชำระ', async ({ page }) => {
  const api = await apiCitizen(SOMCHAI);
  await uiCitizen(page, SOMCHAI);
  const toPay = page.getByTestId('to-payment-btn');
  const missing = page.getByTestId('missing-docs');
  const items = page.getByTestId('file-item');

  // SV-02
  await uiWizard(page, 'SV-02');
  await uiUpload(page, 'upload-input-id-card', 'id-card.pdf');
  await expect(items).toHaveCount(1);
  await expect(toPay).toBeDisabled();
  await expect(missing).toHaveText('ยังขาดเอกสาร: แผนที่ตั้ง');
  await uiUpload(page, 'upload-input-map', 'map.pdf');
  await expect(items).toHaveCount(2);
  await expect(toPay).toBeEnabled();
  await expect(missing).toHaveCount(0);
  await page.locator('[data-testid="file-item"][data-doc-key="map"]').getByTestId('file-remove-btn').click();
  await expect(items).toHaveCount(1);
  await expect(toPay).toBeDisabled();
  await expect(missing).toHaveText('ยังขาดเอกสาร: แผนที่ตั้ง');

  // SV-03
  await uiWizard(page, 'SV-03', 100);
  await uiUpload(page, 'upload-input-id-card', 'id-card.pdf');
  await expect(items).toHaveCount(1);
  await expect(toPay).toBeDisabled();
  await expect(missing).toHaveText('ยังขาดเอกสาร: แบบแปลน, โฉนด');
  await uiUpload(page, 'upload-input-deed', 'deed.pdf');
  await expect(items).toHaveCount(2);
  await expect(toPay).toBeDisabled();
  await expect(missing).toHaveText('ยังขาดเอกสาร: แบบแปลน');
  await uiUpload(page, 'upload-input-plan', 'plan-as-jpg.jpg');
  await expect(page.getByTestId('upload-error')).toHaveText('แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น');
  await expect(items).toHaveCount(2);
  await expect(toPay).toBeDisabled();
  await expect(missing).toHaveText('ยังขาดเอกสาร: แบบแปลน');
  await uiUpload(page, 'upload-input-plan', 'plan.pdf');
  await expect(items).toHaveCount(3);
  await expect(toPay).toBeEnabled();
  await expect(missing).toHaveCount(0);

  // API
  const d = await apiDraft(api, { serviceId: 'SV-03', areaSqm: 100 });
  expect((await apiUpload(api, d.draftId, 'id-card.pdf', 'id-card')).status()).toBe(201);
  expect((await apiUpload(api, d.draftId, 'deed.pdf', 'deed')).status()).toBe(201);
  let r = await api.post(`/api/drafts/${d.draftId}/payment`);
  expect(r.status()).toBe(409);
  const b = await r.json();
  expect(b.code).toBe('MISSING_DOCS');
  expect(b.missing).toEqual(['แบบแปลน']);
  expect((await apiUpload(api, d.draftId, 'plan.pdf', 'plan')).status()).toBe(201);
  r = await api.post(`/api/drafts/${d.draftId}/payment`);
  expect(r.status()).toBe(201);
});

test('TC-SUBMIT-03 ร่าง การลบร่าง และการยกเลิก', async ({ page, browser }) => {
  // ส่วน A
  const api = await apiCitizen(SOMCHAI);
  await uiCitizen(page, SOMCHAI);
  await page.goto('/citizen');
  await expect(page.getByTestId('my-case-row')).toHaveCount(10);
  const drafts = page.getByTestId('my-draft-row');
  await expect(drafts).toHaveCount(2);
  const d1 = page.locator('[data-testid="my-draft-row"][data-draft-id="DR-0001"]');
  const d2 = page.locator('[data-testid="my-draft-row"][data-draft-id="DR-0002"]');
  await expect(d1).toHaveAttribute('data-status', 'DRAFT');
  await expect(d2).toHaveAttribute('data-status', 'PENDING_PAYMENT');
  expect(await d1.innerText()).not.toContain('EG-');
  expect(await d2.innerText()).not.toContain('EG-');
  await d1.getByTestId('open-draft-btn').click();
  await expect(page.getByTestId('qty-input')).toHaveValue('2');
  await expect(page.getByTestId('fee-total')).toHaveText('฿40');

  await page.goto('/citizen');
  await page.getByTestId('start-service-SV-01').click();
  await page.getByTestId('qty-input').fill('3');
  await page.getByTestId('save-draft-btn').click();
  await expect(page.getByTestId('draft-id')).toHaveText('DR-0003');
  await page.goto('/citizen');
  await expect(page.getByTestId('my-case-row')).toHaveCount(10);
  expect((await apiCases(api)).length).toBe(10);
  const dl = await api.get('/api/drafts');
  expect((await dl.json()).items.length).toBe(3);

  // ส่วน B ยกเลิก
  await reset();
  const pg = await newPage(browser);
  await uiCitizen(pg, SOMCHAI);
  await pg.goto(`/citizen/cases/${cn(30)}`);
  await expect(pg.getByTestId('cancel-case-btn')).toHaveCount(1);
  await pg.getByTestId('cancel-case-btn').click();
  await expect(pg.getByTestId('cancel-confirm-text')).toHaveText('ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
  await pg.getByTestId('confirm-cancel-btn').click();
  await expect(pg.getByTestId('case-status')).toHaveText('ยกเลิก');
  await expect(pg.getByTestId('case-status')).toHaveAttribute('data-status', 'CANCELLED');
  await expect(pg.getByTestId('no-refund-note')).toHaveText('ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
  await expect(pg.getByTestId('cancel-case-btn')).toHaveCount(0);

  const op = await newPage(browser);
  await uiStaff(op, 'off.reg1', /\/officer\/queue/);
  await expect(op.getByTestId('queue-row')).toHaveCount(16);
  expect((await queueCaseNos(op)).map(short)).not.toContain('000030');
  const ex = await newPage(browser);
  await uiStaff(ex, 'exec1', /\/dashboard/);
  await expect(ex.getByTestId('kpi-backlog')).toHaveText('20');
  await expect(ex.getByTestId('kpi-received')).toHaveText('3');

  // ส่วน C ยกเลิกไม่ได้เมื่อมีผู้รับ
  await reset();
  const reg1 = await apiStaff('off.reg1');
  expect((await reg1.post(`/api/officer/cases/${cn(30)}/claim`)).status()).toBe(200);
  const p2 = await newPage(browser);
  await uiCitizen(p2, SOMCHAI);
  await p2.goto(`/citizen/cases/${cn(30)}`);
  await expect(p2.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
  await expect(p2.getByTestId('cancel-case-btn')).toHaveCount(0);
  const som = await apiCitizen(SOMCHAI);
  for (const n of [30, 13]) {
    const r = await som.post(`/api/cases/${cn(n)}/cancel`);
    expect(r.status(), cn(n)).toBe(409);
    const b = await r.json();
    expect(b.code).toBe('CANNOT_CANCEL');
    expect(b.message).toBe('ยกเลิกไม่ได้ คำขอมีเจ้าหน้าที่รับเรื่องแล้ว');
  }

  // ส่วน E ลบร่าง
  await reset();
  const s2 = await apiCitizen(SOMCHAI);
  expect((await s2.delete('/api/drafts/DR-0001')).status()).toBe(204);
  expect((await s2.get('/api/drafts/DR-0001')).status()).toBe(404);
  const p3 = await newPage(browser);
  await uiCitizen(p3, SOMCHAI);
  await p3.goto('/citizen');
  await expect(p3.getByTestId('my-draft-row')).toHaveCount(1);
  await expect(p3.getByTestId('my-draft-row')).toHaveAttribute('data-draft-id', 'DR-0002');
  expect((await s2.delete('/api/drafts/DR-0002')).status()).toBe(204);
  expect((await s2.get('/api/payments/PP-0001')).status()).toBe(404);
  expect((await apiPay(s2, 'PP-0001', 500)).status()).toBe(404);

  // ส่วน F ยกเลิกชนกับรับเรื่อง
  await reset();
  const s3 = await apiCitizen(SOMCHAI);
  const r1 = await apiStaff('off.reg1');
  const [rc, rk] = await Promise.all([
    s3.post(`/api/cases/${cn(30)}/cancel`),
    r1.post(`/api/officer/cases/${cn(30)}/claim`),
  ]);
  const cur = await (await s3.get(`/api/cases/${cn(30)}`)).json();
  const mine = (await (await r1.get('/api/officer/queue?filter=mine')).json()).items.length;
  if (rc.status() === 200) {
    expect(rk.status()).toBe(409);
    expect((await rk.json()).code).toBe('INVALID_STATE');
    expect(cur.status).toBe('CANCELLED');
    expect(cur.owner).toBeFalsy();
    expect(mine).toBe(3);
  } else {
    expect(rc.status()).toBe(409);
    expect((await rc.json()).code).toBe('CANNOT_CANCEL');
    expect(rk.status()).toBe(200);
    expect(cur.status).toBe('IN_REVIEW');
    expect(cur.owner).toBe('off.reg1');
    expect(mine).toBe(4);
  }
});

// ═════════════════════════ UPLOAD ═════════════════════════

test('TC-UPLOAD-01 ขนาดและจำนวนไฟล์', async ({ page }) => {
  const api = await apiCitizen(SOMCHAI);
  await uiCitizen(page, SOMCHAI);
  await uiWizard(page, 'SV-01', 1);
  const items = page.getByTestId('file-item');
  const err = page.getByTestId('upload-error');

  // ขนาด
  for (const [n, ok] of [[5242879, true], [5242880, true], [5242881, false]] as [number, boolean][]) {
    const name = `size-${n}.pdf`;
    await uiUpload(page, 'upload-input-id-card', name);
    if (ok) {
      await expect(items, name).toHaveCount(1);
      await expect(err).toHaveCount(0);
      await items.first().getByTestId('file-remove-btn').click();
      await expect(items).toHaveCount(0);
    } else {
      await expect(err, name).toHaveText('ไฟล์ใหญ่เกิน 5 MB');
      await expect(items).toHaveCount(0);
    }
    const d = await apiDraft(api, { serviceId: 'SV-01', qty: 1 });
    const r = await apiUpload(api, d.draftId, name, 'id-card');
    if (ok) expect(r.status(), `api ${name}`).toBe(201);
    else {
      expect(r.status(), `api ${name}`).toBe(400);
      const b = await r.json();
      expect(b.code).toBe('FILE_TOO_LARGE');
      expect(b.message).toBe('ไฟล์ใหญ่เกิน 5 MB');
    }
  }

  // จำนวน
  await uiUpload(page, 'upload-input-id-card', 'id-card.pdf');
  await uiUpload(page, 'upload-input-extra', ['multi-1.pdf', 'multi-2.pdf', 'multi-3.pdf', 'multi-4.pdf']);
  await expect(items).toHaveCount(5);
  await uiUpload(page, 'upload-input-extra', 'multi-5.pdf');
  await expect(err).toHaveText('แนบได้สูงสุด 5 ไฟล์ต่อคำขอ');
  await expect(items).toHaveCount(5);
  await items.last().getByTestId('file-remove-btn').click();
  await expect(items).toHaveCount(4);
  await uiUpload(page, 'upload-input-extra', 'multi-5.pdf');
  await expect(items).toHaveCount(5);

  const d = await apiDraft(api, { serviceId: 'SV-01', qty: 1 });
  expect((await apiUpload(api, d.draftId, 'id-card.pdf', 'id-card')).status()).toBe(201);
  for (let i = 1; i <= 4; i++) expect((await apiUpload(api, d.draftId, `multi-${i}.pdf`, 'extra')).status()).toBe(201);
  const r6 = await apiUpload(api, d.draftId, 'multi-5.pdf', 'extra');
  expect(r6.status()).toBe(400);
  expect((await r6.json()).code).toBe('FILE_COUNT');
});

test('TC-UPLOAD-02 ชนิดไฟล์จากเนื้อไฟล์', async ({ page }) => {
  const api = await apiCitizen(SOMCHAI);
  await uiCitizen(page, SOMCHAI);
  await uiWizard(page, 'SV-01', 1);
  const items = page.getByTestId('file-item');
  const err = page.getByTestId('upload-error');
  const typeMsg = 'รองรับเฉพาะไฟล์ PDF, JPG, PNG';

  for (const name of ['ok-id.pdf', 'real.jpg', 'real.png']) {
    await uiUpload(page, 'upload-input-id-card', name);
    await expect(items, name).toHaveCount(1);
    await items.first().getByTestId('file-remove-btn').click();
    await expect(items).toHaveCount(0);
    const d = await apiDraft(api, { serviceId: 'SV-01', qty: 1 });
    expect((await apiUpload(api, d.draftId, name, 'id-card')).status(), `api ${name}`).toBe(201);
  }

  const bad = ['fake-text.pdf', 'fake-text.jpg', 'exe-as.png', 'notes.txt'];
  for (const name of bad) {
    await uiUpload(page, 'upload-input-id-card', name);
    await expect(err, name).toHaveText(typeMsg);
    await expect(items).toHaveCount(0);
  }
  // ส่งด้วย mimeType: application/pdf (ไม่เชื่อ Content-Type)
  await page.getByTestId('upload-input-id-card').setInputFiles({
    name: 'fake-text.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('hello'),
  });
  await expect(err).toHaveText(typeMsg);
  await expect(items).toHaveCount(0);
  await expect(page.getByTestId('to-payment-btn')).toBeDisabled();

  // API: ปฏิเสธ + ไม่ถูกเก็บ (ชำระไม่ได้เพราะบัตรประชาชนไม่ครบ)
  const d = await apiDraft(api, { serviceId: 'SV-01', qty: 1 });
  for (const name of [...bad, 'fake-text.pdf']) {
    const f = name === 'fake-text.pdf' ? { ...file(name), mimeType: 'application/pdf' } : file(name);
    const r = await apiUpload(api, d.draftId, name, 'id-card', f);
    expect(r.status(), `api ${name}`).toBe(400);
    expect((await r.json()).code).toBe('FILE_TYPE');
  }
  const pr = await api.post(`/api/drafts/${d.draftId}/payment`);
  expect(pr.status()).toBe(409);
  expect((await pr.json()).code).toBe('MISSING_DOCS');
});

// ═════════════════════════ PAY ═════════════════════════

test('TC-PAY-01 อายุ QR 15:00', async ({ browser }) => {
  const rounds: [string | null, number, string][] = [
    [null, 200, '5:00'],
    ['2026-12-01T09:09:59+07:00', 200, '14:59'],
    ['2026-12-01T09:10:00+07:00', 410, '15:00'],
    ['2026-12-01T09:10:01+07:00', 410, '15:01'],
  ];
  for (let i = 0; i < rounds.length; i++) {
    const [clock, status, age] = rounds[i];
    if (i > 0) await reset();
    if (clock) await setClock(clock);
    const api = await apiCitizen(SOMCHAI);
    const r = await apiPay(api, 'PP-0001', 500);
    expect(r.status(), `อายุ ${age}`).toBe(status);
    const b = await r.json();
    if (status === 200) {
      expect(b.status).toBe('PAID');
      expect(b.caseNo).toBe('EG-2569-000031');
    } else {
      expect(b.code).toBe('QR_EXPIRED');
    }
    if (i === 2) {
      const p = await api.get('/api/payments/PP-0001');
      expect((await p.json()).status).toBe('EXPIRED');
      expect((await apiCases(api)).length).toBe(10);

      // บนจอ
      const page = await newPage(browser);
      await uiCitizen(page, SOMCHAI);
      await page.goto('/citizen/new/SV-02?draft=DR-0002');
      await expect(page.getByTestId('qr-expired-msg')).toHaveText('QR หมดอายุ กรุณาสร้าง QR ใหม่');
      await expect(page.getByTestId('payment-status')).toHaveText('QR หมดอายุ');
      await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'EXPIRED');
      await expect(page.getByTestId('regenerate-qr-btn')).toHaveCount(1);
      await page.getByTestId('regenerate-qr-btn').click();
      await expect(page.getByTestId('qr-ref')).toHaveText('PP-0002');
      await expect(page.getByTestId('qr-expires')).toHaveAttribute('data-iso', '2026-12-01T09:25:00+07:00');
      const r2 = await apiPay(api, 'PP-0002', 500);
      expect(r2.status()).toBe(200);
      expect((await r2.json()).caseNo).toBe('EG-2569-000031');
    }
  }
});

test('TC-PAY-02 ยอดเงินและ callback ซ้ำ', async () => {
  const api = await apiCitizen(SOMCHAI);
  const p = await apiPrepare(api, 'SV-01', 1);
  expect(p.ref).toBe('PP-0002');
  expect(p.fee).toBe(20);

  let r = await apiPay(api, 'PP-0002', 19);
  expect(r.status()).toBe(422);
  expect((await r.json()).code).toBe('AMOUNT_MISMATCH');
  expect((await (await api.get('/api/payments/PP-0002')).json()).status).toBe('PENDING');
  expect((await apiCases(api)).length).toBe(10);

  r = await apiPay(api, 'PP-0002', 21);
  expect(r.status()).toBe(422);
  expect((await (await api.get('/api/payments/PP-0002')).json()).status).toBe('PENDING');

  r = await apiPay(api, 'PP-0002', 20);
  expect(r.status()).toBe(200);
  let b = await r.json();
  expect(b.status).toBe('PAID');
  expect(b.caseNo).toBe('EG-2569-000031');
  expect(b.receiptNo).toBe('RC-2569-000031');
  expect((await apiCases(api)).length).toBe(11);

  r = await apiPay(api, 'PP-0002', 20);
  expect(r.status()).toBe(200);
  b = await r.json();
  expect(b.duplicate).toBe(true);
  expect(b.caseNo).toBe('EG-2569-000031');
  expect(b.receiptNo).toBe('RC-2569-000031');
  expect((await apiCases(api)).length).toBe(11);

  const n = await apiNewPaid(api, 'SV-01', 1);
  expect(n.pay.caseNo).toBe('EG-2569-000032');
  expect(n.pay.receiptNo).toBe('RC-2569-000032');
});

test('TC-PAY-03 ชำระพร้อมกัน เลขไม่ซ้ำ', async () => {
  const a = await apiCitizen(SOMCHAI);
  const b = await apiCitizen(SOMYING);
  const prepared: { ctx: APIRequestContext; ref: string }[] = [];
  const beforeA = (await apiCases(a)).map((c) => c.caseNo);
  const beforeB = (await apiCases(b)).map((c) => c.caseNo);
  for (const ctx of [a, a, a, b, b, b]) {
    const p = await apiPrepare(ctx, 'SV-01', 1);
    prepared.push({ ctx, ref: p.ref });
  }
  expect(prepared.map((p) => p.ref)).toEqual(['PP-0002', 'PP-0003', 'PP-0004', 'PP-0005', 'PP-0006', 'PP-0007']);

  const res = await Promise.all(prepared.map((p) => apiPay(p.ctx, p.ref, 20)));
  const bodies: any[] = [];
  for (const r of res) {
    expect(r.status()).toBe(200);
    bodies.push(await r.json());
  }
  const want = [31, 32, 33, 34, 35, 36];
  expect(new Set(bodies.map((x) => x.caseNo))).toEqual(new Set(want.map(cn)));
  expect(new Set(bodies.map((x) => x.caseNo)).size).toBe(6);
  expect(new Set(bodies.map((x) => x.receiptNo))).toEqual(new Set(want.map((n) => `RC-2569-0000${n}`)));

  const afterA = (await apiCases(a)).map((c) => c.caseNo).filter((c) => !beforeA.includes(c));
  const afterB = (await apiCases(b)).map((c) => c.caseNo).filter((c) => !beforeB.includes(c));
  expect(afterA.length).toBe(3);
  expect(afterB.length).toBe(3);

  const nx = await apiNewPaid(a, 'SV-01', 1);
  expect(nx.pay.caseNo).toBe('EG-2569-000037');
});

test('TC-PAY-04 เลขคำขอข้ามปี 2569 → 2570', async ({ page }) => {
  // 1 23:58 สร้างร่าง + QR (ผ่านหน้าจอ)
  await setClock('2026-12-31T23:58:00+07:00');
  const api = await apiCitizen(SOMCHAI);
  await uiCitizen(page, SOMCHAI);
  await uiWizard(page, 'SV-01', 1);
  await uiUpload(page, 'upload-input-id-card', 'id-card.pdf');
  await expect(page.getByTestId('file-item')).toHaveCount(1);
  await page.getByTestId('to-payment-btn').click();
  await page.getByTestId('create-qr-btn').click();
  const ref = (await page.getByTestId('qr-ref').innerText()).trim();
  expect(ref).toBe('PP-0002');
  expect((await (await api.get(`/api/payments/${ref}`)).json()).caseNo ?? null).toBeNull();
  expect((await apiCases(api)).length).toBe(10);

  // 2 23:59 ชำระ
  await setClock('2026-12-31T23:59:00+07:00');
  let r = await apiPay(api, ref, 20);
  expect(r.status()).toBe(200);
  let b = await r.json();
  expect(b.caseNo).toBe('EG-2569-000031');
  expect(b.receiptNo).toBe('RC-2569-000031');
  await page.getByTestId('refresh-payment-btn').click();
  await expect(page.getByTestId('receipt-paid-at')).toHaveAttribute('data-iso', '2026-12-31T23:59:00+07:00');

  // 3 ข้ามปี
  await setClock('2027-01-01T00:00:00+07:00');
  const p3 = await apiPrepare(api, 'SV-01', 1);
  r = await apiPay(api, p3.ref, 20);
  expect(r.status()).toBe(200);
  b = await r.json();
  expect(b.caseNo).toBe('EG-2570-000001');
  expect(b.receiptNo).toBe('RC-2570-000001');

  // 4 ใบที่ 2
  const p4 = await apiPrepare(api, 'SV-01', 1);
  r = await apiPay(api, p4.ref, 20);
  expect(r.status()).toBe(200);
  expect((await r.json()).caseNo).toBe('EG-2570-000002');

  // 5 เลขเดิมไม่ถูกแก้
  const c = await api.get('/api/cases/EG-2569-000031');
  expect(c.status()).toBe(200);
  expect((await c.json()).caseNo).toBe('EG-2569-000031');
});

// ═════════════════════════ QUEUE ═════════════════════════

test('TC-QUEUE-01 ลำดับคิวและขอบเขตแผนก', async ({ page, browser }) => {
  const regOrder = ['000020', '000022', '000024', '000023', '000025', '000026', '000013', '000015', '000027', '000028', '000029', '000030', '000016', '000018', '000019', '000012', '000021'];
  const claimable = ['000024', '000028', '000029', '000030'];

  await uiStaff(page, 'off.reg1', /\/officer\/queue/);
  const filter = page.getByTestId('queue-filter');
  await expect(filter).toHaveValue('all');
  const rows = page.getByTestId('queue-row');
  await expect(rows).toHaveCount(17);
  const all = (await queueCaseNos(page)).map(short);
  expect(all).toEqual(regOrder);
  for (const x of ['000017', '000011', '000014', '000010', '000001', '000009']) expect(all).not.toContain(x);

  const levels = rows.getByTestId('row-sla-level');
  await expect(levels.nth(0)).toHaveText('เกินกำหนด');
  await expect(levels.nth(1)).toHaveText('ใกล้ครบกำหนด');
  await expect(levels.nth(2)).toHaveText('ใกล้ครบกำหนด');
  const masked = await rows.getByTestId('row-id-masked').allInnerTexts();
  expect(masked.length).toBe(17);
  for (const m of masked) expect(m.trim()).toMatch(/^X-XXXX-XXXXX-\d{2}-\d$/);

  await expect(page.getByTestId('claim-btn')).toHaveCount(4);
  for (let i = 0; i < all.length; i++) {
    const has = await rows.nth(i).getByTestId('claim-btn').count();
    expect(has, all[i]).toBe(claimable.includes(all[i]) ? 1 : 0);
  }

  await filter.selectOption('unclaimed');
  await expect(rows).toHaveCount(4);
  expect((await queueCaseNos(page)).map(short).sort()).toEqual(claimable);
  await filter.selectOption('mine');
  await expect(rows).toHaveCount(3);
  expect((await queueCaseNos(page)).map(short).sort()).toEqual(['000020', '000022', '000023']);
  await expect(page.getByTestId('workload-count')).toHaveText('3');

  // off.reg2
  const p2 = await newPage(browser);
  await uiStaff(p2, 'off.reg2', /\/officer\/queue/);
  await p2.getByTestId('queue-filter').selectOption('mine');
  await expect(p2.getByTestId('queue-row')).toHaveCount(9);
  expect((await queueCaseNos(p2)).map(short)).toEqual(['000025', '000026', '000013', '000015', '000027', '000016', '000018', '000012', '000021']);
  await expect(p2.getByTestId('workload-count')).toHaveText('9');

  // off.works1
  const p3 = await newPage(browser);
  await uiStaff(p3, 'off.works1', /\/officer\/queue/);
  await expect(p3.getByTestId('queue-row')).toHaveCount(1);
  expect((await queueCaseNos(p3)).map(short)).toEqual(['000010']);

  // head1
  const p4 = await newPage(browser);
  await uiStaff(p4, 'head1', /\/head\/approvals/);
  await p4.goto('/officer/queue');
  await expect(p4.getByTestId('queue-row')).toHaveCount(18);
  const hs = (await queueCaseNos(p4)).map(short);
  expect(hs.slice(3, 7)).toEqual(['000010', '000023', '000025', '000026']);
  expect([...hs].sort()).toEqual([...regOrder, '000010'].sort());
  await expect(p4.getByTestId('claim-btn')).toHaveCount(0);
});

test('TC-QUEUE-02 รับเรื่องซ้อน (พร้อมกันและต่อกัน)', async ({ browser }) => {
  const C28 = cn(28);
  const C29 = cn(29);
  // ส่วน 1 พร้อมกัน (UI)
  const pa = await newPage(browser);
  const pb = await newPage(browser);
  await uiStaff(pa, 'off.reg1', /\/officer\/queue/);
  await uiStaff(pb, 'off.reg2', /\/officer\/queue/);
  await expect(queueRow(pa, 28)).toHaveCount(1);
  await expect(queueRow(pb, 28)).toHaveCount(1);
  await Promise.all([
    queueRow(pa, 28).getByTestId('claim-btn').click(),
    queueRow(pb, 28).getByTestId('claim-btn').click(),
  ]);
  const viewer = await apiStaff('off.reg1');
  await expect
    .poll(async () => (await (await viewer.get(`/api/cases/${C28}`)).json()).owner)
    .toBeTruthy();
  const cs = await (await viewer.get(`/api/cases/${C28}`)).json();
  expect(['off.reg1', 'off.reg2']).toContain(cs.owner);
  expect(cs.status).toBe('IN_REVIEW');
  const winner = cs.owner === 'off.reg1' ? pa : pb;
  const loser = cs.owner === 'off.reg1' ? pb : pa;
  await expect(queueRow(winner, 28).getByTestId('row-owner')).toHaveText(NAMES[cs.owner]);
  await expect(loser.getByTestId('action-error').first()).toHaveText('มีเจ้าหน้าที่รับเรื่องนี้แล้ว');
  expect((await auditEvents('CLAIM', C28)).length).toBe(1);

  // ส่วน 2 พร้อมกัน (API)
  await reset();
  const a = await apiStaff('off.reg1');
  const b = await apiStaff('off.reg2');
  const res = await Promise.all(
    Array.from({ length: 10 }, (_, i) => (i < 5 ? a : b).post(`/api/officer/cases/${C29}/claim`)),
  );
  const codes = res.map((r) => r.status());
  expect(codes.filter((c) => c === 200).length).toBe(1);
  expect(codes.filter((c) => c === 409).length).toBe(9);
  for (const r of res) if (r.status() === 409) expect((await r.json()).code).toBe('ALREADY_CLAIMED');
  const owner2 = (await (await a.get(`/api/cases/${C29}`)).json()).owner;
  expect(['off.reg1', 'off.reg2']).toContain(owner2);
  expect((await auditEvents('CLAIM', C29)).length).toBe(1);

  // ส่วน 3 ต่อกัน
  await reset();
  const a3 = await apiStaff('off.reg1');
  const b3 = await apiStaff('off.reg2');
  let r = await a3.post(`/api/officer/cases/${C29}/claim`);
  expect(r.status()).toBe(200);
  expect((await r.json()).owner).toBe('off.reg1');
  r = await b3.post(`/api/officer/cases/${C29}/claim`);
  expect(r.status()).toBe(409);
  const eb = await r.json();
  expect(eb.code).toBe('ALREADY_CLAIMED');
  expect(eb.message).toBe('มีเจ้าหน้าที่รับเรื่องนี้แล้ว');
  expect((await (await b3.get(`/api/cases/${C29}`)).json()).owner).toBe('off.reg1');
  const pg = await newPage(browser);
  await uiStaff(pg, 'off.reg2', /\/officer\/queue/);
  await expect(pg.getByTestId('workload-count')).toHaveText('9');
  r = await a3.post(`/api/officer/cases/${C29}/claim`);
  expect(r.status()).toBe(409);
  expect((await auditEvents('CLAIM', C29)).length).toBe(1);
});

test('TC-QUEUE-03 งานในมือสูงสุด 10', async ({ page, browser }) => {
  await uiStaff(page, 'off.reg2', /\/officer\/queue/);
  const wl = page.getByTestId('workload-count');
  await expect(wl).toHaveText('9');

  // 2
  await queueRow(page, 28).getByTestId('claim-btn').click();
  await expect(wl).toHaveText('10');

  // 3
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/officer/cases/${cn(29)}/claim`)),
    queueRow(page, 29).getByTestId('claim-btn').click(),
  ]);
  expect(resp.status()).toBe(409);
  expect((await resp.json()).code).toBe('WORKLOAD_LIMIT');
  await expect(page.getByTestId('action-error').first()).toHaveText('รับงานได้สูงสุด 10 เรื่อง');
  await expect(wl).toHaveText('10');
  const reg2 = await apiStaff('off.reg2');
  const c29 = await (await reg2.get(`/api/cases/${cn(29)}`)).json();
  expect(c29.status).toBe('SUBMITTED');
  expect(c29.owner).toBeFalsy();

  // 4
  await page.goto(`/officer/cases/${cn(25)}`);
  await page.getByTestId('approve-btn').click();
  await expect(page.getByTestId('case-status')).toHaveAttribute('data-status', 'APPROVED');
  await page.goto('/officer/queue');
  await expect(page.getByTestId('workload-count')).toHaveText('9');

  // 5
  await queueRow(page, 29).getByTestId('claim-btn').click();
  await expect(page.getByTestId('workload-count')).toHaveText('10');

  // 6
  const reg1 = await apiStaff('off.reg1');
  expect((await reg1.post(`/api/officer/cases/${cn(30)}/claim`)).status()).toBe(200);

  // 7 RESET
  await reset();
  const p2 = await newPage(browser);
  await uiStaff(p2, 'off.reg2', /\/officer\/queue/);
  const r2 = await apiStaff('off.reg2');
  let r = await r2.post(`/api/officer/cases/${cn(25)}/return`, { data: { reason: 'xxxxxxxxxx' } });
  expect(r.status()).toBe(200);
  await p2.goto(`/officer/cases/${cn(25)}`);
  await expect(p2.getByTestId('case-status')).toHaveText('รอแก้ไขเอกสาร');
  await p2.goto('/officer/queue');
  await expect(p2.getByTestId('workload-count')).toHaveText('8');

  // 8
  expect((await r2.post(`/api/officer/cases/${cn(28)}/claim`)).status()).toBe(200);
  expect((await r2.post(`/api/officer/cases/${cn(29)}/claim`)).status()).toBe(200);
  await p2.reload();
  await expect(p2.getByTestId('workload-count')).toHaveText('10');

  // 9 สมหญิงส่งแก้
  const ps = await newPage(browser);
  await uiCitizen(ps, SOMYING);
  await ps.goto(`/citizen/cases/${cn(25)}`);
  await ps.getByTestId('submit-fix-btn').click();
  await expect(ps.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
  await expect(ps.getByTestId('action-error')).toHaveCount(0);
  expect((await (await r2.get(`/api/cases/${cn(25)}`)).json()).owner).toBe('off.reg2');
  await p2.goto('/officer/queue');
  await expect(p2.getByTestId('workload-count')).toHaveText('11');

  // 10
  r = await r2.post(`/api/officer/cases/${cn(30)}/claim`);
  expect(r.status()).toBe(409);
  const b = await r.json();
  expect(b.code).toBe('WORKLOAD_LIMIT');
  expect(b.message).toBe('รับงานได้สูงสุด 10 เรื่อง');
  await p2.reload();
  await expect(p2.getByTestId('workload-count')).toHaveText('11');
});
