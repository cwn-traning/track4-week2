/**
 * Playwright ชุดที่ 3 — TC: PDPA-01..03 · RBAC-01 RBAC-02 RBAC-03 RBAC-05 · NFR-01..04  (11 TC)
 * เขียนจาก TEST-PLAN / CONTRACT / TEST-DATA · ใช้ helper ร่วมจาก _harness.ts
 * ต้องรันด้วย workers = 1 · เซิร์ฟเวอร์เปิด TEST_MODE=1
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AxeBuilder from '@axe-core/playwright';
import type { Page, APIResponse } from '@playwright/test';
import { test, expect, ok, pdf, tid, auditRows, auditFilter, C, T0, IDS, OTP } from './_harness';

const MASK_RE = /^X-XXXX-XXXXX-\d{2}-\d$/;
const FULL_ID_RE = /\d-\d{4}-\d{5}-\d{2}-\d/;
const RAW_IDS = ['3100600987659', '1101700123456', '1909900555015'];
const STATUS_TH: Record<string, string> = {
  DRAFT: 'ร่าง', PENDING_PAYMENT: 'รอชำระเงิน', SUBMITTED: 'ส่งคำขอแล้ว', IN_REVIEW: 'กำลังตรวจสอบ',
  NEED_FIX: 'รอแก้ไขเอกสาร', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติ', COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก',
};
const LEVEL_TH: Record<string, string> = { normal: 'ปกติ', near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด', paused: 'หยุดนับ', closed: 'ปิดแล้ว' };

/** ค้นทุกชั้นว่ามี key ชื่อนี้ไหม */
function hasKeyDeep(v: unknown, key: string): boolean {
  if (Array.isArray(v)) return v.some((x) => hasKeyDeep(x, key));
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => k === key || hasKeyDeep(x, key));
  return false;
}

async function expectNoFullId(r: APIResponse, label: string) {
  expect(r.headers()['content-type'] ?? '', label).toContain('application/json');
  const j = await r.json();
  const s = JSON.stringify(j);
  expect(s, label).not.toMatch(/\d{13}/);
  expect(s, label).not.toMatch(FULL_ID_RE);
  expect(hasKeyDeep(j, 'idNo'), `${label} มี key idNo`).toBe(false);
  for (const id of RAW_IDS) expect(s, label).not.toContain(id);
  return j;
}

/* ═════════════════════════ PDPA ═════════════════════════ */

test('TC-PDPA-01 ปิดบังเลขบัตรบนจอ', async ({ h }) => {
  await h.reset();
  const q = await h.page('off.reg2');
  await q.goto('/officer/queue');
  const masks = await tid(q, 'row-id-masked').allTextContents();
  expect(masks.length).toBeGreaterThan(0);
  for (const m of masks) expect(m.trim()).toMatch(MASK_RE);
  const rowMask = (n: number) => q.locator(`[data-testid="queue-row"][data-case-no="${C(n)}"] [data-testid="row-id-masked"]`);
  await expect(rowMask(25)).toHaveText('X-XXXX-XXXXX-65-9');
  await expect(rowMask(26)).toHaveText('X-XXXX-XXXXX-45-6');

  await q.goto(`/officer/cases/${C(25)}`);
  await expect(tid(q, 'applicant-id')).toHaveText('X-XXXX-XXXXX-65-9');
  const html = await q.content();
  expect(html).not.toContain('3100600987659');
  expect(html).not.toContain('3-1006-00987-65-9');

  const hp = await h.page('head1');
  await hp.goto(`/officer/cases/${C(25)}`);
  await expect(tid(hp, 'applicant-id')).toHaveText('X-XXXX-XXXXX-65-9');

  const sy = await h.page('somying');
  await sy.goto(`/citizen/cases/${C(25)}`);
  await expect(tid(sy, 'case-id-full')).toHaveText('3-1006-00987-65-9');

  const sc = await h.page('somchai');
  await sc.goto(`/citizen/cases/${C(20)}`);
  await expect(tid(sc, 'case-id-full')).toHaveText('1-1017-00123-45-6');
});

test('TC-PDPA-02 API (JSON) ไม่ส่งเลขบัตรเต็ม', async ({ h }) => {
  for (const who of ['off.reg1', 'head1']) {
    await h.reset();
    const paths = [
      '/api/officer/queue?filter=all',
      `/api/cases/${C(25)}`,
      `/api/cases/${C(26)}`,
      `/api/cases/${C(20)}`,
      '/api/notifications',
      `/api/cases/${C(25)}/files`,
    ];
    for (const p of paths) {
      const r = await h.get(who, p);
      expect(r.status(), `${who} ${p}`).toBe(200);
      const j = await expectNoFullId(r, `${who} ${p}`);
      if (Array.isArray(j.items)) for (const it of j.items) if ('idMasked' in it) expect(it.idMasked).toMatch(MASK_RE);
      if (p.startsWith('/api/cases/') && !p.endsWith('/files')) expect(j.idMasked, p).toMatch(MASK_RE);
    }
  }
});

test('TC-PDPA-03 แสดงเลขเต็มต้องมีเหตุผลและบันทึก Audit', async ({ h }) => {
  await h.reset();
  const p = await h.page('off.reg2');
  await p.goto(`/officer/cases/${C(25)}`);

  const tryUnmask = async (reason: string) => {
    if (!(await tid(p, 'unmask-reason').isVisible().catch(() => false))) await tid(p, 'show-full-id-btn').click();
    await tid(p, 'unmask-reason').fill(reason);
    const [resp] = await Promise.all([
      p.waitForResponse((r) => r.url().includes('/unmask') && r.request().method() === 'POST'),
      tid(p, 'unmask-submit').click(),
    ]);
    return resp;
  };
  for (const reason of ['', '   ']) {
    const r = await tryUnmask(reason);
    expect(r.status(), `reason="${reason}"`).toBe(400);
    expect((await r.json()).code).toBe('REASON_REQUIRED');
    await expect(tid(p, 'unmask-error')).toHaveText('กรุณากรอกเหตุผล');
    await expect(tid(p, 'full-id')).toHaveCount(0);
  }
  const r3 = await tryUnmask('ตรวจสอบตัวตนซ้ำ');
  expect(r3.status()).toBe(200);
  await expect(tid(p, 'full-id')).toHaveText('3-1006-00987-65-9');

  await p.reload();
  await expect(tid(p, 'applicant-id')).toHaveText('X-XXXX-XXXXX-65-9');
  await expect(tid(p, 'full-id')).toHaveCount(0);

  const a = await h.page('audit1');
  await a.goto('/audit');
  await auditFilter(a, { event: 'UNMASK' });
  await expect(tid(a, 'audit-count')).toHaveText('1');
  const [row] = await auditRows(a);
  expect(row).toMatchObject({ actor: 'off.reg2', role: 'officer', caseNo: C(25), event: 'UNMASK', time: T0 });
  expect(row.detail).toContain('ตรวจสอบตัวตนซ้ำ');
  await expect(a.locator('[data-testid="audit-row"] [data-testid="audit-event"]').first()).toHaveText('UNMASK');
  await expect(a.locator('[data-testid="audit-row"] [data-testid="audit-case-no"]').first()).toHaveText(C(25));

  for (const who of ['exec1', 'audit1', 'somying']) {
    const r = await h.post(who, `/api/officer/cases/${C(25)}/unmask`, { reason: 'x' });
    expect(r.status(), who).toBe(403);
  }
});

/* ═════════════════════════ RBAC ═════════════════════════ */

test('TC-RBAC-01 ประชาชนเปิดคำขอคนอื่นไม่ได้ (IDOR)', async ({ h }) => {
  await h.reset();
  const p = await h.page('somying');
  const resp = await p.goto(`/citizen/cases/${C(5)}`);
  expect(resp!.status()).toBe(404);
  await expect(tid(p, 'not-found-msg')).toHaveText('ไม่พบคำขอ');
  await expect(tid(p, 'case-no')).toHaveCount(0);
  await expect(tid(p, 'case-status')).toHaveCount(0);
  expect(await p.content()).not.toContain('สมชาย');

  const NF = { code: 'NOT_FOUND', message: 'ไม่พบคำขอ' };
  const r1 = await h.get('somying', `/api/cases/${C(5)}`);
  expect(r1.status()).toBe(404);
  const b1 = await r1.text();
  expect(JSON.parse(b1)).toEqual(NF);
  const r2 = await h.get('somying', `/api/cases/${C(999999)}`);
  expect(r2.status()).toBe(404);
  expect(await r2.text()).toBe(b1);

  expect((await h.get('somying', '/api/documents/DOC-2569-000001/pdf')).status()).toBe(404);
  expect((await h.get('somying', '/api/drafts/DR-0001')).status()).toBe(404);
  expect((await h.post('somying', `/api/cases/${C(30)}/cancel`)).status()).toBe(404);

  const own = await p.goto(`/citizen/cases/${C(7)}`);
  expect(own!.status()).toBe(200);
  await expect(tid(p, 'case-no')).toHaveText(C(7));
  expect((await h.get('somchai', `/api/cases/${C(5)}`)).status()).toBe(200);
});

test('TC-RBAC-02 เจ้าหน้าที่อนุมัติ SV-02 ไม่ได้ (ตรวจที่ API)', async ({ h }) => {
  await h.reset();
  const status = async (n: number) => (await h.caseJson('head1', C(n))).status;

  let r = await h.approve('off.reg2', C(14));
  expect(r.status()).toBe(403);
  expect((await r.json()).code).toBe('FORBIDDEN');
  expect(await status(14)).toBe('PENDING_APPROVAL');

  r = await h.approve('off.reg2', C(13));
  expect(r.status()).toBe(403);
  expect(await status(13)).toBe('IN_REVIEW');

  r = await h.reject('off.reg2', C(14));
  expect(r.status()).toBe(403);
  expect(await status(14)).toBe('PENDING_APPROVAL');

  const p = await h.page('off.reg2');
  for (const n of [13, 14]) {
    await p.goto(`/officer/cases/${C(n)}`);
    await expect(tid(p, 'approve-btn'), C(n)).toHaveCount(0);
  }

  expect((await h.approve('head1', C(25))).status()).toBe(403);
  const ok6 = await ok(await h.approve('head1', C(14)));
  expect(ok6.status).toBe('APPROVED');

  const a = await h.page('audit1');
  await a.goto('/audit');
  await auditFilter(a, { event: 'APPROVE' });
  const rows = await auditRows(a);
  expect(rows.length).toBe(1);
  expect(rows[0].actor).toBe('head1');
});

type Role = 'anon' | 'citizen' | 'officer' | 'head' | 'executive' | 'auditor' | 'admin';
const ROLES: Role[] = ['anon', 'citizen', 'officer', 'head', 'executive', 'auditor', 'admin'];
const WHO: Record<Exclude<Role, 'anon'>, string> = {
  citizen: 'somchai', officer: 'off.reg1', head: 'head1', executive: 'exec1', auditor: 'audit1', admin: 'admin1',
};
const PAGE_OK: Record<string, Role[]> = {
  '/citizen': ['citizen'],
  '/officer/queue': ['officer', 'head'],
  '/head/approvals': ['head'],
  '/dashboard': ['executive'],
  '/audit': ['auditor'],
  '/admin/services': ['admin'],
  '/admin/holidays': ['admin'],
  '/admin/users': ['admin'],
  '/notifications': ['officer', 'head'],
};
const NAV: Record<Exclude<Role, 'anon'>, string[]> = {
  citizen: ['nav-my-cases'],
  officer: ['nav-queue', 'nav-bell'],
  head: ['nav-queue', 'nav-approvals', 'nav-bell'],
  executive: ['nav-dashboard'],
  auditor: ['nav-audit'],
  admin: ['nav-admin-services', 'nav-admin-holidays', 'nav-admin-users'],
};
const LANDING: Record<Exclude<Role, 'anon'>, string> = {
  citizen: '/citizen', officer: '/officer/queue', head: '/head/approvals', executive: '/dashboard', auditor: '/audit', admin: '/admin/services',
};

test('TC-RBAC-03 ตารางสิทธิ์หน้า/API ตามบทบาท', async ({ h }) => {
  // ส่วน A หน้า
  for (const role of ROLES) {
    await h.reset();
    const p = role === 'anon' ? await h.anonPage() : await h.page(WHO[role]);
    for (const [url, allowed] of Object.entries(PAGE_OK)) {
      const resp = await p.goto(url);
      const label = `${role} ${url}`;
      if (role === 'anon') {
        await expect(p, label).toHaveURL(/\/login$/);
      } else if (allowed.includes(role)) {
        expect(resp!.status(), label).toBe(200);
        await expect(p, label).toHaveURL(new RegExp(`${url}$`));
      } else {
        expect(resp!.status(), label).toBe(403);
        await expect(tid(p, 'forbidden-msg'), label).toHaveText('ไม่มีสิทธิ์เข้าถึงหน้านี้');
      }
    }
    const v = await p.goto('/verify/K7M2Q9XA');
    expect(v!.status(), `${role} /verify`).toBe(200);
  }

  // ส่วน B API
  type Row = [string, 'GET' | 'POST', unknown, Record<Role, number>];
  const S = (a: number, c: number, o: number, hd: number, e: number, au: number, ad: number): Record<Role, number> =>
    ({ anon: a, citizen: c, officer: o, head: hd, executive: e, auditor: au, admin: ad });
  const API: Row[] = [
    ['/api/officer/queue', 'GET', undefined, S(401, 403, 200, 200, 403, 403, 403)],
    ['/api/notifications', 'GET', undefined, S(401, 403, 200, 200, 403, 403, 403)],
    ['/api/dashboard?period=2026-12&service=ALL', 'GET', undefined, S(401, 403, 403, 403, 200, 403, 403)],
    ['/api/audit', 'GET', undefined, S(401, 403, 403, 403, 403, 200, 403)],
    ['/api/admin/services', 'GET', undefined, S(401, 403, 403, 403, 403, 403, 200)],
    ['/api/drafts', 'POST', { serviceId: 'SV-01', qty: 1 }, S(401, 201, 403, 403, 403, 403, 403)],
    [`/api/cases/${C(25)}`, 'GET', undefined, S(401, 200, 200, 200, 403, 403, 403)],
    [`/api/officer/cases/${C(28)}/claim`, 'POST', undefined, S(401, 403, 200, 403, 403, 403, 403)],
  ];
  for (const role of ROLES) {
    await h.reset();
    const a = role === 'anon' ? await h.anon() : await h.api(role === 'citizen' ? 'somying' : WHO[role]);
    for (const [url, method, data, want] of API) {
      const r = method === 'GET' ? await a.get(url) : await a.post(url, data === undefined ? {} : { data });
      expect(r.status(), `${role} ${method} ${url}`).toBe(want[role]);
    }
  }

  // ส่วน C ขอบเขตแผนก
  await h.reset();
  expect((await h.claim('off.works1', C(28))).status()).toBe(403);
  expect((await h.claim('off.reg1', C(10))).status()).toBe(403);
  const wq = await ok(await h.get('off.works1', '/api/officer/queue'));
  expect(wq.items.map((i: any) => i.caseNo)).toEqual([C(10)]);

  // ส่วน D เมนู
  const ALL_NAV = [...new Set(Object.values(NAV).flat())];
  for (const role of Object.keys(NAV) as Array<Exclude<Role, 'anon'>>) {
    await h.reset();
    const p = await h.page(WHO[role]);
    await p.goto(LANDING[role]);
    for (const n of ALL_NAV) await expect(tid(p, n), `${role} ${n}`).toHaveCount(NAV[role].includes(n) ? 1 : 0);
  }
});

test('TC-RBAC-05 สิทธิ์เปิด/ดาวน์โหลดไฟล์แนบ', async ({ h }) => {
  await h.reset();
  const ids = new Map<string, string>(); // caseNo -> fileId ตัวแรก (ได้จากผู้มีสิทธิ์)

  const allowed = async (who: string, n: number, names: string[]) => {
    const j = await ok(await h.get(who, `/api/cases/${C(n)}/files`));
    expect(j.items.map((f: any) => f.name).sort(), `${who} ${C(n)}`).toEqual([...names].sort());
    const fileId = j.items[0].fileId;
    ids.set(C(n), fileId);
    const r = await h.get(who, `/api/files/${fileId}`);
    expect(r.status(), `${who} file ${C(n)}`).toBe(200);
    expect(r.headers()['content-type']).toContain('application/pdf');
    expect((await r.body()).subarray(0, 4).toString()).toBe('%PDF');
  };
  const denied = async (who: string | null, n: number, code: number) => {
    const a = who ? await h.api(who) : await h.anon();
    expect((await a.get(`/api/cases/${C(n)}/files`)).status(), `${who} list ${C(n)}`).toBe(code);
    const fid = ids.get(C(n));
    expect(fid, `ต้องมี fileId ของ ${C(n)} ก่อน`).toBeTruthy();
    expect((await a.get(`/api/files/${fid}`)).status(), `${who} file ${C(n)}`).toBe(code);
  };
  const SV3 = ['id-card.pdf', 'plan.pdf', 'deed.pdf'];

  await allowed('off.reg1', 25, ['id-card.pdf']);
  await denied('off.works1', 25, 403);
  await allowed('off.reg2', 12, SV3);
  await denied('off.works1', 12, 403);
  await allowed('off.works1', 10, SV3);
  await allowed('off.reg1', 10, SV3);
  await allowed('off.works1', 11, SV3);
  await allowed('head1', 25, ['id-card.pdf']);
  await allowed('head1', 10, SV3);
  await allowed('head1', 12, SV3);
  await allowed('somying', 25, ['id-card.pdf']);
  await denied('somchai', 25, 404);
  for (const who of ['exec1', 'audit1', 'admin1']) await denied(who, 25, 403);
  await denied(null, 25, 401);
  expect((await h.get('off.reg1', '/api/files/999999999')).status()).toBe(404);

  // UI
  const p = await h.page('off.reg1');
  await p.goto(`/officer/cases/${C(25)}`);
  await expect(tid(p, 'doc-item')).toHaveCount(1);
  await expect(tid(p, 'doc-item')).toHaveAttribute('data-name', 'id-card.pdf');
  const href = await tid(p, 'doc-download-link').getAttribute('href');
  expect(href).toBeTruthy();
  const dl = await (await h.api('off.reg1')).get(href!);
  expect(dl.status()).toBe(200);
  expect((await dl.body()).length).toBeGreaterThan(0);

  const p2 = await h.page('off.reg2');
  await p2.goto(`/officer/cases/${C(12)}`);
  await expect(tid(p2, 'doc-item')).toHaveCount(3);
  const sy = await h.page('somying');
  await sy.goto(`/citizen/cases/${C(25)}`);
  await expect(tid(sy, 'doc-item')).toHaveCount(1);
});

/* ═════════════════════════ NFR ═════════════════════════ */

const NFR_PAGES: Array<[string | null, string]> = [
  [null, '/login'],
  ['somchai', '/citizen'],
  ['somchai', '/citizen/new/SV-03'],
  ['somchai', `/citizen/cases/${C(13)}`],
  ['off.reg1', '/officer/queue'],
  ['off.reg1', `/officer/cases/${C(20)}`],
  ['head1', '/head/approvals'],
  ['exec1', '/dashboard'],
  ['audit1', '/audit'],
  ['admin1', '/admin/services'],
  [null, '/verify/K7M2Q9XA'],
];

async function uiLoginCitizen(p: Page, idNo: string) {
  await p.goto('/login');
  await tid(p, 'login-tab-citizen').click();
  await tid(p, 'thaid-id-input').fill(idNo);
  await tid(p, 'thaid-submit').click();
  await tid(p, 'otp-input').fill(OTP);
  await tid(p, 'otp-submit').click();
  await expect(p).toHaveURL(/\/citizen/);
}

test('TC-NFR-01 Responsive 375 / 768 / 1280', async ({ h }) => {
  await h.reset();
  const sizes = [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ];
  const pages = new Map<string, Page>();
  const pageFor = async (who: string | null) => {
    const k = who ?? 'anon';
    if (!pages.has(k)) pages.set(k, who ? await h.page(who) : await h.anonPage());
    return pages.get(k)!;
  };
  for (const size of sizes) {
    for (const [who, url] of NFR_PAGES) {
      const p = await pageFor(who);
      await p.setViewportSize(size);
      await p.goto(url);
      const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(sw, `${size.width}px ${url} scrollWidth=${sw} innerWidth=${iw}`).toBeLessThanOrEqual(iw);
    }
  }

  // งานหลักที่ 375 px
  await h.reset();
  const p = await h.anonPage();
  await p.setViewportSize({ width: 375, height: 812 });
  await uiLoginCitizen(p, IDS.somchai);
  await tid(p, 'start-service-SV-01').click();
  await tid(p, 'qty-input').fill('1');
  await expect(tid(p, 'fee-total')).toHaveText('฿20');
  await tid(p, 'to-upload-btn').click();
  await expect(tid(p, 'wizard-step')).toHaveText('2/3 แนบเอกสาร');
  await tid(p, 'upload-input-id-card').setInputFiles({ name: 'id-card.pdf', mimeType: 'application/pdf', buffer: pdf() });
  await expect(tid(p, 'to-payment-btn')).toBeEnabled();
  await tid(p, 'to-payment-btn').click();
  await expect(tid(p, 'create-qr-btn')).toBeVisible();
  const box = await tid(p, 'create-qr-btn').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
});

const AXE_PAGES: Array<[string | null, string]> = [
  [null, '/login'],
  ['mana', '/register'],
  ['somchai', '/citizen'],
  ['somchai', '/citizen/new/SV-01'],
  ['somchai', `/citizen/cases/${C(17)}`],
  ['off.reg1', '/officer/queue'],
  ['off.reg1', `/officer/cases/${C(20)}`],
  ['head1', '/head/approvals'],
  ['exec1', '/dashboard'],
  ['audit1', '/audit'],
  ['admin1', '/admin/services'],
  ['off.reg1', '/notifications'],
  [null, '/verify/K7M2Q9XA'],
];

/** ส่วน D: สถานะ/ระดับเตือนมีข้อความตรงตาราง CONTRACT 4.1/4.2 */
async function checkStatusText(p: Page, label: string) {
  const items = await p
    .locator('[data-testid="case-status"],[data-testid="row-status"],[data-testid="sla-level"],[data-testid="row-sla-level"]')
    .evaluateAll((els) => els.map((e) => ({ s: e.getAttribute('data-status'), l: e.getAttribute('data-level'), t: (e.textContent ?? '').trim() })));
  for (const it of items) {
    expect(it.t, `${label} ข้อความว่าง`).not.toBe('');
    if (it.s) expect(it.t, `${label} ${it.s}`).toBe(STATUS_TH[it.s]);
    if (it.l) expect(it.t, `${label} ${it.l}`).toBe(LEVEL_TH[it.l]);
  }
}

test('TC-NFR-02 WCAG: axe + คีย์บอร์ด + label + สถานะไม่ใช้สีอย่างเดียว', async ({ h }) => {
  await h.reset();
  for (const [who, url] of AXE_PAGES) {
    const p = who ? await h.page(who) : await h.anonPage();
    await p.goto(url);
    // ส่วน A
    const res = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `axe ${url}`).toEqual([]);
    // ส่วน C
    const unnamed = await p.evaluate(() =>
      [...document.querySelectorAll('input,select,textarea')]
        .filter((e) => {
          const el = e as HTMLInputElement;
          if (el.type === 'hidden' || el.offsetParent === null) return false;
          const labelled = (el.labels && el.labels.length > 0) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
          return !labelled;
        })
        .map((e) => e.outerHTML.slice(0, 80)),
    );
    expect(unnamed, `label ${url}`).toEqual([]);
    // ส่วน D
    await checkStatusText(p, url);
    await p.emulateMedia({ forcedColors: 'active' });
    await checkStatusText(p, `${url} forced-colors`);
    await p.close();
  }

  // ส่วน B คีย์บอร์ดอย่างเดียว
  await h.reset();
  const p = await h.anonPage();
  const focusVisible = async () => {
    const st = await p.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const cs = getComputedStyle(e);
      return { o: cs.outlineStyle, s: cs.boxShadow };
    });
    expect(st.o !== 'none' || (st.s && st.s !== 'none'), `focus ring ${JSON.stringify(st)}`).toBe(true);
  };
  const tabTo = async (testid: string, max = 40) => {
    for (let i = 0; i < max; i++) {
      await p.keyboard.press('Tab');
      if ((await p.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === testid) {
        await focusVisible();
        return;
      }
    }
    throw new Error(`Tab ไม่ถึง ${testid}`);
  };
  await p.goto('/login');
  await tabTo('thaid-id-input');
  await p.keyboard.type(IDS.somchai);
  await p.keyboard.press('Enter');
  await expect(tid(p, 'otp-input')).toBeVisible();
  await tid(p, 'otp-input').focus();
  await p.keyboard.type(OTP);
  await p.keyboard.press('Enter');
  await expect(p).toHaveURL(/\/citizen$/);
  await tabTo('start-service-SV-01');
  await p.keyboard.press('Enter');
  await expect(tid(p, 'qty-input')).toBeVisible();
  await tabTo('qty-input');
  await p.keyboard.press('Control+A');
  await p.keyboard.type('1');
  await tabTo('to-upload-btn');
  await p.keyboard.press('Enter');
  await expect(tid(p, 'wizard-step')).toHaveText('2/3 แนบเอกสาร');
  await tid(p, 'upload-input-id-card').focus();
  await tid(p, 'upload-input-id-card').setInputFiles({ name: 'id-card.pdf', mimeType: 'application/pdf', buffer: pdf() });
  await expect(tid(p, 'to-payment-btn')).toBeEnabled();
  await tabTo('to-payment-btn');
  await p.keyboard.press('Enter');
  await expect(tid(p, 'create-qr-btn')).toBeVisible();
});

test('TC-NFR-03 Health เวลาโหลด และผลซ้ำได้', async ({ h, playwright }) => {
  // health (ไม่มี cookie)
  const bare = await playwright.request.newContext({ baseURL: process.env.BASE_URL || 'http://localhost:3000' });
  const hr = await bare.get('/api/health');
  expect(hr.status()).toBe(200);
  expect(await hr.json()).toEqual({ status: 'ok' });

  // นาฬิกาไม่มี offset
  const bad = await bare.put('/api/test/clock', { data: { now: '2026-12-01 09:00' } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).code).toBe('INVALID_TIME');
  await bare.dispose();

  // เวลาโหลด (รอบที่ 2)
  await h.reset();
  const urls: Array<[string | null, string]> = [[null, '/login'], ['somchai', '/citizen'], ['off.reg1', '/officer/queue'], ['exec1', '/dashboard'], ['audit1', '/audit']];
  for (const [who, url] of urls) {
    const p = who ? await h.page(who) : await h.anonPage();
    await p.goto(url, { waitUntil: 'load' });
    const t0 = Date.now();
    await p.goto(url, { waitUntil: 'load' });
    expect(Date.now() - t0, `load ${url}`).toBeLessThanOrEqual(3000);
  }

  // ผลซ้ำได้
  const snap = async () => {
    const anon = await h.anon();
    const clock = await ok(await anon.get('/api/test/clock'));
    const q = await ok(await h.get('off.reg1', '/api/officer/queue'));
    const queue = q.items.map((i: any) => ({ caseNo: i.caseNo, dueAt: i.dueAt, status: i.status, owner: i.owner }));
    const dash = await ok(await h.get('exec1', '/api/dashboard?period=2026-12&service=ALL'));
    return { clock, queue, dash };
  };
  await h.reset();
  const s1 = await snap();
  await h.clock('2026-12-10T12:00:00+07:00');
  await ok(await h.claim('off.reg1', C(28)));
  await h.newPaid();
  await h.reset();
  const s2 = await snap();
  expect(s2).toEqual(s1);
  expect(s1.clock.now).toBe(T0);
  test.info().annotations.push({ type: 'note', description: 'ปิด hook (TEST_MODE ว่าง → 404) ตรวจแยกด้วยมือ: เว็บรันได้ทีละโหมด' });
});

const CONTAINER = process.env.EGOV_CONTAINER || 'egov-eservice';

test('TC-NFR-04 เข้ารหัสข้อมูลส่วนบุคคลที่เก็บ (inspection)', async ({ h }) => {
  await h.reset();
  // มานะลงทะเบียน
  const mana = await h.api('mana');
  await ok(await mana.post('/api/auth/register', { data: { mobile: '0845678901', email: '', consent: true } }), 201);

  // คัดลอกไฟล์ฐานข้อมูล (+WAL) ออกจาก container แล้วค้นค่าตรงตัว
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-db-'));
  try {
    execSync(`docker cp ${CONTAINER}:/data/. "${dir}"`, { stdio: 'pipe' });
  } catch (e) {
    test.skip(true, `อ่านฐานข้อมูลจาก container ${CONTAINER} ไม่ได้: ${(e as Error).message}`);
  }
  let logs = '';
  try {
    logs = execSync(`docker logs ${CONTAINER}`, { stdio: 'pipe' }).toString();
  } catch {
    /* ไม่มี log ก็ตรวจเฉพาะฐานข้อมูล */
  }
  const blobs = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f)).toString('latin1'));
  blobs.push(Buffer.from(logs, 'utf8').toString('latin1'));
  const NEEDLES = [
    '1101700123456', '3100600987659', '1909900555015', '5500400111221',
    '0812345678', '0823456789', '0834567890', '0845678901',
    '1-1017-00123-45-6', '3-1006-00987-65-9', '1-9099-00555-01-5', '5-5004-00111-22-1',
  ];
  for (const n of NEEDLES) {
    const hits = blobs.reduce((acc, b) => acc + b.split(n).length - 1, 0);
    expect(hits, `พบ ${n} ในที่เก็บข้อมูล`).toBe(0);
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // ตัวควบคุมบวก
  const own = await ok(await h.get('somchai', `/api/cases/${C(5)}`));
  expect(own.idNo).toBe('1101700123456');
});
