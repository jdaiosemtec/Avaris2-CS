// OsemCM licence key generator (keep private_key.pem secret; never ship it with the application)
// usage: node keygen.js --edition 1D|2D --name "Licensee" [--expiry YYYY-MM-DD] [--serial S0001]
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const a = process.argv.slice(2); const opt = {}; for (let i = 0; i < a.length; i += 2) opt[a[i].replace(/^--/, '')] = a[i + 1];
const ed = String(opt.edition || '').toUpperCase(); if (!['1D', '2D'].includes(ed)) { console.error('--edition must be 1D or 2D'); process.exit(1); }
const name = String(opt.name || '').replace(/\|/g, ' ').trim(); if (!name) { console.error('--name is required'); process.exit(1); }
const exp = opt.expiry || ''; if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) { console.error('--expiry must be YYYY-MM-DD'); process.exit(1); }
const serial = opt.serial || ('S' + Date.now().toString(36).toUpperCase());
const payload = ['1', ed, name, exp, serial, new Date().toISOString().slice(0, 10)].join('|');
const key = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'private_key.pem')));
const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key);
const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
console.log('OSEMCM-' + b64(payload) + '.' + b64(sig));
