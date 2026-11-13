---
name: agent-team
description: >-
  ให้หลายบัญชี Claude Code (clpN) และ Codex CLI (copN) ทำงานร่วมกันแบบ multi-agent: relay, fan-out/fan-in, DAG,
  review loop, board แชร์ความรู้, debate, best-of-N + judge, router, human gate, หัวหน้าทีมสลับตัวได้ และสรุปสถิติโทเค็นทั้งทีม.
  ใช้เมื่อ: "แบ่งงานหลายบัญชี", "ส่งต่องานระหว่าง agent", "ให้ Claude กับ Codex ตรวจไขว้", "สถิติโทเค็นแต่ละบัญชี",
  "สรุปตาราง + โควตา". Use when splitting work across several accounts, handing off between agents, cross-checking
  Claude vs Codex, running a leader with handoff, or reporting per-account token stats.
---

# agent-team — ทีมหลายบัญชี

Script: `/root/ai-accounts/.Claude/shared/skills/agent-team/scripts/team.py` — ย่อเป็น `TEAM` (ฝั่ง Codex อยู่ที่ `.Codex/shared/skills/...` เหมือนกัน)
ต้องติดตั้งคู่กับ `clp` และ `cop` (ใช้สคริปต์ของสองสกิลนั้น)

| ต้องการ | คำสั่ง |
|---|---|
| รันกราฟงาน + ตารางสรุป + โควตา | `python3 TEAM run graph.json` (หรือ `run -` อ่านจาก stdin) |
| ใช้เฉพาะบางบัญชี | `... run graph.json --workers clp1,cop1` (ไม่แตะบัญชีอื่นเลย) |
| ผลสำหรับโปรแกรม | `... run graph.json --json` |
| รันต่องานที่ล้ม/ถูกบล็อก | `python3 TEAM run --resume <run_id> [--patch fix.json]` (`{"node":{"prompt":"...","expect":"..."}}`) |
| อนุมัติ human gate | `python3 TEAM approve <run_id> <node>` |
| หัวหน้าทีมแตกงานเอง | `python3 TEAM lead --goal "..."` |
| สาธิตสลับหัวหน้า + ย้ายงาน | `python3 TEAM lead --demo [--goal "..."]` |
| ภาพรวมทีม (บัญชี/บทบาท/คิว/โควตา) | `python3 TEAM status [run_id]` |
| สถิติจาก ledger (บัญชี/รุ่น/run) | `python3 TEAM stats [--run <run_id>]` |
| ความพร้อม / โควตา | `python3 TEAM check` · `python3 TEAM quota` |

**วิธีส่งกราฟ (ทั้งใน container และจาก host):** เขียน JSON ด้วยเครื่องมือ Write ลงไฟล์ แล้วรันคำสั่งเดี่ยว ๆ —
ห้ามใช้ heredoc (`<<EOF`), `$?`, `$(...)` หรือตัวแปร shell (ตัวตรวจสิทธิ์ของ Claude Code บล็อก) · สรุปท้ายผลพิมพ์ `exit=N` ให้แล้ว

ค่าเริ่มต้น: พร้อมกันรวม 8 (`--max-parallel`), ต่อบัญชี 3 (`--per-account`), timeout 180 s/ครั้ง (`--timeout`),
เรียก agent ไม่เกิน 20 ครั้งต่อ run (`--max-invocations`) · exit 0 = ทุกงาน ok, 1 = มีงานล้ม/ถูกบล็อก, 2 = คำสั่งผิด

## กราฟ (JSON)

ฟิลด์ของ node: `id`, `prompt`, `account` (`clp1` เจาะจง · `clp`/`cop` ฝั่ง · `any` ให้ router เลือก), `difficulty` 1–6,
`depends_on`, `expect` (`"int"`, `"json"` หรือ regex ที่ต้องพบในคำตอบ — ใช้ `^...$` ถ้าต้องตรงทั้งข้อความ), `kind` (`text`/`code`/`review`/`doc`/`image`),
`approve: true` (รออนุมัติ), `cwd` + `write: true` (งานเขียนไฟล์, path absolute), `image_out` (kind=image, สคริปต์สร้างโฟลเดอร์ให้เอง)
ส่งข้อมูล: `{{a}}` = ผลสั้นของงาน a แทรกใน prompt · `{{file:a}}` = path ของผล a ให้ผู้รับอ่านเอง (ผลยาว >1500 ตัวอักษรต้องใช้แบบนี้)
ประเภทพิเศษ: `"type":"review"` (+`reviewer`, `max_rounds`) · `"type":"debate"` / `"type":"best_of"` (+`accounts`, `judge`, `criteria`)

**ทำขนานหลายบัญชี → อีกบัญชีตรวจ → แก้และทดสอบ** (แก้ prompt/บัญชีแล้วใช้ได้เลย):

```json
{"goal": "เขียนฟังก์ชันและทดสอบ",
 "nodes": [
  {"id": "impl_a", "account": "clp", "difficulty": 2, "prompt": "Write a Python function is_prime(n). Reply with code only."},
  {"id": "impl_b", "account": "cop", "difficulty": 2, "prompt": "Write a Python function is_prime(n). Reply with code only."},
  {"id": "review", "account": "cop", "kind": "review", "difficulty": 2,
   "prompt": "Compare {{file:impl_a}} and {{file:impl_b}}. List bugs and pick the better one. Reply briefly."},
  {"id": "fix", "type": "review", "account": "clp", "difficulty": 2, "max_rounds": 3,
   "prompt": "Using the review in {{file:review}}, write the final is_prime with 5 assert tests. Code only.",
   "reviewer": {"account": "cop", "prompt": "code is correct and the asserts would pass"}}
 ]}
```

รูปแบบอื่น (ใส่ใน `nodes` ได้ทันที):

```json
{"id": "s1", "account": "clp1", "prompt": "Compute 7*6. Reply with the number only.", "expect": "int"}
{"id": "s2", "account": "cop1", "prompt": "Add 100 to {{s1}}. Reply with the number only.", "expect": "int"}
{"id": "facts", "account": "any", "prompt": "Find 2 facts about X. Put each on a line starting with 'BOARD: '."}
{"id": "q", "type": "debate", "prompt": "Is 2^31-1 prime?", "accounts": ["clp1", "cop1"], "judge": "clp1"}
{"id": "best", "type": "best_of", "prompt": "Slogan for a bakery", "accounts": ["clp1", "cop1"], "judge": "cop1", "criteria": "short, catchy"}
{"id": "pic", "kind": "image", "account": "any", "prompt": "a tiny red square icon", "image_out": "/workspace/out/pic.png"}
{"id": "ship", "approve": true, "depends_on": ["s2"], "account": "clp", "prompt": "Write release note for {{s2}}"}
```

board: ทุก agent เห็น `board.md` ก่อนเริ่ม และบรรทัดที่ขึ้นต้น `BOARD: ` ในคำตอบจะถูกต่อท้ายบอร์ด (ระบุผู้เขียน + เวลา)

## หัวหน้าทีม (lead) และคำสั่งสาธิต

`lead` ให้หัวหน้า (agent) วางแผนเป็นรอบสั้น ๆ คืนแผนเป็น JSON — **สคริปต์เป็นผู้รันลูกทีมทั้งหมด** (หัวหน้าไม่สร้าง agent เอง)
ทุกรอบเขียน checkpoint ลง `handoff.md` + `state.json` · พิมพ์ความคืบหน้าทีละบรรทัด จบด้วยตาราง สลับหัวหน้า / ย้ายงานลูกทีม / ผลแต่ละงาน / สถิติต่อบัญชี

```
python3 TEAM lead --demo
python3 TEAM lead --demo --goal "เขียนสรุป 3 หัวข้อเรื่อง X แยกให้ลูกทีมคนละหัวข้อ แล้วรวมเป็นไฟล์เดียว"
```

`--demo` เปิดตัวจำลองครบ: หัวหน้าคนที่ 2 ล้มกลางคัน (สลับเชิงรับ), งบโทเค็นหัวหน้า 1 (สลับเชิงรุกทุกช่วง),
งบโทเค็นลูกทีมบัญชีแรก 1 + รันพร้อมกัน 1 งานต่อบัญชี (ย้ายงานในคิวไปบัญชีอื่น) — ผลรวมอยู่ที่ `out/FINAL.md`
ตั้งเองได้: `--simulate-crash cop1`, `--lead-token-budget N`, `--worker-token-budget clp1=N`, `--succession clp1,cop1`

## เรียกจาก host (PowerShell และ Git Bash ใช้คำสั่งเดียวกัน)

เขียนกราฟเป็นไฟล์บน host (เช่นด้วย Write tool) แล้วส่งเข้า stdin — ไม่ใช้ heredoc · ใช้ `//root/...` สองขีด

```
docker exec devtools cat //root/ai-accounts/.Claude/shared/skills/agent-team/SKILL.md
cat graph.json | docker exec -i devtools python3 //root/ai-accounts/.Claude/shared/skills/agent-team/scripts/team.py run - --workers clp1,cop1
docker exec -i devtools python3 //root/ai-accounts/.Claude/shared/skills/agent-team/scripts/team.py status
docker exec -i devtools python3 //root/ai-accounts/.Claude/shared/skills/agent-team/scripts/team.py stats
docker exec -i devtools python3 //root/ai-accounts/.Claude/shared/skills/agent-team/scripts/team.py lead --demo --workers clp1,cop1
```

ไฟล์ของ run อยู่ที่ `/workspace/.agent-team/<run_id>/` (= `./workspace/.agent-team/` บน host): `graph.json`, `state.json`,
`board.md`, `msgs/`, `out/`, `ledger.jsonl`, `handoff.md`, `approvals/` · รายละเอียดนโยบาย: `references/policies.md`
