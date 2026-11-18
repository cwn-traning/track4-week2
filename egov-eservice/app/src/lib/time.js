'use strict';
// เวลาทั้งระบบ = Asia/Bangkok (+07:00) และอ่านจาก clock เท่านั้น (ห้ามเรียก Date.now() ในกฎธุรกิจ)
// รูปแบบเก็บ/ส่ง: 'YYYY-MM-DDTHH:mm:ss+07:00' (ทุกค่าใช้ offset เดียวกัน จึงเรียงตามตัวอักษรได้ = เรียงตามเวลา)
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const OFFSET_MS = 7 * 3600 * 1000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const pad = (n, w = 2) => String(n).padStart(w, '0');

// epoch ms -> ISO +07:00
function fromMs(ms) {
  const d = new Date(ms + OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+07:00`;
}

// ISO ที่ต้องมี offset (Z หรือ ±hh:mm) -> epoch ms · ไม่ถูกต้อง -> null
function parseIso(s) {
  if (typeof s !== 'string') return null;
  const m = ISO_RE.exec(s.trim());
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S = '0', tz] = m;
  const y = +Y, mo = +Mo, d = +D, h = +H, mi = +Mi, sec = +S;
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || sec > 59) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  let off = 0;
  if (tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    const oh = +tz.slice(1, 3), om = +tz.slice(4, 6);
    if (oh > 23 || om > 59) return null;
    off = sign * (oh * 60 + om) * 60000;
  }
  return Date.UTC(y, mo - 1, d, h, mi, sec) - off;
}

// ISO ใด ๆ -> ISO +07:00 มาตรฐาน (null ถ้าไม่ถูกต้อง)
function normalize(s) {
  const ms = parseIso(s);
  return ms == null ? null : fromMs(ms);
}

// ส่วนประกอบเวลาไทยของ epoch ms
function parts(ms) {
  const d = new Date(ms + OFFSET_MS);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
    dow: d.getUTCDay(), // 0=อาทิตย์ … 6=เสาร์
  };
}

const dateOf = (iso) => iso.slice(0, 10); // 'YYYY-MM-DD' (เวลาไทย เพราะ ISO เป็น +07:00 เสมอ)
const buddhistYear = (iso) => parseInt(iso.slice(0, 4), 10) + 543;

// '4 ธ.ค. 2569 16:30' (A-04)
function fmtThai(iso) {
  const ms = parseIso(iso);
  if (ms == null) return '';
  const p = parts(ms);
  return `${p.d} ${THAI_MONTHS[p.mo - 1]} ${p.y + 543} ${pad(p.h)}:${pad(p.mi)}`;
}
// '4 ธ.ค. 2569' (วันที่ล้วน เช่น validUntil '2027-02-02')
function fmtThaiDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return `${+m[3]} ${THAI_MONTHS[+m[2] - 1]} ${+m[1] + 543}`;
}
// ฿1,010 (A-04)
const fmtBaht = (n) => '฿' + Number(n).toLocaleString('en-US');

module.exports = { fromMs, parseIso, normalize, parts, dateOf, buddhistYear, fmtThai, fmtThaiDate, fmtBaht, THAI_MONTHS, OFFSET_MS };
