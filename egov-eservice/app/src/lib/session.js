'use strict';
// session cookie 'sid' (HttpOnly, SameSite=Lax) เก็บในตาราง sessions (reset ล้างทั้งหมด · CONTRACT 0.9)
//   middleware loadSession  -> req.user = null | { kind, role, username?, citizenId?, name, dept, registered }
//   createSession(res, {kind, role, citizenId, username, name, dept, registered})
//   destroySession(req, res)
const crypto = require('crypto');
const { db } = require('../db');
const clock = require('./clock');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function loadSession(req, _res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  req.user = null;
  const sid = req.cookies.sid;
  if (sid) {
    const s = db.prepare('SELECT * FROM sessions WHERE sid=?').get(sid);
    if (s) {
      req.sid = sid;
      req.user = {
        kind: s.kind, role: s.role, username: s.username, citizenId: s.citizen_id,
        name: s.name, dept: s.dept, registered: !!s.registered,
      };
    }
  }
  next();
}

function createSession(res, o) {
  const sid = crypto.randomBytes(24).toString('hex');
  db.prepare(`INSERT INTO sessions(sid,kind,citizen_id,username,role,dept,name,registered,created_at)
              VALUES(?,?,?,?,?,?,?,?,?)`).run(
    sid, o.kind, o.citizenId ?? null, o.username ?? null, o.role, o.dept || '', o.name || '', o.registered === false ? 0 : 1, clock.now());
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  return sid;
}

function destroySession(req, res) {
  if (req.sid) db.prepare('DELETE FROM sessions WHERE sid=?').run(req.sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

module.exports = { loadSession, createSession, destroySession, parseCookies };
