// Avaris2 CS licence issuer (command line). Keep private_key.pem secret; never ship it with the application.
// For day-to-day issuing and managing use tools/licence-manager/Avaris2CS_Licence_Manager.html (keeps licences.json).
// usage: node keygen.js --request "<AVREQ-... code>" [--edition 1D|2D] [--term 30d|1y|3y] [--start YYYY-MM-DD] [--serial A2-0001]
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const a = process.argv.slice(2); const opt = {}; for (let i = 0; i < a.length; i += 2) opt[a[i].replace(/^--/, '')] = a[i + 1];
const lines = String(opt.request || '').split(/\r?\n/).map(l => l.trim()); const i0 = lines.findIndex(l => /^AVREQ-/.test(l));
let reqc = i0 < 0 ? '' : lines[i0]; for (let k = i0 + 1; i0 >= 0 && k < lines.length && /^[A-Za-z0-9_-]+$/.test(lines[k]); k++) reqc += lines[k];
const m = /^AVREQ-([A-Za-z0-9_-]+)$/.exec(reqc); if (!m) { console.error('--request "AVREQ-..." is required'); process.exit(1); }
const R = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
const ed = String(opt.edition || R.ed || '').toUpperCase(); if (!['1D', '2D'].includes(ed)) { console.error('--edition must be 1D or 2D'); process.exit(1); }
const term = opt.term || R.term || '1y'; const start = opt.start || new Date().toISOString().slice(0, 10);
const d = new Date(start + 'T12:00:00'); if (term === '30d') d.setDate(d.getDate() + 30); else d.setFullYear(d.getFullYear() + (parseInt(term, 10) || 1));
const lic = { v: 2, ed, term, user: R.user, name: opt.name || R.name || '', company: opt.company || R.company || '', email: R.email, iss: start, exp: d.toISOString().slice(0, 10), ser: opt.serial || ('A2-' + Date.now().toString(36).toUpperCase()), mc: R.code, hw: R.hw };
const key = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'private_key.pem')));
const body = Buffer.from(JSON.stringify(lic), 'utf8'); const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
console.log(JSON.stringify(lic, null, 1)); console.log('AV2L-' + b64(body) + '.' + b64(crypto.sign(null, body, key)));
