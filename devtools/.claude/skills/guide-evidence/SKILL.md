---
name: guide-evidence
description: วิธีพิสูจน์แผนด้วย Playwright (TypeScript) 3 เบราว์เซอร์ใน playwright/e2e/ — แยก core/ ที่ใช้ซ้ำข้ามโปรเจกต์ กับ tests/<module>/ ของโปรเจกต์, อ่านค่าจาก qa.config.json, หลักฐาน GIF + MP4 ด้วย ffmpeg แยกตาม module, triage.json + รายงาน index.html (module × เบราว์เซอร์) ตัดสินตามเกณฑ์ Exit, จำแนก test ที่ล้ม, ยืนยันบั๊กซ้ำ และเขียน 11-BUG-HUNT.md ใช้กับ /10-prove-e2e และ /11-prove-bugs
---

# guide-evidence · พิสูจน์แผน + ล่าบั๊กจริง

ใช้คู่กับ **guide-oracle** (โครงข้อ 1, qa.config ข้อ 2) · **ห้ามแก้โค้ดเว็บ** · **ห้ามแก้ expected ให้ผ่าน**

## A. โครง `playwright/e2e/`
```text
e2e/
├─ package.json · playwright.config.ts · tsconfig.json
├─ qa.config.json          ค่าของโปรเจกต์ (สร้างที่ /07)
├─ core/                   ♻️ ห้ามมีอะไรเฉพาะโปรเจกต์ — ทุกค่าอ่านจาก qa.config.json
│  ├─ config.ts            โหลด + validate qa.config.json (ขาด field ให้ error ชัด)
│  ├─ global-setup.ts      health + เก็บข้อมูลเวอร์ชัน/โหมดเว็บ + reset พร้อม lockedNow
│  ├─ fixtures.ts          reset ก่อนทุก test · login helper (อ่านผู้ใช้จาก test)
│  ├─ evidence.ts          overlay ป้ายชื่อ test + วงแดงจุดคลิก (addInitScript) · แปลง video → GIF/MP4 ด้วย ffmpeg
│  └─ report/build.ts      อ่านผล JSON + triage.json → index.html
├─ tests/<folder>/*.spec.ts
├─ test-report/<folder>/gifs/<TC>.gif · videos/<TC>.mp4 · logs/<TC>.json
├─ test-results/           ผลดิบของ Playwright (รอบล่าสุด) · history/<วันเวลา>/ เก็บรอบก่อน
├─ triage.json
└─ index.html
```
- `core/` คัดลอกไปโปรเจกต์อื่นได้ทั้งโฟลเดอร์ · ถ้าโปรเจกต์มี `core/` อยู่แล้ว **ใช้ของเดิม** แก้เฉพาะที่จำเป็นและบอกผู้ใช้
- `playwright.config.ts`: projects = `qa.config.browsers` · `testDir: tests` · locale/timezone จาก config · `workers: 1` (seed ใช้ร่วมกัน) · reporter `list` + `json` · env `GIF=1` อัดวิดีโอ slowMo เฉพาะ chromium
- scripts ใน package.json: `test`, `test:gif`, `test:module` (`playwright test tests/$MODULE`), `report`

## B. เขียน test
- ไฟล์ = `spec file` ในแผนหัวข้อ 5 · ชื่อ test ขึ้นต้นด้วยรหัส TC · tag `['@<MOD>', '@P1']` · annotation = expected + ที่มาจากแผน
- locator: `data-testid` จาก SPEC/หน้าเว็บ · `test.step` ภาษาไทย · `expect.soft` เพื่อเห็นทุกจุดที่ผิด
- **ใช้ตัวเลข/ข้อความตามแผนเท่านั้น** · ค่าจาก API ให้รอหน้าคิดเสร็จ (เช่น loading หาย) **ห้ามรอจนได้ค่าที่อยากได้**
- "กดซ้ำ" = คลิก 2 ครั้งติดกันจริง (ไม่ใช่ dblclick) แล้ว **นับผลในระบบ** (API/หน้า admin)
- ตรวจ **ตัวเลขข้างเคียงบนจอเดียวกัน** ด้วย (เช่น แต้มที่จะได้ ข้างยอดสุทธิ)
- ผลที่เจอตอนลอง (08-TEST-RUN-1) ต้องเจอซ้ำใน test
- เขียน 2 test แรก (ต่างโมดูล) → รันผ่าน + ได้ GIF/MP4 → ค่อยเขียนที่เหลือทีละ module

## C. หลักฐาน
- test ที่เปิดหน้าเว็บ → GIF + MP4 ใต้ `test-report/<folder>/` · test ที่ยิง API อย่างเดียว → `logs/<TC>.json` (request/response)
- ไม่มี ffmpeg → บอก `winget install Gyan.FFmpeg` แล้วเปิด terminal ใหม่

## D. รายงาน `index.html` (เปิดด้วยดับเบิลคลิก ไม่ต้องมี server)
- การ์ดต่อเบราว์เซอร์: "ผ่านเกณฑ์ / ไม่ผ่านเกณฑ์" ตาม `qa.config.exit` (EX-1 P1, EX-2 ผ่านรวม)
- ตาราง module × เบราว์เซอร์: ผ่าน/ทั้งหมด · module ที่ทำให้ไม่ผ่านเกณฑ์ไฮไลต์
- ตารางทุก TC (กรองตาม module/ระดับได้): รหัส · สิ่งที่ทดสอบ · ระดับ · ที่มา · ผลต่อเบราว์เซอร์ · ลิงก์ GIF/MP4/log
- ข้อที่ล้ม: การจำแนกจาก `triage.json`
  ```json
  { "TC-BOOK-03": { "module": "BOOK", "class": "web-bug|test-bug|plan-issue", "reason": "...", "evidence": "test-report/booking/gifs/TC-BOOK-03.gif", "bug": "BUG-01" } }
  ```

## E. รันและจำแนก
1. `npm install` · `npx playwright install` · `npx playwright test` **2 รอบ** (เช็กผลนิ่ง เก็บรอบก่อนใน history/) · `npm run test:gif`
2. ข้อที่ล้ม → **ดูภาพ/GIF ก่อน** → จำแนก 3 ทาง (guide-oracle ข้อ 7) → triage.json → `npm run report`
3. แก้ได้เฉพาะ test-bug · plan-issue ยังนับเป็นล้มจนกว่าแผนจะแก้ (ผ่าน /09-plan-review)
4. flaky → `--repeat-each=5` หาสาเหตุ แก้ที่ test โดยไม่เปลี่ยน expected
5. รันเฉพาะ module: `npx playwright test tests/<folder>` หรือ `--grep @<MOD>` · เฉพาะระดับ: `--grep @P1`

## F. playwright/11-BUG-HUNT.md (บั๊กจริง)
**ส่วนที่ 1 · บั๊กที่พบ** (รวม TC ที่ล้มจากสาเหตุเดียวกันเป็นบั๊กเดียว เรียงตาม module แล้วระดับ)
`BUG-xx | module | TC | ระดับ | ขั้นตอนทำซ้ำ | ผลที่คาดหวัง (ที่มา [D]/[R]) | ผลจริง | GIF | MP4 | ชั้นที่ผิด (จอ / API / DB)`
- ยืนยันซ้ำด้วย Playwright MCP: หน้าจอ = API = DB ผิดตรงกันไหม (query อ่านอย่างเดียว)
- เทียบหัวข้อ 8 ของแผน: บั๊กที่เจอตรงกับที่ทายไว้ไหม

**ส่วนที่ 2 · วิเคราะห์ oracle**
`TC ที่ล้ม | expected ในแผน (ที่มา) | ถ้าเขียนจาก SPEC [A] | ถ้าลอกจากหน้าจอวันนี้ [O] | แต่ละแบบจับได้ไหม`
สรุป: oracle [D]/[R] vs [A] vs [O] จับบั๊กได้กี่ตัว

**ส่วนที่ 3 · ช่องโหว่ของแผน** (ราย module)
- FR/BR ที่ยังไม่มี TC หรือ oracle อ่อน · ตัวเลขข้างเคียงที่ยังไม่ตรวจ · จังหวะตรวจที่ขาด
- TC ที่ควรเพิ่ม (ID ใหม่ | module | เหตุผล) → ส่งกลับ /09

**ส่วนที่ 4 · ส่งต่อ**
- สรุปราย module: จำนวนบั๊ก P1/P2/P3 · สถานะ
- รายงานบั๊กสำหรับคนสร้าง · คำถามถึงลูกค้า (plan-issue) · คำตัดสินตามเกณฑ์ Exit: พร้อมใช้งาน / ยังไม่พร้อม
