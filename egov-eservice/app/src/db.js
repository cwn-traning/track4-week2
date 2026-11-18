'use strict';
// SQLite (better-sqlite3, sync) · ไฟล์ที่ DB_PATH (CONTRACT 0.11)
// reset = DROP ทุกตารางแล้วสร้างใหม่ + seed (ตาราง audit มี trigger ห้าม UPDATE/DELETE จึงล้างด้วย DROP เท่านั้น)
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('./config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = DELETE');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = OFF');

// เวลาทุกคอลัมน์ *_at เป็นข้อความ ISO '+07:00' (lib/time.js) · วันที่ล้วนเป็น 'YYYY-MM-DD'
const SCHEMA = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ตัวนับเลขที่: case_<พ.ศ.> receipt_<พ.ศ.> doc_<พ.ศ.> draft payment file notif (ค่า = เลขที่ออกล่าสุด)
CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- ประชาชน (ThaiD จำลอง) · เลขบัตร/เบอร์เก็บเข้ารหัส AES-256-GCM (NFR-04) · id_hash = HMAC ไว้ค้นหา
CREATE TABLE citizens (
  id            INTEGER PRIMARY KEY,
  id_hash       TEXT NOT NULL UNIQUE,
  id_enc        TEXT NOT NULL,
  id_masked     TEXT NOT NULL,            -- X-XXXX-XXXXX-45-6
  name          TEXT NOT NULL,            -- ชื่อ-สกุลจาก ThaiD จำลอง (แก้ไม่ได้)
  mobile_enc    TEXT,                     -- เข้ารหัส (null = ยังไม่ลงทะเบียน)
  email         TEXT NOT NULL DEFAULT '',
  registered    INTEGER NOT NULL DEFAULT 0,
  consent       INTEGER NOT NULL DEFAULT 0,
  registered_at TEXT
);

-- เจ้าหน้าที่/บทบาทอื่น · password_hash = 'scrypt$<salt>$<hash>'
CREATE TABLE users (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('officer','head','executive','auditor','admin')),
  dept          TEXT NOT NULL DEFAULT '',  -- registry | works | ''
  active        INTEGER NOT NULL DEFAULT 1
);

-- session cookie 'sid' (HttpOnly) · kind: citizen | staff · role/dept เป็น snapshot ตอนล็อกอิน (เปลี่ยนบทบาทมีผลครั้งถัดไป)
CREATE TABLE sessions (
  sid         TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  citizen_id  INTEGER,
  username    TEXT,
  role        TEXT NOT NULL,
  dept        TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  registered  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- ตัวนับ OTP ผิด/ล็อกเลขบัตร (A-06) · id_hash = blindIndex(เลขบัตร) ไม่เก็บเลขตรง ๆ
CREATE TABLE otp_state (
  id_hash      TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

CREATE TABLE services (
  id          TEXT PRIMARY KEY,           -- SV-01..03
  name        TEXT NOT NULL,
  fee         INTEGER,                    -- SV-01 ต่อฉบับ · SV-02 เหมา · SV-03 = NULL (ใช้ fee_base)
  fee_base    INTEGER,                    -- SV-03 พื้นที่ 1–100 ตร.ม.
  fee_per_sqm INTEGER,                    -- SV-03 ส่วนที่เกิน 100 ตร.ม.
  sla_days    INTEGER NOT NULL            -- วันทำการ
);

CREATE TABLE service_docs (
  service_id TEXT NOT NULL,
  doc_key    TEXT NOT NULL,               -- id-card map site-photo plan deed
  name       TEXT NOT NULL,
  required   INTEGER NOT NULL,
  pdf_only   INTEGER NOT NULL DEFAULT 0,
  ord        INTEGER NOT NULL,
  PRIMARY KEY (service_id, doc_key)
);

CREATE TABLE holidays (
  date TEXT PRIMARY KEY,                  -- YYYY-MM-DD
  name TEXT NOT NULL
);

-- ร่าง / รอชำระ (ยังไม่มีเลขคำขอ) · status: DRAFT | PENDING_PAYMENT | PAID (PAID = มีเลขคำขอแล้ว, case_no ชี้ไป cases)
CREATE TABLE drafts (
  id         TEXT PRIMARY KEY,            -- DR-0001
  citizen_id INTEGER NOT NULL,
  service_id TEXT NOT NULL,
  qty        INTEGER,                     -- SV-01
  area_sqm   INTEGER,                     -- SV-03
  fee        INTEGER NOT NULL,
  status     TEXT NOT NULL,
  case_no    TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ไฟล์แนบ (เนื้อไฟล์ BLOB) · ผูกกับ draft_id ก่อนชำระ และ case_no หลังชำระ/ส่งแก้ไข
CREATE TABLE files (
  id         TEXT PRIMARY KEY,            -- fileId เช่น F-0001
  citizen_id INTEGER NOT NULL,
  draft_id   TEXT,
  case_no    TEXT,
  doc_key    TEXT NOT NULL,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  data       BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_files_draft ON files(draft_id);
CREATE INDEX idx_files_case  ON files(case_no);

-- QR ชำระเงินจำลอง · status เก็บ PENDING | PAID (EXPIRED คำนวณจากนาฬิกา: อายุ >= 15:00)
CREATE TABLE payments (
  ref           TEXT PRIMARY KEY,         -- PP-0001
  draft_id      TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING',
  qr_created_at TEXT NOT NULL,
  qr_expires_at TEXT NOT NULL,
  case_no       TEXT,
  receipt_no    TEXT,
  paid_at       TEXT
);
CREATE INDEX idx_payments_draft ON payments(draft_id);

-- คำขอที่มีเลขแล้ว
--   dept: ที่ที่เรื่องอยู่ registry | works | head | NULL(ปิดแล้ว/ยกเลิก)
--   owner: ผู้ถือเรื่อง (IN_REVIEW/NEED_FIX) · issuer: ผู้ออกเอกสาร = เจ้าหน้าที่ทะเบียนขั้นแรก (A-27) · works_owner: โยธา (SV-03 ขั้น 2)
--   due_at: กำหนดเสร็จที่เก็บ (seed เป็นค่าตายตัว) · fix_deadline: NEED_FIX = เวลาตีกลับ + 168 ชม.
--   closed_at: COMPLETED/REJECTED = ปิดงาน · CANCELLED = เวลายกเลิก (Dashboard ไม่นับ CANCELLED เป็นปิดงาน)
CREATE TABLE cases (
  case_no      TEXT PRIMARY KEY,          -- EG-2569-000025
  label        TEXT,                      -- ป้าย TEST-DATA (H01, R05 …) ไว้ debug เท่านั้น
  service_id   TEXT NOT NULL,
  citizen_id   INTEGER NOT NULL,
  draft_id     TEXT,
  qty          INTEGER,
  area_sqm     INTEGER,
  fee          INTEGER NOT NULL,
  status       TEXT NOT NULL,
  step         INTEGER,                   -- 1–3 เฉพาะ SV-03
  dept         TEXT,
  owner        TEXT,
  issuer       TEXT,
  works_owner  TEXT,
  return_count INTEGER NOT NULL DEFAULT 0,
  paid_at      TEXT NOT NULL,
  receipt_no   TEXT NOT NULL,
  due_at       TEXT NOT NULL,
  closed_at    TEXT,
  fix_deadline TEXT,
  approved_by  TEXT,
  approved_at  TEXT,
  doc_no       TEXT,
  verify_code  TEXT
);
CREATE INDEX idx_cases_citizen ON cases(citizen_id);
CREATE INDEX idx_cases_status  ON cases(status);

-- ประวัติตีกลับ/ส่งแก้ (ใช้คำนวณหยุดนับ SLA)
CREATE TABLE case_returns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no        TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  returned_at    TEXT NOT NULL,
  returned_by    TEXT NOT NULL,
  reason         TEXT NOT NULL,
  resubmitted_at TEXT,
  paused_days    INTEGER                  -- วันทำการที่หยุดนับ (ใน (ตีกลับ, ส่งแก้])
);
CREATE INDEX idx_returns_case ON case_returns(case_no);

-- ไทม์ไลน์บนหน้ารายละเอียด (ไม่ใช่ Audit)
CREATE TABLE case_timeline (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no TEXT NOT NULL,
  time    TEXT NOT NULL,
  event   TEXT NOT NULL,                  -- PAID RECEIVED RETURNED RESUBMITTED FORWARDED APPROVED REJECTED ISSUED CANCELLED …
  actor   TEXT NOT NULL DEFAULT '',
  detail  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_timeline_case ON case_timeline(case_no);

-- เอกสารดิจิทัล · applicant/ฟิลด์ที่ลงลายเซ็นแก้ได้ด้วย /api/test/documents/:docNo/tamper (ไม่คำนวณ signature ใหม่)
CREATE TABLE documents (
  doc_no      TEXT PRIMARY KEY,           -- DOC-2569-000001
  case_no     TEXT NOT NULL,
  applicant   TEXT NOT NULL,
  service_id  TEXT NOT NULL,
  issued_at   TEXT NOT NULL,
  valid_until TEXT NOT NULL,              -- YYYY-MM-DD (วันสุดท้ายที่ใช้ได้)
  signer      TEXT NOT NULL,              -- ชื่อแสดงของผู้ลงนาม
  verify_code TEXT NOT NULL UNIQUE,       -- 8 ตัว
  signature   TEXT NOT NULL               -- HMAC-SHA256 hex (lib/crypto.signDoc)
);

-- กระดิ่งแจ้งเตือน (ไม่มีสถานะอ่านแล้ว · A-30)
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL,
  case_no    TEXT NOT NULL,
  level      TEXT NOT NULL,               -- near | overdue
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notif_user ON notifications(username);

-- Audit Trail: เพิ่มได้อย่างเดียว (BR-27) ฐานข้อมูลเองก็ห้าม UPDATE/DELETE
CREATE TABLE audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  time        TEXT NOT NULL,
  username    TEXT NOT NULL,
  role        TEXT NOT NULL,
  event       TEXT NOT NULL,
  case_no     TEXT NOT NULL DEFAULT '',
  from_status TEXT NOT NULL DEFAULT '',
  to_status   TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_audit_time ON audit(time);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
`;

const dropAll = db.transaction(() => {
  const rows = db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type DESC").all();
  for (const r of rows.filter((x) => x.type === 'trigger')) db.exec(`DROP TRIGGER IF EXISTS "${r.name}"`);
  for (const r of rows.filter((x) => x.type === 'table')) db.exec(`DROP TABLE IF EXISTS "${r.name}"`);
});

function createSchema() {
  db.exec(SCHEMA);
}

function isInitialized() {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get() &&
    !!db.prepare("SELECT 1 FROM meta WHERE key='seeded'").get();
}

module.exports = { db, SCHEMA, dropAll, createSchema, isInitialized };
