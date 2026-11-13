# export · run · report

## export → `graph.json`

- อ่าน `plan.json` (ต้อง `OK` และ `blocks.json` ไม่เปลี่ยนหลัง plan — ตรวจด้วย sha256) แล้วสร้าง node ต่อบล็อก
- ตรวจด้วย `graph.expand()` ของ agent-team ที่ติดตั้งจริง (ฟังก์ชันเดียวกับที่ `team.py run` ใช้ · ไม่เรียกโมเดล)
- prompt ของ node: เป้าหมายรวม · บล็อกทำอะไร · ไฟล์ผล `/workspace/plans/<ชื่อ>/app/<output>` · เกณฑ์ `done` ·
  path ไฟล์ของบล็อกก่อนหน้า · ห้ามแก้ไฟล์บล็อกอื่น (ยกเว้นบล็อก exclusive) · ตอบสั้นว่าเขียนไฟล์อะไร
- ทุก node ใช้ `cwd` = `app/` และ `write: true` (agent-team รองรับจริง) · ไม่ใช้ `{{id}}` · `{{`/`}}` ในข้อความถูกตัดเป็น `{ {`
- `depends_on` = dependency จริง + เส้นของบล็อก exclusive (agent-team ไม่มีฟิลด์ exclusive)

| skill | node |
|---|---|
| yolo / cyolo | `account: clp` / `cop` (ฝั่ง) `kind: code` |
| image | `account: cop`, `kind: image`, `image_out` = path PNG |
| review | `type: review`, `account` = ฝั่งผู้ทำตามแผน, `reviewer.account` = อีกฝั่ง, `max_rounds: 3`, เกณฑ์ = `done` |
| debate / best_of | `type`, `accounts` + `judge` = **บัญชีตามแผน** (ต้องต่างกันจริง) · best_of `criteria` = `done` |

`--workers` ของ run = บัญชีที่แผนใช้ (`dagplan.workers` ใน graph.json)

## บัญชีตามแผน vs failover (ข้อจำกัดของ agent-team ที่ติดตั้ง)

agent-team รุ่นนี้ **ไม่ย้ายงานเมื่อบัญชีชนลิมิต** (นโยบาย: ห้ามสลับบัญชีหนีลิมิต) และไม่ย้ายงานที่ pin บัญชี ·
dag-planner จึงส่งงานบัญชีเดียวเป็น **ฝั่ง** (`clp`/`cop`) ให้ router ของ agent-team กระจายในบัญชีที่อยู่ใน `--workers` ·
บัญชีจริงอาจต่างจากแผน — `report` แสดงความต่างนั้น · debate/best_of pin บัญชีเพื่อให้ผู้ตอบ/ผู้ตัดสินเป็นคนละบัญชีตามแผน

## run

| โหมด | ทำอะไร |
|---|---|
| จำลอง (ค่าเริ่มต้น) | สร้าง `sim/<เวลา>/` ในแผน: `agent-team-home/` (AGENT_TEAM_HOME แยก + `ready_cache.json` สังเคราะห์) · `shim/` (clp1–9 cop1–9 claude codex ที่บันทึกแล้ว exit 97) · env `MA_SIMULATE_LIMIT=<ทุก worker>` · PATH = shim + `/usr/bin:/bin` · `team.py run --no-quota --json` → ทุก node ที่เริ่มได้รับ "SIMULATED usage limit" ที่เหลือ blocked · ต้อง `real_executor_invocations = 0` |
| จริง `--real` | `team.py run graph.json --workers …` ใน AGENT_TEAM_HOME ปกติ (ใช้โทเค็น · readiness check ของ agent-team เรียกโมเดลจริง) · ถูกปฏิเสธเมื่อ `DAGPLAN_SIMULATE_ONLY=1` |
| `--detach` | เฉพาะ `--real`: แยก process (`start_new_session`) log ที่ `run-<เวลา>.log` · `report` หา run_id จาก log · โหมดจำลองต้องรัน foreground บน POSIX (เพื่อยืนยันตัวนับ = 0) |

ทุกโหมดส่ง `--max-parallel` = `--max-agents` ของแผน และ `--per-account` ของแผนให้ `team.py` · `run` ปฏิเสธ `graph.json` ที่ export ก่อน plan ใหม่ (sha256)
· `debate`/`best_of` ใน agent-team เป็นงานตอบข้อความ (ไม่เขียนไฟล์) → prompt สั่งให้ตอบเนื้อหาแทน และบล็อกถัดไปอ่านผลผ่าน `{{file:<id>}}`

ไม่ retry อัตโนมัติ (ตาม agent-team) · รันต่องานที่ล้ม: `team.py run --resume <run_id>` โดยตรง

## report

อ่าน `state.json` (สถานะ/บัญชี/เวลาเริ่ม–จบ) + `ledger.jsonl` (โทเค็น) ของ run → `gantt-actual.svg` · `compare.svg` · `REPORT.md`
(บล็อก · สกิล · บัญชีแผน/จริง · นาทีแผน/จริง · tokens · สถานะ) · node ย่อย `B__1`, `B.r1.work` รวมเข้าบล็อก `B`

ตัวปรับ k = นาทีจริง ÷ นาทีแผน แยกตามสกิล → `/workspace/plans/calib.json` **เฉพาะรันจริง** ที่บล็อกสำเร็จ
(เวลาจากการจำลองไม่ใช่เวลาทำงานจริง จึงไม่บันทึก) · `plan` ครั้งถัดไปคูณเวลาด้วย k

## สิ่งที่ dag-planner ไม่ทำ

ไม่อ่าน/แสดง credential · ไม่ล็อกอิน · ไม่อ่านโควตาจริงอัตโนมัติ (`team.py quota` เปิด CLI ของทุกบัญชี) — ใช้ `--accounts` หรือ `--quota-json` ·
ไม่รันผลลัพธ์ของ agent เป็นคำสั่ง
