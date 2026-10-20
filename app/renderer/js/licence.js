// OsemCM licensing: editions and feature gating.
//   1D    = OsemCM 1D     : network modelling, simulation, results, GIS
//   2D    = OsemCM 1D-2D  : everything in 1D + the 2D surface flood module (2D Options, Create Meshes, 1D-2D run, mesh results)
// Without a licence key OsemCM runs as the 1D edition (unregistered); the 2D module needs a 1D-2D key.
// Keys are signed offline (Ed25519) and checked in the main process (license:verify).
'use strict';
(function (AV) {
  const h = AV.h;
  AV.EDITIONS = { '1D': 'OsemCM 1D', '2D': 'OsemCM 1D-2D' };
  AV.has2D = (app) => !!(app && app.license && app.license.valid && app.license.edition === '2D');
  AV.editionLabel = (app) => { const L = app && app.license; if (!L || !L.valid) return '1D (unregistered)'; return L.edition === '2D' ? '1D-2D' : '1D'; };
  // shown when a 2D function is used without a 1D-2D licence
  AV.need2D = function (app, what) {
    return AV.modal({ title: 'OsemCM 1D-2D licence required', width: 480, body: h('div', { style: { lineHeight: 1.55 } },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, (what || 'The 2D flood module') + ' is part of OsemCM 1D-2D.'),
      h('div', null, 'Your licence: ' + (app.license && app.license.valid ? AV.EDITIONS[app.license.edition] + ' (' + app.license.licensee + ')' : 'OsemCM 1D, unregistered') + '.'),
      h('div', { style: { marginTop: '6px', color: 'var(--muted)' } }, 'Enter a 1D-2D licence key in Help → Register to enable 2D Options, Create Meshes, 1D-2D simulation and flood maps.')),
      buttons: [{ label: 'Close', value: null }, { label: 'Register...', primary: true, value: 'reg' }] }).done.then(v => { if (v === 'reg') app.registerDialog(); return false; });
  };
  AV.App.prototype.loadLicence = async function () {
    const k = this.settings && this.settings.license && this.settings.license.key;
    try { this.license = k ? await window.host.licenseVerify(k) : { valid: false, edition: null, error: '' }; } catch (e) { this.license = { valid: false, edition: null, error: e.message }; }
  };
  // licence changed: show / hide the 2D module everywhere
  AV.App.prototype.applyLicence = async function () {
    const on = AV.has2D(this);
    if (!on) { this.mesh2d = null; this.meshResults = null; this.meshSel = -1; }
    else if (this.model && this.filePath && !this.mesh2d) { await AV.importAvaris2D(this); await AV.loadMesh2D(this); }
    if (this.results && on && this.mesh2d) await AV.computeMeshResults(this);
    this.refreshRibbon(); this.panels.refreshLayers(); this.map.redraw(); this.updateTitle();
  };
  AV.App.prototype.registerDialog = async function () {
    const app = this; const L = this.license || {}; const P = this.prefs.registration || {};
    const cur = L.valid ? AV.EDITIONS[L.edition] + ' — ' + L.licensee + (L.expiry ? ' (valid until ' + L.expiry + ')' : ' (perpetual)') + (L.serial ? ', serial ' + L.serial : '') : 'OsemCM 1D — unregistered' + (L.error ? ' (' + L.error + ')' : '');
    const name = h('input', { type: 'text', value: P.name || '', style: { width: '100%' } }), company = h('input', { type: 'text', value: P.company || '', style: { width: '100%' } }), email = h('input', { type: 'text', value: P.email || '', style: { width: '100%' } });
    const key = h('textarea', { rows: 4, spellcheck: 'false', class: 'mono', style: { width: '100%', resize: 'vertical' }, placeholder: 'OSEMCM-...' }); key.value = (this.settings.license && this.settings.license.key) || '';
    const msg = h('div', { style: { minHeight: '18px', fontSize: '12px' } }); key.addEventListener('input', () => { msg.textContent = ''; });
    const tbl = h('table', { class: 'edtbl' }, h('tr', null, h('th', null, 'Function'), h('th', null, '1D'), h('th', null, '1D-2D')),
      [['1D network modelling, editors, GIS, scenarios', '✓', '✓'], ['1D simulation, results, profiles, reports', '✓', '✓'], ['2D Options, Create Meshes (2D surface mesh)', '–', '✓'], ['1D-2D flood simulation, flood maps and animation', '–', '✓']].map(r => h('tr', null, r.map((c, i) => h('td', { style: i ? { textAlign: 'center' } : null }, c)))));
    const body = h('div', { style: { width: '560px', display: 'flex', flexDirection: 'column', gap: '8px' } },
      h('div', { class: 'licur' + (L.valid ? ' ok' : '') }, h('b', null, 'Current licence: '), cur),
      h('div', { class: 'form' }, h('label', null, 'Name'), name, h('label', null, 'Company / Organisation'), company, h('label', null, 'E-mail'), email),
      h('div', null, h('div', { style: { marginBottom: '4px', fontWeight: 600 } }, 'Licence Key'), key), msg, tbl);
    const r = await AV.modal({ title: 'Register OsemCM', body, buttons: [{ label: 'Close', value: null }, L.valid ? { label: 'Remove Licence', value: 'remove' } : null, { label: 'Activate', primary: true, onClick: async () => {
      const k = key.value.replace(/\s+/g, ''); if (!k) { msg.style.color = 'var(--danger)'; msg.textContent = 'Paste the licence key you received from Osemtec.'; return false; }
      const v = await window.host.licenseVerify(k); if (!v.valid) { msg.style.color = 'var(--danger)'; msg.textContent = v.error || 'Invalid licence key.'; return false; }
      return { k, v }; } }].filter(Boolean) }).done;
    this.prefs.registration = { name: name.value.trim(), company: company.value.trim(), email: email.value.trim() }; this.savePrefs();
    if (r === 'remove') { if (!await AV.confirm('Remove the licence from this computer? OsemCM then runs as the unregistered 1D edition.', 'Register OsemCM', 'Remove')) return;
      delete this.settings.license; window.host.setSettings(this.settings); this.license = { valid: false, edition: null }; await this.applyLicence(); AV.toast('Licence removed.'); return; }
    if (!r || !r.k) return;
    this.settings.license = { key: r.k, activated: new Date().toISOString() }; window.host.setSettings(this.settings); this.license = r.v; await this.applyLicence();
    AV.alert('Licence activated: ' + AV.EDITIONS[r.v.edition] + '\nLicensed to: ' + r.v.licensee + (r.v.expiry ? '\nValid until: ' + r.v.expiry : '') + (r.v.edition === '2D' ? '\n\nThe 2D Flood functions are now enabled (ribbon tab "2D Flood").' : ''), 'Register OsemCM');
  };
})(window.AV);
