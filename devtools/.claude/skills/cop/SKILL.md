---
name: cop
description: >-
  เรียก Codex CLI บัญชี cop1…copN แบบไม่โต้ตอบ เลือกรุ่นและ effort จาก models_cache.json สร้างภาพ PNG ตรวจล็อกอินด้วยการเรียกจริง
  ดูโควตา (rate_limits) และบันทึกสถิติต่อครั้ง. ใช้เมื่อ: "ให้ cop1 ตรวจ", "เรียก Codex", "สร้างภาพด้วย cop",
  "โควตา Codex". Use when calling a specific Codex CLI account (copN) non-interactively, generating an image,
  listing Codex models/efforts, or checking Codex readiness/quota. For multi-account teamwork use agent-team.
---

# cop — Codex CLI หลายบัญชี

Script: `/root/ai-accounts/.Codex/shared/skills/cop/scripts/cop.py` (Python 3 stdlib) — ในตารางย่อเป็น `COP`

| ต้องการ | คำสั่ง |
|---|---|
| ถามบัญชีเดียว (ความยาก 1–6) | `python3 COP run --account cop1 --difficulty 3 "ตรวจโค้ด ..."` |
| ระบุรุ่น/effort เอง | `python3 COP run --account cop1 --model <slug> --effort high "..."` |
| ผล JSON (มี usage) | `python3 COP run --account cop1 --json "..."` |
| ให้เขียนไฟล์ในโฟลเดอร์ (sandbox workspace-write) | `python3 COP run --account cop1 --cwd /abs/dir --write "..."` |
| สร้างภาพ PNG | `python3 COP image --account cop1 --out /abs/path/cat.png "a small red cat icon"` |
| รุ่นและ effort ที่รองรับ | `python3 COP models --account cop1` |
| ตรวจความพร้อม (login status + เรียกจริง) | `python3 COP check` |
| โควตา | `python3 COP quota` |

ความยาก → effort: 1 `low` · 2 `medium` · 3 `high` · 4 `xhigh` · 5 `max` · 6 `ultra` (รุ่นไม่รองรับ → ลดเป็นระดับสูงสุดที่รองรับ และแสดง `effort_note`) · รุ่นเริ่มต้น = รุ่นแรกใน `models_cache.json`

## ข้อควรรู้

- คำสั่งจริง: `copN exec --skip-git-repo-check --ephemeral -m M -c model_reasoning_effort=E --json -o <file> "<prompt>" < /dev/null` — คำตอบมาจากไฟล์ `-o`, tokens จาก `turn.completed.usage`
- **ไม่เชื่อ exit code**: สำเร็จต้องมี `turn.completed` และคำตอบไม่ว่าง · `turn.failed` → อ่าน `error.message`
- สถานะล็อกอินอ่านจากข้อความ `login status` (ไม่ใช่ exit code) และยืนยันด้วยการเรียกจริง
- โควตาอ่านจาก rollout ที่ไม่ใช่ ephemeral ใน `$CODEX_HOME/sessions/` พร้อมเวลาของข้อมูล — การเรียกผ่านสกิลเป็น `--ephemeral` จึงไม่อัปเดตโควตา; ไม่มีข้อมูล → แจ้งว่าไม่มี
- สร้างภาพใช้ effort `low` แล้วตรวจ PNG signature (`is_png`) · สร้างภาพทำได้ฝั่ง Codex เท่านั้น
- ledger: 1 แถวต่อครั้งใน `/workspace/.agent-team/ledger.jsonl` (env `AGENT_TEAM_HOME` เปลี่ยนที่ได้) ไม่เก็บ prompt
- Exit code: 0 สำเร็จ · 1 agent ล้ม · 2 ใช้คำสั่งผิด · ไม่ใช้ `--dangerously-bypass-approvals-and-sandbox` · ไม่อ่าน `auth.json` · โควตาเต็ม/ล็อกอินหมดอายุ → หยุดและรายงาน ไม่สลับบัญชี
- ต้องใช้โมดูลร่วม `../clp/scripts/macore.py` (ติดตั้ง `clp` คู่กันเสมอ)

## เรียกจาก host

```
docker exec devtools cat //root/ai-accounts/.Codex/shared/skills/cop/SKILL.md
docker exec -i devtools python3 //root/ai-accounts/.Codex/shared/skills/cop/scripts/cop.py check
docker exec -i devtools python3 //root/ai-accounts/.Codex/shared/skills/cop/scripts/cop.py run --account cop1 "Reply with exactly: OK"
docker exec -i devtools python3 //root/ai-accounts/.Codex/shared/skills/cop/scripts/cop.py image --account cop1 --out //workspace/img/dot.png "a tiny blue dot"
```
