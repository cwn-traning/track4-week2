---
description: ขั้น 03 · เขียน docs/03-DESIGN.md (Architecture · Use Case · Flowchart · ERD · Sequence ด้วย Mermaid) ก่อนเขียนโค้ด
argument-hint: "[stack ที่ต้องการ หรือ 'มีเว็บอยู่แล้วที่ <path>']"
---

โหลด skill `guide-oracle` และ `guide-diagram` ก่อน · ขั้นนี้ **ห้ามเขียนโค้ดเว็บ**

ต้องมี `docs/01-USER-STORIES.md` และ `docs/02-REQUIREMENTS.md` ถ้าไม่มีให้หยุดบอก command ที่ต้องรันก่อน

Stack: $ARGUMENTS
- ว่าง: ดูว่ามีโค้ดใน `app/` อยู่แล้วไหม ถ้าไม่มีให้ **ถามผู้ใช้** โดยเสนอค่าเริ่มต้น (Next.js App Router + TypeScript · PostgreSQL 16 · Docker แยก `app/db` / `app/web` ผ่าน network · Playwright)
- "มีเว็บอยู่แล้วที่ <path>": วาดตามของจริง (อ่านโค้ดได้) ระบุส่วนที่ต่างจาก REQUIREMENTS เป็นคำถาม และจด path นั้นไว้หัวไฟล์ (ใช้เป็น `appPath` ตอน /07)
- บันทึก stack ชื่อ container พอร์ต ไว้หัวไฟล์

เขียน `docs/03-DESIGN.md` ภาษาไทย ครบ 5 ส่วนตาม guide-diagram + "คำถามที่ได้จากการออกแบบ" ท้ายไฟล์
ตรวจว่าทุกแผนภาพ render ได้จริง · สรุปเป็นตาราง: แผนภาพ | จำนวน | ครอบคลุม FR/BR ไหน · ปิดท้าย command ถัดไป `/04-listen-testdata`

## ตัวอย่างการใช้
```text
/03-listen-design                                         ← ให้ถาม/เสนอ stack
/03-listen-design Next.js + PostgreSQL + Docker
/03-listen-design Laravel 11 + MySQL 8 + Docker
/03-listen-design มีเว็บอยู่แล้วที่ ../shop-legacy (PHP + MySQL)
```
