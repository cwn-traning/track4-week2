---
name: clp
description: >-
  เรียก Claude Code บัญชี clp1…clpN แบบไม่โต้ตอบให้ถูกวิธี เลือกรุ่น/effort ตามความยาก ตรวจความพร้อมด้วยการเรียกจริง
  ดูโควตา (/usage) และบันทึกสถิติต่อครั้งลง ledger. ใช้เมื่อ: "เรียก clp2", "ให้ clp1 ตอบ", "ตรวจล็อกอิน Claude ทุกบัญชี",
  "โควตา Claude เหลือเท่าไร". Use when calling a specific Claude Code account (clpN) non-interactively, checking
  Claude account readiness or quota, or recording per-call token stats. For multi-account teamwork use agent-team.
---

# clp — Claude Code หลายบัญชี

Script: `/root/ai-accounts/.Claude/shared/skills/clp/scripts/clp.py` (Python 3 stdlib) — ในตารางย่อเป็น `CLP`

| ต้องการ | คำสั่ง |
|---|---|
| ถามบัญชีเดียว (ความยาก 1–6) | `python3 CLP run --account clp1 --difficulty 2 "สรุป ..."` |
| ระบุรุ่น/effort เอง | `python3 CLP run --account clp1 --model sonnet --effort medium "..."` |
| ผล JSON (มี usage, cost) | `python3 CLP run --account clp1 --json "..."` |
| ผลแบบมีโครงสร้าง | `python3 CLP run --account clp1 --json --json-schema '{"type":"object",...}' "..."` → `structured_output` |
| ให้แก้ไฟล์ในโฟลเดอร์ | `python3 CLP run --account clp1 --cwd /abs/dir --allow-edits "..."` |
| ตรวจความพร้อม (เรียกจริง haiku/low) | `python3 CLP check` หรือ `--accounts clp1,clp2` |
| โควตา (ไม่เรียกโมเดล) | `python3 CLP quota` |
| รายชื่อบัญชี | `python3 CLP accounts` |

ความยาก → รุ่น/effort: 1 `haiku/low` · 2 `sonnet/medium` · 3 `opus/high` · 4 `opus/xhigh` · 5–6 `opus/max` (ค่าเริ่มต้น 1)

## ข้อควรรู้

- คำสั่งจริงที่สคริปต์ใช้: `clpN -p "<prompt>" --model M --effort E --output-format json --no-session-persistence --strict-mcp-config ... < /dev/null` (prompt อยู่ก่อน flag ที่รับหลายค่า)
- **exit 0 ≠ สำเร็จ** สคริปต์ตัดสินจาก `is_error` + `result` · `check` แยก `ready` / `expired` (ล็อกอินแล้วแต่เรียกจริงล้ม) / `not_logged_in`
- `cost_usd` คือราคาตามรายการ ไม่ใช่ยอดจ่ายจริง · โควตาไม่มีข้อมูล → รายงาน "no quota data" ไม่เดา
- ทุกครั้งที่ `run` เพิ่ม 1 แถวใน `/workspace/.agent-team/ledger.jsonl` (ไม่เก็บ prompt) — เปลี่ยนที่เก็บด้วย env `AGENT_TEAM_HOME`
- Exit code: `run` 0 = สำเร็จ, 1 = agent ล้ม (ดู `FAILED [status]`), 2 = ใช้คำสั่งผิด · `check`/`quota` คืน 0 เสมอเมื่อทำงานได้
- โควตาเต็ม / rate limit / ล็อกอินหมดอายุ → **หยุดและรายงาน ห้ามสลับไปบัญชีอื่นเพื่อหลบ** · ไม่อ่าน `.credentials.json` / `.claude.json` · ไม่ล็อกอินแทนผู้ใช้
- agent ที่ถูกเรียกผ่านสกิลนี้ (`AGENT_TEAM_CHILD=1`) เรียก clp/cop/agent-team ต่อไม่ได้ (depth = 1)

## เรียกจาก host

ใช้ `//root/...` (สองขีด) เพื่อให้ใช้ได้ทั้ง PowerShell และ Git Bash โดยไม่ต้องแก้:

```
docker exec devtools cat //root/ai-accounts/.Claude/shared/skills/clp/SKILL.md
docker exec -i devtools python3 //root/ai-accounts/.Claude/shared/skills/clp/scripts/clp.py check
docker exec -i devtools python3 //root/ai-accounts/.Claude/shared/skills/clp/scripts/clp.py run --account clp1 "Reply with exactly: OK"
docker exec -i devtools python3 //root/ai-accounts/.Claude/shared/skills/clp/scripts/clp.py quota
```
