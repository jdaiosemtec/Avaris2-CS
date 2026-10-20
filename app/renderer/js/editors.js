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
    else if (p.method === 'custom') { const tab = p.table; const T = tab[tab.length - 1][0]; cum = (t) => p.depth * interp(tab, t / D * T) / tab[tab.length - 1][1]; }
    const out = []; for (let i = 0; i < n; i++) out.push((cum((i + 1) * dt) - cum(i * dt)) / (dt / 60));
    return out;
  };

  AV.hyetographDialog = async function (app) {
    const si = app.model.isSI;
    const f = {
      method: h('select', null, [['chicago', 'Chicago (Keifer-Chu, IDF a/(t+b)^c)'], ['scs2', 'SCS 24-hr Type II (scaled to duration)'], ['triangular', 'Triangular'], ['uniform', 'Uniform'], ['custom', 'Custom cumulative distribution']].map(([v, l]) => h('option', { value: v }, l))),
      a: h('input', { type: 'number', step: 'any', value: si ? 1500 : 60 }), b: h('input', { type: 'number', step: 'any', value: 10 }), c: h('input', { type: 'number', step: 'any', value: 0.8 }),
      r: h('input', { type: 'number', step: 'any', value: 0.4 }), depth: h('input', { type: 'number', step: 'any', value: si ? 75 : 3 }),
      dur: h('input', { type: 'number', step: 'any', value: 120 }), step: h('input', { type: 'number', step: 'any', value: 5 }),
      name: h('input', { type: 'text', value: 'DesignStorm' }), gage: h('input', { type: 'checkbox', checked: true }),
      // storm start = model Start Analysis date / time by default; the end follows from the duration
      sdate: h('input', { type: 'text', value: app.model.options.START_DATE || '01/01/2026', placeholder: 'MM/DD/YYYY' }), stime: h('input', { type: 'text', value: String(app.model.options.START_TIME || '00:00:00').slice(0, 5), placeholder: 'HH:MM' }),
      edate: h('input', { type: 'text', disabled: true }),
      table: h('textarea', { rows: 4, style: { fontFamily: 'var(--mono)' } }, '0 0\n0.5 0.2\n1 1'),
    };
    const units = si ? 'mm' : 'in';
    const rows = {};
    const R = (key, label, el) => { const lab = h('label', null, label); rows[key] = [lab, el]; return [lab, el]; };
    const form = h('div', { class: 'form' }, R('method', 'Method', f.method), R('a', 'IDF a (' + units + '/hr, t in min)', f.a), R('b', 'IDF b (min)', f.b), R('c', 'IDF c', f.c),
      R('r', 'Peak position ratio r (0-1)', f.r), R('depth', 'Total depth (' + units + ')', f.depth), R('table', 'Cumulative table (t, fraction)', f.table), R('dur', 'Duration (min)', f.dur), R('step', 'Time step (min)', f.step),
      R('sdate', 'Start date (MM/DD/YYYY)', f.sdate), R('stime', 'Start time (HH:MM)', f.stime), R('edate', 'End date / time', f.edate),
      R('gage', 'Assign to a rain gage', f.gage));
    const chartHost = h('div', { style: { height: '260px', display: 'flex', marginTop: '10px', border: '1px solid var(--border)' } });
    const info = h('div', { style: { color: 'var(--muted)', marginTop: '6px' } });
    const body = h('div', { style: { width: '640px' } }, form, chartHost, info);
    const chart = new AV.Chart(chartHost, {});
    const params = () => ({ method: f.method.value, a: +f.a.value, b: +f.b.value, c: +f.c.value, r: +f.r.value, depth: +f.depth.value, dur: +f.dur.value, step: Math.max(0.5, +f.step.value), table: f.table.value.trim().split('\n').map(l => l.trim().split(/[\s,;]+/).map(Number)).filter(p => p.length >= 2 && p.every(isFinite)) });
    const t0 = () => AV.parseSwmmDate(f.sdate.value, f.stime.value);
    const updEnd = () => { const d0 = t0(); f.edate.value = d0 === null ? 'invalid start date' : AV.fmtDateTime(d0 + Math.max(1, Math.round((+f.dur.value || 0) / Math.max(0.5, +f.step.value || 5))) * Math.max(0.5, +f.step.value || 5) / 1440).slice(0, 16); };
    const update = () => {
      updEnd();
      const p = params(); const show = { a: p.method === 'chicago', b: p.method === 'chicago', c: p.method === 'chicago', r: ['chicago', 'triangular'].includes(p.method), depth: p.method !== 'chicago', table: p.method === 'custom' };
      for (const k in show) rows[k].forEach(e => e.style.display = show[k] ? '' : 'none');
      if (p.method === 'custom' && p.table.length < 2) return;
      const I = AV.designStorm(p); const x = Float64Array.from(I.map((_, i) => (i + 0.5) * p.step / 60));
      chart.setSeries([{ name: 'Intensity (' + units + '/hr)', x, y: Float32Array.from(I), bars: true, color: '#7e57c2' }], { invert: app.prefs.invertRain, xLabel: 'Hours', yLabel: 'Intensity (' + units + '/hr)', title: 'Hyetograph' });
      const tot = I.reduce((s, v) => s + v * p.step / 60, 0); info.textContent = 'Total depth ' + AV.fmt(tot, 3) + ' ' + units + ', peak intensity ' + AV.fmt(Math.max(...I), 3) + ' ' + units + '/hr, ' + I.length + ' steps';
    };
    for (const k in f) f[k].addEventListener('input', update); f.method.addEventListener('change', update);
    setTimeout(() => { chart.resize(); update(); }, 50);
    const r = await AV.modal({ title: 'Hyetograph - Design Storm', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Copy to Clipboard', onClick: () => { const p = params(); const I = AV.designStorm(p); navigator.clipboard.writeText(I.map((v, i) => AV.secToHms(i * p.step * 60).slice(0, 5) + '\t' + v.toFixed(4)).join('\n')); AV.toast('Copied'); return false; } }, { label: 'Add to Project', primary: true, onClick: async () => {
      // the user names the new time series when adding it
      let nm = f.name.value;
      for (;;) {
        nm = await AV.prompt('Add to Project', 'Time series name', nm); if (nm === null) return false;
        nm = nm.trim().replace(/\s+/g, '_'); if (!nm) { AV.toast('Enter a name.', true); continue; }
        if (app.model.timeseries.has(nm) && !await AV.confirm('A time series named "' + nm + '" already exists. Replace it?', 'Add to Project', 'Replace', 'Cancel')) continue;
        break;
      }
      if (t0() === null) { AV.toast('Enter the start date as MM/DD/YYYY and the time as HH:MM.', true); return false; }
      f.name.value = nm; return params(); } }] }).done;
    if (!r) return;
    const I = AV.designStorm(r); const m = app.model; let name = f.name.value.trim().replace(/\s+/g, '_') || 'DesignStorm';
    // dated rows from the storm start (the date is written on the first row and when it changes)
    const d0 = t0(); let lastD = '';
    const row = (k, v) => { const s = AV.fmtDateTime(d0 + k * r.step / 1440); const ds = s.slice(0, 10).replace(/^0(\d)\/0?(\d+)/, '$1/$2').replace(/^(\d+)\/0(\d)/, '$1/$2'); const tm = s.slice(11, 16).replace(/^0(\d)/, '$1'); const out = [ds !== lastD ? ds : '', tm, v]; lastD = ds; return out; };
    const ts = { file: null, rows: I.map((v, i) => row(i, +v.toFixed(4))).concat([row(I.length, 0)]) };
    const old = m.timeseries.get(name);
    const doGage = f.gage.checked; let gage = null, gageOld = null;
    if (doGage) {
      gage = [...m.gages.values()][0];
      if (gage) gageOld = Object.assign({}, gage.p);
    }
    const interval = AV.secToHms(r.step * 60).replace(/^0(\d)/, '$1').slice(0, -3);
    let newGage = null;
    if (doGage && !gage) { const b = m.bounds(false) || { x1: 0, y2: 0 }; newGage = { id: m.nextId('RG'), kind: 'GAGE', p: AV.defaults('GAGE'), x: b.x1, y: b.y2, tag: '' }; }
    app.exec({
      label: 'Add design storm ' + name,
      do: () => { m.timeseries.set(name, ts); if (doGage) { const g = gage || newGage; if (newGage) m.gages.set(newGage.id, newGage); Object.assign(g.p, { format: 'INTENSITY', interval, source: 'TIMESERIES', series: name }); if (newGage) for (const s of m.subcatchments.values()) if (!s.p.gage) s.p.gage = newGage.id; } },
      undo: () => { if (old) m.timeseries.set(name, old); else m.timeseries.delete(name); if (gage && gageOld) gage.p = Object.assign({}, gageOld); if (newGage) m.gages.delete(newGage.id); },
    });
    AV.toast('Time series ' + name + ' added (' + f.sdate.value + ' ' + f.stime.value + ' – ' + f.edate.value + ')' + (doGage ? ' and assigned to rain gage ' + (gage || newGage).id : '') + '. Check the simulation end time covers the storm.', false, 6000);
  };
})(window.AV);
