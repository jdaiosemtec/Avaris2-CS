// Avaris2 CS licensing: editions, read-only mode, licence request / activation.
//   1D    = Avaris2 CS 1D     : network modelling, simulation, results, GIS
//   2D    = Avaris2 CS 1D-2D  : everything in 1D + the 2D surface flood module
// A licence is bound to one computer (machine code) and has an expiry date (30 days, 1 year or N years). Without a valid
// licence (none, expired, other computer, clock set back) Avaris2 CS runs read-only: models and results can be opened
// and viewed, but not changed, saved or simulated.
// Phase 1: the user sends a licence request by e-mail (machine code + osemtec.com account); OSEMTEC checks the account and
// issues it with the Licence Manager (tools/licence-manager, OSEMTEC only, needs the private key). Keys are verified offline (main.js).
'use strict';
(function (AV) {
  const h = AV.h;
  AV.LICENSING = true;
  AV.LIC_EMAIL = 'info@osemtec.com';
  AV.EDITIONS = { '1D': 'Avaris2 CS 1D', '2D': 'Avaris2 CS 1D-2D' };
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
  // The user gives only the osemtec.com account and an e-mail address. Edition, term, name and company are decided by
  // OSEMTEC from the purchase record when the licence is issued (Licence Manager).
  const requestText = (r, mc, app) => {
    const blob = { v: 2, user: r.user, email: r.email, code: mc.code, hw: mc.hw, host: mc.host, os: mc.os, app: (app.info && app.info.version) || '', date: new Date().toISOString().slice(0, 10) };
    const code = 'AVREQ-' + btoa(unescape(encodeURIComponent(JSON.stringify(blob)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const body = ['Avaris2 CS licence request', '',
      'osemtec.com account: ' + r.user, 'E-mail: ' + r.email, '',
      'Machine code: ' + mc.code, 'Computer: ' + mc.host + ' (' + mc.os + ')', 'Avaris2 CS version: ' + blob.app, '',
      '--- request code (please do not edit) ---', code.match(/.{1,76}/g).join('\n'), '--- end ---'].join('\n');
    return { subject: 'Avaris2 CS licence request - ' + r.user + ' - ' + mc.code, body, code };
  };
  AV.licRequestText = (r, mc, app) => requestText(r, mc, app);
  // web-mail compose links: the browser opens the user's mailbox (already signed in) with the e-mail ready to send
  const MAILERS = [['gmail', 'Gmail'], ['outlook', 'Outlook.com'], ['o365', 'Microsoft 365'], ['app', 'E-mail program']];
  AV.mailUrl = (via, to, subject, body) => { const e = encodeURIComponent;
    if (via === 'gmail') return 'https://mail.google.com/mail/?view=cm&fs=1&to=' + e(to) + '&su=' + e(subject) + '&body=' + e(body);
    if (via === 'outlook') return 'https://outlook.live.com/mail/0/deeplink/compose?to=' + e(to) + '&subject=' + e(subject) + '&body=' + e(body);
    if (via === 'o365') return 'https://outlook.office.com/mail/deeplink/compose?to=' + e(to) + '&subject=' + e(subject) + '&body=' + e(body);
    return 'mailto:' + to + '?subject=' + e(subject) + '&body=' + e(body); };
  AV.App.prototype.registerDialog = async function () {
    const app = this; const L = this.license || {}; const P = this.prefs.registration || {};
    const mc = await window.host.licenseMachine(); const direct = await window.host.licenseCanSubmit();
    const cur = L.valid ? AV.EDITIONS[L.edition] + ' — ' + (L.licensee || L.user) + (L.company ? ', ' + L.company : '') + ' — valid until ' + L.expiry + (L.daysLeft !== null ? ' (' + L.daysLeft + ' days left)' : '') + (L.serial ? ' — serial ' + L.serial : '')
      : 'Read-only — ' + reason(L);
    const inp = (v, ph) => h('input', { type: 'text', value: v || '', placeholder: ph || '', style: { width: '100%' } });
    const user = inp(P.user, 'the user name of your account on osemtec.com'), email = inp(P.email, 'the licence is sent to this address');
    const via = h('select', { title: 'How the request e-mail is sent', style: { width: 'auto' } }, MAILERS.map(([v, l]) => h('option', { value: v }, l))); via.value = P.via || 'gmail';
    const code = h('input', { type: 'text', value: mc.code, readOnly: true, class: 'mono', style: { width: '210px', fontWeight: 600, letterSpacing: '.03em' } });
    const msg = h('div', { style: { minHeight: '18px', fontSize: '12px' } });
    const say = (t, err) => { msg.style.color = err ? 'var(--danger)' : 'var(--ok, #2e7d32)'; msg.textContent = t; };
    const form = () => ({ user: user.value.trim(), email: email.value.trim(), via: via.value });
    const check = () => { const r = form(); this.prefs.registration = r; this.savePrefs();
      if (!r.user) { say('Enter the user name of your osemtec.com account (register on osemtec.com first).', true); return null; }
      if (!/^\S+@\S+\.\S+$/.test(r.email)) { say('Enter a valid e-mail address.', true); return null; } return r; };
    const send = () => { const r = check(); if (!r) return; const q = requestText(r, mc, app);
      window.host.openExternal(AV.mailUrl(r.via, AV.LIC_EMAIL, q.subject, q.body));
      say(r.via === 'app' ? 'Your e-mail program opens with the request to ' + AV.LIC_EMAIL + ' — press Send there.'
        : 'Your browser opens ' + MAILERS.find(m => m[0] === r.via)[1].replace(/ \(.*/, '') + ' with the request ready — press Send there (sign in first if asked).'); };
    const submit = async (btn) => { const r = check(); if (!r) return; const q = requestText(r, mc, app); btn.disabled = true; say('Sending...');
      try { await window.host.licenseSubmit({ subject: q.subject, body: q.body, user: r.user, email: r.email }); say('Request sent to OSEMTEC. You will receive the licence at ' + r.email + '.'); }
      catch (e) { say('Could not send directly (' + e.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, '') + '). Use "Send by E-mail" instead.', true); }
      btn.disabled = false; };
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
        h('label', null, 'osemtec.com account'), user, h('label', null, 'E-mail'), email),
      direct ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, (() => { const b = B('Send Request to OSEMTEC', () => submit(b), true); return b; })(), h('span', { class: 'note' }, 'sent directly, no e-mail program needed')) : null,
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, B('Send by E-mail', send, !direct), via, B('Copy Request', copy), B('Save Request File...', save)),
      h('div', { class: 'note' }, 'OSEMTEC checks your osemtec.com account and purchase (edition and term), then e-mails you a licence for this computer. The request contains only the machine code, your account and your e-mail address.'),
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

})(window.AV);
