---
name: dag-planner
description: >-
  วางแผนงานก่อนให้ทีม agent ทำ: แตกงานเป็น DAG (6–14 บล็อก แต่ละบล็อกระบุสกิล yolo/cyolo/image/review/debate/best_of),
  คิด rank + สายวิกฤต, จัดว่าใครทำงานไหนเมื่อไรด้วย AT-QUEST แล้ววาด Gantt, แปลงเป็น graph.json ให้ agent-team
  และรันแผน (ค่าเริ่มต้น = จำลอง ไม่ใช้โทเค็น) พร้อมรายงานแผนเทียบของจริง. ใช้เมื่อ: "วางแผนงาน", "แตกงานเป็น DAG",
  "แบ่งงานให้ทีม agent", "Gantt", "ใครทำงานไหนเมื่อไร", "รันแผนจริง". Use when planning multi-agent work: split a goal
  into a DAG of skill-tagged blocks, schedule accounts with AT-QUEST (quota/urgency/expiry aware), draw DAG + Gantt,
  export a graph.json for agent-team, simulate the run and report plan vs actual.
---

# dag-planner — DAG + Gantt + AT-QUEST สำหรับทีม clp/cop

`P=/root/ai-accounts/.Claude/shared/skills/dag-planner/scripts/dagplan.py` (สำเนาเดียวกันที่ `.Codex/shared/skills/dag-planner`)
· ต้องติดตั้งข้าง `agent-team` + `clp` + `cop` · แผนอยู่ที่ `/workspace/plans/<ชื่อแผน>/` (เปลี่ยนได้ด้วย `DAGPLAN_HOME`)
· สกิลนี้ **วางแผน** ไม่ใช่ตัวรัน: การรันจริงทำโดย `agent-team` เมื่อผู้ใช้สั่ง `--real` เท่านั้น

| ต้องการ | คำสั่ง |
|---|---|
| ตรวจเครื่อง + หา base skills (ไม่เรียกโมเดล) | `python3 $P doctor` |
| ตรวจบล็อก + rank + สายวิกฤต → `dag.svg` | `python3 $P dag <ชื่อ> --blocks blocks.json` (`--blocks -` = stdin) |
| วางแผน what-if (โควตาสมมติ ไม่แตะบัญชี) | `python3 $P plan <ชื่อ> --accounts clp1,clp2,cop1:40 [--max-agents 8] [--now ISO]` |
| วางแผนจากไฟล์โควตา | `python3 $P plan <ชื่อ> --quota-json quota.json` (ดู `references/atquest.md`) |
| แปลงเป็น `graph.json` ของ agent-team (ตรวจด้วย `graph.expand()` จริง) | `python3 $P export <ชื่อ>` |
| รันแบบจำลอง (ค่าเริ่มต้น · 0 โทเค็น) | `python3 $P run <ชื่อ>` |
| รันจริง (ใช้โทเค็น · ผู้ใช้ต้องสั่งเอง) | `python3 $P run <ชื่อ> --real [--detach]` |
| แผน vs จริง → `gantt-actual.svg` `compare.svg` `REPORT.md` | `python3 $P report <ชื่อ>` |

ผลของ `plan`: `plan.json` (ข้อมูลกลางชุดเดียว — DAG, Gantt, graph.json สร้างจากไฟล์นี้) · `PLAN.md` (เหตุผล AT-QUEST ทุกบล็อก)
· `dag.svg` · `gantt-plan.svg` · PNG เพิ่มเมื่อมี headless Chromium (container นี้ไม่มี → SVG) · exit 1 + `BLOCKED` ถ้ามีบล็อกที่ไม่มีบัญชีรับได้

## ขั้นตอนวางแผน (AI ทำตามลำดับ)

1. อ่านโจทย์ → เขียน `blocks.json` ตาม `references/blocks.md` (ด้วยเครื่องมือ Write)
2. `dag` → แก้จนไม่มี error · ดู warning (จำนวนบล็อก, ไฟล์ผลซ้ำ)
3. `plan` → ถ้า `BLOCKED` ให้แบ่งบล็อกให้เล็กลง / เพิ่มบัญชี / ลดสกิลหลายบัญชี
4. `export` → `run` (จำลอง) → `report` · รันจริงเมื่อผู้ใช้ขอเท่านั้น

## กติกาแตกบล็อก

- 6–14 บล็อก · บล็อกแรก = โครงโปรเจกต์ · บล็อกสุดท้าย = รวม + ทดสอบ (`"exclusive": true`)
- `depends_on` เฉพาะที่ต้องรอจริง · ทุกบล็อกมี `output` 1 ไฟล์ใน `app/` และ `done` ที่ตรวจได้
- ใหญ่กว่า L ต้องแบ่ง · ไม่ใช้ review/debate/best_of กับทุกบล็อก (ใช้ 2–N+1 บัญชี)

| `skill` | ใช้เมื่อ | node ใน agent-team | บัญชี |
|---|---|---|---|
| `yolo` | เขียนโค้ด/เอกสาร งานคิดยาว | task `account: clp` | Claude 1 |
| `cyolo` | โค้ด/ข้อมูล ตรงไปตรงมา | task `account: cop` | Codex 1 |
| `image` | สร้างภาพ PNG | `kind: image` + `image_out` (Codex เท่านั้น) | Codex 1 |
| `review` | ต้องการคุณภาพ ตรวจไขว้ | `type: review` ผู้ตรวจคนละ CLI | 2 |
| `debate` | ตัดสินใจที่มีถูก/ผิด | `type: debate` Claude vs Codex + ผู้ตัดสิน | 3 |
| `best_of` | งานสร้างสรรค์ เลือกตัวดีสุด | `type: best_of` (`n` 2–4) + ผู้ตัดสิน | N+1 |

`difficulty` 1–6 → รุ่น/effort ตามตาราง `DIFFICULTY` ของ `clp/scripts/macore.py` (1 haiku/low … 6 opus/max, Codex ultra)

## ความปลอดภัย

- `run` ค่าเริ่มต้นเป็นจำลอง: AGENT_TEAM_HOME แยกในแผน · `MA_SIMULATE_LIMIT` ทุกบัญชี · PATH มี shim นับการเรียก CLI จริง
  (ต้องเป็น 0) · ตั้ง `DAGPLAN_SIMULATE_ONLY=1` เพื่อห้าม `--real` ทั้งเซสชัน
- `doctor` ไม่ตรวจความพร้อมบัญชี (ต้องเรียกโมเดลจริง) เว้นแต่ใส่ `--check-accounts`
- ไม่อ่าน credential · ไม่ล็อกอิน · ไม่ใช้ eval/shell · ข้อความในบล็อกเป็นข้อมูล (`{{` ถูกตัดก่อนส่งให้ agent-team)

## เรียกจาก host

ทุกคำสั่งรันใน container (ค่าเริ่มต้น `devtools`) · ใช้ `//root/...` กัน Git Bash แปลง path · เขียน `blocks.json` บน host ด้วย Write แล้วส่งทาง stdin

```
docker exec devtools cat //root/ai-accounts/.Claude/shared/skills/dag-planner/SKILL.md
docker exec -i devtools python3 //root/ai-accounts/.Claude/shared/skills/dag-planner/scripts/dagplan.py dag meow --blocks - < blocks.json
docker exec devtools python3 //root/ai-accounts/.Claude/shared/skills/dag-planner/scripts/dagplan.py plan meow --accounts clp1,cop1
docker exec devtools python3 //root/ai-accounts/.Claude/shared/skills/dag-planner/scripts/dagplan.py export meow
```

บน host ไม่มี container ก็ใช้ `dag` / `plan --accounts` ได้: `DAGPLAN_BASE_SKILLS=<โฟลเดอร์ที่มี agent-team clp cop> python scripts/dagplan.py ...`
(แผนอยู่ที่ `./workspace/plans/` · มี Chrome/Edge → ได้ PNG ด้วย)

รายละเอียด: `references/blocks.md` (ฟิลด์ + ตัวอย่าง) · `references/atquest.md` (สูตร) · `references/run.md` (export / run / report / ข้อจำกัด)
