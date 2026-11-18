# PLAN — egov-eservice

Goal: สร้างเว็บ e-Service กลางตามชุดโจทย์ใน ./egov-brief (โฟลเดอร์ใน app/ อ่านอย่างเดียว ห้ามแก้) (อ่าน README.md ก่อน) ทำตาม REQUIREMENTS.md CONTRACT.md TEST-DATA.md DECISIONS.md ครบทุกข้อ รันด้วย Docker Compose คำสั่งเดียว (Node.js + Express + SQLite) รองรับ TEST_MODE=1 และ BUG_MODE ตาม BUGS.md และมีชุด Playwright ครบทุก TC ใน TEST-PLAN.md

Status: **OK** · planned at 2026-11-13T23:45:39+07:00 (wall clock)
· quota: quota fixture quota.json
· limits: max agents 4, per account 3

## Metrics (planned, simulated minutes)

- Makespan: 159.9 min · critical path (B01 → B02 → B04 → B05 → B06 → B07 → B14): 136.9 min
- Peak concurrent agents: 4 · utilisation: clp1 85%, clp2 54%, cop1 66%
- Schedule is a greedy AT-QUEST list schedule — feasible and validated, not proven optimal.

## Accounts (hard constraints before scoring)

| account | eligible | reason | headroom % | slots | hours to expiry | U | expiry |
|---|---|---|---|---|---|---|---|
| clp1 | True | - | 18.0 | 2 | 63.2 | 0.275 | 2026-11-16T15:00:00+07:00 |
| clp2 | True | - | 47.0 | 3 | 63.2 | 0.275 | 2026-11-16T15:00:00+07:00 |
| cop1 | True | - | 100.0 | 3 | 168.0 | 0.125 | 2026-11-20T23:45:39+07:00 |

## Blocks

| block | title | skill | model/effort | accounts | start | end | AT-QUEST reason |
|---|---|---|---|---|---|---|---|
| B01 | โครงโปรเจกต์ + docker compose + DB schema + seed + test hook (reset/clock/health) | yolo | Claude sonnet/medium | worker=clp1 | 0.0 | 25.0 | clp1: AT-QUEST 40.9 (urgency=0.275 fit=0.054 session=0.922 speed=1.0 load=0.0) · need 3.00M tok ≈ 5h 7.8% / week 0.98% · 2nd clp2 39.5 |
| B02 | ยืนยันตัวตน ThaiD จำลอง + SSO เจ้าหน้าที่ + RBAC + ปิดบังเลขบัตร | yolo | Claude sonnet/medium | worker=clp1 | 25.0 | 37.5 | clp1: AT-QUEST 36.8 (urgency=0.275 fit=0.029 session=0.883 speed=0.8 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd clp2 34.5 |
| B03 | เครื่องคิดค่าธรรมเนียม + ปฏิทินวันทำการ + SLA/ระดับเตือน | review | Claude sonnet/medium · Codex medium | worker=clp2, reviewer=cop1 | 25.0 | 43.1 | clp2: AT-QUEST 34.5 (urgency=0.275 fit=0.011 session=0.755 speed=0.8 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd clp1 31.2 / cop1: AT-QUEST 28.2 (urgency=0.125 fit=0.001 session=0.988 speed=0.56 load=0.0) · need 0.45M tok ≈ 5h 1.17% / week 0.15% |
| B04 | ฝั่งประชาชน: แคตตาล็อก ฟอร์ม ร่าง อัปโหลดไฟล์ เอกสารบังคับ | yolo | Claude sonnet/medium | worker=clp1 | 43.1 | 55.6 | clp1: AT-QUEST 34.7 (urgency=0.275 fit=0.029 session=0.844 speed=0.7 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd clp2 32.5 |
| B05 | ชำระ PromptPay จำลอง + เลขคำขอ/ใบเสร็จ + ยกเลิก/ลบร่าง (concurrency) | review | Claude sonnet/medium · Codex medium | worker=clp1, reviewer=cop1 | 55.6 | 73.7 | clp1: AT-QUEST 32.7 (urgency=0.275 fit=0.03 session=0.805 speed=0.6 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd clp2 31.0 / cop1: AT-QUEST 25.7 (urgency=0.125 fit=0.001 session=0.961 speed=0.42 load=0.0) · need 0.45M tok ≈ 5h 1.17% / week 0.15% |
| B06 | งานเจ้าหน้าที่/หัวหน้า: คิว รับเรื่อง ตีกลับ ส่งต่อ อนุมัติ ไฟล์แนบ | yolo | Claude sonnet/medium | worker=clp1 | 73.7 | 98.7 | clp1: AT-QUEST 30.7 (urgency=0.275 fit=0.063 session=0.727 speed=0.5 load=0.0) · need 3.00M tok ≈ 5h 7.8% / week 0.98% · 2nd clp2 29.1 |
| B07 | เอกสารดิจิทัล HMAC + PDF + หน้า /verify | cyolo | Codex effort medium | worker=cop1 | 98.7 | 117.5 | cop1: AT-QUEST 22.1 (urgency=0.125 fit=0.005 session=0.922 speed=0.21 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% |
| B08 | แจ้งเตือน SLA (กระดิ่ง) ตามผู้รับ ไม่แจ้งซ้ำ | review | Claude sonnet/medium · Codex medium | worker=clp1, reviewer=cop1 | 98.7 | 116.8 | clp1: AT-QUEST 26.5 (urgency=0.275 fit=0.033 session=0.688 speed=0.3 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd clp2 26.5 / cop1: AT-QUEST 14.9 (urgency=0.125 fit=0.001 session=0.895 speed=0.21 load=0.667) · need 0.45M tok ≈ 5h 1.17% / week 0.15% |
| B09 | Dashboard + รายงาน Excel/PDF | review | Claude sonnet/medium · Codex medium | worker=clp2, reviewer=cop1 | 116.8 | 134.9 | clp2: AT-QUEST 26.5 (urgency=0.275 fit=0.011 session=0.716 speed=0.3 load=0.0) · need 1.50M tok ≈ 5h 3.9% / week 0.49% · 2nd clp1 25.9 / cop1: AT-QUEST 18.1 (urgency=0.125 fit=0.001 session=0.883 speed=0.21 load=0.333) · need 0.45M tok ≈ 5h 1.17% / week 0.15% |
| B10 | Audit Trail + ส่งออก CSV | cyolo | Codex effort medium | worker=cop1 | 98.7 | 106.2 | cop1: AT-QUEST 17.8 (urgency=0.125 fit=0.002 session=0.906 speed=0.168 load=0.333) · need 0.60M tok ≈ 5h 1.56% / week 0.2% |
| B11 | ผู้ดูแลระบบ: ค่าธรรมเนียม/SLA วันหยุด ผู้ใช้/บทบาท | cyolo | Codex effort medium | worker=cop1 | 43.1 | 50.6 | cop1: AT-QUEST 22.2 (urgency=0.125 fit=0.002 session=0.973 speed=0.168 load=0.0) · need 0.60M tok ≈ 5h 1.56% / week 0.2% |
| B12 | Playwright ชุดที่ 1 (AUTH FEE SUBMIT UPLOAD PAY QUEUE) จาก TEST-PLAN เท่านั้น | yolo | Claude sonnet/medium | worker=clp2 | 0.0 | 25.0 | clp2: AT-QUEST 30.5 (urgency=0.275 fit=0.021 session=0.872 speed=0.4 load=0.0) · need 3.00M tok ≈ 5h 7.8% / week 0.98% · 2nd clp1 25.8 |
| B13 | Playwright ชุดที่ 2 (SLA WORKFLOW DOC NOTI DASH AUDIT ADMIN ที่เหลือ) จาก TEST-PLAN เท่านั้น | yolo | Claude sonnet/medium | worker=clp2 | 0.0 | 25.0 | clp2: AT-QUEST 26.0 (urgency=0.275 fit=0.021 session=0.794 speed=0.4 load=0.333) · need 3.00M tok ≈ 5h 7.8% / week 0.98% · 2nd clp1 25.8 |
| B14 | 🔒 รวมระบบ + ฝัง BUG_MODE B01–B12 + รัน Playwright เต็ม + BUG_MODE ทีละตัว | yolo | Claude sonnet/medium | worker=clp1 | 134.9 | 159.9 | clp1: AT-QUEST 24.5 (urgency=0.275 fit=0.069 session=0.61 speed=0.2 load=0.0) · need 3.00M tok ≈ 5h 7.8% / week 0.98% · 2nd clp2 24.0 |

Files: `dag.svg` · `gantt-plan.svg` (+ .png when Chromium exists) · `plan.json` (canonical data for DAG, Gantt and export)
