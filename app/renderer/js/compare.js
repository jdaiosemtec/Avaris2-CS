// Scenario Comparison (in the spirit of InfoWorks ICM "compare results" and PCSWMM's scenario manager):
// system KPI cards, a difference table with status (new flooding / resolved / worse / better), a Base-vs-Compare scatter
// plot, a difference theme on the map and overlaid hydrographs.
'use strict';
(function (AV) {
  const h = AV.h;
  const num = (x) => { const v = parseFloat(x); return isFinite(v) ? v : null; };

  // ---------------------------------------------------------------- data access per results source
  async function prep(res, app) {
    if (app && app.mesh2d && AV.has2D(app) && AV.meshStatsFor && res._m2d === undefined) { try { await AV.meshStatsFor(app, res); } catch (e) { } if (!res._m2d) res._m2d = null; }
    if (!res.stats) res.stats = await AV.busy.track(window.host.outStatsAll(res.handle), 'Reading the results (statistics)');
    if (res._tables === undefined) {
      let t = res.reportText; if (t === undefined) { try { t = await window.host.readText(res.rpt || res.meta.file.replace(/\.out$/i, '.rpt')); } catch (e) { t = ''; } res.reportText = t; }
      res._tables = AV.parseReportTables(t || ''); res._tmap = {};
    }
    if (res.runMeta === undefined) { res.runMeta = null; const f = res.outFile || (res.meta && res.meta.file); if (f) { try { res.runMeta = JSON.parse(await window.host.readText(f.replace(/\.f?out$/i, '.json'))); } catch (e) { } } }
    return res;
  }
  const stat = (res, t, id, v, kind) => { const i = res.idx[t].get(id); if (i === undefined) return null; const nv = res.meta.nVars[t]; if (v >= nv) return null; return res.stats[t][kind || 'max'][i * nv + v]; };
  // report table column as Map id -> number (cached)
  const tcol = (res, title, col) => {
    const k = title + '|' + col; if (res._tmap[k]) return res._tmap[k];
    const T = res._tables[title]; const m = new Map();
    if (T) { const ci = T.cols.indexOf(col); if (ci >= 0) for (const r of T.rows) { const v = num(r[ci]); if (v !== null) m.set(r[0], v); } }
    return (res._tmap[k] = m);
  };
  const rptv = (res, title, col, id, missingZero) => { const m = tcol(res, title, col); return m.has(id) ? m.get(id) : (missingZero ? 0 : null); };

  // dir: -1 lower is better, +1 higher is better, 0 neutral; zero: "0 means none" (status New / Resolved)
  function metrics(app) {
    const m = app.model, si = m.isSI, L = si ? 'm' : 'ft', VOL = si ? '10⁶ L' : '10⁶ gal', D = si ? 'mm' : 'in';
    const U = (res, t, v) => res.unitsFor ? res.unitsFor(t, v) : '';
    return {
      node: [
        { k: 'maxDepth', l: 'Max. Depth', u: () => L, dir: -1, tol: 0.01, get: (r, o) => stat(r, 'node', o.id, 0) },
        { k: 'maxHgl', l: 'Max. HGL', u: () => L, dir: -1, tol: 0.01, get: (r, o) => stat(r, 'node', o.id, 1) },
        { k: 'freeboard', l: 'Min. Freeboard (rim − max HGL)', u: () => L, dir: 1, tol: 0.01, get: (r, o) => { if (o.type === 'OUTFALL') return null; const hg = stat(r, 'node', o.id, 1); return hg === null ? null : +o.p.elev + (+o.p.maxDepth || 0) - hg; } },
        { k: 'floodVol', l: 'Total Flood Volume', u: () => VOL, dir: -1, tol: 0.0005, zero: true, get: (r, o) => r.idx.node.has(o.id) ? rptv(r, 'Node Flooding Summary', 'Total Flood Volume', o.id, true) : null },
        { k: 'floodHrs', l: 'Hours Flooded', u: () => 'hr', dir: -1, tol: 0.01, zero: true, get: (r, o) => r.idx.node.has(o.id) ? rptv(r, 'Node Flooding Summary', 'Hours Flooded', o.id, true) : null },
        { k: 'floodRate', l: 'Max. Flooding Rate', u: (r) => U(r, 'node', 5), dir: -1, tol: 0.0005, zero: true, get: (r, o) => stat(r, 'node', o.id, 5) },
        { k: 'surHrs', l: 'Hours Surcharged', u: () => 'hr', dir: -1, tol: 0.01, zero: true, get: (r, o) => r.idx.node.has(o.id) ? rptv(r, 'Node Surcharge Summary', 'Hours Surcharged', o.id, true) : null },
        { k: 'maxInflow', l: 'Max. Total Inflow', u: (r) => U(r, 'node', 4), dir: 0, tol: 0.001, get: (r, o) => stat(r, 'node', o.id, 4) },
      ],
      link: [
        { k: 'maxFlow', l: 'Max. |Flow|', u: (r) => U(r, 'link', 0), dir: 0, tol: 0.001, get: (r, o) => stat(r, 'link', o.id, 0, 'absmax') },
        { k: 'maxVel', l: 'Max. |Velocity|', u: (r) => U(r, 'link', 2), dir: 0, tol: 0.01, get: (r, o) => stat(r, 'link', o.id, 2, 'absmax') },
        { k: 'maxDD', l: 'Max. Depth / Full Depth', u: () => '-', dir: -1, tol: 0.01, get: (r, o) => stat(r, 'link', o.id, 4) },
        { k: 'qqf', l: 'Max. Flow / Full Flow', u: () => '-', dir: -1, tol: 0.01, get: (r, o) => r.idx.link.has(o.id) ? rptv(r, 'Link Flow Summary', 'Max/Full Flow', o.id, false) : null },
        { k: 'surBoth', l: 'Hours Surcharged (both ends full)', u: () => 'hr', dir: -1, tol: 0.01, zero: true, get: (r, o) => o.type === 'CONDUIT' && r.idx.link.has(o.id) ? rptv(r, 'Conduit Surcharge Summary', 'Hours Both Ends Full', o.id, true) : null },
        { k: 'capLim', l: 'Hours Capacity Limited', u: () => 'hr', dir: -1, tol: 0.01, zero: true, get: (r, o) => o.type === 'CONDUIT' && r.idx.link.has(o.id) ? rptv(r, 'Conduit Surcharge Summary', 'Hours Capacity Limited', o.id, true) : null },
      ],
      subcatch: [
        { k: 'peakQ', l: 'Peak Runoff', u: (r) => U(r, 'subcatch', 4), dir: -1, tol: 0.0005, get: (r, o) => stat(r, 'subcatch', o.id, 4) },
        { k: 'runDepth', l: 'Total Runoff (depth)', u: () => D, dir: -1, tol: 0.01, get: (r, o) => r.idx.subcatch.has(o.id) ? rptv(r, 'Subcatchment Runoff Summary', 'Total Runoff (depth)', o.id, false) : null },
        { k: 'runVol', l: 'Total Runoff (volume)', u: () => VOL, dir: -1, tol: 0.0005, get: (r, o) => r.idx.subcatch.has(o.id) ? rptv(r, 'Subcatchment Runoff Summary', 'Total Runoff (volume)', o.id, false) : null },
        { k: 'coef', l: 'Runoff Coefficient', u: () => '-', dir: -1, tol: 0.001, get: (r, o) => r.idx.subcatch.has(o.id) ? rptv(r, 'Subcatchment Runoff Summary', 'Runoff Coeff', o.id, false) : null },
        { k: 'infil', l: 'Total Infiltration', u: () => D, dir: 0, tol: 0.01, get: (r, o) => r.idx.subcatch.has(o.id) ? rptv(r, 'Subcatchment Runoff Summary', 'Total Infil', o.id, false) : null },
      ],
      cell: [
        { k: 'c_maxd', f: 'maxd', l: 'Max. Depth', u: () => L, dir: -1, tol: si ? 0.05 : 0.15, zero: true, flood: true },
        { k: 'c_maxv', f: 'maxv', l: 'Max. Velocity', u: () => si ? 'm/s' : 'ft/s', dir: -1, tol: si ? 0.05 : 0.15 },
        { k: 'c_hr', f: 'maxhr', l: 'Max. Hazard Rating', u: () => '-', dir: -1, tol: 0.1, zero: true },
        { k: 'c_dv', f: 'maxdv', l: 'Max. Depth x Velocity', u: () => si ? 'm²/s' : 'ft²/s', dir: -1, tol: si ? 0.05 : 0.5 },
        { k: 'c_arr', f: 'arrive', l: 'Flood Arrival Time', u: () => 'hr', dir: 1, tol: 0.1 },
        { k: 'c_tpond', f: 'tpond', l: 'Time Ponded', u: () => 'hr', dir: -1, tol: 0.1, zero: true },
      ].map(x => Object.assign(x, { get: (r, o) => { const st = r._m2d && r._m2d.st; if (!st || !st[x.f]) return null; const v = st[x.f][o.k]; return isFinite(v) ? v : null; } })),
      outfall: [
        { k: 'ofMax', l: 'Outfall Max. Flow', u: (r) => U(r, 'node', 4), dir: 0, tol: 0.001, get: (r, o) => r.idx.node.has(o.id) ? rptv(r, 'Outfall Loading Summary', 'Max Flow', o.id, false) : null },
        { k: 'ofVol', l: 'Outfall Total Volume', u: () => VOL, dir: 0, tol: 0.001, get: (r, o) => r.idx.node.has(o.id) ? rptv(r, 'Outfall Loading Summary', 'Total Volume', o.id, false) : null },
      ],
    };
  }
  const LAYER = { node: 'node', outfall: 'node', link: 'link', subcatch: 'sub', cell: 'mesh' };
  const cellObjs = (app) => { const mesh = app.mesh2d; if (!mesh) return []; if (!mesh._cmpObjs) Object.defineProperty(mesh, '_cmpObjs', { value: mesh.cells.map((c, k) => ({ id: c.id, kind: 'CELL', cell: c, k })), enumerable: false }); return mesh._cmpObjs; };
  const OBJS = (m, t, app) => t === 'cell' ? cellObjs(app) : t === 'node' ? [...m.nodes.values()] : t === 'outfall' ? [...m.nodes.values()].filter(n => n.type === 'OUTFALL') : t === 'link' ? [...m.links.values()] : [...m.subcatchments.values()];

  // system KPIs from the report
  function kpis(res, si) {
    const t = res.reportText || ''; const g = (re) => { const x = re.exec(t); return x ? parseFloat(x[1]) : null; };
    const vol = (name) => g(new RegExp('Flow Routing Continuity[\\s\\S]*?' + name + ' \\.+\\s+-?[\\d.]+\\s+(-?[\\d.]+)'));
    const T = res._tables; const cnt = (title, col) => { const tb = T[title]; if (!tb) return /No (nodes|conduits) were/.test(t) ? 0 : (t ? 0 : null); const ci = col ? tb.cols.indexOf(col) : -1; return tb.rows.filter(r => ci < 0 || (num(r[ci]) || 0) > 0).length; };
    const VOL = si ? '10⁶ L' : '10⁶ gal';
    return [
      { k: 'flood', l: 'Total flood volume', u: VOL, v: vol('Flooding Loss'), dir: -1 },
      { k: 'nflood', l: 'Flooded nodes', u: '', v: cnt('Node Flooding Summary'), dir: -1, int: true },
      { k: 'nsurN', l: 'Surcharged nodes', u: '', v: cnt('Node Surcharge Summary'), dir: -1, int: true },
      { k: 'nsurC', l: 'Surcharged conduits', u: '', v: cnt('Conduit Surcharge Summary', 'Hours Both Ends Full'), dir: -1, int: true },
      { k: 'out', l: 'Outfall volume', u: VOL, v: vol('External Outflow'), dir: 0 },
      { k: 'runoff', l: 'Surface runoff', u: si ? 'ha·m' : 'ac·ft', v: g(/Runoff Quantity Continuity[\s\S]*?Surface Runoff \.+\s+(-?[\d.]+)/), dir: -1 },
      { k: 'cerr', l: 'Flow continuity error', u: '%', v: g(/Flow Routing Continuity[\s\S]*?Continuity Error \(%\) \.+\s+(-?[\d.]+)/), dir: 0 },
      { k: 'time', l: 'Run time', u: 's', v: res.runMeta && res.runMeta.seconds !== undefined ? res.runMeta.seconds : null, dir: -1 },
    ];
  }

  class ScenarioCompare {
    constructor(app) { this.app = app; this.type = 'node'; this.mk = 'maxHgl'; this.onlyChanged = true; this.filter = null; this.sortK = 'absd'; this.sortDir = -1; }
    // every run of this model (Database) can be chosen; base and compare must be of the same kind (1D / 1D-2D).
    // The chosen pair is also what the graph windows show (app.sim.pick).
    async listRuns() {
      const app = this.app; const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
      let runs = []; try { runs = app.filePath ? (await AV.listRuns(app.filePath)).filter(r => r.out) : []; } catch (e) { runs = []; }
      runs = runs.map(r => ({ name: r.name, out: r.out, rpt: r.rpt, is2D: !!r.is2D, mtime: r.mtime }));
      // results that are loaded but not in the results folder (opened from elsewhere)
      for (const s of app.sim.sources(true)) { const f = s.res.outFile || (s.res.meta && s.res.meta.file); const e = runs.find(r => norm(r.out) === norm(f));
        if (e) e.res = s.res; else runs.unshift({ name: s.name, out: f, rpt: s.res.rpt, is2D: /\.fout$/i.test(f || ''), res: s.res }); }
      const cf = norm(app.results && (app.results.outFile || app.results.meta.file)); for (const r of runs) { r.current = !!cf && norm(r.out) === cf; if (r.current) r.res = app.results; }
      return runs;
    }
    async open() {
      const app = this.app; app.status('Preparing comparison …');
      this.runs = await this.listRuns();
      if (this.runs.length < 2) { AV.alert('Run the model at least twice (or load two results) first: the comparison needs two runs of this model.', 'Scenario Comparison'); return; }
      const cur = this.runs.find(r => r.current);
      if (!this.base || !this.runs.some(r => r.name === this.base)) this.base = (this.wantCurAsCmp ? null : cur && cur.name) || this.runs[0].name;
      if (this.wantCurAsCmp && cur && cur.name !== this.base) this.cmp = cur.name; this.wantCurAsCmp = false;
      if (!this.fixPair()) { AV.alert('There is no other ' + (this.runOf(this.base).is2D ? '1D-2D' : '1D') + ' run to compare ' + this.base + ' with.', 'Scenario Comparison'); }
      await this.loadPair();
      if (!this.el) { this.el = h('div', { class: 'cmpview' }); app.addView('cmp', 'Scenario Comparison', this.el, { onClose: () => { this.el = null; this.clearMap(); app.sim.pick = null; this.refreshGraphs(); } }); }
      else app.activateView('cmp');
      this.render(); app.status('Scenario comparison ready.');
    }
    runOf(name) { return this.runs.find(r => r.name === name); }
    // compare = a run of the same kind as the base (1D with 1D, 1D-2D with 1D-2D)
    fixPair() {
      const b = this.runOf(this.base); const ok = (r) => r && r.name !== this.base && r.is2D === b.is2D;
      if (ok(this.runOf(this.cmp))) return true;
      const c = this.runs.find(r => ok(r) && r.current) || this.runs.find(ok); this.cmp = c ? c.name : null; return !!c;
    }
    async loadPair() {
      const app = this.app;
      for (const name of [this.base, this.cmp]) { const r = this.runOf(name); if (!r || r.res) continue;
        const ex = app.sim.scen.find(s => String(s.outFile || '').toLowerCase() === String(r.out).toLowerCase());
        r.res = ex || await app.sim.loadScenario(r.out, r.rpt || r.out.replace(/\.fout$/i, '.frpt').replace(/\.out$/i, '.rpt'), r.name); }
      for (const r of this.runs) if (r.res) await prep(r.res, app);
      this.srcs = this.runs.filter(r => r.res).map(r => ({ name: r.name, res: r.res }));
      const B = this.runOf(this.base), C = this.runOf(this.cmp);
      app.sim.pick = B && B.res && C && C.res ? [{ name: B.name, res: B.res }, { name: C.name, res: C.res }] : null;
      this.refreshGraphs();
    }
    refreshGraphs() { const f = this.app.feat; for (const g of (f && f.graphs) || []) { try { g.render(); } catch (e) { } } }
    async choose(key, name) {
      this[key] = name; if (key === 'base') this.fixPair(); else if (this.cmp === this.base) { const o = this.runs.find(r => r.name !== name && r.is2D === this.runOf(name).is2D); this.base = o ? o.name : this.base; }
      this.app.status('Loading ' + name + ' …'); await this.loadPair(); this._all = null; this.render(); this.app.status('Scenario comparison ready.');
    }
    get M() { return metrics(this.app)[this.type]; }
    has2D() { return !!(this.app.mesh2d && this.srcs && this.src(this.base)._m2d && this.src(this.cmp)._m2d); }
    get metric() { return this.M.find(x => x.k === this.mk) || this.M[0]; }
    src(name) { return this.srcs.find(s => s.name === name).res; }
    rows() {
      const mt = this.metric, B = this.src(this.base), C = this.src(this.cmp); const tol = this.tol !== undefined && this.tol !== null ? this.tol : mt.tol;
      const out = [];
      for (const o of OBJS(this.app.model, this.type, this.app)) {
        const b = mt.get(B, o), c = mt.get(C, o); if (b === null && c === null) continue;
        const d = b !== null && c !== null ? c - b : null; const pct = d !== null && Math.abs(b) > 1e-9 ? 100 * d / Math.abs(b) : null;
        let st;
        if (b === null || c === null) st = 'missing';
        else if (mt.zero && b <= tol && c > tol) st = 'new';
        else if (mt.zero && b > tol && c <= tol) st = 'resolved';
        else if (Math.abs(d) <= tol) st = 'same';
        else st = mt.dir === 0 ? (d > 0 ? 'up' : 'down') : (d * mt.dir > 0 ? 'better' : 'worse');
        out.push({ o, b, c, d, pct, st });
      }
      return out;
    }
    render() {
      const app = this.app, E = this.el; E.innerHTML = '';
      const lbl = (r) => r.name + '  (' + (r.is2D ? '1D-2D' : '1D') + (r.current ? ', current' : '') + ')';
      const selS = (key) => { const bs = this.runOf(this.base); const list = key === 'base' ? this.runs : this.runs.filter(r => r.name !== this.base && r.is2D === (bs && bs.is2D));
        const s = h('select', { title: key === 'base' ? 'Any run of this model' : 'Runs of the same kind as the base (' + (bs && bs.is2D ? '1D-2D' : '1D') + ')', onchange: () => this.choose(key, s.value) }, list.map(r => h('option', { value: r.name }, lbl(r)))); s.value = this[key] || ''; return s; };
      if (!this.cmp || !this.runOf(this.cmp) || !this.runOf(this.cmp).res) { E.appendChild(h('div', { class: 'cmpbar' }, h('span', { class: 'cmpsw' }, h('span', { class: 'cmpdot b' }), 'Base', selS('base')), h('span', { class: 'note', style: { color: 'var(--warn)' } }, 'No other ' + (this.runOf(this.base).is2D ? '1D-2D' : '1D') + ' run of this model to compare with.'))); return; }
      const typeS = h('select', { onchange: () => { this.type = typeS.value; this.mk = this.M[0].k; this.tol = null; this.filter = null; this.render(); } }, [['node', 'Nodes'], ['link', 'Links'], ['subcatch', 'Subcatchments'], ['outfall', 'Outfalls']].concat(this.has2D() ? [['cell', '2D Cells']] : []).map(([v, l]) => h('option', { value: v }, l))); if (this.type === 'cell' && !this.has2D()) { this.type = 'node'; this.mk = this.M[0].k; } typeS.value = this.type;
      const B = this.src(this.base), C = this.src(this.cmp); const mt = this.metric; const unit = mt.u(B);
      const metS = h('select', { onchange: () => { this.mk = metS.value; this.tol = null; this.filter = null; this.render(); } }, this.M.map(x => h('option', { value: x.k }, x.l))); metS.value = mt.k;
      const tolI = h('input', { type: 'number', step: 'any', min: 0, value: this.tol !== undefined && this.tol !== null ? this.tol : mt.tol, style: { width: '72px' }, title: 'Differences smaller than this count as "no change"', onchange: () => { this.tol = Math.max(0, +tolI.value || 0); this.render(); } });
      const only = h('input', { type: 'checkbox', checked: this.onlyChanged, onchange: () => { this.onlyChanged = only.checked; this.render(); } });
      E.appendChild(h('div', { class: 'cmpbar' },
        h('span', { class: 'cmpsw' }, h('span', { class: 'cmpdot b' }), 'Base', selS('base')), h('button', { class: 'btn small', title: 'Swap base and compare', onclick: async () => { [this.base, this.cmp] = [this.cmp, this.base]; await this.loadPair(); this.render(); } }, '⇄'), h('span', { class: 'cmpsw' }, h('span', { class: 'cmpdot c' }), 'Compare', selS('cmp')),
        h('span', { class: 'cmpsep' }), typeS, metS, h('label', null, 'Tolerance ', tolI, ' ' + unit), h('label', null, only, ' Changed only'),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn small primary', title: 'Colour the map by the difference (Compare − Base)', onclick: () => this.showOnMap() }, 'Difference on Map'),
        h('button', { class: 'btn small', onclick: () => this.clearMap() }, 'Clear Map'),
        h('button', { class: 'btn small', title: 'Hydrographs of the selected objects for every scenario', onclick: () => this.graph() }, 'Graph Selected'),
        h('button', { class: 'btn small', onclick: () => this.exportCSV() }, 'Export CSV')));
      // ---- KPI cards
      const kb = kpis(B, app.model.isSI), kc = kpis(C, app.model.isSI);
      const cards = h('div', { class: 'cmpkpis' });
      kb.forEach((k, i) => {
        const b = k.v, c = kc[i].v; const d = b !== null && c !== null ? c - b : null; const p = d !== null && Math.abs(b) > 1e-9 ? 100 * d / Math.abs(b) : null;
        const cls = d === null || Math.abs(d) < 1e-9 ? 'same' : k.dir === 0 ? 'neutral' : (d * k.dir > 0 ? 'better' : 'worse');
        const f = (v) => v === null ? '–' : k.int ? String(Math.round(v)) : AV.fmt(v, 3);
        cards.appendChild(h('div', { class: 'cmpkpi ' + cls }, h('div', { class: 'kl' }, k.l + (k.u ? ' (' + k.u + ')' : '')),
          h('div', { class: 'kv' }, h('span', { class: 'kb' }, f(b)), h('span', { class: 'ka' }, '→'), h('span', { class: 'kc' }, f(c))),
          h('div', { class: 'kd' }, d === null ? '' : (d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= ') + (k.int ? Math.round(d) : AV.fmt(d, 3)) + (p !== null && isFinite(p) && Math.abs(d) > 1e-9 ? '  (' + (p > 0 ? '+' : '') + p.toFixed(1) + ' %)' : ''))));
      });
      if (this.has2D()) E.appendChild(this.kpi2D(B, C));
      E.appendChild(cards);
      // ---- rows + summary chips
      const all = this.rows(); this._all = all;
      const C0 = { new: 0, resolved: 0, worse: 0, better: 0, up: 0, down: 0, same: 0, missing: 0 }; for (const r of all) C0[r.st]++;
      const LBL = { new: mt.zero ? 'New ' + (mt.flood || /flood/i.test(mt.l) ? 'flooding' : 'occurrence') : 'New', resolved: 'Resolved', worse: 'Worse', better: 'Better', up: 'Increased', down: 'Decreased', same: 'No change', missing: 'Not in both' };
      const chips = h('div', { class: 'cmpchips' }, Object.keys(LBL).filter(k => C0[k]).map(k => h('span', { class: 'cmpchip st-' + k + (this.filter === k ? ' on' : ''), title: 'Show only these', onclick: () => { this.filter = this.filter === k ? null : k; this.render(); } }, LBL[k] + ' ', h('b', null, String(C0[k])))));
      let rows = all.filter(r => this.filter ? r.st === this.filter : (!this.onlyChanged || (r.st !== 'same')));
      const key = { id: (r) => r.o.id, b: (r) => r.b, c: (r) => r.c, d: (r) => r.d, absd: (r) => r.d === null ? -1 : Math.abs(r.d), pct: (r) => r.pct, st: (r) => r.st }[this.sortK];
      rows.sort((x, y) => { const a = key(x), b = key(y); if (a === b) return 0; if (a === null || a === undefined) return 1; if (b === null || b === undefined) return -1; return (a < b ? -1 : 1) * this.sortDir; });
      this._rows = rows;
      const maxD = Math.max(1e-12, ...rows.map(r => Math.abs(r.d || 0)));
      const LIMIT = 3000;
      const th = (k, l) => h('th', { class: this.sortK === k ? 'sorted' : '', onclick: () => { if (this.sortK === k) this.sortDir *= -1; else { this.sortK = k; this.sortDir = k === 'id' ? 1 : -1; } this.render(); } }, l + (this.sortK === k ? (this.sortDir > 0 ? ' ▲' : ' ▼') : ''));
      const tb = h('tbody');
      for (const r of rows.slice(0, LIMIT)) {
        const w = r.d === null ? 0 : Math.abs(r.d) / maxD * 50;
        const bar = h('div', { class: 'cmpbarcell' }, h('div', { class: 'cmpmid' }), r.d ? h('div', { class: 'cmpfill st-' + r.st, style: r.d > 0 ? { left: '50%', width: w + '%' } : { left: (50 - w) + '%', width: w + '%' } }) : null);
        const tr = h('tr', { class: this.app.selection.has(r.o) ? 'sel' : '', onclick: (e) => { if (r.o.kind === 'CELL') AV.meshSelect(this.app, [r.o.cell], e.ctrlKey || e.metaKey); else this.app.selectMany([r.o], e.ctrlKey || e.metaKey); AV.$$('tr.sel', tb).forEach(x => x.classList.remove('sel')); tr.classList.add('sel'); }, ondblclick: () => { this.app.activateView('map'); if (r.o.kind === 'CELL') { const c = r.o.cell; this.app.map.zoomToBox({ x1: c.x - 4 * c.s, y1: c.y - 4 * c.s, x2: c.x + 4 * c.s, y2: c.y + 4 * c.s }); } else this.app.map.zoomToObjects([r.o]); } },
          h('td', { class: 'id' }, r.o.id), h('td', null, h('span', { class: 'cmpchip sm st-' + r.st }, LBL[r.st])), h('td', { class: 'n' }, r.b === null ? '–' : AV.fmt(r.b, 3)), h('td', { class: 'n' }, r.c === null ? '–' : AV.fmt(r.c, 3)),
          h('td', { class: 'n d' }, r.d === null ? '–' : (r.d > 0 ? '+' : '') + AV.fmt(r.d, 3)), h('td', { class: 'n' }, r.pct === null || !isFinite(r.pct) ? '–' : (r.pct > 0 ? '+' : '') + r.pct.toFixed(1) + '%'), h('td', null, bar));
        tb.appendChild(tr);
      }
      const table = h('table', { class: 'cmptable' }, h('thead', null, h('tr', null, th('id', 'ID'), th('st', 'Status'), th('b', this.base), th('c', this.cmp), th('d', 'Δ (' + unit + ')'), th('pct', 'Δ %'), th('absd', 'Difference'))), tb);
      const left = h('div', { class: 'cmpleft' }, h('div', { class: 'cmptitle' }, mt.l + ' (' + unit + ') — ' + rows.length + ' of ' + all.length + ' objects' + (rows.length > LIMIT ? ', first ' + LIMIT + ' shown' : '')), chips, h('div', { class: 'cmptwrap' }, table));
      const sc = h('canvas', { class: 'cmpscatter' });
      const right = h('div', { class: 'cmpright' }, h('div', { class: 'cmptitle' }, 'Base vs Compare'), sc, h('div', { class: 'cmpnote' }, 'Points above the 1:1 line are higher in ' + this.cmp + '. Click a point to select the object.'));
      E.appendChild(h('div', { class: 'cmpbody' }, left, right));
      requestAnimationFrame(() => this.scatter(sc, all));
    }
    scatter(c, rows) {
      const W = c.clientWidth || 360, H = c.clientHeight || 360, d = window.devicePixelRatio || 1; c.width = W * d; c.height = H * d; const g = c.getContext('2d'); g.scale(d, d);
      const pts = rows.filter(r => r.b !== null && r.c !== null); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      if (!pts.length) { g.fillStyle = '#90a4ae'; g.fillText('No values', 20, 20); return; }
      let mn = Math.min(...pts.map(r => Math.min(r.b, r.c))), mx = Math.max(...pts.map(r => Math.max(r.b, r.c))); if (mx <= mn) { mx = mn + 1; } const pad = (mx - mn) * 0.05; mn -= pad; mx += pad;
      const L = 46, R = 10, T = 10, B = 34; const X = (v) => L + (v - mn) / (mx - mn) * (W - L - R), Y = (v) => H - B - (v - mn) / (mx - mn) * (H - T - B);
      g.strokeStyle = '#cfd8dc'; g.fillStyle = '#607d8b'; g.font = '10px Segoe UI'; g.lineWidth = 1;
      for (let i = 0; i <= 4; i++) { const v = mn + (mx - mn) * i / 4; g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), H - B); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.textAlign = 'center'; g.fillText(AV.fmt(v, 2), X(v), H - B + 12); g.textAlign = 'right'; g.fillText(AV.fmt(v, 2), L - 4, Y(v) + 3); }
      g.strokeStyle = '#37474f'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(X(mn), Y(mn)); g.lineTo(X(mx), Y(mx)); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#455a64'; g.textAlign = 'center'; g.font = '11px Segoe UI'; g.fillText(this.base + ' (base)', (L + W - R) / 2, H - 6);
      g.save(); g.translate(12, (T + H - B) / 2); g.rotate(-Math.PI / 2); g.fillText(this.cmp + ' (compare)', 0, 0); g.restore();
      const COL = { new: '#d50000', worse: '#ef6c00', better: '#2e7d32', resolved: '#00c853', up: '#1e88e5', down: '#8e24aa', same: 'rgba(120,144,156,.45)' };
      const order = ['same', 'up', 'down', 'better', 'worse', 'resolved', 'new'];
      for (const st of order) { g.fillStyle = COL[st]; for (const r of pts) if (r.st === st) { g.beginPath(); g.arc(X(r.b), Y(r.c), st === 'same' ? 2.2 : 3.2, 0, 7); g.fill(); } }
      c.onclick = (e) => { const rc = c.getBoundingClientRect(); const x = e.clientX - rc.left, y = e.clientY - rc.top; let best = null, bd = 64; for (const r of pts) { const dd = (X(r.b) - x) ** 2 + (Y(r.c) - y) ** 2; if (dd < bd) { bd = dd; best = r; } } if (best) { if (best.o.kind === 'CELL') AV.meshSelect(this.app, [best.o.cell]); else this.app.selectMany([best.o]); this.render(); } };
    }
    // difference theme on the map
    mapValue(o) { const r = this._mapRows && this._mapRows.get(o); return r === undefined ? null : r; }
    showOnMap() {
      if (this.type === 'cell') return this.cellsOnMap();
      const th = this.app.theme, layer = LAYER[this.type]; const mt = this.metric; const all = this._all || this.rows();
      this._mapRows = new Map(all.map(r => [r.o, r.d === null ? null : r.d]));
      const tol = this.tol !== undefined && this.tol !== null ? this.tol : mt.tol; const mx = Math.max(tol * 2, ...all.map(r => Math.abs(r.d || 0)));
      const br = [-mx * 0.5, -tol, tol, mx * 0.5, mx * 1.0001].map(v => +v.toPrecision(4)); br.unshift(+(-mx * 1.0001).toPrecision(4));
      // colours: worse = red, better = green (neutral metrics: blue / purple), no change grey
      const worseUp = mt.dir <= 0; const red = ['#b71c1c', '#ef5350'], grn = ['#1b5e20', '#66bb6a'];
      const neg = mt.dir === 0 ? ['#6a1b9a', '#ba68c8'] : (worseUp ? grn : red), pos = mt.dir === 0 ? ['#64b5f6', '#1565c0'] : (worseUp ? red.slice().reverse() : grn.slice().reverse());
      const cols = [neg[0], neg[1], '#cfd8dc', pos[0], pos[1]];
      const s0 = layer === 'link' ? 1.5 : 3, s1 = layer === 'link' ? 6 : 9;
      const t = { name: 'Δ ' + mt.l + ' (' + this.cmp + ' − ' + this.base + ')', field: 'cmp:' + mt.k, kind: 'continuous', abs: false, nulls: false, enabled: true, legend: true, useColor: true, useSize: true, method: 'manual', ramp: 'Blue-Red', invert: false, n: 5, auto: false, cmp: true,
        ranges: br.slice(1).map((v, i) => ({ v, color: cols[i], size: i === 2 ? (layer === 'link' ? 1.2 : 2.5) : (i === 1 || i === 3 ? (s0 + s1) / 2 : s1), show: true })), nullRow: { color: '#eceff1', size: layer === 'link' ? 1 : 2, show: true } };
      if (layer !== 'node') this._dim = true;
      this.clearMap(true);
      // other themes are switched off while the difference is shown (restored by Clear Map)
      this._off = []; for (const k in th.layers) for (const x of th.layers[k].subs) if (x.enabled) { x.enabled = false; this._off.push(x); }
      th.layers[layer].subs.unshift(t);
      th.invalidate(); this.app.map.redraw(); th.updateLegend && th.updateLegend();
      this.app.activateView('map'); AV.toast('Map coloured by Δ ' + mt.l + '. Remove it with Clear Map (or in Theme).', false, 5000);
    }
    // 2D cells: the 2D Meshes layer shows the difference (compare − base) of the chosen variable
    cellsOnMap() {
      const app = this.app, MR = app.meshResults; if (!MR) { AV.toast('Load the 1D-2D results first.', true); return; }
      const mt = this.metric, all = this._all || this.rows(); const n = app.mesh2d.cells.length; const diff = new Float32Array(n).fill(NaN);
      for (const r of all) if (r.d !== null) diff[r.o.k] = r.d;
      const tol = this.tol !== undefined && this.tol !== null ? this.tol : mt.tol; let mx = 0; for (const v of diff) if (isFinite(v)) mx = Math.max(mx, Math.abs(v)); mx = Math.max(mx, 2 * tol);
      const br = [-mx * 0.5, -tol, tol, mx * 0.25, mx * 0.6].map(v => +v.toPrecision(3));
      const B = this.src(this.base); MR.cmp = { name: this.base, maxd: B._m2d && B._m2d.st ? B._m2d.st.maxd : MR.maxd, diff, label: 'Δ ' + mt.l + ' (' + this.cmp + ' − ' + this.base + ')', unit: mt.u(B), breaks: br, dir: mt.dir };
      const P = app.prefs.mesh2d || (app.prefs.mesh2d = {}); P.field = 'ddepth'; if (P.classes) delete P.classes.ddepth; if (P.ramp) delete P.ramp.ddepth; if (P.invert) P.invert.ddepth = mt.dir > 0;
      app.savePrefs && app.savePrefs(); app._meshRange = null; app.activateView('map'); app.map.redraw(); if (app.flood2d && app.flood2d.el) app.flood2d.render();
      AV.toast('2D Meshes coloured by ' + MR.cmp.label + '. Choose another variable in its Symbology to go back.', false, 6000);
    }
    // the 2D key figures of both runs (highlighted at the top)
    kpi2D(B, C) {
      const app = this.app, cells = app.mesh2d.cells, lf = app.mesh2d.lenFactor || 1, si = AV.meshSI(app); const thr = app.flood2d && app.flood2d.S.thr !== undefined ? app.flood2d.S.thr : AV.meshDefaultBreaks(app, 'maxdepth')[0];
      const ak = si ? 1e-4 : 1 / 43560, au = si ? 'ha' : 'ac', L = si ? 'm' : 'ft', V = si ? 'm/s' : 'ft/s';
      const fig = (R) => { const s = R._m2d.st; let area = 0, n = 0, md = 0, mv = 0, hr75 = 0, hr2 = 0, arr = Infinity, vol = 0;
        for (let k = 0; k < cells.length; k++) { const d = s.maxd[k]; if (!(d >= thr) || !(d > 0)) continue; const a = AV.cellArea(cells[k]) * lf * lf; area += a; n++; vol += a * d; md = Math.max(md, d);
          if (isFinite(s.maxv[k])) mv = Math.max(mv, s.maxv[k]); if (s.maxhr[k] >= 0.75) hr75 += a; if (s.maxhr[k] >= 2) hr2 += a; if (isFinite(s.arrive[k])) arr = Math.min(arr, s.arrive[k]); }
        return { area: area * ak, n, md, mv, hr75: hr75 * ak, hr2: hr2 * ak, arr: isFinite(arr) ? arr : null }; };
      const b = fig(B), c = fig(C);
      const K = [['Flooded area', au, 'area', -1], ['Flooded cells', '', 'n', -1, true], ['Max. depth', L, 'md', -1], ['Max. velocity', V, 'mv', -1], ['Area HR ≥ 0.75', au, 'hr75', -1], ['Area HR ≥ 2 (danger for all)', au, 'hr2', -1], ['Earliest arrival', 'hr', 'arr', 1]];
      const box = h('div', { class: 'cmp2d' }, h('div', { class: 'cmp2dh' }, '2D flood  ·  flooded = max. depth ≥ ' + AV.fmt(thr) + ' ' + L, h('button', { class: 'btn small', style: { marginLeft: 'auto' }, onclick: () => { this.type = 'cell'; this.mk = 'c_maxd'; this.tol = null; this.filter = null; this.render(); } }, 'Compare the 2D cells')));
      const row = h('div', { class: 'cmpkpis' });
      for (const [l, u, key, dir, int] of K) { const x = b[key], y = c[key]; const d = x !== null && y !== null ? y - x : null; const p = d !== null && Math.abs(x) > 1e-9 ? 100 * d / Math.abs(x) : null;
        const cls = d === null || Math.abs(d) < 1e-9 ? 'same' : (d * dir > 0 ? 'better' : 'worse'); const f = (v) => v === null ? '–' : int ? String(v) : AV.fmt(v, 3);
        row.appendChild(h('div', { class: 'cmpkpi k2d ' + cls }, h('div', { class: 'kl' }, l + (u ? ' (' + u + ')' : '')), h('div', { class: 'kv' }, h('span', { class: 'kb' }, f(x)), h('span', { class: 'ka' }, '→'), h('span', { class: 'kc' }, f(y))),
          h('div', { class: 'kd' }, d === null ? '' : (d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= ') + (int ? d : AV.fmt(d, 3)) + (p !== null && isFinite(p) && Math.abs(d) > 1e-9 ? '  (' + (p > 0 ? '+' : '') + p.toFixed(1) + ' %)' : '')))); }
      box.appendChild(row); return box;
    }
    clearMap(keep) { const th = this.app.theme; for (const k in th.layers) th.layers[k].subs = th.layers[k].subs.filter(x => !x.cmp); if (this._off) { for (const x of this._off) x.enabled = true; this._off = null; } if (keep) return; th.invalidate(); this.app.map.redraw(); th.updateLegend && th.updateLegend(); }
    graph() {
      let sel = [...this.app.selection].filter(o => o.kind !== 'GAGE' && o.kind !== 'LABEL');
      if (!sel.length && this._rows && this._rows.length) sel = this._rows.slice(0, 3).map(r => r.o);
      if (!sel.length) { AV.toast('Select objects in the table or on the map first.', true); return; }
      const f = this.app.feat; if (f.graphs && f.graphs.length) { f.graphs[0].objs = sel.slice(0, 10); f.graphs[0].render(); } else f.graphTool(sel.slice(0, 10));
    }
    exportCSV() {
      const mt = this.metric; const u = mt.u(this.src(this.base));
      const lines = [['ID', 'Status', this.base + ' (' + u + ')', this.cmp + ' (' + u + ')', 'Difference (' + u + ')', 'Difference %'].map(AV.csvCell).join(',')];
      for (const r of this._rows || []) lines.push([r.o.id, r.st, r.b, r.c, r.d, r.pct === null ? '' : r.pct.toFixed(2)].map(AV.csvCell).join(','));
      AV.downloadText('# ' + mt.l + ': ' + this.cmp + ' vs ' + this.base + '\n' + lines.join('\n'), 'compare_' + mt.k + '.csv');
    }
  }
  AV.ScenarioCompare = ScenarioCompare;
  // from the 2D Flood Analysis: base = the other run, compare = the current results, 2D cells / max. depth
  AV.openCompare2D = async function (app, baseName) {
    app.cmp = app.cmp || new AV.ScenarioCompare(app); const C = app.cmp;
    C.base = baseName; C.cmp = null; C.wantCurAsCmp = true; C.type = 'cell'; C.mk = 'c_maxd'; C.tol = null; C.filter = null; C.onlyChanged = true;
    await C.open(); app.refreshRibbon && app.refreshRibbon();
  };
  AV.App.prototype.compareScenarios = function () { this.cmp = this.cmp || new AV.ScenarioCompare(this); return this.cmp.open(); };
})(window.AV);
