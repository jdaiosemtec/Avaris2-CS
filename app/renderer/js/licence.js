// Avaris2 CS licensing: editions, read-only mode, licence request / activation, and the licence issuer for OSEMTEC staff.
//   1D    = Avaris2 CS 1D     : network modelling, simulation, results, GIS
//   2D    = Avaris2 CS 1D-2D  : everything in 1D + the 2D surface flood module
// A licence is bound to one computer (machine code) and has an expiry date (30 days, 1 year or N years). Without a valid
// licence (none, expired, other computer, clock set back) Avaris2 CS runs read-only: models and results can be opened
// and viewed, but not changed, saved or simulated.
// Phase 1: the user sends a licence request by e-mail (machine code + osemtec.com account); OSEMTEC checks the account and
// issues the licence with the Licence Issuer (Ctrl+Alt+L, needs the private key file). Keys are verified offline (main.js).
'use strict';
(function (AV) {
  const h = AV.h;
  AV.LICENSING = true;
  AV.LIC_EMAIL = 'info@osemtec.com';
  AV.EDITIONS = { '1D': 'Avaris2 CS 1D', '2D': 'Avaris2 CS 1D-2D' };
  const TERMS = [['30d', '30 days'], ['1y', '1 year'], ['ny', 'Several years']];
  const termLabel = (t) => { if (!t) return ''; if (t === '30d') return '30 days'; const m = /^(\d+)y$/.exec(t); return m ? (m[1] === '1' ? '1 year' : m[1] + ' years') : t; };
  AV.licValid = (app) => !AV.LICENSING || !!(app && app.license && app.license.valid);
  AV.has2D = (app) => !AV.LICENSING || !!(app && app.license && app.license.valid && app.license.edition === '2D');
  AV.editionLabel = (app) => { if (!AV.LICENSING) return ''; const L = app && app.license; if (!L || !L.valid) return '(read-only)'; return L.edition === '2D' ? '1D-2D' : '1D'; };
  const reason = (L) => !L || !L.error || L.error === 'No licence.' ? 'No licence is activated on this computer.' : L.error;

  // read-only gate for editing, saving and running; returns true when allowed
  AV.licenceGate = function (app, what, quiet) {
    if (AV.licValid(app)) return true;
    if (quiet) return false;
    if (app._gateOpen) return false; app._gateOpen = true;
    AV.modal({ title: 'Read-only mode', width: 480, body: h('div', { style: { lineHeight: 1.55 } },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, (what || 'This function') + ' needs a valid Avaris2 CS licence.'),
      h('div', null, reason(app.license)),
      h('div', { style: { marginTop: '6px', color: 'var(--muted)' } }, 'Without a licence you can open and view models and results, but not change, save or run them.')),
      buttons: [{ label: 'Close', value: null }, { label: 'Register...', primary: true, value: 'reg' }] }).done.then(v => { app._gateOpen = false; if (v === 'reg') app.registerDialog(); });
    return false;
  };
  // shown when a 2D function is used without a 1D-2D licence
  AV.need2D = function (app, what) {
    if (!AV.licValid(app)) return AV.licenceGate(app, what || 'The 2D flood module');
    return AV.modal({ title: 'Avaris2 CS 1D-2D licence required', width: 480, body: h('div', { style: { lineHeight: 1.55 } },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, (what || 'The 2D flood module') + ' is part of Avaris2 CS 1D-2D.'),
      h('div', null, 'Your licence: ' + AV.EDITIONS[app.license.edition] + ' (' + (app.license.licensee || app.license.user) + ').'),
      h('div', { style: { marginTop: '6px', color: 'var(--muted)' } }, 'Request a 1D-2D licence in Help ▸ Register to enable 2D Options, Create Meshes, 1D-2D simulation and flood maps.')),
      buttons: [{ label: 'Close', value: null }, { label: 'Register...', primary: true, value: 'reg' }] }).done.then(v => { if (v === 'reg') app.registerDialog(); return false; });
  };

  AV.App.prototype.loadLicence = async function () {
    const k = this.settings && this.settings.license && this.settings.license.key;
    try { this.license = k ? await window.host.licenseVerify(k) : { valid: false, edition: null, error: 'No licence.' }; } catch (e) { this.license = { valid: false, edition: null, error: e.message }; }
  };
  // licence changed: show / hide the 2D module, update the title and ribbon
  AV.App.prototype.applyLicence = async function () {
    const on = AV.has2D(this);
    if (!on) { this.mesh2d = null; this.meshResults = null; this.meshSel = -1; }
    else if (this.model && this.filePath && !this.mesh2d) { await AV.importAvaris2D(this); await AV.loadMesh2D(this); }
    if (this.results && on && this.mesh2d) await AV.computeMeshResults(this);
    this.refreshRibbon(); this.panels.refreshLayers(); this.map.redraw(); this.updateTitle();
  };
  // after sign-in: read-only notice, or an expiry reminder in the last 30 days
  AV.App.prototype.licenceStartup = function () {
    const L = this.license || {};
    if (!L.valid) {
      AV.modal({ title: 'Avaris2 CS licence', width: 500, body: h('div', { style: { lineHeight: 1.55 } },
        h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'Avaris2 CS is running in read-only mode.'), h('div', null, reason(L)),
        h('div', { style: { marginTop: '6px', color: 'var(--muted)' } }, 'Open Help ▸ Register to request a licence for this computer (it takes a minute: your osemtec.com account and one e-mail), or to activate the licence you received.')),
        buttons: [{ label: 'Continue read-only', value: null }, { label: 'Register...', primary: true, value: 'reg' }] }).done.then(v => { if (v === 'reg') this.registerDialog(); });
    } else if (L.daysLeft !== null && L.daysLeft !== undefined && L.daysLeft <= 30) {
      AV.toast('Your Avaris2 CS licence expires on ' + L.expiry + ' (' + Math.max(0, L.daysLeft) + ' day' + (L.daysLeft === 1 ? '' : 's') + ' left). Help ▸ Register to renew.', L.daysLeft <= 7, 9000);
    }
  };

  // ------------------------------------------------------------------ Register dialog
  const requestText = (r, mc, app) => {
    const term = r.term === 'ny' ? (Math.max(2, +r.years || 2) + ' years') : termLabel(r.term);
    const blob = { v: 1, user: r.user, name: r.name, company: r.company, email: r.email, ed: r.ed, term: r.term === 'ny' ? Math.max(2, +r.years || 2) + 'y' : r.term,
      code: mc.code, hw: mc.hw, host: mc.host, os: mc.os, app: (app.info && app.info.version) || '', date: new Date().toISOString().slice(0, 10) };
    const code = 'AVREQ-' + btoa(unescape(encodeURIComponent(JSON.stringify(blob)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const body = ['Avaris2 CS licence request', '',
      'osemtec.com account: ' + r.user, 'Name: ' + r.name, 'Company: ' + r.company, 'E-mail: ' + r.email, '',
      'Edition: ' + AV.EDITIONS[r.ed], 'Term: ' + term, '',
      'Machine code: ' + mc.code, 'Computer: ' + mc.host + ' (' + mc.os + ')', 'Avaris2 CS version: ' + blob.app, '',
      '--- request code (please do not edit) ---', code.match(/.{1,76}/g).join('\n'), '--- end ---'].join('\n');
    return { subject: 'Avaris2 CS licence request - ' + r.user + ' - ' + AV.EDITIONS[r.ed] + ' - ' + term, body, code };
  };
  AV.licRequestText = (r, mc, app) => requestText(r, mc, app);
  AV.App.prototype.registerDialog = async function () {
    const app = this; const L = this.license || {}; const P = this.prefs.registration || {};
    const mc = await window.host.licenseMachine();
    const cur = L.valid ? AV.EDITIONS[L.edition] + ' — ' + (L.licensee || L.user) + (L.company ? ', ' + L.company : '') + ' — valid until ' + L.expiry + (L.daysLeft !== null ? ' (' + L.daysLeft + ' days left)' : '') + (L.serial ? ' — serial ' + L.serial : '')
      : 'Read-only — ' + reason(L);
    const inp = (v, ph) => h('input', { type: 'text', value: v || '', placeholder: ph || '', style: { width: '100%' } });
    const user = inp(P.user, 'the user name of your account on osemtec.com'), name = inp(P.name), company = inp(P.company), email = inp(P.email);
    const ed = h('select', null, [['1D', 'Avaris2 CS 1D'], ['2D', 'Avaris2 CS 1D-2D']].map(([v, l]) => h('option', { value: v }, l))); ed.value = P.ed || (L.edition || '2D');
    const years = h('input', { type: 'number', min: 2, max: 10, value: P.years || 2, style: { width: '64px', marginLeft: '8px' } });
    const term = h('select', { onchange: () => { years.style.display = term.value === 'ny' ? '' : 'none'; } }, TERMS.map(([v, l]) => h('option', { value: v }, l))); term.value = P.term || '1y'; years.style.display = term.value === 'ny' ? '' : 'none';
    const code = h('input', { type: 'text', value: mc.code, readOnly: true, class: 'mono', style: { width: '210px', fontWeight: 600, letterSpacing: '.03em' } });
    const msg = h('div', { style: { minHeight: '18px', fontSize: '12px' } });
    const say = (t, err) => { msg.style.color = err ? 'var(--danger)' : 'var(--ok, #2e7d32)'; msg.textContent = t; };
    const form = () => ({ user: user.value.trim(), name: name.value.trim(), company: company.value.trim(), email: email.value.trim(), ed: ed.value, term: term.value, years: +years.value });
    const check = () => { const r = form(); this.prefs.registration = r; this.savePrefs();
      if (!r.user) { say('Enter the user name of your osemtec.com account (register on osemtec.com first).', true); return null; }
      if (!r.name || !/^\S+@\S+\.\S+$/.test(r.email)) { say('Enter your name and a valid e-mail address.', true); return null; } return r; };
    const send = () => { const r = check(); if (!r) return; const q = requestText(r, mc, app);
      window.host.openExternal('mailto:' + AV.LIC_EMAIL + '?subject=' + encodeURIComponent(q.subject) + '&body=' + encodeURIComponent(q.body));
      say('Your e-mail program opens with the request to ' + AV.LIC_EMAIL + ' — please press Send there. If nothing opens, use Copy Request or Save Request File.'); };
    const copy = () => { const r = check(); if (!r) return; const q = requestText(r, mc, app); navigator.clipboard.writeText('To: ' + AV.LIC_EMAIL + '\nSubject: ' + q.subject + '\n\n' + q.body).then(() => say('Request copied — paste it into an e-mail to ' + AV.LIC_EMAIL + '.')); };
    const save = async () => { const r = check(); if (!r) return; const q = requestText(r, mc, app);
      const p = await window.host.saveDialog({ title: 'Save licence request', defaultPath: 'Avaris2CS_request_' + mc.code.slice(4).replace(/-/g, '') + '.avreq', filters: [{ name: 'Licence request', extensions: ['avreq', 'txt'] }] });
      if (p) { await window.host.writeText(p, 'To: ' + AV.LIC_EMAIL + '\r\nSubject: ' + q.subject + '\r\n\r\n' + q.body.replace(/\n/g, '\r\n'), 'utf8'); say('Saved. Send this file to ' + AV.LIC_EMAIL + ' from any computer.'); } };
    const key = h('textarea', { rows: 3, spellcheck: 'false', class: 'mono', style: { width: '100%', resize: 'vertical' }, placeholder: 'AV2L-...  (paste the licence key from the e-mail, or load the .avlic file)' });
    const loadFile = async () => { const p = await window.host.openDialog({ filters: [{ name: 'Avaris2 CS licence', extensions: ['avlic', 'txt'] }] }); if (!p) return; const t = await window.host.readText(p); const m = /AV2L-[A-Za-z0-9_\-.\s]+/.exec(t); key.value = m ? m[0].replace(/\s+/g, '') : t.trim(); };
    const B = (l, fn, pri) => h('button', { class: 'btn small' + (pri ? ' primary' : ''), onclick: fn }, l);
    const body = h('div', { class: 'licdlg', style: { width: '600px', display: 'flex', flexDirection: 'column', gap: '8px' } },
      h('div', { class: 'licur' + (L.valid ? ' ok' : '') }, h('b', null, 'Licence: '), cur),
      h('div', { class: 'lichead' }, '1. Request a licence for this computer'),
      h('div', { class: 'form' }, h('label', null, 'Machine code'), h('span', null, code, ' ', B('Copy', () => navigator.clipboard.writeText(mc.code).then(() => AV.toast('Machine code copied.')))),
        h('label', null, 'osemtec.com account'), user, h('label', null, 'Name'), name, h('label', null, 'Company / Organisation'), company, h('label', null, 'E-mail'), email,
        h('label', null, 'Edition'), ed, h('label', null, 'Term'), h('span', null, term, years)),
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, B('Send Request by E-mail', send, true), B('Copy Request', copy), B('Save Request File...', save)),
      h('div', { class: 'note' }, 'OSEMTEC checks your osemtec.com account and purchase, then e-mails you a licence for this computer. The request contains the machine code, your account and the edition only.'),
      h('div', { class: 'lichead' }, '2. Activate the licence you received'), key,
      h('div', { style: { display: 'flex', gap: '6px' } }, B('Load Licence File...', loadFile)), msg);
    const r = await AV.modal({ title: 'Register Avaris2 CS', body, buttons: [{ label: 'Close', value: null }, L.valid ? { label: 'Release this Computer...', value: 'release' } : null, { label: 'Activate', primary: true, onClick: async () => {
      const k = key.value.replace(/\s+/g, ''); if (!k) { say('Paste the licence key you received from OSEMTEC, or load the licence file.', true); return false; }
      const v = await window.host.licenseVerify(k); if (!v.valid) { say(v.error || 'Invalid licence key.', true); return false; }
      return { k, v }; } }].filter(Boolean) }).done;
    this.prefs.registration = form(); this.savePrefs();
    if (r === 'release') return this.releaseLicence();
    if (!r || !r.k) return;
    this.settings.license = { key: r.k, activated: new Date().toISOString() }; window.host.setSettings(this.settings); this.license = r.v; await this.applyLicence();
    AV.alert('Licence activated: ' + AV.EDITIONS[r.v.edition] + '\nLicensed to: ' + (r.v.licensee || r.v.user) + (r.v.company ? ', ' + r.v.company : '') + '\nValid until: ' + r.v.expiry + (r.v.edition === '2D' ? '\n\nThe 2D flood functions are enabled.' : ''), 'Register Avaris2 CS');
  };
  // move a licence to another computer: remove it here and give OSEMTEC a release code to quote
  AV.App.prototype.releaseLicence = async function () {
    const L = this.license || {}; const mc = await window.host.licenseMachine();
    if (!await AV.confirm('Remove the licence from this computer? Avaris2 CS then runs read-only here. You receive a release code: send it to ' + AV.LIC_EMAIL + ' with the machine code of the new computer.', 'Release this Computer', 'Release')) return;
    const data = new TextEncoder().encode('avaris2-release|' + (L.serial || '') + '|' + mc.code);
    const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', data)); const rel = 'REL-' + Array.from(dig.slice(0, 6)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    delete this.settings.license; window.host.setSettings(this.settings); this.license = { valid: false, edition: null, error: 'The licence was released from this computer.' }; await this.applyLicence();
    const text = 'Licence serial: ' + (L.serial || '-') + '\nMachine code: ' + mc.code + '\nRelease code: ' + rel;
    AV.modal({ title: 'Licence released', width: 460, body: h('div', { style: { lineHeight: 1.6 } }, h('pre', { class: 'mono', style: { margin: '0 0 8px' } }, text), h('div', { class: 'note' }, 'Send these lines to ' + AV.LIC_EMAIL + ' together with a licence request from the new computer.')),
      buttons: [{ label: 'Copy', onClick: () => { navigator.clipboard.writeText(text).then(() => AV.toast('Copied.')); return false; } }, { label: 'OK', primary: true }] });
  };

  // ------------------------------------------------------------------ Licence Issuer (OSEMTEC staff, Ctrl+Alt+L)
  AV.licenceIssuer = async function (app) {
    const P = app.prefs.issuer || {};
    const pem = h('input', { type: 'text', value: P.pem || '', placeholder: 'private_key.pem (kept by OSEMTEC only)', style: { width: '100%' } });
    const pick = h('button', { class: 'btn small', onclick: async () => { const p = await window.host.openDialog({ filters: [{ name: 'Private key', extensions: ['pem'] }] }); if (p) pem.value = p; } }, '...');
    const req = h('textarea', { rows: 5, spellcheck: 'false', class: 'mono', style: { width: '100%' }, placeholder: 'Paste the whole request e-mail (or the AVREQ-... code)' });
    const info = h('div', { class: 'note', style: { minHeight: '18px', whiteSpace: 'pre-wrap' } });
    const ed = h('select', null, [['1D', 'Avaris2 CS 1D'], ['2D', 'Avaris2 CS 1D-2D']].map(([v, l]) => h('option', { value: v }, l)));
    const years = h('input', { type: 'number', min: 2, max: 20, value: 2, style: { width: '64px', marginLeft: '8px' } });
    const term = h('select', { onchange: () => { years.style.display = term.value === 'ny' ? '' : 'none'; upd(); } }, TERMS.map(([v, l]) => h('option', { value: v }, l)));
    const start = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const exp = h('span', { style: { fontWeight: 600 } }); const serial = h('input', { type: 'text', value: 'A2-' + Date.now().toString(36).toUpperCase(), style: { width: '180px' } });
    const out = h('textarea', { rows: 4, readOnly: true, class: 'mono', style: { width: '100%' } }); let R = null, lastKey = '';
    const addTerm = (d, t, n) => { const x = new Date(d + 'T12:00:00'); if (t === '30d') x.setDate(x.getDate() + 30); else x.setFullYear(x.getFullYear() + (t === 'ny' ? n : 1)); return x.toISOString().slice(0, 10); };
    const upd = () => { years.style.display = term.value === 'ny' ? '' : 'none'; exp.textContent = 'expires ' + addTerm(start.value, term.value, Math.max(2, +years.value || 2)); };
    [years, start].forEach(e => e.addEventListener('input', upd));
    // the request code may be wrapped over several lines (e-mail); it ends at the '--- end ---' line or the first other line
    AV.licReqCode = (text) => { const lines = String(text).split(/\r?\n/).map(l => l.trim().replace(/^>+\s*/, '')); const i = lines.findIndex(l => /^AVREQ-/.test(l)); if (i < 0) return null;
      let c = lines[i]; for (let k = i + 1; k < lines.length && /^[A-Za-z0-9_-]+$/.test(lines[k]) && !/^---/.test(lines[k]); k++) c += lines[k]; return c; };
    const parse = () => { R = null; const code = AV.licReqCode(req.value); if (!code) { info.textContent = 'No AVREQ request code found.'; return; }
      try { const b = code.slice(6).replace(/-/g, '+').replace(/_/g, '/'); R = JSON.parse(decodeURIComponent(escape(atob(b + '==='.slice((b.length + 3) % 4))))); } catch (e) { info.textContent = 'The request code is damaged: ' + e.message; return; }
      ed.value = R.ed || '1D'; const t = R.term || '1y'; if (/^\d+y$/.test(t) && t !== '1y') { term.value = 'ny'; years.value = parseInt(t, 10); } else term.value = t === '30d' ? '30d' : '1y'; upd();
      info.textContent = 'osemtec.com account: ' + R.user + '\n' + R.name + (R.company ? ', ' + R.company : '') + ' <' + R.email + '>\nMachine code: ' + R.code + ' — ' + R.host + ' (' + R.os + ') — Avaris2 CS ' + R.app + ' — requested ' + R.date + '\nCheck the account and the purchase on osemtec.com before issuing.'; };
    req.addEventListener('input', parse);
    const B = (l, fn, pri) => h('button', { class: 'btn small' + (pri ? ' primary' : ''), onclick: fn }, l);
    const issue = async () => {
      if (!R) { AV.toast('Paste a licence request first.', true); return; } if (!pem.value) { AV.toast('Choose the private key file.', true); return; }
      app.prefs.issuer = { pem: pem.value }; app.savePrefs();
      const t = term.value === 'ny' ? Math.max(2, +years.value || 2) + 'y' : term.value;
      const lic = { ed: ed.value, term: t, user: R.user, name: R.name, company: R.company, email: R.email, iss: start.value, exp: addTerm(start.value, term.value, Math.max(2, +years.value || 2)), ser: serial.value.trim(), mc: R.code, hw: R.hw, host: R.host };
      try { const res = await window.host.licenseIssue(pem.value, lic); lastKey = res.key; out.value = res.key; AV.toast('Licence issued and added to ' + res.ledger); serial.value = 'A2-' + Date.now().toString(36).toUpperCase(); R.lic = lic; }
      catch (e) { AV.alert('Could not issue the licence: ' + e.message); }
    };
    const mail = () => { if (!lastKey || !R) return; const L = R.lic;
      const body = ['Dear ' + (R.name || R.user) + ',', '', 'thank you for choosing Avaris2 CS. Your licence:', '', 'Edition: ' + AV.EDITIONS[L.ed], 'Valid: ' + L.iss + ' to ' + L.exp + ' (' + termLabel(L.term) + ')', 'Computer: ' + R.code + ' (' + R.host + ')', 'Serial: ' + L.ser, '',
        'To activate: Avaris2 CS > Help > Register > paste the key below into "Activate" > Activate.', '', lastKey.match(/.{1,76}/g).join('\n'), '', 'Best regards,', 'OSEMTEC'].join('\n');
      window.host.openExternal('mailto:' + encodeURIComponent(R.email) + '?subject=' + encodeURIComponent('Your Avaris2 CS licence - ' + AV.EDITIONS[L.ed] + ' - ' + L.ser) + '&body=' + encodeURIComponent(body)); };
    const saveLic = async () => { if (!lastKey || !R) return; const p = await window.host.saveDialog({ title: 'Save licence file', defaultPath: 'Avaris2CS_' + R.user.replace(/\W+/g, '_') + '_' + R.lic.ser + '.avlic', filters: [{ name: 'Avaris2 CS licence', extensions: ['avlic'] }] }); if (p) await window.host.writeText(p, lastKey + '\r\n', 'utf8'); };
    const relIn = h('input', { type: 'text', placeholder: 'serial', style: { width: '150px' } }), relMc = h('input', { type: 'text', placeholder: 'old machine code', style: { width: '210px' } }), relOut = h('span', { class: 'mono' });
    const relCheck = async () => { const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('avaris2-release|' + relIn.value.trim() + '|' + relMc.value.trim()))); relOut.textContent = 'expected: REL-' + Array.from(dig.slice(0, 6)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase(); };
    upd();
    AV.modal({ title: 'Licence Issuer (OSEMTEC)', width: 680, body: h('div', { class: 'licdlg', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      h('div', { class: 'form' }, h('label', null, 'Private key'), h('span', { style: { display: 'flex', gap: '4px' } }, pem, pick)),
      h('div', { class: 'lichead' }, 'Request'), req, info,
      h('div', { class: 'form' }, h('label', null, 'Edition'), ed, h('label', null, 'Term'), h('span', null, term, years), h('label', null, 'Start date'), h('span', null, start, '  ', exp), h('label', null, 'Serial'), serial),
      h('div', { style: { display: 'flex', gap: '6px' } }, B('Issue Licence', issue, true), B('E-mail to Customer', mail), B('Save .avlic File...', saveLic)), out,
      h('div', { class: 'note' }, 'Every licence is appended to licence_ledger.csv next to the private key.'),
      h('div', { class: 'lichead' }, 'Check a release code'), h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, relIn, relMc, B('Check', relCheck), relOut)),
      buttons: [{ label: 'Close', primary: true }] });
  };
})(window.AV);
