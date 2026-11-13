---
description: ขั้น 00 · เช็กเครื่องว่าพร้อมสำหรับ workflow interview → เว็บที่พิสูจน์ได้ (อ่านอย่างเดียว)
argument-hint: "[พอร์ตที่จะใช้ เช่น 3000,5433]"
---

> Codex: ไฟล์นี้สร้างจาก `.claude/commands/00-check-machine.md` (อย่าแก้ตรงนี้ — แก้ต้นฉบับแล้วรัน `scripts/sync-codex-prompts.sh`) — ทำตามกติกาแปลงใน `AGENTS.md` หัวข้อ 0 ("โหลด skill `X`" = อ่าน `.claude/skills/X/SKILL.md` ทั้งไฟล์ก่อนลงมือ · "ถามผู้ใช้" = หยุดรอคำตอบ) และจบงานด้วย Completion report format ใน `AGENTS.md`


โหลด skill `guide-oracle` ก่อน แล้วตรวจเครื่อง **อ่านอย่างเดียว ห้ามติดตั้งหรือแก้อะไร** ทุกค่าต้องมาจากคำสั่งที่รันจริง

พอร์ตที่จะใช้: $ARGUMENTS (ว่าง = อ่านจาก `playwright/e2e/qa.config.json` / `docs/03-DESIGN.md` ถ้ามี ไม่งั้นใช้ 3000 และ 5433)

1. Docker: `docker version` และ `docker compose version` (ถ้า DESIGN ระบุ stack ที่ไม่ใช้ Docker ให้เช็ก runtime นั้นแทน)
2. Node.js: `node -v` (≥ 20) และ `npm -v`
3. `ffmpeg -version` (ใช้ทำ GIF + MP4)
4. `claude mcp list` ว่า playwright ขึ้น Connected ไหม
5. `codex --version` (ไม่บังคับ ใช้สร้างรูป ไม่มีจะใช้ SVG แทน)
6. พอร์ตว่างไหม ถ้ามี container/โปรแกรมใช้อยู่ให้บอกชื่อ (ยังไม่ต้องปิด)
7. โครงโฟลเดอร์ `docs/ app/ playwright/` มีแล้วหรือยัง (ยังไม่มี = ปกติสำหรับโปรเจกต์ใหม่)

สรุปเป็นตาราง: รายการ | ผล | พร้อมไหม | ถ้าไม่พร้อมต้องทำอะไร
ปิดท้าย: ไปต่อได้ไหม และ command ถัดไปคือ `/01-listen-stories`

## ตัวอย่างการใช้
```text
/00-check-machine
/00-check-machine 3000,5433
/00-check-machine 8080,5434        ← โปรเจกต์ที่ใช้พอร์ตอื่น
```
