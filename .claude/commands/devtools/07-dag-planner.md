---
description: ติดตั้ง/อัปเดตสกิล dag-planner (แตกงานเป็น DAG · AT-QUEST · Gantt · export ให้ agent-team) จาก ./devtools/.claude/skills ลง shared skills ของ Claude และ Codex ใน container devtools แล้วทดสอบแบบจำลองล้วน (ไม่ใช้โทเค็น) พร้อมตรวจ checksum และเขียนรายงานที่ devtools/workspace/reports/dag-planner/
argument-hint: "[verify] — ไม่ใส่ = ติดตั้ง/อัปเดต + ทดสอบ · verify = ทดสอบอย่างเดียว ไม่แก้ไฟล์ใน runtime"
---

# Objective

นำ `./devtools/.claude/skills/dag-planner/` ไปวางที่

- `/root/ai-accounts/.Claude/shared/skills/dag-planner`
- `/root/ai-accounts/.Codex/shared/skills/dag-planner`

แล้วยืนยันว่า (1) ไฟล์ตรงกับ source ทุกไฟล์ (2) ชุดทดสอบผ่านทั้งสองฝั่ง (3) การรันแผนผ่าน agent-team เป็น **การจำลองเท่านั้น** และเรียก CLI จริง 0 ครั้ง (4) ไม่มีอะไรอื่นเปลี่ยน

ต้องติดตั้ง `clp` · `cop` · `agent-team` ก่อน (`/devtools:06-agent-skills`) · คู่มือสกิล: `dag-planner/SKILL.md` · รายละเอียด: `dag-planner/references/`

ถ้า `$ARGUMENTS` = `verify` → ข้ามขั้น 3 (Deploy)

# Constraints

- ใช้ `docker exec` / `docker cp` เท่านั้น · ห้ามหยุด restart สร้าง หรือลบ container/volume
- **ห้ามเรียกโมเดลจริงทุกขั้น:** ห้าม `run --real`, ห้าม `doctor --check-accounts`, ห้าม `team.py check` / `quota`, ห้ามเปิด `clpN`/`copN` (รวม `--version`) · ตั้ง `DAGPLAN_SIMULATE_ONLY=1` ทุกคำสั่ง
- ห้ามแก้ `base_skills` (`clp`, `cop`, `agent-team`), wrapper, `lib/*.sh`, account config · ห้ามอ่าน/แสดง credential, email, token · ห้าม login/logout
- แทนที่ได้เฉพาะ `dag-planner` ที่ managed (มี `scripts/dagplan.py`) — ชื่อซ้ำแต่ไม่ใช่ของเรา หรือเป็น symlink → CONFLICT แล้วหยุด · สำรองก่อนแทนที่
- ห้ามแตะสกิลอื่นใน shared · ห้าม `rsync --delete`
- ไฟล์ทดสอบเขียนเฉพาะ `/tmp/dagplan-*` ใน container (ห้ามเขียน `/workspace/plans` หรือ `/workspace/.agent-team`)
- Git Bash: ใช้ `export MSYS_NO_PATHCONV=1` หรือ `//root/...` ในคำสั่ง docker

# Steps

## 1. Preflight (อ่านอย่างเดียว)

1. `docker inspect -f '{{.State.Running}}' devtools` = `true` มิฉะนั้น BLOCKED แล้วหยุด
2. source มี `SKILL.md`, `scripts/{dagplan,blocks,atquest,schedule,export,runner,render,reports}.py`, `references/{blocks,atquest,run}.md`, `schemas/{blocks,plan}.schema.json`, `fixtures/sample8.json`, `tests/{helpers,run_tests,test_dag,test_schedule,test_contract}.py` (20 ไฟล์)
3. base skills ใน runtime ทั้งสองฝั่งตรงกับ `./devtools/.claude/skills/{clp,cop,agent-team}` (sha256) — ไม่ตรง/ไม่มี → BLOCKED ให้รัน `/devtools:06-agent-skills` ก่อน
4. Baseline (เก็บไว้เทียบขั้น 7): sha256 รวมของสกิลอื่นใน shared ทั้งสองฝั่ง (ไม่รวม dag-planner) · sha256 รวมของ `/usr/local/bin/clp?` `cop?` · sha256 + จำนวนบรรทัดของ `/workspace/.agent-team/ledger.jsonl` · `docker inspect -f '{{.State.StartedAt}} {{.RestartCount}}' devtools`

## 2. Static validation + ทดสอบใน staging

```bash
export MSYS_NO_PATHCONV=1
# รันจาก ./devtools/.claude/skills
find dag-planner -name __pycache__ -prune -exec rm -rf {} +
docker exec devtools rm -rf /tmp/dagplan-stage
docker cp dag-planner devtools:/tmp/dagplan-stage
docker exec -e DAGPLAN_SIMULATE_ONLY=1 -e PYTHONDONTWRITEBYTECODE=1 \
  -e DAGPLAN_BASE_SKILLS=/root/ai-accounts/.Claude/shared/skills -w /tmp/dagplan-stage devtools sh -c \
  'python3 -m py_compile scripts/*.py tests/*.py && find . -name __pycache__ -prune -exec rm -rf {} + &&
   python3 tests/run_tests.py --out /tmp/dagplan-stage-results.json'
```

- ต้องได้ `{"PASS": 56, "FAIL": 0, "SKIP": 0}` (จำนวนอาจเพิ่มถ้ามีเทสต์ใหม่ — FAIL ต้องเป็น 0)
- frontmatter `SKILL.md`: `name: dag-planner` + `description` ไทย/อังกฤษ
- FAIL ใด ๆ → ห้าม deploy รายงานรายชื่อเทสต์ + evidence แล้วหยุด

## 3. Deploy (ข้ามเมื่อ `verify`)

```bash
docker exec devtools bash -c '
set -e; B=/root/ai-accounts; BK=/tmp/dagplan-backup/$(date +%Y%m%d%H%M%S); mkdir -p $BK
for side in .Claude .Codex; do
  d=$B/$side/shared/skills/dag-planner
  if [ -e "$d" ] || [ -L "$d" ]; then
    [ -f "$d/scripts/dagplan.py" ] && [ ! -L "$d" ] || { echo "CONFLICT $side/dag-planner (unmanaged)"; exit 3; }
    mkdir -p $BK/$side && cp -a "$d" $BK/$side/
    cp -a /tmp/dagplan-stage/. "$d"/
  else
    cp -a /tmp/dagplan-stage "$d"
  fi
done; echo "DEPLOYED backup=$BK"'
```

- ไฟล์ที่ runtime มีแต่ source ไม่มี → รายงานรายชื่อและถามผู้ใช้ก่อนลบ (ห้ามลบเอง)
- Deploy ล้ม → คืนค่าจาก `$BK` เฉพาะ `dag-planner` (ครั้งแรกที่ไม่มีของเดิม = ลบเฉพาะโฟลเดอร์ที่เพิ่งสร้าง) แล้วรายงาน

## 4. Verify checksum

เทียบด้วย `LC_ALL=C sort -k2` ทั้งสองฝั่ง (ตัด `*` ของ sha256sum บน Windows):

- source == `.Claude/.../dag-planner` == `.Codex/.../dag-planner` ครบทุกไฟล์ · ไม่มี `__pycache__`
- รายงาน tree sha256 (16 ตัวแรก) ของทั้งสามที่

## 5. Discovery (ไม่เปิด CLI)

wrapper ลิงก์สกิลให้เองตอนเปิดบัญชี (`lib/sync-skills.sh`) — จำลองด้วยฟังก์ชันจริงลงโฟลเดอร์ชั่วคราว ไม่แตะโฟลเดอร์บัญชี:

```bash
docker exec devtools bash -c '. /root/ai-accounts/lib/sync-skills.sh
for s in Claude Codex; do t=/tmp/dagplan-sync-$s; rm -rf $t; sync_skills /root/ai-accounts/.$s/shared/skills $t probe
  echo "$s -> $(readlink $t/dag-planner)"; test -f $t/dag-planner/SKILL.md && echo "  SKILL.md OK"; rm -rf $t; done
for d in /root/ai-accounts/.Claude/clp*/skills /root/ai-accounts/.Codex/cop*/skills; do
  [ -e $d/dag-planner ] && [ ! -L $d/dag-planner ] && echo "CONFLICT $d"; done; true'
```

- `doctor` จาก runtime ทั้งสองฝั่ง ต้องพบ base skills ข้างเคียง (บัญชี = UNKNOWN เป็นปกติ)

## 6. ทดสอบจาก runtime + เส้นทางเต็มแบบจำลอง

1. ชุดทดสอบจากสำเนาที่ deploy (ทั้ง `.Claude` และ `.Codex`):
   ```bash
   docker exec -e DAGPLAN_SIMULATE_ONLY=1 -e PYTHONDONTWRITEBYTECODE=1 -e DAGPLAN_HOME=/tmp/dagplan-rt devtools sh -c \
     'cd /root/ai-accounts/.Claude/shared/skills/dag-planner && python3 tests/run_tests.py --out /tmp/dagplan-rt-claude.json'
   ```
2. เส้นทางเต็มจาก host (เขียน blocks บน host แล้วส่ง stdin):
   ```bash
   P=//root/ai-accounts/.Claude/shared/skills/dag-planner/scripts/dagplan.py
   E="-e DAGPLAN_HOME=/tmp/dagplan-hostcall -e DAGPLAN_SIMULATE_ONLY=1 -e PYTHONDONTWRITEBYTECODE=1"
   docker exec $E -i devtools python3 $P dag meow --blocks - < dag-planner/fixtures/sample8.json
   docker exec $E devtools python3 $P plan meow --accounts clp1,clp2,cop1,cop2:40 --now 2026-11-13T09:00:00+07:00
   docker exec $E devtools python3 $P export meow
   docker exec $E devtools python3 $P run meow        # จำลอง: ต้องพิมพ์ real executor invocations: 0
   docker exec $E devtools python3 $P report meow
   docker exec $E devtools python3 $P plan whatif --blocks //root/ai-accounts/.Claude/shared/skills/dag-planner/fixtures/sample8.json --accounts clp1:8,clp2,cop1,cop2
   ```
   คาดหวัง: critical path `B01 → B04 → B07 → B08` · `graph.json accepted by agent-team graph.expand()` ·
   `real executor invocations: 0` · REPORT `blocked=7, failed=1` (team.py rc=1 เป็นปกติของตัวจำลอง) · what-if: `clp1` ไม่ได้บล็อก L
3. คัดลอกผลตัวอย่างไปที่ `/workspace/reports/dag-planner/artifacts/container-sim/` ใน container (= `./devtools/workspace/reports/dag-planner/artifacts/container-sim/` บน host · ใช้ `cp` ใน container ได้เลย) (dag, gantt-plan, gantt-actual, compare .svg + PLAN.md, REPORT.md, plan.json, graph.json, run.json) · ถ้า host มี Chrome/Edge ให้แปลง PNG ด้วย `render.write_svg`

## 7. Regression

ค่าทั้งหมดจากขั้น 1.4 ต้องเท่าเดิม: สกิลอื่นใน shared · wrapper · shared ledger · container `running` (StartedAt/RestartCount ไม่เปลี่ยน)

# Output

| ขั้น | สถานะ (PASS/FAIL/SKIP/BLOCKED) | หลักฐานสั้น |
|---|---|---|
| Preflight | | base skills ตรง source |
| Static + staging tests | | PASS/FAIL/SKIP |
| Deploy | | backup path / CONFLICT |
| Checksum | | tree sha ×3 |
| Discovery | | Claude/Codex link OK |
| Runtime tests | | .Claude / .Codex |
| Simulated end-to-end | | real executor = 0 |
| Regression | | |

จากนั้นเขียน `./devtools/workspace/reports/dag-planner/TEST-REPORT.md` (= `/workspace/reports/dag-planner/` ใน container · เฉพาะโฟลเดอร์นี้ · ห้ามแตะ `reports/agent-skills/` ของ command 06) ให้มี: Executive Summary · Traceability (Req → Test ID → Status) ·
Scheduling Metrics (planned makespan, critical path, utilization, peak, simulated makespan, real executor count — แยกเวลาจำลองกับเวลารันจริง) ·
Deployment Verification · Known Issues

**ห้ามรายงาน PASS ในขั้นที่ไม่ได้รันจริง และห้ามอ้างว่ารันจริงผ่านจากผลจำลอง** — การรันจริง (`run --real`), โควตาจริง และ readiness จริง = SKIP

# Next

- ใช้งาน: `docker exec devtools cat //root/ai-accounts/.Claude/shared/skills/dag-planner/SKILL.md`
- รันจริง (ใช้โทเค็น · ผู้ใช้ต้องสั่งเอง): `docker exec devtools python3 //root/ai-accounts/.Claude/shared/skills/dag-planner/scripts/dagplan.py run <แผน> --real`
- สถานะบัญชี: `/devtools:05-auth-status`
