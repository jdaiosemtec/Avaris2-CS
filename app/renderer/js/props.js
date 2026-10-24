// Property browser layout in the style of Avaris DS: one row per parameter, grouped (General / sub-groups /
// Statistic Results), plus the per-object editors opened from it (Direct Inflows, Dry Weather Flows,
// Groundwater, LID Usages). Every row reads and writes the SWMM input data, so all values reach the engine.
'use strict';
(function (AV) {
  const h = AV.h;
  const tok = (l) => AV.tokenize(l);
  const isData = (l) => { const t = String(l).trim(); return t && t[0] !== ';'; };
  const dataTok = (m, sec) => (m.raw[sec] || []).filter(isData).map(tok);
  const uniq = (a) => [...new Set(a)];
  const pollNames = (m) => dataTok(m, 'POLLUTANTS').map(t => t[0]);
  const namesOf = (m, sec) => uniq(dataTok(m, sec).map(t => t[0]));
  const curvesOf = (m, re) => [...m.curves].filter(([, c]) => re.test(c.type || '')).map(([n]) => n);
  const patterns = (m, type) => { const out = []; const seen = new Set(); for (const t of dataTok(m, 'PATTERNS')) { if (seen.has(t[0])) continue; seen.add(t[0]); const ty = (t[1] || '').toUpperCase(); if (!type || ty === type || !/^(MONTHLY|DAILY|HOURLY|WEEKEND)$/.test(ty)) out.push(t[0]); } return out; };
  const fmtLine = (t) => t.map(x => /\s/.test(x) || x === '' ? '"' + x + '"' : String(x)).map((x, j) => j === t.length - 1 ? x : (x + ' ').padEnd(j === 0 ? 17 : 11)).join('');
  const UT = (m, k) => AV.unitText(m, k);
  const lab = (m, l, k) => { const u = k ? UT(m, k) : ''; return u ? l + ' (' + u + ')' : l; };
  const empty = (list) => [['', '<Empty>']].concat(list.map(x => [x, x]));

  // ------------------------------------------------------------------ extra virtual fields
  const dpCount = { OVERFLOW: 0, CUTOFF: 1, TABULAR: 1, WEIR: 3 };
  const dp = (i) => ({ l: 'Divider Parameter ' + (i + 1), get: (m, o) => (String(o.p.dparam || '').trim().split(/\s+/)[i] || ''),
    set: (m, o, v) => { const n = dpCount[o.p.dtype] || 0; const a = String(o.p.dparam || '').trim().split(/\s+/).filter(Boolean); while (a.length < n) a.push('0'); a[i] = String(v === undefined || v === null ? '' : v).trim() || '0'; o.p.dparam = a.slice(0, n).join(' '); } });
  Object.assign(AV.VIRT, {
    rimElev: { l: 'Rim Elevation', get: (m, o) => +(+o.p.elev + (+o.p.maxDepth || 0)).toPrecision(12), set: (m, o, v) => { const x = parseFloat(v); if (isFinite(x)) o.p.maxDepth = +(x - (+o.p.elev || 0)).toPrecision(12); } },
    dp1: dp(0), dp2: dp(1), dp3: dp(2),
  });
  // treatment expression of a node for one pollutant: [TREATMENT] node pollutant  R = ... / C = ...
  AV.VIRTP.treat = {
    get: (m, o, pol) => { const r = (m.raw.TREATMENT || []).find(l => { if (!isData(l)) return false; const t = tok(l); return t[0] === o.id && t[1] === pol; }); return r ? tok(r).slice(2).join(' ') : ''; },
    set: (m, o, pol, v) => { const rows = AV.rawRows(m, 'TREATMENT'); const i = rows.findIndex(l => { if (!isData(l)) return false; const t = tok(l); return t[0] === o.id && t[1] === pol; });
      const x = String(v === undefined || v === null ? '' : v).trim(); const ln = (o.id + ' ').padEnd(17) + (pol + ' ').padEnd(11) + x;
      if (i >= 0) { if (x) rows[i] = ln; else rows.splice(i, 1); } else if (x) rows.push(ln); } };
  // initial buildup of a subcatchment for one pollutant: [LOADINGS] subcatch pollutant buildup (pollutant/value pairs)
  AV.VIRTP.load = {
    get: (m, o, pol) => { for (const t of dataTok(m, 'LOADINGS')) if (t[0] === o.id) for (let j = 1; j + 1 < t.length; j += 2) if (t[j] === pol) return t[j + 1]; return 0; },
    set: (m, o, pol, v) => { const rows = AV.rawRows(m, 'LOADINGS');
      for (let i = rows.length - 1; i >= 0; i--) { if (!isData(rows[i])) continue; const t = tok(rows[i]); if (t[0] !== o.id) continue; const keep = [t[0]]; for (let j = 1; j + 1 < t.length; j += 2) if (t[j] !== pol) keep.push(t[j], t[j + 1]);
        if (keep.length === t.length) continue; if (keep.length > 1) rows[i] = fmtLine(keep); else rows.splice(i, 1); }
      const x = parseFloat(v); if (isFinite(x) && x !== 0) rows.push(fmtLine([o.id, pol, String(v).trim()])); } };
  // subcatchment monthly adjustment patterns: [ADJUSTMENTS] N-PERV | DSTORE | INFIL  subcatch  pattern
  AV.VIRTP.adjpat = {
    get: (m, o, key) => { for (const t of dataTok(m, 'ADJUSTMENTS')) if ((t[0] || '').toUpperCase() === key && t[1] === o.id) return t[2] || ''; return ''; },
    set: (m, o, key, v) => { const rows = AV.rawRows(m, 'ADJUSTMENTS'); for (let i = rows.length - 1; i >= 0; i--) { if (!isData(rows[i])) continue; const t = tok(rows[i]); if ((t[0] || '').toUpperCase() === key && t[1] === o.id) rows.splice(i, 1); }
      const x = String(v || '').trim(); if (x) rows.push(fmtLine([key, o.id, x])); } };

  // ------------------------------------------------------------------ layout
  const F = (k, l, t, extra) => Object.assign({ k, l, t: t || 'num' }, extra || {});
  const dlg = (l, sum, fn) => ({ k: '_dlg_' + l, l, t: 'dlg', sum, dlg: fn });
  function nodeCommon(app, o) {
    const m = app.model; const R = [];
    R.push(dlg('Direct Inflows', AV.sectionSummary(m, 'INFLOWS', o.id), () => AV.inflowsEditor(app, o)));
    R.push(dlg('Dry Weather Flows', AV.sectionSummary(m, 'DWF', o.id), () => AV.dwfEditor(app, o)));
    R.push(F('uh', 'Unit Hydrograph Group', 'choice', { o: () => empty(namesOf(m, 'HYDROGRAPHS')), sg: 'RDII' }));
    R.push(F('sewArea', lab(m, 'Sewershed Area', 'LA'), 'num', { sg: 'RDII' }));
    for (const p of pollNames(m)) R.push(F('treat:' + p, p, 'text', { sg: 'Pollutant Treatment', title: 'Treatment expression, e.g.  R = 0.5   or   C = ' + p + ' * exp(-0.1*HRT)' }));
    return R;
  }
  const chamber = (m) => [F('maxDepth', lab(m, 'Chamber Depth', 'L')), F('rimElev', lab(m, 'Rim Elevation', 'L')), F('initDepth', lab(m, 'Initial Depth', 'L')), F('surDepth', lab(m, 'Surcharge Depth', 'L')),
    F('aPonded', lab(m, 'Ponded Area', 'A'))];
  const offLbl = (m, l) => /ELEVATION/i.test(m.options.LINK_OFFSETS || '') ? l.replace('Offset', 'Offset Elev.') : l;
  AV.propLayout = function (app, o) {
    const m = app.model, p = o.p, R = [];
    const kind = o.kind === 'NODE' || o.kind === 'LINK' ? o.type : o.kind;
    switch (kind) {
      case 'JUNCTION':
        R.push(F('elev', lab(m, 'Chamber Floor Elevation', 'L')), ...nodeCommon(app, o), ...chamber(m), F('chamberArea', lab(m, 'Chamber Area', 'A'))); break;
      case 'DIVIDER': {
        R.push(F('elev', lab(m, 'Chamber Floor Elevation', 'L')), ...nodeCommon(app, o), ...chamber(m), F('chamberArea', lab(m, 'Chamber Area', 'A')),
          F('divLink', 'Diverted Link', 'text', { list: 'divLink' }),
          F('dtype', 'Divider Type', 'choice', { o: [['OVERFLOW', 'Overflow'], ['CUTOFF', 'Cutoff'], ['TABULAR', 'Tabular'], ['WEIR', 'Weir']], after: (a, objs, v) => { const d = { OVERFLOW: '', CUTOFF: '0', TABULAR: '', WEIR: '0 0 0' }[v]; a.setProps(objs, 'dparam', objs.map(() => d)); } }));
        if (p.dtype === 'CUTOFF') R.push(F('dp1', lab(m, 'Cutoff Flow', 'Q')));
        if (p.dtype === 'TABULAR') R.push(F('dp1', 'Diversion Curve', 'choice', { o: () => empty(curvesOf(m, /^DIVERSION$/)), ref: 'curve', grp: 'DIVERSION' }));
        if (p.dtype === 'WEIR') R.push(F('dp1', lab(m, 'Min. Flow', 'Q')), F('dp2', lab(m, 'Max. Depth', 'L')), F('dp3', 'Discharge Coefficient'));
        break; }
      case 'OUTFALL':
        R.push(F('elev', lab(m, 'Invert Elevation', 'L')), ...nodeCommon(app, o), F('gated', 'Tide Gate', 'bool'), F('routeTo', 'Route To', 'text', { list: 'outlet' }),
          F('otype', 'Type', 'choice', { o: [['FREE', 'Free'], ['NORMAL', 'Normal'], ['FIXED', 'Fixed'], ['TIDAL', 'Tidal'], ['TIMESERIES', 'Time Series']], after: (a, objs) => a.setProps(objs, 'stage', objs.map(() => '')) }));
        if (p.otype === 'FIXED') R.push(F('stage', lab(m, 'Fixed Stage', 'L')));
        if (p.otype === 'TIDAL') R.push(F('stage', 'Tidal Curve', 'choice', { o: () => empty(curvesOf(m, /^TIDAL$/)), ref: 'curve', grp: 'TIDAL' }));
        if (p.otype === 'TIMESERIES') R.push(F('stage', 'Time Series', 'choice', { o: () => empty([...m.timeseries.keys()]), ref: 'ts' }));
        break;
      case 'STORAGE': {
        R.push(F('elev', lab(m, 'Storage Floor Elevation', 'L')), ...nodeCommon(app, o), F('maxDepth', lab(m, 'Storage Depth', 'L')), F('initDepth', lab(m, 'Initial Depth', 'L')),
          F('surDepth', lab(m, 'Surcharge Depth', 'L')), F('fevap', 'Evaporation Factor'),
          F('shape', 'Storage Shape Type', 'choice', { o: [['FUNCTIONAL', 'Functional'], ['TABULAR', 'Tabular'], ['CYLINDRICAL', 'Cylindrical'], ['CONICAL', 'Conical'], ['PARABOLIC', 'Parabolic'], ['PYRAMIDAL', 'Pyramidal']],
            after: (a, objs, v) => { if (v === 'TABULAR') a.setProps(objs, 'sp1', objs.map(() => '')); else a.setProps(objs, 'sp1', objs.map(x => isFinite(parseFloat(x.p.sp1)) ? x.p.sp1 : '0')); } }));
        const sh = p.shape || 'FUNCTIONAL';
        if (sh === 'FUNCTIONAL') R.push(F('sp3', 'Constant (a0)'), F('sp1', 'Coefficient (a1)'), F('sp2', 'Exponent (a2)'));
        else if (sh === 'TABULAR') R.push(F('sp1', 'Storage Curve', 'choice', { o: () => empty(curvesOf(m, /^STORAGE$/)), ref: 'curve', grp: 'STORAGE' }));
        else { R.push(F('sp1', lab(m, 'Major Axis Length', 'L')), F('sp2', lab(m, 'Minor Axis Width', 'L')));
          if (sh === 'CONICAL' || sh === 'PYRAMIDAL') R.push(F('sp3', 'Side Slope (run/rise)')); if (sh === 'PARABOLIC') R.push(F('sp3', lab(m, 'Surface Height', 'L'))); }
        R.push(F('psi', lab(m, 'Suction Head', 'D'), 'text', { sg: 'Seepage Loss' }), F('imd', 'Initial Deficit', 'text', { sg: 'Seepage Loss' }), F('ksat', lab(m, 'Conductivity', 'R'), 'text', { sg: 'Seepage Loss' }));
        break; }
      case 'CONDUIT': {
        const sh = p.shape || 'CIRCULAR'; const info = (AV.XS_INFO && AV.XS_INFO[sh]) || [sh, [['Maximum Height', 'L']]];
        R.push(F('shape', 'Cross Section Shape', 'choice', { o: AV.XS_SHAPES.map(x => [x, AV.XS_INFO && AV.XS_INFO[x] ? AV.XS_INFO[x][0] : x]), xs: true, sg: 'Cross Section' }));
        info[1].forEach(([l, k], i) => {
          const key = sh === 'IRREGULAR' || sh === 'STREET' ? 'g1' : 'g' + (i + 1);
          if (k === 'curve') R.push(F(key, l, 'choice', { o: () => empty(curvesOf(m, /^SHAPE$/)), sg: 'Cross Section', ref: 'curve', grp: 'SHAPE' }));
          else if (k === 'transect') R.push(F(key, l, 'choice', { o: () => empty(dataTok(m, 'TRANSECTS').filter(t => (t[0] || '').toUpperCase() === 'X1').map(t => t[1])), sg: 'Cross Section' }));
          else if (k === 'street') R.push(F(key, l, 'choice', { o: () => empty(namesOf(m, 'STREETS')), sg: 'Cross Section' }));
          else R.push(F(key, lab(m, l, k), 'text', { sg: 'Cross Section' }));
        });
        R.push(F('length', lab(m, 'Length', 'L')), F('rough', 'Roughness'), F('inOff', lab(m, offLbl(m, 'Inlet Offset'), 'L')), F('outOff', lab(m, offLbl(m, 'Outlet Offset'), 'L')),
          F('initFlow', lab(m, 'Initial Flow', 'Q')), F('maxFlow', lab(m, 'Max. Flow', 'Q')), F('kEntry', 'Entry Loss Coefficient'), F('kExit', 'Exit Loss Coefficient'), F('kAvg', 'Average Loss Coefficient'),
          F('flap', 'Flap Gate', 'bool'), F('seepage', lab(m, 'Seepage Loss Rate', 'R')), F('barrels', 'Number of Barrels'), F('culvert', 'Culvert', 'text', { title: 'FHWA culvert inlet geometry code (1-57); blank = not a culvert' }));
        break; }
      case 'PUMP':
        R.push(F('curve', 'Pump Curve', 'choice', { o: () => [['*', '<Ideal>']].concat(curvesOf(m, /^PUMP/).map(x => [x, x])), ref: 'curve', grp: 'PUMP' }), F('status', 'Start initially', 'bool', { yes: 'ON', no: 'OFF' }),
          F('startup', lab(m, 'Startup Depth', 'L')), F('shutoff', lab(m, 'Shutoff Depth', 'L')));
        break;
      case 'ORIFICE':
        R.push(F('otype', 'Type', 'choice', { o: [['SIDE', 'Side'], ['BOTTOM', 'Bottom']] }), F('shape', 'Shape', 'choice', { o: [['CIRCULAR', 'Circular'], ['RECT_CLOSED', 'Rectangular']] }),
          F('g1', lab(m, 'Height', 'L'), 'text'));
        if (p.shape === 'RECT_CLOSED') R.push(F('g2', lab(m, 'Width', 'L'), 'text'));
        R.push(F('offset', lab(m, offLbl(m, 'Inlet Offset'), 'L')), F('qcoeff', 'Discharge Coefficient'), F('gated', 'Flap Gate', 'bool'), F('closeTime', 'Time to Open/Close Gate (hr)'));
        break;
      case 'WEIR': {
        const wt = p.wtype || 'TRANSVERSE';
        R.push(F('wtype', 'Type', 'choice', { o: [['TRANSVERSE', 'Transverse'], ['SIDEFLOW', 'Side Flow'], ['V-NOTCH', 'V-Notch'], ['TRAPEZOIDAL', 'Trapezoidal'], ['ROADWAY', 'Roadway']],
          after: (a, objs, v) => a.setProps(objs, 'shape', objs.map(() => v === 'V-NOTCH' ? 'TRIANGULAR' : v === 'TRAPEZOIDAL' ? 'TRAPEZOIDAL' : 'RECT_OPEN')) }),
        F('g1', lab(m, 'Height', 'L'), 'text'), F('g2', lab(m, wt === 'V-NOTCH' ? 'Top Width' : 'Width', 'L'), 'text'));
        if (wt === 'TRAPEZOIDAL') R.push(F('g3', 'Left Side Slope (run/rise)', 'text'), F('g4', 'Right Side Slope (run/rise)', 'text'));
        R.push(F('crest', lab(m, offLbl(m, 'Inlet Offset'), 'L')), F('qcoeff', 'Discharge Coefficient'), F('gated', 'Flap Gate', 'bool'), F('surcharge', 'Can Surcharge', 'bool'),
          F('endCon', 'End Contractions'), F('endCoeff', 'End Coefficient'), F('coeffCurve', 'Coefficient Curve', 'choice', { o: () => empty(curvesOf(m, /^WEIR$/)), ref: 'curve', grp: 'WEIR' }));
        if (wt === 'ROADWAY') R.push(F('roadWidth', lab(m, 'Road Width', 'L'), 'text'), F('roadSurf', 'Road Surface', 'choice', { o: [['', '<Empty>'], ['PAVED', 'Paved'], ['GRAVEL', 'Gravel']] }));
        break; }
      case 'OUTLET':
        R.push(F('offset', lab(m, offLbl(m, 'Inlet Offset'), 'L')), F('gated', 'Flap Gate', 'bool'),
          F('otype', 'Rating Curve Type', 'choice', { o: [['FUNCTIONAL/DEPTH', 'Functional/Depth'], ['FUNCTIONAL/HEAD', 'Functional/Head'], ['TABULAR/DEPTH', 'Tabular/Depth'], ['TABULAR/HEAD', 'Tabular/Head']],
            after: (a, objs, v) => { if (/^TABULAR/.test(v)) a.setProps(objs, 'c1', objs.map(x => m.curves.has(x.p.c1) ? x.p.c1 : '')); else a.setProps(objs, 'c1', objs.map(x => isFinite(parseFloat(x.p.c1)) ? x.p.c1 : '10')); } }));
        if (/^TABULAR/.test(p.otype || '')) R.push(F('c1', 'Rating Curve', 'choice', { o: () => empty(curvesOf(m, /^RATING$/)), ref: 'curve', grp: 'RATING' }));
        else R.push(F('c1', 'Coefficient', 'text'), F('c2', 'Exponent', 'text'));
        break;
      case 'SUBCATCH': {
        const meth = String(p.imethod || m.options.INFILTRATION || 'HORTON').toUpperCase();
        const ML = { HORTON: 'Horton', MODIFIED_HORTON: 'Modified Horton', GREEN_AMPT: 'Green-Ampt', MODIFIED_GREEN_AMPT: 'Modified Green-Ampt', CURVE_NUMBER: 'Curve Number' };
        R.push(F('outlet', 'Outlet', 'text', { list: 'outlet' }), F('gage', 'Rain Gage', 'choice', { o: () => empty([...m.gages.keys()]) }),
          F('snowPack', 'Snow Pack', 'choice', { o: () => empty(namesOf(m, 'SNOWPACKS')) }), F('curbLen', lab(m, 'Curb Length', 'L')), F('area', lab(m, 'Area', 'LA')), F('width', lab(m, 'Width', 'L')),
          F('slope', 'Slope (%)'), F('imperv', 'Imperv. (%)'), F('nImp', 'N-Imperv.'), F('nPerv', 'N-Perv.'), F('sImp', lab(m, 'Dstore-Imperv.', 'D')), F('sPerv', lab(m, 'Dstore-Perv.', 'D')),
          F('pctZero', 'Zero-Imperv. (%)'), F('routeTo', 'Subarea Routing', 'choice', { o: [['OUTLET', 'Outlet'], ['IMPERVIOUS', 'Impervious'], ['PERVIOUS', 'Pervious']] }), F('pctRouted', 'Percent Routed (%)', 'text'),
          F('impCoef', 'Imperv. Runoff Coef.'),
          F('imethod', 'Infiltration Type', 'choice', { o: [['', 'Default (' + (ML[String(m.options.INFILTRATION || 'HORTON').toUpperCase()] || m.options.INFILTRATION) + ')']].concat(Object.keys(ML).map(k => [k, ML[k]])) }));
        for (let i = 1; i <= 5; i++) { const l = AV.fieldLabel(m, o, { k: 'i' + i, l: '' }); if (!/unused/.test(l)) R.push(F('i' + i, l.replace(/^Max\. Infil\./, 'Max. Infil.'), 'text')); }
        const gw = dataTok(m, 'GROUNDWATER').find(t => t[0] === o.id);
        R.push(dlg('Groundwater', gw ? (gw[1] || 'Yes') : 'No', () => AV.groundwaterEditor(app, o)));
        R.push(dlg('LID Usages', String(dataTok(m, 'LID_USAGE').filter(t => t[0] === o.id).length), () => AV.lidUsageEditor(app, o)));
        R.push(F('adjpat:N-PERV', 'N-Perv Pattern', 'choice', { o: () => empty(patterns(m, 'MONTHLY')) }), F('adjpat:DSTORE', 'Dstore Pattern', 'choice', { o: () => empty(patterns(m, 'MONTHLY')) }),
          F('adjpat:INFIL', 'Infiltration Pattern', 'choice', { o: () => empty(patterns(m, 'MONTHLY')) }));
        const bu = 'Initial Buildup (' + (m.isSI ? 'kg/ha' : 'lbs/ac') + ')';
        for (const pl of pollNames(m)) R.push(F('load:' + pl, pl, 'num', { sg: bu }));
        if (dataTok(m, 'LANDUSES').length) R.push(dlg('Land Uses', AV.sectionSummary(m, 'COVERAGES', o.id), () => AV.sectionTableEditor(app, 'COVERAGES', o.id)));
        break; }
      case 'GAGE':
        R.push(F('format', 'Rain Format', 'choice', { o: [['INTENSITY', 'Intensity'], ['VOLUME', 'Volume'], ['CUMULATIVE', 'Cumulative']] }), F('interval', 'Time Interval (H:MM)', 'text'), F('scf', 'Snow Catch Factor'),
          F('source', 'Data Source', 'choice', { o: [['TIMESERIES', 'Time Series'], ['FILE', 'File']] }));
        if (p.source === 'FILE') R.push(F('series', 'File Name', 'text'), F('station', 'Station ID', 'text'), F('units', 'Rain Units', 'choice', { o: [['IN', 'IN'], ['MM', 'MM']] }));
        else R.push(F('series', 'Time Series', 'choice', { o: () => empty([...m.timeseries.keys()]), ref: 'ts' }));
        break;
    }
    return R;
  };

  // ------------------------------------------------------------------ input widget for one row
  AV.propInput = function (app, f, objs) {
    const m = app.model;
    if (f.t === 'ro') return h('div', { class: 'ro' }, f.val === null || f.val === undefined ? '-' : String(f.val));
    if (f.t === 'dlg') return h('div', { class: 'pdlg' }, h('span', { title: f.sum }, f.sum), h('button', { title: 'Edit ' + f.l, onclick: (e) => { e.stopPropagation(); f.dlg(); } }, '✎'));
    const vals = objs.map(o => AV.getField(m, o, f.k)); const same = vals.every(x => String(x) === String(vals[0]));
    const v = same ? vals[0] : undefined, mixed = !same, MIX = '*Multiple Values';
    const set = (nv) => { app.setProps(objs, f.k, objs.map(() => nv)); if (f.after) f.after(app, objs, nv); if (f.after || f.relayout) app.panels.showProps(); };
    const clean = (x) => { if (x === undefined || x === null) return ''; if (typeof x === 'number' || /^-?\d+\.\d{9,}$/.test(String(x))) { const n = +x; if (isFinite(n)) return String(+n.toPrecision(12)); } return String(x); };
    if (f.t === 'bool') {
      const yes = f.yes || 'YES', no = f.no || 'NO'; const cb = h('input', { type: 'checkbox' }); cb.checked = !mixed && String(v).toUpperCase() === yes; cb.indeterminate = mixed;
      const sp = h('span', null, mixed ? MIX : cb.checked ? 'True' : 'False');
      cb.addEventListener('change', () => { sp.textContent = cb.checked ? 'True' : 'False'; set(cb.checked ? yes : no); });
      return h('label', { class: 'pchk' }, cb, sp);
    }
    if (f.t === 'choice') {
      const opts = (typeof f.o === 'function' ? f.o() : f.o).map(x => Array.isArray(x) ? x : [x, x]);
      for (const x of vals) if (x !== undefined && x !== null && !opts.some(q => String(q[0]) === String(x))) opts.push([x, String(x)]);
      const sl = h('select', null, (mixed ? [h('option', { value: '__mixed', disabled: true }, MIX)] : []).concat(opts.map(q => h('option', { value: q[0] }, q[1]))));
      sl.value = mixed ? '__mixed' : String(v === undefined || v === null ? '' : v);
      sl.addEventListener('change', () => { if (sl.value !== '__mixed') set(sl.value); });
      if (f.xs) return h('span', { class: 'xscell' }, sl, h('button', { class: 'xsbtn', title: 'Cross Section Editor', onclick: (e) => { e.stopPropagation(); AV.crossSectionEditor(app, objs); } }, '✎'));
      // time series / curve choices: a button opens the item in its editor
      if (f.ref) return h('span', { class: 'xscell' }, sl, h('button', { class: 'xsbtn', title: f.ref === 'ts' ? 'Open in the Time Series Editor' : 'Open in the Curve Editor', onclick: async (e) => { e.stopPropagation();
        await AV.openRef(app, f.ref, sl.value === '__mixed' ? '' : sl.value, f.grp); app.panels.showProps(); } }, '✎'));
      return sl;
    }
    const i = h('input', { type: 'text', value: mixed ? '' : clean(v), placeholder: mixed ? MIX : '' });
    if (f.title) i.title = f.title;
    if (mixed) i.classList.add('mixed');
    if (f.list) i.setAttribute('list', 'dl-' + f.list);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
    i.addEventListener('change', () => {
      let nv = i.value; if (mixed && nv.trim() === '') return;
      if (f.t === 'num') { nv = parseFloat(nv); if (!isFinite(nv)) { AV.toast(f.l + ' must be a number.', true); i.value = mixed ? '' : clean(v); return; } }
      set(nv);
    });
    return i;
  };

  // ------------------------------------------------------------------ Statistic Results (from the report summary tables)
  // one row of a report summary table for an object id (cached per results)
  AV.rptRow = function (app, title, id) {
    const R = app.results; if (!R || !R.reportText) return null;
    if (!R._tables) R._tables = AV.parseReportTables(R.reportText || ''); if (!R._rowmap) R._rowmap = {};
    let mp = R._rowmap[title]; if (!mp) { mp = new Map(); const T = R._tables[title]; if (T) for (const r of T.rows) mp.set(r[0], r); R._rowmap[title] = mp; }
    return mp.get(id) || null;
  };
  AV.statGroups = function (app, o) {
    const R = app.results; if (!R || !R.reportText) return [];
    if (!R._tables) R._tables = AV.parseReportTables(R.reportText || '');
    if (!R._rowmap) R._rowmap = {};
    const row = (title) => { let mp = R._rowmap[title]; if (!mp) { mp = new Map(); const T = R._tables[title]; if (T) for (const r of T.rows) mp.set(r[0], r); R._rowmap[title] = mp; } return mp.get(o.id) || null; };
    const m = app.model, si = m.isSI, L = si ? 'm' : 'ft', Q = m.flowUnits, V = si ? '10⁶ ltr' : '10⁶ gal', D = si ? 'mm' : 'in', VEL = si ? 'm/s' : 'ft/s', SV = si ? '1000 m³' : '1000 ft³';
    const occ = (d, t) => d === undefined ? '-' : d + 'd ' + (t || '');
    const G = []; const g = (name, rows) => G.push([name, rows]);
    const val = (r, i, zero) => r ? (r[i] === undefined ? '-' : r[i]) : (zero ? '0' : '-');
    if (o.kind === 'NODE') {
      const d = row('Node Depth Summary');
      if (d) g('Node Depth', [['Average Depth (' + L + ')', d[2]], ['Max. Depth (' + L + ')', d[3]], ['Max. HGL (' + L + ')', d[4]], ['Max. Occurrence days (d hh:mm)', occ(d[5], d[6])], ['Reported Max. Depth (' + L + ')', val(d, 7)]]);
      const n = row('Node Inflow Summary');
      if (n) g('Node Inflow', [['Max. Lateral Inflow (' + Q + ')', n[2]], ['Max. Total Inflow (' + Q + ')', n[3]], ['Max. Occurrence days (d hh:mm)', occ(n[4], n[5])], ['Lateral Inflow Volume (' + V + ')', n[6]], ['Total Inflow Volume (' + V + ')', n[7]], ['Flow Balance Error (%)', val(n, 8)]]);
      if (d && o.type !== 'OUTFALL') { const s = row('Node Surcharge Summary'); g('Node Surcharge', [['Hours Surcharged', val(s, 2, true)], ['Max. Height Above Crown (' + L + ')', val(s, 3, true)], ['Min. Depth Below Rim (' + L + ')', val(s, 4, true)]]); }
      if (d && o.type !== 'OUTFALL') { const f = row('Node Flooding Summary'); g('Node Flooding', [['Hours Flooded', val(f, 1, true)], ['Max. Rate (' + Q + ')', val(f, 2, true)], ['Max. Occurrence days (d hh:mm)', f ? occ(f[3], f[4]) : '-'], ['Total Flood Volume (' + V + ')', val(f, 5, true)], ['Max. Ponded Depth (' + L + ')', val(f, 6, true)]]); }
      if (o.type === 'STORAGE') { const s = row('Storage Volume Summary'); if (s) g('Storage Volume', [['Average Volume (' + SV + ')', s[1]], ['Avg. Percent Full', s[2]], ['Evaporation Loss (%)', s[3]], ['Exfiltration Loss (%)', s[4]], ['Max. Volume (' + SV + ')', s[5]], ['Max. Percent Full', s[6]], ['Max. Occurrence days (d hh:mm)', occ(s[7], s[8])], ['Max. Outflow (' + Q + ')', val(s, 9)]]); }
      if (o.type === 'OUTFALL') { const s = row('Outfall Loading Summary'); if (s) g('Outfall Loading', [['Flow Frequency (%)', s[1]], ['Average Flow (' + Q + ')', s[2]], ['Max. Flow (' + Q + ')', s[3]], ['Total Volume (' + V + ')', s[4]]]); }
    } else if (o.kind === 'LINK') {
      const f = row('Link Flow Summary');
      if (f) { const rest = f.slice(5); const rows = [['Max. Flow (' + Q + ')', f[2]], ['Max. Occurrence days (d hh:mm)', occ(f[3], f[4])]];
        if (o.type === 'CONDUIT') { rows.push(['Max. Velocity (' + VEL + ')', val(rest, 0)], ['Max./Full Flow', val(rest, 1)], ['Max. Capacity', val(rest, 2)]);
          if (R.sur) { const s = R.surchargeStat(o, 'ever'); rows.push(['Surcharge', s === null ? '-' : String(s)]); } }
        else if (o.type === 'PUMP') rows.push(['Max./Full Flow', val(rest, 0)]);
        else if (o.type !== 'OUTLET' && rest.length) rows.push(['Max. Capacity', rest[0]]);
        g('Flow', rows); }
      if (o.type === 'CONDUIT' && f) {
        const c = row('Flow Classification Summary');
        if (c) g('Flow Classification', [['Adjusted/Actual Length', c[1]], ['Fully Dry', c[2]], ['Upstream Dry', c[3]], ['Downstream Dry', c[4]], ['Sub Critical', c[5]], ['Super Critical', c[6]], ['Upstream Critical', c[7]], ['Downstream Critical', c[8]], ['Normal Flow Limited', c[9]], ['Inlet Control', val(c, 10)]]);
        const s = row('Conduit Surcharge Summary');
        g('Surcharge', [['Hours Full (Both Ends)', val(s, 1, true)], ['Hours Full (Upstream)', val(s, 2, true)], ['Hours Full (Downstream)', val(s, 3, true)], ['Hours Above Full Normal Flow', val(s, 4, true)], ['Hours Capacity Limited', val(s, 5, true)]]);
      }
      if (o.type === 'PUMP') { const p = row('Pumping Summary'); if (p) g('Pumping', [['Percent Utilized', p[1]], ['Numbers of Start-Ups', p[2]], ['Min. Flow (' + Q + ')', p[3]], ['Average Flow (' + Q + ')', p[4]], ['Max. Flow (' + Q + ')', p[5]], ['Total Volume (' + V + ')', p[6]], ['Power Usage (kW-h)', p[7]], ['Time Below Pump Curve (%)', p[8]], ['Time Above Pump Curve (%)', val(p, 9)]]); }
    } else if (o.kind === 'SUBCATCH') {
      const r = row('Subcatchment Runoff Summary');
      if (r) g('Runoff', [['Total Prec (' + D + ')', r[1]], ['Total Runon (' + D + ')', r[2]], ['Total Evap (' + D + ')', r[3]], ['Total Infil (' + D + ')', r[4]], ['Imperv Runoff (' + D + ')', r[5]], ['Perv Runoff (' + D + ')', r[6]], ['Total Runoff (' + D + ')', r[7]], ['Total Runoff (' + V + ')', r[8]], ['Peak Runoff (' + Q + ')', r[9]], ['Runoff Coef', val(r, 10)]]);
    }
    return G;
  };

  // ------------------------------------------------------------------ shared dialog helpers
  const inp = (v, w) => h('input', { type: 'text', value: v === undefined || v === null ? '' : String(v), style: w ? { width: w + 'px' } : null });
  const sel = (opts, v, w) => { const s = h('select', { style: w ? { width: w + 'px' } : null }, opts.map(o => Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))); if (v !== undefined && v !== null) { if (!opts.some(o => (Array.isArray(o) ? o[0] : o) === v)) s.appendChild(h('option', { value: v }, v)); s.value = v; } return s; };
  const ptab = (rows) => h('table', { class: 'pgrid pdtab' }, h('tr', { class: 'pg1' }, h('td', null, 'Property'), h('td', null, 'Value')), rows.map(([l, el]) => h('tr', null, h('td', { class: 'k' }, l), h('td', { class: 'v' }, el))));
  // replace the rows of one object in a section (others kept in place)
  const replaceRows = (m, sec, id, lines, col) => { const all = m.raw[sec] || []; const out = []; let put = false;
    for (const l of all) { if (isData(l) && tok(l)[col || 0] === id) { if (!put) { AV.pushAll(out, lines); put = true; } continue; } out.push(l); } if (!put) AV.pushAll(out, lines); return out; };

  // ------------------------------------------------------------------ Direct Inflows (one row per constituent)
  AV.inflowsEditor = async function (app, node) {
    const m = app.model, P = pollNames(m); const cons = ['FLOW'].concat(P);
    const data = {}; for (const c of cons) data[c] = { ts: '', type: c === 'FLOW' ? 'FLOW' : 'CONCEN', mf: '1.0', sf: '1.0', base: '', pat: '' };
    for (const t of dataTok(m, 'INFLOWS')) if (t[0] === node.id) { const c = (t[1] || '').toUpperCase() === 'FLOW' ? 'FLOW' : t[1]; data[c] = { ts: t[2] === '""' ? '' : t[2] || '', type: (t[3] || (c === 'FLOW' ? 'FLOW' : 'CONCEN')).toUpperCase(), mf: t[4] || '1.0', sf: t[5] || '1.0', base: t[6] || '', pat: t[7] || '' }; if (!cons.includes(c)) cons.push(c); }
    let cur = cons[0]; const list = h('div', { class: 'plist' }); const right = h('div', { class: 'pright' }); let save = null;
    const tsNames = [...m.timeseries.keys()];
    const show = () => { right.innerHTML = ''; const d = data[cur];
      const base = inp(d.base, 150), pat = sel(empty(patterns(m)), d.pat, 150), ts = sel(empty(tsNames), d.ts, 150), ts0 = ts, sf = inp(d.sf, 150);
      const ty = sel([['CONCEN', 'CONCEN'], ['MASS', 'MASS']], d.type === 'FLOW' ? 'CONCEN' : d.type, 150), mf = inp(d.mf, 150);
      const rows = [[cur === 'FLOW' ? 'Baseline (' + m.flowUnits + ')' : 'Baseline', base], ['Baseline Pattern', pat], ['Time Series', AV.refEdit(app, ts0, 'ts')], ['Scale Factor', sf]];
      if (cur !== 'FLOW') rows.push(['Inflow Type', ty], ['Units Factor', mf]);
      right.append(h('div', { class: 'psub' }, 'Attributes'), ptab(rows), h('div', { class: 'note pnote' }, 'Inflow = Baseline × Baseline Pattern + Scale Factor × Time Series' + (cur === 'FLOW' ? ' (flow units ' + m.flowUnits + ').' : '. For MASS inflow the Units Factor converts the series mass rate to the model mass units per second.')));
      save = () => { Object.assign(d, { base: base.value.trim(), pat: pat.value, ts: ts.value, sf: sf.value.trim() || '1.0' }); if (cur !== 'FLOW') Object.assign(d, { type: ty.value, mf: mf.value.trim() || '1.0' }); }; };
    const renderList = () => { list.innerHTML = ''; cons.forEach(c => list.appendChild(h('div', { class: 'pli' + (c === cur ? ' sel' : ''), onclick: () => { save && save(); cur = c; renderList(); show(); } }, c === 'FLOW' ? 'Flow' : c))); };
    renderList(); show();
    const body = h('div', { class: 'pedit plistedit', style: { width: '560px', minHeight: '260px' } }, h('div', { class: 'pleft' }, h('div', { class: 'ptools' }, h('b', { style: { padding: '2px 4px' } }, 'Constituents')), list), right);
    const r = await AV.modal({ title: 'Direct Inflows Editor - ' + node.id, body, enterSubmits: false, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => { save && save(); return 'ok'; } }] }).done;
    if (!r) return;
    const lines = [];
    for (const c of cons) { const d = data[c]; const b = parseFloat(d.base); if (!d.ts && !(isFinite(b) && b !== 0)) continue;
      lines.push(fmtLine([node.id, c, d.ts || '""', c === 'FLOW' ? 'FLOW' : d.type, c === 'FLOW' ? '1.0' : d.mf, d.sf, d.base || '0'].concat(d.pat ? [d.pat] : []))); }
    AV.setSections(app, 'Edit direct inflows (' + node.id + ')', { INFLOWS: replaceRows(m, 'INFLOWS', node.id, lines) });
    app.panels.showProps();
  };

  // ------------------------------------------------------------------ Dry Weather Flows
  AV.dwfEditor = async function (app, node) {
    const m = app.model, P = pollNames(m); const cons = ['FLOW'].concat(P);
    const data = {}; for (const c of cons) data[c] = { avg: '', p: ['', '', '', ''] };
    for (const t of dataTok(m, 'DWF')) if (t[0] === node.id) { const c = (t[1] || '').toUpperCase() === 'FLOW' ? 'FLOW' : t[1]; data[c] = { avg: t[2] || '', p: [3, 4, 5, 6].map(i => t[i] && t[i] !== '""' ? t[i] : '') }; if (!cons.includes(c)) cons.push(c); }
    // patterns may be given in any order in SWMM; show them by their type
    const ptype = new Map(); for (const t of dataTok(m, 'PATTERNS')) if (!ptype.has(t[0])) ptype.set(t[0], (t[1] || '').toUpperCase());
    const TY = ['MONTHLY', 'DAILY', 'HOURLY', 'WEEKEND'];
    let cur = cons[0]; const list = h('div', { class: 'plist' }); const right = h('div', { class: 'pright' }); let save = null;
    const show = () => { right.innerHTML = ''; const d = data[cur]; const byType = {}; d.p.filter(Boolean).forEach(x => { byType[ptype.get(x) || 'MONTHLY'] = x; });
      const avg = inp(d.avg, 150); const ps = TY.map(ty => sel(empty(patterns(m, ty)), byType[ty] || '', 150));
      right.append(h('div', { class: 'psub' }, 'Attributes'), ptab([[cur === 'FLOW' ? 'Average Value (' + m.flowUnits + ')' : 'Average Value (concentration)', avg], ['Monthly Pattern', ps[0]], ['Daily Pattern', ps[1]], ['Hourly Pattern', ps[2]], ['Weekend Pattern', ps[3]]]),
        h('div', { class: 'note pnote' }, 'Dry weather inflow = Average Value × the multipliers of the selected time patterns.'));
      save = () => { d.avg = avg.value.trim(); d.p = ps.map(s => s.value); }; };
    const renderList = () => { list.innerHTML = ''; cons.forEach(c => list.appendChild(h('div', { class: 'pli' + (c === cur ? ' sel' : ''), onclick: () => { save && save(); cur = c; renderList(); show(); } }, c === 'FLOW' ? 'Flow' : c))); };
    renderList(); show();
    const body = h('div', { class: 'pedit plistedit', style: { width: '560px', minHeight: '240px' } }, h('div', { class: 'pleft' }, h('div', { class: 'ptools' }, h('b', { style: { padding: '2px 4px' } }, 'Constituents')), list), right);
    const r = await AV.modal({ title: 'Dry Weather Flows Editor - ' + node.id, body, enterSubmits: false, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => { save && save(); return 'ok'; } }] }).done;
    if (!r) return;
    const lines = [];
    for (const c of cons) { const d = data[c]; const a = parseFloat(d.avg); if (!(isFinite(a) && a !== 0)) continue; const ps = d.p.filter(Boolean);
      lines.push(fmtLine([node.id, c, d.avg]) + (ps.length ? '  ' + ps.map(x => /\s/.test(x) ? '"' + x + '"' : x).join(' ') : '')); }
    AV.setSections(app, 'Edit dry weather flows (' + node.id + ')', { DWF: replaceRows(m, 'DWF', node.id, lines) });
    app.panels.showProps();
  };

  // ------------------------------------------------------------------ Groundwater (per subcatchment)
  AV.groundwaterEditor = async function (app, sc) {
    const m = app.model, L = m.isSI ? 'm' : 'ft';
    const t = dataTok(m, 'GROUNDWATER').find(x => x[0] === sc.id) || [];
    const gwf = {}; for (const x of dataTok(m, 'GWF')) if (x[0] === sc.id) gwf[(x[1] || '').toUpperCase()] = x.slice(2).join(' ');
    const v = (i) => t[i] === undefined || t[i] === '*' ? '' : t[i];
    const aq = sel(empty(dataTok(m, 'AQUIFERS').map(x => x[0])), v(1), 200), nd = inp(v(2), 200); nd.setAttribute('list', 'dl-outlet');
    const A1 = inp(v(4) || '0', 200), B1 = inp(v(5) || '0', 200), A2 = inp(v(6) || '0', 200), B2 = inp(v(7) || '0', 200), A3 = inp(v(8) || '0', 200), UM = inp(v(13), 200);
    const LAT = inp(gwf.LATERAL || '', 200), DEEP = inp(gwf.DEEP || '', 200);
    const on = m.nodes.get(sc.p.outlet); const Es = inp(v(3) || (t.length ? '0' : on ? String(+(+on.p.elev + (+on.p.maxDepth || 0)).toFixed(3)) : '0'), 80), Egw = inp(v(12), 80), Dsw = inp(v(9) || '0', 80), Egwt = inp(v(10), 80), Eb = inp(v(11), 80);
    const eq = h('div', { class: 'gweq' }, 'The standard lateral groundwater flow equation:', h('div', { class: 'eqi' }, 'Q', h('sub', null, 'L'), ' = A1(H', h('sub', null, 'GW'), ' − H', h('sub', null, 'CB'), ')', h('sup', null, 'B1'), ' − A2(H', h('sub', null, 'SW'), ' − H', h('sub', null, 'CB'), ')', h('sup', null, 'B2'), ' + A3·H', h('sub', null, 'GW'), '·H', h('sub', null, 'SW')),
      'where', h('div', { class: 'eqi' }, 'H', h('sub', null, 'GW'), ' = water table elevation − aquifer bottom elevation;', h('br'), 'H', h('sub', null, 'CB'), ' = min. water table elevation − aquifer bottom elevation;', h('br'), 'H', h('sub', null, 'SW'), ' = H', h('sub', null, 'CB'), ' + surface water depth;'),
      'The standard deep groundwater flow equation:', h('div', { class: 'eqi' }, 'Q', h('sub', null, 'D'), ' = LGLR · H', h('sub', null, 'GW'), ' / H', h('sub', null, 'GS')),
      'where', h('div', { class: 'eqi' }, 'LGLR = aquifer lower GW loss rate;', h('br'), 'H', h('sub', null, 'GS'), ' = surface elevation − aquifer bottom elevation;'));
    const left = h('div', { class: 'gwleft' }, h('div', { class: 'psub' }, 'Properties'), eq, h('div', { class: 'form pform' }, h('label', null, 'Aquifer'), aq, h('label', null, 'Receiving Node'), nd,
      h('label', null, 'A1 Coefficient'), A1, h('label', null, 'B1 Exponent'), B1, h('label', null, 'A2 Coefficient'), A2, h('label', null, 'B2 Exponent'), B2, h('label', null, 'A3 Coefficient'), A3,
      h('label', null, 'Unsaturated Zone Moisture'), UM, h('label', null, 'Custom Lateral Flow Equation'), LAT, h('label', null, 'Custom Deep Flow Equation'), DEEP));
    const pos = (el, x, y) => { el.style.position = 'absolute'; el.style.left = x + 'px'; el.style.top = y + 'px'; return el; };
    const tag = (txt, x, y) => pos(h('div', { class: 'gwlbl' }, txt), x, y);
    const svg = '<svg width="420" height="420" viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="gwdots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#9aa3ab"/><circle cx="7" cy="7" r="1.2" fill="#9aa3ab"/></pattern></defs>' +
      '<rect x="0" y="0" width="420" height="420" fill="#fff"/><path d="M0 20 L150 20 L270 200 L270 400 L0 400 Z" fill="url(#gwdots)" stroke="#555"/>' +
      '<path d="M0 110 L210 110 L270 200 L270 400 L0 400 Z" fill="#cfe9f4"/><path d="M0 110 L210 110" stroke="#555" stroke-dasharray="4 3"/>' +
      '<path d="M210 110 L270 200 L360 200 L360 160 L420 160 L420 400 L270 400" fill="#cfe9f4"/><rect x="300" y="160" width="120" height="40" fill="#5bb6dc"/><path d="M150 20 L300 245 L300 160" fill="none" stroke="#555"/>' +
      '<path d="M0 190 L420 190" stroke="#555" stroke-dasharray="4 3"/><path d="M0 395 L420 395" stroke="#444" stroke-width="3"/><path d="M0 400 L420 400 L420 420 L0 420Z" fill="#c9c9c9"/>' +
      '<path d="M270 300 L270 380 M262 370 L270 385 L278 370" stroke="#333" fill="none"/><path d="M215 182 L265 182 M255 176 L268 182 L255 188" stroke="#fff" stroke-width="3" fill="none"/><path d="M380 170 L380 200" stroke="#333"/>' +
      '<text x="70" y="80" font-size="18" font-weight="700" fill="#333">Upper Zone</text><text x="70" y="270" font-size="18" font-weight="700" fill="#333">Lower Zone</text>' +
      '<text x="200" y="172" font-size="11" fill="#333">Q</text><text x="207" y="175" font-size="8" fill="#333">L</text><text x="276" y="335" font-size="11" fill="#333">Q</text><text x="283" y="338" font-size="8" fill="#333">D</text></svg>';
    const pic = h('div', { class: 'gwpic' }); pic.innerHTML = svg;
    pic.append(tag('Surface Elev. (' + L + ')', 4, 2), pos(Es, 120, 0), tag('Init Water Table Elev. (' + L + ')', 4, 90), pos(Egw, 178, 88), tag('Surface Water Depth (' + L + ')', 4, 160), pos(Dsw, 160, 158),
      tag('Min. Water Table Elev. (' + L + ')', 4, 196), pos(Egwt, 176, 194), tag('Aquifer Bottom Elev. (' + L + ')', 4, 372), pos(Eb, 170, 370));
    const right = h('div', { class: 'gwright' }, pic, h('div', { class: 'note pnote' }, 'Blank Init Water Table / Aquifer Bottom / Unsaturated Moisture use the aquifer values; blank Min. Water Table uses the receiving node invert.'));
    const body = h('div', { class: 'pedit gwedit', style: { width: '900px' } }, left, right);
    const r = await AV.modal({ title: 'Groundwater Editor - ' + sc.id, body, enterSubmits: false, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => {
      if (aq.value && !nd.value.trim()) { AV.toast('Choose the receiving node.', true); return false; }
      if (aq.value && nd.value.trim() && !m.nodes.has(nd.value.trim())) { AV.toast('Node ' + nd.value.trim() + ' not found.', true); return false; } return 'ok'; } }] }).done;
    if (!r) return;
    const secs = {};
    if (!aq.value) secs.GROUNDWATER = replaceRows(m, 'GROUNDWATER', sc.id, []);
    else { const opt = [Egwt, Eb, Egw, UM].map(x => x.value.trim()); while (opt.length > 1 && opt[opt.length - 1] === '') opt.pop();
      secs.GROUNDWATER = replaceRows(m, 'GROUNDWATER', sc.id, [fmtLine([sc.id, aq.value, nd.value.trim(), Es.value.trim() || '0', A1.value.trim() || '0', B1.value.trim() || '0', A2.value.trim() || '0', B2.value.trim() || '0', A3.value.trim() || '0', Dsw.value.trim() || '0'].concat(opt.map(x => x || '*')))]); }
    const gl = []; if (aq.value && LAT.value.trim()) gl.push((sc.id + ' ').padEnd(17) + 'LATERAL    ' + LAT.value.trim()); if (aq.value && DEEP.value.trim()) gl.push((sc.id + ' ').padEnd(17) + 'DEEP       ' + DEEP.value.trim());
    secs.GWF = replaceRows(m, 'GWF', sc.id, gl);
    AV.setSections(app, 'Edit groundwater (' + sc.id + ')', secs);
    app.panels.showProps();
  };

  // ------------------------------------------------------------------ LID Usages (per subcatchment)
  AV.lidUsageEditor = async function (app, sc) {
    const m = app.model, A = m.isSI ? 'm²' : 'ft²', L = m.isSI ? 'm' : 'ft';
    const lids = uniq(dataTok(m, 'LID_CONTROLS').map(t => t[0]));
    const items = dataTok(m, 'LID_USAGE').filter(t => t[0] === sc.id).map(t => ({ lid: t[1] || '', num: t[2] || '1', area: t[3] || '0', width: t[4] || '0', sat: t[5] || '0', imp: t[6] || '0', toperv: t[7] || '0', rpt: t[8] && t[8] !== '*' ? t[8] : '', drain: t[9] && t[9] !== '*' ? t[9] : '', perv: t[10] || '0' }));
    let cur = items.length ? 0 : -1; const list = h('div', { class: 'plist' }); const right = h('div', { class: 'pright' }); let save = null;
    const show = () => { right.innerHTML = ''; save = null; if (cur < 0) { right.appendChild(h('div', { class: 'empty' }, lids.length ? 'Click + to add an LID unit to this subcatchment.' : 'Define LID Controls first (Hydrology → LID Controls).')); return; }
      const it = items[cur]; const lid = sel(empty(lids), it.lid, 200), ar = inp(it.area), nu = inp(it.num), wi = inp(it.width), sa = inp(it.sat), im = inp(it.imp), pv = inp(it.perv), dr = inp(it.drain); dr.setAttribute('list', 'dl-outlet');
      const tp = h('input', { type: 'checkbox', checked: it.toperv === '1' }), rp = inp(it.rpt);
      right.appendChild(ptab([['LID Process', lid], ['Area of Each Unit (' + A + ')', ar], ['Number of Units', nu], ['Width of Each Unit (' + L + ')', wi], ['Initially Saturated (%)', sa], ['Impervious Area Applied (%)', im], ['Pervious Area Applied (%)', pv],
        ['Outlet Module (drain to)', dr], ['Return all Outflows to Pervious Area', h('label', { class: 'pchk' }, tp, ' True')], ['Report File (Optional)', rp]]));
      right.appendChild(h('div', { class: 'note pnote' }, 'Width = outflow face width of each unit; Applied (%) = share of the subcatchment\'s impervious / pervious runoff treated by the units; Outlet Module = node or subcatchment that receives the drain flow (blank = subcatchment outlet).'));
      save = () => Object.assign(it, { lid: lid.value, area: ar.value.trim() || '0', num: nu.value.trim() || '1', width: wi.value.trim() || '0', sat: sa.value.trim() || '0', imp: im.value.trim() || '0', perv: pv.value.trim() || '0', drain: dr.value.trim(), toperv: tp.checked ? '1' : '0', rpt: rp.value.trim() }); };
    const renderList = () => { list.innerHTML = ''; items.forEach((it, i) => list.appendChild(h('div', { class: 'pli' + (i === cur ? ' sel' : ''), onclick: () => { save && save(); cur = i; renderList(); show(); } }, '#' + (i + 1) + (it.lid ? '  ' + it.lid : '')))); };
    const tools = h('div', { class: 'ptools' }, h('button', { class: 'pib add', title: 'Add', onclick: () => { if (!lids.length) { AV.toast('Define LID Controls first.', true); return; } save && save(); items.push({ lid: lids[0], num: '1', area: '0', width: '0', sat: '0', imp: '0', toperv: '0', rpt: '', drain: '', perv: '0' }); cur = items.length - 1; renderList(); show(); } }, '+'),
      h('button', { class: 'pib del', title: 'Delete', onclick: () => { if (cur < 0) return; items.splice(cur, 1); cur = Math.min(cur, items.length - 1); renderList(); show(); } }, '−'));
    renderList(); show();
    const body = h('div', { class: 'pedit plistedit', style: { width: '640px' } }, h('div', { class: 'pleft' }, tools, list), right);
    const r = await AV.modal({ title: 'LID Usages Editor - ' + sc.id, body, enterSubmits: false, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => { save && save(); const b = items.find(x => !x.lid); if (b) { AV.toast('Choose the LID process of every unit.', true); return false; } return 'ok'; } }] }).done;
    if (!r) return;
    const lines = items.map(it => fmtLine([sc.id, it.lid, it.num, it.area, it.width, it.sat, it.imp, it.toperv, it.rpt || '*', it.drain || '*', it.perv]));
    AV.setSections(app, 'Edit LID usages (' + sc.id + ')', { LID_USAGE: replaceRows(m, 'LID_USAGE', sc.id, lines) });
    app.panels.showProps();
  };
})(window.AV);
