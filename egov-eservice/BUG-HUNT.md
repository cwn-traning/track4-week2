# BUG-HUNT · B14 (รวมระบบ + BUG_MODE B01–B12)

## สถานะ: รันจริงแล้ว 2026-11-18 · Playwright 51/51 ในโหมดปกติ · BUG_MODE จับได้ครบ 12/12

- สภาพแวดล้อม: `docker compose up --build` (TEST_MODE=1, จำกัด 1 CPU / 512 MiB) · Playwright (chromium, workers=1)
- ชุดเทสต์: `part1.spec.ts` 17 TC · `part2.spec.ts` 23 TC · `part3.spec.ts` 11 TC = **51 TC ครบตาม TEST-PLAN**
- โหมดปกติ: **51 passed (≈1.1 นาที)**
- แต่ละบั๊ก: restart ด้วย `BUG_MODE=Bxx docker compose up -d --force-recreate` แล้วรันชุดเต็ม 51 TC

## สิ่งที่แก้ระหว่างรันจริง (บั๊กของระบบ ไม่ใช่ BUG_MODE)

| # | ปัญหา | ไฟล์ | วิธีแก้ |
|---|---|---|---|
| 1 | ไม่มีหน้า `/login` และ `/register` (มีแค่ API) ทุก TC ที่ล็อกอินผ่านจอค้างจน timeout | `app/src/auth-pages.js` (ใหม่) · `app/src/routes/01a-auth-pages.js` | สร้างหน้า ThaiD+OTP / SSO เจ้าหน้าที่ / ลงทะเบียน ตาม testid |
| 2 | สคริปต์ wizard พังตั้งแต่โหลด (`getElementById` หา `wizard-step` `fee-total` ไม่เจอ) | `app/src/citizen.js` | เพิ่ม `id` ที่ขาด |
| 3 | เปิดร่างที่สร้าง QR แล้วไม่แสดงสถานะ QR (เช่น หมดอายุ) | `app/src/citizen.js` | ร่าง PENDING_PAYMENT เปิดที่ขั้น 3 พร้อม QR ล่าสุด |
| 4 | ไม่บันทึก Audit `STAFF_LOGIN` | `app/src/auth.js` | INSERT audit ตอนเจ้าหน้าที่ล็อกอินสำเร็จ |
| 5 | ตาราง `/citizen` ล้นจอ 1px ที่ 375 px | `app/src/citizen.js` | ครอบตารางด้วยกล่องเลื่อน `.tw` |

เพิ่ม `app/tests/e2e/part3.spec.ts` (PDPA-01..03 · RBAC-01 02 03 05 · NFR-01..04) และ `app/tests/e2e/_harness.ts` (helper ร่วมที่คัดจาก part2) · devDependency `@axe-core/playwright`

## ตาราง triage (ตาม BUGS.md §4)

| บั๊ก | TC ที่คาดว่าล้ม | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผล |
|---|---|---|---|---|---|
| (ปกติ) | – | – (51 passed) | – | – | ✅ |
| B01 | TC-FEE-01 | TC-FEE-01 | – | – | ✅ จับได้ตรงจุด |
| B02 | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | ✅ จับได้ตรงจุด |
| B03 | TC-SLA-01 · TC-SLA-02 (อาจ TC-SLA-03 · TC-RBAC-04) | TC-SLA-01 · TC-SLA-02 · TC-SLA-03 · TC-RBAC-04 · TC-NOTI-02 | TC-NOTI-02 | – | ✅ จับได้ · NOTI-02 ล้มเพราะกำหนดเสร็จเลื่อน → ระดับเตือนเปลี่ยน (ผลข้างเคียงที่ยอมรับ) |
| B04 | TC-SLA-02 | TC-SLA-02 | – | – | ✅ จับได้ตรงจุด |
| B05 | TC-PAY-01 | TC-PAY-01 | – | – | ✅ จับได้ตรงจุด |
| B06 | TC-RBAC-01 | TC-RBAC-01 | – | – | ✅ จับได้ตรงจุด |
| B07 | TC-RBAC-02 | TC-RBAC-02 · TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | ✅ จับได้ · WORKFLOW-04 ยิง reject SV-02 ด้วย `off.reg2` คาด 403 ได้ 200 (บั๊กเดียวกัน) |
| B08 | TC-QUEUE-02 | TC-QUEUE-02 | – | – | ✅ จับได้ตรงจุด |
| B09 | TC-PDPA-02 | TC-PDPA-02 | – | – | ✅ จับได้ตรงจุด |
| B10 | TC-DASH-02 (อาจ TC-DASH-01 · TC-DASH-03) | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | – | – | ✅ จับได้ (สูตรเดียวกันทั้ง 3 TC) |
| B11 | TC-PDPA-03 · TC-AUDIT-01 | TC-PDPA-03 · TC-AUDIT-01 | – | – | ✅ จับได้ตรงจุด |
| B12 | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | ✅ จับได้ตรงจุด |
| B03,B07 | union B03 ∪ B07 | TC-SLA-01 · TC-SLA-02 · TC-SLA-03 · TC-NOTI-02 · TC-RBAC-04 · TC-RBAC-02 · TC-WORKFLOW-04 (7 failed · 44 passed) | – | – | ✅ เท่ากับ union พอดี |
| B01,B05,B09 | union B01 ∪ B05 ∪ B09 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 (3 failed · 48 passed) | – | – | ✅ เท่ากับ union พอดี |

### ตำแหน่งบั๊กที่ฝัง

| บั๊ก | ไฟล์:บรรทัด |
|---|---|
| B01 | `app/src/rules.js:64` |
| B02 | `app/src/citizen.js:54` |
| B03 | `app/src/rules.js:98` |
| B04 | `app/src/rules.js:159` |
| B05 | `app/src/payment.js:39` |
| B06 | `app/src/workflow.js:463, 616` |
| B07 | `app/src/workflow.js:223` |
| B08 | `app/src/payment.js:112, 118` |
| B09 | `app/src/workflow.js:597` |
| B10 | `app/src/dashboard.js:60` |
| B11 | `app/src/workflow.js:668` |
| B12 | `app/src/workflow.js:168, 173, 418` |

## ข้อจำกัดที่เหลือ

- TC-NFR-03 ข้อ "ปิด hook (TEST_MODE ว่าง → `/api/test/reset` 404)" ไม่ได้รันอัตโนมัติ (เว็บรันทีละโหมด) — ตรวจด้วยมือ: `TEST_MODE= docker compose up -d --force-recreate` แล้ว `curl -X POST localhost:3000/api/test/reset` ต้องได้ 404
- TC-NFR-04 อ่านฐานข้อมูลด้วย `docker cp egov-eservice:/data` — ถ้าไม่มี docker TC นี้จะ skip

## วิธีรันซ้ำ

```text
docker compose up --build -d                                   # TEST_MODE=1 เป็นค่าเริ่มต้น
cd app && npm install && npx playwright install chromium
npx playwright test --reporter=list                            # ต้อง 51 passed
BUG_MODE=B03 docker compose up -d --force-recreate && npx playwright test   # ต่อบั๊ก
BUG_MODE= docker compose up -d --force-recreate                # กลับโหมดปกติ
```
