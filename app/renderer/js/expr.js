// Expression language for Select by Attribute and custom themes.
//   fields  : every model field, computed values and simulation results (see AV.exprFields)
//   numbers, 'strings', ( ), + - * / % ^, = == != <> > >= < <=, like ('J_5%'), and or not (&& || !)
//   functions: abs sqrt min max round floor ceil log log10 exp pow len upper lower contains startswith endswith
//              isnull iif(cond, a, b) num str
'use strict';
(function (AV) {
  const h = AV.h;

  // ------------------------------------------------------------------ field catalogue
  const camel = (s) => s.replace(/\(.*?\)/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (m, c) => c ? c.toUpperCase() : '').replace(/^./, c => c.toLowerCase());
  // field names follow Avaris DS where they exist (rimElev, roughness, inOffset, rptMaxFlow, rptMfFlow ...);
  // the older OsemCM names stay valid as aliases
  const RENAME = { rough: 'roughness', inOff: 'inOffset', outOff: 'outOffset', elev: 'elev', g1: 'geom1', g2: 'geom2', g3: 'geom3', g4: 'geom4' };
  const NODE_LABEL = { elev: 'Chamber Floor Elev.', maxDepth: 'Chamber Depth', rimElev: 'Rim Elev.', rptFreeboard: 'Min. Freeboard', rptMaxDepth: 'Max. Depth', rptMaxHgl: 'Max. HGL',
    rptMaxLatInflow: 'Max. Lateral Inflow', rptMaxTotInflow: 'Max. Total Inflow', rptMaxFlooding: 'Max. Flood Rate', rptMaxVolume: 'Max. Volume', rptDepthRatio: 'Max. Depth / Chamber Depth' };
  const LINK_LABEL = { rptMaxFlow: 'Max. Flow', rptMaxVel: 'Max. Velocity', rptMaxCapacity: 'Max. Capacity', rptMaxDepth: 'Max. Depth', rptMaxVolume: 'Max. Volume', rptMfFlow: 'Max. Flow / Full Flow', rptMfDepth: 'Max. Depth / Full Depth' };
  const fieldCache = new WeakMap();

  // ------------------------------------------------------------------ plain-language description of every field
  // {L} length, {A} small area, {LA} land area, {Q} flow, {R} rate, {D} depth (in / mm), {M} map units
  const DESC = {
    name: 'Unique object ID', tag: 'User tag (category text)', descrip: 'Free-text description of the object', type: 'Object type (JUNCTION, CONDUIT, ...)',
    x: 'Map X coordinate {M}', y: 'Map Y coordinate {M}', usNode: 'ID of the upstream (inlet) node', dsNode: 'ID of the downstream (outlet) node',
    // nodes
    elev: 'Invert (chamber floor) elevation {L}', maxDepth: 'Chamber depth: invert to rim {L}', initDepth: 'Water depth at the start of the simulation {L}',
    surDepth: 'Extra depth above the rim allowed before flooding (pressurised manhole) {L}', aPonded: 'Ponding area on the surface when flooded; 0 = flood water is lost {A}',
    chamberArea: 'Manhole chamber plan area; 0 = use the minimum surface area from Options {A}', otype: 'Outfall type / orifice type / outlet rating curve type',
    stage: 'Fixed stage, tidal curve or time series of the outfall', gated: 'Flap gate that prevents backflow (YES / NO)', routeTo: 'Subcatchment receiving the outfall flow / internal routing of sub-areas',
    divLink: 'Link that receives the diverted flow', dtype: 'Divider type (OVERFLOW, CUTOFF, TABULAR, WEIR)', dparam: 'Divider parameters (cutoff flow, curve or weir data)',
    shape: 'Storage curve type / conduit cross-section shape', sp1: 'Storage: coefficient A, curve name or length', sp2: 'Storage: exponent B or width', sp3: 'Storage: constant C or side slope',
    fevap: 'Fraction of potential evaporation applied to the storage surface (0-1)', psi: 'Seepage soil suction head {D}', ksat: 'Seepage saturated conductivity {R}', imd: 'Seepage initial moisture deficit (fraction)',
    inflowTS: 'Time series of external (direct) inflow', inflowSF: 'Scale factor applied to the inflow time series', inflowBase: 'Constant baseline external inflow {Q}',
    dwf: 'Average dry weather (sanitary) flow {Q}', uh: 'RDII unit hydrograph group', sewArea: 'Sewershed area contributing RDII {LA}',
    rimElev: 'Rim (ground) elevation = invert + chamber depth {L}', rim: 'Rim (ground) elevation = invert + chamber depth {L}', nLinks: 'Number of links connected to the node',
    // links
    length: 'Conduit length {L}', roughness: "Manning's roughness coefficient n", inOffset: 'Height of the conduit inlet invert above the upstream node invert {L}',
    outOffset: 'Height of the conduit outlet invert above the downstream node invert {L}', initFlow: 'Flow at the start of the simulation {Q}', maxFlow: 'Maximum flow limit; 0 = no limit {Q}',
    geom1: 'Full height / diameter of the cross section {L}', geom2: 'Second dimension of the cross section (bottom / top width, filled depth ...)', geom3: 'Third shape parameter (side slope, radius ...)', geom4: 'Fourth shape parameter (side slope ...)',
    barrels: 'Number of identical parallel barrels', culvert: 'FHWA culvert inlet code (blank = not a culvert)', kEntry: 'Minor loss coefficient at the entrance', kExit: 'Minor loss coefficient at the exit',
    kAvg: 'Average minor loss coefficient along the length', flap: 'Flap gate that prevents reverse flow (YES / NO)', seepage: 'Seepage loss rate through the conduit bottom {R}',
    curve: 'Pump curve name', status: 'Initial pump status (ON / OFF)', startup: 'Inlet node depth at which the pump turns on {L}', shutoff: 'Inlet node depth at which the pump turns off {L}',
    offset: 'Height of the bottom / crest above the inlet node invert {L}', qcoeff: 'Discharge coefficient', closeTime: 'Time to fully open or close (hours)',
    wtype: 'Weir type', crest: 'Crest height above the inlet node invert {L}', endCon: 'Number of end contractions', endCoeff: 'End coefficient of a trapezoidal weir',
    surcharge: 'Weir can surcharge (YES / NO)', roadWidth: 'Roadway width for ROADWAY weirs {L}', roadSurf: 'Road surface (PAVED / GRAVEL)', coeffCurve: 'Discharge coefficient curve',
    c1: 'Outlet rating coefficient or curve name', c2: 'Outlet rating exponent', slope: 'Slope in percent', mapLength: 'Length measured along the drawn line {M}',
    diam: 'Full height / diameter (geom1) {L}', usInvert: 'Invert elevation at the upstream end {L}', dsInvert: 'Invert elevation at the downstream end {L}', fullFlow: "Full-pipe capacity by Manning's equation {Q}",
    // subcatchments
    gage: 'Rain gage supplying rainfall', outlet: 'Node or subcatchment receiving the runoff', area: 'Subcatchment area {LA}', imperv: 'Percent of the area that is impervious (%)',
    width: 'Characteristic overland flow width {L}', curbLen: 'Total curb length (for pollutant buildup)', snowPack: 'Snow pack parameter set',
    nImp: "Manning's n for overland flow on the impervious area", nPerv: "Manning's n for overland flow on the pervious area", sImp: 'Depression storage of the impervious area {D}',
    sPerv: 'Depression storage of the pervious area {D}', pctZero: 'Percent of the impervious area with no depression storage (%)', pctRouted: 'Percent of runoff routed between sub-areas (%)',
    impCoef: 'Impervious runoff coefficient: fraction of impervious runoff that reaches the outlet (0-1)', i1: 'Infiltration parameter 1 (max. rate / suction head / curve number)',
    i2: 'Infiltration parameter 2 (min. rate / conductivity)', i3: 'Infiltration parameter 3 (decay constant / initial deficit / drying time)', i4: 'Infiltration parameter 4 (drying time)',
    i5: 'Infiltration parameter 5 (max. infiltration volume)', imethod: 'Infiltration method of this subcatchment (blank = Options default)', polyArea: 'Area of the drawn polygon {LA}',
    // results
    rptFreeboard: 'Rim elevation minus maximum HGL; negative = flooding {L}', rptDepthRatio: 'Maximum depth divided by chamber depth (1 = full)', rptNonconv: 'Percent of time steps in which the node did not converge (%)',
    rptMfFlow: 'Maximum flow divided by full-pipe flow', rptMfDepth: 'Maximum depth divided by full depth (d/D)', rptSurcharge: 'Pressurised now: 1 = full and water above the crown at both ends, else 0',
    rptMaxSurcharge: 'Pressurised at any time during the simulation (1 / 0)', rptSurchargeHrs: 'Total time the conduit was pressurised (hours)',
    rptAvgDepth: 'Average water depth over the simulation {L}', rptLatInflowVol: 'Total lateral inflow volume (report)', rptTotInflowVol: 'Total inflow volume (report)', rptFlowBalErr: 'Flow balance error of the node (%)',
    rptHrsSurcharged: 'Hours the water level was above the highest connected pipe crown', rptMaxAboveCrown: 'Maximum height of water above the highest pipe crown {L}', rptMinBelowRim: 'Minimum distance of the water surface below the rim {L}',
    rptHrsFlooded: 'Hours the node was flooding', rptFloodVol: 'Total volume lost to flooding (report units)', rptMaxPondedDepth: 'Maximum ponded depth above the rim {L}',
  };
  AV.fieldDesc = function (app, f) {
    const m = app.model, u = (k) => AV.unitText ? AV.unitText(m, k) : '';
    const fill = (t) => t.replace(/\{(L|A|LA|Q|R|D|M)\}/g, (x, k) => { const v = u(k === 'M' ? 'map' : k); return v ? '(' + v + ')' : ''; }).trim();
    let n = f.n, pre = '';
    const mm = /^(us|ds|out)_(.+)$/.exec(n); if (mm) { n = mm[2]; pre = mm[1] === 'us' ? 'Upstream node: ' : mm[1] === 'ds' ? 'Downstream node: ' : 'Node receiving the runoff: '; }
    let d = DESC[n] || (f.al || []).map(a => DESC[a.replace(/^(us|ds|out)_/, '')]).find(Boolean);
    if (!d && /^rptMax/.test(n)) d = 'Maximum over the whole simulation of: ' + f.l.replace(/^(US Node|DS Node|Outlet Node): /, '').replace(/^Max\.\s*/, '').replace(/ \(result\)$/, '');
    else if (!d && /^rpt/.test(n)) d = 'Value at the current time step of: ' + f.l.replace(/^(US Node|DS Node|Outlet Node): /, '').replace(/ (at current time step )?\(result\)$/, '').replace(/ at current time step$/, '');
    return d ? pre + fill(d) : pre + f.l;
  };
  AV.exprFields = function (app, kind, noNeighbours) {
    const m = app.model, R = app.results;
    const ck = (fieldCache.get(m) || (fieldCache.set(m, {}), fieldCache.get(m))); const key = kind + (noNeighbours ? '-' : '') + '|' + (R ? R.handle : '') + '|' + m.version;
    if (ck[key]) return ck[key];
    const out = []; const seen = new Set();
    const LBL = kind === 'node' ? NODE_LABEL : kind === 'link' ? LINK_LABEL : {};
    const add = (n, l, get, grp, al) => { if (seen.has(n)) return; seen.add(n); out.push({ n, l: LBL[n] ? LBL[n] + (/\(result\)/.test(l) ? ' (result)' : '') : l, get, g: grp || 'Properties', al: al || [], vt: 'self' }); };
    add('name', 'Name / ID', o => o.id, 'General'); add('tag', 'Tag', o => o.tag || '', 'General'); add('descrip', 'Description', o => o.desc || '', 'General'); add('type', 'Object type', o => o.type || o.kind, 'General');
    const types = kind === 'node' ? AV.NODE_TYPES : kind === 'link' ? AV.LINK_TYPES : ['SUBCATCH'];
    if (kind === 'node') { add('x', 'X coordinate', o => o.x, 'General'); add('y', 'Y coordinate', o => o.y, 'General'); }
    if (kind === 'link') { add('usNode', 'Upstream (inlet) node', o => o.from, 'General'); add('dsNode', 'Downstream (outlet) node', o => o.to, 'General'); }
    for (const t of types) for (const f of AV.SCHEMA[t] || []) { const n = RENAME[f.k] || f.k; add(n, f.l + (types.length > 1 ? ' (' + t.toLowerCase() + ')' : ''), o => o.p[f.k], 'Properties', n !== f.k ? [f.k] : []); }
    if (kind === 'node') for (const k of Object.keys(AV.VIRT)) if (AV.VIRT[k].node) add(k, AV.VIRT[k].l, o => AV.VIRT[k].get(m, o));
    // computed
    if (kind === 'node') {
      add('rimElev', 'Rim elevation (computed)', o => o.type === 'OUTFALL' ? null : +o.p.elev + (+o.p.maxDepth || 0), 'Computed', ['rim']);
      add('nLinks', 'Connected links', (() => { let deg = null; return o => { if (!deg) { deg = new Map(); for (const l of m.links.values()) { deg.set(l.from, (deg.get(l.from) || 0) + 1); deg.set(l.to, (deg.get(l.to) || 0) + 1); } } return deg.get(o.id) || 0; }; })(), 'Computed');
    }
    if (kind === 'link') {
      add('slope', 'Slope % (computed)', o => { const s = AV.conduitSlope(m, o); return s === null ? null : s * 100; }, 'Computed');
      add('mapLength', 'Map length (computed)', o => m.linkLengthGeom(o), 'Computed');
      add('diam', 'Height / diameter (geom1)', o => parseFloat(o.p.g1), 'Computed');
      add('usInvert', 'Upstream invert (computed)', o => { const a = m.nodes.get(o.from); return a ? +a.p.elev + (+o.p.inOff || +o.p.offset || 0) : null; }, 'Computed');
      add('dsInvert', 'Downstream invert (computed)', o => { const b = m.nodes.get(o.to); return b ? +b.p.elev + (+o.p.outOff || 0) : null; }, 'Computed');
      add('fullFlow', 'Full-pipe flow, Manning (computed)', o => AV.fullFlow(m, o), 'Computed');
    }
    if (kind === 'sub') add('polyArea', 'Polygon area (computed)', o => app.tools.areaFromPoly(o.poly), 'Computed');
    // results
    const RV = AV.RESULT_VARS || {};
    const rk = kind === 'sub' ? 'subcatch' : kind;
    const short = { 'Head (HGL)': 'Hgl', 'Capacity (d/D)': 'Capacity', 'Lateral Inflow': 'LatInflow', 'Total Inflow': 'TotInflow', 'Velocity': 'Vel' };
    (RV[rk] || []).forEach((vn, v) => {
      const nm = (short[vn] || vn.replace(/[^A-Za-z]/g, ''));
      add('rptMax' + nm, 'Max. ' + vn + ' (result)', o => R ? R.valueOf(o, v, true, rk === 'link' && v === 0) : null, 'Results', nm === 'Vel' ? ['rptMaxVelocity'] : []);
      add('rpt' + nm, vn + ' at current time step (result)', o => R ? R.valueOf(o, v, false) : null, 'Results', nm === 'Vel' ? ['rptVelocity'] : []);
    });
    if (kind === 'link') {
      add('rptMfFlow', 'Max. flow / full flow (result)', o => { if (!R) return null; const q = R.valueOf(o, 0, true, true), qf = AV.fullFlow(m, o); return q === null || !qf ? null : q / qf; }, 'Results');
      add('rptMfDepth', 'Max. depth / full depth (result)', o => R ? R.valueOf(o, 4, true) : null, 'Results');
      add('rptSurcharge', 'Surcharge at current time step, 0/1 (result)', o => R ? R.surchargeNow(o) : null, 'Results', ['surcharge']);
      add('rptMaxSurcharge', 'Max. surcharge, 0/1 (result)', o => { if (!R) return null; if (!R.sur) R.computeSurcharge(() => app.theme && app.theme.invalidate && (app.theme.invalidate(), app.map.redraw())); return R.surchargeStat(o, 'ever'); }, 'Results');
      add('rptSurchargeHrs', 'Surcharged duration, hr (result)', o => { if (!R) return null; if (!R.sur) R.computeSurcharge(() => app.theme && app.theme.invalidate && (app.theme.invalidate(), app.map.redraw())); return R.surchargeStat(o, 'h'); }, 'Results');
    }
    if (kind === 'node') {
      add('rptFreeboard', 'Min. freeboard (rim - max HGL)', o => { if (!R || o.type === 'OUTFALL') return null; const hg = R.valueOf(o, 1, true); return hg === null ? null : +o.p.elev + (+o.p.maxDepth || 0) - hg; }, 'Results');
      add('rptDepthRatio', 'Max. depth / chamber depth', o => { if (!R) return null; const d = R.valueOf(o, 0, true), md = +o.p.maxDepth; return d === null || !(md > 0) ? null : d / md; }, 'Results');
      add('rptNonconv', '% steps not converging', o => R && R.nonconv ? (R.nonconv.get(o.id) || 0) : null, 'Results');
      // summary-report variables (like Avaris DS): nodes missing from the surcharge / flooding tables had none
      const tab = (title, col, zero) => o => { if (!R) return null; if (!R._tables) R._tables = AV.parseReportTables(R.reportText || ''); const T = R._tables[title]; if (!R._tcol) R._tcol = {}; const k = title + '|' + col; let mp = R._tcol[k];
        if (!mp) { mp = new Map(); if (T) { const ci = T.cols.indexOf(col); if (ci >= 0) for (const r of T.rows) { const v = parseFloat(r[ci]); if (isFinite(v)) mp.set(r[0], v); } } R._tcol[k] = mp; }
        return mp.has(o.id) ? mp.get(o.id) : (zero && R.idx && R.idx.node.has(o.id) ? 0 : null); };
      add('rptAvgDepth', 'Average Depth', tab('Node Depth Summary', 'Average Depth'), 'Results');
      add('rptLatInflowVol', 'Lateral Inflow Volume', tab('Node Inflow Summary', 'Lateral Inflow Volume'), 'Results');
      add('rptTotInflowVol', 'Total Inflow Volume', tab('Node Inflow Summary', 'Total Inflow Volume'), 'Results');
      add('rptFlowBalErr', 'Flow Balance Error (%)', tab('Node Inflow Summary', 'Flow Balance Error %'), 'Results');
      add('rptHrsSurcharged', 'Hours Surcharged', tab('Node Surcharge Summary', 'Hours Surcharged', true), 'Results');
      add('rptMaxAboveCrown', 'Max. Height Above Crown', tab('Node Surcharge Summary', 'Max Height Above Crown', false), 'Results');
      add('rptMinBelowRim', 'Min. Depth Below Rim', tab('Node Surcharge Summary', 'Min Depth Below Rim', false), 'Results');
      add('rptHrsFlooded', 'Hours Flooded', tab('Node Flooding Summary', 'Hours Flooded', true), 'Results');
      add('rptFloodVol', 'Total Flood Volume', tab('Node Flooding Summary', 'Total Flood Volume', true), 'Results');
      add('rptMaxPondedDepth', 'Max. Ponded Depth', tab('Node Flooding Summary', 'Maximum Ponded Depth', true), 'Results');
    }
    // links: every node variable of the upstream and downstream node ("US Node: Min. Freeboard")
    if (kind === 'link' && !noNeighbours) {
      const nf = AV.exprFields(app, 'node', true).filter(f => f.g !== 'General' || f.n === 'name' || f.n === 'tag' || f.n === 'type');
      for (const [pre, P, vt, end] of [['us_', 'US Node', 'us', 'from'], ['ds_', 'DS Node', 'ds', 'to']]) for (const f of nf) {
        out.push({ n: pre + f.n, l: P + ': ' + f.l.replace(/ \((result|computed|junction)\)$/, ''), g: P, vt, al: f.al.map(a => pre + a), get: (o) => { const nd = m.nodes.get(o[end]); return nd ? f.get(nd) : null; } });
      }
    }
    // subcatchments: every variable of the node their runoff goes to ("Outlet Node: Max. Total Inflow")
    if (kind === 'sub' && !noNeighbours) {
      const nf = AV.exprFields(app, 'node', true).filter(f => f.g !== 'General' || f.n === 'name' || f.n === 'tag' || f.n === 'type');
      for (const f of nf) out.push({ n: 'out_' + f.n, l: 'Outlet Node: ' + f.l.replace(/ \((result|computed|junction)\)$/, ''), g: 'Outlet Node', vt: 'out', al: f.al.map(a => 'out_' + a), get: (o) => { const nd = m.nodes.get(o.p.outlet); return nd ? f.get(nd) : null; } });
    }
    for (const f of out) if (f.d === undefined) f.d = AV.fieldDesc(app, f);
    ck[key] = out; return out;
  };
  // Manning full-pipe capacity for circular / rectangular closed conduits (null for other shapes)
  AV.fullFlow = function (m, l) {
    if (l.type !== 'CONDUIT') return null; const p = l.p; const D = parseFloat(p.g1), B = parseFloat(p.g2), n = parseFloat(p.rough), L = parseFloat(p.length);
    const s = AV.conduitSlope(m, l); if (!(D > 0) || !(n > 0) || s === null) return null; const S = Math.max(Math.abs(s), 1e-5);
    let A, P; const sh = String(p.shape || '').toUpperCase();
    if (sh === 'CIRCULAR' || sh === 'FORCE_MAIN') { A = Math.PI * D * D / 4; P = Math.PI * D; }
    else if (sh === 'RECT_CLOSED' && B > 0) { A = D * B; P = 2 * (D + B); } else return null;
    const k = m.isSI ? 1.0 : 1.486; const q = k / n * A * Math.pow(A / P, 2 / 3) * Math.sqrt(S);
    const fu = String(m.flowUnits || 'CFS').toUpperCase(); const conv = { CFS: 1, GPM: 448.831, MGD: 0.646317, CMS: 1, LPS: 1000, MLD: 86.4 }[fu] || 1;
    return q * conv;
  };
  // ------------------------------------------------------------------ tokenizer + parser (no eval)
  const FUNCS = {
    abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil, exp: Math.exp, log: Math.log, log10: Math.log10, pow: Math.pow,
    min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), round: (x, d) => { const f = Math.pow(10, d || 0); return Math.round(x * f) / f; },
    len: (s) => String(s === null ? '' : s).length, upper: (s) => String(s === null ? '' : s).toUpperCase(), lower: (s) => String(s === null ? '' : s).toLowerCase(),
    contains: (a, b) => String(a === null ? '' : a).toLowerCase().includes(String(b).toLowerCase()), startswith: (a, b) => String(a === null ? '' : a).toLowerCase().startsWith(String(b).toLowerCase()),
    endswith: (a, b) => String(a === null ? '' : a).toLowerCase().endsWith(String(b).toLowerCase()), isnull: (a) => a === null || a === undefined || a === '',
    iif: (c, a, b) => (c ? a : b), num: (a) => { const x = parseFloat(a); return isFinite(x) ? x : null; }, str: (a) => a === null ? '' : String(a),
  };
  const LAZY = new Set(['iif']);
  function tokenize(src) {
    const t = []; let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) { const m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i)); if (m) { t.push({ k: 'num', v: parseFloat(m[0]), p: i }); i += m[0].length; continue; } }
      if (c === "'" || c === '"') { let j = i + 1, s = ''; while (j < src.length && src[j] !== c) s += src[j++]; if (j >= src.length) throw new Error('Unclosed text starting at position ' + (i + 1)); t.push({ k: 'str', v: s, p: i }); i = j + 1; continue; }
      if (c === '[') { const j = src.indexOf(']', i); if (j < 0) throw new Error('Missing ] for the field starting at position ' + (i + 1)); t.push({ k: 'id', v: src.slice(i + 1, j).trim(), br: true, p: i }); i = j + 1; continue; }
      if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i)); t.push({ k: 'id', v: m[0], p: i }); i += m[0].length; continue; }
      const two = src.substr(i, 2);
      if (['>=', '<=', '!=', '<>', '==', '&&', '||'].includes(two)) { t.push({ k: 'op', v: two, p: i }); i += 2; continue; }
      if ('+-*/%^()=<>!,'.includes(c)) { t.push({ k: 'op', v: c, p: i }); i++; continue; }
      throw new Error('Unexpected character "' + c + '" at position ' + (i + 1));
    }
    return t;
  }
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const toNum = (x) => { if (typeof x === 'number') return x; if (typeof x === 'boolean') return x ? 1 : 0; if (x === null || x === undefined || x === '') return null; const n = Number(x); return isFinite(n) ? n : null; };
  const cmp = (a, b) => { // -1/0/1, or null when not comparable
    if (a === null || a === undefined || b === null || b === undefined) return null;
    const na = toNum(a), nb = toNum(b);
    if (na !== null && nb !== null) return na < nb ? -1 : na > nb ? 1 : 0;
    const sa = String(a).toLowerCase(), sb = String(b).toLowerCase(); return sa < sb ? -1 : sa > sb ? 1 : 0;
  };
  const likeRe = (pat) => new RegExp('^' + String(pat).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/\*/g, '.*').replace(/_/g, '.') + '$', 'i');

  // compile(src, fields) -> { fn(o), used: [field names] }
  AV.compileExpr = function (src, fields) {
    const toks = tokenize(String(src || '')); let i = 0; const used = new Set();
    const F = new Map(); const norm = (x) => String(x).toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '').trim();
    for (const f of fields) { for (const a of f.al || []) F.set(a.toLowerCase(), f); }
    for (const f of fields) { F.set('[l]' + norm(f.l), f); F.set('[l]' + norm(f.l.replace(/ \((result|computed)\)$/, '')), f); }
    for (const f of fields) F.set(f.n.toLowerCase(), f);
    const peek = () => toks[i], next = () => toks[i++];
    const isOp = (v) => toks[i] && toks[i].k === 'op' && toks[i].v === v;
    const isWord = (w) => toks[i] && toks[i].k === 'id' && toks[i].v.toLowerCase() === w;
    const err = (msg, tk) => { throw new Error(msg + (tk ? ' (at position ' + (tk.p + 1) + ')' : ' (at end)')); };
    const parseOr = () => { let a = parseAnd(); while (isWord('or') || isOp('||')) { next(); const l = a, r = parseAnd(); a = (o) => !!(l(o) || r(o)); } return a; };
    const parseAnd = () => { let a = parseNot(); while (isWord('and') || isOp('&&')) { next(); const l = a, r = parseNot(); a = (o) => !!(l(o) && r(o)); } return a; };
    const parseNot = () => { if (isWord('not') || isOp('!')) { next(); const x = parseNot(); return (o) => !x(o); } return parseCmp(); };
    const parseCmp = () => {
      const a = parseAdd(); const tk = peek();
      if (tk && ((tk.k === 'op' && ['=', '==', '!=', '<>', '>', '>=', '<', '<='].includes(tk.v)) || (tk.k === 'id' && tk.v.toLowerCase() === 'like'))) {
        next(); const b = parseAdd(); const op = tk.v.toLowerCase();
        if (op === 'like') return (o) => { const x = a(o), p = b(o); return x === null || x === undefined ? false : likeRe(p).test(String(x)); };
        return (o) => { const c = cmp(a(o), b(o)); if (c === null) return op === '!=' || op === '<>' ? a(o) !== b(o) : false; switch (op) { case '=': case '==': return c === 0; case '!=': case '<>': return c !== 0; case '>': return c > 0; case '>=': return c >= 0; case '<': return c < 0; case '<=': return c <= 0; } };
      }
      return a;
    };
    const arith = (l, r, op) => (o) => {
      const x = l(o), y = r(o);
      if (op === '+' && ((typeof x === 'string' && toNum(x) === null) || (typeof y === 'string' && toNum(y) === null))) return (x === null ? '' : String(x)) + (y === null ? '' : String(y));
      const a = toNum(x), b = toNum(y); if (a === null || b === null) return null;
      switch (op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return b === 0 ? null : a / b; case '%': return b === 0 ? null : a % b; case '^': return Math.pow(a, b); }
    };
    const parseAdd = () => { let a = parseMul(); while (isOp('+') || isOp('-')) { const op = next().v; a = arith(a, parseMul(), op); } return a; };
    const parseMul = () => { let a = parsePow(); while (isOp('*') || isOp('/') || isOp('%')) { const op = next().v; a = arith(a, parsePow(), op); } return a; };
    const parsePow = () => { const a = parseUnary(); if (isOp('^')) { next(); return arith(a, parseUnary(), '^'); } return a; };
    const parseUnary = () => { if (isOp('-')) { next(); const x = parseUnary(); return (o) => { const v = toNum(x(o)); return v === null ? null : -v; }; } if (isOp('+')) { next(); return parseUnary(); } return parsePrimary(); };
    const parsePrimary = () => {
      const tk = next(); if (!tk) err('Expression is incomplete');
      if (tk.k === 'num') return () => tk.v;
      if (tk.k === 'str') return () => tk.v;
      if (tk.k === 'op' && tk.v === '(') { const x = parseOr(); if (!isOp(')')) err('Missing )', peek()); next(); return x; }
      if (tk.k === 'id') {
        const w = tk.v.toLowerCase();
        if (!tk.br && w === 'true') return () => true; if (w === 'false') return () => false; if (w === 'null') return () => null;
        if (!tk.br && isOp('(')) {
          const fn = FUNCS[w]; if (!fn) err('Unknown function "' + tk.v + '"', tk);
          next(); const args = [];
          if (!isOp(')')) { args.push(parseOr()); while (isOp(',')) { next(); args.push(parseOr()); } }
          if (!isOp(')')) err('Missing ) after function arguments', peek()); next();
          if (LAZY.has(w)) return (o) => (args[0](o) ? args[1](o) : (args[2] ? args[2](o) : null));
          return (o) => { const v = args.map(a => a(o)); const numeric = !['len', 'upper', 'lower', 'contains', 'startswith', 'endswith', 'isnull', 'str', 'num'].includes(w); if (numeric) { const n = v.map(toNum); if (n.some(x => x === null)) return null; return fn(...n); } return fn(...v); };
        }
        const f = tk.br ? (F.get(w) || F.get('[l]' + norm(tk.v))) : F.get(w); if (!f) err('Unknown field "' + tk.v + '"', tk);
        used.add(f.n);
        return (o) => { const v = f.get(o); if (v === undefined || v === '') return v === '' ? '' : null; if (typeof v === 'string') { const n = toNum(v); return n !== null && /^\s*-?[\d.]/.test(v) ? n : v; } return typeof v === 'number' && !isFinite(v) ? null : v; };
      }
      err('Unexpected "' + tk.v + '"', tk);
    };
    if (!toks.length) throw new Error('The clause is empty.');
    const fn = parseOr(); if (i < toks.length) err('Unexpected "' + toks[i].v + '"', toks[i]);
    return { fn: (o) => { try { return fn(o); } catch (e) { return null; } }, used: [...used] };
  };

  const KIND_OBJS = (app, kind) => { const m = app.model; return [...(kind === 'node' ? m.nodes.values() : kind === 'link' ? m.links.values() : m.subcatchments.values())]; };
  AV.kindOf = (o) => o.kind === 'NODE' ? 'node' : o.kind === 'LINK' ? 'link' : o.kind === 'SUBCATCH' ? 'sub' : null;

  // ------------------------------------------------------------------ clause editor dialog
  // opts: { kind, kindFixed, title, mode: 'select' | 'value', clause, method, objs }
  AV.clauseEditor = function (app, opts) {
    let kind = opts.kind || 'node';
    const kindSel = h('select', null, [['node', 'Nodes'], ['link', 'Links'], ['sub', 'Subcatchments']].map(([v, l]) => h('option', { value: v }, l))); kindSel.value = kind; kindSel.disabled = !!opts.kindFixed;
    const method = h('select', null, [['new', 'Create a new selection'], ['add', 'Add to current selection'], ['remove', 'Remove from current selection'], ['subset', 'Select from current selection']].map(([v, l]) => h('option', { value: v }, l)));
    method.value = opts.method || 'new';
    const vtSel = h('select', null);
    const fillVt = () => { vtSel.innerHTML = ''; (kind === 'link' ? [['self', 'Link'], ['us', 'US Node'], ['ds', 'DS Node']] : kind === 'sub' ? [['self', 'Subcatchment'], ['out', 'Outlet Node']] : [['self', 'Node']]).forEach(([v, l]) => vtSel.appendChild(h('option', { value: v }, l))); vtSel.disabled = kind === 'node'; };
    fillVt();
    const filter = h('input', { type: 'text', placeholder: 'Filter variables…', style: { flex: 1 } });
    const list = h('div', { class: 'cefields' });
    const info = h('div', { class: 'cehelp' }, 'Double-click a variable to add it to the clause.');
    const ta = h('textarea', { class: 'ceclause', spellcheck: 'false', rows: 5 }, opts.clause || '');
    const msg = h('div', { class: 'cemsg' });
    let fields = [];
    const insert = (txt) => { const s = ta.selectionStart, e = ta.selectionEnd; const v = ta.value; const pre = v.slice(0, s), post = v.slice(e); const pad = (pre && !/\s$/.test(pre) ? ' ' : '') + txt + (post && !/^\s/.test(post) ? ' ' : ''); ta.value = pre + pad + post; const p = (pre + pad).length; ta.focus(); ta.setSelectionRange(p, p); };
    const fill = () => {
      fields = AV.exprFields(app, kind); list.innerHTML = ''; const q = filter.value.trim().toLowerCase(); let grp = null;
      list.appendChild(h('div', { class: 'cehead' }, h('span', null, 'Variable'), h('span', null, 'Name'), h('span', null, 'Description')));
      for (const f of fields) {
        if ((f.vt || 'self') !== vtSel.value) continue;
        if (q && !f.n.toLowerCase().includes(q) && !f.l.toLowerCase().includes(q) && !(f.d || '').toLowerCase().includes(q)) continue;
        if (f.g !== grp) { grp = f.g; list.appendChild(h('div', { class: 'cegrp' }, grp)); }
        list.appendChild(h('div', { class: 'cef', title: f.n + '\n' + f.l + '\n' + (f.d || ''), onclick: () => { AV.$$('.cef.sel', list).forEach(x => x.classList.remove('sel')); el.classList.add('sel'); info.textContent = f.n + ' — ' + (f.d || f.l) + sampleOf(f); }, ondblclick: () => insert(f.n) },
          h('span', { class: 'cfn' }, f.n), h('span', { class: 'cel' }, f.vt && f.vt !== 'self' ? f.l.replace(/^(US Node|DS Node|Outlet Node): /, '') : f.l), h('span', { class: 'ced' }, (f.d || '').replace(/^(Upstream node|Downstream node|Node receiving the runoff): /, ''))));
        const el = list.lastChild;
      }
    };
    const sampleOf = (f) => { const o = KIND_OBJS(app, kind).slice(0, 1)[0]; if (!o) return ''; const v = f.get(o); return v === null || v === undefined || v === '' ? '' : '   e.g. ' + o.id + ' = ' + (typeof v === 'number' ? AV.fmt(v) : String(v).slice(0, 40)); };
    filter.addEventListener('input', fill); vtSel.addEventListener('change', fill); kindSel.addEventListener('change', () => { kind = kindSel.value; fillVt(); fill(); msg.textContent = ''; });
    const opBtns = ['=', '>', '>=', '<', '<=', '!=', 'and', 'or', 'not', 'like', '+', '-', '*', '/', '(', ')'].map(o => h('button', { class: 'btn small ceop', onclick: () => insert(o) }, o));
    const fnSel = h('select', { class: 'cefn', onchange: () => { if (fnSel.value) { insert(fnSel.value); fnSel.value = ''; } } }, [h('option', { value: '' }, 'Functions…')].concat(['abs()', 'sqrt()', 'min( , )', 'max( , )', 'round( , 2)', 'log10()', 'len()', 'upper()', 'contains( , \'text\')', 'startswith( , \'text\')', 'isnull()', 'iif( , , )'].map(f => h('option', { value: f }, f))));
    const verify = () => {
      msg.className = 'cemsg';
      try {
        const c = AV.compileExpr(ta.value, fields); const objs = opts.objs ? opts.objs.filter(o => AV.kindOf(o) === kind) : KIND_OBJS(app, kind);
        if (opts.mode === 'value') {
          let n = 0, num = 0, mn = Infinity, mx = -Infinity; for (const o of objs) { const v = c.fn(o); if (v === null || v === undefined) continue; n++; if (typeof v === 'number') { num++; mn = Math.min(mn, v); mx = Math.max(mx, v); } }
          msg.textContent = 'Valid. ' + n + ' of ' + objs.length + ' objects have a value' + (num ? ' (numeric ' + AV.fmt(mn) + ' … ' + AV.fmt(mx) + ')' : '') + '.'; msg.classList.add('ok');
        } else {
          let n = 0; for (const o of objs) if (c.fn(o)) n++;
          msg.textContent = 'Valid. ' + n + ' of ' + objs.length + ' objects match.'; msg.classList.add('ok');
        }
        if (!c.used.length) msg.textContent += '  (No fields used.)';
        return true;
      } catch (e) { msg.textContent = e.message; msg.classList.add('bad'); return false; }
    };
    fill();
    const body = h('div', { class: 'cebox' },
      h('div', { class: 'cetop' }, h('label', null, 'Layer ', kindSel), opts.mode === 'select' ? h('label', null, 'Method ', method) : h('span', { class: 'note' }, opts.mode === 'filter' ? 'Only objects for which the clause is true are rendered by this theme.' : 'The clause gives the value each object is themed by (a number, text or true/false).')),
      h('div', { class: 'cevt' }, h('b', null, 'Variable Type'), vtSel, filter), list, info,
      h('div', { class: 'ceops' }, ...opBtns, fnSel),
      h('div', { class: 'cehead' }, 'Clause'), ta, msg,
      h('div', { class: 'note' }, opts.mode !== 'value' ? 'Examples:  rptMaxFlow - 1 >= length + 2     |     (us_rptFreeboard < 12 or ds_rptFreeboard < 12) and rptMaxCapacity >= 1     |     name like \'J_5%\'' : 'Examples:  rptMaxHgl - rim     |     length / diam     |     iif(rptCapacity > 1, \'surcharged\', \'ok\')'));
    return AV.modal({ title: opts.title || (opts.mode === 'select' ? 'Select by Attribute' : 'Clause Editor'), width: 900, body, enterSubmits: false,
      buttons: [{ label: 'Clear', onClick: () => { ta.value = ''; msg.textContent = ''; ta.focus(); return false; } }, { label: 'Verify', onClick: () => { verify(); return false; } },
        { label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => verify() ? { clause: ta.value.trim(), kind, method: method.value } : false }] }).done;
  };

  // ------------------------------------------------------------------ select by attribute
  AV.selectByAttribute = async function (app, opts = {}) {
    const sel0 = [...app.selection];
    const kind = opts.kind || (sel0.length ? AV.kindOf(sel0[0]) : null) || app._sbaKind || 'node';
    const r = await AV.clauseEditor(app, { mode: 'select', kind, kindFixed: !!opts.kindFixed, clause: app._sbaClause || '', objs: opts.objs, method: app._sbaMethod });
    if (!r) return;
    app._sbaClause = r.clause; app._sbaKind = r.kind; app._sbaMethod = r.method;
    const c = AV.compileExpr(r.clause, AV.exprFields(app, r.kind));
    const pool = opts.objs ? opts.objs.filter(o => AV.kindOf(o) === r.kind) : KIND_OBJS(app, r.kind);
    const hits = pool.filter(o => c.fn(o));
    const sel = app.selection; let res;
    if (r.method === 'new') res = hits; else if (r.method === 'add') res = [...sel, ...hits]; else if (r.method === 'remove') { const hs = new Set(hits); res = [...sel].filter(o => !hs.has(o)); } else res = hits.filter(o => sel.has(o));
    app.selectMany(res);
    AV.toast(hits.length + ' object(s) match; ' + res.length + ' selected.');
    if (res.length && res.length < 20000 && opts.zoom !== false) app.map.zoomToObjects(res);
    return res;
  };
})(window.AV);
