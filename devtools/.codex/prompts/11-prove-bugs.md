---
description: ขั้น 11 · ยืนยันบั๊กจริงจากผล e2e เขียน playwright/11-BUG-HUNT.md (รายงานบั๊กราย module · วิเคราะห์ oracle · ช่องโหว่ของแผน · คำตัดสินพร้อมใช้งานไหม)
argument-hint: "[rerun] [เฉพาะ module เช่น BOOK]"
---

> Codex: ไฟล์นี้สร้างจาก `.claude/commands/11-prove-bugs.md` (อย่าแก้ตรงนี้ — แก้ต้นฉบับแล้วรัน `scripts/sync-codex-prompts.sh`) — ทำตามกติกาแปลงใน `AGENTS.md` หัวข้อ 0 ("โหลด skill `X`" = อ่าน `.claude/skills/X/SKILL.md` ทั้งไฟล์ก่อนลงมือ · "ถามผู้ใช้" = หยุดรอคำตอบ) และจบงานด้วย Completion report format ใน `AGENTS.md`


โหลด skill `guide-oracle` และ `guide-evidence` ก่อน แล้วทำตามส่วน F ของ guide-evidence

ต้องมี `playwright/e2e/` ที่รันแล้ว (`triage.json` หรือ test-results) ถ้าไม่มีให้หยุดบอกให้รัน `/10-prove-e2e`
Argument: $ARGUMENTS
- `rerun` = เก็บผลเดิมไว้ที่ `playwright/e2e/history/<วันเวลา>/` แล้วรัน `npx playwright test` + `npm run test:gif` ใหม่ (ใช้หลังคนสร้างแก้บั๊ก) · เทียบกับรอบก่อน: บั๊กไหนหาย / ยังอยู่ / ใหม่
- รหัส module = วิเคราะห์เฉพาะ module นั้น (ส่วนอื่นของ BUG-HUNT คงไว้)

ห้ามแก้โค้ดเว็บ · ห้ามแก้ test หรือแผนให้ผ่านเฉย ๆ

1. รวม TC ที่เป็น web-bug ตามสาเหตุเดียวกัน → BUG-xx (เลขต่อจากเดิม ถ้ามีไฟล์อยู่แล้ว)
2. ยืนยันซ้ำแต่ละบั๊กด้วย Playwright MCP (reset ก่อน) และเช็กว่า หน้าจอ / API / DB ผิดตรงกันไหม (DB อ่านอย่างเดียว)
3. ส่วนที่ 1 ตารางบั๊ก (มีคอลัมน์ module) + เทียบหัวข้อ 8 ของแผน
4. ส่วนที่ 2 วิเคราะห์ oracle: [D]/[R] vs [A] vs [O]
5. ส่วนที่ 3 ช่องโหว่ของแผนราย module + TC ที่ควรเพิ่ม
6. ส่วนที่ 4 ส่งต่อ: สรุปราย module · รายงานบั๊กให้คนสร้าง · คำถามถึงลูกค้า · คำตัดสินตามเกณฑ์ Exit

สรุป: module | บั๊ก P1/P2/P3 | plan-issue · ผ่านเกณฑ์ไหม
ปิดท้าย: มี TC ที่ควรเพิ่มหรือ plan-issue → `/09-plan-review from-bughunt` · หลังคนสร้างแก้บั๊ก → `/11-prove-bugs rerun`

## ตัวอย่างการใช้
```text
/11-prove-bugs                    ← หลัง /10 มี test ล้ม
/11-prove-bugs BOOK               ← ดูบั๊กเฉพาะ module จองคิว
/11-prove-bugs rerun              ← dev แก้แล้ว รันใหม่ + เทียบรอบก่อน
/11-prove-bugs rerun PAY          ← dev แก้เฉพาะ module ชำระเงิน
```
