---
description: รัน container devtools จาก image ai-vibecoding-devtools:week2 (มี Claude Code + Codex ในตัว)
argument-hint: "[โฟลเดอร์ที่มี workspace/ และ Devtool_SSH/ — ค่าเริ่มต้น ./devtools]"
---

สร้าง container `devtools` จาก image `ai-vibecoding-devtools:week2` (ต้อง build ด้วย `/02-build` ก่อน)

โฟลเดอร์ฐาน: `$ARGUMENTS` (ถ้าว่างให้ใช้ `./devtools`)

## ขั้นตอน

1. **ตรวจ image:** `docker images -q ai-vibecoding-devtools:week2` ถ้าว่างให้บอกผู้ใช้รัน `/02-build` แล้วหยุด
2. **ตรวจ container เดิม:** ถ้ามี container ชื่อ `devtools` อยู่แล้ว ให้ถามผู้ใช้ก่อนลบ (`docker rm -f devtools`) ไฟล์ใน `workspace/` บนเครื่องและบัญชีใน volume `devtools-ai-accounts` ไม่หาย · **ห้าม** ลบ volume `devtools-ai-accounts`
3. **ตรวจทรัพยากร:** ดู `docker info --format '{{.NCPU}} {{.MemTotal}}'` และ `docker stats --no-stream` แล้วสรุปสั้น ๆ ค่าเริ่มต้นคือจำกัด `--cpus 4 --memory 4g` ถ้าเครื่องมี RAM ว่างไม่ถึง 4GB บวกเผื่อ 20% ให้แจ้งและเสนอลดลง
4. **เลือกพอร์ต:** SSH เริ่มที่ `2222`, JupyterLab เริ่มที่ `8885` ถ้าพอร์ตถูกใช้อยู่ (ดูจาก `docker ps --format '{{.Ports}}'` และ `netstat -ano`) ให้ใช้เลขว่างถัดไป
5. **รัน container** ใน PowerShell จากโฟลเดอร์ฐาน (ใช้ path แบบ absolute ใน `-v`):
   ```powershell
   docker run -dit --name devtools --hostname devtools --privileged --cpus 4 --memory 4g --memory-swap 8g `
     -p <SSH_PORT>:22 -p <JUPYTER_PORT>:8888 `
     -v "${PWD}/Devtool_SSH:/etc/devtools/ssh" -v "${PWD}/workspace:/workspace" `
     -v devtools-ai-accounts:/root/ai-accounts `
     ai-vibecoding-devtools:week2
   ```
   `--privileged` จำเป็นเพราะ container รัน Docker-in-Docker
   `devtools-ai-accounts` = named volume เก็บบัญชี Claude/Codex หลายบัญชี (Docker สร้างให้เองถ้ายังไม่มี และ `docker-compose.yml` ก็ใช้ชื่อเดียวกันแบบ external)
6. **ตรวจว่ายังรันอยู่:** `docker ps --filter name=devtools --format '{{.Status}}'` ถ้า Exited ให้ดู `docker logs devtools` ถ้าเห็น `start.sh: no such file or directory` แปลว่า start.sh เป็น CRLF ให้แก้แล้ว `/02-build` ใหม่
7. **ตรวจเวอร์ชัน** ด้วย PATH พื้นฐาน (จำลอง terminal ใหม่) — Claude Code และ Codex ติดตั้งมาใน image แล้ว ไม่ต้องติดตั้งเพิ่ม:
   ```bash
   docker exec devtools env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin bash -c 'claude --version; codex --version; python --version; node --version; git --version'
   ```
   ถ้าไม่เจอ `claude` หรือ `codex` แปลว่า image เก่ากว่า Dockerfile ปัจจุบัน ให้รัน `/02-build` ใหม่
8. **คืนค่าระบบหลายบัญชี:** ถ้ามีไฟล์ `/root/ai-accounts/bin/install-multi-account.sh` (แปลว่า volume มีข้อมูลจากรอบก่อน) ให้รันหนึ่งครั้ง เพื่อสร้าง wrapper `clp1–5`/`cop1–5` และ library ของ Chromium คืน แล้วตรวจว่า `clp1 --version` และ `cop1 --version` ทำงาน:
   ```bash
   docker exec devtools bash -c 'f=/root/ai-accounts/bin/install-multi-account.sh; if [ -x "$f" ]; then "$f" | tail -3; clp1 --version; cop1 --version; else echo "ยังไม่ได้ตั้งค่าหลายบัญชี — ใช้ /devtools:04-multi-account"; fi'
   ```
9. **สรุปให้ผู้ใช้:** ตารางเวอร์ชัน, JupyterLab `http://localhost:<JUPYTER_PORT>` (ไม่มีรหัสผ่าน), SSH `ssh -i Devtool_SSH/devtoolSSH root@localhost -p <SSH_PORT>` (หรือรหัสผ่าน `passwd`), และไฟล์ใน `/workspace` อยู่ที่ `<โฟลเดอร์ฐาน>/workspace` บนเครื่อง
