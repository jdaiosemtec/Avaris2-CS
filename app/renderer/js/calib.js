// Auto Calibration (Simulation ▸ Calibration, HPS edition): 1 Mapping, 2 Observed Data (2.7.0); 3 Parameters, 4 Criteria & Run, 5 Results follow.
// A calibration project lives next to the model: <model folder>/<model>_Calibration/<name>.avcal (settings, JSON)
// and <name>.avobs (the observed data read from the survey files, binary). The source files are never changed.
'use strict';
(function (AV) {
  const h = AV.h;
  const STEPS = ['Mapping', 'Observed Data', 'Parameters', 'Criteria & Run', 'Results'];
  const READY = 2; // steps available in this version
  const VARS = ['Flow', 'Depth', 'Velocity', 'Rainfall'];
  // observed units -> SI (m3/s, m, m/s, mm/h); 'd' = rain depth per time step
  const SI = {
    Flow: { 'm3/s': 1, 'l/s': 0.001, 'mld': 1 / 86.4, 'm3/h': 1 / 3600, 'cfs': 0.0283168466, 'mgd': 0.0438126364, 'gpm': 6.30901964e-5 },
    Depth: { 'm': 1, 'mm': 0.001, 'cm': 0.01, 'ft': 0.3048, 'in': 0.0254 },
    Velocity: { 'm/s': 1, 'mm/s': 0.001, 'cm/s': 0.01, 'ft/s': 0.3048 },
    Rainfall: { 'mm/h': 1, 'in/h': 25.4, 'mm': 'd', 'in': 'd' },
  };
  const ALIAS = { 'lps': 'l/s', 'm³/s': 'm3/s', 'cms': 'm3/s', 'cumecs': 'm3/s', 'ml/d': 'mld', 'm³/h': 'm3/h', 'ft3/s': 'cfs', 'fps': 'ft/s', 'mm/hr': 'mm/h', 'in/hr': 'in/h', 'mm/5min': 'mm', 'mm/15min': 'mm' };
  const normUnit = (u) => { u = String(u || '').trim().toLowerCase(); return ALIAS[u] || u; };
  const MODEL_FLOW = { CMS: 'm3/s', LPS: 'l/s', MLD: 'mld', CFS: 'cfs', GPM: 'gpm', MGD: 'mgd' };
  const pad = (n) => String(n).padStart(2, '0');
  const fmtT = (d, sec) => { if (!isFinite(d)) return ''; const t = AV.swmmToDate(d); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()) + ' ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + (sec ? ':' + pad(t.getUTCSeconds()) : ''); };
  const fmtD = (d) => fmtT(d).slice(0, 10);
  const fmtShort = (d) => { const t = AV.swmmToDate(d); return pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()) + ' ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()); };
  const fmtStep = (s) => !s ? '–' : s % 3600 === 0 ? s / 3600 + ' h' : s % 60 === 0 ? s / 60 + ' min' : s + ' s';
  const n0 = (x) => Number(x).toLocaleString('en-US');
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const chip = (cls, t) => '<span class="cchip ' + cls + '">' + esc(t) + '</span>';
  const median = (a) => { const b = a.filter(isFinite).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
  const pctl = (arr, p) => { const b = []; for (let i = 0; i < arr.length; i += Math.max(1, Math.floor(arr.length / 20000))) if (isFinite(arr[i])) b.push(arr[i]); b.sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };

  class Calib {
    constructor(app) {
      this.app = app; this.P = null; this.data = new Map(); this.step = 0; this.cache = new Map();
      this.sel = { mon: null, ev: null, res: null, win: null, v: null }; this.q = { map: '', mon: '' }; this.dirty = false;
    }
    // ------------------------------------------------------------------ project files
    get m() { return this.app.model; }
    get si() { return this.m.isSI; }
    folder() { const fp = this.app.filePath; return AV.dirname(fp) + '/' + AV.basename(fp).replace(/\.inp$/i, '') + '_Calibration'; }
    blank(name) {
      return { version: 1, name, model: AV.basename(this.app.filePath || ''), created: new Date().toISOString(), mapping: [], files: [], monitors: {},
        events: { gage: '', sep: 6, minDepth: this.si ? 5 : 0.2, nUse: 5, list: [] },
        cleaning: { methods: { spike: { on: true, k: 5 }, flat: { on: true, h: 3 }, range: { on: true }, fill: { on: true, min: 30 }, shift: { on: false }, smooth: { on: false, n: 3 }, av: { on: true, pct: 20 } }, ran: false, results: [], confirmed: false } };
    }
    async open() {
      const app = this.app;
      if (!app.filePath) { AV.alert('Save the model first: the calibration project is kept in a folder next to the model file.', 'Auto Calibration'); return; }
      if (!this.el) {
        this.el = h('div', { class: 'calview' }); app.addView('calib', 'Auto Calibration', this.el, { onClose: () => { this.el = null; this.charts = null; } });
      } else app.activateView('calib');
      if (!this.P || this.P._model !== app.filePath) await this.loadLast();
      this.render();
    }
    async listProjects() { const d = this.folder(); if (!await window.host.exists(d)) return []; const L = await window.host.listDir(d); return (L || []).filter(e => /\.avcal$/i.test(e.name || e)).map(e => (e.name || e).replace(/\.avcal$/i, '')); }
    async loadLast() {
      const names = await this.listProjects(); const last = (this.app.prefs.calibLast || {})[this.app.filePath];
      const name = names.includes(last) ? last : names[0];
      if (name) { try { await this.load(name); return; } catch (e) { AV.toast('Calibration project "' + name + '" could not be read: ' + e.message, true, 8000); } }
      this.P = this.blank(AV.basename(this.app.filePath).replace(/\.inp$/i, '') + ' calibration'); this.P._model = this.app.filePath; this.data = new Map(); this.step = 0; this.dirty = false;
    }
    async load(name) {
      const d = this.folder(); const P = JSON.parse(await window.host.readText(d + '/' + name + '.avcal'));
      const fresh = this.blank(name); P.events = Object.assign(fresh.events, P.events || {}); P.cleaning = Object.assign(fresh.cleaning, P.cleaning || {}); P.cleaning.methods = Object.assign(fresh.cleaning.methods, P.cleaning.methods || {});
      P.mapping = P.mapping || []; P.files = P.files || []; P.monitors = P.monitors || {};
      this.data = new Map(); const ob = d + '/' + name + '.avobs';
      if (await window.host.exists(ob)) this.data = decodeObs(await window.host.readBinary(ob));
      for (const r of P.cleaning.results || []) { if (r.idx && !(r.idx instanceof Int32Array)) r.idx = Int32Array.from(r.idx); if (r.newv && !(r.newv instanceof Float32Array)) r.newv = Float32Array.from(r.newv, x => x === null ? NaN : x); }
      P._model = this.app.filePath; this.P = P; this.step = P.step || 0; this.cache.clear(); this.dirty = false; this.sel = { mon: null, ev: null, res: null, win: null, v: null };
      this.rememberLast();
    }
    rememberLast() { const pr = this.app.prefs; pr.calibLast = pr.calibLast || {}; pr.calibLast[this.app.filePath] = this.P.name; this.app.savePrefs && this.app.savePrefs(); }
    async save(quiet) {
      const d = this.folder(); await window.host.mkdir(d); const P = this.P; P.modified = new Date().toISOString(); P.step = this.step;
      const out = Object.assign({}, P); delete out._model;
      out.cleaning = Object.assign({}, P.cleaning, { results: P.cleaning.results.map(r => Object.assign({}, r, { idx: r.idx ? Array.from(r.idx) : null, newv: r.newv ? Array.from(r.newv, x => isFinite(x) ? +x.toPrecision(7) : null) : null })) });
      await window.host.writeText(d + '/' + P.name + '.avcal', JSON.stringify(out, null, 1));
      await window.host.writeBinary(d + '/' + P.name + '.avobs', encodeObs(this.data));
      this.dirty = false; this.rememberLast(); if (!quiet) AV.toast('Calibration project saved: ' + AV.basename(d) + '/' + P.name + '.avcal'); this.renderHead();
    }
    async newProject() {
      const r = await AV.formDialog('New Calibration Project', [{ k: 'name', l: 'Name', t: 'text' }, { t: 'note', l: 'Saved in ' + AV.basename(this.folder()) + ' next to the model. The mapping can be copied from the current project.' }, { k: 'copy', l: 'Copy the mapping of "' + this.P.name + '"', t: 'check' }], { name: 'Flow survey ' + new Date().getFullYear(), copy: this.P.mapping.length > 0 });
      if (!r || !r.name.trim()) return; const name = r.name.trim().replace(/[\\/:*?"<>|]/g, '_');
      if ((await this.listProjects()).includes(name) && !await AV.confirm('A project "' + name + '" exists. Replace it?', 'Calibration', 'Replace')) return;
      const map = r.copy ? this.P.mapping.map(x => Object.assign({}, x)) : [];
      this.P = this.blank(name); this.P._model = this.app.filePath; this.P.mapping = map; this.data = new Map(); this.cache.clear(); this.step = 0; this.sel = { mon: null, ev: null, res: null, win: null, v: null };
      await this.save(true); this.render();
    }
    async openProject(name) { if (this.dirty && !await AV.confirm('Save the changes of "' + this.P.name + '" first?', 'Calibration', 'Save', 'Discard')) { } else if (this.dirty) await this.save(true); await this.load(name); this.render(); }
    touch() { this.dirty = true; this.renderHead(); }

    // ------------------------------------------------------------------ mapping
    objectOf(id) {
      const m = this.m; if (!id) return null;
      if (m.links.has(id)) return m.links.get(id); if (m.nodes.has(id)) return m.nodes.get(id); if (m.gages.has(id)) return m.gages.get(id); return null;
    }
    kindName(o) { if (!o) return '–'; if (o.kind === 'GAGE') return 'Rain gage'; const t = String(o.type || ''); return t.charAt(0) + t.slice(1).toLowerCase(); }
    resolveMapping() {
      const m = this.m; const seenMon = new Map(), seenObj = new Map(); const out = [];
      let lower = null; const lc = () => { if (!lower) { lower = new Map(); for (const M of [m.links, m.nodes, m.gages]) for (const k of M.keys()) lower.set(k.toLowerCase(), k); } return lower; };
      this.P.mapping.forEach((r, i) => {
        const mon = String(r.mon || '').trim(), obj = String(r.obj || '').trim(); const res = { i, mon, obj, o: null, ok: false, reason: '' };
        if (!mon) res.reason = 'no monitor ID';
        else if (seenMon.has(mon.toUpperCase())) res.reason = 'monitor ID ' + mon + ' is listed twice';
        else if (!obj) res.reason = 'no object ID';
        else { const o = this.objectOf(obj);
          if (!o) { const alt = lc().get(obj.toLowerCase()) || lc().get(obj.toLowerCase().replace(/[a-z]+$/, '')); res.reason = 'object ' + obj + ' is not in the model' + (alt && alt !== obj ? ' (' + alt + ' exists)' : ''); }
          else if (seenObj.has(o)) res.reason = obj + ' is already used by ' + seenObj.get(o);
          else { res.o = o; res.ok = true; seenObj.set(o, mon); } }
        if (mon) seenMon.set(mon.toUpperCase(), i); out.push(res);
      });
      return out;
    }
    mapOf(mid) { const r = this.resolveMapping().find(x => x.mon.toUpperCase() === String(mid).toUpperCase()); return r || null; }
    knownIds() { return [...new Set(this.P.mapping.map(r => String(r.mon || '').trim()).filter(Boolean).concat(Object.values(this.P.monitors).map(x => x.mid)))]; }
    async importMapping(file) {
      const p = file || await window.host.openDialog({ title: 'Import mapping (Monitor ID, Object ID)', filters: [{ name: 'CSV / Excel', extensions: ['csv', 'txt', 'xlsx'] }] }); if (!p) return;
      let rows; try { rows = await window.host.obsTable(p); } catch (e) { AV.alert('Could not read the file: ' + e.message, 'Import Mapping'); return; }
      rows = rows.filter(r => r.some(c => String(c).trim()));
      let cm = 0, co = 1, start = 0; const hdr = (rows[0] || []).map(c => String(c).toLowerCase());
      if (hdr.some(c => /monitor|site|gauge|gage|logger/.test(c)) || hdr.some(c => /object|link|node|conduit|model/.test(c))) { start = 1; const a = hdr.findIndex(c => /monitor|site|gauge|gage|logger/.test(c)), b = hdr.findIndex(c => /object|link|node|conduit|model/.test(c)); if (a >= 0) cm = a; if (b >= 0) co = b; }
      let add = 0, upd = 0;
      for (const r of rows.slice(start)) { const mon = String(r[cm] === undefined ? '' : r[cm]).trim(), obj = String(r[co] === undefined ? '' : r[co]).trim(); if (!mon && !obj) continue;
        const e = this.P.mapping.find(x => x.mon && x.mon.toUpperCase() === mon.toUpperCase()); if (e && mon) { if (e.obj !== obj) { e.obj = obj; upd++; } } else { this.P.mapping.push({ mon, obj }); add++; } }
      this.touch(); this.render(); const R = this.resolveMapping(); AV.toast('Mapping imported: ' + add + ' added, ' + upd + ' changed · ' + R.filter(x => x.ok).length + ' linked, ' + R.filter(x => !x.ok).length + ' not matched.', false, 6000);
    }
    exportTemplate() {
      const ids = this.knownIds(); const rows = ['Monitor ID,Object ID'];
      if (ids.length) for (const id of ids) { const r = this.P.mapping.find(x => x.mon === id); rows.push(AV.csvCell(id) + ',' + AV.csvCell(r ? r.obj : '')); }
      else rows.push('FM01,' + AV.csvCell((this.m.links.keys().next().value) || 'C_1'), 'RG01,' + AV.csvCell((this.m.gages.keys().next().value) || 'RG_1'));
      AV.downloadText(rows.join('\r\n'), 'Calibration_mapping.csv');
    }
    exportNotMatched() { const R = this.resolveMapping().filter(x => !x.ok); AV.downloadText(['Monitor ID,Object ID,Reason'].concat(R.map(r => [r.mon, r.obj, r.reason].map(AV.csvCell).join(','))).join('\r\n'), 'Calibration_not_matched.csv'); }

    // ------------------------------------------------------------------ observed data
    defaultVar(mid) { const r = this.mapOf(mid); const o = r && r.o; if (o && o.kind === 'GAGE') return 'Rainfall'; if (o && o.kind === 'NODE') return 'Depth'; if (/^(rg|rain)/i.test(mid)) return 'Rainfall'; if (/^(dm|lm|lv)/i.test(mid)) return 'Depth'; return 'Flow'; }
    defaultUnit(v) { if (v === 'Flow') return MODEL_FLOW[this.m.flowUnits] || 'm3/s'; if (v === 'Depth') return this.si ? 'm' : 'ft'; if (v === 'Velocity') return this.si ? 'm/s' : 'ft/s'; return this.si ? 'mm' : 'in'; }
    modelUnit(v) { if (v === 'Flow') return MODEL_FLOW[this.m.flowUnits] || 'm3/s'; if (v === 'Depth') return this.si ? 'm' : 'ft'; if (v === 'Velocity') return this.si ? 'm/s' : 'ft/s'; return this.si ? 'mm/h' : 'in/h'; }
    // factor observed -> model units (rain depth per step -> intensity)
    factor(mon) {
      const v = mon.var, u = normUnit(mon.unit) || this.defaultUnit(v); const T = SI[v]; if (!T) return 1;
      const mu = this.modelUnit(v); const fm = T[mu];
      if (v === 'Rainfall') { const f = T[u]; const inch = u === 'in' || u === 'in/h' ? 25.4 : 1; const toMm = f === 'd' ? inch / Math.max(1e-9, (mon.step || 300) / 3600) : (typeof f === 'number' ? f : 1); return toMm / (fm || 1); }
      const f = T[u]; return typeof f === 'number' && typeof fm === 'number' ? f / fm : 1;
    }
    async addFiles(paths) {
      if (!paths || !paths.length) return; const app = this.app; const known = this.knownIds(); let nSer = 0, errs = [];
      const busy = AV.busy.start('Reading observed data');
      try {
        for (let k = 0; k < paths.length; k++) {
          const p = paths[k]; busy.set && busy.set(k / paths.length); app.status('Reading ' + AV.basename(p) + ' (' + (k + 1) + ' of ' + paths.length + ')…');
          let res; try { res = await window.host.obsRead(p, { knownIds: known.concat(this.knownIds()), preferDMY: this.si }); } catch (e) { errs.push(AV.basename(p) + ': ' + String(e.message || e).replace(/^Error invoking remote method[^:]*:\s*(Error:\s*)?/, '')); continue; }
          const size = await window.host.fileSize(p);
          for (const r of res) {
            this.P.files = this.P.files.filter(f => f.file !== r.file);
            if (r.error) { errs.push(AV.basename(r.file) + ': ' + r.error); continue; }
            const keys = [];
            for (const s of r.series) {
              const mid = String(s.id || '').trim() || 'M' + (Object.keys(this.P.monitors).length + 1); const v = s.var || this.defaultVar(mid); const key = mid + '|' + v;
              this.data.set(key, { t: s.t, v: s.v }); this.cache.clear();
              const old = this.P.monitors[key];
              this.P.monitors[key] = { mid, var: v, unit: normUnit(s.unit) || (old && old.unit) || '', unitGuessed: !s.unit, use: old ? old.use : true, file: r.file, header: s.header, n: s.t.length, step: s.step, t0: s.t[0], t1: s.t[s.t.length - 1] };
              keys.push(key); nSer++;
              if (!this.P.mapping.some(x => String(x.mon).toUpperCase() === mid.toUpperCase())) this.P.mapping.push({ mon: mid, obj: '' });
            }
            this.P.files.push({ file: r.file, path: p, size, layout: r.layout, dateFmt: r.dateFmt, order: r.order, ambiguous: r.ambiguous, rows: r.rows, badRows: r.badRows, step: (r.series[0] || {}).step || 0, keys });
          }
        }
      } finally { busy.done(); app.status(''); }
      this.P.cleaning.ran = false; this.P.cleaning.confirmed = false; this.P.cleaning.results = [];
      if (!this.P.events.gage) { const g = Object.keys(this.P.monitors).find(k => this.P.monitors[k].var === 'Rainfall'); if (g) this.P.events.gage = g; }
      this.detectEvents(true); this.touch(); this.render();
      if (errs.length) AV.alert('Some files could not be read:\n\n' + errs.join('\n'), 'Observed Data');
      else AV.toast(nSer + ' series read from ' + paths.length + ' file(s).');
      if (nSer) await this.save(true);
    }
    async addFolder() {
      const d = await window.host.openDialog({ title: 'Folder with the observed data files', folder: true }); if (!d) return;
      const L = await window.host.obsFindFiles(d); if (!L.length) { AV.alert('No data files (.csv, .txt, .dat, .xlsx) in this folder.', 'Observed Data'); return; }
      const mb = L.reduce((a, f) => a + f.size, 0) / 1048576;
      if (!await AV.confirm('Read ' + L.length + ' file(s) (' + mb.toFixed(1) + ' MB) from ' + d + '?', 'Observed Data', 'Read')) return;
      await this.addFiles(L.map(f => f.path));
    }
    async rereadFile(f, order) {
      let res; try { res = await window.host.obsRead(f.path, { knownIds: this.knownIds(), order }); } catch (e) { AV.alert(e.message, 'Observed Data'); return; }
      const r = res.find(x => x.file === f.file) || res[0]; if (!r || r.error) return;
      for (const s of r.series) { const mid = s.id; const v = s.var || this.defaultVar(mid); const key = mid + '|' + v; this.data.set(key, { t: s.t, v: s.v }); const M = this.P.monitors[key]; if (M) Object.assign(M, { n: s.t.length, step: s.step, t0: s.t[0], t1: s.t[s.t.length - 1] }); }
      Object.assign(f, { order: r.order, dateFmt: r.dateFmt }); this.cache.clear(); this.P.cleaning.confirmed = false; this.detectEvents(true); this.touch(); this.render();
    }
    removeFile(f) {
      this.P.files = this.P.files.filter(x => x !== f);
      for (const k of f.keys) if (!this.P.files.some(x => x.keys.includes(k))) { this.data.delete(k); delete this.P.monitors[k]; }
      this.P.cleaning.results = this.P.cleaning.results.filter(r => this.P.monitors[r.key]); this.P.cleaning.confirmed = false; this.cache.clear(); this.detectEvents(true); this.touch(); this.render();
    }
    // monitors grouped by ID
    monitorList() {
      const g = new Map(); for (const [k, M] of Object.entries(this.P.monitors)) { if (!g.has(M.mid)) g.set(M.mid, []); g.get(M.mid).push(Object.assign({ key: k }, M)); }
      const R = this.resolveMapping(); const byMon = new Map(R.map(r => [r.mon.toUpperCase(), r]));
      return [...g.entries()].map(([mid, vars]) => { vars.sort((a, b) => VARS.indexOf(a.var) - VARS.indexOf(b.var)); const r = byMon.get(mid.toUpperCase()); return { mid, vars, map: r || null, o: r && r.ok ? r.o : null }; })
        .sort((a, b) => (a.vars[0].var === 'Rainfall') - (b.vars[0].var === 'Rainfall') || a.mid.localeCompare(b.mid, undefined, { numeric: true }));
    }
    // series in model units, after the accepted cleaning (or with one result previewed)
    series(key, opt = {}) {
      const ck = key + '|' + (opt.raw ? 'raw' : opt.upto ? 'p' + opt.upto.id : 'c'); if (this.cache.has(ck)) return this.cache.get(ck);
      const d = this.data.get(key), M = this.P.monitors[key]; if (!d || !M) return null;
      const f = this.factor(M); let v = Float64Array.from(d.v, x => x * f); let t = d.t;
      if (!opt.raw) for (const r of this.P.cleaning.results) { if (r.key !== key || r.flagOnly) continue; const on = opt.upto ? (r === opt.upto || r.decision === 'accept') : r.decision === 'accept'; if (!on) continue; const o = applyRes(t, v, r, f); t = o.t; v = o.v; }
      const s = { t, v }; this.cache.set(ck, s); return s;
    }
    // ------------------------------------------------------------------ rainfall events
    rainKey() { const g = this.P.events.gage; return g && this.P.monitors[g] ? g : Object.keys(this.P.monitors).find(k => this.P.monitors[k].var === 'Rainfall') || ''; }
    detectEvents(keepChoices) {
      const E = this.P.events; const key = this.rainKey(); E.gage = key; if (!key) { E.list = []; return; }
      const s = this.series(key); const M = this.P.monitors[key]; const step = M.step || 300; const sh = step / 3600;
      const old = keepChoices ? new Map(E.list.map(e => [Math.round(e.t0 * 1440), e.use])) : new Map();
      const ev = []; let cur = null; const sepD = (+E.sep || 6) / 24;
      for (let i = 0; i < s.t.length; i++) { const x = s.v[i]; if (!(x > 0)) continue; const dep = x * sh;
        if (cur && s.t[i] - cur.t1 <= sepD) { cur.t1 = s.t[i] + step / 86400; cur.depth += dep; cur.peak = Math.max(cur.peak, x); }
        else { if (cur) ev.push(cur); cur = { t0: s.t[i], t1: s.t[i] + step / 86400, depth: dep, peak: x }; } }
      if (cur) ev.push(cur);
      const L = ev.filter(e => e.depth >= (+E.minDepth || 0)); L.forEach((e, i) => { e.id = 'E' + (i + 1); e.dur = (e.t1 - e.t0) * 24; });
      const rank = L.slice().sort((a, b) => b.depth - a.depth); const n = Math.max(0, Math.min(L.length, Math.round(+E.nUse || 0)));
      rank.forEach((e, i) => { e.use = i < n ? (i % 2 === 0 ? 'Calibration' : 'Validation') : 'Not used'; });
      if (keepChoices) L.forEach(e => { const u = old.get(Math.round(e.t0 * 1440)); if (u) e.use = u; });
      E.list = L; E.dry = this.dryDays(s, sh);
      if (this.sel.ev && !L.some(e => e.id === this.sel.ev)) this.sel.ev = null;
    }
    dryDays(s, sh) {
      const day = new Map(); for (let i = 0; i < s.t.length; i++) { const d = Math.floor(s.t[i]); day.set(d, (day.get(d) || 0) + (s.v[i] > 0 ? s.v[i] * sh : 0)); }
      const ds = [...day.keys()].sort((a, b) => a - b); const thr = this.si ? 0.5 : 0.02; const out = [];
      for (let i = 2; i < ds.length; i++) { const d = ds[i]; if (ds[i - 1] === d - 1 && ds[i - 2] === d - 2 && day.get(d) < thr && day.get(d - 1) < thr && day.get(d - 2) < thr * 4) out.push(d); }
      return out;
    }
    eventWindow(e) { return [e.t0 - 1 / 24, e.t1 + 12 / 24]; }

    // ------------------------------------------------------------------ cleaning
    runCleaning() {
      const C = this.P.cleaning, Mth = C.methods; const res = []; let seq = 0;
      const rain = this.rainKey() ? this.series(this.rainKey(), { raw: true }) : null;
      for (const [key, M] of Object.entries(this.P.monitors)) {
        if (!M.use) continue; const d = this.data.get(key); if (!d) continue;
        const f = this.factor(M); const t = d.t; const v = Float64Array.from(d.v, x => x * f); const st = (M.step || 300) / 86400; const add = (method, idx, newv, extra) => { if (!idx.length) return; const r = Object.assign({ id: ++seq, key, mid: M.mid, var: M.var, method, idx: Int32Array.from(idx), newv: newv ? Float32Array.from(newv) : null, n: idx.length, first: t[idx[0]], decision: '' }, extra || {}); res.push(r); applyRes(t, v, r, f, true); };
        const p95 = pctl(v, 0.95) || 1;
        if (Mth.spike.on && M.var !== 'Rainfall') { const k = +Mth.spike.k || 5; const idx = []; const W = 3;
          for (let i = 0; i < v.length; i++) { const x = v[i]; if (!isFinite(x)) continue; const nb = []; for (let j = i - W; j <= i + W; j++) if (j !== i && j >= 0 && j < v.length && isFinite(v[j])) nb.push(v[j]); if (nb.length < 3) continue;
            const md = median(nb); if (Math.abs(x) > k * Math.abs(md) + 0.05 * p95 && Math.abs(x - md) > 0.25 * p95) idx.push(i); }
          add('Spikes', idx, idx.map(() => NaN), { what: 'removed' }); }
        if (Mth.range.on) { const idx = []; let lim = Infinity; const o = this.mapOf(M.mid); const ob = o && o.ok ? o.o : null;
          if (M.var === 'Depth' && ob && ob.kind === 'NODE' && +ob.p.maxDepth > 0) lim = (+ob.p.maxDepth + (+ob.p.surDepth || 0)) * 1.05;
          if (M.var === 'Velocity') lim = this.si ? 10 : 33;
          for (let i = 0; i < v.length; i++) { const x = v[i]; if (!isFinite(x)) continue; if ((M.var !== 'Velocity' && x < 0) || Math.abs(x) > lim) idx.push(i); }
          add('Out of range', idx, idx.map(() => NaN), { what: 'removed', note: isFinite(lim) ? 'limit ' + AV.fmt(lim) + ' ' + this.modelUnit(M.var) : '' }); }
        if (Mth.flat.on && M.var !== 'Rainfall') { const minN = Math.max(3, Math.round((+Mth.flat.h || 3) / 24 / st)); const idx = [];
          // stuck sensor: the same value for a long time while it rains (an event, not drizzle); low dry-weather values and
          // a level held at the top of the record (pipe or manhole full) are real and kept
          let vmax = -Infinity; for (let i = 0; i < v.length; i++) if (v[i] > vmax) vmax = v[i]; const wetMin = this.si ? 2 : 0.08;
          for (let i = 0; i < v.length;) { let j = i + 1; while (j < v.length && v[j] === v[i] && isFinite(v[i])) j++;
            const x = v[i]; if (j - i >= minN && isFinite(x) && Math.abs(x) > 0.05 * p95 && x < 0.98 * vmax) { const wet = !rain || rainBetween(rain, t[i], t[j - 1]) >= wetMin; if (wet) for (let k = i + 1; k < j; k++) idx.push(k); } i = j; }
          add('Flat line', idx, idx.map(() => NaN), { what: 'removed' }); }
        if (Mth.shift.on && M.var !== 'Rainfall') { const sh = this.timeShift(key, t, v); if (sh) res.push({ id: ++seq, key, mid: M.mid, var: M.var, method: 'Time shift', shiftSec: sh.sec, idx: null, newv: null, n: t.length, first: t[0], decision: '', what: 'shifted ' + (sh.sec > 0 ? '+' : '') + Math.round(sh.sec / 60) + ' min', note: sh.note }); else if (sh === null) res.push({ id: ++seq, key, mid: M.mid, var: M.var, method: 'Time shift', idx: null, newv: null, n: 0, first: t[0], decision: 'accept', flagOnly: true, what: 'needs a model run over the survey period', note: 'load the results of a run that covers the data' }); }
        if (Mth.smooth.on && (M.var === 'Depth' || M.var === 'Velocity')) { const n = Math.max(2, Math.round(+Mth.smooth.n || 3)); const hw = n >> 1; const idx = [], nv = [];
          for (let i = 0; i < v.length; i++) { if (!isFinite(v[i])) continue; let s = 0, c = 0; for (let j = i - hw; j <= i + hw; j++) if (j >= 0 && j < v.length && isFinite(v[j])) { s += v[j]; c++; } const a = s / c; if (Math.abs(a - v[i]) > 1e-9 * (Math.abs(a) + 1)) { idx.push(i); nv.push(a / f); } }
          add('Smoothing', idx, nv, { what: 'smoothed' }); }
        if (Mth.fill.on) { const maxN = Math.max(1, Math.round((+Mth.fill.min || 30) / 1440 / st)); const idx = [], nv = []; let long = 0;
          for (let i = 0; i < v.length;) { if (isFinite(v[i])) { i++; continue; } let j = i; while (j < v.length && !isFinite(v[j])) j++;
            if (i > 0 && j < v.length && j - i <= maxN) for (let k = i; k < j; k++) { const a = v[i - 1], b = v[j]; const x = a + (b - a) * (t[k] - t[i - 1]) / (t[j] - t[i - 1]); idx.push(k); nv.push(x / f); }
            else long += (j - i); i = j; }
          add('Fill short gaps', idx, nv, { what: 'filled', note: long ? n0(long) + ' values in longer gaps stay empty' : '' }); }
        if (Mth.av.on && M.var === 'Flow') { const av = this.avCheck(M.mid, t, v); if (av && av.idx.length) res.push({ id: ++seq, key, mid: M.mid, var: M.var, method: 'Area–velocity', idx: Int32Array.from(av.idx), newv: null, n: av.idx.length, first: t[av.idx[0]], decision: 'accept', flagOnly: true, what: 'flagged only', note: av.note }); }
      }
      C.results = res; C.ran = true; C.confirmed = false; this.cache.clear(); this.sel.res = null; this.touch(); this.render();
      AV.toast(res.length ? res.length + ' cleaning result(s): accept or reject each one, then Confirm Cleaning.' : 'Nothing to clean: Confirm Cleaning to continue.', false, 6000);
    }
    timeShift(key, t, v) {
      const R = this.app.results; const M = this.P.monitors[key]; const ms = this.modelSeriesSync(M, t[0], t[t.length - 1]); if (!R || !ms) return null;
      // correlation of observed against the model for lags of -3 h .. +3 h
      const step = (M.step || 300) / 86400; const lagN = Math.round(3 / 24 / step); const mi = interp(ms.t, ms.v, t); let best = { c: -Infinity, k: 0 };
      for (let k = -lagN; k <= lagN; k++) { let sxy = 0, sx = 0, sy = 0, sxx = 0, syy = 0, n = 0; for (let i = Math.max(0, -k); i < t.length && i + k < t.length; i += 2) { const a = v[i], b = mi[i + k]; if (!isFinite(a) || !isFinite(b)) continue; sxy += a * b; sx += a; sy += b; sxx += a * a; syy += b * b; n++; }
        const c = n > 10 ? (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy) || 1) : -Infinity; if (c > best.c) best = { c, k }; }
      const sec = -best.k * (M.step || 300); if (Math.abs(sec) < 30 * 60) return 0;
      return { sec, note: 'best match with the model (r = ' + best.c.toFixed(2) + ')' };
    }
    avCheck(mid, t, q) {
      const kd = mid + '|Depth', kv = mid + '|Velocity'; if (!this.data.has(kd) || !this.data.has(kv)) return null; const r = this.mapOf(mid); const o = r && r.ok ? r.o : null; if (!o || o.kind !== 'LINK') return null;
      const shp = String(o.p.shape || '').toUpperCase(), g1 = +o.p.g1, g2 = +o.p.g2; const area = (d) => { if (!(d > 0)) return 0; if (shp === 'CIRCULAR' || shp === 'FORCE_MAIN') { const D = g1, y = Math.min(d, D); const th = 2 * Math.acos(1 - 2 * y / D); return D * D / 8 * (th - Math.sin(th)); } if (/^RECT/.test(shp)) return Math.min(d, g1) * g2; return NaN; };
      if (!isFinite(area(g1 / 2))) return { idx: [], note: '' };
      const D = interp(this.series(kd, { raw: true }).t, this.series(kd, { raw: true }).v, t), V = interp(this.series(kv, { raw: true }).t, this.series(kv, { raw: true }).v, t); const pct = (+this.P.cleaning.methods.av.pct || 20) / 100; const idx = []; const p95 = pctl(q, 0.95) || 1;
      for (let i = 0; i < t.length; i++) { const a = area(D[i]); if (!isFinite(q[i]) || !isFinite(V[i]) || !(a > 0)) continue; const qq = V[i] * a; if (Math.max(q[i], qq) > 0.1 * p95 && Math.abs(qq - q[i]) > pct * Math.max(Math.abs(q[i]), 1e-9)) idx.push(i); }
      return { idx, note: idx.length ? 'flow differs from velocity × wetted area by more than ' + Math.round(pct * 100) + ' %' : '' };
    }
    async confirmCleaning() {
      const C = this.P.cleaning; if (!C.ran) { if (!await AV.confirm('Data cleaning has not been run. Continue with the data as they are?', 'Confirm Cleaning', 'Continue')) return; C.ran = true; }
      const und = C.results.filter(r => !r.decision); if (und.length) { if (!await AV.confirm(und.length + ' result(s) are not decided yet. Accept them?', 'Confirm Cleaning', 'Accept and Confirm')) return; und.forEach(r => r.decision = 'accept'); }
      C.confirmed = true; C.confirmedBy = (this.app.auth && this.app.auth.user) || ''; C.confirmedAt = new Date().toISOString(); this.cache.clear(); this.touch(); this.render(); await this.save(true);
      const el = this.el && this.el.querySelector('.calchecks'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // ------------------------------------------------------------------ data checks (after the cleaning is confirmed)
    checks() {
      const out = []; const ok = (t) => out.push(['ok', t]), warn = (t) => out.push(['warn', t]), info = (t) => out.push(['info', t]);
      const mons = this.monitorList(); const used = mons.filter(m => m.vars.some(v => v.use));
      const nm = used.filter(m => !m.o); nm.length ? warn(nm.length + ' monitor(s) not linked to a model object: ' + nm.map(m => m.mid).slice(0, 12).join(', ') + ' – see Mapping') : ok('Every monitor is linked to a model object (' + used.length + ')');
      const gu = []; for (const m of used) for (const v of m.vars) if (v.use && !v.unit) gu.push(m.mid + ' ' + v.var.toLowerCase()); gu.length ? warn('Units not found in the files, model units assumed: ' + gu.slice(0, 10).join(', ') + (gu.length > 10 ? ' …' : '') + ' – check the Units column') : ok('Units read from the files and converted to the model units (' + this.modelUnit('Flow') + ', ' + this.modelUnit('Depth') + ')');
      const rs = AV.hmsToSec(this.m.options.REPORT_STEP || '00:15:00'); const steps = [...new Set(Object.values(this.P.monitors).map(M => M.step))].filter(Boolean).sort((a, b) => a - b);
      steps.some(s => s < rs) ? info('Data steps ' + steps.map(fmtStep).join(', ') + '; model reporting step ' + fmtStep(rs) + ' – data finer than the reporting step are compared at the reporting step') : ok('Data steps ' + steps.map(fmtStep).join(', ') + ' (model reporting step ' + fmtStep(rs) + ')');
      const evs = this.P.events.list.filter(e => e.use !== 'Not used');
      if (!this.rainKey()) warn('No rainfall data: events cannot be found'); else if (!evs.length) warn('No event is used for calibration or validation'); else {
        const nc = evs.filter(e => e.use === 'Calibration').length, nv = evs.length - nc; (nc && nv) ? ok(nc + ' calibration and ' + nv + ' validation event(s)') : warn(nc + ' calibration and ' + nv + ' validation event(s): use both, so that the result is checked on events it was not fitted to');
        const cov = []; for (const m of used) for (const v of m.vars) { if (!v.use || v.var === 'Rainfall') continue; const s = this.series(v.key); for (const e of evs) { const w = this.eventWindow(e); const fr = coverage(s, w[0], w[1], (v.step || 300) / 86400); if (fr < 0.8) cov.push(m.mid + ' ' + e.id + ' (' + Math.round(fr * 100) + ' %)'); } }
        cov.length ? warn('Data missing in events: ' + cov.slice(0, 10).join(', ') + (cov.length > 10 ? ' … (' + cov.length + ')' : '') + ' – these are left out of the scoring') : ok('Every used monitor has data in every used event');
        // rain volume vs flow volume (runoff coefficient)
        const bad = []; let nchk = 0; const rk = this.rainKey(); const rsr = this.series(rk); const rsh = (this.P.monitors[rk].step || 300) / 3600;
        for (const m of used) { const fv = m.vars.find(v => v.var === 'Flow' && v.use); if (!fv || !m.o) continue; const A = this.upstreamArea(m.o); if (!(A > 0)) continue; const s = this.series(fv.key);
          for (const e of evs) { const w = this.eventWindow(e); const base = baseFlow(s, e.t0); const V = volume(s, w[0], w[1], base) * this.flowToVol(); const P = rainBetween(rsr, e.t0, e.t1, rsh); if (!(P > 0) || !isFinite(V)) continue;
            const rv = this.si ? P / 1000 * A * 1e4 : P / 12 * A * 43560; const c = V / rv; nchk++; if (c < 0.02 || c > 1.0) bad.push(m.mid + ' ' + e.id + ' (' + c.toFixed(2) + ')'); } }
        if (nchk) bad.length ? warn('Flow volume vs. rain volume implausible (runoff coefficient outside 0.02–1.0): ' + bad.slice(0, 8).join(', ') + (bad.length > 8 ? ' …' : '') + ' – check units, the mapping or the rain gauge') : ok('Rain volume vs. flow volume plausible at every flow monitor (' + nchk + ' checks)');
      }
      const gaps = []; for (const m of used) for (const v of m.vars) { if (!v.use) continue; const s = this.series(v.key); let n = 0; for (let i = 0; i < s.v.length; i++) if (!isFinite(s.v[i])) n++; const p = n / Math.max(1, s.v.length); if (p > 0.05) gaps.push(m.mid + ' ' + v.var.toLowerCase() + ' ' + (p * 100).toFixed(1) + ' %'); }
      gaps.length ? warn('Still missing after cleaning: ' + gaps.slice(0, 8).join(', ')) : ok('Less than 5 % of the values missing at every monitor');
      const C = this.P.cleaning; const rej = C.results.filter(r => r.decision === 'reject' && (r.method === 'Flat line' || r.method === 'Spikes')); if (rej.length) warn('Kept on purpose (rejected cleaning): ' + rej.map(r => r.mid + ' ' + r.method.toLowerCase()).slice(0, 8).join(', '));
      const fl = C.results.filter(r => r.method === 'Area–velocity' && r.n); if (fl.length) warn('Area–velocity mismatch (flagged): ' + fl.map(r => r.mid + ' ' + n0(r.n) + ' values').join(', ') + ' – check the pipe size or the sensor');
      const dry = (this.P.events.dry || []).length; dry ? ok(dry + ' dry day(s) for the dry weather flow check') : info('No dry days found (3 days without rain) – dry weather flow cannot be checked');
      return out;
    }
    flowToVol() { // flow (model units) × days -> m3 or ft3
      const fu = this.m.flowUnits; const k = { CMS: 1, LPS: 0.001, MLD: 1000 / 86400, CFS: 1, GPM: 1 / 448.831, MGD: 1.547229 }[fu] || 1; return k * 86400; }
    upstreamArea(o) {
      const m = this.m; if (this._up && this._up.v === m.version && this._up.o === o) return this._up.a;
      const into = new Map(); for (const l of m.links.values()) { if (!into.has(l.to)) into.set(l.to, []); into.get(l.to).push(l.from); }
      const start = o.kind === 'LINK' ? o.from : o.kind === 'NODE' ? o.id : null; if (!start) return 0;
      const seen = new Set([start]); const st = [start]; while (st.length) { const n = st.pop(); for (const f of into.get(n) || []) if (!seen.has(f)) { seen.add(f); st.push(f); } }
      const outNode = (s, d = 0) => { const ot = s.p.outlet; if (m.subcatchments.has(ot) && d < 20) return outNode(m.subcatchments.get(ot), d + 1); return ot; };
      let a = 0; for (const s of m.subcatchments.values()) if (seen.has(outNode(s))) a += +s.p.area || 0;
      this._up = { v: m.version, o, a }; return a;
    }
    // model results of the loaded run at a monitor (model units), or null
    modelSeriesSync(M, w0, w1) { const c = this._ms && this._ms.get(M.mid + '|' + M.var); return c && c.R === this.app.results ? c.s : null; }
    async modelSeries(M) {
      const R = this.app.results; if (!R) return null; const r = this.mapOf(M.mid); const o = r && r.ok ? r.o : null; if (!o || M.var === 'Rainfall') return null;
      const k = M.mid + '|' + M.var; this._ms = this._ms || new Map(); const c = this._ms.get(k); if (c && c.R === R) return c.s;
      let t, vi; if (o.kind === 'LINK') { t = 'link'; vi = { Flow: 0, Depth: 1, Velocity: 2 }[M.var]; } else if (o.kind === 'NODE') { t = 'node'; vi = { Depth: 0 }[M.var]; } if (vi === undefined) return null;
      const i = R.idx[t].get(o.id); if (i === undefined) return null; const y = await window.host.outSeries(R.handle, t, i, vi);
      const n = R.meta.nPeriods; const tt = new Float64Array(n); for (let j = 0; j < n; j++) tt[j] = R.meta.startDate + (j + 1) * R.meta.reportStep / 86400;
      const s = { t: tt, v: Float64Array.from(y) }; this._ms.set(k, { R, s }); return s;
    }

    // ================================================================== UI
    render() {
      const E = this.el; if (!E) return; E.innerHTML = ''; this.charts = null;
      E.appendChild(this.head = h('div', { class: 'calhead' })); this.renderHead();
      const body = h('div', { class: 'calbody' }); E.appendChild(body);
      if (this.step === 0) this.renderMapping(body); else if (this.step === 1) this.renderObserved(body); else this.renderLater(body);
    }
    renderHead() {
      const H = this.head; if (!H) return; H.innerHTML = ''; const C = this.P.cleaning;
      const done = [this.resolveMapping().some(r => r.ok), C.confirmed];
      const steps = h('div', { class: 'calsteps' }); STEPS.forEach((s, i) => { if (i) steps.appendChild(h('span', { class: 'calarrow' }, '›'));
        steps.appendChild(h('button', { class: 'calstep' + (i === this.step ? ' on' : '') + (i >= READY ? ' later' : ''), title: i >= READY ? 'Comes in the next version' : '', onclick: () => this.go(i) }, (done[i] && i !== this.step ? '✓ ' : '') + (i + 1) + ' ' + s)); });
      const sel = h('select', { title: 'Calibration projects of this model', onchange: (e) => { if (e.target.value === '__new') { e.target.value = this.P.name; this.newProject(); } else this.openProject(e.target.value); } }, h('option', { value: this.P.name }, this.P.name));
      this.listProjects().then(L => { for (const n of L) if (n !== this.P.name) sel.appendChild(h('option', { value: n }, n)); sel.appendChild(h('option', { value: '__new' }, 'New project…')); });
      H.append(steps, h('span', { style: { flex: 1 } }), h('span', { class: 'muted' }, 'Calibration project:'), sel,
        h('button', { class: 'btn small' + (this.dirty ? ' primary' : ''), onclick: () => this.save() }, this.dirty ? 'Save *' : 'Save'),
        h('button', { class: 'btn small', title: 'Open the project folder', onclick: () => window.host.showItem(this.folder()) }, 'Folder'));
    }
    async go(i) {
      if (i >= READY) { AV.toast('Step ' + (i + 1) + ' (' + STEPS[i] + ') comes in the next version. Mapping and Observed Data can be prepared now.', false, 5000); return; }
      this.step = i; this.render();
    }
    renderLater(body) { body.appendChild(h('div', { class: 'calcard', style: { padding: '24px' } }, h('b', null, STEPS[this.step]), h('p', null, 'This step comes in the next version.'))); }

    // ------------------------------------------------------------------ step 1
    renderMapping(body) {
      const R = this.resolveMapping(); const nOk = R.filter(r => r.ok).length; const bad = R.filter(r => !r.ok);
      const grid = h('div', { class: 'calgrid2' }); body.appendChild(grid);
      const left = h('div', { class: 'calcard' }); grid.appendChild(left);
      const search = h('input', { type: 'text', placeholder: 'Search…', value: this.q.map, style: { width: '150px' }, oninput: (e) => { this.q.map = e.target.value; fill(); } });
      left.appendChild(h('div', { class: 'calch wrap' }, h('b', null, 'Mapping: monitor ↔ model object'), h('span', { class: 'muted nowrap' }, R.length + ' rows · ' + nOk + ' linked'), h('span', { style: { flex: 1 } }), search,
        h('button', { class: 'btn small', onclick: () => { this.P.mapping.push({ mon: '', obj: '' }); this.touch(); this.render(); setTimeout(() => { const ins = this.el.querySelectorAll('.calmap input.mon'); ins.length && ins[ins.length - 1].focus(); }, 30); } }, '+ Add Row'),
        h('button', { class: 'btn small', onclick: () => this.exportTemplate() }, 'Export Template…'), h('button', { class: 'btn small primary', onclick: () => this.importMapping() }, 'Import Mapping…')));
      const wrap = h('div', { class: 'calscroll', style: { maxHeight: 'calc(100vh - 330px)', minHeight: '240px' } }); left.appendChild(wrap);
      const tbl = h('table', { class: 'caltbl calmap' }); wrap.appendChild(tbl);
      const fill = () => {
        const q = this.q.map.trim().toLowerCase(); const RR = this.resolveMapping();
        tbl.innerHTML = '<tr><th>Monitor ID</th><th>Object ID</th><th>Object found</th><th>Status</th><th></th></tr>';
        for (const r of RR) { if (q && !(r.mon + ' ' + r.obj).toLowerCase().includes(q)) continue;
          const tr = h('tr', { class: r.ok ? '' : 'bad' });
          const mon = h('input', { class: 'mon', value: r.mon, onchange: (e) => { this.P.mapping[r.i].mon = e.target.value.trim(); this.touch(); this.render(); } });
          const obj = h('input', { class: 'obj' + (r.ok || !r.obj ? '' : ' err'), value: r.obj, onchange: (e) => { this.P.mapping[r.i].obj = e.target.value.trim(); this.touch(); this.render(); } });
          const pick = h('button', { class: 'btn small', title: 'Use the object selected on the map', onclick: () => { const s = [...this.app.selection][0]; if (!s) { AV.toast('Select a conduit, node or rain gage on the map first.', true); return; } this.P.mapping[r.i].obj = s.id; this.touch(); this.render(); } }, '⌖');
          const zoom = h('button', { class: 'btn small', title: 'Show on the map', disabled: !r.ok, onclick: () => { this.app.select(r.o); this.app.map && this.app.map.zoomToObjects([r.o]); this.app.activateView && this.app.activateView('map'); } }, '◎');
          const del = h('button', { class: 'btn small', title: 'Delete the row', onclick: () => { this.P.mapping.splice(r.i, 1); this.touch(); this.render(); } }, '×');
          tr.append(h('td', null, mon), h('td', null, obj), h('td', null, r.ok ? this.kindName(r.o) : '–'), h('td', { html: r.ok ? chip('good', '✓ linked') : chip('bad', '× ' + (r.reason.startsWith('object') || r.reason.includes('used by') ? 'not matched' : r.reason)) }), h('td', { class: 'nowrap' }, pick, zoom, del));
          tbl.appendChild(tr); }
        if (!RR.length) tbl.appendChild(h('tr', null, h('td', { colspan: 5, class: 'muted', style: { padding: '14px' } }, 'No mapping yet: import a file with two columns (Monitor ID, Object ID), add rows, or read the observed data first – their monitor IDs are added here.')));
      };
      fill();
      const right = h('div', { class: 'calcol' }); grid.appendChild(right);
      right.appendChild(h('div', { class: 'calcard calnote' }, h('b', null, 'Template: two columns'), h('pre', null, 'Monitor ID, Object ID'),
        h('div', null, 'Object ID is a conduit (or other link), a node or a rain gage of the model; the kind is found automatically. The monitor type (flow, depth, velocity, rainfall) and the units are read from the data files in the next step. CSV or Excel (.xlsx).')));
      const nm = h('div', { class: 'calcard' }); right.appendChild(nm);
      nm.appendChild(h('div', { class: 'calch' }, h('b', null, 'Not matched'), h('span', { class: 'muted' }, bad.length + ' rows'), h('span', { style: { flex: 1 } }), h('button', { class: 'btn small', disabled: !bad.length, onclick: () => this.exportNotMatched() }, 'Export Not Matched…')));
      const nmw = h('div', { class: 'calscroll', style: { maxHeight: '320px' } }); nm.appendChild(nmw);
      nmw.innerHTML = '<table class="caltbl"><tr><th>Monitor ID</th><th>Object ID</th><th>Reason</th></tr>' + (bad.length ? bad.map(r => '<tr><td><b>' + esc(r.mon || '–') + '</b></td><td>' + esc(r.obj || '–') + '</td><td>' + esc(r.reason) + '</td></tr>').join('') : '<tr><td colspan="3" class="muted">Every row is linked.</td></tr>') + '</table>';
      nm.appendChild(h('div', { class: 'muted calpad' }, 'Every row that cannot be linked is kept here with its reason; export it (CSV), correct it in the file and import it again, or correct it in the table on the left.'));
      right.appendChild(h('div', { class: 'calnext' }, h('button', { class: 'btn primary', onclick: () => this.go(1) }, 'Next: Observed Data ›')));
    }

    // ------------------------------------------------------------------ step 2
    renderObserved(body) {
      const P = this.P; const mons = this.monitorList();
      if (!this.sel.mon || !mons.some(m => m.mid === this.sel.mon)) this.sel.mon = (mons.find(m => m.vars.some(v => v.var === 'Flow')) || mons.find(m => m.vars[0].var !== 'Rainfall') || mons[0] || {}).mid || null;
      // A. data files
      const files = h('div', { class: 'calcard calfiles' }); body.appendChild(files);
      const drop = h('div', { class: 'caldrop' }, h('div', null, 'Drop data files or a folder here'),
        h('div', null, h('button', { class: 'btn small primary', onclick: async () => { const p = await window.host.openDialog({ title: 'Observed data files', multi: true, filters: [{ name: 'Data files', extensions: ['csv', 'txt', 'dat', 'tsv', 'prn', 'xlsx', 'xlsm'] }, { name: 'All files', extensions: ['*'] }] }); if (p) this.addFiles(p); } }, 'Add Files…'), ' ',
          h('button', { class: 'btn small', onclick: () => this.addFolder() }, 'Add Folder…')),
        h('div', { class: 'muted' }, 'CSV · TXT · DAT · XLSX · flow-survey exports'));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); }); drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); const ps = [...e.dataTransfer.files].map(f => window.host.pathForFile(f)).filter(Boolean); const out = [];
        for (const p of ps) { if (/\.[a-z0-9]{2,4}$/i.test(p)) out.push(p); else { const L = await window.host.obsFindFiles(p); out.push(...L.map(x => x.path)); } } if (out.length) this.addFiles(out); });
      const tot = P.files.reduce((a, f) => a + (f.size || 0), 0), rows = P.files.reduce((a, f) => a + (f.rows || 0), 0);
      const ft = h('div', { class: 'calfilelist' }, h('div', { class: 'calch' }, h('b', null, 'Batch data read'), h('span', { class: 'muted' }, P.files.length ? P.files.length + ' files · ' + (tot / 1048576).toFixed(1) + ' MB · ' + n0(rows) + ' rows · formats recognised automatically' : 'no files yet')));
      const fw = h('div', { class: 'calscroll', style: { maxHeight: '138px' } }); ft.appendChild(fw); const LAY = { wide: 'one column per monitor', single: 'one file per monitor', long: 'long table (monitor, time, value)', gage: 'rain gauge (STA Y M D H m value)' };
      const known = new Set(this.resolveMapping().filter(r => r.ok).map(r => r.mon.toUpperCase()));
      const ftb = h('table', { class: 'caltbl' }); fw.appendChild(ftb); ftb.innerHTML = '<tr><th>File</th><th>Layout found</th><th>Date / time</th><th class="n">Step</th><th class="n">Rows</th><th>Linked</th><th></th></tr>';
      for (const f of P.files) { const ids = [...new Set(f.keys.map(k => (P.monitors[k] || {}).mid).filter(Boolean))]; const nl = ids.filter(i => known.has(i.toUpperCase())).length; const nk = ids.length;
        const dt = f.ambiguous ? h('select', { title: 'Day and month cannot be told apart from the data: choose the order', onchange: (e) => this.rereadFile(f, e.target.value) }, ['DMY', 'MDY'].map(o => h('option', { value: o, selected: f.order === o }, o === 'DMY' ? 'dd/MM/yyyy' : 'MM/dd/yyyy'))) : f.dateFmt;
        ftb.appendChild(h('tr', null, h('td', { title: f.path }, AV.basename(f.file)), h('td', null, (LAY[f.layout] || f.layout) + (f.layout === 'wide' ? ' (' + nk + ')' : '')), h('td', null, dt, f.badRows ? h('span', { class: 'cchip mid', title: 'rows without a valid date were skipped' }, n0(f.badRows) + ' rows skipped') : ''),
          h('td', { class: 'n nowrap' }, fmtStep(f.step)), h('td', { class: 'n' }, n0(f.rows)), h('td', { html: nl === nk ? chip('good', nl + ' of ' + nk) : chip('mid', nl + ' of ' + nk) }), h('td', null, h('button', { class: 'btn small', title: 'Remove this file and its data', onclick: () => this.removeFile(f) }, '×')))); }
      if (!P.files.length) ftb.appendChild(h('tr', null, h('td', { colspan: 7, class: 'muted' }, 'Add the flow-survey and rain-gauge files. The layout (one column per monitor, one file per monitor, long table, rain-gauge format), the date format, the time step, the monitor IDs and the units are recognised automatically.')));
      files.append(drop, ft);
      if (!P.files.length) return;
      // B. monitors + events (left) | chart (right)
      const grid = h('div', { class: 'calgrid' }); body.appendChild(grid);
      const left = h('div', { class: 'calcol' }), right = h('div', { class: 'calcol' }); grid.append(left, right);
      this.renderMonitors(left, mons); this.renderEvents(left); this.renderChart(right);
      // C. cleaning, D. checks
      this.renderCleaning(body); this.renderChecks(body);
    }
    renderMonitors(box, mons) {
      const card = h('div', { class: 'calcard' }); box.appendChild(card);
      const cnt = {}; for (const m of mons) for (const v of m.vars) cnt[v.var] = (cnt[v.var] || 0) + 1;
      const search = h('input', { type: 'text', placeholder: 'Search…', value: this.q.mon, style: { width: '110px' }, oninput: (e) => { this.q.mon = e.target.value; fill(); } });
      card.appendChild(h('div', { class: 'calch' }, h('b', null, 'Monitors'), h('span', { class: 'muted' }, mons.length + ' · ' + VARS.filter(v => cnt[v]).map(v => cnt[v] + ' ' + v.toLowerCase()).join(', ')), h('span', { style: { flex: 1 } }), search,
        h('button', { class: 'btn small', title: 'Map monitors to model objects', onclick: () => this.go(0) }, 'Mapping…')));
      const wrap = h('div', { class: 'calscroll', style: { height: '262px' } }); card.appendChild(wrap); const tbl = h('table', { class: 'caltbl calmon' }); wrap.appendChild(tbl);
      const qual = this.qualityMap();
      const fill = () => { const q = this.q.mon.trim().toLowerCase(); tbl.innerHTML = '<tr><th>Use</th><th>Monitor</th><th>Type</th><th>Units</th><th>Model object</th><th class="n">Records</th><th>Quality</th></tr>';
        for (const m of mons) { if (q && !(m.mid + ' ' + (m.map ? m.map.obj : '')).toLowerCase().includes(q)) continue;
          const tr = h('tr', { class: (m.mid === this.sel.mon ? 'sel' : '') + (m.vars.every(v => !v.use) ? ' off' : ''), onclick: (e) => { if (e.target.closest('input,select')) return; this.sel.mon = m.mid; this.sel.res = null; this.sel.v = null; this.renderMonSel(); this.drawChart(); } });
          const use = h('input', { type: 'checkbox', checked: m.vars.some(v => v.use), title: 'Use this monitor', onchange: (e) => { m.vars.forEach(v => P_(this, v.key).use = e.target.checked); this.P.cleaning.confirmed = false; this.touch(); tr.classList.toggle('off', !e.target.checked); } });
          const units = h('span', null, ...m.vars.map(v => { const M = this.P.monitors[v.key]; const opts = Object.keys(SI[v.var] || {}); const cur = normUnit(M.unit);
            return h('select', { class: 'unit' + (M.unit ? '' : ' guess'), title: v.var + (M.unit ? '' : ' – units not found in the file: model units assumed'), onchange: (e) => { M.unit = e.target.value; M.unitGuessed = false; this.cache.clear(); this.P.cleaning.confirmed = false; if (v.var === 'Rainfall') this.detectEvents(true); this.touch(); this.render(); } },
              (cur && !opts.includes(cur) ? [cur] : []).concat(M.unit ? [] : ['']).concat(opts).map(u => h('option', { value: u, selected: u === (M.unit ? cur : '') }, u || '(' + this.defaultUnit(v.var) + '?)'))); }));
          const qq = qual.get(m.mid);
          tr.append(h('td', null, use), h('td', null, h('b', null, m.mid)), h('td', null, m.vars.map(v => v.var).join(' + ')), h('td', { class: 'nowrap' }, units),
            h('td', { class: 'nowrap', title: m.o ? this.kindName(m.o) + ' ' + m.o.id : '', html: m.o ? esc(m.o.id) : chip('bad', m.map && m.map.obj ? 'not matched' : 'not mapped') }),
            h('td', { class: 'n' }, n0(m.vars[0].n)), h('td', { class: 'nowrap', title: qq ? qq[3].join('\n') : '', html: qq ? chip(qq[0], qq[1]) : '<span class="good">✓ good</span>' }));
          tbl.appendChild(tr); } };
      fill(); this._monTbl = tbl;
      const per = Object.values(this.P.monitors); const t0 = Math.min(...per.map(M => M.t0)), t1 = Math.max(...per.map(M => M.t1));
      card.appendChild(h('div', { class: 'muted calpad' }, 'Period ' + fmtD(t0) + ' – ' + fmtD(t1) + '. Click a monitor to see it on the right; values are shown in the model units (' + this.modelUnit('Flow') + ', ' + this.modelUnit('Depth') + '). Change the units where the file has none (marked orange).'));
    }
    renderMonSel() { if (!this._monTbl) return; [...this._monTbl.rows].forEach(r => { const b = r.querySelector('b'); r.classList.toggle('sel', !!b && b.textContent === this.sel.mon); }); }
    qualityMap() { // before cleaning: what the cleaning found; after: done
      const q = new Map(); const C = this.P.cleaning;
      for (const r of C.results) { if (q.has(r.mid)) { q.get(r.mid)[2]++; continue; } q.set(r.mid, [r.decision === 'reject' ? 'mid' : C.confirmed && !r.flagOnly ? 'good' : 'mid', C.confirmed && !r.flagOnly && r.decision === 'accept' ? '✓ cleaned' : '⚠ ' + r.method.toLowerCase(), 1, []]); }
      for (const r of C.results) { const v = q.get(r.mid); if (v && v[3].length < v[2]) v[3].push(r.method + (r.n ? ' (' + n0(r.n) + ')' : '') + (r.decision ? ' – ' + r.decision + 'ed' : '')); }
      for (const [k, v] of q) if (v[2] > 1) v[1] += ' +' + (v[2] - 1);
      return q;
    }
    renderEvents(box) {
      const E = this.P.events; const card = h('div', { class: 'calcard' }); box.appendChild(card);
      const gages = Object.keys(this.P.monitors).filter(k => this.P.monitors[k].var === 'Rainfall');
      const num = (k, w, st, re) => h('input', { type: 'number', value: E[k], step: st, min: 0, style: { width: w + 'px' }, onchange: (e) => { E[k] = +e.target.value; this.detectEvents(!re); this.P.cleaning.confirmed = false; this.touch(); this.render(); } });
      const du = this.si ? 'mm' : 'in';
      card.appendChild(h('div', { class: 'calch wrap' }, h('b', null, 'Rainfall events'),
        gages.length ? h('label', null, 'from ', h('select', { onchange: (e) => { E.gage = e.target.value; this.detectEvents(false); this.touch(); this.render(); } }, gages.map(g => h('option', { value: g, selected: g === E.gage }, this.P.monitors[g].mid)))) : h('span', { class: 'muted' }, 'no rain gauge data'),
        h('span', { style: { flex: 1 } }), h('label', { title: 'Dry time that separates two events' }, 'Separation ', num('sep', 50, 1), ' h'), h('label', null, 'Min. depth ', num('minDepth', 56, this.si ? 1 : 0.05), ' ' + du),
        h('label', { title: 'How many of the largest events are used; they alternate between calibration and validation. Change any row afterwards.' }, 'Use ', num('nUse', 46, 1, true), ' largest')));
      const wrap = h('div', { class: 'calscroll', style: { maxHeight: '252px' } }); card.appendChild(wrap);
      const tbl = h('table', { class: 'caltbl calev' }); wrap.appendChild(tbl);
      tbl.innerHTML = '<tr><th>Event</th><th>Start</th><th class="n" title="Duration (h)">Dur. (h)</th><th class="n">Rain (' + du + ')</th><th class="n">Peak (' + du + '/h)</th><th>Use as</th></tr>';
      for (const e of E.list) { const tr = h('tr', { class: (e.id === this.sel.ev ? 'sel' : '') + (e.use === 'Not used' ? ' off' : ''), onclick: (ev) => { if (ev.target.closest('select')) return; this.sel.ev = this.sel.ev === e.id ? null : e.id; this.sel.win = null; this.sel.res = null; [...tbl.rows].forEach(r => r.classList.toggle('sel', r === tr && !!this.sel.ev)); this.drawChart(); } });
        const us = h('select', { onchange: (x) => { e.use = x.target.value; tr.classList.toggle('off', e.use === 'Not used'); this.P.cleaning.confirmed = this.P.cleaning.confirmed && true; this.touch(); this.refreshChecks(); } }, ['Calibration', 'Validation', 'Not used'].map(u => h('option', { value: u, selected: u === e.use }, u)));
        tr.append(h('td', null, h('b', null, e.id)), h('td', { class: 'nowrap' }, fmtT(e.t0)), h('td', { class: 'n' }, e.dur.toFixed(1)), h('td', { class: 'n' }, AV.fmt(e.depth, this.si ? 1 : 2)), h('td', { class: 'n' }, AV.fmt(e.peak, this.si ? 1 : 2)), h('td', null, us)); tbl.appendChild(tr); }
      if (!E.list.length) tbl.appendChild(h('tr', null, h('td', { colspan: 6, class: 'muted' }, gages.length ? 'No event with at least ' + E.minDepth + ' ' + du + '.' : 'Add rain-gauge data to find the events.')));
      const nc = E.list.filter(e => e.use === 'Calibration').length, nv = E.list.filter(e => e.use === 'Validation').length;
      const dry = (E.dry || []); const dl = h('div', { class: 'calpad muted' }, E.list.length + ' events · ' + nc + ' calibration, ' + nv + ' validation. Click an event to see it on the right. ');
      if (dry.length) { dl.appendChild(h('span', null, 'Dry days: ')); groupDays(dry).slice(0, 6).forEach(g => dl.append(h('a', { class: 'callink', title: 'Show these dry days in the chart', onclick: () => { this.sel.ev = null; this.sel.res = null; this.sel.win = [g[0], g[1] + 1]; this.drawChart(); } }, fmtD(g[0]).slice(5) + (g[1] > g[0] ? '–' + fmtD(g[1]).slice(5) : '')), ', ')); dl.appendChild(h('span', null, '(dry weather flow check)')); }
      card.appendChild(dl);
    }
    // chart: selected monitor in the selected event (or a cleaning result / dry days / the whole record)
    renderChart(box) {
      const card = h('div', { class: 'calcard calchart' }); box.appendChild(card);
      this._chHead = h('div', { class: 'calch' }); card.appendChild(this._chHead);
      const rainBox = h('div', { class: 'calrain' }), mainBox = h('div', { class: 'calmain' }); card.append(rainBox, mainBox);
      const rc = new AV.Chart(rainBox, {}), mc = new AV.Chart(mainBox, {}); rc.peers = [mc]; mc.peers = [rc]; this.charts = { rc, mc };
      this._kpis = h('div', { class: 'calkpis' }); box.appendChild(this._kpis);
      setTimeout(() => this.drawChart(), 0);
    }
    async drawChart() {
      if (!this.charts) return; const { rc, mc } = this.charts; const mon = this.monitorList().find(m => m.mid === this.sel.mon); const head = this._chHead;
      if (!mon) { head.innerHTML = '<b>No monitor</b>'; return; }
      const res = this.sel.res ? this.P.cleaning.results.find(r => r.id === this.sel.res) : null;
      const vars = mon.vars; let vk = this.sel.v && vars.find(v => v.key === this.sel.v) ? this.sel.v : (res ? res.key : (vars.find(v => v.var === 'Flow') || vars.find(v => v.var === 'Depth') || vars[0]).key); this.sel.v = vk;
      const M = this.P.monitors[vk]; const ev = this.sel.ev ? this.P.events.list.find(e => e.id === this.sel.ev) : null;
      let w = res ? resWindow(res, this.data.get(res.key).t, M.step) : this.sel.win ? this.sel.win : ev ? this.eventWindow(ev) : [M.t0, M.t1];
      head.innerHTML = ''; const vsel = vars.length > 1 ? h('select', { onchange: (e) => { this.sel.v = e.target.value; this.drawChart(); } }, vars.map(v => h('option', { value: v.key, selected: v.key === vk }, v.var))) : null;
      head.append(h('b', null, mon.mid + (mon.o ? ' · ' + mon.o.id : '')), vsel || h('span', { class: 'muted' }, M.var), h('span', { class: 'muted' }, res ? 'Cleaning: ' + res.method + ' · ' + fmtT(res.first) : ev ? 'Event ' + ev.id + ' · ' + fmtD(ev.t0) : this.sel.win ? 'Dry days ' + fmtD(w[0]) : 'Whole record'),
        h('span', { style: { flex: 1 } }), (ev || this.sel.win || res) ? h('button', { class: 'btn small', onclick: () => { this.sel.ev = null; this.sel.win = null; this.sel.res = null; this.render(); } }, 'Whole record') : '');
      const cut = (s) => { if (!s) return null; let a = lb(s.t, w[0]), b = lb(s.t, w[1] + 1e-9); return { x: s.t.subarray ? s.t.subarray(a, b) : s.t.slice(a, b), y: s.v.subarray ? s.v.subarray(a, b) : s.v.slice(a, b) }; };
      const series = []; const unit = this.modelUnit(M.var);
      if (res) { const before = cut(this.series(vk, { raw: true })); const after = cut(this.series(vk, { upto: res })); series.push(Object.assign({ name: 'Before cleaning', color: '#ef6c00', width: 1.4 }, before)); if (!res.flagOnly) series.push(Object.assign({ name: 'After', color: '#1565c0', width: 2 }, after)); }
      else { const raw = cut(this.series(vk, { raw: true })), cl = cut(this.series(vk)); const changed = this.P.cleaning.results.some(r => r.key === vk && r.decision === 'accept' && !r.flagOnly);
        const few = raw.x.length < 500; series.push(Object.assign({ name: changed ? 'Observed (original)' : 'Observed', color: changed ? '#b0bec5' : '#263238', width: few ? 0.01 : 1.2, marker: few ? 'circle' : 'none' }, raw));
        if (changed) series.push(Object.assign({ name: 'Observed (cleaned)', color: '#263238', width: 1.4, marker: few ? 'circle' : 'none' }, cl)); }
      let model = null; try { model = await this.modelSeries(M); } catch (e) { model = null; } const mcut = model ? cut(model) : null;
      if (mcut && mcut.x.length > 1) series.push(Object.assign({ name: 'Model (' + (this.app.results && this.app.results.name || 'loaded run') + ')', color: '#1e6edc', width: 2 }, mcut));
      const xf = (d) => fmtShort(d);
      mc.setSeries(series, { xFix: w, xFmt: xf, yLabel: M.var + ' (' + unit + ')', xLabel: 'Date / time', title: '' });
      const rk = this.rainKey(); const rs = rk ? cut(this.series(rk)) : null;
      rc.setSeries(rs ? [Object.assign({ name: 'Rainfall', color: '#64b5f6', bars: true }, rs)] : [], { xFix: w, xFmt: xf, invert: true, compact: true, yLabel: this.modelUnit('Rainfall') });
      if (res) { this._kpis.innerHTML = ''; this._kpis.appendChild(h('div', { class: 'calkpi', style: { gridColumn: '1 / -1' } }, h('b', null, res.method + ': '), (res.idx ? n0(res.n) + ' values ' + (res.what || '') : res.what || '') + (res.note ? ' · ' + res.note : '') + ' · decision: ' + (res.flagOnly ? 'flag only' : res.decision || 'not decided'))); }
      else this.renderKpis(M, w, mcut, series[series.length - (mcut && mcut.x.length > 1 ? 2 : 1)]);
    }
    renderKpis(M, w, mcut, obs) {
      const K = this._kpis; if (!K) return; K.innerHTML = ''; const u = this.modelUnit(M.var);
      if (!obs || !obs.x.length) { K.appendChild(h('div', { class: 'muted' }, 'No data in this period.')); return; }
      const pk = (s) => { let m = -Infinity, ti = NaN; for (let i = 0; i < s.y.length; i++) if (s.y[i] > m) { m = s.y[i]; ti = s.x[i]; } return { m, ti }; };
      const vol = (s) => { let v = 0; for (let i = 1; i < s.x.length; i++) { const a = s.y[i - 1], b = s.y[i]; if (isFinite(a) && isFinite(b)) v += (a + b) / 2 * (s.x[i] - s.x[i - 1]); } return v * this.flowToVol(); };
      const o = pk(obs), md = mcut && mcut.x.length > 1 ? pk(mcut) : null; const pct = (a, b) => (b - a) / Math.abs(a || 1e-9) * 100;
      const card = (lbl, val, sub, cls) => h('div', { class: 'calkpi' }, h('div', { class: 'muted' }, lbl), h('div', { class: 'kv' }, val), h('div', { class: 'ks ' + (cls || '') }, sub || ''));
      const lim = M.var === 'Flow' ? [25, -15] : null; const inLim = (p, L) => p <= L[0] && p >= L[1];
      if (M.var === 'Depth') { const d = md ? md.m - o.m : null; const tol = this.si ? 0.1 : 0.33; K.appendChild(card('Peak depth', AV.fmt(o.m) + (md ? ' → ' + AV.fmt(md.m) : '') + ' ' + u, md ? (d >= 0 ? '+' : '') + AV.fmt(d) + ' ' + u + ' (limit ±' + tol + ' ' + u + ')' : 'observed', md ? (Math.abs(d) <= tol ? 'good' : 'bad') : '')); }
      else K.appendChild(card('Peak ' + M.var.toLowerCase(), AV.fmt(o.m) + (md ? ' → ' + AV.fmt(md.m) : '') + ' ' + u, md ? (pct(o.m, md.m) >= 0 ? '+' : '') + pct(o.m, md.m).toFixed(0) + ' %' + (lim ? ' (limit +25 / −15 %)' : '') : 'observed', md && lim ? (inLim(pct(o.m, md.m), lim) ? 'good' : 'bad') : ''));
      if (M.var === 'Flow') { const vo = vol(obs), vm = md ? vol(mcut) : null; const vu = this.si ? 'm³' : 'ft³'; const p = vm !== null ? pct(vo, vm) : null; K.appendChild(card('Volume', n0(Math.round(vo)) + (vm !== null ? ' → ' + n0(Math.round(vm)) : '') + ' ' + vu, p !== null ? (p >= 0 ? '+' : '') + p.toFixed(0) + ' % (limit +20 / −10 %)' : 'observed', p !== null ? (p <= 20 && p >= -10 ? 'good' : 'bad') : '')); }
      K.appendChild(card('Time of peak', fmtT(o.ti).slice(11) + (md ? ' → ' + fmtT(md.ti).slice(11) : ''), md ? ((md.ti - o.ti) * 1440 >= 0 ? '+' : '') + Math.round((md.ti - o.ti) * 1440) + ' min' : fmtD(o.ti)));
      if (md) { const mi = interp(mcut.x, mcut.y, obs.x); let so = 0, n = 0; for (let i = 0; i < obs.y.length; i++) if (isFinite(obs.y[i]) && isFinite(mi[i])) { so += obs.y[i]; n++; } const mean = so / Math.max(1, n); let a = 0, b = 0; for (let i = 0; i < obs.y.length; i++) if (isFinite(obs.y[i]) && isFinite(mi[i])) { a += (obs.y[i] - mi[i]) ** 2; b += (obs.y[i] - mean) ** 2; }
        const nse = 1 - a / (b || 1); K.appendChild(card('NSE', nse.toFixed(2), 'shape of the hydrograph (1 = perfect)', nse >= 0.5 ? 'good' : 'bad')); }
      else K.appendChild(card('Model', '–', this.app.results ? 'the loaded run does not cover this period' : 'run the model (or load a run) for this period to compare'));
    }
    renderCleaning(body) {
      const C = this.P.cleaning, Mt = C.methods; const card = h('div', { class: 'calcard calclean' }); body.appendChild(card);
      const left = h('div', { class: 'calmethods' }), right = h('div', { class: 'calresults' }); card.append(left, right);
      const ch = (k) => h('input', { type: 'checkbox', checked: !!Mt[k].on, onchange: (e) => { Mt[k].on = e.target.checked; this.touch(); } });
      const nb = (k, f, w) => h('input', { type: 'number', class: 'cell', value: Mt[k][f], min: 0, style: { width: (w || 46) + 'px' }, onchange: (e) => { Mt[k][f] = +e.target.value; this.touch(); } });
      const row = (...a) => h('label', { class: 'calm' }, ...a);
      left.append(h('div', { class: 'calch' }, h('b', null, 'Data cleaning – methods'), h('span', { class: 'muted' }, 'tick, set, then Run Cleaning')),
        row(ch('spike'), h('b', null, 'Spikes / outliers'), ' – value more than ', nb('spike', 'k'), ' × the median of its neighbours → removed'),
        row(ch('flat'), h('b', null, 'Flat line'), ' (stuck sensor) – same value for ≥ ', nb('flat', 'h'), ' h while it rains → removed'),
        row(ch('range'), h('b', null, 'Out of range'), ' – negative flow or depth, depth above the manhole rim (+ surcharge depth) → removed'),
        row(ch('fill'), h('b', null, 'Fill short gaps'), ' – linear interpolation for gaps ≤ ', nb('fill', 'min'), ' min; longer gaps stay empty and are left out of the scoring'),
        row(ch('shift'), h('b', null, 'Time shift'), ' – constant offset (e.g. daylight saving) found against the loaded model run and corrected'),
        row(ch('smooth'), h('b', null, 'Smoothing'), ' – moving average over ', nb('smooth', 'n'), ' steps (noisy depth / velocity sensors)'),
        row(ch('av'), h('b', null, 'Area–velocity check'), ' – flow ≠ velocity × wetted area by more than ', nb('av', 'pct'), ' % → flagged only'),
        h('div', { class: 'calpad' }, h('button', { class: 'btn primary', onclick: () => this.runCleaning() }, C.ran ? 'Run Cleaning Again' : 'Run Cleaning'), ' ', h('span', { class: 'muted' }, 'The original data are never changed; the cleaning is kept as a layer and can be undone.')));
      const nd = C.results.filter(r => !r.decision).length;
      right.appendChild(h('div', { class: 'calch' }, h('b', null, 'Cleaning results – confirm'), h('span', { class: 'muted' }, !C.ran ? 'not run yet' : C.confirmed ? '✓ confirmed' + (C.confirmedBy ? ' by ' + C.confirmedBy : '') : C.results.length + ' results' + (nd ? ' · ' + nd + ' to decide' : '')), h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn small', disabled: !C.results.length, onclick: () => { C.results.forEach(r => { if (!r.flagOnly) r.decision = 'accept'; }); C.confirmed = false; this.cache.clear(); this.touch(); this.render(); } }, 'Accept All'),
        h('button', { class: 'btn small primary', onclick: () => this.confirmCleaning() }, C.confirmed ? '✓ Confirmed' : 'Confirm Cleaning')));
      const wrap = h('div', { class: 'calscroll', style: { maxHeight: '290px' } }); right.appendChild(wrap); const tbl = h('table', { class: 'caltbl calres' }); wrap.appendChild(tbl);
      tbl.innerHTML = '<tr><th>Monitor</th><th>Method</th><th>Changed</th><th>When</th><th>Decision</th></tr>';
      for (const r of C.results) { const tr = h('tr', { class: r.id === this.sel.res ? 'sel' : '', onclick: (e) => { if (e.target.closest('button')) return; this.sel.res = r.id; this.sel.mon = r.mid; this.sel.v = r.key; this.sel.ev = null; this.sel.win = null; [...tbl.rows].forEach(x => x.classList.toggle('sel', x === tr)); this.renderMonSel(); this.drawChart(); this.charts && this.charts.mc.box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } });
        const dec = r.flagOnly ? h('span', { class: 'muted' }, 'flag only') : h('span', { class: 'calseg' }, ...['accept', 'reject'].map(d => h('button', { class: 'btn small' + (r.decision === d ? ' on ' + d : ''), onclick: () => { r.decision = r.decision === d ? '' : d; C.confirmed = false; this.cache.clear(); this.touch(); this.render(); } }, d === 'accept' ? 'Accept' : 'Reject')));
        tr.append(h('td', null, h('b', null, r.mid), ' ', h('span', { class: 'muted' }, r.var.toLowerCase())), h('td', null, r.method), h('td', { title: r.note || '' }, r.idx ? n0(r.n) + ' values ' + (r.what || '') : r.what || '', r.note ? h('div', { class: 'muted small' }, r.note) : ''), h('td', null, fmtT(r.first)), h('td', null, dec)); tbl.appendChild(tr); }
      if (!C.results.length) tbl.appendChild(h('tr', null, h('td', { colspan: 5, class: 'muted' }, C.ran ? 'Nothing was found to clean.' : 'Run Cleaning to see what would change.')));
      right.appendChild(h('div', { class: 'muted calpad' }, 'Click a row to see the data before and after in the chart above. Confirm Cleaning (after accepting or rejecting each row) opens the data checks and the next step.'));
    }
    renderChecks(body) { const card = h('div', { class: 'calcard calchecks' }); body.appendChild(card); this._checks = card; this.refreshChecks(); }
    refreshChecks() {
      const card = this._checks; if (!card || !card.isConnected) return; card.innerHTML = ''; const C = this.P.cleaning;
      card.appendChild(h('div', { class: 'calch' }, h('b', null, 'Data checks'), h('span', { class: 'muted' }, C.confirmed ? 'on the cleaned data' : 'after the cleaning is confirmed')));
      if (!C.confirmed) { card.appendChild(h('div', { class: 'calpad muted' }, '① Run Cleaning   ② Accept / Reject each result   ③ Confirm Cleaning  →  the checks of the cleaned data appear here.')); }
      else { const L = this.checks(); const g = h('div', { class: 'calchecklist' }); for (const [k, t] of L) g.appendChild(h('div', { class: 'ck ' + k }, h('span', { class: 'ci' }, k === 'ok' ? '✓' : k === 'warn' ? '⚠' : 'ℹ'), t)); card.appendChild(g); }
      card.appendChild(h('div', { class: 'calnext' }, C.confirmed ? '' : h('span', { class: 'muted' }, 'Confirm the data cleaning first. '), h('button', { class: 'btn primary', disabled: !C.confirmed, onclick: () => this.go(2) }, 'Next: Parameters ›')));
    }
  }
  const P_ = (c, k) => c.P.monitors[k];
  // ---- helpers
  function lb(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
  function interp(tx, ty, at) { const out = new Float64Array(at.length); let j = 0; for (let i = 0; i < at.length; i++) { const x = at[i]; while (j < tx.length - 2 && tx[j + 1] < x) j++; if (x < tx[0] || x > tx[tx.length - 1]) { out[i] = NaN; continue; } const a = tx[j], b = tx[j + 1]; out[i] = b > a ? ty[j] + (ty[j + 1] - ty[j]) * (x - a) / (b - a) : ty[j]; } return out; }
  function applyRes(t, v, r, f, inPlace) {
    if (r.shiftSec) { const d = r.shiftSec / 86400; return { t: Float64Array.from(t, x => x + d), v }; }
    const out = inPlace ? v : Float64Array.from(v); const fill = r.method === 'Fill short gaps';
    for (let i = 0; i < r.idx.length; i++) { const k = r.idx[i]; if (fill && isFinite(out[k])) continue; out[k] = r.newv && isFinite(r.newv[i]) ? r.newv[i] * f : NaN; }
    return { t, v: out };
  }
  function resWindow(r, t, step) { if (!r.idx || !r.idx.length) return [t[0], t[t.length - 1]]; const a = t[r.idx[0]]; let b = a; for (let i = 0; i < r.idx.length && t[r.idx[i]] - a < 2; i++) b = t[r.idx[i]]; const pad = Math.max(3 / 24, (b - a) * 0.6); return [a - pad, b + pad]; }
  function rainBetween(s, t0, t1, sh) { if (!s) return 0; let a = lb(s.t, t0 - 1e-9), sum = 0; const st = sh || (s.t.length > 1 ? (s.t[1] - s.t[0]) * 24 : 1 / 12); for (let i = a; i < s.t.length && s.t[i] <= t1 + 1e-9; i++) if (s.v[i] > 0) sum += s.v[i] * st; return sum; }
  function coverage(s, t0, t1, step) { const a = lb(s.t, t0), b = lb(s.t, t1); let n = 0; for (let i = a; i < b; i++) if (isFinite(s.v[i])) n++; const exp = Math.max(1, Math.round((t1 - t0) / step)); return Math.min(1, n / exp); }
  function baseFlow(s, t0) { const a = lb(s.t, t0 - 1), b = lb(s.t, t0); const x = []; for (let i = a; i < b; i++) if (isFinite(s.v[i])) x.push(s.v[i]); return x.length ? median(x) : 0; }
  function volume(s, t0, t1, base) { const a = lb(s.t, t0), b = lb(s.t, t1); let v = 0; for (let i = a + 1; i < b; i++) { const p = s.v[i - 1], q = s.v[i]; if (isFinite(p) && isFinite(q)) v += Math.max(0, (p + q) / 2 - base) * (s.t[i] - s.t[i - 1]); } return v; }
  function groupDays(ds) { const g = []; for (const d of ds) { const l = g[g.length - 1]; if (l && d === l[1] + 1) l[1] = d; else g.push([d, d]); } return g; }
  // observed data store: 'AVOBS1' + header length + JSON + per series Float64 times and Float32 values
  function encodeObs(map) {
    const keys = [...map.keys()]; const hdr = JSON.stringify({ series: keys.map(k => ({ k, n: map.get(k).t.length })) }); const hb = new TextEncoder().encode(hdr);
    let size = 6 + 4 + hb.length; size = Math.ceil(size / 8) * 8; for (const k of keys) { const n = map.get(k).t.length; size += n * 8 + Math.ceil(n * 4 / 8) * 8; }
    const buf = new ArrayBuffer(size); const u8 = new Uint8Array(buf); u8.set(new TextEncoder().encode('AVOBS1'), 0); new DataView(buf).setUint32(6, hb.length, true); u8.set(hb, 10);
    let off = Math.ceil((10 + hb.length) / 8) * 8;
    for (const k of keys) { const s = map.get(k); const n = s.t.length; new Float64Array(buf, off, n).set(s.t); off += n * 8; new Float32Array(buf, off, n).set(s.v); off += Math.ceil(n * 4 / 8) * 8; }
    return buf;
  }
  function decodeObs(buf) {
    const u8 = new Uint8Array(buf); if (new TextDecoder().decode(u8.slice(0, 6)) !== 'AVOBS1') throw new Error('not an observed data file'); const hl = new DataView(buf).getUint32(6, true);
    const hdr = JSON.parse(new TextDecoder().decode(u8.slice(10, 10 + hl))); let off = Math.ceil((10 + hl) / 8) * 8; const map = new Map();
    for (const s of hdr.series) { const t = new Float64Array(buf.slice(off, off + s.n * 8)); off += s.n * 8; const v = new Float32Array(buf.slice(off, off + s.n * 4)); off += Math.ceil(s.n * 4 / 8) * 8; map.set(s.k, { t, v }); }
    return map;
  }
  AV.Calib = Calib;
  AV.openCalibration = function (app) { if (!AV.hasHPS(app)) { AV.needHPS(app, 'Auto Calibration'); return; } app.calib = app.calib || new Calib(app); app.calib.open(); };
})(window.AV);
