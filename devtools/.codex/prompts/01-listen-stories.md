---
description: ขั้น 01 · แปลงบันทึก interview ลูกค้าเป็น docs/01-USER-STORIES.md (เกณฑ์ยอมรับตรวจได้ + Must/Should/Could)
argument-hint: "<path ไฟล์ interview หรือวางข้อความ interview ต่อท้าย>"
---

> Codex: ไฟล์นี้สร้างจาก `.claude/commands/01-listen-stories.md` (อย่าแก้ตรงนี้ — แก้ต้นฉบับแล้วรัน `scripts/sync-codex-prompts.sh`) — ทำตามกติกาแปลงใน `AGENTS.md` หัวข้อ 0 ("โหลด skill `X`" = อ่าน `.claude/skills/X/SKILL.md` ทั้งไฟล์ก่อนลงมือ · "ถามผู้ใช้" = หยุดรอคำตอบ) และจบงานด้วย Completion report format ใน `AGENTS.md`


โหลด skill `guide-oracle` และ `guide-requirement` ก่อน แล้วทำตามส่วน A ของ guide-requirement

Input (บันทึก interview): $ARGUMENTS
- เป็น path → อ่านไฟล์นั้น แล้วคัดลอกเนื้อหาเก็บเป็น `docs/00-INTERVIEW.md` (ถ้ายังไม่ใช่ไฟล์นี้)
- เป็นข้อความ → บันทึกเป็น `docs/00-INTERVIEW.md`
- ว่าง → ใช้ `docs/00-INTERVIEW.md` ถ้าไม่มีให้ **หยุดถามผู้ใช้**
- ถ้า `docs/00-INTERVIEW.md` มีอยู่แล้วและเนื้อหาต่างกัน ให้ถามก่อนเขียนทับ

เขียน `docs/01-USER-STORIES.md`
1. User Story "ในฐานะ… ฉันอยาก… เพื่อ…" ครบทุกเรื่องที่ทุกคนพูด รหัส US-01, US-02, …
2. เกณฑ์ยอมรับ 1–2 ข้อต่อ story ที่ตรวจได้ (ตัวเลข/ข้อความชัด มีกรณีขอบ)
3. ป้าย Must / Should / Could
4. ท้ายไฟล์ "คำถามที่ยังไม่ชัด" Q1, Q2, … (รวมข้อขัดแย้งใน interview)

ภาษาไทยง่าย ๆ ใน story ห้ามศัพท์โปรแกรม
สรุปเป็นตาราง: รหัส | เรื่อง | ใครขอ | ความสำคัญ + นับ Must/Should/Could · ปิดท้าย "ไปต่อได้เมื่อ" และ command ถัดไป `/02-listen-requirements`

## ตัวอย่างการใช้
```text
/01-listen-stories                              ← ใช้ docs/00-INTERVIEW.md ที่วางไว้แล้ว
/01-listen-stories notes/meeting-2026-11-07.md  ← จากไฟล์บันทึกประชุม
/01-listen-stories 👩‍💼 คุณแดง (เจ้าของร้านกาแฟ)
- เปิด 7:00–18:00 สั่งล่วงหน้าได้ 1 วัน
- ซื้อครบ 10 แก้วแถม 1 ...                      ← วางข้อความ interview ตรง ๆ
```
