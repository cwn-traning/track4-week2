'use strict';
// ตัวออกเลขที่ (atomic: better-sqlite3 sync + ตาราง counters) · ปีใช้ พ.ศ. จากนาฬิกา (ข้ามปี 2569 → 2570 ตัวนับเริ่ม 000001 ใหม่)
//   nextCaseNo()   -> EG-2569-000031     nextReceiptNo() -> RC-2569-000031    nextDocNo() -> DOC-2569-000002
//   nextDraftId()  -> DR-0003            nextPaymentRef() -> PP-0002          nextFileId() -> F-0001
//   nextVerifyCode() -> รหัสตรวจสอบ 8 ตัว (A-Z0-9 ตัดตัวสับสน) ไม่ซ้ำกับ documents.verify_code
const crypto = require('crypto');
const { db } = require('../db');
const clock = require('./clock');
const T = require('./time');

const bump = db.transaction((name) => {
  const row = db.prepare('SELECT value FROM counters WHERE name=?').get(name);
  const v = (row ? row.value : 0) + 1;
  db.prepare('INSERT INTO counters(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(name, v);
  return v;
});

const pad = (n, w) => String(n).padStart(w, '0');
const be = (iso) => T.buddhistYear(iso || clock.now());

module.exports = {
  nextCaseNo: (iso) => { const y = be(iso); return `EG-${y}-${pad(bump('case_' + y), 6)}`; },
  nextReceiptNo: (iso) => { const y = be(iso); return `RC-${y}-${pad(bump('receipt_' + y), 6)}`; },
  nextDocNo: (iso) => { const y = be(iso); return `DOC-${y}-${pad(bump('doc_' + y), 6)}`; },
  nextDraftId: () => `DR-${pad(bump('draft'), 4)}`,
  nextPaymentRef: () => `PP-${pad(bump('payment'), 4)}`,
  nextFileId: () => `F-${pad(bump('file'), 4)}`,
  nextVerifyCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) {
      const b = crypto.randomBytes(8);
      let s = '';
      for (let i = 0; i < 8; i++) s += A[b[i] % A.length];
      if (!db.prepare('SELECT 1 FROM documents WHERE verify_code=?').get(s)) return s;
    }
  },
  bump,
};
