// OsemCM - user login / roles and model change history (audit trail)
'use strict';
(function (AV) {
  const h = AV.h;

  const ROLES = {
    admin: { label: 'Administrator', edit: true, users: true, desc: 'Edit models, run simulations, manage user accounts' },
    modeler: { label: 'Modeler', edit: true, users: false, desc: 'Edit models and run simulations' },
    viewer: { label: 'Viewer', edit: false, users: false, desc: 'View models and results, run simulations; cannot change or save models' },
  };
  AV.ROLES = ROLES;
  const nowISO = () => new Date().toISOString();
  const fmtTime = (iso) => { const d = new Date(iso); if (isNaN(d)) return iso || ''; const p = (n) => String(n).padStart(2, '0'); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
  AV.fmtLocalTime = fmtTime;

  // ================================================================== users & login
  class Auth {
    constructor(app) { this.app = app; this.users = []; this.current = null; }
    get user() { return this.current ? this.current.name : ''; }
    get role() { return this.current ? this.current.role : 'viewer'; }
    get roleLabel() { return (ROLES[this.role] || ROLES.viewer).label; }
    get canEdit() { return !!(ROLES[this.role] || {}).edit; }
    get isAdmin() { return !!(ROLES[this.role] || {}).users; }
    async loadUsers() { const u = await window.host.getUsers(); this.users = (u && Array.isArray(u.users)) ? u.users : []; }
    async saveUsers() { await window.host.setUsers({ format: 'osemcm-users', users: this.users }); }
    find(name) { const n = String(name || '').trim().toLowerCase(); return this.users.find(u => u.name.toLowerCase() === n); }

    async init() {
      await this.loadUsers();
      if (!this.users.length) await this.firstAdmin();
      const auto = this.app.settings.autoLogin && this.find(this.app.settings.autoLogin);
      if (auto) this.setCurrent(auto);
      else await this.loginDialog(true);
    }
    setCurrent(u) {
      this.current = u; u.lastLogin = nowISO(); this.saveUsers();
      this.updateBadge();
      if (this.app.feat) this.app.feat.log('Signed in as ' + u.name + ' (' + this.roleLabel + ')');
      if (!this.canEdit && this.app.editEnabled) this.app.toggleEdit();
      if (this.app.refreshRibbon) this.app.refreshRibbon();
    }
    updateBadge() {
      const el = AV.$('#sbUser'); if (!el) return;
      el.textContent = this.current ? this.current.name + ' (' + this.roleLabel + ')' : 'Not signed in';
      el.title = 'Signed-in user - click to switch user, change password or manage users';
    }
    async firstAdmin() {
      const name = h('input', { type: 'text', value: this.app.info.osUser || 'admin', style: { width: '220px' } });
      const full = h('input', { type: 'text', value: '', style: { width: '220px' } });
      const p1 = h('input', { type: 'password', style: { width: '220px' } }), p2 = h('input', { type: 'password', style: { width: '220px' } });
      for (;;) {
        const r = await AV.modal({ title: 'OsemCM - Create Administrator Account', autofocus: true,
          body: h('div', { style: { width: '430px' } }, h('div', { class: 'note', style: { marginBottom: '10px' } }, 'No user accounts exist on this computer yet. Create the administrator account. Every change to a model is recorded with the name of the signed-in user.'),
            h('div', { class: 'form' }, h('label', null, 'User name'), name, h('label', null, 'Full name (optional)'), full, h('label', null, 'Password'), p1, h('label', null, 'Confirm password'), p2)),
          buttons: [{ label: 'Create', primary: true, value: true }] }).done;
        if (!r) continue;
        const n = name.value.trim();
        if (!/^[\w.@-]{2,40}$/.test(n)) { AV.toast('User name: 2-40 letters, digits, . _ - @', true); continue; }
        if (p1.value.length < 4) { AV.toast('Password must have at least 4 characters.', true); continue; }
        if (p1.value !== p2.value) { AV.toast('Passwords do not match.', true); continue; }
        const { salt, hash } = await window.host.hash(p1.value);
        this.users.push({ name: n, full: full.value.trim(), role: 'admin', salt, hash, created: nowISO(), createdBy: n });
        await this.saveUsers(); return;
      }
    }
    async loginDialog(required) {
      const names = this.users.map(u => u.name);
      const last = this.app.settings.lastUser && this.find(this.app.settings.lastUser) ? this.find(this.app.settings.lastUser).name : (this.current ? this.current.name : names[0]);
      const sel = h('select', { style: { width: '230px' } }, names.map(n => h('option', { value: n }, n))); sel.value = last;
      const pw = h('input', { type: 'password', style: { width: '230px' } });
      const auto = h('input', { type: 'checkbox', checked: !!this.app.settings.autoLogin });
      const roleInfo = h('div', { class: 'note' });
      const showRole = () => { const u = this.find(sel.value); roleInfo.textContent = u ? 'Role: ' + ROLES[u.role].label + ' - ' + ROLES[u.role].desc : ''; };
      sel.addEventListener('change', showRole); showRole();
      for (;;) {
        const dlg = AV.modal({ title: 'OsemCM - Sign In', autofocus: false,
          body: h('div', { style: { width: '420px' } }, h('div', { class: 'form' }, h('label', null, 'User'), sel, h('label', null, 'Password'), pw), roleInfo,
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px' } }, auto, 'Sign in automatically on this computer')),
          buttons: required ? [{ label: 'Sign In', primary: true, value: true }, { label: 'Exit', value: 'exit' }] : [{ label: 'Sign In', primary: true, value: true }, { label: 'Cancel', value: null }] });
        setTimeout(() => pw.focus(), 40);
        const r = await dlg.done;
        if (r === 'exit') { window.host.confirmClose(); return false; }
        if (!r) { if (required) continue; return false; }
        const u = this.find(sel.value); if (!u) continue;
        const { hash } = await window.host.hash(pw.value, u.salt);
        if (hash !== u.hash) { AV.toast('Wrong password for ' + u.name + '.', true); pw.value = ''; continue; }
        this.app.settings.lastUser = u.name; this.app.settings.autoLogin = auto.checked ? u.name : null; window.host.setSettings(this.app.settings);
        this.setCurrent(u); return true;
      }
    }
    async signOut() { this.app.settings.autoLogin = null; window.host.setSettings(this.app.settings); this.current = null; this.updateBadge(); await this.loginDialog(true); }
    userMenu(e) {
      const items = [{ label: 'Switch User...', fn: () => this.loginDialog(false) }, { label: 'Change My Password...', fn: () => this.changePassword() }];
      if (this.isAdmin) items.push('-', { label: 'Manage Users...', fn: () => this.manageUsers() });
      items.push('-', { label: 'Sign Out', fn: () => this.signOut() });
      this.app.contextMenu(e.clientX, Math.max(0, e.clientY - 10), items);
    }
    async changePassword(u) {
      u = u || this.current; if (!u) return;
      const own = u === this.current;
      const old = h('input', { type: 'password', style: { width: '220px' } }), p1 = h('input', { type: 'password', style: { width: '220px' } }), p2 = h('input', { type: 'password', style: { width: '220px' } });
      const rows = [];
      if (own) rows.push(h('label', null, 'Current password'), old);
      rows.push(h('label', null, 'New password'), p1, h('label', null, 'Confirm new password'), p2);
      const r = await AV.modal({ title: (own ? 'Change Password' : 'Reset Password - ' + u.name), body: h('div', { class: 'form' }, rows), buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: true }] }).done;
      if (!r) return;
      if (own) { const { hash } = await window.host.hash(old.value, u.salt); if (hash !== u.hash) { AV.toast('Current password is wrong.', true); return; } }
      if (p1.value.length < 4) { AV.toast('Password must have at least 4 characters.', true); return; }
      if (p1.value !== p2.value) { AV.toast('Passwords do not match.', true); return; }
      Object.assign(u, await window.host.hash(p1.value)); await this.saveUsers(); AV.toast('Password changed for ' + u.name + '.');
    }
    manageUsers() {
      if (!this.isAdmin) { AV.alert('Only an Administrator can manage user accounts.', 'Manage Users'); return; }
      const tbl = h('table', { class: 'histtbl' });
      let selName = null;
      const render = () => {
        tbl.innerHTML = '';
        tbl.appendChild(h('tr', null, ['User', 'Full name', 'Role', 'Created', 'Last sign-in'].map(t => h('th', null, t))));
        for (const u of this.users) {
          const tr = h('tr', { class: u.name === selName ? 'sel' : '', onclick: () => { selName = u.name; render(); } },
            h('td', null, u.name + (u === this.current ? ' (you)' : '')), h('td', null, u.full || ''), h('td', null, ROLES[u.role].label), h('td', null, fmtTime(u.created)), h('td', null, u.lastLogin ? fmtTime(u.lastLogin) : '-'));
          tbl.appendChild(tr);
        }
      };
      const selU = () => { const u = this.find(selName); if (!u) AV.toast('Select a user first.', true); return u; };
      const admins = () => this.users.filter(u => u.role === 'admin').length;
      const add = async () => {
        const r = await AV.formDialog('Add User', [{ k: 'name', l: 'User name', t: 'text' }, { k: 'full', l: 'Full name', t: 'text' }, { k: 'role', l: 'Role', t: 'choice', o: Object.keys(ROLES).map(k => [k, ROLES[k].label]) }, { k: 'pw', l: 'Initial password', t: 'text' }],
          { role: 'modeler' }, { validate: (v) => !/^[\w.@-]{2,40}$/.test((v.name || '').trim()) ? 'User name: 2-40 letters, digits, . _ - @' : this.find(v.name) ? 'That user already exists.' : (v.pw || '').length < 4 ? 'Password must have at least 4 characters.' : null });
        if (!r) return;
        const { salt, hash } = await window.host.hash(r.pw);
        this.users.push({ name: r.name.trim(), full: (r.full || '').trim(), role: r.role, salt, hash, created: nowISO(), createdBy: this.user });
        await this.saveUsers(); selName = r.name.trim(); render();
      };
      const setRole = async () => {
        const u = selU(); if (!u) return;
        const r = await AV.formDialog('Change Role - ' + u.name, [{ k: 'role', l: 'Role', t: 'choice', o: Object.keys(ROLES).map(k => [k, ROLES[k].label]) }, { t: 'note', l: Object.values(ROLES).map(x => x.label + ': ' + x.desc).join('\n') }], { role: u.role });
        if (!r || r.role === u.role) return;
        if (u.role === 'admin' && admins() === 1) { AV.toast('There must be at least one Administrator.', true); return; }
        u.role = r.role; await this.saveUsers(); render(); if (u === this.current) this.setCurrent(u);
      };
      const del = async () => {
        const u = selU(); if (!u) return;
        if (u === this.current) { AV.toast('You cannot delete the account you are signed in with.', true); return; }
        if (u.role === 'admin' && admins() === 1) { AV.toast('There must be at least one Administrator.', true); return; }
        if (!await AV.confirm('Delete user "' + u.name + '"? Changes already recorded under this name stay in the model histories.', 'Delete User', 'Delete')) return;
        this.users = this.users.filter(x => x !== u); await this.saveUsers(); selName = null; render();
      };
      render();
      AV.floatPanel({ id: 'users', title: 'Manage Users', w: 640, h: 380, body: h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h('div', { class: 'followbar' }, h('button', { class: 'btn small', onclick: add }, 'Add User...'), h('button', { class: 'btn small', onclick: setRole }, 'Change Role...'),
          h('button', { class: 'btn small', onclick: () => { const u = selU(); if (u) this.changePassword(u); } }, 'Reset Password...'), h('button', { class: 'btn small', onclick: del }, 'Delete')),
        h('div', { style: { flex: 1, overflow: 'auto' } }, tbl),
        h('div', { class: 'note', style: { padding: '6px 8px' } }, 'Accounts are stored on this computer. Administrator: all functions and user management. Modeler: edit and save models. Viewer: read-only (cannot change or save models).')) });
    }
  }
  AV.Auth = Auth;

  // ================================================================== change history
  // History file: <model>.osemhist.json next to the .inp. Changes are kept as "pending" until the model is saved,
  // then committed as one version (user, role, time, optional comment) - like a commit in InfoAsset/ICM databases.
  const KIND_NAME = { NODE: 'Node', LINK: 'Link', SUBCATCH: 'Subcatchment', GAGE: 'Rain Gage', LABEL: 'Label', OPTIONS: 'Simulation Options' };
  const SPECIAL = { desc: 'Description', inflowTS: 'Inflow Time Series', inflowSF: 'Inflow Scale Factor', inflowBase: 'Inflow Baseline', dwf: 'Dry Weather Flow (avg)', uh: 'RDII Unit Hydrograph', sewArea: 'RDII Sewershed Area', id: 'Name', tag: 'Tag', x: 'X-Coordinate', y: 'Y-Coordinate', from: 'Inlet Node', to: 'Outlet Node', type: 'Type', verts: 'Vertices', poly: 'Polygon', _created: 'Created', _deleted: 'Deleted' };
  const nice = (x) => { const t = String(x === undefined || x === null ? '' : x); return /^-?\d+\.\d{8,}$/.test(t) ? String(+(+t).toPrecision(10)) : t; };
  const val2s = (v) => v === undefined || v === null ? '' : (typeof v === 'object' ? (Array.isArray(v) ? v.length + ' points' : JSON.stringify(v)) : String(v));

  class History {
    constructor(app) {
      this.app = app; this.commits = []; this.pending = []; this.path = null; this.filterKey = null;
      app.on('selection', () => this.renderPanel());
      setInterval(() => this.autoCommit(), 1000);
    }
    static fileFor(p) { return p ? p.replace(/\.inp$/i, '') + '.osemhist.json' : null; }
    label(o, key) {
      if (SPECIAL[key]) return SPECIAL[key];
      const sch = AV.SCHEMA[o.kind === 'SUBCATCH' ? 'SUBCATCH' : o.kind === 'GAGE' ? 'GAGE' : o.type] || [];
      const f = sch.find(f => f.k === key); return f ? f.l : key;
    }
    async load(modelPath) {
      this.commits = []; this.pending = []; this.path = History.fileFor(modelPath); this.filterKey = null;
      if (this.path) {
        try { if (await window.host.exists(this.path)) { const j = JSON.parse(await window.host.readText(this.path)); if (j && Array.isArray(j.commits)) this.commits = j.commits; } }
        catch (e) { console.warn('history load', e); }
      }
      this.renderPanel(); this.refreshWindow();
    }
    get version() { return this.commits.length ? this.commits[this.commits.length - 1].v : 0; }

    // called by App.exec / undo / redo
    record(cmd, mode) {
      const auth = this.app.auth; const t = nowISO(); const user = auth ? auth.user : '', role = auth ? auth.role : '';
      const und = mode === 'undo';
      if (cmd.changes && cmd.changes.length) {
        for (const c of cmd.changes) {
          const o = c.o; if (!o) continue;
          const key = c.key;
          const isDel = key === '_deleted', isCre = key === '_created';
          let oldv = und ? c.nw : c.old, nwv = und ? c.old : c.nw, k = key;
          if (und && (isDel || isCre)) k = isDel ? '_created' : '_deleted';
          this.pending.push({ k: o.kind, t: o.type || '', id: key === 'id' ? val2s(nwv) : o.id, key: k, label: this.label(o, k), old: val2s(oldv), nw: val2s(nwv), time: t, user, role, action: (und ? 'Undo: ' : '') + cmd.label });
        }
      } else if (!cmd.noHistory) {
        this.pending.push({ k: '', t: '', id: '', key: '_action', label: 'Action', old: '', nw: '', time: t, user, role, action: (und ? 'Undo: ' : '') + (cmd.label || 'Edit') });
      }
      this.renderPanel(); this.refreshWindow(); if (this.cdWin) this.cdWin.draw();
    }
    // collapse pending edits per object/field (first old value, last new value); drop no-op round trips
    collapse() {
      const out = []; const idx = new Map();
      for (const e of this.pending) {
        if (e.key === '_action') { out.push(Object.assign({}, e)); continue; }
        const kk = e.k + '|' + e.id + '|' + e.key;
        if (idx.has(kk)) { const x = idx.get(kk); x.nw = e.nw; x.time = e.time; x.user = e.user; x.action = e.action; if (e.desc) x.desc = e.desc; }
        else { const x = Object.assign({}, e); idx.set(kk, x); out.push(x); }
      }
      return out.filter(e => e.key === '_action' || e.key === '_created' || e.key === '_deleted' || e.old !== e.nw);
    }
    // history recording interval (Default Settings): every second / minute / 10 minutes, or only when the model is saved
    autoCommit() {
      const f = this.app.prefs.histFreq || 'save'; if (f === 'save' || !this.pending.length) return;
      const sec = { sec: 1, min: 60, min10: 600 }[f] || 0; if (!sec) return;
      const now = Date.now(); if (this._lastAuto && now - this._lastAuto < sec * 1000) return;
      this._lastAuto = now; this.commit(this.app.filePath, '', true);
    }
    async commit(modelPath, comment, auto) {
      const p = History.fileFor(modelPath);
      if (p && p !== this.path) { this.path = p; }
      if (!auto && !this.pending.length && p && this.commits.length && this._unwritten) { this._unwritten = false; try { await window.host.writeText(this.path, JSON.stringify({ format: 'osemcm-history', model: modelPath.split(/[\\/]/).pop(), commits: this.commits })); } catch (e) { } }
      const changes = this.collapse();
      if (!changes.length) { this.pending = []; return; }
      if (!auto && this.app.prefs.askComment && comment === undefined) comment = await AV.prompt('Commit Changes', 'Comment for version ' + (this.version + 1) + ' (optional)', '') || '';
      const auth = this.app.auth;
      this.commits.push({ v: this.version + 1, user: auth ? auth.user : '', role: auth ? auth.role : '', full: auth && auth.current ? auth.current.full || '' : '', host: this.app.info.host || '', time: nowISO(), comment: comment || '', changes });
      this.pending = [];
      if (this.commits.length) this.commits[this.commits.length - 1].auto = !!auto;
      if (!this.path) { this._unwritten = true; }
      else try { await window.host.writeText(this.path, JSON.stringify({ format: 'osemcm-history', model: (modelPath || '').split(/[\\/]/).pop(), commits: this.commits })); this._unwritten = false; }
      catch (e) { AV.toast('Could not write the change history file: ' + e.message, true); }
      this.renderPanel(); this.refreshWindow();
    }
    discardPending() { this.pending = []; }
    // flattened rows: committed + pending
    rows() {
      const out = [];
      for (const c of this.commits) for (const e of c.changes) out.push(Object.assign({ v: c.v, comment: c.comment, cuser: c.user, _src: e }, e));
      for (const e of this.pending) out.push(Object.assign({ v: null, comment: '', _src: e }, e));
      return out;
    }
    // ids this object had over time (follows renames backwards)
    aliasIds(o) {
      const ids = new Set([o.id]); const all = this.rows();
      for (let i = all.length - 1; i >= 0; i--) { const r = all[i]; if (r.k === o.kind && r.key === 'id' && ids.has(r.nw)) ids.add(r.old); }
      return ids;
    }
    rowsFor(objs) {
      const keys = new Map(); for (const o of objs) for (const id of this.aliasIds(o)) keys.set(o.kind + '|' + id, o);
      return this.rows().filter(r => keys.has(r.k + '|' + r.id));
    }

    // ------------------------------------------------------------ properties-side log (selected objects)
    mountPanel(host) {
      this.panelHost = host;
      this.fltEl = h('span', { class: 'logflt' });
      this.panelBody = h('div', { class: 'logbody' });
      host.append(h('div', { class: 'ptitle' }, h('span', null, 'Log'), this.fltEl, h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn small', title: 'Program messages (runs, saves, errors)', onclick: () => this.app.feat.logWindow() }, 'Messages'), h('button', { class: 'btn small', title: 'Every parameter of the selected object for each saved version, changes highlighted', onclick: () => this.openDetails() }, 'Details...')), this.panelBody);
      this.renderPanel();
    }
    // hover card for a log entry
    tip(r, e) {
      let el = AV.$('#logTip'); if (!r) { if (el) el.style.display = 'none'; return; }
      if (!el) { el = h('div', { id: 'logTip' }); document.body.appendChild(el); }
      const o = this.findObj(r);
      const typ = r.t ? r.t.charAt(0) + r.t.slice(1).toLowerCase() : (KIND_NAME[r.k] || '');
      const lines = [['User', r.user || ''], ['Role', (ROLES[r.role] || {}).label || r.role || ''], ['Date Time', fmtTime(r.time)], ['Object Type', typ], ['Object Name', r.id + (o ? '' : ' (no longer exists)')],
        ['Variable Name', r.label], ['Old Value', r.key === '_created' ? '-' : nice(r.old)], ['New Value', r.key === '_deleted' ? '(deleted)' : r.key === '_created' ? '(created)' : nice(r.nw)],
        ['Version', r.v === null ? 'not saved yet' : String(r.v)], ['Description', r.desc || '']];
      el.innerHTML = ''; for (const [k, v] of lines) el.appendChild(h('div', null, h('b', null, k + ': '), v));
      el.appendChild(h('div', { class: 'hint' }, 'Double-click to add or edit the description'));
      el.style.display = 'block'; this.tipMove(e);
    }
    tipMove(e) { const el = AV.$('#logTip'); if (!el || el.style.display === 'none') return; const w = el.offsetWidth, hh = el.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14; if (x + w > window.innerWidth - 4) x = e.clientX - w - 10; if (y + hh > window.innerHeight - 4) y = e.clientY - hh - 10; el.style.left = x + 'px'; el.style.top = y + 'px'; }
    // double-click a log entry: add a description to that change (saved with the change history)
    async editDesc(r) {
      this.tip(null);
      const ta = h('textarea', { rows: 4, style: { width: '420px', font: 'inherit' } }, r.desc || '');
      const info = h('div', { class: 'note', style: { marginBottom: '6px' } }, (r.t || KIND_NAME[r.k] || '') + ' ' + r.id + ' - ' + r.label + ': ' + nice(r.old) + ' -> ' + nice(r.nw) + '  (' + (r.user || '') + ', ' + fmtTime(r.time) + ')');
      setTimeout(() => ta.focus(), 40);
      const v = await AV.modal({ title: 'Change Description', body: h('div', null, info, ta), enterSubmits: false, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => ta.value }] }).done;
      if (v === null || v === undefined) return;
      const src = r._src; if (!src) return;
      if (v.trim()) src.desc = v.trim(); else delete src.desc;
      if (r.v !== null && this.path) { try { await window.host.writeText(this.path, JSON.stringify({ format: 'osemcm-history', commits: this.commits })); } catch (e) { AV.toast('Could not write the history file: ' + e.message, true); } }
      this.renderPanel(); this.refreshWindow(); if (this.cdWin) this.cdWin.draw();
    }
    setFilter(key) { this.filterKey = this.filterKey === key ? null : key; this.renderPanel(); this.app.panels.markFilterRow && this.app.panels.markFilterRow(this.filterKey); }
    renderPanel() {
      if (!this.panelBody) return;
      const sel = [...this.app.selection].filter(o => o.kind !== 'LABEL').slice(0, 500);
      this.fltEl.innerHTML = '';
      const B = this.panelBody; B.innerHTML = '';
      if (!sel.length) { B.appendChild(h('div', { class: 'empty' }, 'Select an object to see its change log.')); return; }
      let rows = this.rowsFor(sel).filter(r => r.key !== '_action');
      if (this.filterKey) {
        const lab = this.label(sel[0], this.filterKey);
        this.fltEl.appendChild(h('span', { class: 'tag', title: 'Click to show all variables', onclick: () => this.setFilter(this.filterKey) }, lab + ' ×'));
        rows = rows.filter(r => r.key === this.filterKey || (this.filterKey === 'id' && r.key === 'id'));
      }
      if (!rows.length) { B.appendChild(h('div', { class: 'empty' }, this.filterKey ? 'No recorded changes of this variable.' : 'No recorded changes.')); return; }
      rows.reverse();
      const multi = sel.length > 1;
      const tbl = h('table', { class: 'histtbl' });
      tbl.appendChild(h('tr', null, (multi ? ['Object'] : []).concat(['Variable', 'Value', 'Time', 'User']).map(t => h('th', null, t))));
      for (const r of rows.slice(0, 1000)) {
        tbl.appendChild(h('tr', { class: (r.v === null ? 'pending' : '') + (r.desc ? ' hasdesc' : ''), ondblclick: () => this.editDesc(r), onmouseenter: (e) => this.tip(r, e), onmousemove: (e) => this.tipMove(e), onmouseleave: () => this.tip(null) },
          (multi ? [h('td', null, r.id)] : []).concat([h('td', null, r.label), h('td', null, r.key === '_deleted' ? '(deleted)' : r.key === '_created' ? '(created)' : nice(r.nw)), h('td', null, fmtTime(r.time)), h('td', null, r.user || '')])));
      }
      B.appendChild(tbl);
    }

    // ------------------------------------------------------------ full history window
    openWindow() {
      if (this.win) { this.win.focus(); this.refreshWindow(); return; }
      const f = this.wf = {
        user: h('select', { onchange: () => this.refreshWindow() }), kind: h('select', { onchange: () => this.refreshWindow() }, [['', 'All types'], ['NODE', 'Nodes'], ['LINK', 'Links'], ['SUBCATCH', 'Subcatchments'], ['GAGE', 'Rain Gages'], ['_', 'Actions']].map(([v, l]) => h('option', { value: v }, l))),
        text: h('input', { type: 'text', placeholder: 'Object / variable / value', style: { width: '170px' }, oninput: AV.debounce(() => this.refreshWindow(), 200) }),
        selOnly: h('input', { type: 'checkbox', onchange: () => this.refreshWindow() }),
        mode: h('select', { onchange: () => this.refreshWindow() }, [['list', 'Change list'], ['obj', 'Object commit details']].map(([v, l]) => h('option', { value: v }, l))),
      };
      this.winBody = h('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } });
      this.winInfo = h('span', { class: 'sub' });
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h('div', { class: 'followbar' }, f.mode, 'User', f.user, f.kind, f.text, h('label', null, f.selOnly, ' Selected objects only'),
          h('button', { class: 'btn small', onclick: () => this.exportCSV() }, 'Export CSV'), this.winInfo), this.winBody);
      this.win = AV.floatPanel({ id: 'history', title: 'Model Change History', w: 900, h: 460, body, onClose: () => { this.win = null; this.selSub && this.selSub(); } });
      this.selSub = this.app.on('selection', () => { if (this.win && (f.selOnly.checked || f.mode.value === 'obj')) this.refreshWindow(); });
      this.refreshWindow();
    }
    filtered() {
      const f = this.wf; let rows = this.rows();
      const users = [...new Set(rows.map(r => r.user).filter(Boolean))].sort();
      const cur = f.user.value; f.user.innerHTML = ''; [['', 'All']].concat(users.map(u => [u, u])).forEach(([v, l]) => f.user.appendChild(h('option', { value: v }, l))); f.user.value = users.includes(cur) ? cur : '';
      if (f.user.value) rows = rows.filter(r => r.user === f.user.value);
      if (f.kind.value === '_') rows = rows.filter(r => r.key === '_action'); else if (f.kind.value) rows = rows.filter(r => r.k === f.kind.value);
      if (f.selOnly.checked) { const sel = [...this.app.selection].filter(o => o.kind !== 'LABEL'); const keep = new Set(this.rowsFor(sel).map(r => r._src)); rows = rows.filter(r => keep.has(r._src)); }
      const q = f.text.value.trim().toLowerCase();
      if (q) rows = rows.filter(r => [r.id, r.label, r.old, r.nw, r.action, r.comment].some(x => String(x || '').toLowerCase().includes(q)));
      return rows;
    }
    refreshWindow() {
      if (!this.win) return;
      const B = this.winBody; B.innerHTML = '';
      const f = this.wf;
      if (f.mode.value === 'obj') { f.mode.value = 'list'; this.openDetails(); }
      const rows = this.filtered().reverse();
      this.winInfo.textContent = rows.length + ' change(s), ' + this.commits.length + ' saved version(s)' + (this.pending.length ? ', unsaved changes pending' : '');
      if (!rows.length) { B.appendChild(h('div', { class: 'empty' }, this.path || this.pending.length ? 'No changes match.' : 'No history yet. Changes are recorded from now on and committed to the history file each time the model is saved.')); return; }
      const tbl = h('table', { class: 'histtbl wide' }); const shown = []; this.shown = shown; this.rowSel = this.rowSel || new Set();
      tbl.appendChild(h('tr', null, ['Version', 'Time', 'User', 'Role', 'Type', 'Object', 'Variable', 'Old Value', 'New Value', 'Action / Comment'].map(t => h('th', null, t))));
      for (const r of rows.slice(0, 5000)) {
        const obj = r.k ? this.app.objExists && this.findObj(r) : null;
        const ri = shown.length; shown.push(r);
        tbl.appendChild(h('tr', { class: (r.v === null ? 'pending' : '') + (this.rowSel.has(r._src) ? ' sel' : ''), onmousedown: (e) => { if (e.shiftKey) e.preventDefault(); }, onclick: (e) => this.rowClick(ri, e), ondblclick: () => { if (obj) { this.app.selectMany([obj], false); this.app.map.zoomToObjects([obj]); } } },
          h('td', null, r.v === null ? 'unsaved' : String(r.v)), h('td', null, fmtTime(r.time)), h('td', null, r.user || ''), h('td', null, (ROLES[r.role] || {}).label || r.role || ''),
          h('td', null, r.k ? (r.t ? r.t.charAt(0) + r.t.slice(1).toLowerCase() : KIND_NAME[r.k]) : ''), h('td', { class: obj ? 'lnk' : '' }, r.id), h('td', null, r.key === '_action' ? '' : r.label),
          h('td', { class: 'old' }, nice(r.old)), h('td', { class: 'new' }, r.key === '_deleted' ? '(deleted)' : r.key === '_created' ? '(created)' : nice(r.nw)), h('td', { title: r.desc || '' }, (r.desc ? r.desc + ' | ' : '') + r.action + (r.comment ? ' | ' + r.comment : ''))));
      }
      B.appendChild(tbl);
      if (rows.length > 5000) B.appendChild(h('div', { class: 'note' }, 'Showing the latest 5000 changes; use the filters or Export CSV for the rest.'));
    }
    // click / Ctrl+click / Shift+click rows: the objects of the selected rows are selected on the map
    rowClick(i, e) {
      const rows = this.shown || []; const r = rows[i]; if (!r) return;
      if (e.shiftKey && this.rowAnchor !== undefined) { const a = Math.min(this.rowAnchor, i), b = Math.max(this.rowAnchor, i); if (!e.ctrlKey) this.rowSel = new Set(); for (let k = a; k <= b; k++) this.rowSel.add(rows[k]._src); }
      else if (e.ctrlKey) { this.rowAnchor = i; this.rowSel.has(r._src) ? this.rowSel.delete(r._src) : this.rowSel.add(r._src); }
      else { this.rowAnchor = i; this.rowSel = new Set([r._src]); }
      const objs = [...new Set(rows.filter(x => this.rowSel.has(x._src)).map(x => this.findObj(x)).filter(Boolean))];
      this._selFromList = true; this.app.selectMany(objs, false); this._selFromList = false;
      if (objs.length && objs.some(o => !this.app.map.isVisible(o))) this.app.map.zoomToObjects(objs);
      this.refreshWindow();
    }
    findObj(r) {
      const m = this.app.model; const c = r.k === 'NODE' ? m.nodes : r.k === 'LINK' ? m.links : r.k === 'SUBCATCH' ? m.subcatchments : r.k === 'GAGE' ? m.gages : null;
      return c ? c.get(r.id) || null : null;
    }
    // ---------------------------------------------------------------- object commit details (InfoAsset style)
    // every parameter of the object is a row, every version a column; the value after each version is shown and
    // cells changed in that version are highlighted
    fieldsOf(o) {
      const f = [['id', 'Name'], ['tag', 'Tag']];
      if (o.kind === 'NODE' || o.kind === 'GAGE') f.push(['x', 'X-Coordinate'], ['y', 'Y-Coordinate']);
      if (o.kind === 'LINK') f.push(['from', 'Inlet Node'], ['to', 'Outlet Node']);
      const sch = AV.SCHEMA[o.kind === 'SUBCATCH' ? 'SUBCATCH' : o.kind === 'GAGE' ? 'GAGE' : o.type] || [];
      const ex = AV.extraFields(o); for (const x of ex.filter(x => !x.g)) f.push([x.k, x.l]);
      for (const x of sch) f.push([x.k, x.l]);
      for (const x of ex.filter(x => x.g)) f.push([x.k, x.l]);
      if (o.kind === 'LINK') f.push(['verts', 'Vertices']); if (o.kind === 'SUBCATCH') f.push(['poly', 'Polygon']);
      return f;
    }
    curVal(o, k) { return val2s(AV.getField(this.app.model, o, k)); }
    renderDetails(host, o, full, onComment) {
      host.innerHTML = '';
      const rows = this.rowsFor([o]).filter(r => r.key !== '_action');
      const touched = new Set(rows.map(r => r.v === null ? 'unsaved' : r.v));
      let vers = full ? this.commits.map(c => c.v) : this.commits.map(c => c.v).filter(v => touched.has(v));
      if (touched.has('unsaved') || (full && this.pending.length)) vers.push('unsaved');
      const byV = new Map(vers.map(v => [v, []])); for (const r of rows) { const v = r.v === null ? 'unsaved' : r.v; if (byV.has(v)) byV.get(v).push(r); }
      const fields = this.fieldsOf(o);
      for (const k of new Set(rows.map(r => r.key))) if (!fields.some(f => f[0] === k) && k !== '_created' && k !== '_deleted') fields.push([k, this.label(o, k)]);
      // values after each version, walking back from the current value
      const cells = new Map(); // key -> [{val, changed, old}]
      for (const [k] of fields) {
        let cur = this.curVal(o, k); const out = new Array(vers.length);
        for (let i = vers.length - 1; i >= 0; i--) {
          const ch = byV.get(vers[i]).filter(r => r.key === k);
          out[i] = { val: cur, changed: ch.length > 0, old: ch.length ? ch[0].old : null, by: ch.length ? [...new Set(ch.map(r => r.user).filter(Boolean))].join(', ') : '', desc: ch.map(r => r.desc).filter(Boolean).join('; ') };
          if (ch.length) cur = ch[0].old;
        }
        cells.set(k, { out, before: cur });
      }
      const created = rows.find(r => r.key === '_created');
      if (!vers.length) { host.appendChild(h('div', { class: 'empty' }, 'No recorded changes for ' + (KIND_NAME[o.kind] || '') + ' ' + o.id + '.' + (full ? '' : ' Tick "Full history" to show every saved version of the model.'))); return 0; }
      const tbl = h('table', { class: 'histtbl matrix commit' });
      const head = h('tr', null, h('th', { class: 'corner' }, (o.type ? o.type.charAt(0) + o.type.slice(1).toLowerCase() : KIND_NAME[o.kind]) + ' ' + o.id), h('th', { class: 'orig', title: 'Values before the first version shown' }, created ? 'Created' : 'Original', h('br'), created ? '' : '(before)'));
      vers.forEach(v => {
        const cm = v === 'unsaved' ? null : this.commits.find(x => x.v === v); const c = byV.get(v); const last = c[c.length - 1];
        const user = cm ? cm.user : (last ? last.user : (this.app.auth ? this.app.auth.user : ''));
        const time = cm ? cm.time : (last ? last.time : '');
        const th = h('th', { colspan: 2, title: 'Click to show the commit comment', onclick: () => { AV.$$('th.on', tbl).forEach(x => x.classList.remove('on')); th.classList.add('on'); onComment && onComment(cm ? (cm.comment || '(no comment)') + '   [' + (cm.full || cm.user) + (cm.host ? ' @ ' + cm.host : '') + ']' : 'Changes not yet recorded as a version (recorded at the interval set in Default Settings, or when the model is saved).'); } },
          v === 'unsaved' ? 'Unsaved' : 'Version ' + v, h('br'), user || '', h('br'), time ? fmtTime(time) : '', c.some(r => r.key === '_created') ? h('div', { class: 'cm' }, 'created') : null);
        head.appendChild(th);
      });
      tbl.appendChild(head);
      tbl.appendChild(h('tr', { class: 'grp' }, h('td', { colspan: vers.length * 2 + 2 }, 'General')));
      let grp = null; const sch = AV.SCHEMA[o.kind === 'SUBCATCH' ? 'SUBCATCH' : o.kind === 'GAGE' ? 'GAGE' : o.type] || [];
      for (const [k, l] of fields) {
        const sf = sch.find(x => x.k === k); const g = sf ? sf.g || null : (AV.VIRT[k] && AV.VIRT[k].g) || null;
        if (g !== grp) { grp = g; if (g) tbl.appendChild(h('tr', { class: 'grp' }, h('td', { colspan: vers.length * 2 + 2 }, g))); }
        const { out, before } = cells.get(k);
        tbl.appendChild(h('tr', null, [h('td', { class: 'k' }, l), h('td', { class: 'orig' }, created ? '' : nice(before))].concat(...out.map(c => [h('td', { class: c.changed ? 'chg' : '', title: c.changed ? 'Changed from: ' + nice(c.old) + (c.desc ? '\n' + c.desc : '') : '' }, nice(c.val)), h('td', { class: 'ed' + (c.changed ? ' on' : ''), title: c.desc || '' }, c.changed ? c.by : '')]))));
      }
      host.appendChild(tbl);
      return vers.length;
    }
    renderObjectDetails() {
      const B = this.winBody; const sel = [...this.app.selection].filter(o => o.kind !== 'LABEL');
      if (!sel.length) { this.winInfo.textContent = ''; B.appendChild(h('div', { class: 'empty' }, 'Select an object on the map to see its commit details.')); return; }
      const n = this.renderDetails(B, sel[0], false, (t) => { this.winInfo.textContent = t; });
      this.winInfo.textContent = n + ' version(s)';
    }
    // standalone window with Close / Next / Previous / Full history and commit comments
    openDetails() {
      const app = this.app; let idx = 0;
      const full = h('input', { type: 'checkbox' });
      const grid = h('div', { class: 'cdgrid' });
      const comment = h('div', { class: 'cdcomment' }, 'Click a version header to see its commit comment.');
      const title = h('span', { class: 'sub' });
      const objs = () => [...app.selection].filter(o => o.kind !== 'LABEL' && app.objExists(o));
      const draw = () => {
        const list = objs(); if (idx >= list.length) idx = 0;
        if (!list.length) { grid.innerHTML = ''; grid.appendChild(h('div', { class: 'empty' }, 'Select one or more objects on the map.')); title.textContent = ''; return; }
        this.renderDetails(grid, list[idx], full.checked, (t) => { comment.textContent = t; });
        title.textContent = 'Object ' + (idx + 1) + ' of ' + list.length; prev.disabled = idx === 0; next.disabled = idx >= list.length - 1;
        comment.textContent = 'Click a version header to see its commit comment.';
      };
      const prev = h('button', { class: 'btn', onclick: () => { idx = Math.max(0, idx - 1); draw(); } }, 'Previous');
      const next = h('button', { class: 'btn', onclick: () => { idx++; draw(); } }, 'Next');
      full.addEventListener('change', draw);
      const body = h('div', { class: 'cdbox' },
        h('div', { class: 'cdmain' }, grid, h('div', { class: 'cdside' }, h('button', { class: 'btn primary', onclick: () => p.close() }, 'Close'), next, prev, h('label', null, full, ' Full history'), title)),
        h('div', { class: 'cdfoot' }, h('b', null, 'Commit comments:'), comment));
      const p = AV.floatPanel({ id: 'commitdetails', title: 'Object commit details', w: 980, h: 560, body, onClose: () => { this.cdWin = null; un(); } });
      const un = app.on('selection', () => { idx = 0; draw(); });
      this.cdWin = { draw }; draw();
      return p;
    }
    exportCSV() {
      const rows = this.filtered();
      const lines = [['Version', 'Time', 'User', 'Role', 'Type', 'Object', 'Variable', 'Old Value', 'New Value', 'Action', 'Comment'].join(',')];
      for (const r of rows) lines.push([r.v === null ? 'unsaved' : r.v, fmtTime(r.time), r.user, r.role, r.t || KIND_NAME[r.k] || '', r.id, r.key === '_action' ? '' : r.label, r.old, r.nw, r.action, r.comment].map(AV.csvCell).join(','));
      AV.downloadText(lines.join('\r\n'), 'change_history.csv', [{ name: 'CSV', extensions: ['csv'] }]);
    }
  }
  AV.History = History;
})(window.AV);
