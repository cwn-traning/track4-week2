---
description: ตั้งค่าหลายบัญชี Claude Code (clp1–5) + Codex CLI (cop1–5) ใน container devtools พร้อม shared skills และ Playwright MCP
argument-hint: "[ไม่ต้องใส่ — ทำงานกับ container ชื่อ devtools]"
---

# Role

Act as a Senior DevOps Engineer and AI Developer Tooling Specialist.

มีหน้าที่ออกแบบและปรับปรุง Existing Development Environment โดยให้ความสำคัญกับ Safety, Data Integrity, Account Isolation, Idempotency และ Maintainability

# 1. Objective

ปรับโครงสร้างภายใน container ชื่อ `devtools` ที่กำลังรันอยู่ ให้รองรับหลายบัญชี Claude Code และ Codex CLI โดยแต่ละบัญชีมี Credential, Configuration และ Session แยกจากกัน และสามารถใช้ Shared Skills และ MCP ร่วมกันได้

# 2. Scope & Non-negotiable Constraints

- ทำทุกอย่างภายใน container ผ่าน `docker exec` เท่านั้น
- ห้ามแก้ไขไฟล์บน Windows Host รวมถึงไฟล์ผ่าน bind mount
- ห้ามหยุด ลบ Restart หรือสร้าง container ใหม่
- ห้ามเข้าถึง Docker socket จากภายใน container
- หาก container ไม่ได้รันอยู่ ให้รายงาน BLOCKED แล้วหยุด
- ห้ามติดตั้ง Claude Code และ Codex CLI ซ้ำ
- ห้าม upgrade CLI ที่มีอยู่
- ห้ามเปลี่ยน `$HOME`
- ห้ามแก้ `.bashrc`, Git configuration และ SSH configuration
- ห้ามอ่าน แสดง คัดลอก หรือแชร์ Credential ระหว่างบัญชี
- ห้าม Login หรือ Logout แทนผู้ใช้
- ห้ามใช้คำสั่งหรือ Configuration ที่ไม่ได้ตรวจสอบกับ CLI เวอร์ชันจริง

# 3. Target Configuration

BASE=/root/ai-accounts

Claude Code:

- clp1 → $BASE/.Claude/clp1
- clp2 → $BASE/.Claude/clp2
- clp3 → $BASE/.Claude/clp3
- clp4 → $BASE/.Claude/clp4
- clp5 → $BASE/.Claude/clp5

ใช้ CLAUDE_CONFIG_DIR สำหรับ Account Configuration

Codex CLI:

- cop1 → $BASE/.Codex/cop1
- cop2 → $BASE/.Codex/cop2
- cop3 → $BASE/.Codex/cop3
- cop4 → $BASE/.Codex/cop4
- cop5 → $BASE/.Codex/cop5

ใช้ CODEX_HOME สำหรับ Account Configuration และ file-based credential storage

Wrappers ทั้งหมดต้องอยู่ใน `/usr/local/bin`

Permission bypass ต้องเป็น explicit opt-in เท่านั้น โดยตรวจสอบ flags ที่เวอร์ชันจริงรองรับและจัดทำคู่มือแยกสำหรับการใช้งาน

# 4. Execution Workflow

## Phase 1 — Preflight

ดำเนินการแบบ Read-only ก่อนแก้ไขไฟล์

ตรวจสอบ:

- Container running status
- Current user และ UID
- Operating system
- HOME และ PATH
- JupyterLab Terminal user และ PATH
- Claude Code executable path และ version
- Codex CLI executable path และ version
- Node.js และ npm version
- CLI help และ subcommand help
- Existing directories, files, wrappers และ symlinks
- Directory permissions
- Mount points และ disk space
- Authentication environment variable conflicts
- Required dependencies

หาก --help ไม่มีข้อมูลเพียงพอ ให้ตรวจสอบ Official Documentation หรือ Source Code ที่ตรงกับเวอร์ชันจริง

ห้าม dump environment variables หรือ credential contents

หากพบ critical blocker ให้หยุดก่อนแก้ไขไฟล์

## Phase 2 — Implementation Plan

สรุปแผนก่อนเริ่ม implementation:

- Directory structure
- Files to create
- Files to update
- Existing resources to preserve
- Shared skill strategy
- MCP configuration strategy
- Dependency installation strategy
- Risks and limitations

ดำเนินการต่อได้หากไม่พบ critical blocker และไม่ออกนอกขอบเขตที่กำหนด

## Phase 3 — Installer

สร้าง installer ภายใน container โดยมีคุณสมบัติ:

- Idempotent
- ใช้ set -euo pipefail
- ป้องกัน concurrent installation
- ใช้ managed manifest ระบุไฟล์ที่ installer เป็นเจ้าของ
- ใช้ atomic writes สำหรับ managed files
- ไม่ overwrite existing credential หรือ unmanaged configuration
- ไม่ overwrite unmanaged wrapper หรือ symlink
- ไม่เปลี่ยน random identifier ของ shared-check เมื่อรันซ้ำ
- ไม่ติดตั้ง dependency ซ้ำหาก version ตรงกัน
- บันทึก CREATED, UPDATED, SKIPPED, NO_CHANGE, FAILED
- หากเกิด failure ให้ cleanup เฉพาะ temporary files ของ installer
- ห้ามลบ existing account data

## Phase 4 — Account Wrappers

สร้าง wrapper จำนวน 10 ตัว

Requirements:

- ใช้ Account Configuration Directory แบบ absolute path
- ตรวจสอบว่า Account Directory มีอยู่จริง
- หากไม่มี ให้แจ้ง error และ exit non-zero
- ห้าม fallback ไปบัญชี default
- รักษา current working directory
- รักษา HOME
- ส่งต่อ arguments ด้วย "$@"
- ใช้ exec เมื่อเรียก CLI
- Preserve exit code และ signal handling
- ห้ามใช้ eval
- ตรวจสอบ authentication environment variables ที่อาจ override credentials
- หากพบ conflict ให้รายงานเฉพาะชื่อ variable และหยุด
- รองรับ authentication subcommands, --version และ --help ตามเวอร์ชันจริง
- ไม่เปิด permission bypass โดยอัตโนมัติ

## Phase 5 — Shared Skills

สร้าง:

- $BASE/.Claude/shared/skills
- $BASE/.Codex/shared/skills

Shared Directory เป็น Single Source of Truth ของ managed skills

Requirements:

- แก้ไข Skill ครั้งเดียว ทุกบัญชีเห็นเมื่อเปิด session ใหม่
- เพิ่ม Skill ใหม่ ทุกบัญชีค้นพบเมื่อเปิด wrapper ครั้งถัดไป
- ลบเฉพาะ managed symlink ที่สัมพันธ์กับ Skill ที่ถูกลบ
- รักษา account-specific skills
- หากชื่อซ้ำกับ unmanaged skill ให้รายงาน conflict
- ห้าม overwrite unmanaged skill
- Codex ต้องรักษา account-specific system skills และ internal state
- ห้าม symlink ทั้ง Account Configuration Directory
- ตรวจสอบ Skill Discovery mechanism ตาม CLI เวอร์ชันจริง

สร้าง shared-check skill สำหรับแต่ละ CLI

Expected response:

SHARED_SKILL_OK-(tool)-(random-id)

Random identifier ต้องสร้างเพียงครั้งเดียวต่อ CLI และเก็บในไฟล์ Skill เท่านั้น

ห้ามใส่ expected random identifier ลงใน test prompt

## Phase 6 — Shared MCP

สร้าง:

- $BASE/.Claude/shared/mcp
- $BASE/.Codex/shared/mcp

MCP ตัวแรกคือ Playwright MCP

Requirements:

- ใช้ centralized runtime
- ติดตั้ง @playwright/mcp เพียงครั้งเดียว
- Pin package version
- สร้าง package lockfile
- ใช้ Chromium ที่ตรงกับ Playwright dependency
- ใช้ executable จาก installed package
- ห้ามใช้ @latest ตอนเปิด wrapper
- ตรวจสอบ Browser Dependencies ก่อนติดตั้งเพิ่มเติม
- ตรวจสอบ flags ด้วย --help ก่อนใช้
- ใช้ isolated browser context สำหรับ concurrent sessions
- แยก output directories ตาม CLI และ Account
- ห้ามใช้ persistent browser profile ร่วมกัน
- Shared MCP configuration ต้องไม่มี credentials
- การแก้ไข Shared MCP configuration ต้องมีผลเมื่อเปิด session ใหม่

ใช้ browser sandbox เมื่อ environment รองรับ หากต้องปิด sandbox ให้รายงานข้อจำกัดและใช้เฉพาะกรณีที่ตรวจสอบและได้รับอนุญาตอย่างชัดเจน

## Phase 7 — Verification

ใช้สถานะ PASS / FAIL / SKIP / BLOCKED ตามผลจริง

Infrastructure Tests:

- All 10 wrappers are executable
- All 10 wrappers return CLI version
- HOME remains unchanged
- Account Configuration Directories are unique
- Wrapper forwards arguments correctly
- Missing account directory returns error
- Authentication environment conflict is detected
- Installer second run preserves existing state
- Shared Skills resolve to intended managed resources
- Existing unmanaged skills are preserved
- Newly added shared skills are discoverable
- Removed shared skills are reconciled safely
- Codex internal skill directories remain independent
- MCP configuration is valid
- MCP configuration is discoverable using supported commands
- Playwright MCP starts successfully
- Chromium launches successfully
- Concurrent MCP processes do not share browser profiles

Authentication-dependent Tests:

- Actual authenticated account identity
- Actual skill invocation
- Actual MCP tool invocation through AI CLI
- Concurrent authenticated sessions
- Account-specific logout behavior

ห้าม Login หรือ Logout เพื่อทำการทดสอบ

หากต้องใช้ Authentication ให้ระบุ SKIP พร้อมเหตุผลและวิธีทดสอบด้วยตนเอง

ห้ามรายงาน PASS สำหรับ Runtime Test ที่ตรวจสอบเพียง file existence หรือ symlink

## Phase 8 — Documentation

สร้างเอกสารภายใน container:

/workspace/multi-account/

ตรวจสอบก่อนว่า destination ไม่เชื่อมกับ Host filesystem

Deliverables:

1. setup-report.md

- Architecture และ directory structure
- Installed CLI versions
- Package versions
- Wrapper behavior
- Skill discovery mechanism
- MCP configuration mechanism
- Installer execution instructions
- Changes performed
- Security limitations
- Persistence limitations
- Known issues

2. login-guide.md

- Login ทีละบัญชีผ่าน JupyterLab Terminal
- วิธีตรวจสอบ Active Account
- วิธีเปิดใช้งานหลายบัญชีพร้อมกัน
- วิธีเรียก Shared Skills
- วิธีตรวจสอบ MCP
- วิธีเพิ่มและแก้ไข Shared Skills
- วิธี rerun installer
- Authentication-dependent manual test instructions

3. checklist.md

Columns:

Test ID | Test case | Sanitized evidence | Status | Notes

ห้ามมี credential, access token, refresh token, API key, OAuth code หรือ secret ในเอกสารทั้งหมด

# 5. Version-specific Assumptions

รายการต่อไปนี้เป็นข้อมูลจากการทดลองก่อนหน้า ไม่ใช่ข้อเท็จจริงที่รับรองแล้วสำหรับเวอร์ชันปัจจุบัน:

- Claude ใช้ CLAUDE_CONFIG_DIR/skills
- Claude รองรับ --mcp-config
- Claude ต้องใช้ syntax --mcp-config=... ในบางกรณี
- Claude MCP ที่มาจาก runtime config อาจไม่แสดงใน claude mcp list
- Codex ใช้ CODEX_HOME/skills
- Codex มี internal skills/.system
- Codex รองรับ file-based credential storage
- Codex รองรับ runtime MCP configuration ผ่าน -c
- Root environment อาจมีข้อจำกัดเกี่ยวกับ sandbox
- Playwright MCP รองรับ headless และ isolated browser mode

ตรวจสอบทุกข้อกับเวอร์ชันที่ติดตั้งจริง

หากไม่รองรับ ให้รายงานและใช้ documented alternative เฉพาะที่ไม่ขัดกับ constraints

ห้ามใช้ IS_SANDBOX=1 เพียงเพื่อหลบ security restriction

# 6. Stop Conditions

หยุดดำเนินการทันทีเมื่อ:

- Container ไม่ได้รันอยู่
- Required CLI ไม่มีอยู่
- ไม่สามารถตรวจสอบ configuration mechanism ได้
- Destination อาจเชื่อมกับ Host filesystem
- จำเป็นต้องแก้ไข existing credentials
- จำเป็นต้องเปลี่ยน HOME
- จำเป็นต้อง restart หรือ recreate container
- จำเป็นต้องปิด security control ที่ไม่ได้รับอนุญาต
- พบ unmanaged configuration conflict ที่ไม่สามารถแก้ได้อย่างปลอดภัย

# 7. Final Output

เมื่อดำเนินการเสร็จ ให้สรุปเป็นตาราง:

Component | Expected | Actual | Status

ระบุเพิ่มเติม:

- Installer path
- Report paths
- Total PASS / FAIL / SKIP / BLOCKED
- Remaining manual steps
- Risks and limitations
- Changes that could not be completed

ห้ามรายงานความสำเร็จเกินกว่าที่ทดสอบจริง

หยุดหลังส่งรายงาน ห้าม Login แทนผู้ใช้

---

# ภาคผนวก — ข้อมูลที่ตรวจแล้วจากการรันจริง (2026-11-13)

ใช้เป็นจุดเริ่มต้น แต่ยังต้องตรวจซ้ำกับเวอร์ชันที่ติดตั้งจริงทุกครั้ง (ตรวจกับ Claude Code 2.1.322 / Codex 0.167.1 ต่อมา container ใหม่เป็น 2.1.323 / 0.168.0)

- **ถ้ามี installer อยู่แล้ว:** `/root/ai-accounts/bin/install-multi-account.sh` → รันซ้ำได้อย่างปลอดภัย ไม่ต้องสร้างใหม่
- **Persistence:** `/root/ai-accounts` อยู่บน named volume `devtools-ai-accounts` (ประกาศ `external: true` ใน `devtools/docker-compose.yml`) หลัง recreate container ให้รัน installer หนึ่งครั้ง เพื่อสร้าง wrapper ใน `/usr/local/bin` และ library ของ Chromium (apt) คืน
- **เอกสาร:** `/workspace` เป็น bind mount ของ Windows `D:\` → ติด stop condition จึงเขียนไว้ที่ `/root/ai-accounts/docs/multi-account/` แทน
- **Claude:**
  - ต้องใช้ `--mcp-config=FILE` (มี `=`) เพราะ option นี้รับหลายค่า และแบบเว้นวรรคจะกิน prompt เป็นชื่อไฟล์
  - MCP จาก `--mcp-config` ไม่แสดงใน `claude mcp list` → ตรวจด้วย `--debug-file` ซึ่งจะมีบรรทัด `MCP server "playwright": Successfully connected` (ทำได้แม้ยังไม่ login)
  - การค้นพบ skill ตรวจได้เฉพาะหลัง login
- **Codex:**
  - `-c cli_auth_credentials_store="file"` (ค่าที่รับ: `file|keyring|auto|ephemeral`)
  - `CODEX_HOME/skills` รองรับ skill directory ที่เป็น symlink และมี `.system` แยกต่อบัญชี
  - ตรวจ skill โดยไม่ต้อง login ด้วย `copN debug prompt-input hi`
  - MCP แบบ `-c mcp_servers.<name>.*` แสดงใน `copN mcp list`
- **Playwright MCP:**
  - `@playwright/mcp@0.0.85` + lockfile, Chromium rev 1254 อยู่ใน `mcp-runtime/playwright/browsers`
  - ต้องติดตั้ง library ของระบบผ่าน `playwright install-deps chromium`
  - launcher ใช้ `--headless --isolated --browser chromium --output-dir <tool>/<acct>`
- **Sandbox:** `--sandbox` ใช้ไม่ได้เมื่อรันเป็น root และ Playwright ใส่ `--no-sandbox` ให้ Chromium โดย default → ต้องรายงานเป็นข้อจำกัดและให้ผู้ใช้ยอมรับ
- **อย่าใช้ volume `ai-accounts` เก่า:** ลบไปแล้ว เป็นข้อมูลจากการทดลองชุด yolo/cyolo
