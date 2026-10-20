// Avaris model: INP parsing / writing and object schemas
'use strict';
window.AV = window.AV || {};

(function (AV) {
  const SECTION_ORDER = ['TITLE', 'OPTIONS', 'REPORT', 'FILES', 'RAINGAGES', 'EVAPORATION', 'TEMPERATURE', 'ADJUSTMENTS',
    'SUBCATCHMENTS', 'SUBAREAS', 'INFILTRATION', 'LID_CONTROLS', 'LID_USAGE', 'AQUIFERS', 'GROUNDWATER', 'GWF', 'SNOWPACKS',
    'JUNCTIONS', 'OUTFALLS', 'DIVIDERS', 'STORAGE', 'CONDUITS', 'PUMPS', 'ORIFICES', 'WEIRS', 'OUTLETS', 'XSECTIONS',
    'TRANSECTS', 'STREETS', 'INLETS', 'INLET_USAGE', 'LOSSES', 'CONTROLS', 'POLLUTANTS', 'LANDUSES', 'COVERAGES', 'LOADINGS',
    'BUILDUP', 'WASHOFF', 'TREATMENT', 'INFLOWS', 'DWF', 'RDII', 'HYDROGRAPHS', 'CURVES', 'TIMESERIES', 'PATTERNS',
    'MAP', 'COORDINATES', 'VERTICES', 'POLYGONS', 'SYMBOLS', 'LABELS', 'BACKDROP', 'TAGS'];
  // sections handled structurally (everything else is kept as raw text)
  const DESC_SECS = new Set(['CURVES', 'TIMESERIES', 'RAINGAGES', 'SUBCATCHMENTS', 'JUNCTIONS', 'OUTFALLS', 'DIVIDERS', 'STORAGE', 'CONDUITS', 'PUMPS', 'ORIFICES', 'WEIRS', 'OUTLETS']);
  const STRUCT = new Set(['TITLE', 'OPTIONS', 'RAINGAGES', 'SUBCATCHMENTS', 'SUBAREAS', 'INFILTRATION', 'JUNCTIONS', 'OUTFALLS',
    'DIVIDERS', 'STORAGE', 'CONDUITS', 'PUMPS', 'ORIFICES', 'WEIRS', 'OUTLETS', 'XSECTIONS', 'LOSSES', 'CURVES', 'TIMESERIES',
    'MAP', 'COORDINATES', 'VERTICES', 'POLYGONS', 'SYMBOLS', 'LABELS', 'TAGS', 'REPORT']);

  const NODE_TYPES = ['JUNCTION', 'OUTFALL', 'DIVIDER', 'STORAGE'];
  const LINK_TYPES = ['CONDUIT', 'PUMP', 'ORIFICE', 'WEIR', 'OUTLET'];
  const XS_SHAPES = ['CIRCULAR', 'FORCE_MAIN', 'FILLED_CIRCULAR', 'DUMMY', 'RECT_CLOSED', 'RECT_OPEN', 'TRAPEZOIDAL', 'TRIANGULAR',
    'HORIZ_ELLIPSE', 'VERT_ELLIPSE', 'ARCH', 'PARABOLIC', 'POWER', 'RECT_TRIANGULAR', 'RECT_ROUND', 'MODBASKETHANDLE', 'EGG',
    'HORSESHOE', 'GOTHIC', 'CATENARY', 'SEMIELLIPTICAL', 'BASKETHANDLE', 'SEMICIRCULAR', 'IRREGULAR', 'CUSTOM', 'STREET'];
  const YN = ['YES', 'NO'];

  // ---- property schemas (k = key, l = label, t = num|text|choice|bool, o = options, d = default, g = group)
  const S = {};
  S.JUNCTION = [
    { k: 'elev', l: 'Invert Elevation', t: 'num', d: 0 }, { k: 'maxDepth', l: 'Max. Depth', t: 'num', d: 0 },
    { k: 'initDepth', l: 'Initial Depth', t: 'num', d: 0 }, { k: 'surDepth', l: 'Surcharge Depth', t: 'num', d: 0 },
    { k: 'aPonded', l: 'Ponded Area', t: 'num', d: 0 }, { k: 'chamberArea', l: 'Chamber Area', t: 'num', d: 0 }];
  S.OUTFALL = [
    { k: 'elev', l: 'Invert Elevation', t: 'num', d: 0 }, { k: 'otype', l: 'Outfall Type', t: 'choice', o: ['FREE', 'NORMAL', 'FIXED', 'TIDAL', 'TIMESERIES'], d: 'FREE' },
    { k: 'stage', l: 'Stage / Curve / Series', t: 'text', d: '' }, { k: 'gated', l: 'Flap Gate', t: 'choice', o: YN, d: 'NO' },
    { k: 'routeTo', l: 'Route To (Subcatch)', t: 'text', d: '' }];
  S.DIVIDER = [
    { k: 'elev', l: 'Invert Elevation', t: 'num', d: 0 }, { k: 'divLink', l: 'Diverted Link', t: 'text', d: '' },
    { k: 'dtype', l: 'Divider Type', t: 'choice', o: ['OVERFLOW', 'CUTOFF', 'TABULAR', 'WEIR'], d: 'OVERFLOW' },
    { k: 'dparam', l: 'Cutoff Flow / Curve / Weir (Qmin Ht Cd)', t: 'text', d: '' },
    { k: 'maxDepth', l: 'Max. Depth', t: 'num', d: 0 }, { k: 'initDepth', l: 'Initial Depth', t: 'num', d: 0 },
    { k: 'surDepth', l: 'Surcharge Depth', t: 'num', d: 0 }, { k: 'aPonded', l: 'Ponded Area', t: 'num', d: 0 }, { k: 'chamberArea', l: 'Chamber Area', t: 'num', d: 0 }];
  S.STORAGE = [
    { k: 'elev', l: 'Invert Elevation', t: 'num', d: 0 }, { k: 'maxDepth', l: 'Max. Depth', t: 'num', d: 0 },
    { k: 'initDepth', l: 'Initial Depth', t: 'num', d: 0 },
    { k: 'shape', l: 'Storage Curve', t: 'choice', o: ['FUNCTIONAL', 'TABULAR', 'CYLINDRICAL', 'CONICAL', 'PARABOLIC', 'PYRAMIDAL'], d: 'FUNCTIONAL' },
    { k: 'sp1', l: 'Coeff A / Curve / Length', t: 'text', d: '0' }, { k: 'sp2', l: 'Exponent B / Width', t: 'text', d: '0' },
    { k: 'sp3', l: 'Constant C / Side Slope Z', t: 'text', d: '1000' },
    { k: 'surDepth', l: 'Surcharge Depth', t: 'num', d: 0 }, { k: 'fevap', l: 'Evaporation Factor', t: 'num', d: 0 },
    { k: 'psi', l: 'Seepage Suction Head', t: 'text', d: '' }, { k: 'ksat', l: 'Seepage Conductivity', t: 'text', d: '' }, { k: 'imd', l: 'Seepage Initial Deficit', t: 'text', d: '' }];
  const XS = [
    { k: 'shape', l: 'Cross-Section Shape', t: 'choice', o: XS_SHAPES, d: 'CIRCULAR', g: 'Cross Section' },
    { k: 'g1', l: 'Max. Depth / Geom1', t: 'text', d: '1', g: 'Cross Section' }, { k: 'g2', l: 'Geom2', t: 'text', d: '0', g: 'Cross Section' },
    { k: 'g3', l: 'Geom3', t: 'text', d: '0', g: 'Cross Section' }, { k: 'g4', l: 'Geom4', t: 'text', d: '0', g: 'Cross Section' },
    { k: 'barrels', l: 'Barrels', t: 'num', d: 1, g: 'Cross Section' }, { k: 'culvert', l: 'Culvert Code', t: 'text', d: '', g: 'Cross Section' }];
  S.CONDUIT = [
    { k: 'length', l: 'Length', t: 'num', d: 400 }, { k: 'rough', l: 'Manning Roughness', t: 'num', d: 0.013 },
    { k: 'inOff', l: 'Inlet Offset', t: 'num', d: 0 }, { k: 'outOff', l: 'Outlet Offset', t: 'num', d: 0 },
    { k: 'initFlow', l: 'Initial Flow', t: 'num', d: 0 }, { k: 'maxFlow', l: 'Maximum Flow', t: 'num', d: 0 }]
    .concat(XS).concat([
      { k: 'kEntry', l: 'Entry Loss Coeff.', t: 'num', d: 0, g: 'Losses' }, { k: 'kExit', l: 'Exit Loss Coeff.', t: 'num', d: 0, g: 'Losses' },
      { k: 'kAvg', l: 'Avg. Loss Coeff.', t: 'num', d: 0, g: 'Losses' }, { k: 'flap', l: 'Flap Gate', t: 'choice', o: YN, d: 'NO', g: 'Losses' },
      { k: 'seepage', l: 'Seepage Loss Rate', t: 'num', d: 0, g: 'Losses' }]);
  S.PUMP = [
    { k: 'curve', l: 'Pump Curve', t: 'text', d: '*' }, { k: 'status', l: 'Initial Status', t: 'choice', o: ['ON', 'OFF'], d: 'ON' },
    { k: 'startup', l: 'Startup Depth', t: 'num', d: 0 }, { k: 'shutoff', l: 'Shutoff Depth', t: 'num', d: 0 }];
  S.ORIFICE = [
    { k: 'otype', l: 'Orifice Type', t: 'choice', o: ['SIDE', 'BOTTOM'], d: 'SIDE' }, { k: 'offset', l: 'Inlet Offset', t: 'num', d: 0 },
    { k: 'qcoeff', l: 'Discharge Coeff.', t: 'num', d: 0.65 }, { k: 'gated', l: 'Flap Gate', t: 'choice', o: YN, d: 'NO' },
    { k: 'closeTime', l: 'Time to Open/Close (hr)', t: 'num', d: 0 }].concat(XS.filter(f => ['shape', 'g1', 'g2'].includes(f.k)).map(f => f.k === 'shape' ? Object.assign({}, f, { o: ['CIRCULAR', 'RECT_CLOSED'] }) : f));
  S.WEIR = [
    { k: 'wtype', l: 'Weir Type', t: 'choice', o: ['TRANSVERSE', 'SIDEFLOW', 'V-NOTCH', 'TRAPEZOIDAL', 'ROADWAY'], d: 'TRANSVERSE' },
    { k: 'crest', l: 'Crest Height', t: 'num', d: 0 }, { k: 'qcoeff', l: 'Discharge Coeff.', t: 'num', d: 3.33 },
    { k: 'gated', l: 'Flap Gate', t: 'choice', o: YN, d: 'NO' }, { k: 'endCon', l: 'End Contractions', t: 'num', d: 0 },
    { k: 'endCoeff', l: 'End Coeff.', t: 'num', d: 0 }, { k: 'surcharge', l: 'Can Surcharge', t: 'choice', o: YN, d: 'YES' },
    { k: 'roadWidth', l: 'Road Width', t: 'text', d: '' }, { k: 'roadSurf', l: 'Road Surface', t: 'text', d: '' }, { k: 'coeffCurve', l: 'Coeff. Curve', t: 'text', d: '' }]
    .concat(XS.filter(f => ['shape', 'g1', 'g2', 'g3', 'g4'].includes(f.k)).map(f => f.k === 'shape' ? Object.assign({}, f, { o: ['RECT_OPEN', 'TRAPEZOIDAL', 'TRIANGULAR'], d: 'RECT_OPEN' }) : f));
  S.OUTLET = [
    { k: 'offset', l: 'Inlet Offset', t: 'num', d: 0 },
    { k: 'otype', l: 'Rating Curve', t: 'choice', o: ['FUNCTIONAL/DEPTH', 'FUNCTIONAL/HEAD', 'TABULAR/DEPTH', 'TABULAR/HEAD'], d: 'FUNCTIONAL/DEPTH' },
    { k: 'c1', l: 'Coefficient / Curve', t: 'text', d: '10' }, { k: 'c2', l: 'Exponent', t: 'text', d: '0.5' },
    { k: 'gated', l: 'Flap Gate', t: 'choice', o: YN, d: 'NO' }];
  S.SUBCATCH = [
    { k: 'gage', l: 'Rain Gage', t: 'text', d: '' }, { k: 'outlet', l: 'Outlet', t: 'text', d: '' },
    { k: 'area', l: 'Area', t: 'num', d: 5 }, { k: 'imperv', l: '% Impervious', t: 'num', d: 25 }, { k: 'width', l: 'Width', t: 'num', d: 500 },
    { k: 'slope', l: '% Slope', t: 'num', d: 0.5 }, { k: 'curbLen', l: 'Curb Length', t: 'num', d: 0 }, { k: 'snowPack', l: 'Snow Pack', t: 'text', d: '' },
    { k: 'nImp', l: 'N-Imperv', t: 'num', d: 0.01, g: 'Subarea' }, { k: 'nPerv', l: 'N-Perv', t: 'num', d: 0.1, g: 'Subarea' },
    { k: 'sImp', l: 'Dstore-Imperv', t: 'num', d: 0.05, g: 'Subarea' }, { k: 'sPerv', l: 'Dstore-Perv', t: 'num', d: 0.05, g: 'Subarea' },
    { k: 'pctZero', l: '%Zero-Imperv', t: 'num', d: 25, g: 'Subarea' }, { k: 'routeTo', l: 'Subarea Routing', t: 'choice', o: ['OUTLET', 'IMPERVIOUS', 'PERVIOUS'], d: 'OUTLET', g: 'Subarea' },
    { k: 'pctRouted', l: 'Percent Routed', t: 'text', d: '', g: 'Subarea' }, { k: 'impCoef', l: 'Imperv. Runoff Coef.', t: 'num', d: 1, g: 'Subarea' },
    { k: 'i1', l: 'Infil. Param 1 (MaxRate/Suction/CN)', t: 'text', d: '3', g: 'Infiltration' }, { k: 'i2', l: 'Infil. Param 2 (MinRate/Ksat)', t: 'text', d: '0.5', g: 'Infiltration' },
    { k: 'i3', l: 'Infil. Param 3 (Decay/IMD)', t: 'text', d: '4', g: 'Infiltration' }, { k: 'i4', l: 'Infil. Param 4 (DryTime)', t: 'text', d: '7', g: 'Infiltration' },
    { k: 'i5', l: 'Infil. Param 5 (MaxInfil)', t: 'text', d: '0', g: 'Infiltration' }, { k: 'imethod', l: 'Infil. Method (optional)', t: 'text', d: '', g: 'Infiltration' }];
  S.GAGE = [
    { k: 'format', l: 'Rain Format', t: 'choice', o: ['INTENSITY', 'VOLUME', 'CUMULATIVE'], d: 'INTENSITY' },
    { k: 'interval', l: 'Time Interval', t: 'text', d: '1:00' }, { k: 'scf', l: 'Snow Catch Factor', t: 'num', d: 1 },
    { k: 'source', l: 'Data Source', t: 'choice', o: ['TIMESERIES', 'FILE'], d: 'TIMESERIES' },
    { k: 'series', l: 'Series Name / File Name', t: 'text', d: '' }, { k: 'station', l: 'Station ID', t: 'text', d: '' }, { k: 'units', l: 'Rain Units', t: 'text', d: '' }];
  AV.SCHEMA = S;

  // ---- units shown next to property labels (US: CFS/GPM/MGD, SI: CMS/LPS/MLD)
  const UNIT_KIND = {
    elev: 'L', maxDepth: 'L', initDepth: 'L', surDepth: 'L', aPonded: 'A', chamberArea: 'A', length: 'L', inOff: 'L', outOff: 'L', offset: 'L',
    initFlow: 'Q', maxFlow: 'Q', g1: 'L', barrels: '', seepage: 'R', startup: 'L', shutoff: 'L', crest: 'L', roadWidth: 'L', closeTime: 'hr',
    area: 'LA', imperv: '%', width: 'L', slope: '%', curbLen: 'L', sImp: 'D', sPerv: 'D', pctZero: '%', pctRouted: '%', impCoef: 'frac',
    nImp: 'n', nPerv: 'n', rough: 'n', fevap: 'frac', psi: 'D', ksat: 'R', imd: 'frac', kEntry: '', kExit: '', kAvg: '',
    inflowBase: 'Q', dwf: 'Q', sewArea: 'LA', x: 'map', y: 'map', scf: '', qcoeff: '', endCon: '', endCoeff: '',
  };
  const INFIL = {
    HORTON: [['Max. Infil. Rate', 'R'], ['Min. Infil. Rate', 'R'], ['Decay Constant', '1/hr'], ['Drying Time', 'days'], ['Max. Infil. Volume', 'D']],
    GREEN_AMPT: [['Suction Head', 'D'], ['Conductivity', 'R'], ['Initial Deficit', 'frac'], null, null],
    CURVE_NUMBER: [['Curve Number', ''], ['Conductivity (unused)', 'R'], ['Drying Time', 'days'], null, null],
  };
  INFIL.MODIFIED_HORTON = INFIL.HORTON; INFIL.MODIFIED_GREEN_AMPT = INFIL.GREEN_AMPT;
  AV.unitText = function (m, kind) {
    const si = m && m.isSI;
    switch (kind) {
      case 'L': return si ? 'm' : 'ft'; case 'A': return si ? 'm²' : 'ft²'; case 'LA': return si ? 'ha' : 'ac';
      case 'Q': return m ? m.flowUnits : 'CFS'; case 'R': return si ? 'mm/hr' : 'in/hr'; case 'D': return si ? 'mm' : 'in';
      case '%': return '%'; case 'frac': return '0-1'; case 'hr': return 'hr'; case '1/hr': return '1/hr'; case 'days': return 'days';
      case 'map': return m && m.mapInfo && m.mapInfo.units && !/^none$/i.test(m.mapInfo.units) ? String(m.mapInfo.units).toLowerCase() : '';
      default: return '';
    }
  };
  const LBL_HAS_UNIT = /\((hr|%|ft|m|in|mm)\)\s*$|^%|%\s/;
  // label with unit, e.g. "Chamber Area (ft²)"; infiltration parameters are labelled by the infiltration method
  AV.fieldLabel = function (m, o, f) {
    let l = f.l, kind = UNIT_KIND[f.k];
    if (/^i[1-5]$/.test(f.k) && o && o.kind === 'SUBCATCH' && m) {
      const meth = String(o.p.imethod || m.options.INFILTRATION || 'HORTON').toUpperCase(); const d = (INFIL[meth] || INFIL.HORTON)[+f.k[1] - 1];
      if (!d) return 'Infil. Param ' + f.k[1] + ' (unused)';
      l = d[0]; kind = d[1];
    }
    if (f.k === 'g2' && o && /^(CIRCULAR|FORCE_MAIN|FILLED_CIRCULAR|DUMMY)$/.test(o.p.shape || '') === false) kind = kind || 'L';
    if (f.k === 'g2' && o && /^(RECT_CLOSED|RECT_OPEN|TRAPEZOIDAL|HORIZ_ELLIPSE|VERT_ELLIPSE|ARCH|RECT_TRIANGULAR|RECT_ROUND|MODBASKETHANDLE|PARABOLIC|POWER|TRIANGULAR)$/.test(o.p.shape || '')) kind = 'L';
    if (f.k === 'g2' && o && /^(FILLED_CIRCULAR)$/.test(o.p.shape || '')) kind = 'L';
    if (f.k === 'g2' && o && /^(FORCE_MAIN)$/.test(o.p.shape || '')) kind = /D-W/i.test(m && m.options.FORCE_MAIN_EQUATION || '') ? 'L' : '';
    if ((f.k === 'inOff' || f.k === 'outOff' || f.k === 'offset') && m && /ELEVATION/i.test(m.options.LINK_OFFSETS || '')) l = l.replace('Offset', 'Offset Elev.');
    if (f.k === 'rough' || f.k === 'nImp' || f.k === 'nPerv') kind = '';
    const u = AV.unitText(m, kind);
    return u && !LBL_HAS_UNIT.test(l) ? l + ' (' + u + ')' : l;
  };

  // ---- extra editable fields kept outside the main sections: description (comment line before the object) and,
  // for nodes, direct inflow / dry weather flow / RDII rows of [INFLOWS] [DWF] [RDII]
  const rawRows = (m, sec) => m.raw[sec] || (m.raw[sec] = (m.rawOrder.includes(sec) || m.rawOrder.push(sec), []));
  const findRow = (m, sec, id, pred) => { const r = m.raw[sec] || []; for (let i = 0; i < r.length; i++) { const t = r[i].trim(); if (!t || t[0] === ';') continue; const k = tokenize(r[i]); if (k[0] === id && (!pred || pred(k))) return [i, k]; } return [-1, null]; };
  const putRow = (m, sec, id, pred, toks) => {
    const rows = rawRows(m, sec); const [i] = findRow(m, sec, id, pred);
    const line = toks ? toks.map(x => /\s/.test(x) || x === '' ? '"' + x + '"' : x).map((x, j) => j === toks.length - 1 ? x : x.padEnd(j === 0 ? 17 : 11)).join('') : null;
    if (i >= 0) { if (line) rows[i] = line; else rows.splice(i, 1); } else if (line) rows.push(line);
  };
  const isFlow = (k) => (k[1] || '').toUpperCase() === 'FLOW';
  const inflow = (m, o) => { const [, k] = findRow(m, 'INFLOWS', o.id, isFlow); return k ? { ts: k[2] || '', sf: k[5] !== undefined ? k[5] : '1.0', base: k[6] !== undefined ? k[6] : '', pat: k[7] || '', mf: k[4] || '1.0', type: k[3] || 'FLOW' } : null; };
  const setInflow = (m, o, f, v) => {
    const c = inflow(m, o) || { ts: '', sf: '1.0', base: '', pat: '', mf: '1.0', type: 'FLOW' }; c[f] = String(v === undefined || v === null ? '' : v).trim();
    const empty = !c.ts && !(parseFloat(c.base) > 0 || parseFloat(c.base) < 0);
    putRow(m, 'INFLOWS', o.id, isFlow, empty ? null : [o.id, 'FLOW', c.ts || '""', c.type, c.mf, c.sf || '1.0', c.base || '0'].concat(c.pat ? [c.pat] : []));
  };
  const NODE = (o) => o.kind === 'NODE';
  AV.VIRT = {
    desc: { l: 'Description', all: true, get: (m, o) => o.desc || '', set: (m, o, v) => { if (v === '' || v === null || v === undefined) delete o.desc; else o.desc = String(v); } },
    inflowTS: { l: 'Inflow Time Series', g: 'Inflows', node: true, get: (m, o) => { const c = inflow(m, o); return c ? (c.ts === '""' ? '' : c.ts) : ''; }, set: (m, o, v) => setInflow(m, o, 'ts', v) },
    inflowSF: { l: 'Inflow Scale Factor', g: 'Inflows', node: true, get: (m, o) => { const c = inflow(m, o); return c ? c.sf : ''; }, set: (m, o, v) => setInflow(m, o, 'sf', v) },
    inflowBase: { l: 'Inflow Baseline', g: 'Inflows', node: true, get: (m, o) => { const c = inflow(m, o); return c ? c.base : ''; }, set: (m, o, v) => setInflow(m, o, 'base', v) },
    dwf: { l: 'Dry Weather Flow (avg)', g: 'Inflows', node: true, get: (m, o) => { const [, k] = findRow(m, 'DWF', o.id, isFlow); return k ? k[2] : ''; },
      set: (m, o, v) => { const [, k] = findRow(m, 'DWF', o.id, isFlow); const x = String(v === undefined || v === null ? '' : v).trim(); putRow(m, 'DWF', o.id, isFlow, x === '' || +x === 0 ? null : [o.id, 'FLOW', x].concat(k ? k.slice(3) : [])); } },
    uh: { l: 'RDII Unit Hydrograph', g: 'Inflows', node: true, get: (m, o) => { const [, k] = findRow(m, 'RDII', o.id); return k ? k[1] : ''; },
      set: (m, o, v) => { const [, k] = findRow(m, 'RDII', o.id); const x = String(v || '').trim(); putRow(m, 'RDII', o.id, null, x ? [o.id, x, k ? k[2] : '0'] : null); } },
    sewArea: { l: 'RDII Sewershed Area', g: 'Inflows', node: true, get: (m, o) => { const [, k] = findRow(m, 'RDII', o.id); return k ? k[2] : ''; },
      set: (m, o, v) => { const [, k] = findRow(m, 'RDII', o.id); if (!k) { if (String(v || '').trim()) AV.toast('Set the RDII unit hydrograph first.', true); return; } putRow(m, 'RDII', o.id, null, [o.id, k[1], String(v).trim() || '0']); } },
  };
  AV.extraFields = (o) => Object.keys(AV.VIRT).filter(k => AV.VIRT[k].all || (AV.VIRT[k].node && NODE(o))).map(k => ({ k, l: AV.VIRT[k].l, g: AV.VIRT[k].g, t: 'text', virt: true }));
  // prefixed virtual fields "name:arg" (e.g. treat:TSS, load:TSS, adjpat:N-PERV), registered in AV.VIRTP
  AV.VIRTP = {};
  const vp = (k) => { const i = typeof k === 'string' ? k.indexOf(':') : -1; return i > 0 && AV.VIRTP[k.slice(0, i)] ? [AV.VIRTP[k.slice(0, i)], k.slice(i + 1)] : null; };
  AV.rawFind = findRow; AV.rawPut = putRow; AV.rawRows = rawRows;
  AV.getField = (m, o, k) => { const P = vp(k); if (P) return P[0].get(m, o, P[1]); return AV.getField0(m, o, k); };
  AV.getField0 = (m, o, k) => AV.VIRT[k] ? AV.VIRT[k].get(m, o) : k === 'tag' ? o.tag : k === 'id' ? o.id : ['x', 'y', 'from', 'to', 'verts', 'poly', 'type'].includes(k) ? o[k] : o.p[k];
  AV.setField = (m, o, k, v) => { const P = vp(k); if (P) { P[0].set(m, o, P[1], v); return; } if (AV.VIRT[k]) AV.VIRT[k].set(m, o, v); else if (k === 'tag') o.tag = v; else o.p[k] = v; };
  AV.NODE_TYPES = NODE_TYPES; AV.LINK_TYPES = LINK_TYPES; AV.XS_SHAPES = XS_SHAPES;
  AV.SECTION_ORDER = SECTION_ORDER;

  function defaults(type) { const o = {}; for (const f of S[type]) o[f.k] = f.d; return o; }
  AV.defaults = defaults;

  // ------------------------------------------------------------------- tokenizer
  function tokenize(line) {
    const out = []; let i = 0; const n = line.length;
    while (i < n) {
      const c = line[i];
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === ';') break;
      if (c === '"') { let j = line.indexOf('"', i + 1); if (j < 0) j = n; out.push(line.slice(i + 1, j)); i = j + 1; continue; }
      let j = i; while (j < n && line[j] !== ' ' && line[j] !== '\t' && line[j] !== '\r' && line[j] !== ';') j++;
      out.push(line.slice(i, j)); i = j;
    }
    return out;
  }
  AV.tokenize = tokenize;
  const num = (s, d) => { const x = parseFloat(s); return isFinite(x) ? x : d; };
  // keep tokens beyond the fields we model (e.g. extra columns written by Avaris DS) so saving is lossless
  const XT = (o, sec, t, used) => { if (o && t.length > used) { (o.xt || (o.xt = {}))[sec] = { n: used, t: t.slice(used) }; } return o; };
  // writer side: re-append preserved extra tokens (pad positional fields first)
  const XW = (o, sec, arr) => { const x = o.xt && o.xt[sec]; if (!x) return arr; arr = arr.slice(0, x.n); while (arr.length < x.n) arr.push('0'); return arr.map(v => v === '' ? '0' : v).concat(x.t); };
  const q = (s) => { s = String(s); return /\s/.test(s) ? '"' + s + '"' : s; };

  // ------------------------------------------------------------------- Model
  class Model {
    constructor() {
      this.title = [];
      this.options = {};
      this.report = [];
      this.nodes = new Map(); this.links = new Map(); this.subcatchments = new Map(); this.gages = new Map();
      this.curves = new Map();     // name -> {type, pts:[[x,y]]}
      this.timeseries = new Map(); // name -> {file?:string, rows:[[date,time,value]]}
      this.labels = [];
      this.raw = {};               // section -> [lines]
      this.rawOrder = [];
      this.mapInfo = { dims: null, units: 'None' };
      this.version = 0;            // incremented on every change
    }
    get flowUnits() { return (this.options.FLOW_UNITS || 'CFS').toUpperCase(); }
    get isSI() { return ['CMS', 'LPS', 'MLD'].includes(this.flowUnits); }

    touch() { this.version++; }

    // ---------- parsing
    static parse(text) {
      const m = new Model();
      const lines = text.split('\n');
      let sec = null;
      const xs = new Map(), losses = new Map(), subareas = new Map(), infil = new Map(), tags = [];
      const coords = new Map(), verts = new Map(), polys = new Map(), syms = new Map();
      const warn = []; let pendingDesc = null; const ext = [];
      for (let ln = 0; ln < lines.length; ln++) {
        let line = lines[ln];
        const tl = line.trim();
        if (!tl) continue;
        if (tl.startsWith(';;@OSEM2D')) { const mm = /^;;@OSEM2D\s+(\S+)\s*(.*)$/.exec(tl); if (mm) { m.osem2d = m.osem2d || {}; m.osem2d[mm[1].toUpperCase()] = mm[2].trim(); } continue; }
        if (tl.startsWith(';;@OSEM')) { const k = tl.slice(7).trim().split(/\s+/); if (k.length >= 3) ext.push(k); continue; }
        if (tl[0] === '[') {
          sec = tl.slice(1, tl.indexOf(']') > 0 ? tl.indexOf(']') : undefined).toUpperCase().trim();
          if (!STRUCT.has(sec) && !m.raw[sec]) { m.raw[sec] = []; m.rawOrder.push(sec); }
          continue;
        }
        if (!sec) continue;
        if (!STRUCT.has(sec)) { if (!tl.startsWith(';;')) m.raw[sec].push(line.replace(/\r$/, '')); continue; }
        if (sec === 'TITLE') { if (!tl.startsWith(';;')) m.title.push(line.replace(/\r$/, '')); continue; }
        if (tl[0] === ';') { if (!tl.startsWith(';;') && DESC_SECS.has(sec)) pendingDesc = (pendingDesc ? pendingDesc + ' ' : '') + tl.slice(1).trim(); continue; }
        const t = tokenize(line);
        if (!t.length) continue;
        try {
          switch (sec) {
            case 'OPTIONS': m.options[t[0].toUpperCase()] = t.slice(1).join(' '); break;
            case 'REPORT': m.report.push(t.join(' ')); break;
            case 'RAINGAGES': {
              const p = { format: t[1] || 'INTENSITY', interval: t[2] || '1:00', scf: num(t[3], 1), source: (t[4] || 'TIMESERIES').toUpperCase(), series: t[5] || '', station: t[6] || '', units: t[7] || '' };
              m.gages.set(t[0], XT({ id: t[0], kind: 'GAGE', p, x: null, y: null, tag: '' }, 'RAINGAGES', t, p.source === 'FILE' ? 8 : 6));
              break;
            }
            case 'SUBCATCHMENTS': {
              const p = defaults('SUBCATCH');
              Object.assign(p, { gage: t[1] || '', outlet: t[2] || '', area: num(t[3], 0), imperv: num(t[4], 0), width: num(t[5], 0), slope: num(t[6], 0), curbLen: num(t[7], 0), snowPack: t[8] || '' });
              m.subcatchments.set(t[0], XT({ id: t[0], kind: 'SUBCATCH', p, poly: [], tag: '' }, 'SUBCATCHMENTS', t, 9));
              break;
            }
            case 'SUBAREAS': subareas.set(t[0], t); break;
            case 'INFILTRATION': infil.set(t[0], t); break;
            case 'JUNCTIONS':
              XT(m._addNode(t[0], 'JUNCTION', { elev: num(t[1], 0), maxDepth: num(t[2], 0), initDepth: num(t[3], 0), surDepth: num(t[4], 0), aPonded: num(t[5], 0) }), 'JUNCTIONS', t, 6);
              break;
            case 'OUTFALLS': {
              const ty = (t[2] || 'FREE').toUpperCase(); let k = 3; let stage = '';
              if (['FIXED', 'TIDAL', 'TIMESERIES'].includes(ty)) stage = t[k++] || '';
              XT(m._addNode(t[0], 'OUTFALL', { elev: num(t[1], 0), otype: ty, stage, gated: (t[k++] || 'NO').toUpperCase(), routeTo: t[k++] || '' }), 'OUTFALLS', t, k);
              break;
            }
            case 'DIVIDERS': {
              const ty = (t[3] || 'OVERFLOW').toUpperCase(); const n = { OVERFLOW: 0, CUTOFF: 1, TABULAR: 1, WEIR: 3 }[ty] || 0;
              const k = 4 + n;
              XT(m._addNode(t[0], 'DIVIDER', { elev: num(t[1], 0), divLink: t[2] || '', dtype: ty, dparam: t.slice(4, k).join(' '), maxDepth: num(t[k], 0), initDepth: num(t[k + 1], 0), surDepth: num(t[k + 2], 0), aPonded: num(t[k + 3], 0) }), 'DIVIDERS', t, k + 4);
              break;
            }
            case 'STORAGE': {
              const sh = (t[4] || 'FUNCTIONAL').toUpperCase(); const n = sh === 'TABULAR' ? 1 : 3;
              const k = 5 + n;
              XT(m._addNode(t[0], 'STORAGE', { elev: num(t[1], 0), maxDepth: num(t[2], 0), initDepth: num(t[3], 0), shape: sh, sp1: t[5] || '0', sp2: n > 1 ? (t[6] || '0') : '', sp3: n > 1 ? (t[7] || '0') : '', surDepth: num(t[k], 0), fevap: num(t[k + 1], 0), psi: t[k + 2] || '', ksat: t[k + 3] || '', imd: t[k + 4] || '' }), 'STORAGE', t, k + 5);
              break;
            }
            case 'CONDUITS':
              XT(m._addLink(t[0], 'CONDUIT', t[1], t[2], { length: num(t[3], 0), rough: num(t[4], 0.013), inOff: num(t[5], 0), outOff: num(t[6], 0), initFlow: num(t[7], 0), maxFlow: num(t[8], 0) }), 'CONDUITS', t, 9);
              break;
            case 'PUMPS':
              XT(m._addLink(t[0], 'PUMP', t[1], t[2], { curve: t[3] || '*', status: (t[4] || 'ON').toUpperCase(), startup: num(t[5], 0), shutoff: num(t[6], 0) }), 'PUMPS', t, 7);
              break;
            case 'ORIFICES':
              XT(m._addLink(t[0], 'ORIFICE', t[1], t[2], { otype: (t[3] || 'SIDE').toUpperCase(), offset: num(t[4], 0), qcoeff: num(t[5], 0.65), gated: (t[6] || 'NO').toUpperCase(), closeTime: num(t[7], 0) }), 'ORIFICES', t, 8);
              break;
            case 'WEIRS':
              XT(m._addLink(t[0], 'WEIR', t[1], t[2], { wtype: (t[3] || 'TRANSVERSE').toUpperCase(), crest: num(t[4], 0), qcoeff: num(t[5], 3.33), gated: (t[6] || 'NO').toUpperCase(), endCon: num(t[7], 0), endCoeff: num(t[8], 0), surcharge: (t[9] || 'YES').toUpperCase(), roadWidth: t[10] || '', roadSurf: t[11] || '', coeffCurve: t[12] || '' }), 'WEIRS', t, 13);
              break;
            case 'OUTLETS': {
              const ty = (t[4] || 'FUNCTIONAL/DEPTH').toUpperCase();
              if (ty.startsWith('TABULAR')) XT(m._addLink(t[0], 'OUTLET', t[1], t[2], { offset: num(t[3], 0), otype: ty, c1: t[5] || '', c2: '', gated: (t[6] || 'NO').toUpperCase() }), 'OUTLETS', t, 7);
              else XT(m._addLink(t[0], 'OUTLET', t[1], t[2], { offset: num(t[3], 0), otype: ty, c1: t[5] || '0', c2: t[6] || '0', gated: (t[7] || 'NO').toUpperCase() }), 'OUTLETS', t, 8);
              break;
            }
            case 'XSECTIONS': xs.set(t[0], t); break;
            case 'LOSSES': losses.set(t[0], t); break;
            case 'CURVES': {
              let name = t[0], rest = t.slice(1);
              let c = m.curves.get(name);
              if (!c) { c = { type: '', pts: [] }; m.curves.set(name, c); }
              if (rest.length && isNaN(parseFloat(rest[0]))) { c.type = rest[0].toUpperCase(); rest = rest.slice(1); }
              for (let i = 0; i + 1 < rest.length; i += 2) c.pts.push([num(rest[i], 0), num(rest[i + 1], 0)]);
              break;
            }
            case 'TIMESERIES': {
              const name = t[0];
              let ts = m.timeseries.get(name);
              if (!ts) { ts = { file: null, rows: [] }; m.timeseries.set(name, ts); }
              if (t[1] && t[1].toUpperCase() === 'FILE') { ts.file = t.slice(2).join(' '); break; }
              let rest = t.slice(1);
              // rows may be: [date] time value [time value ...]
              while (rest.length) {
                let date = '';
                if (rest.length >= 3 && /[\/\-]/.test(rest[0]) && !/^-?[\d.]+$/.test(rest[0])) { date = rest[0]; rest = rest.slice(1); }
                if (rest.length < 2) break;
                ts.rows.push([date, rest[0], num(rest[1], 0)]); rest = rest.slice(2);
              }
              break;
            }
            case 'MAP':
              if (t[0].toUpperCase() === 'DIMENSIONS') m.mapInfo.dims = t.slice(1, 5).map(Number);
              else if (t[0].toUpperCase() === 'UNITS') m.mapInfo.units = t[1] || 'None';
              break;
            case 'COORDINATES': coords.set(t[0], [num(t[1], 0), num(t[2], 0)]); break;
            case 'VERTICES': { let a = verts.get(t[0]); if (!a) verts.set(t[0], a = []); a.push([num(t[1], 0), num(t[2], 0)]); break; }
            case 'POLYGONS': { let a = polys.get(t[0]); if (!a) polys.set(t[0], a = []); a.push([num(t[1], 0), num(t[2], 0)]); break; }
            case 'SYMBOLS': syms.set(t[0], [num(t[1], 0), num(t[2], 0)]); break;
            case 'LABELS': m.labels.push({ x: num(t[0], 0), y: num(t[1], 0), text: t[2] || '', anchor: t[3] || '', font: t[4] || '', size: t[5] || '', bold: t[6] || '', italic: t[7] || '' }); break;
            case 'TAGS': tags.push(t); break;
          }
          if (pendingDesc !== null) { if (DESC_SECS.has(sec) && pendingDesc.trim()) { const o = sec === 'CURVES' ? m.curves.get(t[0]) : sec === 'TIMESERIES' ? m.timeseries.get(t[0]) : m.nodes.get(t[0]) || m.links.get(t[0]) || m.subcatchments.get(t[0]) || m.gages.get(t[0]); if (o) o.desc = pendingDesc; } pendingDesc = null; }
        } catch (err) { warn.push('Line ' + (ln + 1) + ': ' + err.message); }
      }
      // ---- merge secondary sections
      for (const [id, t] of subareas) {
        const s = m.subcatchments.get(id); if (!s) continue;
        Object.assign(s.p, { nImp: num(t[1], 0.01), nPerv: num(t[2], 0.1), sImp: num(t[3], 0.05), sPerv: num(t[4], 0.05), pctZero: num(t[5], 25), routeTo: (t[6] || 'OUTLET').toUpperCase(), pctRouted: t[7] || '' }); XT(s, 'SUBAREAS', t, 8);
      }
      for (const [id, t] of infil) {
        const s = m.subcatchments.get(id); if (!s) continue;
        Object.assign(s.p, { i1: t[1] || '', i2: t[2] || '', i3: t[3] || '', i4: t[4] || '', i5: t[5] || '', imethod: t[6] || '' }); XT(s, 'INFILTRATION', t, 7);
      }
      for (const [id, t] of xs) {
        const l = m.links.get(id); if (!l) continue;
        const sh = (t[1] || 'CIRCULAR').toUpperCase();
        if (sh === 'IRREGULAR') { Object.assign(l.p, { shape: sh, g1: t[2] || '', g2: '', g3: '', g4: '', barrels: 1, culvert: '' }); XT(l, 'XSECTIONS', t, 3); }
        else if (sh === 'CUSTOM') Object.assign(l.p, { shape: sh, g1: t[2] || '1', g2: t[3] || '', g3: '', g4: '', barrels: num(t[4], 1), culvert: '' });
        else if (sh === 'STREET') Object.assign(l.p, { shape: sh, g1: t[2] || '', g2: '', g3: '', g4: '', barrels: 1, culvert: '' });
        else { Object.assign(l.p, { shape: sh, g1: t[2] || '0', g2: t[3] || '0', g3: t[4] || '0', g4: t[5] || '0', barrels: num(t[6], 1), culvert: t[7] || '' }); XT(l, 'XSECTIONS', t, 8); }
      }
      for (const [id, t] of losses) {
        const l = m.links.get(id); if (!l) continue;
        Object.assign(l.p, { kEntry: num(t[1], 0), kExit: num(t[2], 0), kAvg: num(t[3], 0), flap: (t[4] || 'NO').toUpperCase(), seepage: num(t[5], 0) }); XT(l, 'LOSSES', t, 6);
      }
      for (const [id, xy] of coords) { const n = m.nodes.get(id); if (n) { n.x = xy[0]; n.y = xy[1]; } }
      for (const [id, a] of verts) { const l = m.links.get(id); if (l) l.verts = a; }
      for (const [id, a] of polys) { const s = m.subcatchments.get(id); if (s) s.poly = a; }
      for (const [id, xy] of syms) { const g = m.gages.get(id); if (g) { g.x = xy[0]; g.y = xy[1]; } }
      for (const t of tags) {
        const ty = (t[0] || '').toUpperCase(); const id = t[1]; const v = t.slice(2).join(' ');
        const o = ty === 'NODE' ? m.nodes.get(id) : ty === 'LINK' ? m.links.get(id) : ty === 'SUBCATCH' ? m.subcatchments.get(id) : ty === 'GAGE' ? m.gages.get(id) : null;
        if (o) o.tag = v;
      }
      // ---- placeholder coordinates for objects without any
      m._fillMissingCoords();
      // OsemCM extensions (comment lines, ignored by SWMM / Avaris DS)
      for (const n of m.nodes.values()) if ((n.type === 'JUNCTION' || n.type === 'DIVIDER') && n.p.chamberArea === undefined) n.p.chamberArea = 0;
      for (const sc of m.subcatchments.values()) if (sc.p.impCoef === undefined) sc.p.impCoef = 1;
      for (const [key, id, v] of ext) {
        if (key === 'CHAMBER') { const n = m.nodes.get(id); if (n) n.p.chamberArea = num(v, 0); }
        else if (key === 'RAINUNITS') { const g = m.gages.get(id); if (g) g.p.tsUnits = String(v).toUpperCase(); }
        else if (key === 'IMPCOEF') { const sc = m.subcatchments.get(id); if (sc) sc.p.impCoef = Math.max(0, Math.min(1, num(v, 1))); }
      }
      m.warnings = warn;
      return m;
    }

    _addNode(id, type, p) {
      const n = { id, kind: 'NODE', type, p: Object.assign(defaults(type), p), x: null, y: null, tag: '' };
      this.nodes.set(id, n); return n;
    }
    _addLink(id, type, from, to, p) {
      const l = { id, kind: 'LINK', type, from, to, p: Object.assign(defaults(type), p), verts: [], tag: '' };
      this.links.set(id, l); return l;
    }

    _fillMissingCoords() {
      let missing = [];
      for (const n of this.nodes.values()) if (n.x === null || !isFinite(n.x)) missing.push(n);
      if (missing.length) {
        const b = this.bounds(true) || { x1: 0, y1: 0, x2: 10000, y2: 10000 };
        const cols = Math.ceil(Math.sqrt(missing.length));
        const dx = (b.x2 - b.x1 || 10000) / (cols + 1);
        missing.forEach((n, i) => { n.x = b.x1 + dx * (1 + (i % cols)); n.y = b.y1 - dx * (1 + Math.floor(i / cols)); });
      }
      for (const g of this.gages.values()) if (g.x === null) { const b = this.bounds(true) || { x1: 0, y2: 10000 }; g.x = b.x1; g.y = b.y2; g.autoXY = true; }
    }

    bounds(nodesOnly) {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      const add = (x, y) => { if (x === null || !isFinite(x)) return; if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; };
      for (const n of this.nodes.values()) add(n.x, n.y);
      if (!nodesOnly) {
        for (const l of this.links.values()) for (const v of l.verts) add(v[0], v[1]);
        for (const s of this.subcatchments.values()) for (const v of s.poly) add(v[0], v[1]);
      }
      if (x1 === Infinity) return null;
      return { x1, y1, x2, y2 };
    }

    // ---------- writing
    toINP(opts = {}) {
      const o = [];
      // rain gages fed by a time series in other rain units than the project (IN for US, MM for SI): for a run the
      // series is written once more, converted to the project units (EPA SWMM reads time-series rain in project units)
      const projRU = (opts.runSI !== undefined ? opts.runSI : this.isSI) ? 'MM' : 'IN'; const rainConv = new Map();
      if (opts.reportAll) for (const g of this.gages.values()) { const u = String(g.p.tsUnits || '').toUpperCase();
        if (g.p.source !== 'FILE' && (u === 'IN' || u === 'MM') && u !== projRU && this.timeseries.has(g.p.series)) rainConv.set(g.p.series, { name: g.p.series + '__' + u + '_TO_' + projRU, f: u === 'MM' ? 1 / 25.4 : 25.4 }); }
      const W = (s) => o.push(s);
      const pad = (s, n) => { s = q(s); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length); };
      const fmt = (v) => (typeof v === 'number') ? String(v) : (v === undefined || v === null ? '' : String(v));
      const row = (arr, w = 16) => arr.map((v, i) => i === arr.length - 1 ? q(fmt(v)) : pad(fmt(v), i === 0 ? Math.max(16, w) : 10)).join('').trimEnd();
      // rows in free-form sections that point to an object which no longer exists (deleted / merged) are dropped,
      // otherwise the engine stops with "undefined object"
      const REF = { LID_USAGE: 's', COVERAGES: 's', LOADINGS: 's', GROUNDWATER: 's', GWF: 's', INFLOWS: 'n', DWF: 'n', RDII: 'n', TREATMENT: 'n' };
      const alive = (name, l) => { const k = REF[name]; if (!k) return true; const t = l.trim(); if (!t || t.startsWith(';')) return true; const id = t.split(/\s+/)[0]; return k === 's' ? this.subcatchments.has(id) : this.nodes.has(id); };
      const rawSec = (name) => { if (this.raw[name] && this.raw[name].length) { const rows = this.raw[name].filter(l => alive(name, l)); if (!rows.length) return; W('[' + name + ']'); for (const l of rows) W(l); W(''); } };
      const WO = (o, line) => { if (o.desc) W(';' + String(o.desc).replace(/[\r\n]+/g, ' ')); W(line); };
      const nodesOf = (ty) => [...this.nodes.values()].filter(n => n.type === ty);
      const linksOf = (ty) => [...this.links.values()].filter(l => l.type === ty);
      const options = Object.assign({}, this.options, opts.optionOverrides || {});

      for (const sec of SECTION_ORDER) {
        switch (sec) {
          case 'TITLE': W('[TITLE]'); W(';;Project Title/Notes'); for (const l of this.title) W(l); W(''); break;
          case 'OPTIONS': W('[OPTIONS]'); W(';;Option             Value'); for (const k in options) if (options[k] !== undefined && options[k] !== null && options[k] !== '') W(pad(k, 21) + options[k]); W(''); break;
          case 'REPORT': {
            const rep = opts.reportAll ? ['INPUT NO', 'CONTROLS NO', 'SUBCATCHMENTS ALL', 'NODES ALL', 'LINKS ALL'].concat(this.report.filter(r => /^(AVERAGES|POLLUTANTS|LID)/i.test(r))) : this.report;
            if (rep.length) { W('[REPORT]'); W(';;Reporting Options'); for (const r of rep) W(r); W(''); }
            break;
          }
          case 'RAINGAGES':
            if (this.gages.size) {
              W('[RAINGAGES]'); W(';;Name           Format    Interval SCF      Source');
              for (const g of this.gages.values()) {
                const p = g.p; const a = [g.id, p.format, p.interval, p.scf, p.source];
                if (p.source === 'FILE') a.push(p.series, p.station, p.units); else a.push(rainConv.has(p.series) ? rainConv.get(p.series).name : p.series);
                WO(g, row(XW(g, 'RAINGAGES', a)));
              }
              W('');
            }
            break;
          case 'SUBCATCHMENTS':
            if (this.subcatchments.size) {
              W('[SUBCATCHMENTS]'); W(';;Name           Rain Gage        Outlet           Area     %Imperv  Width    %Slope   CurbLen  SnowPack');
              for (const s of this.subcatchments.values()) { const p = s.p; WO(s, row(XW(s, 'SUBCATCHMENTS', [s.id, p.gage || '*', p.outlet || '*', p.area, p.imperv, p.width, p.slope, p.curbLen].concat(p.snowPack ? [p.snowPack] : (s.xt && s.xt.SUBCATCHMENTS ? ['*'] : []))))); }
              W('');
            }
            break;
          case 'SUBAREAS':
            if (this.subcatchments.size) {
              W('[SUBAREAS]'); W(';;Subcatchment   N-Imperv   N-Perv     S-Imperv   S-Perv     PctZero    RouteTo    PctRouted');
              for (const s of this.subcatchments.values()) { const p = s.p; W(row(XW(s, 'SUBAREAS', [s.id, p.nImp, p.nPerv, p.sImp, p.sPerv, p.pctZero, p.routeTo].concat(p.pctRouted !== '' && p.pctRouted !== undefined ? [p.pctRouted] : [])))); }
              W('');
            }
            break;
          case 'INFILTRATION':
            if (this.subcatchments.size) {
              W('[INFILTRATION]'); W(';;Subcatchment   Param1     Param2     Param3     Param4     Param5');
              for (const s of this.subcatchments.values()) { const p = s.p; const a = [s.id, p.i1, p.i2, p.i3, p.i4, p.i5].filter((v, i) => i < 3 || v !== '' || p.imethod); if (p.imethod) a.push(p.imethod); W(row(XW(s, 'INFILTRATION', a.map(v => v === '' ? '0' : v)))); }
              W('');
            }
            break;
          case 'JUNCTIONS': {
            const a = nodesOf('JUNCTION'); if (!a.length) break;
            W('[JUNCTIONS]'); W(';;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded');
            for (const n of a) { const p = n.p; WO(n, row(XW(n, 'JUNCTIONS', [n.id, p.elev, p.maxDepth, p.initDepth, p.surDepth, p.aPonded]))); }
            W(''); break;
          }
          case 'OUTFALLS': {
            const a = nodesOf('OUTFALL'); if (!a.length) break;
            W('[OUTFALLS]'); W(';;Name           Elevation  Type       Stage Data       Gated    Route To');
            for (const n of a) { const p = n.p; const r = [n.id, p.elev, p.otype]; if (['FIXED', 'TIDAL', 'TIMESERIES'].includes(p.otype)) r.push(p.stage || '0'); r.push(p.gated || 'NO'); if (p.routeTo) r.push(p.routeTo); WO(n, row(XW(n, 'OUTFALLS', r))); }
            W(''); break;
          }
          case 'DIVIDERS': {
            const a = nodesOf('DIVIDER'); if (!a.length) break;
            W('[DIVIDERS]'); W(';;Name           Elevation  Diverted Link    Type       Parameters');
            for (const n of a) { const p = n.p; const r = [n.id, p.elev, p.divLink, p.dtype].concat(p.dtype === 'OVERFLOW' ? [] : String(p.dparam || '').split(/\s+/).filter(Boolean)).concat([p.maxDepth, p.initDepth, p.surDepth, p.aPonded]); WO(n, row(XW(n, 'DIVIDERS', r))); }
            W(''); break;
          }
          case 'STORAGE': {
            const a = nodesOf('STORAGE'); if (!a.length) break;
            W('[STORAGE]'); W(';;Name           Elev.    MaxDepth   InitDepth  Shape      Curve Type/Params            SurDepth  Fevap    Psi      Ksat     IMD');
            for (const n of a) {
              const p = n.p; const r = [n.id, p.elev, p.maxDepth, p.initDepth, p.shape];
              if (p.shape === 'TABULAR') r.push(p.sp1); else r.push(p.sp1 || 0, p.sp2 || 0, p.sp3 || 0);
              r.push(p.surDepth, p.fevap);
              if (p.psi !== '' && p.psi !== undefined) r.push(p.psi, p.ksat || 0, p.imd || 0);
              WO(n, row(XW(n, 'STORAGE', r)));
            }
            W(''); break;
          }
          case 'CONDUITS': {
            const a = linksOf('CONDUIT'); if (!a.length) break;
            W('[CONDUITS]'); W(';;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow');
            for (const l of a) { const p = l.p; WO(l, row(XW(l, 'CONDUITS', [l.id, l.from, l.to, p.length, p.rough, p.inOff, p.outOff, p.initFlow, p.maxFlow]))); }
            W(''); break;
          }
          case 'PUMPS': {
            const a = linksOf('PUMP'); if (!a.length) break;
            W('[PUMPS]'); W(';;Name           From Node        To Node          Pump Curve       Status   Sartup Shutoff');
            for (const l of a) { const p = l.p; WO(l, row(XW(l, 'PUMPS', [l.id, l.from, l.to, p.curve || '*', p.status, p.startup, p.shutoff]))); }
            W(''); break;
          }
          case 'ORIFICES': {
            const a = linksOf('ORIFICE'); if (!a.length) break;
            W('[ORIFICES]'); W(';;Name           From Node        To Node          Type         Offset     Qcoeff     Gated    CloseTime');
            for (const l of a) { const p = l.p; WO(l, row(XW(l, 'ORIFICES', [l.id, l.from, l.to, p.otype, p.offset, p.qcoeff, p.gated, p.closeTime]))); }
            W(''); break;
          }
          case 'WEIRS': {
            const a = linksOf('WEIR'); if (!a.length) break;
            W('[WEIRS]'); W(';;Name           From Node        To Node          Type         CrestHt    Qcoeff     Gated    EndCon   EndCoeff   Surcharge  RoadWidth  RoadSurf   Coeff. Curve');
            for (const l of a) {
              const p = l.p; const r = [l.id, l.from, l.to, p.wtype, p.crest, p.qcoeff, p.gated, p.endCon, p.endCoeff, p.surcharge];
              if (p.roadWidth || p.roadSurf || p.coeffCurve) r.push(p.roadWidth || '*', p.roadSurf || '*'); if (p.coeffCurve) r.push(p.coeffCurve);
              WO(l, row(XW(l, 'WEIRS', r)));
            }
            W(''); break;
          }
          case 'OUTLETS': {
            const a = linksOf('OUTLET'); if (!a.length) break;
            W('[OUTLETS]'); W(';;Name           From Node        To Node          Offset     Type            QTable/Qcoeff    Qexpon     Gated');
            for (const l of a) { const p = l.p; const r = [l.id, l.from, l.to, p.offset, p.otype]; if (p.otype.startsWith('TABULAR')) r.push(p.c1); else r.push(p.c1, p.c2); r.push(p.gated); WO(l, row(XW(l, 'OUTLETS', r))); }
            W(''); break;
          }
          case 'XSECTIONS': {
            const a = [...this.links.values()].filter(l => l.type === 'CONDUIT' || l.type === 'ORIFICE' || l.type === 'WEIR'); if (!a.length) break;
            W('[XSECTIONS]'); W(';;Link           Shape        Geom1            Geom2      Geom3      Geom4      Barrels    Culvert');
            for (const l of a) {
              const p = l.p; const sh = p.shape || 'CIRCULAR';
              if (sh === 'IRREGULAR' || sh === 'STREET') W(row(XW(l, 'XSECTIONS', [l.id, sh, p.g1])));
              else if (sh === 'CUSTOM') W(row([l.id, sh, p.g1, p.g2, l.type === 'CONDUIT' ? p.barrels : 1]));
              else { const r = [l.id, sh, p.g1 || 0, p.g2 || 0, p.g3 || 0, p.g4 || 0]; if (l.type === 'CONDUIT') { r.push(p.barrels || 1); if (p.culvert) r.push(p.culvert); } W(row(XW(l, 'XSECTIONS', r))); }
            }
            W(''); break;
          }
          case 'LOSSES': {
            const a = linksOf('CONDUIT').filter(l => +l.p.kEntry || +l.p.kExit || +l.p.kAvg || l.p.flap === 'YES' || +l.p.seepage); if (!a.length) break;
            W('[LOSSES]'); W(';;Link           Kentry     Kexit      Kavg       Flap Gate  Seepage');
            for (const l of a) { const p = l.p; W(row(XW(l, 'LOSSES', [l.id, p.kEntry, p.kExit, p.kAvg, p.flap, p.seepage]))); }
            W(''); break;
          }
          case 'CURVES':
            if (this.curves.size) {
              W('[CURVES]'); W(';;Name           Type       X-Value    Y-Value');
              for (const [name, c] of this.curves) { if (c.desc) W(';' + String(c.desc).replace(/[\r\n]+/g, ' ')); c.pts.forEach((pt, i) => W(pad(name, 17) + pad(i === 0 ? (c.type || '') : '', 11) + pad(fmt(pt[0]), 11) + fmt(pt[1]))); W(';'); }
              W('');
            }
            break;
          case 'TIMESERIES':
            if (this.timeseries.size) {
              W('[TIMESERIES]'); W(';;Name           Date       Time       Value');
              for (const [name, ts] of this.timeseries) {
                if (ts.desc) W(';' + String(ts.desc).replace(/[\r\n]+/g, ' '));
                if (ts.file) W(row([name, 'FILE', ts.file]));
                for (const r of ts.rows) W(pad(name, 17) + pad(r[0] || '', 11) + pad(r[1], 11) + fmt(r[2]));
                W(';');
              }
              for (const [name, cv] of rainConv) { const ts = this.timeseries.get(name); if (!ts || ts.file) continue; W(';OsemCM: ' + name + ' converted to ' + projRU);
                for (const r of ts.rows) W(pad(cv.name, 17) + pad(r[0] || '', 11) + pad(r[1], 11) + fmt(+(+r[2] * cv.f).toPrecision(8))); W(';'); }
              W('');
            }
            break;
          case 'MAP': {
            const b = this.bounds(false);
            W('[MAP]');
            const d = b ? [b.x1, b.y1, b.x2, b.y2] : (this.mapInfo.dims || [0, 0, 10000, 10000]);
            W('DIMENSIONS ' + d.map(v => (+v).toFixed(3)).join(' ')); W('Units      ' + (this.mapInfo.units || 'None')); W('');
            break;
          }
          case 'COORDINATES':
            if (this.nodes.size) { W('[COORDINATES]'); W(';;Node           X-Coord            Y-Coord'); for (const n of this.nodes.values()) W(pad(n.id, 17) + pad(String(+n.x), 19) + String(+n.y)); W(''); }
            break;
          case 'VERTICES': {
            const a = [...this.links.values()].filter(l => l.verts && l.verts.length); if (!a.length) break;
            W('[VERTICES]'); W(';;Link           X-Coord            Y-Coord'); for (const l of a) for (const v of l.verts) W(pad(l.id, 17) + pad(String(v[0]), 19) + String(v[1])); W(''); break;
          }
          case 'POLYGONS': {
            const a = [...this.subcatchments.values()].filter(s => s.poly && s.poly.length); if (!a.length) break;
            W('[POLYGONS]'); W(';;Subcatchment   X-Coord            Y-Coord'); for (const s of a) for (const v of s.poly) W(pad(s.id, 17) + pad(String(v[0]), 19) + String(v[1])); W(''); break;
          }
          case 'SYMBOLS':
            if (this.gages.size) { W('[SYMBOLS]'); W(';;Gage           X-Coord            Y-Coord'); for (const g of this.gages.values()) if (!g.autoXY) W(pad(g.id, 17) + pad(String(+g.x), 19) + String(+g.y)); W(''); }
            break;
          case 'LABELS':
            if (this.labels.length) { W('[LABELS]'); W(';;X-Coord          Y-Coord            Label'); for (const l of this.labels) W([l.x.toFixed(3), l.y.toFixed(3), '"' + l.text + '"', l.anchor, l.font ? '"' + l.font + '"' : '', l.size, l.bold, l.italic].filter(v => v !== '').join(' ')); W(''); }
            break;
          case 'TAGS': {
            const t = [];
            for (const n of this.nodes.values()) if (n.tag) t.push(['Node', n.id, n.tag]);
            for (const l of this.links.values()) if (l.tag) t.push(['Link', l.id, l.tag]);
            for (const s of this.subcatchments.values()) if (s.tag) t.push(['Subcatch', s.id, s.tag]);
            if (t.length) { W('[TAGS]'); for (const r of t) W(pad(r[0], 10) + pad(r[1], 17) + q(r[2])); W(''); }
            break;
          }
          default: rawSec(sec);
        }
      }
      for (const sec of this.rawOrder) if (!SECTION_ORDER.includes(sec)) rawSec(sec);
      // OsemCM extensions as comment lines: EPA SWMM and Avaris DS ignore them, the OsemCM engine reads them
      const ext = [];
      for (const n of this.nodes.values()) if (+n.p.chamberArea > 0) ext.push(';;@OSEM CHAMBER ' + n.id + ' ' + (+n.p.chamberArea));
      for (const g of this.gages.values()) { const u = String(g.p.tsUnits || '').toUpperCase(); if (g.p.source !== 'FILE' && (u === 'IN' || u === 'MM') && u !== (this.isSI ? 'MM' : 'IN')) ext.push(';;@OSEM RAINUNITS ' + g.id + ' ' + u); }
      for (const sc of this.subcatchments.values()) if (sc.p.impCoef !== undefined && sc.p.impCoef !== '' && +sc.p.impCoef !== 1 && isFinite(+sc.p.impCoef)) ext.push(';;@OSEM IMPCOEF ' + sc.id + ' ' + Math.max(0, Math.min(1, +sc.p.impCoef)));
      if (ext.length) { W(';;OsemCM extensions (chamber area, impervious runoff coefficient) - ignored by EPA SWMM / Avaris DS'); for (const l of ext) W(l); W(''); }
      // OsemCM V2.0 2D flood settings (paths relative to the model folder when possible)
      if (this.osem2d && Object.keys(this.osem2d).some(k => this.osem2d[k] !== '' && this.osem2d[k] !== undefined)) {
        W(';;OsemCM 2D flood module settings - ignored by EPA SWMM / Avaris DS');
        for (const k of Object.keys(this.osem2d)) { const v = this.osem2d[k]; if (v !== '' && v !== undefined && v !== null) W(';;@OSEM2D ' + k + ' ' + v); }
        W('');
      }
      return o.join('\r\n') + '\r\n';
    }

    // ---------- object helpers
    get(kind, id) {
      if (kind === 'NODE') return this.nodes.get(id);
      if (kind === 'LINK') return this.links.get(id);
      if (kind === 'SUBCATCH') return this.subcatchments.get(id);
      if (kind === 'GAGE') return this.gages.get(id);
      return null;
    }
    idExists(id) { return this.nodes.has(id) || this.links.has(id) || this.subcatchments.has(id) || this.gages.has(id); }
    nextId(prefix) {
      let i = 1; const used = (id) => this.idExists(id);
      // fast path: find max numeric suffix for prefix
      let max = 0; const re = new RegExp('^' + prefix.replace(/[^\w]/g, '\\$&') + '(\\d+)$');
      for (const coll of [this.nodes, this.links, this.subcatchments, this.gages]) for (const k of coll.keys()) { const m = re.exec(k); if (m) max = Math.max(max, +m[1]); }
      i = max + 1; while (used(prefix + i)) i++;
      return prefix + i;
    }
    adjacency() {
      const out = new Map(), inn = new Map();
      for (const n of this.nodes.keys()) { out.set(n, []); inn.set(n, []); }
      for (const l of this.links.values()) {
        if (out.has(l.from)) out.get(l.from).push(l);
        if (inn.has(l.to)) inn.get(l.to).push(l);
      }
      // divider diverted links & outfall routeTo are hydraulic too, but keep it to explicit links
      return { out, inn };
    }
    linkLengthGeom(l) {
      const a = this.nodes.get(l.from), b = this.nodes.get(l.to);
      if (!a || !b) return 0;
      const pts = [[a.x, a.y]].concat(l.verts || []).concat([[b.x, b.y]]);
      let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return L;
    }
    renameObject(obj, newId) {
      const coll = obj.kind === 'NODE' ? this.nodes : obj.kind === 'LINK' ? this.links : obj.kind === 'SUBCATCH' ? this.subcatchments : this.gages;
      const old = obj.id;
      // rebuild map preserving order
      const entries = [...coll.entries()];
      coll.clear();
      for (const [k, v] of entries) coll.set(k === old ? newId : k, v);
      obj.id = newId;
      if (obj.kind === 'NODE') {
        for (const l of this.links.values()) { if (l.from === old) l.from = newId; if (l.to === old) l.to = newId; }
        for (const s of this.subcatchments.values()) if (s.p.outlet === old) s.p.outlet = newId;
      } else if (obj.kind === 'SUBCATCH') {
        for (const s of this.subcatchments.values()) if (s.p.outlet === old) s.p.outlet = newId;
      } else if (obj.kind === 'GAGE') {
        for (const s of this.subcatchments.values()) if (s.p.gage === old) s.p.gage = newId;
      } else if (obj.kind === 'LINK') {
        for (const n of this.nodes.values()) if (n.type === 'DIVIDER' && n.p.divLink === old) n.p.divLink = newId;
      }
      // ids held in data sections edited from the property browser (inflows, RDII, groundwater, LID usage ...)
      const REFS = { NODE: [['INFLOWS', 0], ['DWF', 0], ['RDII', 0], ['TREATMENT', 0], ['GROUNDWATER', 2], ['LID_USAGE', 9], ['INLET_USAGE', 2], ['CONTROLS', '*']],
        SUBCATCH: [['GROUNDWATER', 0], ['GWF', 0], ['LID_USAGE', 0], ['LID_USAGE', 9], ['COVERAGES', 0], ['LOADINGS', 0], ['ADJUSTMENTS', 1]], LINK: [['INLET_USAGE', 0], ['CONTROLS', '*']], GAGE: [] }[obj.kind] || [];
      for (const [sec, col] of REFS) {
        const rows = this.raw[sec]; if (!rows) continue;
        for (let i = 0; i < rows.length; i++) { const tl = rows[i].trim(); if (!tl || tl[0] === ';' || !rows[i].includes(old)) continue;
          if (col === '*') { rows[i] = rows[i].replace(new RegExp('(^|\\s)' + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'g'), (a, b) => b + newId); continue; }
          const t = tokenize(rows[i]); if (t[col] !== old) continue; t[col] = newId;
          rows[i] = t.map(x => /\s/.test(x) || x === '' ? '"' + x + '"' : x).map((x, j) => j === t.length - 1 ? x : x.padEnd(j === 0 ? 17 : 11)).join(''); }
      }
      this.touch();
    }
  }
  AV.Model = Model;

  AV.newModel = function () {
    const m = new Model();
    m.title = ['New Avaris project'];
    const today = new Date(); const ds = String(today.getMonth() + 1).padStart(2, '0') + '/' + String(today.getDate()).padStart(2, '0') + '/' + today.getFullYear();
    Object.assign(m.options, {
      FLOW_UNITS: 'CFS', INFILTRATION: 'HORTON', FLOW_ROUTING: 'DYNWAVE', LINK_OFFSETS: 'DEPTH', MIN_SLOPE: '0', ALLOW_PONDING: 'NO',
      SKIP_STEADY_STATE: 'NO', START_DATE: ds, START_TIME: '00:00:00', REPORT_START_DATE: ds, REPORT_START_TIME: '00:00:00',
      END_DATE: ds, END_TIME: '06:00:00', SWEEP_START: '01/01', SWEEP_END: '12/31', DRY_DAYS: '0', REPORT_STEP: '00:05:00',
      WET_STEP: '00:01:00', DRY_STEP: '01:00:00', ROUTING_STEP: '0:00:05', RULE_STEP: '00:00:00', INERTIAL_DAMPING: 'PARTIAL',
      NORMAL_FLOW_LIMITED: 'BOTH', FORCE_MAIN_EQUATION: 'H-W', VARIABLE_STEP: '0.75', LENGTHENING_STEP: '0', MIN_SURFAREA: '12.566',
      MAX_TRIALS: '8', HEAD_TOLERANCE: '0.005', SYS_FLOW_TOL: '5', LAT_FLOW_TOL: '5', MINIMUM_STEP: '0.5', THREADS: '1',
    });
    m.raw.EVAPORATION = ['CONSTANT         0.0', 'DRY_ONLY         NO']; m.rawOrder.push('EVAPORATION');
    m.report = ['SUBCATCHMENTS ALL', 'NODES ALL', 'LINKS ALL'];
    m.mapInfo = { dims: [0, 0, 10000, 10000], units: 'None' };
    return m;
  };
})(window.AV);
