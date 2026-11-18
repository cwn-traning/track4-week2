'use strict';
// B03 · เครื่องคิดค่าธรรมเนียม + ปฏิทินวันทำการ + SLA / ระดับเตือน (BR-04 BR-05 BR-12 BR-13 BR-14)
// ฟังก์ชันล้วน (pure) ยกเว้นตัวที่ไม่ได้ส่ง holidays มา จะอ่านตาราง holidays จาก DB
// เวลา "ตอนนี้" อ่านจาก lib/clock เท่านั้น (ห้าม Date.now()/new Date() ที่ไม่มีอาร์กิวเมนต์)
const T = require('./lib/time');
const clock = require('./lib/clock');
const { isBug } = require('./lib/bugs');

const CUTOFF_H = 16;
const CUTOFF_M = 30;
const CUTOFF_HMS = '16:30:00';
const DAY_MS = 86400000;

// ---------------------------------------------------------------- ค่าธรรมเนียม
const DEFAULT_FEES = {
  'SV-01': { fee: 20 },
  'SV-02': { fee: 500 },
  'SV-03': { feeBase: 1000, feePerSqm: 10 },
};
const DEFAULT_SLA = { 'SV-01': 3, 'SV-02': 10, 'SV-03': 15 };

const MSG = {
  INVALID_QTY: 'จำนวนฉบับต้อง 1–5 ฉบับ',
  INVALID_AREA: 'กรุณาระบุพื้นที่ 1–500 ตร.ม.',
  AREA_TOO_LARGE: 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน',
};

// รับเลขจำนวนเต็มจาก number หรือ string ตัวเลขล้วน · อย่างอื่น -> null
function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return parseInt(v, 10);
  return null;
}

// cfg = แถวจากตาราง services (fee, fee_base, fee_per_sqm) หรือ {fee, feeBase, feePerSqm} · ไม่ส่ง = ค่ามาตรฐาน
function feeConfig(serviceId, cfg) {
  const d = DEFAULT_FEES[serviceId] || {};
  const c = cfg || {};
  const pick = (a, b, dflt) => (Number.isInteger(c[a]) ? c[a] : Number.isInteger(c[b]) ? c[b] : dflt);
  return {
    fee: pick('fee', 'fee', d.fee),
    feeBase: pick('feeBase', 'fee_base', d.feeBase),
    feePerSqm: pick('feePerSqm', 'fee_per_sqm', d.feePerSqm),
  };
}

// คืน {ok:true, fee} หรือ {ok:false, code, message, status:400}
// SV-01 input {qty} · SV-02 ไม่ต้องมี input · SV-03 input {area}
function calcFee(serviceId, input, cfg) {
  const inp = input || {};
  const c = feeConfig(serviceId, cfg);
  const bad = (code) => ({ ok: false, code, message: MSG[code], status: 400 });
  if (serviceId === 'SV-01') {
    const q = toInt(inp.qty);
    if (q == null || q < 1 || q > 5) return bad('INVALID_QTY');
    return { ok: true, fee: c.fee * q };
  }
  if (serviceId === 'SV-02') return { ok: true, fee: c.fee };
  if (serviceId === 'SV-03') {
    const a = toInt(inp.area);
    if (a == null || a < 1) return bad('INVALID_AREA');
    if (a > 500) return bad('AREA_TOO_LARGE');
    // BUG B01: ใช้ > 101 แทน >= 101 (พื้นที่ 101 ได้ ฿1,000)
    const over = isBug('B01') ? a > 101 : a > 100;
    return { ok: true, fee: over ? c.feeBase + c.feePerSqm * (a - 100) : c.feeBase };
  }
  return { ok: false, code: 'UNKNOWN_SERVICE', message: 'ไม่พบบริการ', status: 404 };
}

// ---------------------------------------------------------------- ปฏิทินวันทำการ
// รายการวันหยุดจาก DB (โหลดทุกครั้งที่เรียก เพื่อให้เห็นการแก้ของ admin ทันที) -> Set 'YYYY-MM-DD'
function loadHolidays() {
  const { db } = require('./db');
  return new Set(db.prepare('SELECT date FROM holidays').all().map((r) => r.date));
}
function asSet(holidays) {
  if (holidays instanceof Set) return holidays;
  if (Array.isArray(holidays)) return new Set(holidays.map((h) => (typeof h === 'string' ? h : h.date)));
  return loadHolidays();
}

// 'YYYY-MM-DD' ± n วัน (ปฏิทินล้วน ไม่เกี่ยวเขตเวลา)
function shiftDate(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
function dowOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// วันทำการ = จันทร์–ศุกร์ ที่ไม่อยู่ในตารางวันหยุด
// BUG B03: ไม่ข้ามวันหยุดในตาราง (ข้ามแค่ ส-อา)
function isBusinessDay(ymd, holidays) {
  const dow = dowOf(ymd);
  if (dow === 0 || dow === 6) return false;
  if (isBug('B03')) return true;
  return !asSet(holidays).has(ymd);
}

// วันทำการแรกที่ >= ymd
function rollForward(ymd, holidays) {
  const hs = asSet(holidays);
  let d = ymd;
  while (!isBusinessDay(d, hs)) d = shiftDate(d, 1);
  return d;
}

// วันทำการที่ n ถัดจาก ymd (ไม่นับ ymd เอง ไม่ว่า ymd จะเป็นวันทำการหรือไม่)
function addBusinessDays(ymd, n, holidays) {
  const hs = asSet(holidays);
  let d = ymd;
  let left = n;
  while (left > 0) {
    d = shiftDate(d, 1);
    if (isBusinessDay(d, hs)) left--;
  }
  return d;
}

// จำนวนวันทำการใน (from, to]  (ไม่นับ from นับ to) · to <= from -> 0
function businessDaysBetween(from, to, holidays) {
  if (to <= from) return 0;
  const hs = asSet(holidays);
  let n = 0;
  for (let d = shiftDate(from, 1); d <= to; d = shiftDate(d, 1)) if (isBusinessDay(d, hs)) n++;
  return n;
}

// ---------------------------------------------------------------- SLA
// D0 ของเวลาชำระ (ISO) · ก่อน 16:30:00 และเป็นวันทำการ = วันนั้น ไม่เช่นนั้นวันทำการถัดไป
function startDay(paidAtIso, holidays) {
  const iso = T.normalize(paidAtIso);
  const ymd = T.dateOf(iso);
  const hs = asSet(holidays);
  const beforeCutoff = iso.slice(11, 19) < CUTOFF_HMS;
  if (isBusinessDay(ymd, hs) && beforeCutoff) return ymd;
  return rollForward(shiftDate(ymd, 1), hs);
}

const dueIso = (ymd) => `${ymd}T${CUTOFF_HMS}+07:00`;

// กำหนดเสร็จ (ISO +07:00) = วันทำการที่ N หลัง D0 เวลา 16:30 · N = slaDays (ถ้าไม่ส่ง ใช้ค่ามาตรฐานของบริการ)
function computeDueAt(serviceId, paidAtIso, slaDays, holidays) {
  const n = Number.isInteger(slaDays) ? slaDays : DEFAULT_SLA[serviceId];
  const hs = asSet(holidays);
  return dueIso(addBusinessDays(startDay(paidAtIso, hs), n, hs));
}

// BR-13: จำนวนวันทำการที่หยุดนับ = วันทำการใน (วันที่ตีกลับ, วันที่ส่งแก้] ตามวันที่ (ไม่ขึ้นกับเวลา)
function pausedBusinessDays(returnedAtIso, resubmittedAtIso, holidays) {
  return businessDaysBetween(T.dateOf(T.normalize(returnedAtIso)), T.dateOf(T.normalize(resubmittedAtIso)), holidays);
}

// กำหนดเสร็จใหม่หลังส่งแก้ = กำหนดเดิม + วันทำการที่หยุดนับ (นับจากวันที่ของกำหนดเดิม เวลา 16:30)
// BUG B04: ไม่หยุดนับ -> กำหนดเดิมไม่เปลี่ยน
function extendDueAt(dueAtIso, returnedAtIso, resubmittedAtIso, holidays) {
  if (isBug('B04')) return T.normalize(dueAtIso);
  const n = pausedBusinessDays(returnedAtIso, resubmittedAtIso, holidays);
  if (n === 0) return T.normalize(dueAtIso);
  return dueIso(addBusinessDays(T.dateOf(T.normalize(dueAtIso)), n, holidays));
}

// ---------------------------------------------------------------- ระดับเตือน (BR-14 · CONTRACT 4.2)
const LEVEL_LABEL = {
  normal: 'ปกติ',
  near: 'ใกล้ครบกำหนด',
  overdue: 'เกินกำหนด',
  paused: 'หยุดนับ',
  closed: 'ปิดแล้ว',
};
const CLOSED = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);
const OPEN_ACTIVE = new Set(['SUBMITTED', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED']);

// วันคงเหลือ = จำนวนวันทำการหลังวันนี้ถึงวันกำหนดเสร็จ (รวมวันกำหนด)
function remainingDays(dueAtIso, nowIso, holidays) {
  return businessDaysBetween(T.dateOf(nowIso), T.dateOf(dueAtIso), holidays);
}

// คืน {level, label, remaining} · nowIso ไม่ส่ง = clock.now()
function slaLevel(status, dueAtIso, nowIso, holidays) {
  const now = T.normalize(nowIso || clock.now());
  if (CLOSED.has(status)) return { level: 'closed', label: LEVEL_LABEL.closed, remaining: null };
  if (status === 'NEED_FIX') return { level: 'paused', label: LEVEL_LABEL.paused, remaining: null };
  if (!dueAtIso) return { level: 'normal', label: LEVEL_LABEL.normal, remaining: null };
  const dueMs = T.parseIso(dueAtIso);
  const nowMs = T.parseIso(now);
  let level;
  let remaining;
  if (nowMs > dueMs) {
    level = 'overdue';
    remaining = 0;
  } else {
    remaining = remainingDays(dueAtIso, now, holidays);
    level = remaining >= 2 ? 'normal' : 'near';
  }
  return { level, label: LEVEL_LABEL[level], remaining };
}

// เกินกำหนด? (ใช้กับ dashboard: นับเฉพาะคำขอค้างที่ไม่ใช่ NEED_FIX) · ขอบ: เกินเมื่อ now > due เท่านั้น
function isOverdue(status, dueAtIso, nowIso) {
  if (!OPEN_ACTIVE.has(status) || !dueAtIso) return false;
  return T.parseIso(T.normalize(nowIso || clock.now())) > T.parseIso(dueAtIso);
}

// ปิดงานทันกำหนด? closed_at <= due (รวม 16:30:00)
function isOnTime(closedAtIso, dueAtIso) {
  return T.parseIso(closedAtIso) <= T.parseIso(dueAtIso);
}

module.exports = {
  // fee
  calcFee, MSG, DEFAULT_FEES, DEFAULT_SLA,
  // calendar
  loadHolidays, isBusinessDay, rollForward, addBusinessDays, businessDaysBetween, shiftDate,
  // sla
  startDay, computeDueAt, pausedBusinessDays, extendDueAt, remainingDays,
  slaLevel, isOverdue, isOnTime, LEVEL_LABEL, CUTOFF_H, CUTOFF_M,
};
