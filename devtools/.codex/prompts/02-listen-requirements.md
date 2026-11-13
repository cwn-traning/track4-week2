---
description: ขั้น 02 · แปลง docs/01-USER-STORIES.md เป็น docs/02-REQUIREMENTS.md (FR / BR + ค่าขอบ 3 ค่า / NFR + วิธีวัด)
argument-hint: "[เรื่องที่อยากเน้น เช่น 'เน้นกฎเงิน' หรือ NFR เพิ่ม]"
---

> Codex: ไฟล์นี้สร้างจาก `.claude/commands/02-listen-requirements.md` (อย่าแก้ตรงนี้ — แก้ต้นฉบับแล้วรัน `scripts/sync-codex-prompts.sh`) — ทำตามกติกาแปลงใน `AGENTS.md` หัวข้อ 0 ("โหลด skill `X`" = อ่าน `.claude/skills/X/SKILL.md` ทั้งไฟล์ก่อนลงมือ · "ถามผู้ใช้" = หยุดรอคำตอบ) และจบงานด้วย Completion report format ใน `AGENTS.md`


โหลด skill `guide-oracle` และ `guide-requirement` ก่อน แล้วทำตามส่วน B ของ guide-requirement

ต้องมี `docs/01-USER-STORIES.md` ถ้าไม่มีให้หยุด แล้วบอกให้รัน `/01-listen-stories`
คำสั่งเพิ่มจากผู้ใช้: $ARGUMENTS (ว่าง = ทำตามมาตรฐาน)

เขียน `docs/02-REQUIREMENTS.md` 3 ตาราง
1. FR-xx ระบบต้องทำอะไรได้
2. BR-xx กฎธุรกิจ ทุกข้อมีตัวเลข + คอลัมน์ "ค่าขอบที่ต้องทดสอบ" (ต่ำกว่า / ที่ขอบ / เกินขอบ) · ต้องมี BR ลำดับการคิดเงินถ้ามีส่วนลดหลายแบบ
3. NFR-xx ทุกข้อมีคอลัมน์ "วิธีวัด" · ต้องมี NFR ด้านทดสอบได้ 4 ข้อ (กฎตายตัว · reset ข้อมูล · ล็อกเวลา · test id)

ทุกข้อมีคอลัมน์ "มาจาก US ไหน" · ท้ายไฟล์ตาราง US | FR | BR | ✅/❌ (ห้ามมี ❌)
ค่าที่ลูกค้ายังไม่บอกชัด → ⚠️ + สมมติฐาน ห้ามเดาเงียบ ๆ · ตารางสมมติฐานท้ายไฟล์โยง "คำถามที่ยังไม่ชัด" ใน docs/01
สรุปเป็นตาราง: ชนิด | จำนวน | ตัวอย่าง 1 ข้อ · ปิดท้าย command ถัดไป `/03-listen-design`

## ตัวอย่างการใช้
```text
/02-listen-requirements
/02-listen-requirements เน้นกฎเงินและส่วนลดซ้อนกันให้ละเอียด
/02-listen-requirements เพิ่ม NFR: รองรับ 200 ผู้ใช้พร้อมกัน, PDPA ห้ามเก็บเลขบัตรประชาชน
```
