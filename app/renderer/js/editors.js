// Section text editor, curve & time-series editors, hyetograph (design storm) generator
'use strict';
(function (AV) {
  const h = AV.h;
  const SECTION_HELP = {
    INFLOWS: ';;Node  Constituent  Time Series  Type  Mfactor  Sfactor  Baseline  Pattern\n;;e.g.  J1  FLOW  Hydro1  FLOW  1.0  1.0  0.5',
    DWF: ';;Node  Constituent  Baseline  Patterns\n;;e.g.  J1  FLOW  0.25  "" "Hourly1"',
    CONTROLS: ';;RULE R1\n;;IF NODE ST1 DEPTH > 5\n;;THEN PUMP P1 STATUS = ON\n;;ELSE PUMP P1 STATUS = OFF\n;;PRIORITY 1',
    EVAPORATION: ';;Data Source  Parameters\n;;CONSTANT 0.0 | MONTHLY 12 values | TIMESERIES name | TEMPERATURE | FILE',
    PATTERNS: ';;Name  Type  Multipliers\n;;e.g.  Hourly1  HOURLY  0.5 0.4 0.4 ... (24 values)',
    TRANSECTS: ';;HEC-2 style: NC / X1 / GR lines',
    POLLUTANTS: ';;Name  Units  Crain  Cgw  Crdii  Kdecay  SnowOnly  Co-Pollutant  Co-Frac  Cdwf  Cinit',
    LANDUSES: ';;Name  SweepInterval  Availability  LastSweep',
    HYDROGRAPHS: ';;Hydrograph  RainGage/Month  Response  R  T  K  Dmax  Drecov  Dinit',
    RDII: ';;Node  UnitHydrograph  SewerArea',
    AQUIFERS: ';;Name  Por  WP  FC  Ksat  Kslope  Tslope  ETu  ETs  Seep  Ebot  Egw  Umc  ETupat',
    GROUNDWATER: ';;Subcatchment  Aquifer  Node  Esurf  A1  B1  A2  B2  A3  Dsw  Egwt  Ebot  Wgr  Umc',
    LID_CONTROLS: ';;Name  Type/Layer  Parameters',
    LID_USAGE: ';;Subcatchment  LID Process  Number  Area  Width  InitSat  FromImp  ToPerv  RptFile  DrainTo  FromPerv',
    TEMPERATURE: ';;Data Element  Values',
    __REPORT: ';;e.g.\n;;INPUT NO\n;;CONTROLS NO\n;;SUBCATCHMENTS ALL\n;;NODES ALL\n;;LINKS ALL\n;;(Runs from this program always save results for all objects.)',
  };

  AV.openSectionEditor = function (app, sec, label) {
    const m = app.model; const isRep = sec === '__REPORT';
    const get = () => isRep ? m.report.slice() : (m.raw[sec] || []).slice();
    const ta = h('textarea', { spellcheck: 'false', style: { flex: 1, border: 0, padding: '10px 14px', font: '12.5px/1.5 var(--mono)', resize: 'none', outline: 'none' } }, get().join('\n'));
    const help = SECTION_HELP[sec] ? h('pre', { style: { margin: 0, padding: '6px 14px', background: '#f6f8fa', color: 'var(--muted)', font: '11.5px var(--mono)', borderBottom: '1px solid var(--border)' } }, SECTION_HELP[sec]) : null;
    const save = () => {
      const lines = ta.value.split('\n').map(l => l.replace(/\s+$/, '')).filter((l, i, a) => l.trim() || (i > 0 && i < a.length - 1));
      const old = get();
      app.exec({
        label: 'Edit [' + (isRep ? 'REPORT' : sec) + ']',
        do: () => { if (isRep) m.report = lines.filter(l => l.trim()); else { m.raw[sec] = lines; if (!m.rawOrder.includes(sec)) m.rawOrder.push(sec); } },
        undo: () => { if (isRep) m.report = old; else m.raw[sec] = old; },
      });
      AV.toast('[' + (isRep ? 'REPORT' : sec) + '] updated.');
    };
    const view = h('div', null, h('div', { class: 'grid-tools' }, h('b', null, '[' + (isRep ? 'REPORT' : sec) + '] ' + label), h('button', { class: 'btn small primary', onclick: save }, 'Apply Changes'), h('button', { class: 'btn small', onclick: () => { ta.value = get().join('\n'); } }, 'Revert'),
      h('span', { style: { color: 'var(--muted)' } }, 'Free-form SWMM input lines. Lines starting with ; are comments.')), help, ta);
    view.style.display = 'flex'; view.style.flexDirection = 'column';
    app.closeView('sec-' + sec); app.addView('sec-' + sec, label, view);
  };

  // ------------------------------------------------------------------ curves
  const CURVE_TYPES = ['STORAGE', 'SHAPE', 'DIVERSION', 'TIDAL', 'PUMP1', 'PUMP2', 'PUMP3', 'PUMP4', 'PUMP5', 'RATING', 'CONTROL', 'WEIR'];
  const CURVE_AXES = { STORAGE: ['Depth', 'Area'], SHAPE: ['Depth/Full', 'Width/Full'], DIVERSION: ['Inflow', 'Outflow'], TIDAL: ['Hour', 'Stage'], PUMP1: ['Volume', 'Flow'], PUMP2: ['Depth', 'Flow'], PUMP3: ['Head', 'Flow'], PUMP4: ['Depth', 'Flow'], PUMP5: ['Head', 'Flow'], RATING: ['Head/Depth', 'Outflow'], CONTROL: ['Control var.', 'Setting'], WEIR: ['Head', 'Coefficient'] };
  AV.newCurve = async function (app) {
    const r = await AV.formDialog('New Curve', [{ k: 'name', l: 'Name', t: 'text' }, { k: 'type', l: 'Type', t: 'choice', o: CURVE_TYPES }], { name: 'Curve' + (app.model.curves.size + 1), type: 'STORAGE' });
    if (!r || !r.name.trim()) return; const name = r.name.trim().replace(/\s+/g, '_');
    if (app.model.curves.has(name)) { AV.toast('Curve already exists.', true); return; }
    const c = { type: r.type, pts: [[0, 0], [1, 1]] };
    app.exec({ label: 'New curve', do: () => app.model.curves.set(name, c), undo: () => app.model.curves.delete(name) });
    AV.openCurveEditor(app, name);
  };
  AV.openCurveEditor = function (app, name) { pairEditor(app, 'curve', name); };
  AV.newTimeSeries = async function (app) {
    const r = await AV.formDialog('New Time Series', [{ k: 'name', l: 'Name', t: 'text' }], { name: 'TS' + (app.model.timeseries.size + 1) });
    if (!r || !r.name.trim()) return; const name = r.name.trim().replace(/\s+/g, '_');
    if (app.model.timeseries.has(name)) { AV.toast('Time series already exists.', true); return; }
    const ts = { file: null, rows: [['', '0:00', 0], ['', '1:00', 0]] };
    app.exec({ label: 'New time series', do: () => app.model.timeseries.set(name, ts), undo: () => app.model.timeseries.delete(name) });
    AV.openTSEditor(app, name);
  };
  AV.openTSEditor = function (app, name) { pairEditor(app, 'ts', name); };

  function pairEditor(app, kind, name) {
    const m = app.model; const isTS = kind === 'ts';
    const obj = isTS ? m.timeseries.get(name) : m.curves.get(name); if (!obj) return;
    const toText = () => isTS ? obj.rows.map(r => [r[0], r[1], r[2]].filter((x, i) => i || x).join('\t')).join('\n') : obj.pts.map(p => p.join('\t')).join('\n');
    const ta = h('textarea', { spellcheck: 'false', style: { width: '300px', border: 0, borderRight: '1px solid var(--border)', padding: '8px 10px', font: '12.5px/1.5 var(--mono)', resize: 'none', outline: 'none' } }, toText());
    const typeSel = isTS ? null : h('select', null, CURVE_TYPES.map(t => h('option', { value: t }, t)));
    if (typeSel) typeSel.value = (obj.type || 'STORAGE').toUpperCase();
    const fileInp = isTS ? h('input', { type: 'text', value: obj.file || '', placeholder: '(optional external file)', style: { width: '220px' } }) : null;
    const chartHost = h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 } });
    const chart = new AV.Chart(chartHost, {});
    const parse = () => {
      const rows = [];
      for (const line of ta.value.split('\n')) {
        const t = line.trim().split(/[\s,;\t]+/).filter(Boolean); if (!t.length || t[0].startsWith(';')) continue;
        if (isTS) { if (t.length >= 3) rows.push([t[0], t[1], parseFloat(t[2])]); else if (t.length === 2) rows.push(['', t[0], parseFloat(t[1])]); }
        else if (t.length >= 2) rows.push([parseFloat(t[0]), parseFloat(t[1])]);
      }
      return rows;
    };
    const preview = () => {
      const rows = parse();
      let x, y;
      if (isTS) {
        const d0 = rows.find(r => r[0]) ? AV.parseSwmmDate(rows.find(r => r[0])[0], '0:00') : null; let lastDate = '';
        x = []; y = [];
        for (const r of rows) { if (r[0]) lastDate = r[0]; const t = lastDate && d0 !== null ? (AV.parseSwmmDate(lastDate, r[1].includes(':') ? r[1] : '0:00') - d0) * 24 + (r[1].includes(':') ? 0 : parseFloat(r[1])) : (r[1].includes(':') ? AV.hmsToSec(r[1]) / 3600 : parseFloat(r[1])); x.push(t); y.push(r[2]); }
        const rain = [...m.gages.values()].some(g => g.p.series === name && g.p.source !== 'FILE');
        chart.setSeries([{ name, x: Float64Array.from(x), y: Float32Array.from(y), steps: false, bars: rain, color: rain ? '#7e57c2' : undefined }], { invert: rain && app.prefs.invertRain, xLabel: 'Hours', yLabel: rain ? 'Rainfall' : 'Value', title: 'Time Series ' + name });
      } else {
        const ax = CURVE_AXES[typeSel.value] || ['X', 'Y'];
        chart.setSeries([{ name, x: Float64Array.from(rows.map(r => r[0])), y: Float32Array.from(rows.map(r => r[1])) }], { xLabel: ax[0], yLabel: ax[1], title: typeSel.value + ' Curve ' + name });
      }
    };
    ta.addEventListener('input', AV.debounce(preview, 300));
    const save = () => {
      const rows = parse();
      if (!isTS && rows.some(r => !isFinite(r[0]) || !isFinite(r[1]))) { AV.toast('All values must be numeric.', true); return; }
      if (isTS && rows.some(r => !isFinite(r[2]))) { AV.toast('Values must be numeric.', true); return; }
      const old = isTS ? { file: obj.file, rows: obj.rows } : { type: obj.type, pts: obj.pts };
      const nw = isTS ? { file: fileInp.value.trim() || null, rows } : { type: typeSel.value, pts: rows };
      app.exec({ label: 'Edit ' + name, do: () => Object.assign(obj, nw), undo: () => Object.assign(obj, old) });
      AV.toast(name + ' updated.');
    };
    const del = async () => {
      if (!await AV.confirm('Delete ' + (isTS ? 'time series ' : 'curve ') + name + '?', 'Delete', 'Delete')) return;
      const coll = isTS ? m.timeseries : m.curves;
      const entries = [...coll.entries()];
      app.exec({ label: 'Delete ' + name, do: () => coll.delete(name), undo: () => { coll.clear(); for (const [k, v] of entries) coll.set(k, v); } });
      app.closeView(kind + '-' + name);
    };
    const tools = h('div', { class: 'grid-tools' }, h('b', null, (isTS ? 'Time Series ' : 'Curve ') + name), typeSel ? h('span', null, 'Type ', typeSel) : null, fileInp ? h('span', null, 'File ', fileInp) : null,
      h('button', { class: 'btn small primary', onclick: save }, 'Apply'), h('button', { class: 'btn small', onclick: () => { ta.value = toText(); preview(); } }, 'Revert'),
      h('button', { class: 'btn small danger', onclick: del }, 'Delete'),
      h('span', { style: { color: 'var(--muted)' } }, isTS ? 'One row per line: [date] time value (tab/space separated; paste from Excel).' : 'One row per line: x y (paste from Excel).'));
    if (typeSel) typeSel.addEventListener('change', preview);
    const view = h('div', null, tools, h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, ta, chartHost));
    view.style.display = 'flex'; view.style.flexDirection = 'column';
    app.closeView(kind + '-' + name); app.addView(kind + '-' + name, (isTS ? 'TS: ' : 'Curve: ') + name, view);
    setTimeout(() => { chart.resize(); preview(); }, 30);
  }

  // ------------------------------------------------------------------ hyetograph
  const SCS2 = [[0, 0], [1, .011], [2, .022], [3, .035], [4, .048], [5, .063], [6, .080], [7, .098], [8, .120], [8.5, .133], [9, .147], [9.5, .163], [10, .181], [10.5, .204], [11, .235], [11.5, .283], [11.75, .357], [12, .663], [12.5, .735], [13, .772], [13.5, .799], [14, .820], [14.5, .838], [15, .854], [16, .880], [17, .902], [18, .921], [19, .938], [20, .952], [21, .965], [22, .977], [23, .989], [24, 1]];
  const interp = (tab, x) => { if (x <= tab[0][0]) return tab[0][1]; for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return tab[tab.length - 1][1]; };

  AV.designStorm = function (p) {
    // returns intensities (depth/hr) for blocks of p.step minutes over p.dur minutes
    const n = Math.max(1, Math.round(p.dur / p.step)); const dt = p.step; const D = n * dt; let cum;
    if (p.method === 'chicago') {
      const a = p.a, b = p.b, c = p.c, r = Math.min(0.99, Math.max(0.01, p.r)); const tp = r * D;
      const Fb = (x) => x <= 0 ? 0 : x * a / Math.pow(x / r + b, c) / 60, Fa = (x) => x <= 0 ? 0 : x * a / Math.pow(x / (1 - r) + b, c) / 60;
      cum = (t) => t <= tp ? Fb(tp) - Fb(tp - t) : Fb(tp) + Fa(t - tp);
    } else if (p.method === 'uniform') cum = (t) => p.depth * t / D;
    else if (p.method === 'triangular') { const r = Math.min(1, Math.max(0, p.r)); const tp = r * D; const ip = 2 * p.depth / D; cum = (t) => t <= tp ? (tp ? 0.5 * ip * t * t / tp : 0) : p.depth - (D - tp ? 0.5 * ip * (D - t) * (D - t) / (D - tp) : 0); }
    else if (p.method === 'scs2') cum = (t) => p.depth * interp(SCS2, t / 60 * 24 / (D / 60));
    else if (p.method === 'custom' && p.pattern) { const c = [0]; p.pattern.forEach(v => c.push(c[c.length - 1] + Math.max(0, v))); const s = c[c.length - 1] || 1; const tab = c.map((v, i) => [i / p.pattern.length, v / s]); cum = (t) => p.depth * interp(tab, t / D); }
    else if (p.method === 'custom') { const tab = p.table; const T = tab[tab.length - 1][0]; cum = (t) => p.depth * interp(tab, t / D * T) / tab[tab.length - 1][1]; }
    const out = []; for (let i = 0; i < n; i++) out.push((cum((i + 1) * dt) - cum(i * dt)) / (dt / 60));
    return out;
  };

  // Design Storm dialog (v2.0.9): method buttons, parameters on the left, live hyetograph on the right,
  // custom pattern edited as % per interval or cumulative %, drawn on the chart, pasted from Excel or taken from presets;
  // invalid patterns (decreasing cumulative / negative values) are marked and cannot be added.
  const STORM_METHODS = [['chicago', 'Chicago', 'IDF a/(t+b)^c'], ['scs2', 'SCS Type II', '24-hr, scaled'], ['triangular', 'Triangular', 'peak position'], ['uniform', 'Uniform', 'constant'], ['custom', 'Custom Pattern', 'your own distribution']];
  const fmtN = (v, d = 1) => String(Math.round(v * 10 ** d) / 10 ** d);
  const cumOf = (p) => { const c = [0]; p.forEach(v => c.push(c[c.length - 1] + v)); return c; };
  const sumOf = (p) => p.reduce((s, v) => s + v, 0);
  const chiCum = (P, D) => { const r = Math.min(0.99, Math.max(0.01, P.r)), tp = r * D; const Fb = (x) => x <= 0 ? 0 : x * P.a / Math.pow(x / r + P.b, P.c) / 60, Fa = (x) => x <= 0 ? 0 : x * P.a / Math.pow(x / (1 - r) + P.b, P.c) / 60; return (t) => t <= tp ? Fb(tp) - Fb(tp - t) : Fb(tp) + Fa(t - tp); };
  AV.stormPreset = function (k, n) {
    let w = [];
    if (k === 'scs') for (let i = 0; i < n; i++) w.push(interp(SCS2, (i + 1) / n * 24) - interp(SCS2, i / n * 24));
    else if (k === 'chi') { const cum = chiCum({ a: 60, b: 10, c: 0.8, r: 0.4 }, 120); for (let i = 0; i < n; i++) w.push(cum((i + 1) / n * 120) - cum(i / n * 120)); }
    else { const f = { uni: () => 1, front: (x) => Math.exp(-((x - .2) ** 2) / .03), center: (x) => Math.exp(-((x - .5) ** 2) / .025), rear: (x) => Math.exp(-((x - .78) ** 2) / .03) }[k] || (() => 1); for (let i = 0; i < n; i++) w.push(f((i + .5) / n)); }
    const s = sumOf(w) || 1; const out = w.map(v => +(v / s * 100).toFixed(1)); out[out.length - 1] = +(out[out.length - 1] + 100 - sumOf(out)).toFixed(1); return out;
  };
  // validity of a custom pattern: { level: ok | warn | err, bad: Set(interval index), msg }
  AV.stormPatternCheck = function (pat, mode) {
    const bad = new Set(); pat.forEach((v, i) => { if (!(v >= 0)) bad.add(i); });
    if (bad.size) { const i = [...bad][0]; const c = cumOf(pat); return { level: 'err', bad, msg: mode === 'cum' ? 'Cumulative % must not decrease (interval ' + (i + 1) + ': ' + fmtN(c[i]) + ' → ' + fmtN(c[i + 1]) + ').' : 'Interval ' + (i + 1) + ' is negative: rainfall cannot be negative.' }; }
    const s = sumOf(pat); if (!(s > 0)) return { level: 'err', bad, msg: 'The pattern is empty.' };
    if (Math.abs(s - 100) > 0.05) return { level: 'warn', bad, msg: 'Total is ' + fmtN(s) + ' %: the pattern is scaled to 100 % of the total depth. Click "Normalize to 100%" to fix the numbers.' };
    return { level: 'ok', bad, msg: '✓ Valid pattern: ' + pat.length + ' intervals, total 100 %.' };
  };

  AV.hyetographDialog = async function (app) {
    const m = app.model; const si = m.isSI; const U = si ? 'mm' : 'in';
    const st = app._storm || (app._storm = { method: 'custom', mode: 'inc', depth: si ? 75 : 3, dur: 120, step: 5, a: si ? 1500 : 60, b: 10, c: 0.8, r: 40, pat: AV.stormPreset('center', 12), name: 'DesignStorm' });
    let pat = st.pat.slice(); let mode = st.mode, method = st.method;
    const num = (v, step) => h('input', { type: 'number', step: step || 'any', value: v });
    const toIso = (d) => { const a = String(d || '').split('/'); return a.length === 3 ? a[2].padStart(4, '0') + '-' + a[0].padStart(2, '0') + '-' + a[1].padStart(2, '0') : '2026-01-01'; };
    const f = {
      depth: num(st.depth), dur: num(st.dur), step: h('select', null, [1, 2, 5, 10, 15, 30, 60].map(v => h('option', { value: v, selected: v === st.step }, String(v)))),
      a: num(st.a), b: num(st.b), c: num(st.c), r: h('input', { type: 'range', min: 5, max: 95, value: st.r }),
      sd: h('input', { type: 'date', value: toIso(m.options.START_DATE) }), stime: h('input', { type: 'time', value: String(m.options.START_TIME || '00:00').slice(0, 5).padStart(5, '0') }), en: h('input', { type: 'text', readOnly: true }),
      name: h('input', { type: 'text', value: st.name }),
      gage: h('select', null, [...m.gages.keys()].map(g => h('option', { value: g }, g)).concat([m.gages.size ? null : h('option', { value: '+' }, '(new rain gage)'), h('option', { value: '' }, '(none)')].filter(Boolean))),
      preset: h('select', null, [['', '(choose…)'], ['uni', 'Uniform'], ['front', 'Front-loaded peak'], ['center', 'Center peak'], ['rear', 'Rear-loaded peak'], ['scs', 'SCS Type II shape'], ['chi', 'Chicago shape (peak 40%)']].map(([v, l]) => h('option', { value: v }, l))),
      np: h('input', { type: 'number', min: 2, max: 96, value: pat.length, style: { width: '56px' } }),
    };
    const fr = (label, el, unit) => h('div', { class: 'dsfr' }, h('label', null, label, unit ? h('span', { class: 'u' }, ' (' + unit + ')') : null), el);
    const fsDepth = fr('Total depth', f.depth, U);
    const fsIdf = h('fieldset', null, h('legend', null, 'IDF curve  i = a / (t + b)^c'), fr('a', f.a, U + '/hr, t in min'), fr('b', f.b, 'min'), fr('c', f.c));
    const rlab = h('div', { class: 'dshint' });
    const fsPeak = h('fieldset', null, h('legend', null, 'Peak position'), fr('Peak at', f.r, '% of duration'), rlab);
    const left = h('div', null,
      h('fieldset', null, h('legend', null, 'Storm'), fsDepth, fr('Duration', f.dur, 'min'), fr('Time step', f.step, 'min')), fsIdf, fsPeak,
      h('fieldset', null, h('legend', null, 'Timing'), fr('Start date', f.sd), fr('Start time', f.stime), fr('End', f.en), h('div', { class: 'dshint' }, "Defaults to the model's Start Analysis date / time.")),
      h('fieldset', null, h('legend', null, 'Output'), fr('Time series name', f.name), fr('Assign to rain gage', f.gage)));
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'dsch');
    const chips = h('div', { class: 'dschips' });
    const modeBtns = [['inc', '% per interval'], ['cum', 'Cumulative %']].map(([k, l]) => h('button', { 'data-m': k, onclick: () => { mode = k; grid(); modeBtns.forEach(b => b.classList.toggle('on', b.dataset.m === mode)); } }, l));
    modeBtns.forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    const pasteT = h('textarea', { placeholder: '5\t10\n10\t25\n15\t40 ...' });
    const pasteBox = h('div', { class: 'dspaste' }, h('div', { class: 'dshint' }, 'Paste one column (values) or two columns (time in min, value) from Excel. Values are read in the input mode chosen above.'), pasteT,
      h('div', { style: { textAlign: 'right', marginTop: '4px' } }, h('button', { class: 'btn small', onclick: () => { pasteBox.style.display = 'none'; } }, 'Cancel'), ' ', h('button', { class: 'btn small primary', onclick: () => applyPaste() }, 'Apply')));
    const gt = h('table'); const val = h('div', { class: 'dsval' });
    const patBox = h('div', { class: 'dspat' },
      h('div', { class: 'dspt' }, h('b', null, 'Pattern'), h('label', null, 'Preset ', f.preset), h('label', null, 'Intervals ', f.np), h('span', null, 'Enter as'), h('span', { class: 'dsradio' }, modeBtns), h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn small', onclick: () => { pasteBox.style.display = 'block'; pasteT.focus(); } }, 'Paste from Excel…'), h('button', { class: 'btn small', onclick: () => normalize() }, 'Normalize to 100%')),
      pasteBox, h('div', { class: 'dsgrid' }, gt), val);
    const seg = h('div', { class: 'dsseg' }, STORM_METHODS.map(([k, n, s]) => h('button', { 'data-k': k, onclick: () => { method = k; upd(); } }, n, h('small', null, s))));
    const body = h('div', { class: 'dsdlg' }, seg, h('div', { class: 'dscols' }, left, h('div', { style: { minWidth: 0 } }, h('div', { class: 'dschart' }, svg), chips, patBox)));
    const params = () => ({ method, depth: +f.depth.value || 0, dur: Math.max(1, +f.dur.value || 60), step: +f.step.value || 5, a: +f.a.value, b: +f.b.value, c: +f.c.value, r: (+f.r.value || 40) / 100, pattern: method === 'custom' ? pat.slice() : null });
    const check = () => method === 'custom' ? AV.stormPatternCheck(pat, mode) : { level: 'ok', bad: new Set() };
    const t0 = () => { const [y, mo, d] = (f.sd.value || '').split('-'); return y ? AV.parseSwmmDate(mo + '/' + d + '/' + y, f.stime.value || '00:00') : null; };
    const timing = () => { const P = params(); const d0 = t0(); f.en.value = d0 === null ? 'invalid start date' : AV.fmtDateTime(d0 + Math.max(1, Math.round(P.dur / P.step)) * P.step / 1440).slice(0, 16); };
    let geo = null;
    const el = (tg, a, txt) => { const e = document.createElementNS(NS, tg); for (const k in a) e.setAttribute(k, a[k]); if (txt !== undefined) e.textContent = txt; return e; };
    const chart = () => {
      svg.innerHTML = ''; const W = svg.clientWidth || 640, H = 250; svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      const L = 52, R = 50, T = 26, B = 34, pw = W - L - R, ph = H - T - B; const v = check(); const P = params();
      const I = v.level === 'err' ? [] : AV.designStorm(P); const n = Math.max(1, Math.round(P.dur / P.step)), D = n * P.step; const max = Math.max(0.1, ...I) * 1.15;
      svg.appendChild(el('text', { x: W / 2, y: 15, 'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': 600, fill: '#263238' }, 'Hyetograph'));
      for (let k = 0; k <= 4; k++) { const y = T + ph - ph * k / 4; svg.appendChild(el('line', { x1: L, x2: L + pw, y1: y, y2: y, stroke: '#eceff1' })); svg.appendChild(el('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: '#607d8b' }, fmtN(max * k / 4, max < 2 ? 2 : 1))); svg.appendChild(el('text', { x: L + pw + 6, y: y + 4, 'font-size': 10.5, fill: '#90a4ae' }, (25 * k) + '%')); }
      const hrs = D / 60; const tick = hrs <= 2 ? .25 : hrs <= 6 ? 1 : hrs <= 24 ? 3 : 6;
      for (let t = 0; t <= hrs + 1e-9; t += tick) { const x = L + pw * t / hrs; svg.appendChild(el('line', { x1: x, x2: x, y1: T + ph, y2: T + ph + 4, stroke: '#90a4ae' })); svg.appendChild(el('text', { x, y: T + ph + 16, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#607d8b' }, fmtN(t, 2))); }
      svg.appendChild(el('text', { x: L + pw / 2, y: H - 3, 'text-anchor': 'middle', 'font-size': 11, fill: '#455a64' }, 'Hours'));
      svg.appendChild(el('text', { x: 13, y: T + ph / 2, 'text-anchor': 'middle', 'font-size': 11, fill: '#455a64', transform: 'rotate(-90 13 ' + (T + ph / 2) + ')' }, 'Intensity (' + U + '/hr)'));
      svg.appendChild(el('text', { x: W - 8, y: T + ph / 2, 'text-anchor': 'middle', 'font-size': 11, fill: '#90a4ae', transform: 'rotate(90 ' + (W - 8) + ' ' + (T + ph / 2) + ')' }, 'Cumulative'));
      const bw = pw / n;
      if (v.level === 'err') svg.appendChild(el('text', { x: L + pw / 2, y: T + ph / 2, 'text-anchor': 'middle', 'font-size': 13, fill: '#c62828' }, 'Fix the pattern (see the red cells) to see the hyetograph'));
      else {
        I.forEach((q, i) => { const hg = ph * q / max; svg.appendChild(el('rect', { x: L + i * bw + bw * .08, y: T + ph - hg, width: Math.max(1, bw * .84), height: hg, fill: '#7e57c2', rx: 1 })); });
        const tot = I.reduce((s, q) => s + q * P.step / 60, 0) || 1; let c = 0, d = 'M' + L + ' ' + (T + ph);
        I.forEach((q, i) => { c += q * P.step / 60; d += ' L' + (L + (i + 1) * bw) + ' ' + (T + ph - ph * c / tot); }); svg.appendChild(el('path', { d, fill: 'none', stroke: '#26a69a', 'stroke-width': 2 }));
      }
      svg.appendChild(el('rect', { x: L, y: T, width: pw, height: ph, fill: 'none', stroke: '#b0bec5' }));
      svg.classList.toggle('draw', method === 'custom');
      if (method === 'custom') { for (let k = 1; k < pat.length; k++) { const x = L + pw * k / pat.length; svg.appendChild(el('line', { x1: x, x2: x, y1: T, y2: T + ph, stroke: '#d1c4e9', 'stroke-dasharray': '3 3' })); } svg.appendChild(el('text', { x: L + 6, y: T + 13, 'font-size': 11, fill: '#5e35b1' }, '✎ Drag on the chart to draw the pattern')); }
      svg.appendChild(el('rect', { x: L + pw - 210, y: 6, width: 10, height: 10, fill: '#7e57c2' })); svg.appendChild(el('text', { x: L + pw - 196, y: 15, 'font-size': 10.5, fill: '#455a64' }, 'Intensity'));
      svg.appendChild(el('line', { x1: L + pw - 140, x2: L + pw - 124, y1: 11, y2: 11, stroke: '#26a69a', 'stroke-width': 2 })); svg.appendChild(el('text', { x: L + pw - 120, y: 15, 'font-size': 10.5, fill: '#455a64' }, 'Cumulative depth'));
      geo = { L, T, pw, ph, max, P, D };
      chips.innerHTML = '';
      if (v.level !== 'err') { const tot = I.reduce((s, q) => s + q * P.step / 60, 0), pk = Math.max(...I), ip = I.indexOf(pk);
        [['Total depth', fmtN(tot, 3) + ' ' + U], ['Peak intensity', fmtN(pk, 3) + ' ' + U + '/hr'], ['Peak at', fmtN(ip * P.step, 0) + '–' + fmtN((ip + 1) * P.step, 0) + ' min'], ['Steps', n + ' × ' + P.step + ' min']].forEach(([a, b]) => chips.appendChild(h('span', { class: 'dschip' }, a + ' ', h('b', null, b)))); }
      if (addBtn) { addBtn.disabled = v.level === 'err'; addBtn.style.opacity = v.level === 'err' ? .45 : 1; }
    };
    let drawing = false;
    const drawAt = (ev) => {
      if (!geo || method !== 'custom') return; const r = svg.getBoundingClientRect(); const sx = svg.viewBox.baseVal.width / r.width;
      const x = (ev.clientX - r.left) * sx, y = (ev.clientY - r.top) * sx; const k = Math.floor((x - geo.L) / geo.pw * pat.length); if (k < 0 || k >= pat.length) return;
      const inten = Math.max(0, (geo.T + geo.ph - y) / geo.ph * geo.max); const dtH = geo.D / pat.length / 60; const tot = sumOf(pat.map(v => Math.max(0, v)));
      pat[k] = geo.P.depth > 0 ? +(inten * dtH / geo.P.depth * (tot > 0 ? tot : 100)).toFixed(1) : 0; grid(); chart();
    };
    svg.addEventListener('mousedown', (e) => { if (method === 'custom') { drawing = true; drawAt(e); e.preventDefault(); } });
    const mv = (e) => { if (drawing) drawAt(e); }, mu = () => { drawing = false; };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', mu);
    let busy = false;
    const grid = () => { if (busy) return; busy = true; try { gridInner(); } finally { busy = false; } };
    const gridInner = () => {
      const P = params(); const n = pat.length; const dt = P.dur / n; const c = cumOf(pat); const v = check(); const tot = sumOf(pat.map(x => Math.max(0, x))) || 1;
      const cell = (i, txt, edit) => { const td = h('td', { class: v.bad.has(i) ? 'bad' : '' }); if (edit) { const inp = h('input', { value: txt }); inp.addEventListener('change', () => { if (busy) return; const x = parseFloat(inp.value); if (!isFinite(x)) { grid(); return; } if (mode === 'inc') pat[i] = x; else { const cc = cumOf(pat); cc[i + 1] = x; pat = pat.map((_, k) => +(cc[k + 1] - cc[k]).toFixed(3)); } grid(); chart(); });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); inp.dispatchEvent(new Event('change')); setTimeout(() => { const nx = gt.querySelectorAll('input')[i + (e.shiftKey ? -1 : 1)]; if (nx) { nx.focus(); nx.select(); } }, 0); } }); td.appendChild(inp); } else td.textContent = txt; return td; };
      const rowInc = h('tr', { class: mode === 'inc' ? 'edit' : 'ro' }, h('th', null, '% per interval'), pat.map((p, i) => cell(i, fmtN(p, 2), mode === 'inc')), h('td', null, h('b', null, fmtN(sumOf(pat), 2))));
      const rowCum = h('tr', { class: mode === 'cum' ? 'edit' : 'ro' }, h('th', null, 'Cumulative %'), pat.map((_, i) => cell(i, fmtN(c[i + 1], 2), mode === 'cum')), h('td'));
      gt.innerHTML = '';
      gt.appendChild(h('tr', { class: 'ro' }, h('th', null, 'Time (min)'), pat.map((_, i) => h('td', null, fmtN(dt * i, 1) + '–' + fmtN(dt * (i + 1), 1))), h('td', null, h('b', null, 'Total'))));
      gt.appendChild(mode === 'inc' ? rowInc : rowCum); gt.appendChild(mode === 'inc' ? rowCum : rowInc);
      gt.appendChild(h('tr', { class: 'ro' }, h('th', null, 'Depth (' + U + ')'), pat.map(p => h('td', null, fmtN(Math.max(0, p) / tot * P.depth, 3))), h('td', null, h('b', null, fmtN(P.depth, 3)))));
      val.className = 'dsval ' + v.level; val.textContent = v.msg || '';
    };
    const normalize = () => { const s = sumOf(pat.map(v => Math.max(0, v))); if (s > 0) { pat = pat.map(v => +(Math.max(0, v) / s * 100).toFixed(2)); pat[pat.length - 1] = +(pat[pat.length - 1] + 100 - sumOf(pat)).toFixed(2); } grid(); chart(); };
    const applyPaste = () => { const rows = pasteT.value.trim().split(/\r?\n/).map(l => l.trim().split(/[\t,; ]+/).map(Number)).filter(r => r.length && r.every(isFinite)); if (!rows.length) { AV.toast('No numbers found.', true); return; }
      const vals = rows.map(r => r[r.length - 1]); pat = mode === 'inc' ? vals : vals.map((v, i) => +(v - (i ? vals[i - 1] : 0)).toFixed(3)); f.np.value = pat.length; pasteBox.style.display = 'none'; grid(); chart(); };
    f.preset.addEventListener('change', () => { if (!f.preset.value) return; pat = AV.stormPreset(f.preset.value, Math.min(96, Math.max(2, +f.np.value || 12))); f.preset.value = ''; grid(); chart(); });
    f.np.addEventListener('change', () => { const n = Math.min(96, Math.max(2, +f.np.value || 12)); f.np.value = n; const c = cumOf(pat.map(v => Math.max(0, v))), s = c[c.length - 1] || 100; const tab = c.map((v, i) => [i / pat.length, v / s * 100]); const out = []; for (let i = 0; i < n; i++) out.push(+(interp(tab, (i + 1) / n) - interp(tab, i / n)).toFixed(2)); pat = out; grid(); chart(); });
    const upd = () => {
      AV.$$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.k === method));
      fsDepth.style.display = method !== 'chicago' ? '' : 'none'; fsIdf.style.display = method === 'chicago' ? '' : 'none'; fsPeak.style.display = ['chicago', 'triangular'].includes(method) ? '' : 'none';
      patBox.style.display = method === 'custom' ? '' : 'none';
      rlab.textContent = 'Peak at ' + f.r.value + ' % of the duration (' + fmtN(+f.r.value / 100 * params().dur, 0) + ' min)';
      timing(); if (method === 'custom') grid(); chart();
    };
    for (const k of ['depth', 'dur', 'step', 'a', 'b', 'c', 'r', 'sd', 'stime']) f[k].addEventListener('input', upd);
    let addBtn = null;
    setTimeout(() => { addBtn = AV.$$('button', body.closest('.modal') || document).find(b => b.textContent === 'Add to Project') || null; upd(); }, 40);
    const ro = new ResizeObserver(() => chart()); ro.observe(svg);
    const res = await AV.modal({ title: 'Design Storm (Hyetograph)', body, enterSubmits: false, buttons: [{ label: 'Cancel', value: null },
      { label: 'Copy to Clipboard', onClick: () => { if (check().level === 'err') { AV.toast('Fix the pattern first.', true); return false; } const P = params(); const I = AV.designStorm(P); navigator.clipboard.writeText(I.map((v, i) => AV.secToHms(i * P.step * 60).slice(0, 5) + '\t' + v.toFixed(4)).join('\n')); AV.toast('Copied'); return false; } },
      { label: 'Add to Project', primary: true, onClick: async () => {
        if (check().level === 'err') { AV.toast(check().msg, true); return false; }
        if (t0() === null) { AV.toast('Enter a valid start date and time.', true); return false; }
        let nm = f.name.value.trim().replace(/\s+/g, '_');
        if (!nm) { AV.toast('Enter a time series name.', true); return false; }
        if (m.timeseries.has(nm) && !await AV.confirm('A time series named "' + nm + '" already exists. Replace it?', 'Add to Project', 'Replace', 'Cancel')) return false;
        f.name.value = nm; return params(); } }] }).done;
    ro.disconnect(); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', mu);
    Object.assign(st, { method, mode, pat: pat.slice(), depth: +f.depth.value, dur: +f.dur.value, step: +f.step.value, a: +f.a.value, b: +f.b.value, c: +f.c.value, r: +f.r.value, name: f.name.value });
    if (!res) return;
    const I = AV.designStorm(res); const name = f.name.value;
    const d0 = t0(); let lastD = '';
    const row = (k, v) => { const s = AV.fmtDateTime(d0 + k * res.step / 1440); const ds = s.slice(0, 10).replace(/^0(\d)\/0?(\d+)/, '$1/$2').replace(/^(\d+)\/0(\d)/, '$1/$2'); const tm = s.slice(11, 16).replace(/^0(\d)/, '$1'); const out = [ds !== lastD ? ds : '', tm, v]; lastD = ds; return out; };
    const ts = { file: null, rows: I.map((v, i) => row(i, +v.toFixed(4))).concat([row(I.length, 0)]) };
    const old = m.timeseries.get(name);
    const gsel = f.gage.value; const doGage = gsel !== '';
    const gage = doGage && gsel !== '+' ? m.gages.get(gsel) : null; const gageOld = gage ? Object.assign({}, gage.p) : null;
    const interval = AV.secToHms(res.step * 60).replace(/^0(\d)/, '$1').slice(0, -3);
    let newGage = null;
    if (doGage && !gage) { const b = m.bounds(false) || { x1: 0, y2: 0 }; newGage = { id: m.nextId('RG'), kind: 'GAGE', p: AV.defaults('GAGE'), x: b.x1, y: b.y2, tag: '' }; }
    app.exec({
      label: 'Add design storm ' + name,
      do: () => { m.timeseries.set(name, ts); if (doGage) { const g = gage || newGage; if (newGage) m.gages.set(newGage.id, newGage); Object.assign(g.p, { format: 'INTENSITY', interval, source: 'TIMESERIES', series: name }); if (newGage) for (const s of m.subcatchments.values()) if (!s.p.gage) s.p.gage = newGage.id; } },
      undo: () => { if (old) m.timeseries.set(name, old); else m.timeseries.delete(name); if (gage && gageOld) gage.p = Object.assign({}, gageOld); if (newGage) m.gages.delete(newGage.id); },
    });
    AV.toast('Time series ' + name + ' added (' + f.en.value.replace(/^/, AV.fmtDateTime(d0).slice(0, 16) + ' – ') + ')' + (doGage ? ' and assigned to rain gage ' + (gage || newGage).id : '') + '. Check the simulation end time covers the storm.', false, 6000);
  };
})(window.AV);
