---
description: ขั้น 10 · แปลง 08-TEST-PLAN.md เป็น Playwright 3 เบราว์เซอร์ใน playwright/e2e/ (core + tests/<module>) + GIF/MP4 + รายงาน index.html ตัดสินตามเกณฑ์ Exit
argument-hint: "[เฉพาะ module/TC เช่น BOOK หรือ TC-PRICE-04] [run-only]"
---

โหลด skill `guide-oracle` และ `guide-evidence` ก่อน แล้วทำตามส่วน A–E ของ guide-evidence

ต้องมี `playwright/08-TEST-PLAN.md` ครบ 8 หัวข้อ และ `playwright/e2e/qa.config.json` ถ้าไม่ครบให้หยุดบอกให้รัน `/09-plan-review`
Argument: $ARGUMENTS
- ว่าง = ทุก TC · ถ้ามี `playwright/e2e/` อยู่แล้ว เพิ่ม/อัปเดตเฉพาะ TC ที่ขาดหรือเปลี่ยนในแผน
- รหัส module (`BOOK`) หรือ TC (`TC-PRICE-04`) = เขียน/รันเฉพาะส่วนนั้น
- `run-only` = ไม่เขียน test ใหม่ แค่รัน + จำแนก + สร้างรายงาน

ห้ามแก้โค้ดเว็บ · ห้ามเปลี่ยน expected ตามที่เว็บแสดง

1. เช็กความพร้อม (node, ffmpeg, health จาก qa.config) ไม่พร้อมให้หยุด
2. ตั้ง `playwright/e2e/` (config, `core/` ทั้งชุด — มีอยู่แล้วใช้ของเดิม)
3. เขียน 2 test แรก (ต่าง module) → รันผ่าน + ได้ GIF/MP4 → เขียนที่เหลือทีละ module ใน `tests/<folder>/`
4. รัน `npx playwright test` 2 รอบ (เช็กผลนิ่ง) แล้ว `npm run test:gif`
5. ข้อที่ล้ม: ดูภาพ/GIF → จำแนก web-bug / test-bug / plan-issue → `triage.json` → `npm run report` · แก้ได้เฉพาะ test-bug
6. เขียน/อัปเดต `CLAUDE.md` ที่ root ของโปรเจกต์: โครง docs/app/playwright · คำสั่งเปิด/ปิดระบบ (PowerShell) · วิธีรันทั้งหมด/ราย module/ราย TC · วิธีเพิ่ม test

สรุปเป็นตาราง: เบราว์เซอร์ | P1 ผ่าน | ผ่านรวม | ผ่านเกณฑ์ไหม · module | ผ่าน/ทั้งหมด | ข้อที่ล้ม · จำนวน GIF | MP4 · ผลนิ่งไหม
ปิดท้าย: ถ้ามี web-bug หรือ plan-issue → `/11-prove-bugs`

## ตัวอย่างการใช้
```text
/10-prove-e2e                     ← ครั้งแรก สร้างชุดทดสอบทั้งหมด
/10-prove-e2e BOOK                ← เขียน/อัปเดตเฉพาะ module จองคิว
/10-prove-e2e TC-PRICE-04         ← แก้ test ข้อเดียว
/10-prove-e2e run-only            ← เว็บมีเวอร์ชันใหม่ รันซ้ำทั้งหมด
/10-prove-e2e BOOK run-only       ← รันซ้ำเฉพาะ module
```
