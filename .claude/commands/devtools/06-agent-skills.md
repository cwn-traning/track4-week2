---
description: ติดตั้ง/อัปเดตสกิล clp · cop · agent-team จาก ./devtools/.claude/skills ลง shared skills ของ Claude และ Codex ใน container devtools พร้อมตรวจ checksum, การค้นพบสกิล และ smoke test
argument-hint: "[verify] — ไม่ใส่ = ติดตั้ง/อัปเดต + ตรวจ · verify = ตรวจอย่างเดียว ไม่แก้ไฟล์"
---

# Objective

นำสกิล 3 ตัว (`clp`, `cop`, `agent-team`) จาก source นอก container ไปวางที่

- `/root/ai-accounts/.Claude/shared/skills/`
- `/root/ai-accounts/.Codex/shared/skills/`

แล้วยืนยันว่า (1) ไฟล์ตรงกับ source ทุกไฟล์ (2) ทุกบัญชีมองเห็นสกิล (3) สคริปต์ทำงานได้จริง

Source of truth: `./devtools/.claude/skills/{clp,cop,agent-team}` · ผลทดสอบเต็มชุดอ้างอิง `./devtools/workspace/reports/agent-skills/TEST-REPORT.md` (= `/workspace/reports/agent-skills/` ใน container · เขียนไฟล์นี้เท่านั้น ห้ามเขียนทับรายงานของ command อื่น)

ถ้า `$ARGUMENTS` = `verify` → ข้ามขั้น Deploy (ขั้น 3) ทำเฉพาะการตรวจ

# Constraints

- ทำผ่าน `docker exec` / `docker cp` เท่านั้น · ห้ามหยุด restart สร้าง หรือลบ container/volume
- ห้ามแก้ wrapper (`/usr/local/bin/clp*`, `cop*`), `lib/*.sh`, account config หรือ credential
- ห้ามอ่าน/แสดง `.credentials.json`, `.claude.json`, `auth.json`, email, org, token · ห้าม login/logout แทนผู้ใช้
- ห้ามแตะสกิลอื่นใน shared (เช่น `shared-check`) · ห้าม `rsync --delete` หรือลบโฟลเดอร์ shared
- แทนที่ได้เฉพาะ 3 โฟลเดอร์ที่ "managed" (มี `scripts/macore.py` ใน `clp` หรือ `scripts/team.py` ใน `agent-team` หรือ `scripts/cop.py` ใน `cop`) — ถ้าชื่อซ้ำแต่ไม่ใช่ของเรา ให้รายงาน CONFLICT แล้วหยุด
- สำรองไฟล์ managed เดิมก่อนแทนที่ทุกครั้ง
- Smoke test ใช้เฉพาะบัญชีที่ `check` ยืนยันว่า `ready` · ใช้ความยาก 1 (Claude `haiku/low`, Codex `low`) · เรียกโมเดลไม่เกิน 4 ครั้ง
- ห้ามสลับบัญชีเพื่อหลบ rate/usage limit — เจอแล้วหยุดและรายงาน
- **Git Bash บน Windows แปลง `/root/...` เป็น path Windows** — ใน argument ของ `docker exec`/`docker cp` ให้ใช้ `//root/...` หรือห่อคำสั่งด้วย `bash -c '...'`

# Steps

## 1. Preflight (อ่านอย่างเดียว)

1. `docker inspect -f '{{.State.Running}}' devtools` ต้องได้ `true` มิฉะนั้น BLOCKED แล้วหยุด
2. ตรวจ source มีครบ 12 ไฟล์:
   `clp/{SKILL.md,scripts/clp.py,scripts/macore.py}`, `cop/{SKILL.md,scripts/cop.py}`,
   `agent-team/{SKILL.md,references/policies.md,scripts/{team,graph,engine,leader,report}.py}`
3. ตรวจ wrapper `clp1–5`, `cop1–5` มีอยู่ และ shared dirs ทั้งสองฝั่งมีอยู่
4. บันทึก sha256 ของสกิลอื่นใน shared ทั้งสองฝั่ง (ไว้ยืนยันว่าไม่เปลี่ยน)

## 2. Static validation (ใน staging ของ container)

```bash
docker exec devtools bash -c 'rm -rf /tmp/agdeploy && mkdir -p /tmp/agdeploy'
# รันจากโฟลเดอร์ ./devtools/.claude/skills
for s in clp cop agent-team; do docker cp "$s" devtools:/tmp/agdeploy/; done
docker exec devtools bash -c 'cd /tmp/agdeploy && find . -name __pycache__ -prune -exec rm -rf {} + &&
  python3 -m py_compile */scripts/*.py && find . -name __pycache__ -prune -exec rm -rf {} + &&
  chmod 755 */scripts/clp.py */scripts/cop.py */scripts/team.py && echo STATIC_OK'
```

- ตรวจ frontmatter ทุก `SKILL.md`: มี `name` ตรงชื่อโฟลเดอร์ และ `description`
- grep หา `eval(`, `shell=True`, `os.system`, `dangerously`, ชื่อไฟล์ credential → ต้องไม่พบ (ยกเว้นคอมเมนต์ปฏิเสธ)
- `agent-team/SKILL.md` ไม่เกิน ~10 KB
- พบ error ร้ายแรง → ห้าม deploy รายงาน FAIL แล้วหยุด

## 3. Deploy (ข้ามเมื่อ `verify`)

```bash
docker exec devtools bash -c '
set -e; B=/root/ai-accounts; TS=$(date +%Y%m%d%H%M%S); BK=/tmp/agtest/backup/$TS; mkdir -p $BK
for side in .Claude .Codex; do for s in clp cop agent-team; do
  d=$B/$side/shared/skills/$s
  if [ -e "$d" ] || [ -L "$d" ]; then
    case $s in clp) m=scripts/macore.py;; cop) m=scripts/cop.py;; agent-team) m=scripts/team.py;; esac
    [ -f "$d/$m" ] && [ ! -L "$d" ] || { echo "CONFLICT $side/$s (unmanaged)"; exit 3; }
    mkdir -p $BK/$side && cp -a "$d" $BK/$side/
    cp -a /tmp/agdeploy/$s/. "$d"/        # ทับไฟล์ ไม่ลบโฟลเดอร์
  else
    cp -a /tmp/agdeploy/$s "$d"
  fi
done; done; echo "DEPLOYED backup=$BK"'
```

- ไฟล์ที่ถูกลบออกจาก source จะยังค้างใน runtime — ถ้ามี ให้รายงานรายชื่อและถามผู้ใช้ก่อนลบ (ห้ามลบเอง)
- Deploy ล้ม → คืนค่าจาก `$BK` เฉพาะโฟลเดอร์ของ 3 สกิลนี้ แล้วรายงาน

## 4. Verify checksum

เทียบ sha256 แบบไม่ขึ้นกับลำดับและรูปแบบช่องว่าง (ใช้ `LC_ALL=C sort` และ `awk '{print $1, $2}'` ทั้งสองฝั่ง):

- source (host) == `.Claude/shared/skills` == `.Codex/shared/skills` ครบ 12/12 ไฟล์
- ไม่มี `__pycache__` ใน runtime · `clp.py`, `cop.py`, `team.py` เป็น 755
- sha256 ของสกิลอื่นใน shared ตรงกับขั้น 1

## 5. Discovery

1. เรียก `clpN --version` และ `copN --version` ทุกบัญชีหนึ่งครั้ง (wrapper ทำ `sync_skills` ให้)
2. ตรวจทุก `.Claude/clpN/skills/` และ `.Codex/copN/skills/` มี `clp`, `cop`, `agent-team` (symlink ไป shared) → ต้องได้ 3/3 ทุกบัญชี

## 6. Smoke test (ใช้ `AGENT_TEAM_HOME=/tmp/agtest/smoke` เพื่อไม่เขียนลง project)

```bash
docker exec devtools bash -c 'export AGENT_TEAM_HOME=/tmp/agtest/smoke; S=/root/ai-accounts/.Claude/shared/skills
python3 $S/clp/scripts/clp.py check
python3 /root/ai-accounts/.Codex/shared/skills/cop/scripts/cop.py check
python3 $S/agent-team/scripts/team.py stats'
```

จากนั้นเลือกบัญชี `ready` ฝั่งละ 1 บัญชี (ถ้าฝั่งใดไม่มี → SKIP ฝั่งนั้น) แล้ว:

- `clp.py run --account <clpX> "What is 17+25? Reply with the number only."` → ต้องได้ `42`, exit 0
- `cop.py run --account <copY> "What is 17+25? Reply with the number only."` → ต้องได้ `42`, exit 0
- ตรวจแถวสุดท้ายใน `/tmp/agtest/smoke/ledger.jsonl` มีฟิลด์ครบ และไม่มีข้อความ prompt
- Recursion guard: `AGENT_TEAM_CHILD=1 python3 .../team.py stats` ต้อง exit 2 "recursion blocked"

## 7. Regression

- `docker ps` ยังเห็น devtools รันอยู่
- สถานะล็อกอิน (normalized: LOGGED_IN / NOT_LOGGED_IN / UNKNOWN) ไม่เปลี่ยนจากก่อนเริ่ม — แสดงเฉพาะชื่อบัญชี + สถานะ
- mtime ของ `/usr/local/bin/clp*`, `cop*`, `/root/ai-accounts/lib/*.sh` ไม่เปลี่ยน

# Output

ตารางสรุป:

| ขั้น | สถานะ (PASS/FAIL/SKIP/BLOCKED) | หลักฐานสั้น |
|---|---|---|
| Preflight | | |
| Static | | |
| Deploy | | backup path / CONFLICT |
| Checksum | | 12/12 ทั้งสองฝั่ง |
| Discovery | | x/10 บัญชีเห็น 3/3 |
| Smoke | | บัญชีที่ใช้ · ผล · เวลา |
| Regression | | |

ตามด้วย: ตาราง checksum (16 ตัวแรก) ของ 12 ไฟล์, บัญชีที่ใช้ทดสอบ, จำนวนครั้งที่เรียกโมเดล
ห้ามรายงาน PASS ในขั้นที่ไม่ได้รันจริง

# Next

- ใช้งาน: `docker exec devtools cat //root/ai-accounts/.Claude/shared/skills/agent-team/SKILL.md`
- สาธิตทีม: `docker exec -i devtools python3 //root/ai-accounts/.Claude/shared/skills/agent-team/scripts/team.py lead --demo --workers clp1,cop1`
- สถานะบัญชี: `/devtools:05-auth-status`
