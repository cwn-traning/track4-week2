# Test report · ขั้น 4 (TEST-PLAN 51 TC)

- ผลรอบสุดท้าย: **51/51 passed** · TEST_MODE=1 · BUG_MODE ว่าง · Playwright chromium · workers=1
- ไฟล์: `results.json` (JSON reporter) · `html/index.html` (HTML reporter) · `gif/` (GIF ของ TC ระดับ P1, ดู `gif/INDEX.txt`)
- สร้างซ้ำ: `cd app && REPORT=1 npx playwright test && sh scripts/make-gifs.sh`
- ประเภทที่ล้ม: **เว็บผิด** = แก้เว็บ · **test ผิด** = แก้ test ให้ตรงการ์ด (ไม่แก้ผลที่คาดหวัง) · **แผนผิด** = ไม่พบ (ไม่มีคำถามถึง TA)
- ★ = TC ที่ยังไม่มีในชุดเดิม เขียนเพิ่มใน `app/tests/e2e/part3.spec.ts` จากการ์ด TC

| TC | ไฟล์ | ผล | เวลา (s) | ประเภทที่ล้มระหว่างรอบแก้ | แก้อะไร | GIF |
|---|---|---|---|---|---|---|
| TC-AUTH-01 | part1.spec.ts | ✅ | 1.3 | เว็บผิด | ไม่มีหน้า /login /register (มีแค่ API) → สร้าง app/src/auth-pages.js | [gif](gif/TC-AUTH-01.gif) |
| TC-AUTH-02 | part1.spec.ts | ✅ | 0.8 | เว็บผิด | ไม่มีหน้า /login /register (มีแค่ API) → สร้าง app/src/auth-pages.js | [gif](gif/TC-AUTH-02.gif) |
| TC-AUTH-03 | part1.spec.ts | ✅ | 1.1 | เว็บผิด | ไม่มีหน้า /login /register (มีแค่ API) → สร้าง app/src/auth-pages.js | [gif](gif/TC-AUTH-03.gif) |
| TC-AUTH-04 | part1.spec.ts | ✅ | 3.0 | เว็บผิด | ไม่มีหน้า /login /register (มีแค่ API) → สร้าง app/src/auth-pages.js | P2 |
| TC-FEE-01 | part1.spec.ts | ✅ | 1.4 | เว็บผิด | wizard script พัง: ขาด id="wizard-step" id="fee-total" → เพิ่มใน app/src/citizen.js | [gif](gif/TC-FEE-01.gif) |
| TC-PAY-01 | part1.spec.ts | ✅ | 0.7 | เว็บผิด | wizard id ขาด + เปิดร่างที่มี QR แล้วไม่แสดงสถานะ QR → เปิดที่ขั้น 3 พร้อม QR ล่าสุด | [gif](gif/TC-PAY-01.gif) |
| TC-PAY-02 | part1.spec.ts | ✅ | 0.2 | – | – | API อย่างเดียว |
| TC-PAY-03 | part1.spec.ts | ✅ | 0.4 | – | – | API อย่างเดียว |
| TC-PAY-04 | part1.spec.ts | ✅ | 1.4 | เว็บผิด | สาเหตุเดียวกับ TC-FEE-01 | P2 |
| TC-QUEUE-01 | part1.spec.ts | ✅ | 2.1 | – | – | [gif](gif/TC-QUEUE-01.gif) |
| TC-QUEUE-02 | part1.spec.ts | ✅ | 1.8 | – | – | [gif](gif/TC-QUEUE-02.gif) |
| TC-QUEUE-03 | part1.spec.ts | ✅ | 1.7 | – | – | [gif](gif/TC-QUEUE-03.gif) |
| TC-SUBMIT-01 | part1.spec.ts | ✅ | 1.5 | เว็บผิด | สาเหตุเดียวกับ TC-FEE-01 | [gif](gif/TC-SUBMIT-01.gif) |
| TC-SUBMIT-02 | part1.spec.ts | ✅ | 2.2 | เว็บผิด | สาเหตุเดียวกับ TC-FEE-01 | [gif](gif/TC-SUBMIT-02.gif) |
| TC-SUBMIT-03 | part1.spec.ts | ✅ | 3.2 | เว็บผิด | สาเหตุเดียวกับ TC-FEE-01 | P2 |
| TC-UPLOAD-01 | part1.spec.ts | ✅ | 3.0 | เว็บผิด | สาเหตุเดียวกับ TC-FEE-01 | [gif](gif/TC-UPLOAD-01.gif) |
| TC-UPLOAD-02 | part1.spec.ts | ✅ | 1.7 | เว็บผิด | สาเหตุเดียวกับ TC-FEE-01 | [gif](gif/TC-UPLOAD-02.gif) |
| TC-AUDIT-01 | part2.spec.ts | ✅ | 1.3 | เว็บผิด | ไม่บันทึก Audit STAFF_LOGIN → เพิ่มใน app/src/auth.js (staff/login) | [gif](gif/TC-AUDIT-01.gif) |
| TC-AUDIT-02 | part2.spec.ts | ✅ | 0.3 | เว็บผิด | สาเหตุเดียวกับ TC-AUDIT-01 | [gif](gif/TC-AUDIT-02.gif) |
| TC-AUDIT-03 | part2.spec.ts | ✅ | 1.4 | เว็บผิด | สาเหตุเดียวกับ TC-AUDIT-01 | [gif](gif/TC-AUDIT-03.gif) |
| TC-DASH-01 | part2.spec.ts | ✅ | 0.3 | – | – | [gif](gif/TC-DASH-01.gif) |
| TC-DASH-02 | part2.spec.ts | ✅ | 0.5 | – | – | [gif](gif/TC-DASH-02.gif) |
| TC-DASH-03 | part2.spec.ts | ✅ | 0.9 | – | – | P2 |
| TC-DASH-04 | part2.spec.ts | ✅ | 0.7 | – | – | [gif](gif/TC-DASH-04.gif) |
| TC-DOC-01 | part2.spec.ts | ✅ | 0.6 | – | – | [gif](gif/TC-DOC-01.gif) |
| TC-DOC-02 | part2.spec.ts | ✅ | 0.2 | – | – | [gif](gif/TC-DOC-02.gif) |
| TC-DOC-03 | part2.spec.ts | ✅ | 1.6 | – | – | [gif](gif/TC-DOC-03.gif) |
| TC-NOTI-01 | part2.spec.ts | ✅ | 1.9 | – | – | [gif](gif/TC-NOTI-01.gif) |
| TC-NOTI-02 | part2.spec.ts | ✅ | 4.8 | – | – | [gif](gif/TC-NOTI-02.gif) |
| TC-RBAC-04 | part2.spec.ts | ✅ | 2.0 | – | – | P2 |
| TC-RBAC-06 | part2.spec.ts | ✅ | 1.3 | – | – | P2 |
| TC-SLA-01 | part2.spec.ts | ✅ | 2.8 | – | – | [gif](gif/TC-SLA-01.gif) |
| TC-SLA-02 | part2.spec.ts | ✅ | 2.2 | – | – | [gif](gif/TC-SLA-02.gif) |
| TC-SLA-03 | part2.spec.ts | ✅ | 2.8 | – | – | [gif](gif/TC-SLA-03.gif) |
| TC-WORKFLOW-01 | part2.spec.ts | ✅ | 1.8 | – | – | [gif](gif/TC-WORKFLOW-01.gif) |
| TC-WORKFLOW-02 | part2.spec.ts | ✅ | 2.3 | – | – | [gif](gif/TC-WORKFLOW-02.gif) |
| TC-WORKFLOW-03 | part2.spec.ts | ✅ | 1.8 | – | – | [gif](gif/TC-WORKFLOW-03.gif) |
| TC-WORKFLOW-04 | part2.spec.ts | ✅ | 2.3 | – | – | [gif](gif/TC-WORKFLOW-04.gif) |
| TC-WORKFLOW-05 | part2.spec.ts | ✅ | 2.5 | – | – | [gif](gif/TC-WORKFLOW-05.gif) |
| TC-WORKFLOW-06 | part2.spec.ts | ✅ | 0.9 | – | – | [gif](gif/TC-WORKFLOW-06.gif) |
| TC-NFR-01 ★ | part3.spec.ts | ✅ | 2.5 | เว็บผิด + test ผิด | เว็บ: ตาราง /citizen ล้น 1px ที่ 375 → ครอบ .tw · test: แนบไฟล์ก่อนสร้างร่างเสร็จ/วัดปุ่มก่อนแสดง → รอ wizard-step / toBeVisible | [gif](gif/TC-NFR-01.gif) |
| TC-NFR-02 ★ | part3.spec.ts | ✅ | 7.6 | test ผิด | แนบไฟล์ก่อนสร้างร่างเสร็จ → รอ wizard-step "2/3 แนบเอกสาร" | [gif](gif/TC-NFR-02.gif) |
| TC-NFR-03 ★ | part3.spec.ts | ✅ | 1.2 | – | – | P2 |
| TC-NFR-04 ★ | part3.spec.ts | ✅ | 0.6 | – | – | P2 |
| TC-PDPA-01 ★ | part3.spec.ts | ✅ | 0.8 | – | – | [gif](gif/TC-PDPA-01.gif) |
| TC-PDPA-02 ★ | part3.spec.ts | ✅ | 0.2 | – | – | API อย่างเดียว |
| TC-PDPA-03 ★ | part3.spec.ts | ✅ | 0.8 | – | – | [gif](gif/TC-PDPA-03.gif) |
| TC-RBAC-01 ★ | part3.spec.ts | ✅ | 0.2 | – | – | [gif](gif/TC-RBAC-01.gif) |
| TC-RBAC-02 ★ | part3.spec.ts | ✅ | 0.6 | – | – | [gif](gif/TC-RBAC-02.gif) |
| TC-RBAC-03 ★ | part3.spec.ts | ✅ | 5.9 | – | – | [gif](gif/TC-RBAC-03.gif) |
| TC-RBAC-05 ★ | part3.spec.ts | ✅ | 1.1 | – | – | [gif](gif/TC-RBAC-05.gif) |

## หมายเหตุ
- TC-NFR-03 ข้อ "ปิด hook (TEST_MODE ว่าง → 404)" ตรวจด้วยมือ (เว็บรันทีละโหมด) ดูวิธีใน `../BUG-HUNT.md`
- TC-NFR-04 inspection อ่านฐานข้อมูลด้วย `docker cp egov-eservice:/data` (ไม่มี docker = skip) · การเข้ารหัส: ดู `app/src/lib/crypto.js`
