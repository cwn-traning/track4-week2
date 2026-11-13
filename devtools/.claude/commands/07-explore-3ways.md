---
description: ขั้น 07 · กำหนด module (ถามยืนยัน) ลง qa.config.json แล้วสำรวจเว็บแบบฟัง 3 ทาง ([D] → [A] → [O]) ลง playwright/07-EXPLORATION.md ส่วน A–F แยกตาม module
argument-hint: "[URL เว็บ] [เฉพาะส่วน ABD หรือ CEF] [เฉพาะ module เช่น BOOK]"
---

โหลด skill `guide-oracle` และ `guide-testplan` ก่อน แล้วทำตามส่วน A–C ของ guide-testplan

Argument: $ARGUMENTS (ทุกอย่างไม่บังคับ ลำดับใดก็ได้)
- URL = baseURL (ว่าง = จาก qa.config.json → SPEC → DESIGN → http://localhost:3000)
- `ABD` / `CEF` = ทำเฉพาะส่วนนั้น · ว่าง = ครบ A–F (งานใหญ่ ทำ A B D ก่อนแล้วบอกให้รันอีกรอบด้วย `CEF`)
- รหัส module (เช่น `BOOK` หรือ `BOOK,MEM`) = สำรวจ/อัปเดตเฉพาะ module นั้น

ต้องมี `docs/02-REQUIREMENTS.md`, `docs/04-TEST-DATA.md` และเอกสารของเว็บ (`app/web/SPEC.md` หรือ path ใน DESIGN) · เช็ก health ก่อน ไม่ ok ให้หยุดบอก
ห้ามแก้โค้ดเว็บ · ผลที่คาดหวังห้ามมาจากโค้ด

ลำดับบังคับ
0. **Module**: ถ้ายังไม่มี `playwright/e2e/qa.config.json` → ร่างรายชื่อ module (id | folder | title | FR | BR) → **ถามผู้ใช้ยืนยัน** → เขียน qa.config.json · ถ้ามีแล้วใช้ต่อ
1. ฟังลูกค้า [D] (ยังไม่เปิดเว็บ): สิ่งที่ต้องเจอ + ตัวเลขที่คำนวณเอง แยกตาม module
2. ฟัง AI [A]: SPEC อ้างอะไร
3. ฟังเว็บ [O]: reset → Playwright MCP แท็บใหม่ → ทุกหน้า + งานหลัก + ภาษา + มือถือ 390px → ภาพ `playwright/exploration/<folder>/` → reset
4. ส่วน C: ฟอร์มทุกตัว · เงิน (คำนวณก่อน) · ขีดจำกัด · สถานะ (รีโหลด, กดซ้ำ 2 ครั้ง, logout/cookie เดิม, ตัวเลขที่ต้องอัปเดต) · reset ก่อนแต่ละกลุ่มเคส

ห้ามถือว่าหน้าจอถูก ขัดกับ [D]/[R] → ⚠️/❌ · ไม่แน่ใจลง "ยังไม่รู้"
สรุปเป็นตาราง: module | ส่วน | จำนวน | ✅ | ⚠️ | ❌ · ปิดท้าย command ถัดไป `/08-plan-test`

## ตัวอย่างการใช้
```text
/07-explore-3ways                                 ← ครั้งแรก: เสนอ module ให้ยืนยัน แล้วทำครบ A–F
/07-explore-3ways ABD                             ← รอบแรก แผนผัง + ฟีเจอร์ + ช่องว่าง
/07-explore-3ways CEF                             ← รอบสอง ล่ากฎ + ความเสี่ยง + คำถาม
/07-explore-3ways http://localhost:8080 ABD
/07-explore-3ways BOOK,MEM CEF                    ← ล่ากฎเฉพาะ 2 module ที่เพิ่งแก้
```
