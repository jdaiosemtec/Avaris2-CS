// Flow units switch (status bar / Simulation Options): change the model's flow units and, if the user wants, convert
// every value of the model to the new unit system (US <-> SI) or the new flow unit (same system).
'use strict';
(function (AV) {
  const h = AV.h;
  const TO_CFS = { CFS: 1, GPM: 1 / 448.831, MGD: 1.5472286, CMS: 35.3146667, LPS: 0.0353146667, MLD: 0.408734569 };
  const SI = (u) => ['CMS', 'LPS', 'MLD'].includes(u);
  const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : null; };
  const fmt = (x) => +(+x).toPrecision(8);

  // convert the model in place; returns the list of sections that were left unchanged
  function convertModel(m, from, to) {
    const q = TO_CFS[from] / TO_CFS[to]; // flow factor
    const sys = SI(from) !== SI(to); const toSI = SI(to);
    const L = !sys ? 1 : toSI ? 0.3048 : 1 / 0.3048;            // ft <-> m
    const A2 = L * L, V3 = L * L * L;                             // ft2 <-> m2, ft3 <-> m3
    const AC = !sys ? 1 : toSI ? 0.40468564 : 1 / 0.40468564;    // acres <-> hectares
    const D = !sys ? 1 : toSI ? 25.4 : 1 / 25.4;                 // in <-> mm (rain, rates, depression storage)
    const WC = !sys ? 1 : toSI ? 0.552 : 1 / 0.552;              // weir coefficient (Q = C L h^1.5)
    const sc = (o, k, f) => { const v = num(o[k]); if (v !== null && f !== 1) o[k] = fmt(v * f); };
    const LEN_G = { CIRCULAR: [1], FORCE_MAIN: [1], FILLED_CIRCULAR: [1, 2], RECT_CLOSED: [1, 2], RECT_OPEN: [1, 2], TRAPEZOIDAL: [1, 2], TRIANGULAR: [1, 2], HORIZ_ELLIPSE: [1, 2], VERT_ELLIPSE: [1, 2], ARCH: [1, 2],
      PARABOLIC: [1, 2], POWER: [1, 2], RECT_TRIANGULAR: [1, 2, 3], RECT_ROUND: [1, 2, 3], MODBASKETHANDLE: [1, 2, 3], CUSTOM: [1] };
    const xs = (p) => { const sh = String(p.shape || 'CIRCULAR').toUpperCase(); if (sh === 'IRREGULAR' || sh === 'STREET' || sh === 'DUMMY') return; for (const i of LEN_G[sh] || [1]) sc(p, 'g' + i, L); };
    const infMethod = String(m.options.INFILTRATION || 'HORTON').toUpperCase();
    for (const n of m.nodes.values()) { const p = n.p;
      for (const k of ['elev', 'maxDepth', 'initDepth', 'surDepth']) sc(p, k, L); sc(p, 'aPonded', A2); sc(p, 'chamberArea', A2);
      if (n.type === 'OUTFALL' && String(p.otype).toUpperCase() === 'FIXED') sc(p, 'stage', L);
      if (n.type === 'STORAGE') { const sh = String(p.shape || '').toUpperCase();
        if (sh === 'FUNCTIONAL') { const b = num(p.sp2) || 0; sc(p, 'sp1', A2 / Math.pow(L, b)); sc(p, 'sp3', A2); }
        else if (sh !== 'TABULAR') { sc(p, 'sp1', L); sc(p, 'sp2', L); }
        sc(p, 'psi', D); sc(p, 'ksat', D); }
      if (n.type === 'DIVIDER') { const t = String(p.dtype).toUpperCase(); const a = String(p.dparam || '').split(/\s+/);
        if (t === 'CUTOFF' && num(a[0]) !== null) p.dparam = String(fmt(num(a[0]) * q));
        if (t === 'WEIR' && a.length >= 3) p.dparam = [fmt(num(a[0]) * q), fmt(num(a[1]) * L), fmt(num(a[2]) * WC)].join(' '); } }
    for (const l of m.links.values()) { const p = l.p;
      if (l.type === 'CONDUIT') { sc(p, 'length', L); sc(p, 'inOff', L); sc(p, 'outOff', L); sc(p, 'initFlow', q); sc(p, 'maxFlow', q); sc(p, 'seepage', D); xs(p); }
      else if (l.type === 'PUMP') { sc(p, 'startup', L); sc(p, 'shutoff', L); }
      else if (l.type === 'ORIFICE') { sc(p, 'offset', L); xs(p); }
      else if (l.type === 'WEIR') { sc(p, 'crest', L); sc(p, 'qcoeff', WC); sc(p, 'endCoeff', WC); xs(p); if (num(p.roadWidth) !== null) sc(p, 'roadWidth', L); }
      else if (l.type === 'OUTLET') { sc(p, 'offset', L); if (/^FUNCTIONAL/i.test(p.otype || '')) { const e = num(p.c2) || 0; sc(p, 'c1', q / Math.pow(L, e)); } } }
    for (const s of m.subcatchments.values()) { const p = s.p; sc(p, 'area', AC); sc(p, 'width', L); sc(p, 'curbLen', L); sc(p, 'sImp', D); sc(p, 'sPerv', D);
      const im = String(p.imethod || infMethod).toUpperCase();
      if (/HORTON/.test(im)) { sc(p, 'i1', D); sc(p, 'i2', D); sc(p, 'i5', D); } else if (/GREEN/.test(im)) { sc(p, 'i1', D); sc(p, 'i2', D); } }
    // curves by type
    for (const c of m.curves.values()) { const t = String(c.type || '').toUpperCase(); const fx = { STORAGE: [L, A2], PUMP1: [V3, q], PUMP2: [L, q], PUMP3: [L, q], PUMP4: [L, q], PUMP5: [L, q], RATING: [L, q], TIDAL: [1, L], DIVERSION: [q, q], WEIR: [L, WC] }[t];
      if (fx) c.pts = c.pts.map(([x, y]) => [fmt(x * fx[0]), fmt(y * fx[1])]); }
    // rainfall time series (project rain units) of the rain gages without own units
    const rainTS = new Set([...m.gages.values()].filter(g => g.p.source !== 'FILE' && !g.p.tsUnits).map(g => g.p.series));
    if (D !== 1) for (const n of rainTS) { const ts = m.timeseries.get(n); if (ts && ts.rows) ts.rows = ts.rows.map(r => [r[0], r[1], fmt(r[2] * D)]); }
    // free-form sections: inflows / dry weather flow (flow values), evaporation, transects, options
    const tok = AV.tokenize; const line = (t) => t.map((x, j) => j === t.length - 1 ? String(x) : (String(x) + ' ').padEnd(j === 0 ? 17 : 11)).join('');
    const mapRows = (sec, fn) => { if (!m.raw[sec]) return; m.raw[sec] = m.raw[sec].map(l => { const tl = l.trim(); if (!tl || tl[0] === ';') return l; const t = tok(l); const r = fn(t); return r ? line(r) : l; }); };
    mapRows('INFLOWS', (t) => { if ((t[1] || '').toUpperCase() !== 'FLOW') return null; if (t.length > 5 && num(t[5]) !== null) t[5] = fmt(num(t[5]) * q); if (t.length > 6 && num(t[6]) !== null) t[6] = fmt(num(t[6]) * q); if (t[2] === '') t[2] = '""'; return t; });
    mapRows('DWF', (t) => { if ((t[1] || '').toUpperCase() !== 'FLOW' || num(t[2]) === null) return null; t[2] = fmt(num(t[2]) * q); return t; });
    if (D !== 1) mapRows('EVAPORATION', (t) => { const k = (t[0] || '').toUpperCase(); if (k === 'CONSTANT' || k === 'MONTHLY') { for (let i = 1; i < t.length; i++) if (num(t[i]) !== null) t[i] = fmt(num(t[i]) * D); return t; } return null; });
    if (L !== 1) mapRows('TRANSECTS', (t) => { const k = (t[0] || '').toUpperCase();
      if (k === 'GR') { for (let i = 1; i < t.length; i++) if (num(t[i]) !== null) t[i] = fmt(num(t[i]) * L); return t; }
      if (k === 'X1') { for (const i of [3, 4, 8]) if (t.length > i && num(t[i]) !== null) t[i] = fmt(num(t[i]) * L); return t; } return null; });
    for (const [k, f] of [['MIN_SURFAREA', A2], ['HEAD_TOLERANCE', L]]) if (m.options[k] !== undefined && num(m.options[k]) !== null) m.options[k] = String(fmt(num(m.options[k]) * f));
    m.options.FLOW_UNITS = to;
    const left = sys ? ['AQUIFERS', 'GROUNDWATER', 'SNOWPACKS', 'LID_CONTROLS', 'LID_USAGE', 'HYDROGRAPHS', 'RDII', 'BUILDUP', 'TEMPERATURE', 'STREETS', 'INLETS'].filter(s => (m.raw[s] || []).some(l => l.trim() && l.trim()[0] !== ';')) : [];
    return left;
  }

  AV.changeFlowUnits = async function (app, to) {
    const m = app.model; const from = m.flowUnits; to = String(to || '').toUpperCase(); if (!TO_CFS[to] || to === from) return;
    const sys = SI(from) !== SI(to);
    const body = h('div', { style: { maxWidth: '520px', lineHeight: 1.55 } },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'Change the flow units from ' + from + ' to ' + to + (sys ? ' (' + (SI(to) ? 'US → SI' : 'SI → US') + ' unit system)' : '') + '.'),
      h('div', null, 'Convert values: all values of the model are converted to the new units (' + (sys ? 'elevations, depths, lengths, areas, flows, infiltration and rain rates, curves, weir coefficients ...' : 'flows, pump / rating / diversion curves, inflows and dry weather flows') + ').'),
      h('div', null, 'Keep values: only the unit label changes; every number stays as it is.'));
    const r = await AV.modal({ title: 'Flow Units', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Keep values', value: 'keep' }, { label: 'Convert values', primary: true, value: 'conv' }] }).done;
    if (!r) { app.refreshAll && app.refreshAll(); return; }
    const snap = () => JSON.stringify({ n: [...m.nodes.values()].map(o => o.p), l: [...m.links.values()].map(o => o.p), s: [...m.subcatchments.values()].map(o => o.p), c: [...m.curves.entries()], t: [...m.timeseries.entries()], raw: m.raw, opt: m.options });
    const restore = (js) => { const S = JSON.parse(js); [...m.nodes.values()].forEach((o, i) => { o.p = S.n[i]; }); [...m.links.values()].forEach((o, i) => { o.p = S.l[i]; }); [...m.subcatchments.values()].forEach((o, i) => { o.p = S.s[i]; });
      m.curves.clear(); for (const [k, v] of S.c) m.curves.set(k, v); m.timeseries.clear(); for (const [k, v] of S.t) m.timeseries.set(k, v); m.raw = S.raw; m.options = S.opt; };
    const before = snap(); let left = [];
    if (r === 'conv') left = convertModel(m, from, to); else m.options.FLOW_UNITS = to;
    const after = snap(); restore(before);
    app.exec({ label: 'Flow units ' + from + ' → ' + to + (r === 'conv' ? ' (values converted)' : ''), do: () => restore(after), undo: () => restore(before), changes: [{ o: { kind: 'OPTIONS', id: 'Options', type: '' }, key: 'FLOW_UNITS', old: from, nw: to }] });
    if (m.geomVersion !== undefined) m.geomVersion++;
    app.refreshAll(); app.map.redraw(); app.panels.showProps();
    if (app.flags) app.flags.changed();   // flag parameters follow the unit system
    if (app.results) AV.toast('The loaded results are still in ' + from + '; run the model again.', false, 6000);
    AV.alert('Flow units changed to ' + to + (r === 'conv' ? ', values converted.' : ', values kept.') + (left.length ? '\n\nNot converted (check these sections by hand): ' + left.join(', ') + '.' : '') + (sys && app.mesh2d ? '\n\nThe 2D mesh keeps its elevations; rebuild it (Create Meshes) if the DEM units no longer match.' : ''), 'Flow Units');
  };
  AV.FLOW_TO_CFS = TO_CFS;
})(window.AV);
