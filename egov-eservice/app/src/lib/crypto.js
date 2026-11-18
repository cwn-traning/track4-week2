'use strict';
// NFR-04: เลขบัตรและเบอร์โทรเก็บเข้ารหัส AES-256-GCM (ไม่เก็บ plaintext ในฐานข้อมูล)
//  - encrypt/decrypt : 'v1:<iv>:<tag>:<ciphertext>' (base64url) · IV สุ่มทุกครั้ง
//  - blindIndex      : HMAC-SHA256 ของเลขบัตร ใช้ค้นหา (ห้ามย้อนกลับได้โดยตรง)
//  - signDoc/verify  : ลายเซ็นจำลอง HMAC-SHA256 ของ docNo|caseNo|applicant|serviceId|issuedAt|validUntil|signer (A-22)
const crypto = require('crypto');
const { ENC_KEY, SIGN_KEY } = require('../config');

const KEY = crypto.createHash('sha256').update('enc:' + ENC_KEY).digest(); // 32 ไบต์
const IDX_KEY = crypto.createHash('sha256').update('idx:' + ENC_KEY).digest();

function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
}

function decrypt(blob) {
  if (!blob) return null;
  const [v, iv, tag, ct] = String(blob).split(':');
  if (v !== 'v1') throw new Error('unsupported cipher format');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

const blindIndex = (value) => crypto.createHmac('sha256', IDX_KEY).update(String(value)).digest('hex');

// เลขบัตร 13 หลัก
function checkIdNo(id) {
  if (!/^\d{13}$/.test(String(id))) return false;
  const s = String(id);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +s[i] * (13 - i);
  return (11 - (sum % 11)) % 10 === +s[12];
}
const formatIdNo = (id) => `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}`; // 1-1017-00123-45-6
const maskIdNo = (id) => `X-XXXX-XXXXX-${id.slice(10, 12)}-${id[12]}`; // X-XXXX-XXXXX-45-6

const DOC_SIG_FIELDS = ['docNo', 'caseNo', 'applicant', 'serviceId', 'issuedAt', 'validUntil', 'signer'];
function signDoc(doc) {
  const msg = DOC_SIG_FIELDS.map((k) => String(doc[k] ?? '')).join('|');
  return crypto.createHmac('sha256', SIGN_KEY).update(msg).digest('hex');
}
function verifyDoc(doc, signature) {
  const a = Buffer.from(signDoc(doc), 'hex');
  const b = Buffer.from(String(signature || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { encrypt, decrypt, blindIndex, checkIdNo, formatIdNo, maskIdNo, signDoc, verifyDoc, DOC_SIG_FIELDS };
