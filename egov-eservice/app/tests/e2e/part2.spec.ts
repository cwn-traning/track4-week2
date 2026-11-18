/**
 * Playwright ชุดที่ 2 — TC: SLA-01..03 · NOTI-01..02 · WORKFLOW-01..06 · DOC-01..03
 *                        DASH-01..04 · AUDIT-01..03 · RBAC-04 · RBAC-06  (23 TC)
 * เขียนจาก TEST-PLAN / CONTRACT / TEST-DATA เท่านั้น (ไม่อ่านโค้ดเว็บ)
 * ชุดที่ 1 มีอีก 28 TC (AUTH FEE SUBMIT UPLOAD PAY QUEUE PDPA RBAC-01/02/03/05 NFR) รวมเป็น 51
 *
 * ต้องรันด้วย workers = 1 (ทุก TC เรียก POST /api/test/reset ที่ใช้ร่วมกันทั้งเซิร์ฟเวอร์)
 * ตัวแปร: BASE_URL (ค่าเริ่มต้น http://localhost:3000) · เซิร์ฟเวอร์ต้องเปิด TEST_MODE=1
 * ไม่พึ่งไลบรารีเพิ่ม: อ่าน .xlsx / PDF ด้วยตัวช่วยในไฟล์นี้
 */
import { test as base, expect, APIRequestContext, APIResponse, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as zlib from 'zlib';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const PW = 'Test@1234';
const OTP = '123456';
const T0 = '2026-12-01T09:00:00+07:00';
const IDS: Record<string, string> = {
  somchai: '1101700123456',
  somying: '3100600987659',
  mana: '5500400111221',
  piti: '1909900555015',
};
const C = (n: number) => `EG-2569-${String(n).padStart(6, '0')}`;
const REASON = 'xxxxxxxxxx';
const NEAR = 'ใกล้ครบกำหนด';
const OVERDUE = 'เกินกำหนด';
const NORMAL = 'ปกติ';
const VERIFY_TXT: Record<string, string> = {
  VALID: 'เอกสารถูกต้อง',
  EXPIRED: 'เอกสารหมดอายุ',
  TAMPERED: 'ลายเซ็นไม่ถูกต้อง',
  NOT_FOUND: 'ไม่พบเอกสาร',
};

/* ───────────────────────── ตัวช่วยทั่วไป ───────────────────────── */

async function ok(r: APIResponse, status = 200): Promise<any> {
  expect(r.status(), `${r.url()} → ${await r.text().catch(() => '')}`).toBe(status);
  return r.json().catch(() => null);
}

function pdf(n = 1024): Buffer {
  const head = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n');
  const tail = Buffer.from('\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  return Buffer.concat([head, Buffer.alloc(n - head.length - tail.length, 0x20), tail]);
}

const DOC_KEYS: Record<string, string[]> = {
  'SV-01': ['id-card'],
  'SV-02': ['id-card', 'map'],
  'SV-03': ['id-card', 'plan', 'deed'],
};

class H {
  private apis = new Map<string, APIRequestContext>();
  private ctxs = new Map<string, BrowserContext>();
  private closers: Array<() => Promise<unknown>> = [];
  private _anon?: APIRequestContext;
  lastLogin: Record<string, any> = {};

  constructor(
    private mkApi: () => Promise<APIRequestContext>,
    private mkCtx: () => Promise<BrowserContext>,
  ) {}

  async dispose() {
    for (const f of this.closers) await f().catch(() => undefined);
    this.closers = [];
    this.apis.clear();
    this.ctxs.clear();
    this._anon = undefined;
  }

  async anon() {
    if (!this._anon) {
      this._anon = await this.mkApi();
      this.closers.push(() => this._anon!.dispose());
    }
    return this._anon;
  }

  /** RESET: ล้าง session ทั้งหมด (ทุกคนต้องล็อกอินใหม่) */
  async reset() {
    await this.dispose();
    const a = await this.anon();
    const j = await ok(await a.post('/api/test/reset'));
    expect(j.now).toBe(T0);
  }

  async clock(now: string) {
    const a = await this.anon();
    const j = await ok(await a.put('/api/test/clock', { data: { now } }));
    expect(j.now).toBe(now);
  }

  private async login(who: string): Promise<APIRequestContext> {
    const a = await this.mkApi();
    this.closers.push(() => a.dispose());
    if (IDS[who]) {
      await ok(await a.post('/api/auth/thaid/start', { data: { idNo: IDS[who] } }));
      await ok(await a.post('/api/auth/thaid/verify', { data: { idNo: IDS[who], otp: OTP } }));
    } else {
      this.lastLogin[who] = await ok(await a.post('/api/auth/staff/login', { data: { username: who, password: PW } }));
    }
    return a;
  }

  /** LOGIN_C / LOGIN_S (cache ต่อบัญชี เพื่อให้ STAFF_LOGIN นับครั้งเดียว) · fresh=true ล็อกอินใหม่ */
  async api(who: string, fresh = false) {
    if (fresh || !this.apis.has(who)) {
      this.apis.set(who, await this.login(who));
      this.ctxs.delete(who);
    }
    return this.apis.get(who)!;
  }

  /** หน้าเว็บที่ล็อกอินแล้ว (ใช้ cookie เดียวกับ api(who) จึงไม่เกิดการล็อกอินซ้ำ) */
  async page(who: string): Promise<Page> {
    if (!this.ctxs.has(who)) {
      const a = await this.api(who);
      const c = await this.mkCtx();
      this.closers.push(() => c.close());
      await c.addCookies((await a.storageState()).cookies);
      this.ctxs.set(who, c);
    }
    return this.ctxs.get(who)!.newPage();
  }

  async anonPage(): Promise<Page> {
    const c = await this.mkCtx();
    this.closers.push(() => c.close());
    return c.newPage();
  }

  get(who: string, path: string) {
    return this.api(who).then((a) => a.get(path));
  }
  post(who: string, path: string, data?: unknown) {
    return this.api(who).then((a) => (data === undefined ? a.post(path) : a.post(path, { data })));
  }
  claim(who: string, c: string) {
    return this.post(who, `/api/officer/cases/${c}/claim`);
  }
  ret(who: string, c: string, reason = REASON) {
    return this.post(who, `/api/officer/cases/${c}/return`, { reason });
  }
  fwd(who: string, c: string, note?: string) {
    return this.post(who, `/api/officer/cases/${c}/forward`, note === undefined ? {} : { note });
  }
  approve(who: string, c: string) {
    return this.post(who, `/api/cases/${c}/approve`);
  }
  reject(who: string, c: string, reason = REASON) {
    return this.post(who, `/api/cases/${c}/reject`, { reason });
  }
  issue(who: string, c: string) {
    return this.post(who, `/api/officer/cases/${c}/issue`);
  }
  resubmit(who: string, c: string) {
    return this.post(who, `/api/cases/${c}/resubmit`);
  }
  async caseJson(who: string, c: string) {
    return ok(await this.get(who, `/api/cases/${c}`));
  }
  async notis(who: string): Promise<Array<{ caseNo: string; level: string; text: string }>> {
    return (await ok(await this.get(who, '/api/notifications'))).items;
  }
  async dash(period: string, service = 'ALL') {
    return ok(await this.get('exec1', `/api/dashboard?period=${period}&service=${service}`));
  }

  /** NEW_PAID */
  async newPaid(o: { who?: string; svc?: 'SV-01' | 'SV-02' | 'SV-03'; at?: string; qty?: number; area?: number } = {}) {
    const who = o.who ?? 'somchai';
    const svc = o.svc ?? 'SV-01';
    if (o.at) await this.clock(o.at);
    const a = await this.api(who);
    const body =
      svc === 'SV-01' ? { serviceId: svc, qty: o.qty ?? 1 } : svc === 'SV-03' ? { serviceId: svc, areaSqm: o.area ?? 100 } : { serviceId: svc };
    const d = await ok(await a.post('/api/drafts', { data: body }), 201);
    for (const key of DOC_KEYS[svc]) {
      await ok(
        await a.post(`/api/drafts/${d.draftId}/files`, {
          multipart: { file: { name: `${key}.pdf`, mimeType: 'application/pdf', buffer: pdf() }, docKey: key },
        }),
        201,
      );
    }
    const p = await ok(await a.post(`/api/drafts/${d.draftId}/payment`), 201);
    const anon = await this.anon();
    const paid = await ok(await anon.post(`/api/test/payments/${p.ref}/pay`, { data: { amount: d.fee } }), 200);
    expect(paid.status).toBe('PAID');
    return { caseNo: paid.caseNo as string, fee: d.fee as number, ref: p.ref as string };
  }
}

const test = base.extend<{ h: H }>({
  h: async ({ playwright, browser }, use) => {
    const h = new H(
      () => playwright.request.newContext({ baseURL: BASE }),
      () => browser.newContext({ baseURL: BASE, acceptDownloads: true, ...(process.env.REPORT === '1' ? { recordVideo: { dir: test.info().outputDir, size: { width: 800, height: 600 } } } : {}) }),
    );
    await use(h);
    await h.dispose();
  },
});
test.setTimeout(240_000);

const tid = (p: Page, id: string) => p.getByTestId(id);

async function expectStatus(p: Page, text: string, code?: string) {
  const s = tid(p, 'case-status');
  await expect(s).toHaveText(text);
  if (code) await expect(s).toHaveAttribute('data-status', code);
}

async function attrList(p: Page, id: string, attr: string): Promise<string[]> {
  return p.getByTestId(id).evaluateAll((els, a) => els.map((e) => e.getAttribute(a as string) ?? ''), attr);
}

async function download(p: Page, id: string): Promise<{ name: string; buf: Buffer }> {
  const [d] = await Promise.all([p.waitForEvent('download'), tid(p, id).click()]);
  const path = await d.path();
  return { name: d.suggestedFilename(), buf: fs.readFileSync(path!) };
}

/** เปิดฟอร์มเหตุผล (ถ้ายังไม่เห็น) แล้วกรอก + ยืนยัน */
async function submitReason(p: Page, btn: string, input: string, submit: string, reason: string) {
  const field = tid(p, input);
  if (!(await field.isVisible().catch(() => false))) await tid(p, btn).click();
  await field.fill(reason);
  await tid(p, submit).click();
}

const noPII = (s: string) => {
  expect(s).not.toMatch(/\d{13}/);
  expect(s).not.toMatch(/0\d{9}/);
  for (const n of ['สมชาย', 'สมหญิง', 'ปิติ', 'มานะ']) expect(s).not.toContain(n);
};

/* ── อ่าน .xlsx (zip + xml) โดยไม่พึ่งไลบรารี ── */
function unzip(buf: Buffer): Record<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd, 'ไม่ใช่ไฟล์ zip/xlsx').toBeGreaterThanOrEqual(0);
  const n = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nl = buf.readUInt16LE(off + 28);
    const el = buf.readUInt16LE(off + 30);
    const cl = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nl);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + csize);
    out[name] = method === 0 ? data : zlib.inflateRawSync(data);
    off += 46 + nl + el + cl;
  }
  return out;
}
const unxml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');

function xlsxCells(buf: Buffer): Record<string, string> {
  const z = unzip(buf);
  const ss: string[] = z['xl/sharedStrings.xml']
    ? [...z['xl/sharedStrings.xml'].toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
        unxml([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')),
      )
    : [];
  const sheet = Object.keys(z)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')))[0];
  expect(sheet, 'ไม่พบชีตใน xlsx').toBeTruthy();
  const xml = z[sheet].toString('utf8');
  const cells: Record<string, string> = {};
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /\br="([A-Z]+\d+)"/.exec(m[1])?.[1];
    if (!ref) continue;
    const t = /\bt="([^"]+)"/.exec(m[1])?.[1];
    const inner = m[2] ?? '';
    let v = '';
    if (t === 'inlineStr') v = unxml([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
    else {
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      v = t === 's' ? ss[parseInt(raw)] ?? '' : unxml(raw);
    }
    cells[ref] = v;
  }
  return cells;
}

/** ข้อความ PDF: raw + stream ที่คลายแล้ว · literals = สตริงในวงเล็บ (ไว้ตรวจข้อมูลส่วนบุคคล) */
function pdfParts(buf: Buffer): { all: string; literals: string } {
  let all = buf.toString('latin1');
  for (const m of all.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      all += '\n' + zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      /* ไม่ใช่ Flate */
    }
  }
  const literals = [...all.matchAll(/\(((?:\\.|[^\\()])*)\)/g)].map((m) => m[1]).join('\n');
  return { all, literals };
}

/* ── Audit UI ── */
async function auditRows(p: Page) {
  return p.getByTestId('audit-row').evaluateAll((els) =>
    els.map((e) => {
      const q = (id: string) => e.querySelector(`[data-testid=${id}]`);
      return {
        id: e.getAttribute('data-id') ?? '',
        event: e.getAttribute('data-event') ?? '',
        actor: e.getAttribute('data-actor') ?? '',
        caseNo: e.getAttribute('data-case-no') ?? '',
        role: (q('audit-role')?.textContent ?? '').trim(),
        time: q('audit-time')?.getAttribute('data-iso') ?? '',
        tr: (q('audit-transition')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        detail: (q('audit-detail')?.textContent ?? '').trim(),
      };
    }),
  );
}
async function auditFilter(p: Page, f: { actor?: string; event?: string; from?: string; to?: string } = {}) {
  await tid(p, 'audit-filter-actor').fill(f.actor ?? '');
  await tid(p, 'audit-filter-event').selectOption(f.event ?? '');
  await tid(p, 'audit-filter-from').fill(f.from ?? '');
  await tid(p, 'audit-filter-to').fill(f.to ?? '');
  await tid(p, 'audit-apply-btn').click();
}

/* ═════════════════════════ SLA ═════════════════════════ */

test('TC-SLA-01 กำหนดเสร็จตามตารางวันที่ (แถว a–i)', async ({ h }) => {
  type Row = { k: string; svc: 'SV-01' | 'SV-02' | 'SV-03'; qty?: number; at: string; due: string; text?: string };
  const rows: Row[] = [
    { k: 'a', svc: 'SV-01', qty: 3, at: '2026-12-01T09:00:00+07:00', due: '2026-12-04T16:30:00+07:00', text: '4 ธ.ค. 2569 16:30' },
    { k: 'b', svc: 'SV-01', at: '2026-12-01T16:29:00+07:00', due: '2026-12-04T16:30:00+07:00' },
    { k: 'c', svc: 'SV-01', at: '2026-12-01T16:30:00+07:00', due: '2026-12-08T16:30:00+07:00', text: '8 ธ.ค. 2569 16:30' },
    { k: 'd', svc: 'SV-01', at: '2026-12-04T10:00:00+07:00', due: '2026-12-11T16:30:00+07:00', text: '11 ธ.ค. 2569 16:30' },
    { k: 'e', svc: 'SV-01', at: '2026-12-05T10:00:00+07:00', due: '2026-12-14T16:30:00+07:00', text: '14 ธ.ค. 2569 16:30' },
    { k: 'f', svc: 'SV-02', at: '2026-12-01T09:00:00+07:00', due: '2026-12-17T16:30:00+07:00' },
    { k: 'g', svc: 'SV-03', at: '2026-12-01T09:00:00+07:00', due: '2026-12-24T16:30:00+07:00' },
    { k: 'h', svc: 'SV-01', at: '2026-12-29T10:00:00+07:00', due: '2027-01-05T16:30:00+07:00', text: '5 ม.ค. 2570 16:30' },
    { k: 'i', svc: 'SV-01', at: '2026-12-31T23:59:00+07:00', due: '2027-01-07T16:30:00+07:00', text: '7 ม.ค. 2570 16:30' },
  ];
  for (const r of rows) {
    await h.reset();
    const { caseNo } = await h.newPaid({ svc: r.svc, qty: r.qty, at: r.at, area: 100 });
    expect(caseNo, `แถว ${r.k}`).toBe(C(31));
    const j = await h.caseJson('somchai', caseNo);
    expect(j.dueAt, `แถว ${r.k} dueAt`).toBe(r.due);
    const p = await h.page('somchai');
    await p.goto(`/citizen/cases/${caseNo}`);
    await expect(tid(p, 'sla-due'), `แถว ${r.k} sla-due`).toHaveAttribute('data-iso', r.due);
    if (r.text) await expect(tid(p, 'sla-due')).toHaveText(r.text);
    await p.close();
  }
});

test('TC-SLA-02 หยุดนับ SLA ระหว่างรอแก้ไข (ส่วน 1–5)', async ({ h }) => {
  /* ส่วน 1 */
  await h.reset();
  let { caseNo } = await h.newPaid({ at: T0 });
  expect(caseNo).toBe(C(31));
  expect((await h.caseJson('somchai', caseNo)).dueAt).toBe('2026-12-04T16:30:00+07:00');
  await h.clock('2026-12-02T11:00:00+07:00');
  await ok(await h.claim('off.reg1', caseNo));
  await ok(await h.ret('off.reg1', caseNo));
  let p = await h.page('somchai');
  await p.goto(`/citizen/cases/${caseNo}`);
  await expectStatus(p, 'รอแก้ไขเอกสาร');
  await expect(tid(p, 'sla-level')).toHaveText('หยุดนับ');
  await expect(tid(p, 'sla-level')).toHaveAttribute('data-level', 'paused');
  await expect(tid(p, 'fix-deadline')).toHaveAttribute('data-iso', '2026-12-09T11:00:00+07:00');
  await h.clock('2026-12-03T10:00:00+07:00');
  await p.reload();
  await tid(p, 'submit-fix-btn').click();
  await expectStatus(p, 'กำลังตรวจสอบ', 'IN_REVIEW');
  await expect(tid(p, 'sla-due')).toHaveAttribute('data-iso', '2026-12-08T16:30:00+07:00');
  await expect(tid(p, 'sla-due')).toHaveText('8 ธ.ค. 2569 16:30');
  await expect(tid(p, 'sla-level')).toHaveText(NORMAL);
  let j = await h.caseJson('off.reg1', caseNo);
  expect(j.dueAt).toBe('2026-12-08T16:30:00+07:00');
  expect(j.owner).toBe('off.reg1');
  const op = await h.page('off.reg1');
  await op.goto(`/officer/cases/${caseNo}`);
  await expect(tid(op, 'case-owner')).toHaveText('off.reg1');

  /* ส่วน 2 : seed …000017 ส่งแก้ 1 ธ.ค. 09:00 */
  await h.reset();
  p = await h.page('somchai');
  await p.goto(`/citizen/cases/${C(17)}`);
  await expect(tid(p, 'sla-level')).toHaveText('หยุดนับ');
  await expect(tid(p, 'sla-due')).toHaveAttribute('data-iso', '2026-11-27T16:30:00+07:00');
  await tid(p, 'submit-fix-btn').click();
  await expectStatus(p, 'กำลังตรวจสอบ');
  await expect(tid(p, 'sla-due')).toHaveAttribute('data-iso', '2026-12-01T16:30:00+07:00');
  await expect(tid(p, 'sla-level')).toHaveText(NEAR);
  j = await h.caseJson('off.reg1', C(17));
  expect(j.dueAt).toBe('2026-12-01T16:30:00+07:00');
  expect(j.owner).toBe('off.reg1');

  /* ส่วน 3 : ส่งแก้ 4 ธ.ค. 10:00 → หยุดนับ 5 วัน */
  await h.reset();
  await h.clock('2026-12-04T10:00:00+07:00');
  const r3 = await ok(await h.resubmit('somchai', C(17)));
  expect(r3.status).toBe('IN_REVIEW');
  expect(r3.dueAt).toBe('2026-12-04T16:30:00+07:00');
  j = await h.caseJson('somchai', C(17));
  expect(j.dueAt).toBe('2026-12-04T16:30:00+07:00');
  expect(j.slaLevel).toBe('near');

  /* ส่วน 4 : ตีกลับและส่งแก้วันเดียวกัน → หยุด 0 วัน */
  await h.reset();
  ({ caseNo } = await h.newPaid({ at: T0 }));
  await h.clock('2026-12-02T09:00:00+07:00');
  await ok(await h.claim('off.reg1', caseNo));
  await ok(await h.ret('off.reg1', caseNo));
  await h.clock('2026-12-02T15:00:00+07:00');
  const r4 = await ok(await h.resubmit('somchai', caseNo));
  expect(r4.dueAt).toBe('2026-12-04T16:30:00+07:00');
  expect((await h.caseJson('somchai', caseNo)).dueAt).toBe('2026-12-04T16:30:00+07:00');

  /* ส่วน 5 : คร่อมสุดสัปดาห์/วันหยุด ส่งแก้หลัง 16:30 */
  await h.reset();
  ({ caseNo } = await h.newPaid({ at: T0 }));
  await h.clock('2026-12-04T10:00:00+07:00');
  await ok(await h.claim('off.reg1', caseNo));
  await ok(await h.ret('off.reg1', caseNo));
  await h.clock('2026-12-08T17:00:00+07:00');
  const r5 = await ok(await h.resubmit('somchai', caseNo));
  expect(r5.dueAt).toBe('2026-12-08T16:30:00+07:00');
  j = await h.caseJson('somchai', caseNo);
  expect(j.dueAt).toBe('2026-12-08T16:30:00+07:00');
  expect(j.slaLevel).toBe('overdue');
  p = await h.page('somchai');
  await p.goto(`/citizen/cases/${caseNo}`);
  await expect(tid(p, 'sla-level')).toHaveText(OVERDUE);
});

test('TC-SLA-03 ระดับเตือน ปกติ/ใกล้/เกิน (ส่วน A B C)', async ({ h }) => {
  /* ส่วน A */
  await h.reset();
  const { caseNo } = await h.newPaid({ at: T0 });
  expect(caseNo).toBe(C(31));
  const A: Array<[string, string, string]> = [
    ['2026-12-01T09:00:00+07:00', NORMAL, 'normal'],
    ['2026-12-02T09:00:00+07:00', NORMAL, 'normal'],
    ['2026-12-03T09:00:00+07:00', NEAR, 'near'],
    ['2026-12-04T16:30:00+07:00', NEAR, 'near'],
    ['2026-12-04T16:30:01+07:00', OVERDUE, 'overdue'],
    ['2026-12-04T16:31:00+07:00', OVERDUE, 'overdue'],
    ['2026-12-05T10:00:00+07:00', OVERDUE, 'overdue'],
  ];
  const p = await h.page('somchai');
  for (const [at, text, level] of A) {
    await h.clock(at);
    expect((await h.caseJson('somchai', caseNo)).slaLevel, at).toBe(level);
    await p.goto(`/citizen/cases/${caseNo}`);
    await expect(tid(p, 'sla-level'), at).toHaveText(text);
    await expect(tid(p, 'sla-level'), at).toHaveAttribute('data-level', level);
  }

  /* ส่วน B : seed …000016 กำหนด 8 ธ.ค. */
  await h.reset();
  const B: Array<[string, string, string]> = [
    ['2026-12-03T09:00:00+07:00', NORMAL, 'normal'],
    ['2026-12-04T09:00:00+07:00', NEAR, 'near'],
    ['2026-12-08T16:30:00+07:00', NEAR, 'near'],
    ['2026-12-08T16:31:00+07:00', OVERDUE, 'overdue'],
  ];
  const op = await h.page('off.reg2');
  for (const [at, text, level] of B) {
    await h.clock(at);
    expect((await h.caseJson('off.reg2', C(16))).slaLevel, at).toBe(level);
    await op.goto(`/officer/cases/${C(16)}`);
    await expect(tid(op, 'sla-level'), at).toHaveText(text);
    await expect(tid(op, 'sla-level'), at).toHaveAttribute('data-level', level);
  }

  /* ส่วน C : seed ที่ 09:00 */
  await h.reset();
  const q = await h.page('off.reg1');
  await q.goto('/officer/queue');
  const C_: Array<[number, string, string]> = [
    [20, OVERDUE, 'overdue'],
    [22, NEAR, 'near'],
    [24, NEAR, 'near'],
    [25, NORMAL, 'normal'],
  ];
  for (const [n, text, level] of C_) {
    const row = q.locator(`[data-testid=queue-row][data-case-no="${C(n)}"]`);
    await expect(row.getByTestId('row-sla-level')).toHaveText(text);
    await expect(row).toHaveAttribute('data-sla-level', level);
  }
  const sp = await h.page('somchai');
  await sp.goto(`/citizen/cases/${C(17)}`);
  await expect(tid(sp, 'sla-level')).toHaveText('หยุดนับ');
  const yp = await h.page('somying');
  await yp.goto(`/citizen/cases/${C(1)}`);
  await expect(tid(yp, 'sla-level')).toHaveText('ปิดแล้ว');
  await h.clock('2026-12-01T16:30:00+07:00');
  expect((await h.caseJson('off.reg1', C(22))).slaLevel).toBe('near');
  await q.goto('/officer/queue');
  await expect(q.locator(`[data-testid=queue-row][data-case-no="${C(22)}"]`).getByTestId('row-sla-level')).toHaveText(NEAR);
  await h.clock('2026-12-01T16:31:00+07:00');
  expect((await h.caseJson('off.reg1', C(22))).slaLevel).toBe('overdue');
  await q.goto('/officer/queue');
  await expect(q.locator(`[data-testid=queue-row][data-case-no="${C(22)}"]`).getByTestId('row-sla-level')).toHaveText(OVERDUE);
});

/* ═════════════════════════ NOTI ═════════════════════════ */

const nk = (items: Array<{ caseNo: string; level: string }>) => items.map((i) => `${i.caseNo}:${i.level}`).sort();
const ex = (list: Array<[number, 'near' | 'overdue']>) => list.map(([n, l]) => `${C(n)}:${l}`).sort();

async function notiUi(h: H, who: string) {
  const p = await h.page(who);
  await p.goto('/notifications');
  return p;
}
async function notiUiKeys(p: Page) {
  return (
    await p.getByTestId('noti-item').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-case-no')}:${e.getAttribute('data-level')}`))
  ).sort();
}

async function runNoti01(h: H) {
  await h.reset();
  await h.api('off.reg1'); // request แรกที่ 09:00 กระตุ้นการประเมิน
  const expected: Record<string, ReturnType<typeof ex>> = {
    'off.reg1': ex([[24, 'near'], [22, 'near'], [20, 'overdue']]),
    'off.reg2': ex([[24, 'near']]),
    head1: ex([[20, 'overdue']]),
    'off.works1': [],
  };
  for (const [who, want] of Object.entries(expected)) {
    expect(nk(await h.notis(who)), who).toEqual(want);
    const p = await notiUi(h, who);
    if (want.length === 0) await expect(tid(p, 'noti-empty')).toHaveText('ไม่มีแจ้งเตือน');
    await expect(tid(p, 'noti-item')).toHaveCount(want.length);
    expect(await notiUiKeys(p), who).toEqual(want);
    await expect(tid(p, 'bell-count')).toHaveText(String(want.length));
    await p.close();
  }
}

test('TC-NOTI-01 ผู้รับแจ้งเตือนตามระดับ', async ({ h }) => {
  await runNoti01(h);
  const p = await notiUi(h, 'off.reg1');
  await expect(p.locator('[data-testid=noti-item][data-case-no="EG-2569-000024"]')).toContainText('คำขอ EG-2569-000024 ใกล้ครบกำหนด');
  await expect(p.locator('[data-testid=noti-item][data-case-no="EG-2569-000020"]')).toContainText('คำขอ EG-2569-000020 เกินกำหนด');
  /* 000024 (near) ไม่แจ้ง off.works1 / head1 */
  expect(nk(await h.notis('head1')).some((k) => k.startsWith(C(24)))).toBe(false);
  expect(nk(await h.notis('off.works1'))).toEqual([]);

  /* ต่อ: 16:31 */
  await h.clock('2026-12-01T16:31:00+07:00');
  expect(nk(await h.notis('off.reg1'))).toEqual(ex([[24, 'near'], [22, 'near'], [22, 'overdue'], [20, 'overdue']]));
  expect(nk(await h.notis('head1'))).toEqual(ex([[20, 'overdue'], [22, 'overdue']]));
  expect(nk(await h.notis('off.reg2'))).toEqual(ex([[24, 'near']]));
  const p1 = await notiUi(h, 'off.reg1');
  await expect(tid(p1, 'bell-count')).toHaveText('4');
  const p2 = await notiUi(h, 'head1');
  await expect(tid(p2, 'bell-count')).toHaveText('2');
});

test('TC-NOTI-02 ไม่แจ้งซ้ำ ข้ามระดับ และขั้นรออนุมัติ/รอออกเอกสาร', async ({ h }) => {
  /* ส่วน A */
  await runNoti01(h);
  await h.clock('2026-12-01T16:31:00+07:00');
  expect((await h.notis('off.reg1')).length).toBe(4);
  expect((await h.notis('head1')).length).toBe(2);
  for (let i = 0; i < 3; i++) {
    for (const who of ['off.reg1', 'head1']) {
      const p = await notiUi(h, who);
      await p.close();
      await h.notis(who);
    }
  }
  const q = await h.page('off.reg1');
  await q.goto('/officer/queue');
  await q.goto('/officer/queue');
  const n1 = await notiUi(h, 'off.reg1');
  await expect(tid(n1, 'bell-count')).toHaveText('4');
  const n2 = await notiUi(h, 'head1');
  await expect(tid(n2, 'bell-count')).toHaveText('2');
  expect((await h.notis('off.reg1')).length).toBe(4);
  expect((await h.notis('head1')).length).toBe(2);

  /* ส่วน B : ข้ามระดับ ที่ ส. 5 ธ.ค. 10:00 */
  await h.reset();
  await h.clock('2026-12-05T10:00:00+07:00');
  await h.api('off.reg1');
  const ov = (xs: number[]) => xs.map((n) => [n, 'overdue'] as [number, 'overdue']);
  const want: Record<string, string[]> = {
    'off.reg1': ex(ov([20, 22, 23, 24, 28, 29, 30])),
    'off.reg2': ex([...ov([13, 15, 24, 25, 26, 27, 28, 29, 30]), [16, 'near']]),
    'off.works1': ex(ov([10])),
    head1: ex([...ov([10, 13, 14, 15, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30]), [11, 'near']]),
  };
  const counts: Record<string, string> = { 'off.reg1': '7', 'off.reg2': '10', 'off.works1': '1', head1: '15' };
  for (const [who, w] of Object.entries(want)) {
    expect(nk(await h.notis(who)), who).toEqual(w);
    const p = await notiUi(h, who);
    await expect(tid(p, 'bell-count')).toHaveText(counts[who]);
    expect(await notiUiKeys(p), who).toEqual(w);
    await p.close();
  }
  for (const who of ['off.reg1', 'off.reg2', 'head1']) {
    const mine = (await h.notis(who)).filter((i) => i.caseNo === C(24));
    expect(mine.map((i) => i.level), `${who} 000024`).toEqual(['overdue']);
  }

  /* ส่วน C : ขั้นรออนุมัติและรอออกเอกสาร */
  const of = async (who: string, n: number) => nk((await h.notis(who)).filter((i) => i.caseNo === C(n)));
  await h.reset();
  await h.clock('2026-12-04T09:00:00+07:00');
  await h.api('head1');
  await h.api('off.reg1');
  await h.api('off.reg2');
  expect(await of('head1', 14)).toEqual(ex([[14, 'near']]));
  expect(await of('off.reg1', 14)).toEqual([]);
  expect(await of('off.reg2', 14)).toEqual([]);
  await h.clock('2026-12-04T16:31:00+07:00');
  expect(await of('head1', 14)).toEqual(ex([[14, 'near'], [14, 'overdue']]));
  expect(await of('off.reg1', 14)).toEqual([]);
  expect(await of('off.reg2', 14)).toEqual([]);
  await h.clock('2026-12-08T09:00:00+07:00');
  expect(await of('off.reg1', 19)).toEqual(ex([[19, 'near']]));
  expect(await of('off.reg2', 19)).toEqual([]);
  expect(await of('head1', 19)).toEqual([]);
  await h.clock('2026-12-09T16:31:00+07:00');
  expect(await of('off.reg1', 19)).toEqual(ex([[19, 'near'], [19, 'overdue']]));
  expect(await of('head1', 19)).toEqual(ex([[19, 'overdue']]));
  expect(await of('off.reg2', 19)).toEqual([]);
});

/* ═════════════════════════ WORKFLOW ═════════════════════════ */

test('TC-WORKFLOW-01 SV-01 อนุมัติ + ออกเอกสาร', async ({ h }) => {
  await h.reset();
  const p = await h.page('off.reg2');
  await p.goto(`/officer/cases/${C(25)}`);
  await expectStatus(p, 'กำลังตรวจสอบ', 'IN_REVIEW');
  await expect(tid(p, 'approve-btn')).toHaveCount(1);
  await expect(tid(p, 'return-btn')).toHaveCount(1);
  await expect(tid(p, 'reject-btn')).toHaveCount(1);
  await expect(tid(p, 'forward-btn')).toHaveCount(0);
  await expect(tid(p, 'issue-btn')).toHaveCount(0);
  await expect(tid(p, 'case-fee')).toHaveText('฿60');

  const r2 = await h.approve('off.reg1', C(26)); // ผู้ถือคือ off.reg2
  expect(r2.status()).toBe(403);
  expect((await r2.json()).code).toBe('FORBIDDEN');

  await tid(p, 'approve-btn').click();
  await expectStatus(p, 'อนุมัติ', 'APPROVED');
  await expect(tid(p, 'issue-btn')).toHaveCount(1);
  await expect(tid(p, 'approve-btn')).toHaveCount(0);

  await tid(p, 'issue-btn').click();
  await expectStatus(p, 'เสร็จสิ้น', 'COMPLETED');
  await expect(tid(p, 'doc-no')).toHaveText('DOC-2569-000002');
  await expect(tid(p, 'verify-code')).toHaveText(/^[A-Z0-9]{8}$/);
  await expect(tid(p, 'closed-at')).toHaveAttribute('data-iso', T0);
  await expect(tid(p, 'sla-level')).toHaveText('ปิดแล้ว');

  const c = await h.page('somying');
  await c.goto(`/citizen/cases/${C(25)}`);
  await expectStatus(c, 'เสร็จสิ้น');
  await expect(tid(c, 'download-doc-btn')).toHaveCount(1);
  const d = await download(c, 'download-doc-btn');
  expect(d.name).toBe('DOC-2569-000002.pdf');
  expect(d.buf.toString('latin1')).toContain('docNo=DOC-2569-000002 caseNo=EG-2569-000025');
  const api = await h.get('somying', '/api/documents/DOC-2569-000002/pdf');
  expect(api.status()).toBe(200);
  expect(api.headers()['content-type']).toContain('application/pdf');
  expect(api.headers()['content-disposition']).toContain('DOC-2569-000002.pdf');
  expect((await api.body()).toString('latin1')).toContain('docNo=DOC-2569-000002 caseNo=EG-2569-000025');

  const dj = await h.dash('2026-12', 'ALL');
  expect(dj.closed).toBe(1);
  expect(dj.onTime).toBe(1);
  expect(dj.received).toBe(3);
  expect(dj.backlog).toBe(20);
});

async function verifySigner(h: H, code: string, signer = 'หัวหน้าฝ่าย') {
  const v = await h.anonPage();
  const resp = await v.goto(`/verify/${code}`);
  expect(resp!.status()).toBe(200);
  await expect(tid(v, 'verify-signer')).toHaveText(signer);
  await v.close();
}

test('TC-WORKFLOW-02 SV-02 ผ่านหัวหน้า', async ({ h }) => {
  await h.reset();
  const p = await h.page('off.reg2');
  await p.goto(`/officer/cases/${C(13)}`);
  await expect(tid(p, 'approve-btn')).toHaveCount(0);
  await expect(tid(p, 'forward-btn')).toHaveCount(1);
  await expect(tid(p, 'forward-target')).toHaveCount(0);
  await tid(p, 'forward-btn').click();
  await expectStatus(p, 'รออนุมัติ', 'PENDING_APPROVAL');
  await p.goto('/officer/queue');
  await expect(tid(p, 'workload-count')).toHaveText('8');
  await expect(p.locator(`[data-testid=queue-row][data-case-no="${C(13)}"]`)).toHaveCount(0);

  const hp = await h.page('head1');
  await hp.goto('/head/approvals');
  await expect(tid(hp, 'approval-row')).toHaveCount(3);
  expect(await attrList(hp, 'approval-row', 'data-case-no')).toEqual([C(13), C(14), C(11)]);
  await hp.locator(`[data-testid=approval-row][data-case-no="${C(13)}"]`).getByTestId('approval-open').click();
  await expect(hp).toHaveURL(new RegExp(`/officer/cases/${C(13)}$`));
  await expect(tid(hp, 'approve-btn')).toHaveCount(1);
  await expect(tid(hp, 'reject-btn')).toHaveCount(1);
  await expect(tid(hp, 'issue-btn')).toHaveCount(0);
  await tid(hp, 'approve-btn').click();
  await expectStatus(hp, 'อนุมัติ', 'APPROVED');
  await expect(tid(hp, 'issue-btn')).toHaveCount(0);

  const r1 = await h.page('off.reg1');
  await r1.goto(`/officer/cases/${C(13)}`);
  await expect(tid(r1, 'issue-btn')).toHaveCount(0);
  const bad = await h.issue('off.reg1', C(13));
  expect(bad.status()).toBe(403);
  expect((await bad.json()).code).toBe('FORBIDDEN');

  await p.goto(`/officer/cases/${C(13)}`);
  await tid(p, 'issue-btn').click();
  await expectStatus(p, 'เสร็จสิ้น', 'COMPLETED');
  await expect(tid(p, 'doc-no')).toHaveText('DOC-2569-000002');
  await verifySigner(h, (await tid(p, 'verify-code').innerText()).trim());

  /* ข้อ 8 : seed …000019 APPROVED */
  await h.reset();
  const q = await h.page('off.reg1');
  await q.goto(`/officer/cases/${C(19)}`);
  await tid(q, 'issue-btn').click();
  await expectStatus(q, 'เสร็จสิ้น', 'COMPLETED');
  await expect(tid(q, 'doc-no')).toHaveText('DOC-2569-000002');
  await verifySigner(h, (await tid(q, 'verify-code').innerText()).trim());
});

test('TC-WORKFLOW-03 SV-03 สามขั้นตอน', async ({ h }) => {
  await h.reset();
  const p = await h.page('off.reg2');
  await p.goto(`/officer/cases/${C(12)}`);
  await expect(tid(p, 'case-step')).toHaveText('ขั้นตอน 1/3 · ฝ่ายทะเบียน');
  await expect(tid(p, 'case-fee')).toHaveText('฿1,010');
  await expect(tid(p, 'forward-btn')).toHaveCount(1);
  await tid(p, 'forward-btn').click();
  await expectStatus(p, 'กำลังตรวจสอบ', 'IN_REVIEW');
  await expect(tid(p, 'case-step')).toHaveText('ขั้นตอน 2/3 · ฝ่ายโยธา');
  await expect(tid(p, 'case-owner')).toHaveText('ยังไม่มีผู้รับ');
  await p.goto('/officer/queue');
  await expect(tid(p, 'workload-count')).toHaveText('8');
  await expect(tid(p, 'queue-row')).toHaveCount(16);
  await expect(p.locator(`[data-testid=queue-row][data-case-no="${C(12)}"]`)).toHaveCount(0);

  const w = await h.page('off.works1');
  await w.goto('/officer/queue');
  await expect(tid(w, 'queue-row')).toHaveCount(2);
  expect(await attrList(w, 'queue-row', 'data-case-no')).toEqual([C(10), C(12)]);
  await expect(tid(w, 'claim-btn')).toHaveCount(2);

  const x = await h.claim('off.reg1', C(12));
  expect(x.status()).toBe(403);
  expect((await x.json()).code).toBe('FORBIDDEN');

  await w.locator(`[data-testid=queue-row][data-case-no="${C(12)}"]`).getByTestId('claim-btn').click();
  await w.goto(`/officer/cases/${C(12)}`);
  await expect(tid(w, 'case-owner')).toHaveText('off.works1');
  await tid(w, 'forward-btn').click();
  await expectStatus(w, 'รออนุมัติ', 'PENDING_APPROVAL');
  await expect(tid(w, 'case-step')).toHaveText('ขั้นตอน 3/3 · หัวหน้าฝ่าย');

  const hp = await h.page('head1');
  await hp.goto('/head/approvals');
  await expect(tid(hp, 'approval-row')).toHaveCount(3);
  await expect(hp.locator(`[data-testid=approval-row][data-case-no="${C(12)}"]`)).toHaveCount(1);
  await hp.goto(`/officer/cases/${C(12)}`);
  await tid(hp, 'approve-btn').click();
  await expectStatus(hp, 'อนุมัติ', 'APPROVED');

  await w.goto(`/officer/cases/${C(12)}`);
  await expect(tid(w, 'issue-btn')).toHaveCount(0);
  await p.goto(`/officer/cases/${C(12)}`);
  await expect(tid(p, 'issue-btn')).toHaveCount(1);
  await tid(p, 'issue-btn').click();
  await expectStatus(p, 'เสร็จสิ้น', 'COMPLETED');
  await verifySigner(h, (await tid(p, 'verify-code').innerText()).trim());
});

test('TC-WORKFLOW-04 ตีกลับสูงสุด 2 ครั้ง และผลหลังครบ', async ({ h }) => {
  /* ส่วน A : SV-01 …000020 */
  await h.reset();
  let j = await ok(await h.ret('off.reg1', C(20)));
  expect(j.status).toBe('NEED_FIX');
  expect(j.returnCount).toBe(1);
  let p = await h.page('off.reg1');
  await p.goto(`/officer/cases/${C(20)}`);
  await expectStatus(p, 'รอแก้ไขเอกสาร', 'NEED_FIX');
  await expect(tid(p, 'return-count')).toHaveText('1');
  j = await ok(await h.resubmit('somchai', C(20)));
  expect(j.status).toBe('IN_REVIEW');
  expect((await h.caseJson('off.reg1', C(20))).owner).toBe('off.reg1');
  j = await ok(await h.ret('off.reg1', C(20)));
  expect(j.returnCount).toBe(2);
  await p.reload();
  await expect(tid(p, 'return-count')).toHaveText('2');
  await ok(await h.resubmit('somchai', C(20)));
  await p.reload();
  await expectStatus(p, 'กำลังตรวจสอบ');
  await expect(tid(p, 'return-btn')).toHaveCount(0);
  const lim = await h.ret('off.reg1', C(20));
  expect(lim.status()).toBe(409);
  const lj = await lim.json();
  expect(lj.code).toBe('RETURN_LIMIT');
  expect(lj.message).toBe('ตีกลับได้สูงสุด 2 ครั้ง');
  j = await h.caseJson('off.reg1', C(20));
  expect(j.status).toBe('IN_REVIEW');
  expect(j.returnCount).toBe(2);
  await expect(tid(p, 'approve-btn')).toHaveCount(1);
  await expect(tid(p, 'reject-btn')).toHaveCount(1);

  /* ส่วน B : seed …000023 */
  await h.reset();
  p = await h.page('off.reg1');
  await p.goto(`/officer/cases/${C(23)}`);
  await expect(tid(p, 'return-count')).toHaveText('2');
  await expect(tid(p, 'return-btn')).toHaveCount(0);
  const lb = await h.ret('off.reg1', C(23));
  expect(lb.status()).toBe(409);
  expect((await lb.json()).code).toBe('RETURN_LIMIT');
  expect((await h.caseJson('off.reg1', C(23))).status).toBe('IN_REVIEW');
  await expect(tid(p, 'approve-btn')).toHaveCount(1);
  await expect(tid(p, 'reject-btn')).toHaveCount(1);

  /* ส่วน C : SV-02 …000013 หลังตีกลับครบ 2 ครั้ง */
  await h.reset();
  await ok(await h.ret('off.reg2', C(13)));
  await ok(await h.resubmit('somchai', C(13)));
  await ok(await h.ret('off.reg2', C(13)));
  await ok(await h.resubmit('somchai', C(13)));
  p = await h.page('off.reg2');
  await p.goto(`/officer/cases/${C(13)}`);
  await expectStatus(p, 'กำลังตรวจสอบ');
  await expect(tid(p, 'return-btn')).toHaveCount(0);
  await expect(tid(p, 'approve-btn')).toHaveCount(0);
  await expect(tid(p, 'reject-btn')).toHaveCount(0);
  await expect(tid(p, 'forward-btn')).toHaveCount(1);
  expect((await h.reject('off.reg2', C(13))).status()).toBe(403);
  await tid(p, 'forward-note').fill('ส่งต่อให้หัวหน้าพิจารณา');
  await tid(p, 'forward-btn').click();
  await expectStatus(p, 'รออนุมัติ', 'PENDING_APPROVAL');
  const a = await h.page('audit1');
  await a.goto('/audit');
  await auditFilter(a, { event: 'FORWARD' });
  await expect(tid(a, 'audit-row').first()).toBeVisible();
  const rows = (await auditRows(a)).filter((r) => r.caseNo === C(13));
  expect(rows.length).toBe(1);
  expect(rows[0].detail).toContain('ส่งต่อให้หัวหน้าพิจารณา');
  const hp = await h.page('head1');
  await hp.goto(`/officer/cases/${C(13)}`);
  await expect(tid(hp, 'reject-btn')).toHaveCount(1);
  await expect(tid(hp, 'approve-btn')).toHaveCount(1);
});

test('TC-WORKFLOW-05 เหตุผล ≥ 10 ตัวอักษร (ตีกลับ/ไม่อนุมัติ)', async ({ h }) => {
  const ERR = 'กรุณากรอกเหตุผลอย่างน้อย 10 ตัวอักษร';
  /* ส่วน A */
  await h.reset();
  const p = await h.page('off.reg1');
  await p.goto(`/officer/cases/${C(20)}`);
  await submitReason(p, 'return-btn', 'return-reason', 'return-submit', 'xxxxxxxxx');
  await expect(tid(p, 'return-reason-error')).toHaveText(ERR);
  const r9 = await h.ret('off.reg1', C(20), 'xxxxxxxxx');
  expect(r9.status()).toBe(400);
  expect((await r9.json()).code).toBe('REASON_TOO_SHORT');
  expect((await h.caseJson('off.reg1', C(20))).status).toBe('IN_REVIEW');
  await expectStatus(p, 'กำลังตรวจสอบ');
  await tid(p, 'return-reason').fill(' '.repeat(10));
  await tid(p, 'return-submit').click();
  await expect(tid(p, 'return-reason-error')).toHaveText(ERR);
  expect((await h.ret('off.reg1', C(20), ' '.repeat(10))).status()).toBe(400);
  await tid(p, 'return-reason').fill('xxxxxxxxxx');
  await tid(p, 'return-submit').click();
  await expectStatus(p, 'รอแก้ไขเอกสาร', 'NEED_FIX');
  const s = await h.page('somchai');
  await s.goto(`/citizen/cases/${C(20)}`);
  await expect(tid(s, 'return-reason-display')).toHaveText('xxxxxxxxxx');

  /* ส่วน B : ไม่อนุมัติ SV-01 …000026 */
  await h.reset();
  const b = await h.page('off.reg2');
  await b.goto(`/officer/cases/${C(26)}`);
  await submitReason(b, 'reject-btn', 'reject-reason', 'reject-submit', 'xxxxxxxxx');
  await expect(tid(b, 'reject-reason-error')).toHaveText(ERR);
  const rb = await h.reject('off.reg2', C(26), 'xxxxxxxxx');
  expect(rb.status()).toBe(400);
  expect((await rb.json()).code).toBe('REASON_TOO_SHORT');
  await tid(b, 'reject-reason').fill('xxxxxxxxxx');
  await tid(b, 'reject-submit').click();
  await expectStatus(b, 'ไม่อนุมัติ', 'REJECTED');
  await expect(tid(b, 'closed-at')).toHaveAttribute('data-iso', T0);
  await expect(tid(b, 'sla-level')).toHaveText('ปิดแล้ว');
  const sb = await h.page('somchai');
  await sb.goto(`/citizen/cases/${C(26)}`);
  await expect(tid(sb, 'no-refund-note')).toHaveText('ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
  const dj = await h.dash('2026-12', 'ALL');
  expect(dj.closed).toBe(1);
  expect(dj.onTime).toBe(1);

  /* ส่วน C : หัวหน้าไม่อนุมัติ …000011 */
  await h.reset();
  const c = await h.page('head1');
  await c.goto(`/officer/cases/${C(11)}`);
  await submitReason(c, 'reject-btn', 'reject-reason', 'reject-submit', 'xxxxxxxxx');
  await expect(tid(c, 'reject-reason-error')).toHaveText(ERR);
  const rc = await h.reject('head1', C(11), 'xxxxxxxxx');
  expect(rc.status()).toBe(400);
  await tid(c, 'reject-reason').fill('xxxxxxxxxx');
  await tid(c, 'reject-submit').click();
  await expectStatus(c, 'ไม่อนุมัติ', 'REJECTED');
  expect((await h.caseJson('head1', C(11))).status).toBe('REJECTED');
});

test('TC-WORKFLOW-06 เวลาแก้ไข 168 ชั่วโมง', async ({ h }) => {
  /* ตรวจหน้าตั้งต้น */
  await h.reset();
  let p = await h.page('somchai');
  await p.goto(`/citizen/cases/${C(17)}`);
  await expectStatus(p, 'รอแก้ไขเอกสาร', 'NEED_FIX');
  await expect(tid(p, 'return-reason-display')).toHaveText('ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข');
  await expect(tid(p, 'fix-deadline')).toHaveText('4 ธ.ค. 2569 14:00');
  await expect(tid(p, 'fix-deadline')).toHaveAttribute('data-iso', '2026-12-04T14:00:00+07:00');
  await expect(tid(p, 'submit-fix-btn')).toHaveCount(1);

  /* รอบ A : 167:59 */
  await h.reset();
  await h.clock('2026-12-04T13:59:00+07:00');
  p = await h.page('somchai');
  await p.goto(`/citizen/cases/${C(17)}`);
  await expect(tid(p, 'submit-fix-btn')).toBeEnabled();
  await tid(p, 'submit-fix-btn').click();
  await expectStatus(p, 'กำลังตรวจสอบ', 'IN_REVIEW');

  /* รอบ B : 168:00 พอดี */
  await h.reset();
  await h.clock('2026-12-04T14:00:00+07:00');
  p = await h.page('somchai');
  await p.goto(`/citizen/cases/${C(17)}`);
  await expectStatus(p, 'ยกเลิก', 'CANCELLED');
  await expect(tid(p, 'submit-fix-btn')).toHaveCount(0);
  await expect(tid(p, 'no-refund-note')).toBeVisible();
  const r = await h.resubmit('somchai', C(17));
  expect(r.status()).toBe(409);
  const iso = await attrList(p, 'timeline-item', 'data-iso');
  expect(iso).toContain('2026-12-04T14:00:00+07:00');
  const dj = await h.dash('2026-12', 'ALL');
  expect(dj.backlog).toBe(20);
});

/* ═════════════════════════ DOC ═════════════════════════ */

test('TC-DOC-01 ออกเอกสารและข้อมูลใน PDF', async ({ h }) => {
  await h.reset();
  await ok(await h.approve('off.reg2', C(25)));
  const iss = await ok(await h.issue('off.reg2', C(25)));
  expect(iss.docNo).toBe('DOC-2569-000002');
  expect(iss.status).toBe('COMPLETED');
  expect(iss.verifyCode).toMatch(/^[A-Z0-9]{8}$/);
  const code: string = iss.verifyCode;

  const pr = await h.get('somying', '/api/documents/DOC-2569-000002/pdf');
  expect(pr.status()).toBe(200);
  expect(pr.headers()['content-type']).toContain('application/pdf');
  expect(pr.headers()['content-disposition']).toContain('DOC-2569-000002.pdf');
  expect((await pr.body()).toString('latin1')).toContain(
    `docNo=DOC-2569-000002 caseNo=EG-2569-000025 verify=${code} validUntil=2027-02-28`,
  );

  const v = await h.anonPage();
  const resp = await v.goto(`/verify/${code}`);
  expect(resp!.status()).toBe(200);
  await expect(tid(v, 'verify-result')).toHaveText('เอกสารถูกต้อง');
  await expect(tid(v, 'verify-doc-no')).toHaveText('DOC-2569-000002');
  await expect(tid(v, 'verify-applicant')).toHaveText('สมหญิง ร***');
  await expect(tid(v, 'verify-service')).toHaveText('SV-01 ขอหนังสือรับรอง');
  await expect(tid(v, 'verify-issued')).toHaveAttribute('data-iso', T0);
  await expect(tid(v, 'verify-expires')).toHaveAttribute('data-iso', '2027-02-28');
  await expect(tid(v, 'verify-signer')).toHaveText('เจ้าหน้าที่ทะเบียน 2');

  const c = await h.page('somying');
  await c.goto(`/citizen/cases/${C(25)}`);
  await expect(tid(c, 'doc-qr')).toHaveAttribute('data-url', `${BASE}/verify/${code}`);

  const vj = await ok(await (await h.anon()).get(`/api/verify/${code}`));
  expect(vj.result).toBe('VALID');
  expect(vj.validUntil).toBe('2027-02-28');
  expect(vj.issuedAt).toBe(T0);

  expect((await h.get('somchai', '/api/documents/DOC-2569-000002/pdf')).status()).toBe(404);

  const again = await h.issue('off.reg2', C(25));
  expect(again.status()).toBe(409);
  expect((await again.json()).code).toBe('INVALID_STATE');
  const next = await ok(await h.issue('off.reg1', C(19)));
  expect(next.docNo).toBe('DOC-2569-000003');
});

test('TC-DOC-02 ตรวจเอกสาร /verify', async ({ h }) => {
  await h.reset();
  const v = await h.anonPage();
  let resp = await v.goto('/verify/K7M2Q9XA');
  expect(resp!.status()).toBe(200);
  expect(v.url()).toContain('/verify/K7M2Q9XA');
  await expect(tid(v, 'verify-result')).toHaveText('เอกสารถูกต้อง');
  await expect(tid(v, 'verify-result')).toHaveAttribute('data-result', 'VALID');
  await expect(tid(v, 'verify-doc-no')).toHaveText('DOC-2569-000001');
  await expect(tid(v, 'verify-applicant')).toHaveText('สมชาย ใ***');
  await expect(tid(v, 'verify-service')).toHaveText('SV-01 ขอหนังสือรับรอง');
  await expect(tid(v, 'verify-issued')).toHaveAttribute('data-iso', '2026-11-05T10:00:00+07:00');
  await expect(tid(v, 'verify-expires')).toHaveAttribute('data-iso', '2027-02-02');
  await expect(tid(v, 'verify-signer')).toHaveText('เจ้าหน้าที่ทะเบียน 1');
  const body = await v.locator('body').innerText();
  expect(body).not.toContain('ใจดี');
  expect(body).not.toContain('1101700123456');

  resp = await v.goto('/verify/ZZZZZZZZ');
  expect(resp!.status()).toBe(404);
  await expect(tid(v, 'verify-result')).toHaveText('ไม่พบเอกสาร');
  await expect(tid(v, 'verify-result')).toHaveAttribute('data-result', 'NOT_FOUND');
  await expect(tid(v, 'verify-applicant')).toHaveCount(0);
  await expect(tid(v, 'verify-doc-no')).toHaveCount(0);

  const a = await h.anon();
  const ok1 = await a.get('/api/verify/K7M2Q9XA');
  expect(ok1.status()).toBe(200);
  const j1 = await ok1.json();
  expect(j1.result).toBe('VALID');
  expect(j1.applicantMasked).toBe('สมชาย ใ***');
  const nf = await a.get('/api/verify/ZZZZZZZZ');
  expect(nf.status()).toBe(404);
  expect((await nf.json()).result).toBe('NOT_FOUND');
});

async function verifyAt(h: H, v: Page, code: string, at: string, result: string, expires?: string) {
  await h.clock(at);
  const resp = await v.goto(`/verify/${code}`);
  expect(resp!.status(), `${code} @ ${at}`).toBe(200);
  await expect(tid(v, 'verify-result'), `${code} @ ${at}`).toHaveText(VERIFY_TXT[result]);
  await expect(tid(v, 'verify-result')).toHaveAttribute('data-result', result);
  if (expires) await expect(tid(v, 'verify-expires')).toHaveAttribute('data-iso', expires);
}

test('TC-DOC-03 เอกสารหมดอายุและลายเซ็นไม่ตรง (ส่วน A–E)', async ({ h }) => {
  /* ส่วน A : SV-01 90 วัน */
  await h.reset();
  await ok(await h.approve('off.reg2', C(25)));
  const c1 = (await ok(await h.issue('off.reg2', C(25)))).verifyCode as string;
  let v = await h.anonPage();
  await verifyAt(h, v, c1, '2027-02-28T23:59:00+07:00', 'VALID', '2027-02-28');
  await verifyAt(h, v, c1, '2027-03-01T00:00:00+07:00', 'EXPIRED', '2027-02-28');

  /* ส่วน B : SV-02 1 ปี */
  await h.reset();
  const c2 = (await ok(await h.issue('off.reg1', C(19)))).verifyCode as string;
  v = await h.anonPage();
  await verifyAt(h, v, c2, '2027-11-30T23:59:00+07:00', 'VALID', '2027-11-30');
  await verifyAt(h, v, c2, '2027-12-01T00:00:00+07:00', 'EXPIRED');

  /* ส่วน C : seed K7M2Q9XA */
  await h.reset();
  v = await h.anonPage();
  await verifyAt(h, v, 'K7M2Q9XA', '2027-02-02T23:59:00+07:00', 'VALID');
  await verifyAt(h, v, 'K7M2Q9XA', '2027-02-03T00:00:00+07:00', 'EXPIRED');

  /* ส่วน E : ออกวันที่ 29 ก.พ. 2571 */
  await h.reset();
  await h.clock('2028-02-29T10:00:00+07:00');
  await ok(await h.approve('off.reg2', C(25)));
  const e1 = await ok(await h.issue('off.reg2', C(25)));
  const e2 = await ok(await h.issue('off.reg1', C(19)));
  expect(e1.docNo).toBe('DOC-2571-000001');
  expect(e2.docNo).toBe('DOC-2571-000002');
  v = await h.anonPage();
  await verifyAt(h, v, e1.verifyCode, '2028-05-28T23:59:00+07:00', 'VALID', '2028-05-28');
  await verifyAt(h, v, e1.verifyCode, '2028-05-29T00:00:00+07:00', 'EXPIRED');
  await verifyAt(h, v, e2.verifyCode, '2029-02-27T23:59:00+07:00', 'VALID', '2029-02-27');
  await verifyAt(h, v, e2.verifyCode, '2029-02-28T00:00:00+07:00', 'EXPIRED');

  /* ส่วน D : ลายเซ็นไม่ตรง */
  await h.reset();
  await ok(await (await h.anon()).post('/api/test/documents/DOC-2569-000001/tamper'));
  v = await h.anonPage();
  await verifyAt(h, v, 'K7M2Q9XA', T0, 'TAMPERED');
  await expect(tid(v, 'verify-doc-no')).toHaveCount(0);
  await expect(tid(v, 'verify-applicant')).toHaveCount(0);
  await verifyAt(h, v, 'K7M2Q9XA', '2027-03-01T00:00:00+07:00', 'TAMPERED');
  await expect(tid(v, 'verify-doc-no')).toHaveCount(0);
  await expect(tid(v, 'verify-applicant')).toHaveCount(0);
});

/* ═════════════════════════ DASH ═════════════════════════ */

const DASH = '–'; // en dash U+2013

test('TC-DASH-01 Dashboard ตัวเลขเริ่มต้น', async ({ h }) => {
  await h.reset();
  const p = await h.page('exec1');
  await p.goto('/dashboard');
  await expect(tid(p, 'period-select')).toHaveValue('2026-12');
  await expect(tid(p, 'service-select')).toHaveValue('ALL');
  await expect(tid(p, 'kpi-received')).toHaveText('3');
  await expect(tid(p, 'kpi-closed')).toHaveText('0');
  await expect(tid(p, 'kpi-ontime-pct')).toHaveText(DASH);
  await expect(tid(p, 'kpi-backlog')).toHaveText('21');
  await expect(tid(p, 'kpi-overdue')).toHaveText('1');
  await expect(tid(p, 'workload-row')).toHaveCount(3);
  for (const [u, n] of [['off.reg1', '3'], ['off.reg2', '9'], ['off.works1', '0']]) {
    await expect(p.locator(`[data-testid=workload-row][data-username="${u}"]`).getByTestId('workload-value')).toHaveText(n);
  }
  const j = await h.dash('2026-12', 'ALL');
  expect([j.received, j.closed, j.ontimePct, j.backlog, j.overdue]).toEqual([3, 0, null, 21, 1]);
  const wl = Object.fromEntries(j.workload.map((w: any) => [w.username, w.count]));
  expect(wl).toMatchObject({ 'off.reg1': 3, 'off.reg2': 9, 'off.works1': 0 });
  noPII(await p.locator('body').innerText());

  const F: Array<[string, string[], number[]]> = [
    ['SV-01', ['3', '0', DASH, '11', '1'], [3, 0, null as any, 11, 1]],
    ['SV-02', ['0', '0', DASH, '7', '0'], [0, 0, null as any, 7, 0]],
    ['SV-03', ['0', '0', DASH, '3', '0'], [0, 0, null as any, 3, 0]],
  ];
  for (const [svc, ui, api] of F) {
    await tid(p, 'service-select').selectOption(svc);
    for (const [id, val] of [['kpi-received', ui[0]], ['kpi-closed', ui[1]], ['kpi-ontime-pct', ui[2]], ['kpi-backlog', ui[3]], ['kpi-overdue', ui[4]]]) {
      await expect(tid(p, id), `${svc} ${id}`).toHaveText(val);
    }
    const a = await h.dash('2026-12', svc);
    expect([a.received, a.closed, a.ontimePct, a.backlog, a.overdue], svc).toEqual(api);
  }
});

test('TC-DASH-02 Dashboard ย้อนหลัง พ.ย. ต.ค. รายปี', async ({ h }) => {
  await h.reset();
  const p = await h.page('exec1');
  await p.goto('/dashboard');
  const rows: Array<[string, string, number, number, string, number]> = [
    ['2026-10', 'ALL', 1, 1, '100.0%', 100.0],
    ['2026-11', 'ALL', 26, 7, '85.7%', 85.7],
    ['2026-11', 'SV-01', 12, 3, '100.0%', 100.0],
    ['2026-11', 'SV-02', 10, 3, '66.7%', 66.7],
    ['2026-11', 'SV-03', 4, 1, '100.0%', 100.0],
    ['2026', 'ALL', 30, 8, '87.5%', 87.5],
    ['2026', 'SV-01', 16, 4, '100.0%', 100.0],
    ['2026', 'SV-02', 10, 3, '66.7%', 66.7],
    ['2026', 'SV-03', 4, 1, '100.0%', 100.0],
  ];
  const stock: Record<string, [string, string]> = { ALL: ['21', '1'], 'SV-01': ['11', '1'], 'SV-02': ['7', '0'], 'SV-03': ['3', '0'] };
  for (const [period, svc, rec, closed, pct, pctNum] of rows) {
    const k = `${period}/${svc}`;
    await tid(p, 'period-select').selectOption(period);
    await tid(p, 'service-select').selectOption(svc);
    await expect(tid(p, 'kpi-received'), k).toHaveText(String(rec));
    await expect(tid(p, 'kpi-closed'), k).toHaveText(String(closed));
    await expect(tid(p, 'kpi-ontime-pct'), k).toHaveText(pct);
    await expect(tid(p, 'kpi-backlog'), k).toHaveText(stock[svc][0]);
    await expect(tid(p, 'kpi-overdue'), k).toHaveText(stock[svc][1]);
    const a = await h.dash(period, svc);
    expect(a.received, k).toBe(rec);
    expect(a.closed, k).toBe(closed);
    expect(a.ontimePct, k).toBeCloseTo(pctNum, 1);
    expect(String(a.backlog), k).toBe(stock[svc][0]);
    expect(String(a.overdue), k).toBe(stock[svc][1]);
  }
});

test('TC-DASH-03 ส่งออก Excel/PDF เท่าหน้าจอ และไม่มีข้อมูลส่วนบุคคล', async ({ h }) => {
  await h.reset();
  const p = await h.page('exec1');
  await p.goto('/dashboard');
  const KPI = ['kpi-received', 'kpi-closed', 'kpi-ontime-pct', 'kpi-backlog', 'kpi-overdue'];
  const LABELS = ['รับเรื่อง', 'ปิดงาน', 'ทันกำหนด %', 'งานคงค้าง', 'เกินกำหนดคงค้าง'];
  const screen = async () => Promise.all(KPI.map(async (k) => (await tid(p, k).innerText()).trim()));
  const checkXlsx = (buf: Buffer, want: string[]) => {
    const cells = xlsxCells(buf);
    expect(cells['A1']).toBe('ตัวชี้วัด');
    expect(cells['B1']).toBe('ค่า');
    LABELS.forEach((l, i) => {
      expect(cells[`A${i + 2}`], `A${i + 2}`).toBe(l);
      expect(cells[`B${i + 2}`], `B${i + 2}`).toBe(want[i]);
    });
    noPII(Object.values(cells).join('\n'));
  };

  await tid(p, 'period-select').selectOption('2026-11');
  await tid(p, 'service-select').selectOption('ALL');
  await expect(tid(p, 'kpi-received')).toHaveText('26');
  const nov = await screen();
  expect(nov).toEqual(['26', '7', '85.7%', '21', '1']);
  const x1 = await download(p, 'export-xlsx-btn');
  expect(x1.name).toMatch(/\.xlsx$/);
  checkXlsx(x1.buf, nov);

  const x2 = await download(p, 'export-pdf-btn');
  expect(x2.buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const pd = pdfParts(x2.buf);
  expect(pd.all).toContain('kpi received=26 closed=7 ontime=85.7% backlog=21 overdue=1');
  noPII(pd.literals);

  await tid(p, 'period-select').selectOption('2026-12');
  await expect(tid(p, 'kpi-received')).toHaveText('3');
  const dec = await screen();
  expect(dec).toEqual(['3', '0', DASH, '21', '1']);
  const x3 = await download(p, 'export-xlsx-btn');
  checkXlsx(x3.buf, dec);

  const a = await h.page('audit1');
  await a.goto('/audit');
  await auditFilter(a, { event: 'EXPORT' });
  await expect(tid(a, 'audit-count')).toHaveText('3');
  const rows = await auditRows(a);
  expect(rows.length).toBe(3);
  for (const r of rows) {
    expect(r.actor).toBe('exec1');
    expect(r.role).toBe('executive');
  }
  const det = rows.map((r) => r.detail).join('\n');
  expect(det).toMatch(/xlsx/);
  expect(det).toMatch(/pdf/);
  expect(det).toContain('2026-11');
  expect(det).toContain('2026-12');
  expect(rows.filter((r) => /xlsx/.test(r.detail)).length).toBe(2);
});

test('TC-DASH-04 ค่าขอบ "ทันกำหนด" 16:29:59 / 16:30:00 / 16:30:01', async ({ h }) => {
  await h.reset();
  await h.clock('2026-12-03T16:00:00+07:00');
  await h.api('off.reg1');
  await h.api('off.reg2');
  await h.api('exec1');
  await ok(await h.approve('off.reg2', C(25)));
  await ok(await h.approve('off.reg1', C(23)));
  expect((await h.caseJson('off.reg2', C(25))).status).toBe('APPROVED');
  expect((await h.caseJson('off.reg1', C(23))).status).toBe('APPROVED');
  const p = await h.page('exec1');
  const closedAt = async (who: string, n: number) => (await h.caseJson(who, C(n))).closedAt;

  await h.clock('2026-12-03T16:29:59+07:00');
  await ok(await h.issue('off.reg2', C(25)));
  expect(await closedAt('off.reg2', 25)).toBe('2026-12-03T16:29:59+07:00');
  let d = await h.dash('2026-12', 'ALL');
  expect([d.closed, d.onTime]).toEqual([1, 1]);
  await p.goto('/dashboard');
  await expect(tid(p, 'kpi-closed')).toHaveText('1');

  await h.clock('2026-12-03T16:30:00+07:00');
  await ok(await h.reject('off.reg2', C(26)));
  expect(await closedAt('off.reg2', 26)).toBe('2026-12-03T16:30:00+07:00');
  d = await h.dash('2026-12', 'ALL');
  expect([d.closed, d.onTime]).toEqual([2, 2]);
  await p.goto('/dashboard');
  await expect(tid(p, 'kpi-closed')).toHaveText('2');

  await h.clock('2026-12-03T16:30:01+07:00');
  await ok(await h.issue('off.reg1', C(23)));
  expect(await closedAt('off.reg1', 23)).toBe('2026-12-03T16:30:01+07:00');
  d = await h.dash('2026-12', 'ALL');
  expect([d.closed, d.onTime]).toEqual([3, 2]);
  expect(d.backlog).toBe(18);
  await p.goto('/dashboard');
  await expect(tid(p, 'kpi-closed')).toHaveText('3');
  await expect(tid(p, 'kpi-backlog')).toHaveText('18');

  const op = await h.page('off.reg1');
  await op.goto(`/officer/cases/${C(23)}`);
  await expect(tid(op, 'closed-at')).toHaveAttribute('data-iso', '2026-12-03T16:30:01+07:00');
});

/* ═════════════════════════ AUDIT ═════════════════════════ */

test('TC-AUDIT-01 เหตุการณ์และฟิลด์ใน Audit', async ({ h }) => {
  await h.reset();
  await ok(await h.claim('off.reg2', C(28)));
  await ok(await h.ret('off.reg1', C(20)));
  await ok(await h.fwd('off.reg2', C(13)));
  await ok(await h.approve('head1', C(13)));
  await ok(await h.approve('off.reg2', C(25)));
  const iss = await ok(await h.issue('off.reg2', C(25)));
  expect(iss.docNo).toBe('DOC-2569-000002');
  await ok(await h.reject('off.reg2', C(26)));
  await ok(await h.post('off.reg2', `/api/officer/cases/${C(25)}/unmask`, { reason: 'ตรวจสอบตัวตนซ้ำ' }));
  await ok(await h.get('exec1', '/api/dashboard/export?format=xlsx&period=2026-12&service=ALL'));
  await ok(await (await h.api('admin1')).put('/api/admin/services/SV-01', { data: { fee: 25, sla: 3 } }));

  const p = await h.page('audit1');
  await p.goto('/audit');
  await expect(tid(p, 'audit-count')).toHaveText('16');
  const rows = await auditRows(p);
  expect(rows.length).toBe(16);
  const by = (e: string) => rows.filter((r) => r.event === e);
  const NONE = /^(|–|-)$/;
  for (const r of rows) expect(r.time, `${r.event} time`).toBe(T0);

  /* เรียงใหม่ → เก่า (เวลาเท่ากันเรียง id มาก → น้อย) */
  const ids = rows.map((r) => Number(r.id));
  if (ids.every((n) => !Number.isNaN(n))) for (let i = 1; i < ids.length; i++) expect(ids[i - 1]).toBeGreaterThan(ids[i]);

  const sl = by('STAFF_LOGIN');
  expect(sl.length).toBe(6);
  expect(sl.map((r) => r.actor).sort()).toEqual(['admin1', 'audit1', 'exec1', 'head1', 'off.reg1', 'off.reg2']);
  const roleOf: Record<string, string> = { 'off.reg1': 'officer', 'off.reg2': 'officer', head1: 'head', exec1: 'executive', admin1: 'admin', audit1: 'auditor' };
  for (const r of sl) {
    expect(r.role).toBe(roleOf[r.actor]);
    expect(r.caseNo).toMatch(NONE);
    expect(r.tr).toBe(DASH);
  }

  const one = (e: string, actor: string, role: string, caseNo: string, tr: string, detail?: string) => {
    const l = by(e);
    expect(l.length, e).toBe(1);
    expect(l[0].actor, e).toBe(actor);
    expect(l[0].role, e).toBe(role);
    if (caseNo) expect(l[0].caseNo, e).toBe(caseNo);
    else expect(l[0].caseNo, e).toMatch(NONE);
    expect(l[0].tr, e).toBe(tr);
    if (detail) expect(l[0].detail, e).toContain(detail);
  };
  one('CLAIM', 'off.reg2', 'officer', C(28), 'SUBMITTED → IN_REVIEW');
  one('RETURN', 'off.reg1', 'officer', C(20), 'IN_REVIEW → NEED_FIX', REASON);
  one('FORWARD', 'off.reg2', 'officer', C(13), 'IN_REVIEW → PENDING_APPROVAL');
  one('ISSUE', 'off.reg2', 'officer', C(25), 'APPROVED → COMPLETED', 'DOC-2569-000002');
  one('REJECT', 'off.reg2', 'officer', C(26), 'IN_REVIEW → REJECTED', REASON);
  one('UNMASK', 'off.reg2', 'officer', C(25), DASH, 'ตรวจสอบตัวตนซ้ำ');
  one('EXPORT', 'exec1', 'executive', '', DASH);
  expect(by('EXPORT')[0].detail).toContain('xlsx');
  expect(by('EXPORT')[0].detail).toContain('2026-12');
  one('ADMIN_CHANGE', 'admin1', 'admin', '', DASH, 'SV-01 fee 20 → 25');
  const ap = by('APPROVE');
  expect(ap.length).toBe(2);
  const aH = ap.find((r) => r.actor === 'head1')!;
  const aO = ap.find((r) => r.actor === 'off.reg2')!;
  expect(aH.role).toBe('head');
  expect(aH.caseNo).toBe(C(13));
  expect(aH.tr).toBe('PENDING_APPROVAL → APPROVED');
  expect(aO.role).toBe('officer');
  expect(aO.caseNo).toBe(C(25));
  expect(aO.tr).toBe('IN_REVIEW → APPROVED');

  /* กรอง */
  await auditFilter(p, { actor: 'off.reg2' });
  await expect(tid(p, 'audit-count')).toHaveText('7');
  expect((await auditRows(p)).map((r) => r.event).sort()).toEqual(['APPROVE', 'CLAIM', 'FORWARD', 'ISSUE', 'REJECT', 'STAFF_LOGIN', 'UNMASK']);
  await auditFilter(p, { event: 'APPROVE' });
  await expect(tid(p, 'audit-count')).toHaveText('2');
  expect((await auditRows(p)).map((r) => r.actor).sort()).toEqual(['head1', 'off.reg2']);
  await auditFilter(p, { actor: 'off.reg2', event: 'APPROVE' });
  await expect(tid(p, 'audit-count')).toHaveText('1');
  await auditFilter(p, {});
  await expect(tid(p, 'audit-count')).toHaveText('16');
  await expect(tid(p, 'audit-row')).toHaveCount(16);

  /* CSV */
  const csv = await download(p, 'audit-export-csv-btn');
  const lines = csv.buf.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length > 0);
  expect(lines[0]).toBe('time,username,role,event,caseNo,fromStatus,toStatus,detail');
  expect(lines.length - 1).toBe(16);
  await auditFilter(p, {});
  await expect(tid(p, 'audit-count')).toHaveText('17');
  const ex17 = (await auditRows(p)).filter((r) => r.event === 'EXPORT' && r.actor === 'audit1');
  expect(ex17.length).toBe(1);
  expect(ex17[0].detail).toContain('audit-csv');
});

test('TC-AUDIT-02 Audit แก้/ลบไม่ได้ (405)', async ({ h }) => {
  await h.reset();
  const aud = await h.api('audit1');
  const before = (await ok(await aud.get('/api/audit'))).items as any[];
  expect(before.length).toBe(1);
  const id = before[0].id;

  for (const who of ['admin1', 'audit1']) {
    const a = await h.api(who);
    const calls: Array<[string, Promise<APIResponse>]> = [
      [`PUT /${id}`, a.put(`/api/audit/${id}`, { data: { detail: 'x' } })],
      [`PATCH /${id}`, a.patch(`/api/audit/${id}`, { data: { detail: 'x' } })],
      [`DELETE /${id}`, a.delete(`/api/audit/${id}`)],
      ['PUT /api/audit', a.put('/api/audit', { data: {} })],
      ['DELETE /api/audit', a.delete('/api/audit')],
      ['DELETE /999999', a.delete('/api/audit/999999')],
    ];
    for (const [name, pr] of calls) {
      const r = await pr;
      expect(r.status(), `${who} ${name}`).toBe(405);
      expect((await r.json()).code, `${who} ${name}`).toBe('METHOD_NOT_ALLOWED');
    }
  }
  expect((await (await h.api('admin1')).get('/api/audit')).status()).toBe(403);

  const after = (await ok(await aud.get('/api/audit'))).items as any[];
  for (const b of before) {
    const m = after.find((x) => x.id === b.id);
    expect(m, `แถว ${b.id} ต้องไม่หาย`).toBeTruthy();
    expect(m).toEqual(b);
  }
  const added = after.filter((x) => !before.some((b) => b.id === x.id));
  expect(added.length).toBe(1);
  expect(added[0].event).toBe('STAFF_LOGIN');
  expect(added[0].username).toBe('admin1');

  const p = await h.page('audit1');
  await p.goto('/audit');
  await expect(tid(p, 'audit-row').first()).toBeVisible();
  await expect(tid(p, 'audit-edit-btn')).toHaveCount(0);
  await expect(tid(p, 'audit-delete-btn')).toHaveCount(0);
});

test('TC-AUDIT-03 กรองช่วงวันที่ตามเวลาไทย', async ({ h }) => {
  await h.reset();
  const L: Array<[string, string, string, boolean]> = [
    ['L1', '2026-11-30T23:59:59+07:00', 'off.reg1', false],
    ['L2', '2026-12-01T00:00:00+07:00', 'off.reg2', false],
    ['L3', '2026-12-01T23:59:59+07:00', 'off.works1', false],
    ['L4', '2026-12-02T00:00:00+07:00', 'off.reg1', true],
    ['L5', '2026-12-02T09:00:00+07:00', 'audit1', false],
  ];
  const T: Record<string, string> = {};
  for (const [k, at, who, fresh] of L) {
    await h.clock(at);
    await h.api(who, fresh);
    T[k] = at;
  }
  const Q: Array<{ from?: string; to?: string; actor?: string; want: string[] }> = [
    { from: '2026-12-01', to: '2026-12-01', want: ['L2', 'L3'] },
    { from: '2026-11-30', to: '2026-11-30', want: ['L1'] },
    { from: '2026-11-30', to: '2026-12-01', want: ['L1', 'L2', 'L3'] },
    { from: '2026-12-02', want: ['L4', 'L5'] },
    { to: '2026-11-30', want: ['L1'] },
    { from: '2026-12-01', to: '2026-12-02', want: ['L2', 'L3', 'L4', 'L5'] },
    { from: '2026-12-01', to: '2026-12-01', actor: 'off.reg2', want: ['L2'] },
  ];
  const aud = await h.api('audit1');
  const p = await h.page('audit1');
  await p.goto('/audit');
  for (const q of Q) {
    const name = JSON.stringify(q);
    const want = q.want.map((k) => T[k]).sort();
    const qs = new URLSearchParams({ actor: q.actor ?? '', event: '', from: q.from ?? '', to: q.to ?? '' });
    const j = await ok(await aud.get(`/api/audit?${qs}`));
    expect(j.count, name).toBe(q.want.length);
    expect(j.items.map((i: any) => i.time).sort(), name).toEqual(want);

    await auditFilter(p, { actor: q.actor, from: q.from, to: q.to });
    await expect(tid(p, 'audit-count'), name).toHaveText(String(q.want.length));
    await expect(tid(p, 'audit-row'), name).toHaveCount(q.want.length);
    expect((await auditRows(p)).map((r) => r.time).sort(), name).toEqual(want);
  }
});

/* ═════════════════════════ RBAC (ผู้ดูแลระบบ) ═════════════════════════ */

test('TC-RBAC-04 ผู้ดูแลระบบ: บริการ วันหยุด ผู้ใช้ และยอดที่ล็อก', async ({ h }) => {
  await h.reset();
  const admin = await h.page('admin1');

  /* 1 */
  await admin.goto('/admin/holidays');
  await expect(tid(admin, 'holiday-row')).toHaveCount(4);
  expect((await attrList(admin, 'holiday-row', 'data-date')).sort()).toEqual(['2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01']);

  /* 2 */
  const first = await h.newPaid({ at: T0 });
  expect(first.caseNo).toBe(C(31));
  expect((await h.caseJson('somchai', first.caseNo)).dueAt).toBe('2026-12-04T16:30:00+07:00');

  /* 3 */
  await admin.goto('/admin/services');
  await tid(admin, 'svc-fee-SV-01').fill('25');
  await tid(admin, 'svc-save-SV-01').click();
  await expect(tid(admin, 'action-success')).toBeVisible();
  await admin.goto('/admin/services');
  await tid(admin, 'svc-fee-SV-02').fill('600');
  await tid(admin, 'svc-save-SV-02').click();
  await expect(tid(admin, 'action-success')).toBeVisible();

  /* 4 */
  const sp = await h.page('somchai');
  await sp.goto('/citizen/new/SV-01');
  await tid(sp, 'qty-input').fill('5');
  await expect(tid(sp, 'fee-total')).toHaveText('฿125');
  await tid(sp, 'qty-input').fill('1');
  await expect(tid(sp, 'fee-total')).toHaveText('฿25');
  await sp.goto('/citizen/new/SV-02');
  await expect(tid(sp, 'fee-total')).toHaveText('฿600');
  await sp.goto(`/citizen/cases/${C(30)}`);
  await expect(tid(sp, 'case-fee')).toHaveText('฿20');

  /* 5 : ยอดที่ล็อกของ PP-0001 */
  await sp.goto('/citizen/new/SV-02?draft=DR-0002');
  await expect(tid(sp, 'payment-amount')).toHaveText('฿500');
  const anon = await h.anon();
  const bad = await anon.post('/api/test/payments/PP-0001/pay', { data: { amount: 600 } });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).code).toBe('AMOUNT_MISMATCH');
  const good = await ok(await anon.post('/api/test/payments/PP-0001/pay', { data: { amount: 500 } }));
  expect(good.status).toBe('PAID');
  expect(good.caseNo).toBe(C(32));

  /* 6 */
  await admin.goto('/admin/holidays');
  await tid(admin, 'holiday-date-input').fill('2026-12-02');
  await tid(admin, 'holiday-name-input').fill('วันหยุดทดสอบ');
  await tid(admin, 'holiday-add-btn').click();
  await expect(tid(admin, 'holiday-row')).toHaveCount(5);
  expect((await h.caseJson('somchai', first.caseNo)).dueAt).toBe('2026-12-04T16:30:00+07:00');

  /* 7 */
  const second = await h.newPaid({ at: T0 });
  expect(second.caseNo).toBe(C(33));
  expect(second.fee).toBe(25);
  expect((await h.caseJson('somchai', second.caseNo)).dueAt).toBe('2026-12-08T16:30:00+07:00');

  /* 8 */
  const adm = await h.api('admin1');
  await ok(await adm.put('/api/admin/users/exec1', { data: { role: 'auditor', dept: '' } }));
  const ex = await ok(await (await h.api('exec1')).get('/api/me')); // exec1 ล็อกอินใหม่หลังเปลี่ยนบทบาท
  expect(ex.role).toBe('auditor');
  expect(h.lastLogin.exec1.role).toBe('auditor');
  expect(h.lastLogin.exec1.landing).toBe('/audit');
  const ep = await h.page('exec1');
  const dr = await ep.goto('/dashboard');
  expect(dr!.status()).toBe(403);
  await expect(tid(ep, 'forbidden-msg')).toHaveText('ไม่มีสิทธิ์เข้าถึงหน้านี้');

  /* 9 */
  await ep.goto('/audit');
  await auditFilter(ep, { event: 'ADMIN_CHANGE' });
  await expect(tid(ep, 'audit-count')).toHaveText('4');
  const rows = await auditRows(ep);
  for (const r of rows) {
    expect(r.actor).toBe('admin1');
    expect(r.role).toBe('admin');
  }
  const det = rows.map((r) => r.detail).join('\n');
  for (const s of ['SV-01 fee 20 → 25', 'SV-02 fee 500 → 600', 'holiday add 2026-12-02', 'exec1 role executive → auditor']) expect(det).toContain(s);

  /* 10 */
  expect((await adm.post('/api/drafts', { data: { serviceId: 'SV-01', qty: 1 } })).status()).toBe(403);

  /* 11 */
  await admin.goto('/admin/holidays');
  await admin.locator('[data-testid=holiday-row][data-date="2026-12-02"]').getByTestId('holiday-delete-btn').click();
  await expect(tid(admin, 'holiday-row')).toHaveCount(4);
  await auditFilter(ep, { event: 'ADMIN_CHANGE' });
  await expect(tid(ep, 'audit-count')).toHaveText('5');
  expect((await auditRows(ep)).map((r) => r.detail).join('\n')).toContain('holiday delete 2026-12-02');
});

test('TC-RBAC-06 ผู้ดูแลระบบ: ช่วงค่าที่ยอมรับ', async ({ h }) => {
  await h.reset();
  const a = await h.api('admin1');
  const admin = await h.page('admin1');
  const FEE_ERR = 'ค่าธรรมเนียมต้องเป็นจำนวนเต็ม 0–100,000 บาท';
  const SLA_ERR = 'SLA ต้องเป็นจำนวนเต็ม 1–60 วันทำการ';
  const svc = async () => ((await ok(await a.get('/api/admin/services'))).items as any[]).find((s) => s.id === 'SV-01');
  const put = (fee: number, sla: number) => a.put('/api/admin/services/SV-01', { data: { fee, sla } });

  /* บนจอ: fee −1 */
  await admin.goto('/admin/services');
  await tid(admin, 'svc-fee-SV-01').fill('-1');
  await tid(admin, 'svc-save-SV-01').click();
  await expect(tid(admin, 'action-error')).toHaveText(FEE_ERR);
  expect((await svc()).fee).toBe(20);

  /* API : fee */
  let r = await put(-1, 3);
  expect(r.status()).toBe(400);
  expect((await r.json()).code).toBe('INVALID_FEE');
  expect((await svc()).fee).toBe(20);
  await ok(await put(0, 3));
  await ok(await put(100000, 3));
  expect((await svc()).fee).toBe(100000);
  r = await put(100001, 3);
  expect(r.status()).toBe(400);
  expect((await r.json()).code).toBe('INVALID_FEE');
  expect((await svc()).fee).toBe(100000);

  /* บนจอ: sla 0 */
  await admin.goto('/admin/services');
  await tid(admin, 'svc-sla-SV-01').fill('0');
  await tid(admin, 'svc-save-SV-01').click();
  await expect(tid(admin, 'action-error')).toHaveText(SLA_ERR);

  /* API : sla (ส่ง fee เท่าค่าปัจจุบันเพื่อไม่ให้เกิด audit ของ fee เพิ่ม) */
  r = await put(100000, 0);
  expect(r.status()).toBe(400);
  expect((await r.json()).code).toBe('INVALID_SLA');
  await ok(await put(100000, 1));
  await ok(await put(100000, 60));
  r = await put(100000, 61);
  expect(r.status()).toBe(400);
  expect((await r.json()).code).toBe('INVALID_SLA');
  expect((await svc()).sla).toBe(60);

  /* วันหยุด */
  await admin.goto('/admin/holidays');
  await expect(tid(admin, 'holiday-row')).toHaveCount(4);
  const dup = await a.post('/api/admin/holidays', { data: { date: '2026-12-07', name: 'ซ้ำ' } });
  expect(dup.status()).toBe(409);
  const dj = await dup.json();
  expect(dj.code).toBe('DUPLICATE_HOLIDAY');
  expect(dj.message).toBe('มีวันหยุดนี้อยู่แล้ว');
  await tid(admin, 'holiday-date-input').fill('2026-12-07');
  await tid(admin, 'holiday-name-input').fill('ซ้ำ');
  await tid(admin, 'holiday-add-btn').click();
  await expect(tid(admin, 'action-error')).toHaveText('มีวันหยุดนี้อยู่แล้ว');
  await expect(tid(admin, 'holiday-row')).toHaveCount(4);
  await ok(await a.post('/api/admin/holidays', { data: { date: '2026-12-05', name: 'วันเสาร์' } }), 201);

  /* เปลี่ยนบทบาทตัวเอง */
  const sr = await a.put('/api/admin/users/admin1', { data: { role: 'executive', dept: '' } });
  expect(sr.status()).toBe(409);
  expect((await sr.json()).code).toBe('SELF_ROLE_CHANGE');
  expect((await ok(await a.get('/api/me'))).role).toBe('admin');

  /* Audit : เฉพาะที่สำเร็จ 5 รายการ */
  const au = await h.page('audit1');
  await au.goto('/audit');
  await auditFilter(au, { event: 'ADMIN_CHANGE' });
  await expect(tid(au, 'audit-count')).toHaveText('5');
  const det = (await auditRows(au)).map((x) => x.detail).join('\n');
  for (const s of ['SV-01 fee 20 → 0', 'SV-01 fee 0 → 100000', 'SV-01 sla 3 → 1', 'SV-01 sla 1 → 60', 'holiday add 2026-12-05']) expect(det).toContain(s);
});
