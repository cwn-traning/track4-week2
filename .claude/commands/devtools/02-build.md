---
description: Build image ai-vibecoding-devtools:week2 จากไฟล์ที่ /scaffold สร้างไว้
argument-hint: "[โฟลเดอร์ที่มี Dockerfile — ค่าเริ่มต้น ./devtools]"
---

Build image `ai-vibecoding-devtools:week2` ในเครื่อง ห้าม pull image สำเร็จรูปจาก Docker Hub (เช่น `tuchsanai/devtools`)

โฟลเดอร์ build: `$ARGUMENTS` (ถ้าว่างให้ใช้ `./devtools`)

## ขั้นตอน

1. ตรวจว่า Docker ทำงานอยู่: `docker version --format '{{.Server.Version}}'` ถ้า error ให้บอกผู้ใช้เปิด Docker Desktop แล้วหยุด
2. ตรวจว่าโฟลเดอร์มี `Dockerfile`, `start.sh`, `jupyter_overrides.json` ครบ ถ้าไม่ครบให้บอกผู้ใช้รัน `/01-scaffold` ก่อนแล้วหยุด
3. ตรวจว่า `start.sh` เป็น LF (`file start.sh` ต้องไม่มีคำว่า CRLF) ถ้าเป็น CRLF ให้แปลงด้วย `sed -i 's/\r$//' start.sh` ก่อน build
4. Build (ครั้งแรกใช้หลายนาที ตั้ง timeout 10 นาที):
   ```bash
   docker build -t ai-vibecoding-devtools:week2 <โฟลเดอร์>
   ```
5. ยืนยันด้วย `docker images ai-vibecoding-devtools` แล้วรายงานขนาด image และแนะนำให้รัน `/03-run` ต่อ
