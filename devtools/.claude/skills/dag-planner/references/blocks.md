# blocks.json — ฟิลด์ของบล็อก

Schema: `schemas/blocks.schema.json` · ตัวอย่างครบ 6 สกิล: `fixtures/sample8.json`

```json
{"goal": "<โจทย์>", "name": "<ชื่อแผน>",
 "blocks": [
  {"id": "B01", "title": "โครงหน้าเว็บ", "size": "S", "depends_on": [],
   "skill": "yolo", "difficulty": 2, "output": "index.html",
   "done": "index.html เปิดได้และมีหัวข้อร้าน", "exclusive": false}]}
```

| ฟิลด์ | บังคับ | ความหมาย / กติกาที่ `dag` ตรวจ |
|---|---|---|
| `id` | ✔ | `A-Z a-z 0-9 _ -` ยาว ≤ 60 (เหลือที่ให้ agent-team ต่อท้าย `__N` ของ debate/best_of) · ห้ามซ้ำ |
| `title` | ✔ | ชื่องานสั้น (ไทยได้) |
| `size` | ✔ | S/M/L = 0.6/1.5/3 ล้านโทเค็น → ใช้คิด rank และเวลาในแผน |
| `depends_on` | | id ที่ต้องเสร็จก่อน · ห้ามอ้างตัวเอง / id ที่ไม่มี / วงวน |
| `skill` | ✔ | `yolo` `cyolo` `image` `review` `debate` `best_of` |
| `difficulty` | ✔ | จำนวนเต็ม 1–6 (ตาราง DIFFICULTY ของ base skill) |
| `output` | ✔ | path สัมพัทธ์ใน `app/` (ห้าม `..` / absolute) · `image` ต้องเป็น `.png` |
| `done` | ✔ | เกณฑ์เสร็จ 1 บรรทัดที่ตรวจได้ (ใช้เป็นเกณฑ์ของผู้ตรวจใน review และ criteria ของ best_of) |
| `exclusive` | | `true` = รันคนเดียว (บล็อกรวมระบบ) → planner/export เพิ่ม dependency ให้รอทุกบล็อกที่ไม่ใช่ลูกหลานของมัน |
| `n` | | เฉพาะ `best_of`: จำนวนผู้ตอบ 2–4 (ค่าเริ่มต้น 2) |

Warning (ไม่หยุดงาน): จำนวนบล็อกนอกช่วง 6–14 · `goal` ว่าง · สองบล็อกเขียนไฟล์เดียวกันโดยไม่มีลำดับ (planner จัดไม่ให้ทับเวลากัน)

rank(j) = size(j) + max rank(บล็อกที่รอ j) · สายวิกฤต = เริ่มจาก root ที่ rank สูงสุด เดินไปลูกที่ rank สูงสุด (เสมอกัน = id น้อยก่อน)
