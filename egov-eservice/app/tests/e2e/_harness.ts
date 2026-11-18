/** helper ร่วม — คัดมาจาก part2.spec.ts (ไม่แก้ part2) ใช้โดย part3.spec.ts */
import { test as base, expect, APIRequestContext, APIResponse, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as zlib from 'zlib';

export const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const PW = 'Test@1234';
export const OTP = '123456';
export const T0 = '2026-12-01T09:00:00+07:00';
export const IDS: Record<string, string> = {
  somchai: '1101700123456',
  somying: '3100600987659',
  mana: '5500400111221',
  piti: '1909900555015',
};
export const C = (n: number) => `EG-2569-${String(n).padStart(6, '0')}`;
export const REASON = 'xxxxxxxxxx';
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

export async function ok(r: APIResponse, status = 200): Promise<any> {
  expect(r.status(), `${r.url()} → ${await r.text().catch(() => '')}`).toBe(status);
  return r.json().catch(() => null);
}

export function pdf(n = 1024): Buffer {
  const head = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n');
  const tail = Buffer.from('\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  return Buffer.concat([head, Buffer.alloc(n - head.length - tail.length, 0x20), tail]);
}

const DOC_KEYS: Record<string, string[]> = {
  'SV-01': ['id-card'],
  'SV-02': ['id-card', 'map'],
  'SV-03': ['id-card', 'plan', 'deed'],
};

export class H {
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

export const test = base.extend<{ h: H }>({
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

export const tid = (p: Page, id: string) => p.getByTestId(id);

export async function expectStatus(p: Page, text: string, code?: string) {
  const s = tid(p, 'case-status');
  await expect(s).toHaveText(text);
  if (code) await expect(s).toHaveAttribute('data-status', code);
}

export async function attrList(p: Page, id: string, attr: string): Promise<string[]> {
  return p.getByTestId(id).evaluateAll((els, a) => els.map((e) => e.getAttribute(a as string) ?? ''), attr);
}

export async function download(p: Page, id: string): Promise<{ name: string; buf: Buffer }> {
  const [d] = await Promise.all([p.waitForEvent('download'), tid(p, id).click()]);
  const path = await d.path();
  return { name: d.suggestedFilename(), buf: fs.readFileSync(path!) };
}

/** เปิดฟอร์มเหตุผล (ถ้ายังไม่เห็น) แล้วกรอก + ยืนยัน */
export async function submitReason(p: Page, btn: string, input: string, submit: string, reason: string) {
  const field = tid(p, input);
  if (!(await field.isVisible().catch(() => false))) await tid(p, btn).click();
  await field.fill(reason);
  await tid(p, submit).click();
}

export const noPII = (s: string) => {
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
export async function auditRows(p: Page) {
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
export async function auditFilter(p: Page, f: { actor?: string; event?: string; from?: string; to?: string } = {}) {
  await tid(p, 'audit-filter-actor').fill(f.actor ?? '');
  await tid(p, 'audit-filter-event').selectOption(f.event ?? '');
  await tid(p, 'audit-filter-from').fill(f.from ?? '');
  await tid(p, 'audit-filter-to').fill(f.to ?? '');
  await tid(p, 'audit-apply-btn').click();
}

/* ═════════════════════════ SLA ═════════════════════════ */

export { expect };
