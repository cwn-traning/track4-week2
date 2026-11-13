---
description: ตรวจสอบสถานะล็อกอิน (local) ของ Claude Code clp1–5 และ Codex CLI cop1–5 ใน container devtools แบบอ่านอย่างเดียว
argument-hint: "[ไม่ต้องใส่ — ทำงานกับ container ชื่อ devtools]"
---

# Objective

ตรวจสอบ Local Authentication Status ของ Claude Code และ Codex CLI ทุกบัญชีภายใน container ชื่อ `devtools`

# Constraints

- ทำทุกอย่างผ่าน `docker exec` เท่านั้น
- หาก container ไม่ได้รันอยู่ ให้รายงาน BLOCKED แล้วหยุด
- ห้ามแก้ไข สร้าง หรือลบไฟล์ใด ๆ
- ห้ามติดตั้งหรืออัปเดต CLI
- ห้ามเรียก installer หรือ shared skill reconciliation (`sync_skills`)
- ห้าม Login, Logout หรือ Refresh Token แทนผู้ใช้
- ห้ามเปิด Interactive AI Session
- ห้ามอ่าน credential files โดยตรง
- ห้าม fallback ไปใช้ default account
- ห้ามแสดง email, username, organization, token, API key หรือ OAuth code
- ห้าม dump environment variables (ตรวจได้เฉพาะว่าตัวแปรถูกตั้งหรือไม่ โดยไม่แสดงค่า)
- ห้ามนำ raw authentication output ออกจาก container

# Preflight

1. `docker inspect -f '{{.State.Running}}' devtools` ต้องได้ `true` มิฉะนั้นรายงาน BLOCKED แล้วหยุด
2. ตรวจว่า wrapper `/usr/local/bin/clp1–5` และ `cop1–5` มีอยู่จริง และอ่านเนื้อหา wrapper กับ runner
   (`/root/ai-accounts/lib/run-claude.sh`, `run-codex.sh`) เพื่อยืนยัน:
   - Claude ใช้ `CLAUDE_CONFIG_DIR=/root/ai-accounts/.Claude/clpN`
   - Codex ใช้ `CODEX_HOME=/root/ai-accounts/.Codex/copN` และ `-c cli_auth_credentials_store="file"`
   - account directory มีอยู่จริง (ถ้าไม่มี = UNKNOWN ไม่ fallback)
3. **สำคัญ:** runner เรียก `sync_skills` (write operation) ทุกครั้งก่อน exec
   ดังนั้น **ห้ามเรียกผ่าน wrapper** ให้เรียก binary ตรงโดยตั้ง env/flag ให้ตรงกับที่ runner ตั้ง
   หาก runner เปลี่ยนไปจากนี้ ให้ปรับคำสั่งตามของจริง หรือระบุ UNKNOWN หากยืนยันความปลอดภัยไม่ได้
4. ตรวจว่าไม่มี auth env vars ที่จะ override credentials
   (`ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY OPENAI_API_KEY CODEX_API_KEY CODEX_ACCESS_TOKEN OPENAI_BASE_URL`) — แสดงเฉพาะชื่อที่ถูกตั้ง ไม่แสดงค่า
5. ยืนยัน flags ที่ CLI เวอร์ชันจริงรองรับ: `claude auth status --help` (ต้องมี `--json`), `codex login status --help`

# Authentication Status Check

timeout ไม่เกิน 15 วินาทีต่อบัญชี, parse ภายใน container, ส่งออกเฉพาะ alias + normalized status

```bash
docker exec devtools bash -c '
B=/root/ai-accounts
for i in 1 2 3 4 5; do
  [ -d $B/.Claude/clp$i ] || { echo "clp$i UNKNOWN(no-dir)"; continue; }
  out=$(CLAUDE_CONFIG_DIR=$B/.Claude/clp$i timeout 15 /usr/local/bin/claude auth status --json 2>/dev/null); rc=$?
  s=$(printf "%s" "$out" | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{try{const v=JSON.parse(d).loggedIn;console.log(v===true?\"LOGGED_IN\":v===false?\"NOT_LOGGED_IN\":\"UNKNOWN\")}catch{console.log(\"UNKNOWN\")}})" 2>/dev/null || echo UNKNOWN)
  [ $rc -eq 124 ] && s="UNKNOWN(timeout)"
  echo "clp$i $s rc=$rc"
done
for i in 1 2 3 4 5; do
  [ -d $B/.Codex/cop$i ] || { echo "cop$i UNKNOWN(no-dir)"; continue; }
  out=$(CODEX_HOME=$B/.Codex/cop$i timeout 15 /usr/bin/codex -c cli_auth_credentials_store=\"file\" login status 2>&1); rc=$?
  if [ $rc -eq 124 ]; then s="UNKNOWN(timeout)"
  elif [ $rc -eq 0 ] && printf "%s" "$out" | grep -q "^Logged in"; then s=LOGGED_IN
  elif [ $rc -eq 1 ] && printf "%s" "$out" | grep -q "^Not logged in"; then s=NOT_LOGGED_IN
  else s="UNKNOWN(unrecognized)"; fi
  echo "cop$i $s rc=$rc"
done'
```

## Claude Code — อ่านเฉพาะ boolean `loggedIn`

- true = LOGGED_IN, false = NOT_LOGGED_IN
- missing field, invalid JSON, timeout, execution error = UNKNOWN
- cross-check exit code (เวอร์ชันที่ทดสอบ: 0 เมื่อ true, 1 เมื่อ false)

## Codex CLI

- exit 0 + ขึ้นต้น "Logged in" = LOGGED_IN
- exit 1 + ขึ้นต้น "Not logged in" = NOT_LOGGED_IN
- อื่น ๆ (timeout, error, ข้อความกำกวม) = UNKNOWN — ห้ามตีความทุก non-zero ว่าไม่ได้ล็อกอิน

# Error Handling

- บัญชีใดล้มเหลว → UNKNOWN แล้วตรวจบัญชีถัดไป
- ห้ามซ่อม configuration, ห้าม retry authentication

# Output

ตาราง 2 คอลัมน์เท่านั้น `บัญชี | สถานะ` เรียง clp1–clp5 แล้ว cop1–cop5
สถานะ: `ล็อกอินแล้ว` / `ยังไม่ล็อกอิน` / `ตรวจสอบไม่ได้`

หากมีบัญชียังไม่ล็อกอิน ให้คำแนะนำเฉพาะบัญชีนั้น (ทำเองผ่าน JupyterLab Terminal):

- Claude Code: พิมพ์ `clpN` แล้วเลือก "Claude account with subscription" หาก CLI แสดงตัวเลือก
- Codex CLI: พิมพ์ `copN` หรือ `copN login --device-auth` หากเวอร์ชันและบัญชีรองรับ

บัญชี UNKNOWN: ระบุสาเหตุแบบทั่วไป (timeout / ไม่มี account directory / response ไม่รู้จัก) ไม่มีข้อมูลส่วนบุคคล และไม่แนะนำให้ล็อกอินใหม่จนกว่าจะยืนยันสถานะได้

# Completion Criteria

- ตรวจครบ 10 บัญชี หรือรายงาน BLOCKED
- ไม่มีการ Login/Logout และไม่มีการเปลี่ยนแปลงไฟล์โดยเจตนา
- ไม่มีข้อมูลส่วนบุคคลหรือ secret ใน tool output และรายงาน
- ระบุชัดว่า local auth status ไม่ได้ยืนยันว่า subscription/token ใช้งานได้จริง

เสร็จแล้วสรุปผลและหยุด
