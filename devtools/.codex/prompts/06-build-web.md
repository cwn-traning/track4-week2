---
description: ขั้น 06 · สร้างเว็บใน app/ ตาม docs/05-BUILD-PROMPT.md จนเปิดได้และ health ok (ควรรันในเซสชันใหม่)
argument-hint: "[resume = ทำต่อจากที่ค้าง]"
---

> Codex: ไฟล์นี้สร้างจาก `.claude/commands/06-build-web.md` (อย่าแก้ตรงนี้ — แก้ต้นฉบับแล้วรัน `scripts/sync-codex-prompts.sh`) — ทำตามกติกาแปลงใน `AGENTS.md` หัวข้อ 0 ("โหลด skill `X`" = อ่าน `.claude/skills/X/SKILL.md` ทั้งไฟล์ก่อนลงมือ · "ถามผู้ใช้" = หยุดรอคำตอบ) และจบงานด้วย Completion report format ใน `AGENTS.md`


โหลด skill `guide-oracle` และ `guide-testable-web` ก่อน

อ่าน `docs/05-BUILD-PROMPT.md` ถ้าไม่มีให้หยุดบอกให้รัน `/05-build-prompt`
**BUILD-PROMPT คือคำสั่งหลักของขั้นนี้ ทำตามทุกขั้นตามลำดับ** · guide-testable-web ใช้ตรวจว่าไม่ขาดอะไร
Argument: $ARGUMENTS
- `resume` = ตรวจไฟล์ที่มีแล้วใน `app/` ทำต่อเฉพาะส่วนที่ขาด

ข้อกำหนดเพิ่ม
- โค้ดอยู่ใน `app/db/` และ `app/web/` เท่านั้น
- ก่อนเปิด container: ทำ checklist ทรัพยากรเครื่อง (CPU/RAM/disk + ตั้ง limit) และเช็กพอร์ต · พอร์ตชนให้ **ถามก่อน** stop อะไร
- ถ้า `app/` มีโค้ดอยู่แล้วและไม่ได้สั่ง `resume` ให้ถามก่อนเขียนทับ
- ขั้นไหนไม่ผ่าน (build ล้ม, ไม่ healthy) ให้แก้ตามสาเหตุ ถ้าแก้ไม่ได้ให้หยุดบอก ห้ามรายงานว่าผ่าน
- ผลตรวจตัวเอง "ผ่าน X/Y" ให้ระบุว่าเป็นคำอ้าง **[A]** ยังไม่ใช่การพิสูจน์

สรุปเป็นตาราง: ส่วน | ผล (container · health · reset · ล็อกเวลา · จำนวนหน้า/API · test id · รูป · SPEC.md · ตรวจตัวเอง X/Y) + สมมติฐานที่ผู้สร้างตั้งเอง (ต้องถามลูกค้า)
ปิดท้าย command ถัดไป `/07-explore-3ways`

## ตัวอย่างการใช้
```text
/clear
/06-build-web              ← สร้างใหม่ทั้งหมด (แนะนำเซสชันใหม่)
/06-build-web resume       ← Claude หยุดกลางทาง ให้ทำต่อเฉพาะที่ขาด
```
