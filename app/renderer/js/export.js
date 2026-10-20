// Export Wizard (right dock, like the Avaris Export Wizard): network objects with attributes and results
// to Shapefile, Esri File Geodatabase or CSV.
'use strict';
(function (AV) {
  const h = AV.h;
  const TYPES = ['SUBCATCH', 'JUNCTION', 'OUTFALL', 'STORAGE', 'DIVIDER', 'CONDUIT', 'PUMP', 'ORIFICE', 'WEIR', 'OUTLET'];
  const LABEL = { SUBCATCH: 'Subcatchments', JUNCTION: 'Junctions', OUTFALL: 'Outfalls', STORAGE: 'Storages', DIVIDER: 'Dividers', CONDUIT: 'Conduits', PUMP: 'Pumps', ORIFICE: 'Orifices', WEIR: 'Weirs', OUTLET: 'Outlets' };
  const RT = (type) => type === 'SUBCATCH' ? 'subcatch' : AV.NODE_TYPES.includes(type) ? 'node' : 'link';
  const CODES = { subcatch: ['RAIN', 'SNOW', 'EVAP', 'INFIL', 'RUNOFF', 'GWFLOW', 'GWELEV', 'SOILM'], node: ['DEPTH', 'HEAD', 'VOLUME', 'LATINF', 'TOTINF', 'FLOOD'], link: ['FLOW', 'DEPTH', 'VEL', 'VOLUME', 'CAP'] };

  class ExportPane {
    constructor(app, host) { this.app = app; this.host = host; this.st = { ftype: 'shp', content: 'stats', attrs: true, selOnly: false, types: new Set(TYPES), dir: '', gdb: '', prefix: '', p: 0, p1: 0, p2: 0 }; }
    show() { this.render(); }
    render() {
      const app = this.app, st = this.st, H = this.host; H.innerHTML = '';
      const R = app.results, m = app.model;
      if (!st.dir && app.filePath) st.dir = AV.dirname(app.filePath);
      if (!st.prefix) st.prefix = app.filePath ? AV.basename(app.filePath).replace(/\.inp$/i, '') : 'network';
      if (!st.gdb && st.dir) st.gdb = AV.joinPath(st.dir, st.prefix + '.gdb');
      if (R) { const n = R.meta.nPeriods; st.p = Math.min(st.p || R.period, n - 1); st.p2 = st.p2 ? Math.min(st.p2, n - 1) : n - 1; st.p1 = Math.min(st.p1, st.p2); }
      if (!R && st.content !== 'attrs') st.content = 'attrs';
      if (st.content === 'range' && st.ftype !== 'csv') st.content = R ? 'stats' : 'attrs';
      const re = () => this.render();
      const radio = (name, val, label, disabled, extra) => h('label', { class: 'exrad' + (disabled ? ' dis' : '') }, h('input', { type: 'radio', name, checked: st[name === 'exft' ? 'ftype' : 'content'] === val, disabled: !!disabled, onchange: () => { st[name === 'exft' ? 'ftype' : 'content'] = val; re(); } }), ' ' + label, extra || null);
      const sec = (t, ...kids) => h('div', { class: 'exsec' }, h('div', { class: 'exsech' }, t), h('div', { class: 'exsecb' }, kids));
      const timeSel = (k) => { const s = h('select', { class: 'extime', onchange: () => { st[k] = +s.value; if (k === 'p1' && st.p2 < st.p1) st.p2 = st.p1; if (k === 'p2' && st.p1 > st.p2) st.p1 = st.p2; re(); } }); if (R) { const n = R.meta.nPeriods, step = Math.max(1, Math.ceil(n / 3000)); for (let p = 0; p < n; p += step) s.appendChild(h('option', { value: p }, R.timeLabel(p))); if ((n - 1) % step) s.appendChild(h('option', { value: n - 1 }, R.timeLabel(n - 1))); s.value = st[k]; } s.disabled = !R; return s; };
      // destination
      const dirIn = h('input', { type: 'text', class: 'expath', value: st.ftype === 'gdb' ? st.gdb : st.dir, onchange: (e) => { if (st.ftype === 'gdb') st.gdb = e.target.value.trim(); else st.dir = e.target.value.trim(); } });
      const browse = h('button', { class: 'btn small', title: st.ftype === 'gdb' ? 'Choose an existing file geodatabase (.gdb folder)' : 'Choose the output folder', onclick: async () => { const p = await window.host.openDialog({ folder: true, title: st.ftype === 'gdb' ? 'Choose a File Geodatabase (.gdb)' : 'Output folder', defaultPath: st.ftype === 'gdb' ? (st.gdb ? AV.dirname(st.gdb) : st.dir) : st.dir }); if (!p) return; if (st.ftype === 'gdb') { if (!/\.gdb[\\/]?$/i.test(p)) { AV.alert('Please choose a folder whose name ends with .gdb, or click + to create a new geodatabase.', 'Export'); return; } st.gdb = p.replace(/[\\/]+$/, ''); } else st.dir = p; re(); } }, '…');
      const create = h('button', { class: 'btn small', title: 'Create a new file geodatabase', onclick: async () => { let p = await window.host.saveDialog({ title: 'New File Geodatabase', defaultPath: st.gdb || (st.prefix + '.gdb'), filters: [{ name: 'File Geodatabase', extensions: ['gdb'] }] }); if (!p) return; if (!/\.gdb$/i.test(p)) p += '.gdb'; st.gdb = p; st.newGdb = true; re(); } }, '+');
      const pre = h('input', { type: 'text', class: 'expre', value: st.prefix, onchange: (e) => { st.prefix = e.target.value.trim() || 'network'; } });
      // object types
      const sel = app.selection; const cnt = (t) => { const all = t === 'SUBCATCH' ? [...m.subcatchments.values()] : AV.NODE_TYPES.includes(t) ? [...m.nodes.values()].filter(o => o.type === t) : [...m.links.values()].filter(o => o.type === t); return st.selOnly ? all.filter(o => sel.has(o)).length : all.length; };
      const types = h('div', { class: 'extypes' }, TYPES.map(t => h('label', { class: 'exchk' }, h('input', { type: 'checkbox', checked: st.types.has(t), onchange: (e) => { e.target.checked ? st.types.add(t) : st.types.delete(t); } }), ' ' + LABEL[t], h('span', { class: 'excnt' }, m ? String(cnt(t)) : ''))));
      this.status = h('div', { class: 'exstatus' });
      const body = h('div', { class: 'exbody' },
        sec('File Type', radio('exft', 'shp', 'Shapefile'), radio('exft', 'gdb', 'Geodatabase'), radio('exft', 'csv', 'CSV')),
        sec('Content Type',
          radio('exct', 'attrs', 'Object attributes only'),
          radio('exct', 'stats', 'Statistics', !R),
          radio('exct', 'snap', 'Snapshot Time', !R), st.content === 'snap' ? h('div', { class: 'exindent' }, timeSel('p')) : null,
          radio('exct', 'range', 'Selected Time Range', !R || st.ftype !== 'csv'), st.content === 'range' ? h('div', { class: 'exindent exrange' }, h('span', null, 'From'), timeSel('p1'), h('span', null, 'To'), timeSel('p2')) : null,
          st.content !== 'attrs' && st.content !== 'range' ? h('label', { class: 'exchk' }, h('input', { type: 'checkbox', checked: st.attrs, onchange: (e) => { st.attrs = e.target.checked; } }), ' Include object attributes') : null,
          !R ? h('div', { class: 'exhint' }, 'Run a simulation or load a results file to export results.') : null),
        sec(st.ftype === 'gdb' ? 'Destination Geodatabase' : 'Destination Folder',
          h('div', { class: 'exdest' }, dirIn, st.ftype === 'gdb' ? create : null, browse),
          st.ftype !== 'gdb' ? h('div', { class: 'exdest' }, h('span', { class: 'exlab' }, 'File name prefix'), pre) : null),
        sec('Options',
          h('label', { class: 'exchk' }, h('input', { type: 'checkbox', checked: st.selOnly, onchange: (e) => { st.selOnly = e.target.checked; re(); } }), ' Export only selected objects?'),
          h('div', { class: 'exlab2' }, 'Object Type'), types,
          h('div', { class: 'exbtnrow' }, h('button', { class: 'btn small', onclick: () => { TYPES.forEach(t => st.types.add(t)); re(); } }, 'Select All'), h('button', { class: 'btn small', onclick: () => { st.types.clear(); re(); } }, 'Deselect All'))),
        this.status);
      H.append(h('div', { class: 'ptitle' }, h('span', null, 'Export')), body,
        h('div', { class: 'exfoot' }, this.okBtn = h('button', { class: 'btn primary', onclick: () => this.run() }, 'OK'), h('button', { class: 'btn', onclick: () => app.showRightTab('props') }, 'Cancel')));
    }
    say(t, err) { if (this.status) { this.status.textContent = t; this.status.classList.toggle('err', !!err); } this.app.status(t); }

    // ------------------------------------------------------------------ build tables
    objectsOf(t) {
      const m = this.app.model, sel = this.app.selection;
      const all = t === 'SUBCATCH' ? [...m.subcatchments.values()] : AV.NODE_TYPES.includes(t) ? [...m.nodes.values()].filter(o => o.type === t) : [...m.links.values()].filter(o => o.type === t);
      return this.st.selOnly ? all.filter(o => sel.has(o)) : all;
    }
    geomOf(o) {
      const m = this.app.model;
      if (o.kind === 'NODE') return [[o.x, o.y]];
      if (o.kind === 'LINK') { const a = m.nodes.get(o.from), b = m.nodes.get(o.to); if (!a || !b) return null; return [[[a.x, a.y]].concat(o.verts).concat([[b.x, b.y]])]; }
      if (o.poly.length < 3) return null; return [o.poly.concat([o.poly[0]])];
    }
    // columns: [{key, short (<=10), long, label, type:'N'|'C', get(o)}]
    async columns(t, period) {
      const app = this.app, R = app.results, st = this.st, cols = [];
      if (st.content === 'attrs' || st.attrs) {
        const rows = AV.tableRows(app, t);
        for (const c of rows.cols) { if (c.res) continue; const k = c.k.replace(/^_/, ''); cols.push({ key: 'a_' + c.k, short: k, long: k, label: c.l, type: c.num ? 'N' : 'C', get: c.get }); }
      }
      if (R && (st.content === 'stats' || st.content === 'snap')) {
        const rt = RT(t), nv = R.meta.nVars[rt], names = R.varNames[rt];
        const code = (v) => (CODES[rt] && CODES[rt][v]) || ('P' + (v - (CODES[rt] || []).length + 1));
        const ix = (o) => R.idx[rt].get(o.id);
        if (st.content === 'stats') {
          const S = R.stats[rt];
          for (let v = 0; v < nv; v++) for (const [p, lp, arr] of [['MAX_', 'Max ', S.max], ['MIN_', 'Min ', S.min], ['AVG_', 'Mean ', S.mean]]) {
            cols.push({ key: 'r_' + p + v, short: p + code(v), long: lp + names[v], label: lp + names[v] + ' (' + R.unitsFor(rt, v) + ')', type: 'N', get: (o) => { const i = ix(o); return i === undefined ? '' : arr[i * nv + v]; } });
          }
          if (rt === 'node' && R.nonconv) cols.push({ key: 'r_nc', short: 'NONCONV', long: 'Nonconverging pct', label: 'Nonconverging %', type: 'N', get: (o) => R.nonconv.get(o.id) || 0 });
        } else {
          const snap = await window.host.outSnapshotAll(R.handle, period, rt);
          for (let v = 0; v < nv; v++) cols.push({ key: 'r_' + v, short: code(v), long: names[v], label: names[v] + ' (' + R.unitsFor(rt, v) + ')', type: 'N', get: (o) => { const i = ix(o); return i === undefined ? '' : snap[i * nv + v]; } });
        }
      }
      return cols;
    }
    // unique field names for the target format
    fieldNames(cols, fmt) {
      const used = new Set();
      return cols.map(c => {
        if (fmt === 'shp') { let n = c.short.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'F'; let k = n, i = 1; while (used.has(k.toUpperCase())) k = n.slice(0, 10 - String(i).length - 1) + '_' + i++; used.add(k.toUpperCase()); return k; }
        if (fmt === 'gdb') return AV.GDB.cleanName(c.long, used);
        return c.label;
      });
    }

    // ------------------------------------------------------------------ run
    async run() {
      const app = this.app, st = this.st, R = app.results;
      if (!app.model) return;
      const types = TYPES.filter(t => st.types.has(t) && this.objectsOf(t).length);
      if (!types.length) { AV.alert(st.selOnly ? 'None of the selected object types has selected objects.' : 'No objects of the chosen types.', 'Export'); return; }
      const dest = st.ftype === 'gdb' ? st.gdb : st.dir;
      if (!dest) { AV.alert(st.ftype === 'gdb' ? 'Choose or create a file geodatabase.' : 'Choose an output folder.', 'Export'); return; }
      if (st.ftype === 'gdb' && !/\.gdb$/i.test(dest.replace(/[\\/]+$/, ''))) { AV.alert('The geodatabase path must end with .gdb', 'Export'); return; }
      this.okBtn.disabled = true; const t0 = performance.now();
      try {
        let out;
        if (st.ftype === 'csv' && st.content === 'range') out = await this.runRange(types);
        else if (st.ftype === 'gdb') out = await this.runGdb(types);
        else out = await this.runFiles(types);
        this.say('Exported ' + out.length + ' ' + (st.ftype === 'gdb' ? 'feature class(es)' : 'file(s)') + ' in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s');
        AV.alert((st.ftype === 'gdb' ? 'Written to ' + dest + ':\n\n' : 'Written to ' + dest + ':\n\n') + out.join('\n') + (!app.crsWKT && st.ftype !== 'csv' ? '\n\nThe map has no coordinate system, so none was written. Set one with Basemap ▸ Coordinate System.' : ''), 'Export');
      } catch (e) { this.say('Export failed', true); AV.alert('Export failed:\n\n' + e.message, 'Export'); }
      finally { this.okBtn.disabled = false; }
    }
    async runFiles(types) {
      const st = this.st, out = [];
      await window.host.mkdir(st.dir);
      for (const t of types) {
        this.say('Exporting ' + LABEL[t] + ' …'); await new Promise(r => setTimeout(r, 0));
        const objs = this.objectsOf(t); const cols = await this.columns(t, st.p); const names = this.fieldNames(cols, st.ftype);
        const base = AV.joinPath(st.dir, st.prefix + '_' + LABEL[t].toLowerCase() + (st.content === 'snap' ? '_t' + (st.p + 1) : ''));
        if (st.ftype === 'csv') {
          const geo = t === 'SUBCATCH' ? [] : AV.NODE_TYPES.includes(t) ? ['X', 'Y'] : [];
          const lines = [names.concat(geo).map(AV.csvCell).join(',')];
          if (st.content === 'snap' && this.app.results) lines.unshift('# ' + this.app.results.timeLabel(st.p));
          for (const o of objs) lines.push(cols.map(c => c.get(o)).concat(geo.length ? [o.x, o.y] : []).map(AV.csvCell).join(','));
          await window.host.writeText(base + '.csv', lines.join('\n')); out.push(AV.basename(base + '.csv') + '  (' + objs.length + ')');
        } else {
          const kind = t === 'SUBCATCH' ? 'polygon' : AV.NODE_TYPES.includes(t) ? 'point' : 'line';
          const feats = []; for (const o of objs) { const g = this.geomOf(o); if (!g) continue; const props = {}; cols.forEach(c => { props[c.key] = c.get(o); }); feats.push({ coords: g, props }); }
          if (!feats.length) continue;
          const fields = AV.SHP.fieldsFor(feats.map(f => f.props), cols.map(c => c.key)); fields.forEach((f, i) => { f.name = names[i]; if (cols[i].type === 'C' && f.type === 'N') { f.type = 'C'; f.len = 32; delete f.dc; } });
          const w = AV.SHP.write(kind, feats, fields);
          await window.host.writeBinary(base + '.shp', new Uint8Array(w.shp)); await window.host.writeBinary(base + '.shx', new Uint8Array(w.shx)); await window.host.writeBinary(base + '.dbf', new Uint8Array(w.dbf));
          if (this.app.crsWKT) await window.host.writeText(base + '.prj', this.app.crsWKT);
          await window.host.writeText(base + '.cpg', 'UTF-8');
          out.push(AV.basename(base + '.shp') + '  (' + feats.length + ')');
        }
      }
      return out;
    }
    async runGdb(types) {
      const st = this.st, layers = [];
      if (!await AV.GDB.available()) throw new Error('The GDAL tools needed to write file geodatabases are missing from this installation.');
      for (const t of types) {
        const objs = this.objectsOf(t); const cols = await this.columns(t, st.p); const names = this.fieldNames(cols, 'gdb');
        const kind = t === 'SUBCATCH' ? 'polygon' : AV.NODE_TYPES.includes(t) ? 'point' : 'line';
        const feats = []; for (const o of objs) { const g = this.geomOf(o); if (!g) continue; const props = {}; cols.forEach(c => { props[c.key] = c.get(o); }); feats.push({ coords: g, props }); }
        if (!feats.length) continue;
        layers.push({ name: LABEL[t] + (st.content === 'snap' ? '_T' + (st.p + 1) : ''), alias: LABEL[t], kind, feats, fields: cols.map((c, i) => ({ key: c.key, name: names[i], type: c.type })) });
      }
      const done = await AV.GDB.write(st.gdb.replace(/[\\/]+$/, ''), layers, this.app.crsWKT, (i, n) => this.say('Writing ' + n + ' (' + (i + 1) + '/' + layers.length + ') …'));
      return done.map(n => n + '  (' + layers.find(l => l.name === n).feats.length + ')');
    }
    async runRange(types) {
      const st = this.st, R = this.app.results, out = [];
      await window.host.mkdir(st.dir);
      const byRt = {}; for (const t of types) (byRt[RT(t)] = byRt[RT(t)] || []).push(t);
      for (const rt in byRt) {
        const nv = R.meta.nVars[rt], names = R.varNames[rt].slice(0, nv);
        const objs = byRt[rt].flatMap(t => this.objectsOf(t)).map(o => [o, R.idx[rt].get(o.id)]).filter(x => x[1] !== undefined);
        if (!objs.length) continue;
        const lines = [['DateTime', 'Hours', 'ID', 'Type'].concat(names.map((n, v) => n + ' (' + R.unitsFor(rt, v) + ')')).map(AV.csvCell).join(',')];
        const n = st.p2 - st.p1 + 1;
        for (let p = st.p1; p <= st.p2; p++) {
          if ((p - st.p1) % 25 === 0) { this.say('Exporting ' + rt + ' time steps ' + (p - st.p1 + 1) + '/' + n + ' …'); await new Promise(r => setTimeout(r, 0)); }
          const a = await window.host.outSnapshotAll(R.handle, p, rt); const tl = R.timeLabel(p), hr = R.times[p].toFixed(4);
          for (const [o, i] of objs) { const row = [tl, hr, o.id, o.type || 'SUBCATCH']; for (let v = 0; v < nv; v++) row.push(a[i * nv + v]); lines.push(row.map(AV.csvCell).join(',')); }
        }
        const f = AV.joinPath(st.dir, st.prefix + '_' + (rt === 'subcatch' ? 'subcatchments' : rt + 's') + '_t' + (st.p1 + 1) + '-' + (st.p2 + 1) + '.csv');
        await window.host.writeText(f, lines.join('\n')); out.push(AV.basename(f) + '  (' + objs.length + ' objects × ' + n + ' steps)');
      }
      return out;
    }
  }
  AV.ExportPane = ExportPane;
})(window.AV);
