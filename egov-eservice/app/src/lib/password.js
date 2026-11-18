'use strict';
// รหัสผ่านเจ้าหน้าที่: scrypt + salt สุ่ม · เก็บ 'scrypt$<saltHex>$<hashHex>'
const crypto = require('crypto');

function hash(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(pw), salt, 32).toString('hex')}`;
}

function verify(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const a = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
  const b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { hash, verify };
