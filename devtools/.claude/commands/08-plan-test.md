---
description: ขั้น 08 · เขียน playwright/08-TEST-PLAN.md หัวข้อ 1–5 (TC-<MOD>-xx โยง FR/BR + ที่มา แยกตาม module) แล้วลองทุกข้อกับเว็บจริงลง 08-TEST-RUN-1.md
argument-hint: "[จำนวน TC โดยประมาณ] [เฉพาะ module เช่น BOOK]"
---

โหลด skill `guide-oracle` และ `guide-testplan` ก่อน แล้วทำตามส่วน D ของ guide-testplan

ต้องมี `docs/02-REQUIREMENTS.md`, `docs/04-TEST-DATA.md`, `playwright/07-EXPLORATION.md` (ส่วน B, C, E) และ `playwright/e2e/qa.config.json` ถ้าไม่ครบให้หยุดบอก command ที่ต้องรันก่อน
Argument: $ARGUMENTS
- ตัวเลข = จำนวน TC โดยประมาณ (ว่าง = ~30–40 หรือตามขนาดระบบ)
- รหัส module = เขียน/อัปเดตเฉพาะหัวข้อย่อยของ module นั้น (หัวข้อ 1–4 อัปเดตตัวเลขรวมให้ตรง)

1. สร้าง `playwright/08-TEST-PLAN.md` 8 หัวข้อ เขียนหัวข้อ 1–5 (6–8 ใส่ชื่อ + "ยังไม่เขียน")
2. หัวข้อ 2 ไม่แน่ใจเรื่องขอบเขตให้ **ถามผู้ใช้** แล้วจดตาราง คำถาม | คำตอบที่ใช้
3. หัวข้อ 5 แยกตาม module: expected ตรวจได้ · เงินมีวิธีคิด · ที่มามี [D]/[R] ไม่งั้น `[O-ยังไม่ยืนยัน]` + เพิ่มใน 07-EXPLORATION ส่วน F · มีคอลัมน์ "จังหวะตรวจ" และ "spec file"
4. ลองทุกข้อกับเว็บจริงด้วย Playwright MCP (reset ก่อนทุก TC) → `playwright/08-TEST-RUN-1.md`: module | ID | ผลที่คาดหวัง | เว็บจริง | ตรงไหม
   ไม่ตรง → ⚠️ + บอกว่าคิดว่าเว็บผิดหรือแผนเข้าใจผิด เพราะอะไร · **ห้ามแก้ expected ตามเว็บ**

สรุปท้าย: module | TC | P1 | P2 | P3 + นับตามที่มา [D] / [R] / [O-ยังไม่ยืนยัน] + ผลลอง ตรง/⚠️
ปิดท้าย command ถัดไป `/09-plan-review`

## ตัวอย่างการใช้
```text
/08-plan-test
/08-plan-test 60                  ← ระบบใหญ่ ขอ ~60 TC
/08-plan-test BOOK                ← เพิ่ม/อัปเดต TC เฉพาะ module จองคิว
/08-plan-test 15 PAY              ← module ใหม่ ขอ ~15 TC
```
