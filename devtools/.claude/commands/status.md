---
description: ดูว่า workflow interview → เว็บที่พิสูจน์ได้ ทำถึงขั้นไหนแล้ว (docs / app / playwright ราย module) ขาดไฟล์อะไร และ command ถัดไปคืออะไร (อ่านอย่างเดียว)
argument-hint: "[โฟลเดอร์โปรเจกต์] [module]"
---

โหลด skill `guide-oracle` ก่อน · **อ่านอย่างเดียว ห้ามแก้ไฟล์**

Argument: $ARGUMENTS
- path = root ของโปรเจกต์ (ว่าง = โฟลเดอร์ปัจจุบัน)
- รหัส module = ดูละเอียดเฉพาะ module นั้น

1. ตรวจตามโครงข้อ 1 ของ guide-oracle:
   - `docs/00`–`05` มีไหม และ "ไปต่อได้เมื่อ" ครบไหม (เช่น docs/02 มีตาราง US|FR|BR ไม่มี ❌)
   - `app/` (หรือ `appPath` ใน qa.config) + SPEC มีไหม · health ok ไหม (อ่านอย่างเดียว)
   - `playwright/07`–`11` + `playwright/e2e/qa.config.json` + `playwright/e2e/tests/<module>/` + `playwright/e2e/index.html`
2. ถ้าเจอไฟล์แบบเก่าที่ root (USER-STORIES.md ฯลฯ) ให้แจ้งและเสนอแผนย้าย (ไม่ย้ายเอง)
3. traceability แบบเร็ว: US ไม่มี FR/BR · FR/BR ไม่อยู่ใน module · BR ไม่มี TC · TC ในแผนที่ยังไม่มี test · TC ไม่มี [D]/[R] · ⚠️ ที่ยังไม่มีคำตอบ

สรุปเป็น 2 ตาราง
- ขั้น | command | ไฟล์ | สถานะ (✅ / ⚠️ ไม่ครบ / ❌ ยังไม่มี) | สิ่งที่ขาด
- module | TC ในแผน | test ที่เขียนแล้ว | ผ่านล่าสุด | บั๊กเปิดอยู่
ปิดท้าย: **command ถัดไปที่ควรรัน** 1 ตัว (พร้อม argument) และเหตุผล · คำถามถึงลูกค้าที่ค้างอยู่

## ตัวอย่างการใช้
```text
/status
/status BOOK                      ← ดูละเอียดเฉพาะ module จองคิว
/status D:\Project\coffee-shop    ← ดูโปรเจกต์อื่น
```
