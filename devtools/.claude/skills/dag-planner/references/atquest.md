# AT-QUEST ใน dag-planner (port จาก reference `tools/orch.py`)

AT-QUEST = **A**gent · **T**eam · **Q**uota · **U**rgency · **E**xpiry · **S**cheduling · **T**echnique —
สูตรและน้ำหนักมาจาก `DEFAULT_CFG` ของ reference `tools/orch.py` (เปลี่ยนชื่อฝั่ง yolo→clp, cyolo→cop เท่านั้น)

## 1. Hard constraints (ตรวจก่อนให้คะแนน — ไม่ผ่าน = ไม่ใช้บัญชีนั้น)

| ตรวจ | ไม่ผ่านเมื่อ |
|---|---|
| ความพร้อม (Agent) | `state` ≠ `ready` (รวม `unknown`, `expired`, `not_logged_in`, `rate_limit`) |
| โควตา (Quota) | ไม่รู้ `session_used` = UNKNOWN → ไม่ใช้ · headroom ≤ 2 % → 0 slot |
| วันหมดอายุ (Expiry) | `plan_expires` ผ่านไปแล้ว |
| ฝั่ง CLI (Team) | yolo→clp · cyolo/image→cop · review: ผู้ตรวจคนละ CLI กับผู้ทำ · debate: clp + cop + ผู้ตัดสินบัญชีที่ 3 |
| ความจุ | งานต้อง ≤ capacity (ด้านล่าง) และบัญชีต้องมี slot ว่าง · ทีมรวม ≤ `--max-agents` |

ไม่รู้วันรีเซ็ต/หมดอายุ → ใช้ค่าเริ่มต้นของ orch.py (7 วัน) และแสดง `expiry_unknown` ใน PLAN.md

## 2. ตัวเลข

- headroom = min(100 − session_used, 100 − week_used) · slots = 0 ถ้า headroom ≤ 2 มิฉะนั้น max(1, min(cap, headroom // 8)) ·
  cap = min(4 clp / 3 cop, `--per-account` (ค่าเริ่มต้น 3 = agent-team `--per-account`))
- rate % ต่อ 1M token: session 2.0 / week 0.25 (plan default; max 1.0/0.12, pro 1.0/0.15, team 2.0/0.25)
- margin = max(2, rate × speed × 0.25 h × workers) · speed M tok/h: clp 7.2, cop 4.8
- capacity = min((h_s − m_s)/(1.3·r_s), (h_w − m_w)/(1.3·r_w)) · ถ้าหน้าต่าง 5 ชม. รีเซ็ตก่อนงานเสร็จ ส่วนหลังรีเซ็ตได้โควตาใหม่

## 3. คะแนน = Σ w·factor (×100)

| ตัว | w | ค่า |
|---|---|---|
| U urgency | 0.40 | 24 / (24 + ชั่วโมงถึงรีเซ็ตสัปดาห์/หมดแพลน) |
| F fit | 0.20 | min(1, โควตาสัปดาห์ที่งานใช้ ÷ ที่เหลือ) |
| R session | 0.15 | ที่ว่างหน้าต่าง 5 ชม. หลังรับงาน ÷ 100 |
| V speed | 0.15 | speed(clp 1.0, cop 0.7) × rank ปกติ 0..1 |
| L load | −0.10 | งานที่รัน ÷ slots |
| B bonus | 0 | `bonus` ต่อบัญชี (ปิด) |

## 4. ลำดับ (list scheduling บนเวลาจำลอง)

ทุกครั้งที่มีบล็อกพร้อม: เรียง MRV (บัญชีที่รับได้น้อยสุดก่อน) → rank สูง → ขนาดใหญ่ → id · ให้บัญชีคะแนนสูงสุด (เสมอ = ชื่อบัญชี) แล้ว **จองโควตาทันที** ·
บล็อกหลายบัญชีจองทุกบทบาทแบบ all-or-nothing (ผู้ตรวจ/ผู้ตัดสินคิด 30 % ของขนาด — สมมติฐานของ dag-planner) ·
เวลา = ขนาด ÷ speed ของ CLI ผู้ทำ × k ของสกิล (`/workspace/plans/calib.json` จากรันจริง) ขั้นต่ำ 3 นาที

ไม่ได้ port: relay/ส่งต่อกลางงาน (⑨⑩) เพราะ agent-team ย้าย node ที่รันอยู่ไม่ได้ → บล็อกที่ไม่มีใครปิดได้ = `unassigned` + แผน `BLOCKED`
ผลเป็น greedy heuristic ที่ผ่านตัวตรวจอิสระ (`validate_schedule`) — ไม่อ้างว่าเหมาะสมที่สุด

## 5. `--quota-json`

```json
{"accounts": [{"account": "clp1", "state": "ready", "plan": "max", "session_used": 30, "week_used": 55,
               "session_reset": 2.5, "week_reset": "2026-11-15T10:00:00+07:00", "plan_expires": null, "bonus": 0}]}
```
เวลาเป็น ISO หรือจำนวนชั่วโมงจาก `--now` · ค่าที่หายไป = UNKNOWN ตามตาราง 1
