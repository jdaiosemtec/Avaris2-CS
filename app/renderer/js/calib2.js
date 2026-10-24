// Auto Calibration steps 3–5 (2.8.0): 3 Parameters (groups, ranges, sensitivity), 4 Criteria & Run (standards, weights,
// search: NSGA-II / SCE-UA / DDS over parallel engine runs of the calibration events), 5 Results (options, scorecard,
// charts, diagnosis, parameter changes, apply as user System, report).
// Every candidate is a set of parameter-group values; each one is run for every calibration event with the observed
// (cleaned) rainfall of the mapped rain gauges, and scored against the observed (cleaned) flows and depths.
'use strict';
(function (AV) {
  const h = AV.h; const C = AV.Calib.prototype;
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const n0 = (x) => Number(x).toLocaleString('en-US');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtT = (d) => { const t = AV.swmmToDate(d); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()) + ' ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()); };
  const fmtShort = (d) => { const t = AV.swmmToDate(d); return pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()) + ' ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()); };
  const swDate = (d) => { const t = AV.swmmToDate(d); return pad(t.getUTCMonth() + 1) + '/' + pad(t.getUTCDate()) + '/' + t.getUTCFullYear(); };
  const swTime = (d) => { const t = AV.swmmToDate(Math.round(d * 1440) / 1440); return pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + ':00'; };
  const lb = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
  const median = (a) => { const b = a.filter(isFinite).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
  const chip = (cls, t) => '<span class="cchip ' + cls + '">' + esc(t) + '</span>';
  const scoreCls = (s) => s >= 80 ? 'good' : s >= 50 ? 'mid' : 'bad';

  // ------------------------------------------------------------------ parameters that can be calibrated
  // obj: S = subcatchments, C = conduits; how: factor (× current value of every object) or set (one value for the group)
  const PARAMS = {
    imperv: { l: '% Impervious', obj: 'S', how: 'factor', get: o => +o.p.imperv, put: (o, v) => { o.p.imperv = +clamp(v, 0, 100).toPrecision(6); }, def: [0.8, 1.2], lim: [0.2, 5], from: '± 20 % of GIS value' },
    width: { l: 'Width', obj: 'S', how: 'factor', get: o => +o.p.width, put: (o, v) => { o.p.width = +Math.max(v, 1e-3).toPrecision(6); }, def: [0.5, 2], lim: [0.1, 10], from: 'method uncertainty' },
    slope: { l: '% Slope', obj: 'S', how: 'factor', get: o => +o.p.slope, put: (o, v) => { o.p.slope = +Math.max(v, 1e-4).toPrecision(6); }, def: [0.5, 2], lim: [0.1, 10], from: 'survey / DEM uncertainty' },
    sImp: { l: 'Dstore-Imperv', u: 'D', obj: 'S', how: 'set', get: o => +o.p.sImp, put: (o, v) => { o.p.sImp = +Math.max(v, 0).toPrecision(6); }, def: [0.5, 2.5], defUS: [0.02, 0.1], lim: [0, 10], limUS: [0, 0.4], from: 'literature (paved)' },
    sPerv: { l: 'Dstore-Perv', u: 'D', obj: 'S', how: 'set', get: o => +o.p.sPerv, put: (o, v) => { o.p.sPerv = +Math.max(v, 0).toPrecision(6); }, def: [2.5, 7.5], defUS: [0.1, 0.3], lim: [0, 25], limUS: [0, 1], from: 'literature (lawn / grass)' },
    nImp: { l: 'N-Imperv', obj: 'S', how: 'set', get: o => +o.p.nImp, put: (o, v) => { o.p.nImp = +v.toPrecision(5); }, def: [0.011, 0.024], lim: [0.009, 0.05], from: 'literature (asphalt–concrete)' },
    nPerv: { l: 'N-Perv', obj: 'S', how: 'set', get: o => +o.p.nPerv, put: (o, v) => { o.p.nPerv = +v.toPrecision(5); }, def: [0.05, 0.4], lim: [0.02, 0.8], from: 'literature (grass)' },
    pctZero: { l: '% Zero-Imperv', obj: 'S', how: 'set', get: o => +o.p.pctZero, put: (o, v) => { o.p.pctZero = +clamp(v, 0, 100).toPrecision(5); }, def: [10, 50], lim: [0, 100], from: 'literature' },
    infil1: { l: 'Infiltration 1 (max. rate / suction / CN)', obj: 'S', how: 'factor', get: o => +o.p.i1, put: (o, v) => { o.p.i1 = +Math.max(v, 0).toPrecision(6); }, def: [0.5, 1.5], lim: [0.1, 5], from: 'soil class' },
    infil2: { l: 'Infiltration 2 (min. rate / conductivity)', obj: 'S', how: 'factor', get: o => +o.p.i2, put: (o, v) => { o.p.i2 = +Math.max(v, 0).toPrecision(6); }, def: [0.5, 1.5], lim: [0.1, 5], from: 'soil class' },
    rough: { l: "Manning's n", obj: 'C', how: 'set', get: o => +o.p.rough, put: (o, v) => { o.p.rough = +v.toPrecision(5); }, def: [0.011, 0.016], lim: [0.009, 0.05], from: 'material, age' },
  };
  AV.CALIB_PARAMS = PARAMS;
  const GROUP_BY = [['tag', 'Land use (tag)'], ['soil', 'Soil type / infiltration class'], ['shed', 'Sewershed / monitor catchment'], ['part', 'Partition'], ['poly', 'Polygon layer (choose…)'], ['sel', 'Selected objects'], ['all', 'All objects']];
  // ------------------------------------------------------------------ acceptance criteria (step 4)
  // key: what is checked; apply: flow / depth / all; lo, hi: limits (blank = not checked); unit: % / m / h / ''
  const STD = {
    ciwem: { name: 'CIWEM / WaPUG Code of Practice (UK)', note: 'CIWEM UDG Code of Practice for the Hydraulic Modelling of Urban Drainage Systems (WaPUG). Verification: 2 of 3 events should comply.', rows: [
      ['peak', 'Peak flow (storm)', 'flow', '-15', '25', '%', 1], ['vol', 'Event volume (storm)', 'flow', '-10', '20', '%', 1], ['depthU', 'Peak depth – unsurcharged', 'depth', '-0.10', '0.10', 'm', 1],
      ['depthS', 'Peak depth – surcharged', 'depth', '-0.10', '0.50', 'm', 1], ['timing', 'Timing of peak', 'all', '-1.0', '1.0', 'h', 0.5], ['nse', 'Hydrograph shape (NSE ≥)', 'flow', '0.5', '', '', 0.5],
      ['dwfVol', 'Dry weather volume', 'flow', '-10', '10', '%', 1], ['dwfPeak', 'Dry weather peak', 'flow', '-10', '10', '%', 1]] },
    msdgc: { name: 'US – MSDGC Modeling Guidelines 2013', note: 'Metropolitan Sewer District of Greater Cincinnati Modeling Guidelines (2013), based on WaPUG; depth in large sewers checked as ±15 % because the absolute limits are hard to meet there.', rows: [
      ['peak', 'Peak flow (storm)', 'flow', '-15', '25', '%', 1], ['vol', 'Event volume (storm)', 'flow', '-10', '20', '%', 1], ['depthU', 'Peak depth – pipes ≤ 1.2 m', 'depth', '-0.10', '0.10', 'm', 1],
      ['depthL', 'Peak depth – large pipes', 'depth', '-15', '15', '%', 1], ['timing', 'Timing of peak', 'all', '-1.0', '1.0', 'h', 0.5], ['nse', 'Hydrograph shape (NSE ≥)', 'flow', '0.5', '', '', 0.5],
      ['dwfVol', 'Dry weather volume', 'flow', '-10', '10', '%', 1], ['dwfPeak', 'Dry weather peak', 'flow', '-10', '10', '%', 1]] },
    epa: { name: 'US EPA 1999 CSO Guidance (enter the limits)', note: 'US EPA (1999) Combined Sewer Overflows – Guidance for Monitoring and Modeling: compare total volume, peak flow and hydrograph shape; no numeric limits are given, so enter the values agreed for the project (rows without limits are not scored). 5–10 storms are suggested.', rows: [
      ['peak', 'Peak flow', 'flow', '', '', '%', 1], ['vol', 'Event volume', 'flow', '', '', '%', 1], ['nse', 'Hydrograph shape (NSE ≥)', 'flow', '', '', '', 1], ['depthU', 'Peak depth', 'depth', '', '', 'm', 1]] },
  };
  AV.CALIB_STD = STD;
  const METHODS = [['nsga', 'Multi-objective (NSGA-II) – several options'], ['sce', 'Single score (SCE-UA)'], ['dds', 'Single score (DDS, fast)']];
  const PENALTY = ['None', 'Low', 'Medium', 'High'], LAMBDA = [0, 0.1, 0.25, 0.5];

  // ------------------------------------------------------------------ project defaults
  C.ensure3 = function () {
    const P = this.P;
    if (!P.params) P.params = { groupBy: 'tag', upOnly: true, penalty: 2, rows: [], sens: null };
    if (!P.criteria) P.criteria = { std: this.si ? 'ciwem' : 'msdgc', edit: {} };
    if (!P.weights) P.weights = {};
    if (!P.search) P.search = { method: 'nsga', sims: 200, parallel: 0 };
    if (!P.params.rows.length) this.defaultRows();
  };
  C.pDef = function (k) { const d = PARAMS[k]; return { def: (!this.si && d.defUS) || d.def, lim: (!this.si && d.limUS) || d.lim, unit: d.u === 'D' ? (this.si ? 'mm' : 'in') : '' }; };
  C.newRow = function (group, param, on) {
    const d = PARAMS[param]; const pd = this.pDef(param); const objs = this.groupObjs(group, d.obj);
    let cur = 1; if (d.how === 'set') { const v = objs.map(d.get).filter(isFinite); cur = v.length ? +median(v).toPrecision(4) : pd.def[0]; }
    let mn = pd.def[0], mx = pd.def[1]; if (d.how === 'set') { mn = Math.min(mn, cur); mx = Math.max(mx, cur); }
    return { id: 'r' + Math.random().toString(36).slice(2, 8), on: on !== false, group, param, how: d.how, cur, min: mn, max: mx, reason: d.from, sens: null };
  };
  C.defaultRows = function () {
    const P = this.P, m = this.m; const rows = [];
    const tags = new Map(); for (const s of m.subcatchments.values()) { const t = String(s.tag || '').trim(); if (t) tags.set(t, (tags.get(t) || 0) + 1); }
    const big = [...tags.entries()].filter(e => e[1] >= 5).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (big.length >= 2) for (const [t] of big) rows.push(this.newRow({ by: 'tag', key: t, label: t + ' (tag)' }, 'imperv'));
    else rows.push(this.newRow({ by: 'all', key: '*', label: 'All subcatchments' }, 'imperv'));
    const all = { by: 'all', key: '*', label: 'All subcatchments' };
    rows.push(this.newRow(all, 'width'), this.newRow(all, 'sImp'), this.newRow(all, 'nImp'), this.newRow(all, 'infil1'));
    rows.push(this.newRow({ by: 'all', key: '*', label: 'All conduits' }, 'rough', false));
    P.params.rows = rows;
  };

  // ------------------------------------------------------------------ groups
  C.monCatchments = function () {
    // each node -> the nearest downstream monitor (the smallest monitored catchment that contains it)
    const m = this.m; if (this._mc && this._mc.v === m.version && this._mc.n === this.P.mapping.length) return this._mc.map;
    const into = new Map(); for (const l of m.links.values()) { if (!into.has(l.to)) into.set(l.to, []); into.get(l.to).push(l.from); }
    const sets = []; for (const mon of this.monitorList()) { if (!mon.o || mon.o.kind === 'GAGE') continue; const start = mon.o.kind === 'LINK' ? mon.o.from : mon.o.id; const seen = new Set([start]); const st = [start];
      while (st.length) { const n = st.pop(); for (const f of into.get(n) || []) if (!seen.has(f)) { seen.add(f); st.push(f); } } sets.push([mon.mid, seen]); }
    sets.sort((a, b) => a[1].size - b[1].size); const map = new Map(); for (const [mid, set] of sets) for (const n of set) if (!map.has(n)) map.set(n, mid);
    this._mc = { v: m.version, n: this.P.mapping.length, map }; return map;
  };
  C.subOutletNode = function (s) { const m = this.m; let ot = s.p.outlet, d = 0; while (m.subcatchments.has(ot) && d++ < 20) ot = m.subcatchments.get(ot).p.outlet; return ot; };
  C.objXY = function (o) { if (o.kind === 'SUBCATCH') { if (o.poly && o.poly.length > 2) return AV.polyCentroid(o.poly); const n = this.m.nodes.get(this.subOutletNode(o)); return n ? [n.x, n.y] : null; }
    const a = this.m.nodes.get(o.from), b = this.m.nodes.get(o.to); return a && b ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : null; };
  C.keyOf = function (by, o, aux) {
    if (by === 'all') return '*';
    if (by === 'tag') return String(o.tag || '').trim() || '(no tag)';
    if (by === 'soil') { const p = o.p; return o.kind === 'SUBCATCH' ? [p.i1, p.i2, p.i3].map(v => +(+v).toPrecision(3)).join(' / ') : '*'; }
    if (by === 'shed') { const n = o.kind === 'SUBCATCH' ? this.subOutletNode(o) : o.from; return this.monCatchments().get(n) || '(no monitor)'; }
    if (by === 'part') { const n = o.kind === 'SUBCATCH' ? this.subOutletNode(o) : o.from; return aux && aux.owner ? String(aux.owner[n] === undefined ? '(none)' : aux.owner[n]) : '(no partition)'; }
    if (by === 'poly') { const L = aux && aux.layer; if (!L) return '(no layer)'; const xy = this.objXY(o); if (!xy) return '(outside)';
      for (let i = 0; i < L.features.length; i++) { const f = L.features[i]; if (f.type !== 'polygon') continue; let k = 0; for (const r of f.coords) if (AV.pointInPoly(xy[0], xy[1], r)) k++; if (k % 2) return aux.field && f.props && f.props[aux.field] !== undefined ? String(f.props[aux.field]) : 'Polygon ' + (i + 1); }
      return '(outside)'; }
    return '*';
  };
  C.inUpstream = function (o) { if (!this.P.params.upOnly) return true; const n = o.kind === 'SUBCATCH' ? this.subOutletNode(o) : o.from; return this.monCatchments().has(n); };
  C.groupObjs = function (g, kind) {
    const m = this.m; const src = kind === 'C' ? [...m.links.values()].filter(l => l.type === 'CONDUIT') : [...m.subcatchments.values()];
    if (g.by === 'sel') { const ids = new Set(g.ids || []); return src.filter(o => ids.has(o.id) && this.inUpstream(o)); }
    const aux = g.by === 'part' ? this._part : g.by === 'poly' ? { layer: (this.app.map.extLayers || []).find(L => L.name === g.layer), field: g.field } : null;
    return src.filter(o => this.inUpstream(o) && this.keyOf(g.by, o, aux) === g.key);
  };
  C.loadPartition = async function () { this._part = null; try { const p = this.app.filePath.replace(/\.inp$/i, '.partition.json'); if (await window.host.exists(p)) { const d = JSON.parse(await window.host.readText(p)); if (d && d.assignment) this._part = { owner: d.assignment }; } } catch (e) { } };
  C.addGroupDialog = async function () {
    const P = this.P; const by = P.params.groupBy; let aux = null, layerName = '', field = '';
    if (by === 'part' && !this._part) await this.loadPartition();
    if (by === 'part' && !this._part) { AV.alert('This model has no partition (Tools ▸ Partition Model).', 'Add Group'); return; }
    if (by === 'poly') { const Ls = (this.app.map.extLayers || []).filter(L => !L.raster && L.features && L.features.some(f => f.type === 'polygon'));
      if (!Ls.length) { AV.alert('Add a polygon layer first (Layer View ▸ Add Layer).', 'Add Group'); return; }
      const r0 = await AV.formDialog('Group by polygon layer', [{ k: 'layer', l: 'Layer', t: 'choice', o: Ls.map(L => L.name) }], { layer: Ls[0].name }); if (!r0) return; layerName = r0.layer;
      const L = Ls.find(x => x.name === layerName); const fields = [...new Set(L.features.flatMap(f => Object.keys(f.props || {})))];
      if (fields.length) { const r1 = await AV.formDialog('Group by polygon layer', [{ k: 'field', l: 'Attribute (group name)', t: 'choice', o: fields }], { field: fields[0] }); if (!r1) return; field = r1.field; }
      aux = { layer: L, field }; }
    if (by === 'part') aux = this._part;
    const kind = (k) => PARAMS[k].obj; const pk = Object.keys(PARAMS);
    const sel = by === 'sel' ? [...this.app.selection].filter(o => o.kind === 'SUBCATCH' || (o.kind === 'LINK' && o.type === 'CONDUIT')) : null;
    if (by === 'sel' && !sel.length) { AV.alert('Select subcatchments or conduits on the map first.', 'Add Group'); return; }
    const box = h('div', { style: { width: '520px' } }); const pSel = h('select', null, pk.map(k => h('option', { value: k }, PARAMS[k].l + (PARAMS[k].obj === 'C' ? ' (conduits)' : '')))); const list = h('div', { class: 'calscroll', style: { maxHeight: '260px', border: '1px solid var(--border)', marginTop: '6px' } });
    const keysFor = () => { const k = kind(pSel.value); if (by === 'sel') return [['Selection', sel.filter(o => (k === 'C') === (o.kind === 'LINK')).length]];
      const cnt = new Map(); const src = k === 'C' ? [...this.m.links.values()].filter(l => l.type === 'CONDUIT') : [...this.m.subcatchments.values()]; for (const o of src) { if (!this.inUpstream(o)) continue; const key = this.keyOf(by, o, aux); cnt.set(key, (cnt.get(key) || 0) + 1); }
      return [...cnt.entries()].sort((a, b) => b[1] - a[1]); };
    const fill = () => { list.innerHTML = ''; for (const [k, n] of keysFor()) list.appendChild(h('label', { style: { display: 'block', padding: '3px 8px' } }, h('input', { type: 'checkbox', value: k, checked: n > 0 && keysFor().length <= 3 }), ' ' + (by === 'all' ? (kind(pSel.value) === 'C' ? 'All conduits' : 'All subcatchments') : k), h('span', { class: 'muted' }, '  ' + n + (kind(pSel.value) === 'C' ? ' cond.' : ' subc.')))); };
    pSel.onchange = fill; fill();
    box.append(h('div', { class: 'form' }, h('label', null, 'Group by'), h('b', null, (GROUP_BY.find(g => g[0] === by) || [])[1] + (layerName ? ' – ' + layerName + (field ? ' . ' + field : '') : '')), h('label', null, 'Parameter'), pSel), h('div', { class: 'note', style: { marginTop: '6px' } }, 'Tick the groups: each becomes one row with one value for all of its objects.' + (this.P.params.upOnly ? ' Only objects upstream of a monitor are counted.' : '')), list);
    const r = await AV.modal({ title: '+ Add Group', body: box, buttons: [{ label: 'Cancel', value: null }, { label: 'Add', primary: true, onClick: () => [...list.querySelectorAll('input:checked')].map(i => i.value) }] }).done;
    if (!r || !r.length) return;
    for (const key of r) { const g = { by, key, label: by === 'all' ? (kind(pSel.value) === 'C' ? 'All conduits' : 'All subcatchments') : by === 'sel' ? 'Selection (' + sel.length + ')' : key + (by === 'tag' ? ' (tag)' : by === 'shed' ? ' (catchment)' : by === 'soil' ? ' (infiltration)' : by === 'part' ? ' (partition)' : '') };
      if (by === 'sel') g.ids = sel.map(o => o.id); if (by === 'poly') { g.layer = layerName; g.field = field; }
      this.P.params.rows.push(this.newRow(g, pSel.value)); }
    this.P.params.sens = null; this.touch(); this.render();
  };

  // ------------------------------------------------------------------ events and engine runs
  C.calEvents = function (which) { const L = this.P.events.list.filter(e => which === 'all' ? e.use !== 'Not used' : e.use === (which === 'val' ? 'Validation' : 'Calibration')); return L; };
  C.scored = function () { // monitor variables that are scored: linked, used, weight > 0, flow or depth
    const out = []; for (const mon of this.monitorList()) { if (!mon.o || mon.o.kind === 'GAGE') continue; const w = this.weightOf(mon); if (!(w > 0)) continue;
      for (const v of mon.vars) if (v.use && (v.var === 'Flow' || v.var === 'Depth') && (mon.o.kind === 'LINK' || v.var === 'Depth')) out.push({ mid: mon.mid, key: v.key, var: v.var, o: mon.o, w }); }
    return out;
  };
  C.defaultWeight = function (mid) { const R = this.P.cleaning.results.filter(r => r.mid === mid && r.decision === 'accept' && !r.flagOnly); let w = 1; const ms = new Set(R.map(r => r.method)); for (const k of ms) w -= k === 'Fill short gaps' ? 0.2 : 0.1; return Math.max(0.5, +w.toFixed(2)); };
  C.weightOf = function (mon) { const v = this.P.weights[mon.mid]; return v === undefined ? this.defaultWeight(mon.mid) : +v; };
  C.rainGages = function () { // model rain gage <- observed rainfall key
    const out = []; for (const mon of this.monitorList()) if (mon.o && mon.o.kind === 'GAGE') { const v = mon.vars.find(x => x.var === 'Rainfall' && x.use); if (v) out.push({ gage: mon.o.id, key: v.key, step: v.step || 300 }); }
    return out;
  };
  C.runsDir = function () { return AV.joinPath(this.folder(), 'runs'); };
  C.withModel = function (x, fn) { // apply candidate values x (per calibration row, in row order) temporarily, then fn()
    const rows = this.P.params.rows.filter(r => r.on); const undo = [];
    try {
      rows.forEach((r, i) => { const d = PARAMS[r.param]; const v = x[i]; for (const o of this.groupObjs(r.group, d.obj)) { const old = d.get(o); undo.push([o, Object.assign({}, o.p)]); d.put(o, r.how === 'factor' ? old * v : v); } });
      return fn();
    } finally { for (let i = undo.length - 1; i >= 0; i--) undo[i][0].p = undo[i][1]; }
  };
  C.eventInp = function (ev, x, reportAll) {
    const m = this.m; const gs = this.rainGages(); const sc = this.scored();
    const t0 = ev.dry ? ev.t0 - 0.5 : ev.t0 - 0.5, t1 = ev.dry ? ev.t1 : ev.t1 + 0.5, r0 = ev.dry ? ev.t0 : ev.t0 - 1 / 24;
    const save = { options: Object.assign({}, m.options), report: m.report.slice(), files: m.raw.FILES, gages: new Map([...m.gages].map(([k, g]) => [k, Object.assign({}, g.p)])), ts: new Map(m.timeseries) };
    try {
      Object.assign(m.options, { START_DATE: swDate(t0), START_TIME: swTime(t0), REPORT_START_DATE: swDate(r0), REPORT_START_TIME: swTime(r0), END_DATE: swDate(t1), END_TIME: swTime(t1), THREADS: '1' });
      const rs = Math.max(60, Math.min(AV.hmsToSec(m.options.REPORT_STEP || '00:15:00'), 300)); m.options.REPORT_STEP = AV.secToHms(rs);
      if (m.raw.FILES) m.raw.FILES = m.raw.FILES.filter(l => !/^\s*(USE|SAVE)\s+HOTSTART/i.test(l));
      for (const g of gs) { const G = m.gages.get(g.gage); if (!G) continue; const s = this.series(g.key); const a = lb(s.t, t0 - 1e-6), b = lb(s.t, t1 + 1e-6); const rows = [];
        for (let i = a; i < b; i++) rows.push([swDate(s.t[i]), swTime(s.t[i]).slice(0, 5), isFinite(s.v[i]) ? +s.v[i].toFixed(4) : 0]);
        if (!rows.length) rows.push([swDate(t0), '00:00', 0]);
        const name = 'CAL_' + g.gage.replace(/\W/g, '_'); m.timeseries.set(name, { file: null, rows });
        G.p = Object.assign({}, G.p, { format: 'INTENSITY', interval: AV.secToHms(g.step).slice(0, 5).replace(/^0(\d)/, '$1'), scf: 1, source: 'TIMESERIES', series: name, station: '', units: '' }); }
      if (!reportAll) { const L = [...new Set(sc.filter(s => s.o.kind === 'LINK').map(s => s.o.id))], N = [...new Set(sc.filter(s => s.o.kind === 'NODE').map(s => s.o.id))]; const rep = ['INPUT NO', 'CONTROLS NO', 'SUBCATCHMENTS NONE'];
        if (N.length) for (let i = 0; i < N.length; i += 20) rep.push('NODES ' + N.slice(i, i + 20).join(' ')); else rep.push('NODES NONE');
        if (L.length) for (let i = 0; i < L.length; i += 20) rep.push('LINKS ' + L.slice(i, i + 20).join(' ')); else rep.push('LINKS NONE');
        m.report = rep; }
      return x ? this.withModel(x, () => m.toINP()) : m.toINP();
    } finally { m.options = save.options; m.report = save.report; if (save.files) m.raw.FILES = save.files; for (const [k, p] of save.gages) { const G = m.gages.get(k); if (G) G.p = p; } m.timeseries = save.ts; }
  };
  C.runEvent = async function (ev, x, tag) {
    const dir = this.runsDir(); await window.host.mkdir(dir); const text = AV.runDataPaths(this.eventInp(ev, x), AV.dirname(this.app.filePath), dir);
    const id = 'cal_' + tag; this._running.add(id);
    let res; try { res = await window.host.runEngine({ inpText: text, dir, base: tag, named: true, id }); } finally { this._running.delete(id); }
    if (this._stop) { window.host.rmRun([res.inp, res.rpt, res.out]); throw new Error('stopped'); }
    if (res.code !== 0 || (res.errors && res.errors.length)) { let msg = (res.errors || []).join('; '); try { const rpt = await window.host.readText(res.rpt); const e = rpt.match(/ERROR[^\n]*/g); if (e) msg = e.slice(0, 3).join('; '); } catch (er) { } throw new Error('Event ' + ev.id + ': ' + (msg || 'engine code ' + res.code)); }
    if (res.seconds > 0) { this._nSec = (this._nSec || 0) + 1; this._evSec = ((this._evSec || 0) * (this._nSec - 1) + res.seconds) / this._nSec; }
    const meta = await window.host.outOpen(res.out); const out = { t0: meta.startDate, step: meta.reportStep / 86400, n: meta.nPeriods, s: {}, seconds: res.seconds };
    try { const idx = { link: new Map(meta.ids.link.map((x, i) => [x, i])), node: new Map(meta.ids.node.map((x, i) => [x, i])) };
      for (const s of this.scored()) { const t = s.o.kind === 'LINK' ? 'link' : 'node'; const i = idx[t].get(s.o.id); if (i === undefined) continue; const vi = t === 'link' ? (s.var === 'Flow' ? 0 : 1) : 0;
        out.s[s.key] = Float32Array.from(await window.host.outSeries(meta.handle, t, i, vi)); }
    } finally { await window.host.outClose(meta.handle); window.host.rmRun([res.inp, res.rpt, res.out]); }
    return out;
  };
  // a pool of parallel engine runs
  C.pool = function (n) { let active = 0; const q = []; const next = () => { while (active < n && q.length) { const [fn, ok, ko] = q.shift(); active++; fn().then(ok, ko).finally(() => { active--; next(); }); } };
    return (fn) => new Promise((ok, ko) => { q.push([fn, ok, ko]); next(); }); };
  // evaluate candidates (array of x) on events: returns per candidate { perEvent: {E1: run}, ... } via scoring
  C.evaluate = async function (xs, events, keepSeries) {
    const run = this._pool; let seq = 0;
    return Promise.all(xs.map(x => Promise.all(events.map(ev => run(() => this.runEvent(ev, x, 'c' + (++this._seq) + '_' + ev.id)))).then(runs => {
      const byEv = {}; events.forEach((e, i) => byEv[e.id] = runs[i]); const sc = this.scoreRuns(byEv, events); if (keepSeries) sc.runs = byEv; this._done++; if (this.onEval) sc.e = this.onEval(x, sc); this.onProgress && this.onProgress(); return sc; })));
  };

  // ------------------------------------------------------------------ scoring
  C.critRows = function () { const c = this.P.criteria; const d = STD[c.std]; return d.rows.map((r, i) => { const g = (j) => { const k = c.std + i + '_' + j; return c.edit[k] !== undefined ? c.edit[k] : r[j]; };
      const conv = (v, unit) => v === '' || v === undefined ? NaN : (+String(v).replace('−', '-')) * (unit === 'm' && !this.si ? 3.2808 : 1);
      return { key: r[0], label: r[1], apply: r[2], lo: conv(g(3), r[5]), hi: conv(g(4), r[5]), unit: r[5] === 'm' && !this.si ? 'ft' : r[5], w: +g(6) || 0 }; }); };
  const checkScore = (d, lo, hi) => { if (!isFinite(d)) return null; if (isFinite(lo) && d < lo) return Math.max(0, 1 - (lo - d) / Math.max(Math.abs(lo), 1e-9)); if (isFinite(hi) && d > hi) return Math.max(0, 1 - (d - hi) / Math.max(Math.abs(hi), 1e-9)); return 1; };
  const peakOf = (x, y) => { let m = -Infinity, t = NaN; for (let i = 0; i < y.length; i++) if (y[i] > m) { m = y[i]; t = x[i]; } return { m, t }; };
  const volOf = (x, y) => { let v = 0; for (let i = 1; i < x.length; i++) { const a = y[i - 1], b = y[i]; if (isFinite(a) && isFinite(b)) v += (a + b) / 2 * (x[i] - x[i - 1]); } return v; };
  C.pipeSize = function (o) { // largest conduit full depth at a node (or of the conduit)
    if (this._ps && this._ps.v === this.m.version && this._ps.o === o) return this._ps.d; let d = 0;
    if (o.kind === 'LINK') d = +o.p.g1 || 0; else for (const l of this.m.links.values()) if (l.type === 'CONDUIT' && (l.from === o.id || l.to === o.id)) d = Math.max(d, (+l.p.g1 || 0) + (l.from === o.id ? +l.p.inOff || 0 : +l.p.outOff || 0));
    this._ps = { v: this.m.version, o, d }; return d; };
  // metrics of one monitor variable in one event, observed against one model run
  C.metrics = function (s, ev, run) {
    const obs = this.series(s.key); if (!obs || !run || !run.s[s.key]) return null; const w = ev.dry ? [ev.t0, ev.t1] : this.eventWindow(ev);
    const a = lb(obs.t, w[0]), b = lb(obs.t, w[1]); const ox = [], oy = []; for (let i = a; i < b; i++) if (isFinite(obs.v[i])) { ox.push(obs.t[i]); oy.push(obs.v[i]); }
    if (ox.length < 3) return null;
    const my = run.s[s.key], n = my.length; const mx = new Float64Array(n); for (let i = 0; i < n; i++) mx[i] = run.t0 + (i + 1) * run.step;
    const ma = lb(mx, w[0]), mb = lb(mx, w[1]); const X = Array.from(mx.subarray(ma, mb)), Y = Array.from(my.subarray(ma, mb)); if (X.length < 3) return null;
    const po = peakOf(ox, oy), pm = peakOf(X, Y); const vo = volOf(ox, oy), vm = volOf(X, Y);
    // NSE: model at the observed times
    let j = 0, so = 0, k = 0; const mi = ox.map(t => { while (j < X.length - 2 && X[j + 1] < t) j++; const p = X[j], q = X[j + 1]; return q > p ? Y[j] + (Y[j + 1] - Y[j]) * clamp((t - p) / (q - p), 0, 1) : Y[j]; });
    for (const y of oy) { so += y; k++; } const mean = so / k; let e1 = 0, e2 = 0; for (let i = 0; i < oy.length; i++) { e1 += (oy[i] - mi[i]) ** 2; e2 += (oy[i] - mean) ** 2; }
    return { peakO: po.m, peakM: pm.m, tO: po.t, tM: pm.t, volO: vo, volM: vm, nse: 1 - e1 / (e2 || 1e-12), meanO: vo / Math.max(1e-9, ox[ox.length - 1] - ox[0]), meanM: vm / Math.max(1e-9, X[X.length - 1] - X[0]) };
  };
  C.checksFor = function (s, ev, M, rows) { // [{key, label, d (deviation), s (0..1), txt}]
    const out = []; const big = this.pipeSize(s.o) > (this.si ? 1.2 : 3.94);
    for (const r of rows) {
      if (!(r.w > 0)) continue; if (r.apply === 'flow' && s.var !== 'Flow') continue; if (r.apply === 'depth' && s.var !== 'Depth') continue;
      if (!!ev.dry !== (r.key === 'dwfVol' || r.key === 'dwfPeak')) continue;
      let d = NaN, txt = '';
      if (r.key === 'peak' || r.key === 'dwfPeak') { d = (M.peakM - M.peakO) / Math.max(Math.abs(M.peakO), 1e-9) * 100; txt = 'peak ' + (d >= 0 ? '+' : '') + d.toFixed(0) + ' %'; }
      else if (r.key === 'vol' || r.key === 'dwfVol') { d = (M.volM - M.volO) / Math.max(Math.abs(M.volO), 1e-9) * 100; txt = 'volume ' + (d >= 0 ? '+' : '') + d.toFixed(0) + ' %'; }
      else if (r.key === 'timing') { d = (M.tM - M.tO) * 24; txt = 'timing ' + (d >= 0 ? '+' : '') + d.toFixed(1) + ' h'; }
      else if (r.key === 'nse') { d = M.nse; txt = 'NSE ' + d.toFixed(2); out.push({ key: r.key, label: r.label, d, s: isFinite(r.lo) ? (d >= r.lo ? 1 : Math.max(0, 1 - (r.lo - d) / Math.max(r.lo, 1e-9))) : null, w: r.w, txt }); continue; }
      else if (r.key === 'depthU' || r.key === 'depthS' || r.key === 'depthL') { const sur = M.peakO > this.pipeSize(s.o) && this.pipeSize(s.o) > 0;
        if (r.key === 'depthS' && !sur) continue; if (r.key === 'depthU' && (sur && STD[this.P.criteria.std].rows.some(x => x[0] === 'depthS') || (big && STD[this.P.criteria.std].rows.some(x => x[0] === 'depthL')))) continue; if (r.key === 'depthL' && !big) continue;
        if (r.unit === '%') { d = (M.peakM - M.peakO) / Math.max(Math.abs(M.peakO), 1e-9) * 100; txt = 'depth ' + (d >= 0 ? '+' : '') + d.toFixed(0) + ' %'; } else { d = M.peakM - M.peakO; txt = 'depth ' + (d >= 0 ? '+' : '') + d.toFixed(2) + ' ' + (this.si ? 'm' : 'ft'); } }
      if (!isFinite(r.lo) && !isFinite(r.hi)) continue;
      out.push({ key: r.key, label: r.label, d, s: checkScore(d, r.lo, r.hi), w: r.w, txt });
    }
    return out;
  };
  // score of a candidate from its runs: per monitor 0..100, overall, criteria met
  C.scoreRuns = function (byEv, events) {
    const rows = this.critRows(); const per = {}; let sw = 0, ss = 0, met = 0, nmon = 0;
    const mons = new Map(); for (const s of this.scored()) { if (!mons.has(s.mid)) mons.set(s.mid, []); mons.get(s.mid).push(s); }
    for (const [mid, vars] of mons) {
      let a = 0, b = 0, worst = null; let evOk = 0, evN = 0;
      for (const ev of events) { const run = byEv[ev.id]; let all = true, any = false;
        for (const s of vars) { const M = this.metrics(s, ev, run); if (!M) continue; for (const c of this.checksFor(s, ev, M, rows)) { if (c.s === null) continue; any = true; a += c.w * c.s; b += c.w; if (c.s < 1) all = false; if (!worst || c.s < worst.s || (c.s === worst.s && Math.abs(c.d) > Math.abs(worst.d))) worst = Object.assign({ ev: ev.id }, c); } }
        if (any) { evN++; if (all) evOk++; } }
      if (!b) continue; const sc = 100 * a / b; const w = vars[0].w; per[mid] = { s: +sc.toFixed(1), worst: worst && worst.s < 1 ? worst.ev + ' ' + worst.txt : '', met: evN ? evOk / evN >= 2 / 3 - 1e-9 : false };
      ss += w * sc; sw += w; nmon++; if (per[mid].met) met++; }
    return { score: sw ? +(ss / sw).toFixed(2) : 0, per, met, nmon };
  };

  // ------------------------------------------------------------------ candidate values
  C.calRows = function () { return this.P.params.rows.filter(r => r.on); };
  C.xCurrent = function () { return this.calRows().map(r => r.cur); };
  C.change = function (x) { const R = this.calRows(); if (!R.length) return 0; let s = 0; R.forEach((r, i) => { s += r.cur ? Math.abs(x[i] / r.cur - 1) : Math.abs(x[i] - r.cur) / Math.max(1e-9, r.max - r.min); }); return +(100 * s / R.length).toFixed(2); };
  C.denorm = function (u) { return this.calRows().map((r, i) => +(r.min + clamp(u[i], 0, 1) * (r.max - r.min)).toPrecision(5)); };
  C.norm = function (x) { return this.calRows().map((r, i) => (x[i] - r.min) / Math.max(1e-12, r.max - r.min)); };

  // ------------------------------------------------------------------ sensitivity (one at a time, at Min and Max)
  C.runSensitivity = async function () {
    const P = this.P, rows = P.params.rows; const evs = this.calEvents('cal'); if (!this.preflight(evs)) return;
    const allOn = rows.map(r => r.on); rows.forEach(r => r.on = true); const base = this.xCurrent();
    this._stop = false; this._running = new Set(); this._seq = 0; this._done = 0; const par = await this.parallel(); this._pool = this.pool(par);
    const xs = [base]; rows.forEach((r, i) => { const lo = base.slice(), hi = base.slice(); lo[i] = r.min; hi[i] = r.max; xs.push(lo, hi); });
    const total = xs.length; this._sensRun = { done: 0, total, t0: Date.now() }; this.render();
    this.onProgress = () => { this._sensRun.done = this._done; const el = this.el && this.el.querySelector('.calsensprog'); if (el) el.textContent = this._done + ' / ' + total + ' parameter sets (' + evs.length + ' events each)…'; };
    let res; try { res = await this.evaluateRuns(xs, evs); } catch (e) { rows.forEach((r, i) => r.on = allOn[i]); this._sensRun = null; this.render(); if (!this._stop) AV.alert(e.message, 'Sensitivity Analysis'); return; }
    // effect of each row on each monitor, in tolerance units
    const tol = { Flow: 20, Depth: this.si ? 0.1 : 0.33 }; const sc = this.scored(); const eff = rows.map(() => ({}));
    const resp = (k, s, ev) => { const M = this.metrics(s, ev, res[k][ev.id]); return M; };
    for (const s of sc) { const Bs = evs.map(ev => resp(0, s, ev)); const pk = Math.max(1e-9, ...Bs.filter(Boolean).map(B => B.peakM)), vl = Math.max(1e-9, ...Bs.filter(Boolean).map(B => B.volM));
      evs.forEach((ev, j) => { const B = Bs[j]; if (!B) return;
      rows.forEach((r, i) => { let e = 0; for (const k of [1 + 2 * i, 2 + 2 * i]) { const M = resp(k, s, ev); if (!M) continue;
        // relative to the event, but small events of a monitor are not blown up (floor: 20 % of its largest event)
        if (s.var === 'Flow') e = Math.max(e, Math.abs(M.peakM - B.peakM) / Math.max(B.peakM, 0.2 * pk) * 100 / tol.Flow, Math.abs(M.volM - B.volM) / Math.max(B.volM, 0.2 * vl) * 100 / tol.Flow);
        else e = Math.max(e, Math.abs(M.peakM - B.peakM) / tol.Depth); }
        eff[i][s.mid] = (eff[i][s.mid] || 0) + e / evs.length; }); }); }
    const matrix = {}; for (const s of sc) { const tot = rows.reduce((a, r, i) => a + (eff[i][s.mid] || 0), 0); matrix[s.mid] = {}; rows.forEach((r, i) => matrix[s.mid][r.id] = tot > 0 ? (eff[i][s.mid] || 0) / tot : 0); }
    rows.forEach((r, i) => { const v = Object.values(eff[i]).sort((a, b) => a - b); const mx = v.length ? v[Math.min(v.length - 1, Math.floor(v.length * 0.9))] : 0; /* 90th percentile of the monitors */ r.sens = { v: +mx.toFixed(3), cls: mx >= 0.5 ? 'high' : mx >= 0.15 ? 'medium' : 'low' }; r.on = r.sens.cls !== 'low'; });
    P.params.sens = { at: new Date().toISOString(), runs: total * evs.length, events: evs.map(e => e.id), matrix, eventSec: this._evSec || null };
    this._sensRun = null; this.touch(); this.render(); await this.save(true);
    AV.toast('Sensitivity analysis done: ' + rows.filter(r => r.on).length + ' of ' + rows.length + ' parameters will be calibrated.', false, 6000);
  };
  C.evaluateRuns = async function (xs, evs) { // raw runs per candidate (no scoring)
    const t0 = Date.now(); const out = await Promise.all(xs.map(x => Promise.all(evs.map(ev => this._pool(() => this.runEvent(ev, x, 'c' + (++this._seq) + '_' + ev.id)))).then(runs => { const by = {}; evs.forEach((e, i) => by[e.id] = runs[i]); this._done++; this.onProgress && this.onProgress(); return by; })));
    return out;
  };
  C.parallel = async function () { let n = +this.P.search.parallel; if (!(n > 0)) { try { const c = await window.host.cpuInfo(); n = Math.max(1, (c.logical || 2) - 1); } catch (e) { n = 2; } } this._parN = n; return n; };
  C.preflight = function (evs) {
    if (!evs.length) { AV.alert('Choose at least one calibration event in step 2 (Rainfall events ▸ Use as).', 'Auto Calibration'); return false; }
    if (!this.rainGages().length) { AV.alert('No rain gauge monitor is linked to a rain gage of the model (step 1 Mapping): the events need the observed rainfall.', 'Auto Calibration'); return false; }
    if (!this.scored().length) { AV.alert('No flow or depth monitor is linked and scored (weight > 0).', 'Auto Calibration'); return false; }
    return true;
  };

  // ================================================================== step 3 UI
  C.renderParams = function (body) {
    this.ensure3(); const P = this.P, PP = P.params; const rows = PP.rows;
    const grid = h('div', { class: 'calgrid2 wide' }); body.appendChild(grid);
    const left = h('div', { class: 'calcard' }); grid.appendChild(left);
    const gb = h('select', { onchange: (e) => { PP.groupBy = e.target.value; this.touch(); } }, GROUP_BY.map(g => h('option', { value: g[0], selected: g[0] === PP.groupBy }, g[1])));
    left.appendChild(h('div', { class: 'calch wrap' }, h('b', null, 'Parameter groups'), h('span', { class: 'muted' }, 'one value per group, applied to every object of the group – never object by object'), h('span', { style: { flex: 1 } }),
      h('label', null, 'Group by ', gb), h('button', { class: 'btn small primary', onclick: () => this.addGroupDialog() }, '+ Add Group')));
    const wrap = h('div', { class: 'calscroll', style: { maxHeight: 'calc(100vh - 420px)', minHeight: '220px' } }); left.appendChild(wrap);
    const tb = h('table', { class: 'caltbl calpar' }); wrap.appendChild(tb);
    tb.innerHTML = '<tr><th>Calibrate</th><th>Group</th><th class="n">Objects</th><th>Parameter</th><th>How</th><th class="n">Current</th><th class="n">Min</th><th class="n">Max</th><th>Range from</th><th>Sensitivity</th><th></th></tr>';
    for (const r of rows) { const d = PARAMS[r.param]; const pd = this.pDef(r.param); const objs = this.groupObjs(r.group, d.obj); const lim = r.how === 'factor' ? pd.lim : pd.lim;
      const chk = h('input', { type: 'checkbox', checked: r.on, onchange: (e) => { r.on = e.target.checked; this.touch(); this.render(); } });
      const num = (k) => { const def = k === 'min' ? pd.def[0] : pd.def[1]; return h('input', { class: 'cell' + (Math.abs(r[k] - def) > 1e-12 && !(r.how === 'set' && ((k === 'min' && r[k] === Math.min(def, r.cur)) || (k === 'max' && r[k] === Math.max(def, r.cur)))) ? ' edited' : ''), value: r[k], style: { width: '64px' },
        onchange: (e) => { let v = +e.target.value; if (!isFinite(v)) { e.target.value = r[k]; return; } const L = lim; if (v < L[0] || v > L[1]) { AV.toast('Outside the physical limits ' + L[0] + '–' + L[1] + ': set to the limit.', true); v = clamp(v, L[0], L[1]); }
          r[k] = v; if (r.min > r.max) { const t = r.min; r.min = r.max; r.max = t; } if (r.cur < r.min || r.cur > r.max) AV.toast('The current value is outside the range: the calibration cannot keep it.', true); this.touch(); this.render(); } }); };
      const sens = r.sens ? h('span', { class: 'calsens ' + r.sens.cls, title: 'effect at Min / Max (90th percentile of the monitors): ' + r.sens.v + ' × tolerance' }, h('span', { class: 'bar' }, h('span', { style: { width: Math.min(100, 20 + 80 * Math.min(1, r.sens.v / 2)) + '%' } })), ' ' + r.sens.cls + (r.sens.cls === 'low' && !r.on ? ' – kept' : '')) : h('span', { class: 'muted' }, '–');
      const tr = h('tr', { class: r.on ? '' : 'off' }, h('td', null, chk), h('td', null, h('b', null, r.group.label)), h('td', { class: 'n nowrap' }, n0(objs.length) + (d.obj === 'C' ? ' cond.' : ' subc.')), h('td', null, d.l + (pd.unit ? ' (' + pd.unit + ')' : '')), h('td', { class: 'nowrap' }, r.how === 'factor' ? '× factor' : 'set value'),
        h('td', { class: 'n' }, r.how === 'factor' ? '1.00' : String(r.cur)), h('td', { class: 'n' }, num('min')), h('td', { class: 'n' }, num('max')),
        h('td', null, h('input', { type: 'text', value: r.reason, style: { width: '100%', minWidth: '140px' }, placeholder: 'reason for the range', onchange: (e) => { r.reason = e.target.value; this.touch(); } })), h('td', { class: 'nowrap' }, sens),
        h('td', null, h('button', { class: 'btn small', title: 'Delete the row', onclick: () => { P.params.rows = rows.filter(x => x !== r); this.touch(); this.render(); } }, '×')));
      if (!objs.length) tr.title = 'No object in this group' + (PP.upOnly ? ' upstream of a monitor' : '');
      tb.appendChild(tr); }
    left.appendChild(h('div', { class: 'calpad muted' }, 'Min / Max can be changed, but never beyond the physical limits (e.g. % impervious 0–100, factors > 0, Manning\'s n 0.009–0.05). A changed range is marked orange and needs a reason in ', h('i', null, 'Range from'), '; both are saved with the project and listed in the calibration report.'));
    const sr = this._sensRun; const S = PP.sens; const non = rows.filter(r => r.on).length;
    left.appendChild(h('div', { class: 'calsensbar' }, h('button', { class: 'btn', disabled: !!sr || !!this._busy, onclick: () => this.runSensitivity() }, sr ? 'Running…' : 'Run Sensitivity Analysis'),
      h('div', { class: 'muted calsensprog' }, sr ? sr.done + ' / ' + sr.total + ' parameter sets…' : S ? 'Last run: ' + new Date(S.at).toLocaleString() + ' · ' + S.runs + ' event runs (' + S.events.join(', ') + ').' : (rows.length * 2 + 1) + ' parameter sets × ' + this.calEvents('cal').length + ' calibration events.'),
      h('div', { class: 'muted' }, 'Changes each parameter group to its Min and Max, runs the events and measures how much every monitor moves; groups that hardly move any monitor are not calibrated.'),
      h('b', null, non + ' of ' + rows.length + ' parameters will be calibrated'), sr ? h('button', { class: 'btn small', onclick: () => this.stopRuns() }, 'Stop') : ''));
    // right: keeping the model physical + which monitor sees which group
    const right = h('div', { class: 'calcol' }); grid.appendChild(right);
    const pen = h('input', { type: 'range', min: 0, max: 3, step: 1, value: PP.penalty, style: { flex: 1 }, oninput: (e) => { PP.penalty = +e.target.value; pl.textContent = PENALTY[PP.penalty]; this.touch(); } }); const pl = h('span', { style: { width: '60px' } }, PENALTY[PP.penalty]);
    const nUp = [...this.m.subcatchments.values()].filter(s => this.monCatchments().has(this.subOutletNode(s))).length;
    right.appendChild(h('div', { class: 'calcard calnote2' }, h('b', { class: 'ttl' }, 'Keeping the model physical'),
      h('div', null, h('b', null, 'Hard limits'), ' – a value never leaves its Min–Max range. The ranges come from the data source, literature or the engineer and are saved with the project.'),
      h('div', null, h('b', null, 'Stay close to the current model'), ' – every change away from the current value costs score.'), h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, h('span', { class: 'muted' }, 'Penalty'), pen, pl),
      h('div', null, h('b', null, 'Few parameters'), ' – only groups the monitors can see are calibrated; insensitive ones keep their value.'),
      h('label', { style: { display: 'block' } }, h('input', { type: 'checkbox', checked: PP.upOnly, onchange: (e) => { PP.upOnly = e.target.checked; this.touch(); this.render(); } }), ' ', h('b', null, 'Upstream of the monitors only'), ' – groups are limited to the areas that drain to a monitor (' + nUp + ' of ' + this.m.subcatchments.size + ' subcatchments).')));
    const see = h('div', { class: 'calcard' }); right.appendChild(see);
    const q = h('input', { type: 'text', placeholder: 'Search…', value: this.q.see || '', style: { width: '110px' }, oninput: (e) => { this.q.see = e.target.value; fillSee(); } });
    see.appendChild(h('div', { class: 'calch' }, h('b', null, 'Which monitor sees which group'), h('span', { style: { flex: 1 } }), q));
    const sw = h('div', { class: 'calscroll', style: { maxHeight: '300px' } }); see.appendChild(sw); const st = h('table', { class: 'caltbl calsee' }); sw.appendChild(st); const sum = h('div', { class: 'calpad' }); see.appendChild(sum);
    const short = (r) => { const d = PARAMS[r.param]; return (r.group.by === 'all' ? '' : String(r.group.key).slice(0, 8) + ' ') + ({ imperv: '%Imp', width: 'Width', slope: 'Slope', sImp: 'Dstore', sPerv: 'DstP', nImp: 'N-Imp', nPerv: 'N-Perv', pctZero: '%Zero', infil1: 'Inf1', infil2: 'Inf2', rough: 'n' }[r.param] || d.l); };
    const fillSee = () => { const sc = this.scored(); const mids = [...new Set(sc.map(s => s.mid))]; const R = rows; const qq = (this.q.see || '').toLowerCase();
      if (!S) { st.innerHTML = '<tr><td class="muted" style="padding:12px">Run the sensitivity analysis to see which monitor responds to which parameter group.</td></tr>'; sum.innerHTML = ''; return; }
      st.innerHTML = '<tr><th>Monitor</th>' + R.map(r => '<th title="' + esc(r.group.label + ' – ' + PARAMS[r.param].l) + '">' + esc(short(r)) + '</th>').join('') + '</tr>';
      const none = []; for (const mid of mids) { const row = S.matrix[mid] || {}; const cells = R.map(r => { const v = row[r.id]; return v === undefined ? '?' : v > 0.5 ? '●●●' : v > 0.2 ? '●●' : v > 0.05 ? '●' : '–'; }); if (R.every((r, i) => !r.on || cells[i] === '–' || cells[i] === '?')) none.push(mid);
        if (qq && !mid.toLowerCase().includes(qq)) continue; st.insertAdjacentHTML('beforeend', '<tr><td><b>' + esc(mid) + '</b></td>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>'); }
      const seenBy = R.filter(r => r.on).map(r => mids.filter(m => (S.matrix[m] || {})[r.id] > 0.05).length); const minSeen = seenBy.length ? Math.min(...seenBy) : 0;
      sum.innerHTML = (seenBy.length ? (minSeen >= Math.min(5, mids.length) ? '<div><span class="good">✓</span> Every calibrated group is seen by at least ' + minSeen + ' monitor(s)</div>' : '<div><span style="color:#ef6c00">⚠</span> A calibrated group is seen by only ' + minSeen + ' monitor(s): its value is not well identified</div>') : '') + (none.length ? '<div><span style="color:#ef6c00">⚠</span> ' + esc(none.join(', ')) + ': see no calibrated group – scored, but they do not steer the calibration</div>' : '') + '<div class="muted">● share of the monitor\'s response explained by the group</div>'; };
    fillSee();
    right.appendChild(h('div', { class: 'calnext' }, h('button', { class: 'btn', onclick: () => this.go(1) }, '‹ Back'), h('button', { class: 'btn primary', disabled: !non, onclick: () => this.go(3) }, 'Next: Criteria & Run ›')));
  };
  C.stopRuns = function () { this._stop = true; for (const id of this._running || []) window.host.cancelEngine(id); };

  // ================================================================== step 4 UI
  C.renderCriteria = function (body) {
    this.ensure3(); const P = this.P, CR = P.criteria; const grid = h('div', { class: 'calgrid' }); body.appendChild(grid);
    const left = h('div', { class: 'calcol' }), right = h('div', { class: 'calcol' }); grid.append(left, right);
    const ac = h('div', { class: 'calcard' }); left.appendChild(ac);
    const stdSel = h('select', { onchange: (e) => { CR.std = e.target.value; CR.edit = {}; this.touch(); this.render(); } }, Object.keys(STD).map(k => h('option', { value: k, selected: k === CR.std }, STD[k].name)));
    ac.appendChild(h('div', { class: 'calch wrap' }, h('b', null, 'Acceptance criteria'), h('label', null, 'Standard ', stdSel), h('span', { style: { flex: 1 } }), h('button', { class: 'btn small', onclick: () => { CR.edit = {}; this.touch(); this.render(); } }, 'Reset to Standard')));
    const ct = h('table', { class: 'caltbl calcrit' }); ac.appendChild(h('div', { class: 'calscroll' }, ct));
    ct.innerHTML = '<tr><th>Check</th><th>Applies to</th><th class="n">Lower</th><th class="n">Upper</th><th>Unit</th><th class="n">Weight</th></tr>';
    STD[CR.std].rows.forEach((r, i) => { const cell = (j) => { const k = CR.std + i + '_' + j; const v0 = r[j]; const v = CR.edit[k] !== undefined ? CR.edit[k] : v0; return h('td', { class: 'n' }, h('input', { class: 'cell' + (CR.edit[k] !== undefined && CR.edit[k] !== v0 ? ' edited' : ''), value: v, style: { width: '64px' }, onchange: (e) => { const x = e.target.value.trim(); if (x !== '' && !isFinite(+x.replace('−', '-'))) { e.target.value = v; return; } if (x === v0) delete CR.edit[k]; else CR.edit[k] = x; e.target.classList.toggle('edited', x !== v0); this.touch(); } })); };
      ct.appendChild(h('tr', null, h('td', null, r[1]), h('td', null, r[2] + ' monitors'), cell(3), cell(4), h('td', null, r[5] === 'm' && !this.si ? 'm (→ ft)' : r[5]), cell(6))); });
    ac.appendChild(h('div', { class: 'calpad muted' }, STD[CR.std].note + ' Every cell can be changed; changed cells are marked orange and saved with the calibration project.' + (this.si ? '' : ' Depth limits in m are converted to ft for this US model.')));
    ac.appendChild(h('div', { class: 'calpad muted' }, 'Values to be checked against the current edition of the code before release. Every monitor and every calibration event is scored together; no single monitor can be fitted alone. Score per check: 1 inside the tolerance, falling linearly to 0 at twice the tolerance.'));
    // weights
    const wc = h('div', { class: 'calcard' }); left.appendChild(wc);
    const wq = h('input', { type: 'text', placeholder: 'Search…', value: this.q.w || '', style: { width: '120px' }, oninput: (e) => { this.q.w = e.target.value; fillW(); } });
    wc.appendChild(h('div', { class: 'calch' }, h('b', null, 'Monitor weights'), h('span', { class: 'muted' }, '0 = not scored · cleaned data start lower'), h('span', { style: { flex: 1 } }), wq));
    const ww = h('div', { class: 'calscroll', style: { maxHeight: '300px' } }); wc.appendChild(ww); const wt = h('table', { class: 'caltbl' }); ww.appendChild(wt);
    const qual = this.qualityMap(); const area = this.si ? 'ha' : 'ac';
    const fillW = () => { const q = (this.q.w || '').toLowerCase(); wt.innerHTML = '<tr><th>Monitor</th><th class="n">Upstream area</th><th>Data quality</th><th class="n">Weight</th></tr>';
      for (const mon of this.monitorList()) { if (!mon.o || mon.o.kind === 'GAGE' || mon.vars.every(v => v.var === 'Rainfall')) continue; if (q && !(mon.mid + ' ' + mon.o.id).toLowerCase().includes(q)) continue;
        const qq = qual.get(mon.mid); const def = this.defaultWeight(mon.mid); const cur = this.weightOf(mon);
        const inp = h('input', { class: 'cell' + (this.P.weights[mon.mid] !== undefined ? ' edited' : ''), value: cur.toFixed(1), style: { width: '56px' }, onchange: (e) => { const v = +e.target.value; if (!(v >= 0)) { e.target.value = cur; return; } if (Math.abs(v - def) < 1e-9) delete this.P.weights[mon.mid]; else this.P.weights[mon.mid] = v; this.touch(); fillW(); } });
        wt.appendChild(h('tr', null, h('td', null, h('b', null, mon.mid), ' · ' + mon.o.id), h('td', { class: 'n' }, AV.fmt(this.upstreamArea(mon.o), 1) + ' ' + area), h('td', { html: qq ? chip(qq[0], qq[1]) : 'good' }), h('td', { class: 'n' }, inp))); } };
    fillW();
    wc.appendChild(h('div', { class: 'calpad muted' }, 'Default weight 1.0; −0.1 for each cleaning method applied to a monitor, −0.2 when gaps were filled (min. 0.5); every weight can be changed.'));
    // search
    const S = P.search; const evs = this.calEvents('cal'), vev = this.calEvents('val'); const nR = this.calRows().length;
    const sc = h('div', { class: 'calcard calsearch' }); right.appendChild(sc);
    const meth = h('select', { onchange: (e) => { S.method = e.target.value; this.touch(); est(); } }, METHODS.map(m => h('option', { value: m[0], selected: m[0] === S.method }, m[1])));
    const sims = h('input', { type: 'number', min: 10, step: 10, value: S.sims, style: { width: '90px' }, onchange: (e) => { S.sims = Math.max(10, Math.round(+e.target.value || 200)); this.touch(); est(); } });
    const par = h('input', { type: 'number', min: 0, step: 1, value: S.parallel || '', placeholder: 'auto', style: { width: '70px' }, onchange: (e) => { S.parallel = Math.max(0, Math.round(+e.target.value || 0)); this.touch(); est(); } });
    const estEl = h('div', { class: 'muted' });
    const est = async () => { const n = await this.parallel(); const sec = (P.params.sens && P.params.sens.eventSec) || (this.P.run && this.P.run.eventSec) || null;
      estEl.textContent = (sec ? 'Estimated time: about ' + Math.max(1, Math.round(S.sims * evs.length * sec / n / 60)) + ' min (one event run ≈ ' + sec.toFixed(0) + ' s, ' + evs.length + ' events, ' + n + ' at a time). ' : 'Run the sensitivity analysis first for a time estimate. ') + (vev.length ? 'Validation events ' + vev.map(e => e.id).join(', ') + ' are run only for the final options.' : 'No validation event: choose some in step 2.'); };
    sc.append(h('div', { class: 'calch' }, h('b', null, 'Search')), h('div', { class: 'form calform' }, h('label', null, 'Method'), meth, h('label', null, 'Simulations'), sims, h('label', null, 'Parallel runs'), h('span', null, par, ' ', h('span', { class: 'muted' }, '(blank = processors − 1)')),
      h('label', null, 'Events per run'), h('span', null, evs.length ? evs.map(e => e.id).join(', ') + ' (calibration)' : h('span', { class: 'bad' }, 'none – choose calibration events in step 2')), h('label', null, 'Parameters'), h('span', null, nR + ' calibrated groups (step 3)')), h('div', { class: 'calpad' }, estEl));
    est();
    // running / result
    const rc = h('div', { class: 'calcard calrun' }); right.appendChild(rc); this._runCard = rc; this.renderRunCard();
    right.appendChild(h('div', { class: 'calnext' }, h('button', { class: 'btn', onclick: () => this.go(2) }, '‹ Back'), h('button', { class: 'btn primary', disabled: !(P.results && P.results.options), onclick: () => this.go(4) }, 'Results ›')));
  };
  C.renderRunCard = function () {
    const rc = this._runCard; if (!rc || !rc.isConnected) return; rc.innerHTML = ''; const R = this._live || this.P.run; const running = !!this._live;
    const total = this.P.search.sims; const done = R ? R.evals.length : 0; const sec = R && R.t0 ? ((running ? Date.now() : R.t1 || Date.now()) - R.t0) / 1000 : 0;
    const left = running && done ? sec / done * (total - done) : 0;
    rc.appendChild(h('div', { class: 'calch' }, h('b', null, running ? 'Running' : R ? (R.stopped ? 'Stopped' : 'Finished') : 'Not run yet'), h('div', { class: 'calprog' }, h('div', { style: { width: (100 * Math.min(1, done / total)) + '%' } })),
      h('span', { class: 'muted nowrap' }, done + ' / ' + total + ' simulations' + (sec ? ' · ' + Math.round(sec / 60) + ' min' : '') + (running && left ? ' · ' + Math.round(left / 60) + ' min left' : '')),
      running ? h('button', { class: 'btn small danger', onclick: () => this.stopRuns() }, 'Stop') : h('button', { class: 'btn small primary', disabled: !this.calRows().length, onclick: () => this.runSearch() }, R ? 'Run Again' : 'Start Calibration')));
    const cbox = h('div', { class: 'calconv' }); rc.appendChild(cbox);
    if (R && R.evals.length) { const ch = new AV.Chart(cbox, {}); const xs = [], best = [], sc = []; let b = -1, bs = -1; R.evals.forEach((e, i) => { b = Math.max(b, e.met); bs = Math.max(bs, e.score); xs.push(i + 1); best.push(b); sc.push(bs); });
      setTimeout(() => ch.setSeries([{ name: 'Best so far', x: xs, y: best, color: '#1565c0', steps: true }].concat(R.base ? [{ name: 'Current model', x: [1, Math.max(2, xs.length)], y: [R.base.met, R.base.met], color: '#9aa5b1', dash: [4, 3] }] : []), { xLabel: 'simulations', yLabel: 'monitors meeting the criteria (of ' + (R.base ? R.base.nmon : '?') + ')', title: '' }), 0); }
    else cbox.appendChild(h('div', { class: 'muted calpad' }, 'Start Calibration runs the current model first (as the reference), then the search. Every simulation runs all calibration events; the results are kept with the project.'));
    const front = R && R.evals.length ? paretoIdx(R.evals).length : 0;
    rc.appendChild(h('div', { class: 'calkpis three' }, kpi('Criteria met – current model', R && R.base ? R.base.met + ' of ' + R.base.nmon : '–', R && R.base ? 'score ' + R.base.score.toFixed(0) : ''),
      kpi('Criteria met – best so far', R && R.evals.length ? Math.max(...R.evals.map(e => e.met)) + ' of ' + (R.base ? R.base.nmon : '?') : '–', R && R.evals.length ? 'score ' + Math.max(...R.evals.map(e => e.score)).toFixed(0) : ''),
      kpi('Options on the front', R && R.evals.length ? String(front) : '–', 'fit against change')));
    if (R && R.error) rc.appendChild(h('div', { class: 'calpad bad' }, R.error));
  };
  const kpi = (l, v, s, cls) => h('div', { class: 'calkpi' }, h('div', { class: 'muted' }, l), h('div', { class: 'kv' }, v), h('div', { class: 'ks ' + (cls || '') }, s || ''));
  function paretoIdx(E) { const idx = []; E.forEach((e, i) => { if (!E.some((f, j) => j !== i && f.score >= e.score && f.change <= e.change && (f.score > e.score || f.change < e.change))) idx.push(i); }); return idx.sort((a, b) => E[a].change - E[b].change); }

  // ------------------------------------------------------------------ the search
  C.runSearch = async function () {
    const P = this.P; const evs = this.calEvents('cal'); if (!this.preflight(evs)) return; if (!this.calRows().length) { AV.alert('Tick at least one parameter group in step 3.', 'Auto Calibration'); return; }
    if (P.results && P.results.options && !await AV.confirm('Run the calibration again? The results of the last run are replaced.', 'Auto Calibration', 'Run')) return;
    if (this.dirty) await this.save(true);
    this._stop = false; this._running = new Set(); this._seq = 0; this._done = 0; const npar = await this.parallel(); this._pool = this.pool(npar);
    const live = this._live = { t0: Date.now(), evals: [], base: null, method: P.search.method, events: evs.map(e => e.id), rows: this.calRows().map(r => r.id) }; this.renderRunCard(); this.renderHead();
    const lam = LAMBDA[P.params.penalty || 0]; const objective = (e) => e.score - lam * e.change;
    let tick = 0; this.onProgress = () => { if (++tick % 2 === 0 || this._done < 3) this.renderRunCard(); };
    const evalX = async (xs) => { const sc = await this.evaluate(xs, evs); return sc.map(s => s.e); };
    try {
      const b = (await this.evaluate([this.xCurrent()], evs))[0];
      this.onEval = (x, s) => { const e = { x, score: s.score, met: s.met, change: this.change(x), per: s.per }; if (live.evals.length < P.search.sims) live.evals.push(e); return e; }; live.base = { score: b.score, met: b.met, nmon: b.nmon, per: b.per }; this.renderRunCard();
      const d = this.calRows().length; const budget = P.search.sims; const cur = this.norm(this.xCurrent());
      if (P.search.method === 'nsga') await nsga2(this, d, budget, npar, cur, evalX);
      else if (P.search.method === 'sce') await sceua(this, d, budget, npar, cur, evalX, objective);
      else await dds(this, d, budget, npar, cur, evalX, objective);
    } catch (e) { if (!this._stop) live.error = e.message; }
    live.t1 = Date.now(); live.stopped = this._stop; this.onProgress = null; this.onEval = null; this._live = null;
    P.run = { t0: live.t0, t1: live.t1, method: live.method, events: live.events, rows: live.rows, base: live.base, evals: live.evals.map(e => ({ x: e.x, score: e.score, met: e.met, change: e.change })), stopped: live.stopped, error: live.error, eventSec: this._evSec || null };
    if (live.evals.length && !live.error) await this.finalOptions(live);
    this.touch(); this.render(); await this.save(true);
    if (live.error) AV.alert('The calibration stopped: ' + live.error, 'Auto Calibration');
  };
  // three options from the front: A closest to the current model, B balanced (best penalised score), C best fit
  C.finalOptions = async function (live) {
    const P = this.P, E = live.evals; const fi = paretoIdx(E); const lam = LAMBDA[P.params.penalty || 0] || 0.1; const base = live.base.score;
    // front sorted by change: A = the smallest change that improves on the current model, C = the best score,
    // B = the best penalised score between them (so that A ≤ B ≤ C in change)
    const front = fi.map(i => E[i]); const C_ = front.reduce((a, e) => e.score > a.score ? e : a, front[0]);
    const A_ = front.find(e => e.score > base && e.change > 0) || front[0];
    const mid = front.filter(e => e.change >= A_.change && e.change <= C_.change);
    const B_ = mid.reduce((a, e) => (e.score - lam * e.change) > (a.score - lam * a.change) ? e : a, mid[0] || A_);
    const pick = { A: A_, B: B_, C: C_ }; const all = this.calEvents('all');
    this.app.status('Running the options on all events…'); this._stop = false;
    const xs = [this.xCurrent(), A_.x, B_.x, C_.x]; const res = await this.evaluate(xs, all, true);
    const evIds = all.map(e => e.id); const cal = this.calEvents('cal').map(e => e.id), val = this.calEvents('val').map(e => e.id);
    const part = (r, ids) => this.scoreRuns(r.runs, all.filter(e => ids.includes(e.id)));
    const opt = {}; ['cur', 'A', 'B', 'C'].forEach((k, i) => { const r = res[i]; opt[k] = { x: xs[i], all: { score: r.score, per: r.per, met: r.met }, cal: part(r, cal), val: val.length ? part(r, val) : null, change: k === 'cur' ? 0 : this.change(xs[i]) }; });
    opt.A.tag = 'closest to current model'; opt.B.tag = 'balanced'; opt.C.tag = 'best fit of the calibration events'; opt.B.badge = 'Recommended';
    if (opt.C.val && opt.B.val && opt.C.val.score < opt.B.val.score - 1) opt.C.badge = 'Over-fit risk';
    // simulated series of the options for the charts
    this.resSeries = new Map(); ['cur', 'A', 'B', 'C'].forEach((k, i) => { for (const [eid, run] of Object.entries(res[i].runs)) for (const [key, arr] of Object.entries(run.s)) { const t = new Float64Array(arr.length); for (let j = 0; j < arr.length; j++) t[j] = run.t0 + (j + 1) * run.step; this.resSeries.set(k + '|' + eid + '|' + key, { t, v: arr }); } });
    this.app.status('');
    P.results = { at: new Date().toISOString(), options: opt, front: fi.map(i => ({ score: E[i].score, change: E[i].change })), opt: 'B', acc: {}, newv: {}, events: evIds };
    await this.saveRes();
  };
  C.saveRes = async function () { if (!this.resSeries) return; const d = this.folder(); await window.host.writeBinary(AV.joinPath(d, this.P.name + '.avres'), AV.encodeObs(this.resSeries)); };
  C.loadRes = async function () { if (this.resSeries && this.resSeries._name === this.P.name) return; this.resSeries = new Map(); try { const p = AV.joinPath(this.folder(), this.P.name + '.avres'); if (await window.host.exists(p)) this.resSeries = AV.decodeObs(await window.host.readBinary(p)); } catch (e) { } this.resSeries._name = this.P.name; };

  // ---- NSGA-II (score up, change down)
  async function nsga2(cal, d, budget, par, cur, evalX) {
    const N = Math.max(8, Math.min(40, 2 * Math.ceil(par * 2 / 2) * 2)); const rnd = Math.random;
    let pop = [cur.slice()]; while (pop.length < N) pop.push(Array.from({ length: d }, () => rnd()));
    let P = await evalX(pop.map(u => cal.denorm(u))); P.forEach((e, i) => e.u = pop[i]); let used = P.length;
    const sbx = (a, b) => { const c1 = a.slice(), c2 = b.slice(); if (rnd() < 0.9) for (let i = 0; i < d; i++) { if (rnd() > 0.5) continue; const u = rnd(); const bq = u <= 0.5 ? Math.pow(2 * u, 1 / 16) : Math.pow(1 / (2 * (1 - u)), 1 / 16); c1[i] = clamp(0.5 * ((1 + bq) * a[i] + (1 - bq) * b[i]), 0, 1); c2[i] = clamp(0.5 * ((1 - bq) * a[i] + (1 + bq) * b[i]), 0, 1); } return [c1, c2]; };
    const mut = (c) => c.map(v => { if (rnd() > 1 / d) return v; const u = rnd(); const dq = u < 0.5 ? Math.pow(2 * u, 1 / 21) - 1 : 1 - Math.pow(2 * (1 - u), 1 / 21); return clamp(v + dq, 0, 1); });
    const rank = (A) => { const F = []; const S = A.map(() => []), n = A.map(() => 0); const dom = (p, q) => p.score >= q.score && p.change <= q.change && (p.score > q.score || p.change < q.change);
      A.forEach((p, i) => A.forEach((q, j) => { if (dom(p, q)) S[i].push(j); else if (dom(q, p)) n[i]++; })); let f = A.map((p, i) => i).filter(i => !n[i]); let r = 0;
      while (f.length) { f.forEach(i => A[i].rank = r); F.push(f); const nf = []; for (const i of f) for (const j of S[i]) if (--n[j] === 0) nf.push(j); f = nf; r++; }
      for (const f2 of F) { f2.forEach(i => A[i].crowd = 0); for (const k of ['score', 'change']) { const s = f2.slice().sort((a, b) => A[a][k] - A[b][k]); A[s[0]].crowd = A[s[s.length - 1]].crowd = Infinity; const span = (A[s[s.length - 1]][k] - A[s[0]][k]) || 1; for (let i = 1; i < s.length - 1; i++) A[s[i]].crowd += (A[s[i + 1]][k] - A[s[i - 1]][k]) / span; } } return F; };
    rank(P); const better = (a, b) => a.rank < b.rank || (a.rank === b.rank && a.crowd > b.crowd); const tour = () => { const a = P[Math.floor(rnd() * P.length)], b = P[Math.floor(rnd() * P.length)]; return better(a, b) ? a : b; };
    while (used < budget && !cal._stop) {
      const kids = []; const n = Math.min(N, budget - used); while (kids.length < n) { const [c1, c2] = sbx(tour().u, tour().u); kids.push(mut(c1)); if (kids.length < n) kids.push(mut(c2)); }
      const Q = await evalX(kids.map(u => cal.denorm(u))); Q.forEach((e, i) => e.u = kids[i]); used += Q.length;
      const R = P.concat(Q); const F = rank(R); const next = []; for (const f of F) { if (next.length + f.length <= N) f.forEach(i => next.push(R[i])); else { f.sort((a, b) => R[b].crowd - R[a].crowd).slice(0, N - next.length).forEach(i => next.push(R[i])); break; } }
      P = next; rank(P); }
  }
  // ---- DDS (dynamically dimensioned search), a batch of candidates per iteration
  async function dds(cal, d, budget, par, cur, evalX, obj) {
    let best = (await evalX([cal.denorm(cur)]))[0]; best.u = cur.slice(); let used = 1; const it = Math.max(2, Math.ceil(budget / par)); let k = 0;
    while (used < budget && !cal._stop) { k++; const p = 1 - Math.log(k) / Math.log(it); const n = Math.min(par, budget - used); const C2 = [];
      for (let j = 0; j < n; j++) { const u = best.u.slice(); let any = false; for (let i = 0; i < d; i++) if (Math.random() < Math.max(p, 1 / d)) { any = true; let v = u[i] + 0.2 * gauss(); if (v < 0) v = -v; if (v > 1) v = 2 - v; u[i] = clamp(v, 0, 1); }
        if (!any) { const i = Math.floor(Math.random() * d); u[i] = clamp(u[i] + 0.2 * gauss(), 0, 1); } C2.push(u); }
      const E = await evalX(C2.map(u => cal.denorm(u))); used += E.length; E.forEach((e, i) => { e.u = C2[i]; if (obj(e) > obj(best)) best = e; }); }
  }
  // ---- SCE-UA (shuffled complex evolution), the complexes evolve in parallel
  async function sceua(cal, d, budget, par, cur, evalX, obj) {
    const p = Math.max(2, Math.min(par, 4)), m = 2 * d + 1; let pts = [cur.slice()]; while (pts.length < p * m) pts.push(Array.from({ length: d }, () => Math.random()));
    let A = await evalX(pts.map(u => cal.denorm(u))); A.forEach((e, i) => e.u = pts[i]); let used = A.length;
    while (used < budget && !cal._stop) {
      A.sort((a, b) => obj(b) - obj(a)); const cx = Array.from({ length: p }, (_, k) => A.filter((e, i) => i % p === k));
      for (let step = 0; step < m && used < budget && !cal._stop; step++) {
        const props = []; const meta = [];
        for (const c of cx) { c.sort((a, b) => obj(b) - obj(a)); const q = Math.min(d + 1, c.length); const sub = []; const w = c.map((e, i) => 2 * (c.length - i) / (c.length * (c.length + 1)));
          while (sub.length < q) { let r = Math.random(), i = 0; while (r > w[i] && i < c.length - 1) { r -= w[i]; i++; } if (!sub.includes(c[i])) sub.push(c[i]); }
          sub.sort((a, b) => obj(b) - obj(a)); const worst = sub[sub.length - 1]; const g = Array.from({ length: d }, (_, i) => sub.slice(0, -1).reduce((s, e) => s + e.u[i], 0) / (sub.length - 1));
          let u = g.map((gi, i) => 2 * gi - worst.u[i]); if (u.some(v => v < 0 || v > 1)) u = Array.from({ length: d }, () => Math.random()); props.push(u); meta.push([c, worst, g]); }
        const E = await evalX(props.map(u => cal.denorm(u))); used += E.length;
        const retry = [], rmeta = [];
        E.forEach((e, k) => { e.u = props[k]; const [c, worst, g] = meta[k]; if (obj(e) > obj(worst)) c[c.indexOf(worst)] = e; else { retry.push(g.map((gi, i) => (gi + worst.u[i]) / 2)); rmeta.push([c, worst]); } });
        if (retry.length && used < budget && !cal._stop) { const E2 = await evalX(retry.map(u => cal.denorm(u))); used += E2.length; E2.forEach((e, k) => { e.u = retry[k]; const [c, worst] = rmeta[k]; c[c.indexOf(worst)] = obj(e) > obj(worst) ? e : e; }); }
      }
      A = cx.flat(); }
  }
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // ================================================================== step 5 UI
  C.renderResults = async function (body) {
    this.ensure3(); const P = this.P, R = P.results; if (!R || !R.options) { body.appendChild(h('div', { class: 'calcard calpad' }, 'Run the calibration in step 4 first.')); return; }
    await this.loadRes(); const O = R.options; const ok = R.opt in O ? R.opt : 'B'; R.opt = ok; const opt = O[ok];
    const grid = h('div', { class: 'calgrid3' }); body.appendChild(grid);
    const c1 = h('div', { class: 'calcol' }), right = h('div', { class: 'calcol' }); grid.append(c1, right);
    const c2 = h('div', { class: 'calgrid3b' }), c3 = h('div', { class: 'calgrid3b' }); right.append(c2, c3);
    // options + pareto
    const oc = h('div', { class: 'calcard' }); c1.appendChild(oc); oc.appendChild(h('div', { class: 'calch' }, h('b', null, 'Options: fit against change')));
    oc.appendChild(h('div', { html: this.paretoSvg() }));
    for (const k of ['A', 'B', 'C'].concat(O.E ? ['E'] : [])) { const o = O[k]; const sc = (o.val ? o.all : o.cal).score;
      c1.appendChild(h('button', { class: 'calopt' + (k === ok ? ' on' : ''), onclick: () => { R.opt = k; R.acc = {}; R.newv = {}; this._dirtyNew = false; this.touch(); this.render(); } },
        h('span', { class: 'r1' }, h('b', null, k === 'E' ? 'Edited' : k), h('span', { class: 'muted' }, o.tag || ''), h('span', { style: { flex: 1 } }), o.badge ? h('span', { class: 'cchip ' + (o.badge === 'Recommended' ? 'good' : 'mid') }, o.badge) : ''),
        h('span', { class: 'r2' }, h('span', null, 'Overall score ', h('b', null, sc.toFixed(0))), h('span', null, 'Calibration ' + o.cal.score.toFixed(0) + (o.val ? ' · validation ' + o.val.score.toFixed(0) : '')), h('span', null, 'Change ' + o.change.toFixed(0) + ' %')))); }
    c1.appendChild(h('div', { class: 'calcard calnote' }, h('b', null, 'Score (0–100)'), ' per monitor: every check of every event (calibration and validation) gives 1 inside its tolerance, falling linearly to 0 at twice the tolerance; checks are weighted as in step 4 and averaged. The overall score weights the monitors as in step 4. Current model: ' + O.cur.all.score.toFixed(0) + '.'));
    // scorecard
    const per = opt.all.per; const mons = this.monitorList().filter(m => per[m.mid]);
    const scd = h('div', { class: 'calcard' }); c2.appendChild(scd);
    const red = mons.filter(m => per[m.mid].s < 50).length; const q = h('input', { type: 'text', placeholder: 'Search monitor or object…', value: this.q.sc || '', style: { width: '190px' }, oninput: (e) => { this.q.sc = e.target.value; fill(); } });
    scd.appendChild(h('div', { class: 'calch wrap' }, h('b', null, 'Scorecard – option ' + (ok === 'E' ? 'Edited' : ok)), h('span', { class: 'muted' }, mons.length + ' monitors · ' + red + ' below 50 · click a header to sort, a row for its graph'), h('span', { style: { flex: 1 } }), q, h('button', { class: 'btn small', onclick: () => this.exportScores() }, 'Export CSV')));
    const sw = h('div', { class: 'calscroll', style: { maxHeight: '300px' } }); scd.appendChild(sw); const st = h('table', { class: 'caltbl calsc' }); sw.appendChild(st);
    this.q.sort = this.q.sort || ['score', 1];
    if (!this.sel.rmon || !per[this.sel.rmon]) this.sel.rmon = (mons.slice().sort((a, b) => per[a.mid].s - per[b.mid].s)[0] || {}).mid;
    const fill = () => { const qq = (this.q.sc || '').toLowerCase(); const [k, dir] = this.q.sort; const L = mons.filter(m => !qq || (m.mid + ' ' + (m.o ? m.o.id : '')).toLowerCase().includes(qq));
      const val = (m) => k === 'score' ? per[m.mid].s : k === 'id' ? m.mid : k === 'obj' ? m.o.id : m.vars.map(v => v.var).join('+'); L.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
      st.innerHTML = ''; const th = (key, l, n) => h('th', { class: 'sort' + (n ? ' n' : ''), onclick: () => { this.q.sort = [key, this.q.sort[0] === key ? -this.q.sort[1] : 1]; fill(); } }, l + (k === key ? (dir > 0 ? ' ▲' : ' ▼') : ''));
      st.appendChild(h('tr', null, th('id', 'Monitor'), th('obj', 'Object'), th('type', 'Type'), th('score', 'Score', 1), h('th', null, 'Largest miss')));
      for (const m of L) { const p = per[m.mid]; const cls = scoreCls(p.s); st.appendChild(h('tr', { class: m.mid === this.sel.rmon ? 'sel' : '', onclick: () => { this.sel.rmon = m.mid; fill(); this.drawResChart(); this.renderDiag(); } },
        h('td', null, h('b', null, m.mid)), h('td', null, m.o.id), h('td', null, m.vars.filter(v => v.var !== 'Velocity').map(v => v.var).join(' + ')),
        h('td', { class: 'n nowrap' }, h('span', { class: 'scorebar' }, h('span', { style: { width: p.s + '%', background: cls === 'good' ? '#2e7d32' : cls === 'mid' ? '#ef6c00' : '#c62828' } })), h('span', { class: 'cchip ' + cls, style: { minWidth: '46px', textAlign: 'center' } }, p.s.toFixed(0) + (cls === 'good' ? ' ✓' : cls === 'bad' ? ' ✕' : ''))),
        h('td', { class: 'muted' }, p.worst))); } };
    fill();
    // chart
    const chc = h('div', { class: 'calcard calreschart' }); c2.appendChild(chc); this._resHead = h('div', { class: 'calch wrap' }); chc.appendChild(this._resHead); const box = h('div', { class: 'calmain' }); chc.appendChild(box); this._resChart = new AV.Chart(box, {}); this._resStats = h('div', { class: 'calpad' }); chc.appendChild(this._resStats);
    this._diag = h('div'); c2.appendChild(this._diag);
    // parameter changes
    const pc = h('div', { class: 'calcard' }); c3.appendChild(pc); this._parCard = pc; this.renderParChanges();
    const ap = h('div', { class: 'calcard calapply' }); c3.appendChild(ap); this._applyCard = ap; this.renderApply();
    setTimeout(() => { this.drawResChart(); this.renderDiag(); }, 0);
  };
  C.paretoSvg = function () {
    const R = this.P.results, O = R.options; const W = 300, H = 190, L = 34, B = 26, T = 8, Rr = 8; const pts = R.front.concat([{ score: O.cur.cal.score, change: 0 }], ['A', 'B', 'C'].map(k => ({ score: O[k].cal.score, change: O[k].change })));
    const xm = Math.max(5, ...pts.map(p => p.change)) * 1.1; const ymin = Math.max(0, Math.floor((Math.min(...pts.map(p => p.score)) - 5) / 10) * 10), ymax = Math.min(100, Math.ceil((Math.max(...pts.map(p => p.score)) + 2) / 5) * 5);
    const ys = (v) => T + (H - T - B) * (1 - (v - ymin) / Math.max(1, ymax - ymin)), xs = (v) => L + (W - L - Rr) * v / xm;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" class="calpareto"><rect x="' + L + '" y="' + T + '" width="' + (W - L - Rr) + '" height="' + (H - T - B) + '" fill="#fbfcfd" stroke="#e3e7ec"/>';
    for (const v of [ymin, (ymin + ymax) / 2, ymax]) s += '<text x="' + (L - 4) + '" y="' + (ys(v) + 4) + '" text-anchor="end">' + AV.fmt(v, 0) + '</text>';
    for (const v of [0, xm / 2, xm]) s += '<text x="' + xs(v) + '" y="' + (H - B + 14) + '" text-anchor="middle">' + v.toFixed(0) + ' %</text>';
    s += '<text x="' + ((L + W) / 2) + '" y="' + (H - 2) + '" text-anchor="middle" class="ax">mean parameter change</text>';
    s += '<polyline fill="none" stroke="#c3cad2" stroke-dasharray="4 3" points="' + R.front.map(p => xs(p.change).toFixed(1) + ',' + ys(p.calScore || p.score).toFixed(1)).join(' ') + '"/>';
    for (const p of R.front) s += '<circle cx="' + xs(p.change) + '" cy="' + ys(p.score) + '" r="3" fill="#9aa5b1"/>';
    s += '<circle cx="' + xs(0) + '" cy="' + ys(O.cur.cal.score) + '" r="5" fill="#fff" stroke="#546e7a" stroke-width="2"/><text x="' + (xs(0) + 8) + '" y="' + (ys(O.cur.cal.score) + 14) + '" class="ax">current model (' + O.cur.cal.score.toFixed(0) + ')</text>';
    for (const k of ['A', 'B', 'C']) { const o = O[k]; const on = this.P.results.opt === k; s += '<circle cx="' + xs(o.change) + '" cy="' + ys(o.cal.score) + '" r="' + (on ? 7 : 5) + '" fill="' + (on ? '#1565c0' : '#64b5f6') + '" stroke="#0d47a1"/><text x="' + (xs(o.change) + 6) + '" y="' + (ys(o.cal.score) - 8) + '" font-weight="700">' + k + '</text>'; }
    return s + '</svg><div class="muted calpad">Calibration score against the change of the parameters; each point is a non-dominated simulation.</div>';
  };
  C.drawResChart = function () {
    const R = this.P.results, k = R.opt; const mon = this.monitorList().find(m => m.mid === this.sel.rmon); if (!mon || !this._resChart) return;
    const vars = mon.vars.filter(v => v.var === 'Flow' || v.var === 'Depth'); let vk = this.sel.rv && vars.find(v => v.key === this.sel.rv) ? this.sel.rv : (vars.find(v => v.var === 'Flow') || vars[0]).key; this.sel.rv = vk;
    const all = this.calEvents('all'); if (!this.sel.rev || !all.some(e => e.id === this.sel.rev)) this.sel.rev = (all[0] || {}).id; const ev = all.find(e => e.id === this.sel.rev); if (!ev) return;
    const H = this._resHead; H.innerHTML = '';
    H.append(h('b', null, mon.mid + ' · ' + mon.o.id), vars.length > 1 ? h('select', { onchange: (e) => { this.sel.rv = e.target.value; this.drawResChart(); } }, vars.map(v => h('option', { value: v.key, selected: v.key === vk }, v.var))) : h('span', { class: 'muted' }, vars[0].var.toLowerCase()),
      h('label', null, 'Event ', h('select', { onchange: (e) => { this.sel.rev = e.target.value; this.drawResChart(); } }, all.map(e => h('option', { value: e.id, selected: e.id === ev.id }, e.id + ' (' + e.use.toLowerCase() + ')')))));
    const w = this.eventWindow(ev); const cut = (s) => { if (!s) return null; const a = lb(s.t, w[0]), b = lb(s.t, w[1]); return { x: Array.from(s.t.slice(a, b)), y: Array.from(s.v.slice(a, b)) }; };
    const obs = cut(this.series(vk)); const cur = cut(this.resSeries.get('cur|' + ev.id + '|' + vk)); const op = cut(this.resSeries.get(k + '|' + ev.id + '|' + vk));
    const S = []; if (obs) S.push(Object.assign({ name: 'Observed', color: '#263238', width: 0.01, marker: 'circle' }, obs.x.length > 400 ? thin(obs, 400) : obs)); if (op) S.push(Object.assign({ name: 'Option ' + (k === 'E' ? 'Edited' : k), color: '#1565c0', width: 2.2 }, op)); if (cur) S.push(Object.assign({ name: 'Current model', color: '#78909c', dash: [6, 4], width: 2 }, cur)); // current drawn last (dashed, on top)
    const M = this.P.monitors[vk]; this._resChart.setSeries(S, { xFix: w, xFmt: fmtShort, yLabel: M.var + ' (' + this.modelUnit(M.var) + ')', xLabel: 'Date / time', title: '' });
    // stats line
    const s = this.scored().find(x => x.key === vk); const st = this._resStats; st.innerHTML = '';
    if (cur && op && cur.y.length === op.y.length) { let mx = 0, d = 0; for (let i = 0; i < op.y.length; i++) { mx = Math.max(mx, Math.abs(cur.y[i])); d = Math.max(d, Math.abs(op.y[i] - cur.y[i])); }
      if (mx > 0 && d <= 0.005 * mx) st.appendChild(h('div', { class: 'muted', style: { marginBottom: '4px' } }, 'Option ' + (k === 'E' ? 'Edited' : k) + ' and the current model give the same ' + M.var.toLowerCase() + ' here (largest difference ' + AV.fmt(d, 4) + ' ' + this.modelUnit(M.var) + '): the parameters changed in this option do not reach ' + mon.o.id + ', so the two lines lie on top of each other.')); }
    if (s && op) { const run = this.runFromSeries(k, ev.id); const Mx = this.metrics(s, ev, run); if (Mx) { const cks = this.checksFor(s, ev, Mx, this.critRows()); st.append(...cks.map(c => h('span', { class: 'calstat ' + (c.s === 1 ? 'good' : c.s > 0 ? 'mid' : 'bad') }, c.txt + (c.s === 1 ? ' ✓' : ' ✕'))));
      const one = this.scoreRuns({ [ev.id]: run }, [ev]); const p = one.per[mon.mid]; if (p) st.append(h('span', { class: 'muted' }, ' · score ' + p.s.toFixed(0) + ' in this event')); } }
  };
  function thin(s, n) { const k = Math.ceil(s.x.length / n); return { x: s.x.filter((v, i) => i % k === 0), y: s.y.filter((v, i) => i % k === 0) }; }
  C.runFromSeries = function (k, eid) { const out = { s: {} }; for (const s of this.scored()) { const r = this.resSeries.get(k + '|' + eid + '|' + s.key); if (r) { out.s[s.key] = r.v; out.t0 = r.t[0] - (r.t.length > 1 ? r.t[1] - r.t[0] : 0); out.step = r.t.length > 1 ? r.t[1] - r.t[0] : 1 / 288; } } return out; };
  C.renderDiag = function () {
    const el = this._diag; if (!el) return; el.innerHTML = ''; const R = this.P.results; const O = R.options; const mid = this.sel.rmon; const p = O[R.opt].all.per[mid]; if (!p || p.s >= 50) return;
    const mon = this.monitorList().find(m => m.mid === mid); const all = this.calEvents('all'); const vars = this.scored().filter(s => s.mid === mid); const rows = this.critRows();
    // structural: the same check misses in the same direction in every event for every option
    let struct = null; for (const s of vars) for (const key of ['peak', 'vol', 'depthU', 'depthS', 'depthL']) { const signs = []; let mag = [];
      for (const k of ['cur', 'A', 'B', 'C']) for (const ev of all) { const run = this.runFromSeries(k, ev.id); const M = this.metrics(s, ev, run); if (!M) continue; const c = this.checksFor(s, ev, M, rows).find(x => x.key === key); if (!c) continue; signs.push(c.s < 1 ? Math.sign(c.d) : 0); mag.push(c.d); }
      if (signs.length >= 4 && signs.every(x => x === signs[0] && x !== 0)) { struct = { s, key, lo: Math.min(...mag), hi: Math.max(...mag), sign: signs[0] }; break; } }
    const zoom = () => { this.app.select(mon.o); this.app.map && this.app.map.zoomToObjects([mon.o]); this.toMap(mid + ' = ' + mon.o.id); };
    const excl = () => { this.P.weights[mid] = 0; this.touch(); this.go(3); AV.toast(mid + ' is no longer scored (weight 0). Start the calibration again.', false, 6000); };
    if (struct) { const u = this.si ? 'm' : 'ft'; const isDepth = struct.key.startsWith('depth'); const lim = (v) => isDepth && !this.critRows().find(r => r.key === struct.key && r.unit === '%') ? Math.abs(v).toFixed(2) + ' ' + u : Math.abs(v).toFixed(0) + ' %';
      const what = isDepth ? 'the modelled depth is ' + lim(struct.lo) + '–' + lim(struct.hi) + (struct.sign > 0 ? ' too high' : ' too low') : 'the modelled ' + (struct.key === 'vol' ? 'volume' : 'peak') + ' is ' + lim(struct.lo) + '–' + lim(struct.hi) + (struct.sign > 0 ? ' too large' : ' too small');
      const hint = isDepth ? 'Check: an overflow weir or control near ' + mon.o.id + ', a blocked or missing connection, downstream boundary, the survey level of the sensor.' : struct.sign < 0 ? 'The observed volume is larger than the model can produce: a missing connection that brings more area to ' + mon.o.id + ', groundwater / infiltration not in the model, or a flow meter calibration error.' : 'The model produces more than observed: area connected to ' + mon.o.id + ' that drains elsewhere, a diversion or storage not in the model, or a flow meter error.';
      el.appendChild(h('div', { class: 'calwarn' }, h('b', null, '⚠ ' + mid + ' (' + mon.o.id + ') cannot be matched with physical parameters'), h('div', null, 'In every option and every event ' + what + ', and no parameter within its range moves it. This points to the model or the data, not to the parameters. ' + hint),
        h('div', { class: 'btns' }, h('button', { class: 'btn small', onclick: zoom }, 'Zoom to ' + mon.o.id), h('button', { class: 'btn small', onclick: excl }, 'Exclude ' + mid + ' and re-run')))); }
    else el.appendChild(h('div', { class: 'calwarn' }, h('b', null, mid + ' scores low in option ' + R.opt), h('div', null, 'The misses are not the same in every event, so parameters can still change them: check the data of this monitor in step 2, or raise its weight in step 4 and run again.'), h('div', { class: 'btns' }, h('button', { class: 'btn small', onclick: zoom }, 'Zoom to ' + mon.o.id))));
  };
  C.renderParChanges = function () {
    const pc = this._parCard; if (!pc) return; pc.innerHTML = ''; const R = this.P.results, k = R.opt, O = R.options[k]; const rows = this.P.params.rows.filter(r => (this.P.run.rows || []).includes(r.id));
    pc.appendChild(h('div', { class: 'calch' }, h('b', null, 'Parameter changes – option ' + (k === 'E' ? 'Edited' : k)), h('span', { class: 'muted' }, 'tick to accept; New can be edited')));
    const tb = h('table', { class: 'caltbl calpc' }); pc.appendChild(h('div', { class: 'calscroll', style: { maxHeight: '360px' } }, tb));
    tb.appendChild(h('tr', null, h('th', null, 'Accept'), h('th', null, 'Parameter group'), h('th', { class: 'n' }, 'Current'), h('th', { class: 'n' }, 'New'), h('th', null, 'Range')));
    this.sel.open = this.sel.open || {};
    rows.forEach((r, i) => { const d = PARAMS[r.param]; const v = R.newv[r.id] !== undefined ? R.newv[r.id] : O.x[i]; const atLim = Math.abs(v - r.min) / Math.max(1e-12, r.max - r.min) < 0.02 || Math.abs(v - r.max) / Math.max(1e-12, r.max - r.min) < 0.02;
      const inp = h('input', { class: 'cell' + (R.newv[r.id] !== undefined ? ' edited' : ''), value: v, style: { width: '70px' }, onchange: (e) => { const x = +e.target.value; if (!isFinite(x)) { e.target.value = v; return; } if (x < r.min || x > r.max) { AV.toast('Outside the range ' + r.min + '–' + r.max + ' of step 3.', true); e.target.value = v; return; } R.newv[r.id] = x; this._dirtyNew = true; this.touch(); this.renderParChanges(); this.renderApply(); } });
      const unit = this.pDef(r.param).unit;
      tb.appendChild(h('tr', null, h('td', null, h('input', { type: 'checkbox', checked: !!R.acc[r.id], onchange: (e) => { R.acc[r.id] = e.target.checked; this.touch(); this.renderApply(); } })),
        h('td', null, h('button', { class: 'btn small', style: { padding: '0 6px', marginRight: '4px' }, onclick: () => { this.sel.open[r.id] = !this.sel.open[r.id]; this.renderParChanges(); } }, this.sel.open[r.id] ? '▾' : '▸'), d.l + ' – ' + r.group.label + ' (' + this.groupObjs(r.group, d.obj).length + ')'),
        h('td', { class: 'n nowrap' }, r.how === 'factor' ? '× 1.00' : r.cur + (unit ? ' ' + unit : '')), h('td', { class: 'n nowrap' }, r.how === 'factor' ? '× ' : '', inp, atLim ? h('span', { title: 'at the limit of its range', style: { color: '#ef6c00' } }, ' ⚠') : ''), h('td', { class: 'muted nowrap' }, r.min + '–' + r.max)));
      if (this.sel.open[r.id]) { const objs = this.groupObjs(r.group, d.obj); const sq = h('input', { type: 'text', placeholder: 'Search…', style: { width: '140px', marginBottom: '4px' } }); const t2 = h('table', { class: 'caltbl inner' });
        const f2 = () => { const q = sq.value.toLowerCase(); t2.innerHTML = '<tr><th>' + (d.obj === 'C' ? 'Conduit' : 'Subcatchment') + '</th><th class="n">Old ' + esc(d.l) + '</th><th class="n">New</th></tr>'; let n = 0;
          for (const o of objs) { if (q && !o.id.toLowerCase().includes(q)) continue; if (++n > 200) { t2.insertAdjacentHTML('beforeend', '<tr><td colspan="3" class="muted">… ' + (objs.length - 200) + ' more (search to find one)</td></tr>'); break; } const old = d.get(o); const tmp = { p: Object.assign({}, o.p) }; d.put(tmp, r.how === 'factor' ? old * v : v); const nw = d.get(tmp);
            t2.insertAdjacentHTML('beforeend', '<tr><td>' + esc(o.id) + '</td><td class="n">' + AV.fmt(old) + '</td><td class="n">' + AV.fmt(nw) + '</td></tr>'); } };
        sq.oninput = f2; f2(); tb.appendChild(h('tr', { class: 'det' }, h('td'), h('td', { colspan: 4 }, sq, t2))); } });
    pc.appendChild(h('div', { class: 'calpad', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('button', { class: 'btn small', disabled: !this._dirtyNew || !!this._busy, onclick: () => this.recheck() }, this._busy ? 'Running…' : 'Re-check Score'), h('span', { class: 'muted' }, this._dirtyNew ? 'Values edited – click Re-check Score before applying.' : 'Edited values are run again for all events before they can be applied.')));
  };
  C.recheck = async function () {
    const R = this.P.results, k = R.opt, O = R.options[k]; const rows = this.P.params.rows.filter(r => (this.P.run.rows || []).includes(r.id)); const x = rows.map((r, i) => R.newv[r.id] !== undefined ? R.newv[r.id] : O.x[i]);
    const all = this.calEvents('all'); this._busy = true; this.renderParChanges(); this._stop = false; this._running = new Set(); this._seq = this._seq || 0; this._pool = this.pool(await this.parallel());
    try { const r = (await this.evaluate([x], all, true))[0]; const cal = this.calEvents('cal').map(e => e.id), val = this.calEvents('val').map(e => e.id);
      for (const [eid, run] of Object.entries(r.runs)) for (const [key, arr] of Object.entries(run.s)) { const t = new Float64Array(arr.length); for (let j = 0; j < arr.length; j++) t[j] = run.t0 + (j + 1) * run.step; this.resSeries.set('E|' + eid + '|' + key, { t, v: arr }); }
      R.options.E = { x, tag: 'edited values', all: { score: r.score, per: r.per, met: r.met }, cal: this.scoreRuns(r.runs, all.filter(e => cal.includes(e.id))), val: val.length ? this.scoreRuns(r.runs, all.filter(e => val.includes(e.id))) : null, change: this.change(x) };
      const acc = Object.assign({}, R.acc); R.opt = 'E'; R.newv = {}; R.acc = acc; this._dirtyNew = false; await this.saveRes(); this.touch(); }
    catch (e) { AV.alert(e.message, 'Re-check Score'); }
    this._busy = false; this.render();
  };
  C.renderApply = function () {
    const ap = this._applyCard; if (!ap) return; ap.innerHTML = ''; const R = this.P.results; const rows = this.P.params.rows.filter(r => (this.P.run.rows || []).includes(r.id)); const n = rows.filter(r => R.acc[r.id]).length;
    const mname = AV.basename(this.app.filePath); const ra = h('input', { type: 'checkbox', checked: R.runAll !== false, onchange: (e) => { R.runAll = e.target.checked; this.touch(); } });
    ap.append(h('div', { class: 'calch' }, h('b', null, 'Apply to model')), h('div', { class: 'calpad' }, 'Writes the ', h('b', null, 'accepted'), ' groups into ' + mname + ' as one step (Ctrl+Z undoes it). Every changed value is recorded in the change history under the user ', h('b', null, 'System'), ' (role ', h('i', null, 'system'), '), with the note “Calibration – ' + this.P.name + ', option ' + (R.opt === 'E' ? 'Edited' : R.opt) + '”; the land-use tags of the subcatchments stay as they are.'),
      h('label', { class: 'calpad', style: { display: 'block' } }, ra, ' Run all events afterwards as named runs (for Comparison)'),
      h('div', { class: 'calpad', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, h('button', { class: 'btn primary', disabled: !n || this._dirtyNew, onclick: () => this.applyOption() }, 'Apply ' + n + ' of ' + rows.length + ' accepted groups'), h('button', { class: 'btn', onclick: () => this.report() }, 'Calibration Report…'), h('button', { class: 'btn', onclick: () => this.exportChanges() }, 'Export CSV')),
      R.applied ? h('div', { class: 'calpad good' }, '✓ Applied ' + new Date(R.applied.at).toLocaleString() + ': option ' + R.applied.opt + ', ' + R.applied.n + ' groups, ' + n0(R.applied.objs) + ' values.') : '');
  };
  C.optValues = function () { const R = this.P.results, O = R.options[R.opt]; const rows = this.P.params.rows.filter(r => (this.P.run.rows || []).includes(r.id)); return rows.map((r, i) => ({ r, v: R.newv[r.id] !== undefined ? R.newv[r.id] : O.x[i] })); };
  C.applyOption = async function () {
    const R = this.P.results; const app = this.app; const L = this.optValues().filter(x => R.acc[x.r.id]); if (!L.length) return;
    const changes = [], undo = [], redo = [];
    for (const { r, v } of L) { const d = PARAMS[r.param]; for (const o of this.groupObjs(r.group, d.obj)) { const before = Object.assign({}, o.p); const tmp = { p: Object.assign({}, o.p) }; d.put(tmp, r.how === 'factor' ? d.get(o) * v : v);
        for (const key of Object.keys(tmp.p)) if (tmp.p[key] !== before[key]) { changes.push({ o, key, old: before[key], nw: tmp.p[key] }); } undo.push([o, before]); redo.push([o, tmp.p]); } }
    const label = 'Calibration – ' + this.P.name + ', option ' + (R.opt === 'E' ? 'Edited' : R.opt);
    if (!await AV.confirm('Apply ' + L.length + ' parameter group(s) to the model (' + n0(changes.length) + ' values)? Ctrl+Z undoes it.', 'Apply to model', 'Apply')) return;
    const ok = app.exec({ label, asUser: { user: 'System', role: 'system' }, do: () => redo.forEach(([o, p]) => { o.p = Object.assign({}, p); }), undo: () => undo.forEach(([o, p]) => { o.p = Object.assign({}, p); }), changes });
    if (ok === false) return;
    if (app.hist && app.hist.commit && app.filePath) { /* the history is committed with the next save */ }
    R.applied = { at: new Date().toISOString(), opt: R.opt === 'E' ? 'Edited' : R.opt, n: L.length, objs: changes.length }; this.touch(); this.renderApply(); await this.save(true);
    AV.toast('Calibration applied: ' + L.length + ' groups, ' + n0(changes.length) + ' values (user System). Save the model to keep it.', false, 7000);
    if (R.runAll !== false) await this.runNamedEvents();
  };
  C.runNamedEvents = async function () {
    const app = this.app; const dir = AV.resultsDir(app.filePath); await window.host.mkdir(dir); const all = this.calEvents('all'); const R = this.P.results; let ok = 0;
    for (const ev of all) { const name = 'Calib ' + (R.opt === 'E' ? 'Edited' : R.opt) + ' ' + ev.id; app.status('Running ' + name + ' (' + (ok + 1) + ' of ' + all.length + ')…');
      const save = app.model.report.slice(); let text; try { text = this.eventInp(ev, null, true); } finally { app.model.report = save; }
      const res = await window.host.runEngine({ inpText: AV.runDataPaths(text, AV.dirname(app.filePath), dir), dir, base: name, named: true, id: 'calnamed' });
      if (res.code === 0) { ok++; await AV.writeRunMeta(dir, name, { name, desc: 'Calibration ' + this.P.name + ', ' + ev.id + ' (' + ev.use.toLowerCase() + '), observed rainfall', date: new Date().toISOString(), model: AV.basename(app.filePath), type: '1D', flowUnits: app.model.flowUnits, code: 0, seconds: res.seconds, massBal: res.massBal }); } }
    app.status(''); AV.toast(ok + ' of ' + all.length + ' event runs saved in the Database (named "Calib …"); open them in Comparison.', false, 7000);
  };
  C.exportScores = function () { const R = this.P.results, O = R.options; const ks = ['cur', 'A', 'B', 'C'].concat(O.E ? ['E'] : []); const mons = this.monitorList().filter(m => O.cur.all.per[m.mid]);
    const lines = [['Monitor', 'Object', 'Type'].concat(ks.map(k => 'Score ' + (k === 'cur' ? 'current' : k)), ['Largest miss (' + R.opt + ')']).map(AV.csvCell).join(',')];
    for (const m of mons) lines.push([m.mid, m.o.id, m.vars.map(v => v.var).join('+')].concat(ks.map(k => O[k].all.per[m.mid] ? O[k].all.per[m.mid].s : ''), [O[R.opt].all.per[m.mid] ? O[R.opt].all.per[m.mid].worst : '']).map(AV.csvCell).join(','));
    AV.downloadText(lines.join('\r\n'), 'Calibration_scores_' + this.P.name.replace(/\W+/g, '_') + '.csv'); };
  C.exportChanges = function () { const lines = [['Group', 'Parameter', 'Object', 'Old', 'New', 'Accepted'].map(AV.csvCell).join(',')]; const R = this.P.results;
    for (const { r, v } of this.optValues()) { const d = PARAMS[r.param]; for (const o of this.groupObjs(r.group, d.obj)) { const old = d.get(o); const tmp = { p: Object.assign({}, o.p) }; d.put(tmp, r.how === 'factor' ? old * v : v); lines.push([r.group.label, d.l, o.id, old, d.get(tmp), R.acc[r.id] ? 'yes' : 'no'].map(AV.csvCell).join(',')); } }
    AV.downloadText(lines.join('\r\n'), 'Calibration_changes_' + this.P.name.replace(/\W+/g, '_') + '.csv'); };
  C.report = async function () {
    const P = this.P, R = P.results, O = R.options; const T = (rows, head) => '<table><tr>' + head.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr>' + rows.map(r => '<tr>' + r.map(x => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('') + '</table>';
    const ks = ['cur', 'A', 'B', 'C'].concat(O.E ? ['E'] : []); const nm = (k) => k === 'cur' ? 'Current model' : k === 'E' ? 'Edited' : 'Option ' + k;
    const mons = this.monitorList().filter(m => O.cur.all.per[m.mid]); const crit = this.critRows();
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>Calibration report – ' + esc(P.name) + '</title><style>body{font:13px Segoe UI,Arial,sans-serif;margin:24px;color:#1f2933}h1{font-size:20px}h2{font-size:15px;margin-top:22px;border-bottom:1px solid #ccd;padding-bottom:3px}table{border-collapse:collapse;margin:6px 0}td,th{border:1px solid #d4d9df;padding:3px 8px;text-align:left}th{background:#f2f4f7}.muted{color:#637081}</style></head><body>'
      + '<h1>Calibration report – ' + esc(P.name) + '</h1><div class="muted">Model ' + esc(AV.basename(this.app.filePath)) + ' · ' + new Date().toLocaleString() + ' · Avaris2 CS Auto Calibration</div>'
      + '<h2>1 Observed data</h2>' + T(P.files.map(f => [AV.basename(f.file), f.layout, f.dateFmt, f.rows]), ['File', 'Layout', 'Date format', 'Rows'])
      + T(this.monitorList().map(m => [m.mid, m.o ? m.o.id : '(not linked)', m.vars.map(v => v.var + ' (' + (v.unit || 'model units') + ')').join(', '), this.weightOf(m)]), ['Monitor', 'Model object', 'Data', 'Weight'])
      + '<h2>2 Data cleaning</h2>' + (P.cleaning.results.length ? T(P.cleaning.results.map(r => [r.mid, r.var, r.method, r.n, r.what || '', r.flagOnly ? 'flag only' : r.decision]), ['Monitor', 'Variable', 'Method', 'Values', 'Change', 'Decision']) : '<p>No cleaning.</p>') + '<p>Confirmed ' + esc(P.cleaning.confirmedAt || '') + ' by ' + esc(P.cleaning.confirmedBy || '') + '</p>'
      + '<h2>3 Events</h2>' + T(P.events.list.map(e => [e.id, fmtT(e.t0), e.dur.toFixed(1), AV.fmt(e.depth, 1), e.use]), ['Event', 'Start', 'Duration (h)', 'Rain', 'Use'])
      + '<h2>4 Parameters</h2>' + T(P.params.rows.map(r => [r.group.label, PARAMS[r.param].l, r.how, r.cur, r.min, r.max, r.reason, r.sens ? r.sens.cls : '–', r.on ? 'calibrated' : 'kept']), ['Group', 'Parameter', 'How', 'Current', 'Min', 'Max', 'Range from', 'Sensitivity', 'Status'])
      + '<p>Penalty for change: ' + PENALTY[P.params.penalty] + ' · upstream of the monitors only: ' + (P.params.upOnly ? 'yes' : 'no') + '</p>'
      + '<h2>5 Criteria and search</h2><p>' + esc(STD[P.criteria.std].name) + (Object.keys(P.criteria.edit).length ? ' (edited)' : '') + '</p>' + T(crit.map(c => [c.label, c.apply, isFinite(c.lo) ? c.lo : '', isFinite(c.hi) ? c.hi : '', c.unit, c.w]), ['Check', 'Applies to', 'Lower', 'Upper', 'Unit', 'Weight'])
      + '<p>' + esc((METHODS.find(m => m[0] === P.run.method) || [])[1] || '') + ' · ' + P.run.evals.length + ' simulations · events ' + esc(P.run.events.join(', ')) + '</p>'
      + '<h2>6 Results</h2>' + T(ks.map(k => [nm(k), O[k].cal.score.toFixed(1), O[k].val ? O[k].val.score.toFixed(1) : '–', O[k].all.met + ' of ' + (O.cur.all.met !== undefined ? mons.length : ''), O[k].change.toFixed(1) + ' %']), ['', 'Calibration score', 'Validation score', 'Monitors meeting the criteria', 'Mean change'])
      + T(mons.map(m => [m.mid, m.o.id].concat(ks.map(k => O[k].all.per[m.mid] ? O[k].all.per[m.mid].s.toFixed(0) : ''), [O[R.opt].all.per[m.mid].worst])), ['Monitor', 'Object'].concat(ks.map(nm), ['Largest miss (' + nm(R.opt) + ')']))
      + T(this.optValues().map(({ r, v }) => [r.group.label, PARAMS[r.param].l, r.how === 'factor' ? '× 1.00' : r.cur, (r.how === 'factor' ? '× ' : '') + v, R.acc[r.id] ? 'accepted' : '']), ['Group', 'Parameter', 'Current', nm(R.opt), ''])
      + (R.applied ? '<p>Applied ' + esc(R.applied.at) + ': option ' + esc(R.applied.opt) + ', ' + R.applied.n + ' groups, ' + R.applied.objs + ' values (user System).</p>' : '<p>Not applied to the model yet.</p>')
      + '</body></html>';
    const p = AV.joinPath(this.folder(), P.name + ' – report.html'); await window.host.writeText(p, html); AV.toast('Report saved: ' + p, false, 7000); window.host.showItem(p);
  };
})(window.AV);
