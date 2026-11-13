---
description: ขั้น 09 · เขียน 08-TEST-PLAN.md หัวข้อ 6–8 ให้ครบ แล้วรีวิวแผนลง playwright/09-PLAN-REVIEW.md (coverage ราย module) และแก้แผนให้เลย
argument-hint: "[เกณฑ์ผ่านรวม % เช่น 95] [from-bughunt]"
---

โหลด skill `guide-oracle` และ `guide-testplan` ก่อน แล้วทำตามส่วน D (หัวข้อ 6–8) และ E ของ guide-testplan

ต้องมี `playwright/08-TEST-PLAN.md` (หัวข้อ 1–5) และ `playwright/08-TEST-RUN-1.md` ถ้าไม่มีให้หยุดบอกให้รัน `/08-plan-test`
Argument: $ARGUMENTS
- ตัวเลข = เกณฑ์ผ่านรวม % (ว่าง = ค่าใน qa.config.exit หรือ 95) · ถ้าเปลี่ยน ให้อัปเดต `qa.config.json` ด้วย
- `from-bughunt` = รวม plan-issue และ "TC ที่ควรเพิ่ม" จาก `playwright/11-BUG-HUNT.md` เข้ามาด้วย

1. หัวข้อ 6 Entry/Exit (Entry อ้าง health จาก qa.config · Exit = P1 ผ่านทั้งหมด + ผ่านรวม ≥ เกณฑ์ นับข้อปัดขึ้น แยกทีละเบราว์เซอร์ + แสดงราย module)
2. หัวข้อ 7 ข้อมูลทดสอบ → TC ที่ใช้
3. หัวข้อ 8: "ถ้าพังแบบนี้ → TC ไหนล้ม → oracle" ≥ 6 แบบ + จุดกำกวมพร้อมสมมติฐาน
4. `playwright/09-PLAN-REVIEW.md`: coverage matrix ราย module (⚠️/✚) · traceability FR/BR → module → TC · นับตาม module/ระดับ/เทคนิค/ที่มา (ก่อน vs หลัง) · ตรวจ oracle อ่อน + จังหวะตรวจ + ข้อซ้ำ
5. สรุป 3–5 ข้อที่ควรแก้ **แล้วแก้ใน 08-TEST-PLAN.md ให้เลย** (อัปเดตตัวเลขหัวข้อ 6) · เรื่องที่ต้องถามลูกค้าให้บอกผู้ใช้

สรุปตาราง ตัวชี้วัด | ก่อน | หลัง · ปิดท้าย command ถัดไป `/10-prove-e2e`

## ตัวอย่างการใช้
```text
/09-plan-review
/09-plan-review 90                ← ระบบภายใน ยอมรับผ่านรวม ≥ 90%
/09-plan-review from-bughunt      ← หลัง /11 เจอช่องโหว่ เอา TC ที่ควรเพิ่มเข้าแผน
```
