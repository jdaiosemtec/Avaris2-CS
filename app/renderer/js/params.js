// Parameter editors in the style of Avaris DS (and the Simulation Options dialog):
//   Climatology Editor (Climate File, Temperature, Evaporation, Wind Speed, Snow Melt, Areal Depletion, Adjustments)
//   list + form editors: Aquifers, Snow Packs, Unit Hydrographs, LID Controls, Transects, Control Rules
//   table editors: Groundwater, LID Usage, RDII, Streets, Inlets, Inlet Usage, External Inflows, Dry Weather Flow
// All of them read and write the SWMM 5.2 input sections, so every value reaches the engine.
'use strict';
(function (AV) {
  const h = AV.h;
  const tok = (l) => AV.tokenize(l);
  const isData = (l) => { const t = l.trim(); return t && t[0] !== ';'; };
  const q = (s) => { s = String(s === undefined || s === null ? '' : s); return s === '' ? '""' : /\s/.test(s) ? '"' + s + '"' : s; };
  const line = (arr, w) => arr.map((x, i) => i === arr.length - 1 ? q(x) : q(x).padEnd(i === 0 ? (w || 17) : 11)).join('').trimEnd();
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const num = (v, d) => { const x = parseFloat(v); return isFinite(x) ? x : d; };
  const U = (m) => { const si = m.isSI; return { L: si ? 'm' : 'ft', D: si ? 'mm' : 'in', R: si ? 'mm/hr' : 'in/hr', T: si ? '°C' : '°F', E: si ? 'mm/day' : 'in/day', W: si ? 'km/hr' : 'mph', V: si ? 'm3' : 'ft3' }; };

  // replace whole sections in one undoable step; objChanges = [[obj, key, newValue]] applied in the same step
  AV.setSections = function (app, label, secs, objChanges, extra) {
    const m = app.model; const old = {}; for (const s in secs) old[s] = m.raw[s] ? m.raw[s].slice() : null;
    const oc = (objChanges || []).map(([o, k, v]) => [o, k, v, o.p && k in o.p ? o.p[k] : o[k], !!(o.p && (k in o.p || o.kind))]);
    const apply = (src) => { for (const s in src) { if (src[s] === null || !src[s].length) delete m.raw[s]; else { m.raw[s] = src[s].slice(); if (!m.rawOrder.includes(s)) m.rawOrder.push(s); } } };
    app.exec({ label, do: () => { apply(secs); for (const c of oc) { if (c[4]) c[0].p[c[1]] = c[2]; else c[0][c[1]] = c[2]; } if (extra) extra.do(); },
      undo: () => { apply(old); for (const c of oc) { if (c[4]) c[0].p[c[1]] = c[3]; else c[0][c[1]] = c[3]; } if (extra) extra.undo(); },
      changes: oc.filter(c => c[0].kind).map(c => ({ o: c[0], key: c[1], old: c[3], nw: c[2] })) });
    app.panels.refreshTree();
  };
  // rename references held in raw sections: refs = [[SEC, column, (optional) first-token filter]]
  AV.renameRaw = function (m, ren, refs, out) {
    out = out || {}; if (!Object.keys(ren).length) return out;
    for (const [sec, col, kw] of refs) {
      const src = out[sec] || m.raw[sec]; if (!src) continue; let changed = false;
      const lines = src.map(l => { if (!isData(l)) return l; const t = tok(l); if (kw && (t[0] || '').toUpperCase() !== kw) return l; const cols = Array.isArray(col) ? col : [col]; let hit = false;
        for (const c of cols) { if (c === '*') { for (let i = 0; i < t.length; i++) if (ren[t[i]] !== undefined) { t[i] = ren[t[i]]; hit = true; } } else if (t[c] !== undefined && ren[t[c]] !== undefined) { t[c] = ren[t[c]]; hit = true; } }
        if (!hit) return l; changed = true; return line(t); });
      if (changed) out[sec] = lines;
    }
    return out;
  };

  // modal with tabs, same look as Simulation Options
  function tabbed(title, tabs, start, width, onOK) {
    const tb = h('div', { class: 'tabs2' }); const pages = []; const body = h('div', { class: 'pedit', style: { width: (width || 640) + 'px' } }, tb);
    let cur = Math.max(0, tabs.findIndex(t => t.name === start));
    tabs.forEach((t, i) => {
      const pg = h('div', { class: 'ppage', style: { display: i === cur ? 'block' : 'none' } }, t.el); pages.push(pg); body.appendChild(pg);
      tb.appendChild(h('div', { class: 't2' + (i === cur ? ' active' : ''), onclick: (e) => { AV.$$('.t2', tb).forEach(x => x.classList.remove('active')); e.currentTarget.classList.add('active'); pages.forEach((p, j) => p.style.display = j === i ? 'block' : 'none'); cur = i; } }, t.name));
    });
    return AV.modal({ title, body, enterSubmits: false, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => onOK() }] }).done;
  }
  const form = (...rows) => h('div', { class: 'form pform' }, rows.flat().filter(Boolean));
  const fld = (label, el) => [h('label', null, label), el];
  const inp = (v, w) => h('input', { type: 'text', value: v === undefined || v === null ? '' : String(v), style: { width: (w || 140) + 'px' } });
  const sel = (opts, v, w) => { const s = h('select', { style: w ? { width: w + 'px' } : null }, opts.map(o => Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))); if (v !== undefined) s.value = v; return s; };
  const refSel = (names, v, w) => { const list = [''].concat(names); if (v && !list.includes(v)) list.push(v); return sel(list.map(n => [n, n || '<Empty>']), v || '', w); };
  // simple editable grid: rows x cols of inputs
  function grid(cols, rows, opts = {}) {
    const t = h('table', { class: 'pgridtab' }); const ins = [];
    t.appendChild(h('tr', null, (opts.rowHead !== undefined ? [h('th', null, opts.rowHead)] : []).concat(cols.map(c => h('th', null, c)))));
    rows.forEach((r, i) => { const row = []; const tr = h('tr', null, opts.rowLabels ? h('td', { class: 'rh' }, opts.rowLabels[i]) : null); r.forEach((v, j) => { const x = h('input', { type: 'text', value: v === undefined ? '' : String(v) }); if (opts.readonly && opts.readonly(i, j)) x.disabled = true; row.push(x); tr.appendChild(h('td', null, x)); }); ins.push(row); t.appendChild(tr); });
    return { el: t, ins, values: () => ins.map(r => r.map(x => x.value.trim())) };
  }

  // 12 monthly values as two rows of six
  function months12(vals) { const a = grid(MONTHS.slice(0, 6), [vals.slice(0, 6)]), b = grid(MONTHS.slice(6), [vals.slice(6)]); return { el: h('div', null, a.el, b.el), values: () => [a.values()[0].concat(b.values()[0])] }; }
  // ====================================================================== Climatology
  const NATURAL_ADC = [0.10, 0.35, 0.53, 0.66, 0.75, 0.82, 0.87, 0.92, 0.95, 0.98];
  function readClimate(m) {
    const c = { file: '', fileStart: '', useStart: false, tempSrc: 'none', tempTS: '', wind: 'MONTHLY', windM: Array(12).fill(0), snow: null, adcI: null, adcP: null, tOther: [],
      evap: 'CONSTANT', evapC: 0, evapM: Array(12).fill(0), evapTS: '', pan: Array(12).fill(1), recovery: '', dryOnly: false, eOther: [],
      adj: { TEMPERATURE: Array(12).fill(0), EVAPORATION: Array(12).fill(0), RAINFALL: Array(12).fill(1), CONDUCTIVITY: Array(12).fill(1) }, aOther: [] };
    let hasFile = false, hasTS = false;
    for (const l of (m.raw.TEMPERATURE || [])) { if (!isData(l)) continue; const t = tok(l); const k = (t[0] || '').toUpperCase();
      if (k === 'TIMESERIES') { c.tempTS = t[1] || ''; hasTS = true; }
      else if (k === 'FILE') { c.file = t[1] || ''; if (t[2] && t[2] !== '*') { c.fileStart = t[2]; c.useStart = true; } hasFile = true; }
      else if (k === 'WINDSPEED') { c.wind = (t[1] || 'MONTHLY').toUpperCase(); if (c.wind === 'MONTHLY') c.windM = MONTHS.map((_, i) => num(t[2 + i], 0)); }
      else if (k === 'SNOWMELT') c.snow = t.slice(1, 7).map(v => num(v, 0));
      else if (k === 'ADC') { const a = t.slice(2, 12).map(v => num(v, 1)); if ((t[1] || '').toUpperCase().startsWith('IMP')) c.adcI = a; else c.adcP = a; }
      else c.tOther.push(l); }
    c.tempSrc = hasTS ? 'ts' : hasFile ? 'file' : 'none';
    for (const l of (m.raw.EVAPORATION || [])) { if (!isData(l)) continue; const t = tok(l); const k = (t[0] || '').toUpperCase();
      if (k === 'CONSTANT') { c.evap = k; c.evapC = num(t[1], 0); }
      else if (k === 'MONTHLY') { c.evap = k; c.evapM = MONTHS.map((_, i) => num(t[1 + i], 0)); }
      else if (k === 'TIMESERIES') { c.evap = k; c.evapTS = t[1] || ''; }
      else if (k === 'TEMPERATURE') c.evap = k;
      else if (k === 'FILE') { c.evap = k; if (t.length > 1) c.pan = MONTHS.map((_, i) => num(t[1 + i], 1)); }
      else if (k === 'RECOVERY') c.recovery = t[1] || '';
      else if (k === 'DRY_ONLY') c.dryOnly = (t[1] || '').toUpperCase() === 'YES';
      else c.eOther.push(l); }
    for (const l of (m.raw.ADJUSTMENTS || [])) { if (!isData(l)) continue; const t = tok(l); const k = (t[0] || '').toUpperCase();
      if (c.adj[k]) c.adj[k] = MONTHS.map((_, i) => num(t[1 + i], c.adj[k][i])); else c.aOther.push(l); }
    return c;
  }
  AV.climatologyEditor = async function (app, start) {
    const m = app.model, u = U(m), c = readClimate(m);
    const tsNames = [...m.timeseries.keys()], patNames = (m.raw.PATTERNS || []).filter(isData).map(l => tok(l)[0]).filter((v, i, a) => v && a.indexOf(v) === i);
    // Climate File
    const fileIn = inp(c.file, 360); const browse = h('button', { class: 'btn small', onclick: async () => { const p = await window.host.openDialog({ title: 'Climate file', filters: [{ name: 'Climate files', extensions: ['txt', 'dat', 'csv', 'dly', '*'] }] }); if (p) fileIn.value = p; } }, '…');
    const useStart = h('input', { type: 'checkbox', checked: c.useStart }); const startIn = inp(c.fileStart || '01/01/2000', 120); startIn.disabled = !c.useStart; useStart.onchange = () => { startIn.disabled = !useStart.checked; };
    const tFile = form(fld('From Climate File Path', h('span', { class: 'prow' }, fileIn, browse)), fld(h('span', null, useStart, ' Reading File from'), startIn),
      h('div', { class: 'note' }, 'A climate file (NCDC daily / Canadian / user-prepared) supplies daily max/min temperature, evaporation and wind speed. It is used when Temperature, Evaporation or Wind Speed is set to "From Climate File".'));
    // Temperature
    const tsrc = (v) => h('input', { type: 'radio', name: 'tsrc', value: v, checked: c.tempSrc === v });
    const r0 = tsrc('none'), r1 = tsrc('file'), r2 = tsrc('ts'); const tTS = refSel(tsNames, c.tempTS, 260);
    const tTemp = form(h('h4', null, 'Temperature Source Type'), h('label', { class: 'full prad' }, r0, ' No Data'), h('label', { class: 'full prad' }, r1, ' From Climate File'), fld(h('span', { class: 'prad' }, r2, ' Time Series'), AV.refEdit(app, tTS, 'ts')),
      h('div', { class: 'note' }, 'Air temperature (' + u.T + ') drives snowmelt and the Temperature evaporation method.'));
    // Evaporation
    const eSrc = sel([['CONSTANT', 'Constant Value'], ['TIMESERIES', 'Time Series'], ['FILE', 'Climate File'], ['MONTHLY', 'Monthly Averages'], ['TEMPERATURE', 'Temperatures']], c.evap, 300);
    const eC = inp(c.evapC, 160), eTS = refSel(tsNames, c.evapTS, 300), eM = months12(c.evapM), ePan = months12(c.pan);
    const eRec = refSel(patNames, c.recovery, 300), eDry = h('input', { type: 'checkbox', checked: c.dryOnly });
    const eBox = h('div');
    const eShow = () => { eBox.innerHTML = ''; const s = eSrc.value;
      if (s === 'CONSTANT') eBox.appendChild(form(fld('Daily Evaporation (' + u.E + ')', eC)));
      else if (s === 'TIMESERIES') eBox.appendChild(form(fld('Time Series (' + u.E + ')', AV.refEdit(app, eTS, 'ts'))));
      else if (s === 'MONTHLY') eBox.append(h('div', { class: 'psub' }, 'Monthly Daily Evaporation (' + u.E + ')'), eM.el);
      else if (s === 'FILE') eBox.append(h('div', { class: 'psub' }, 'Monthly Pan Coefficients'), ePan.el);
      else eBox.appendChild(h('div', { class: 'note' }, 'Evaporation is computed from the daily air temperatures (Hargreaves method); the Temperature source must be a climate file.')); };
    eSrc.onchange = eShow; eShow();
    const tEvap = h('div', null, form(fld('Evaporation Source Type', eSrc)), eBox, h('hr', { class: 'psep' }), form(fld('Monthly Soil Recovery Pattern', eRec), h('label', { class: 'full prad' }, eDry, ' Evaporate only during dry periods')));
    // Wind speed
    const wSrc = sel([['MONTHLY', 'Monthly Averages'], ['FILE', 'Climate File']], c.wind, 300); const wM = months12(c.windM);
    const wBox = h('div', null, h('div', { class: 'psub' }, 'Monthly Wind Speed (' + u.W + ')'), wM.el); const wShow = () => { wBox.style.display = wSrc.value === 'MONTHLY' ? 'block' : 'none'; }; wSrc.onchange = wShow; wShow();
    const tWind = h('div', null, form(fld('Wind Speed Source Type', wSrc)), wBox, h('div', { class: 'note pnote' }, 'Wind speed is used only for snowmelt during rainfall.'));
    // Snow melt
    const sv = c.snow || [m.isSI ? 1 : 34, 0.5, 0.6, 0, 50, 0];
    const sIn = sv.map(v => inp(v, 120));
    const tSnow = form(fld('Melting Point of Snow (' + u.T + ')', sIn[0]), fld('ATI Weight (fraction)', sIn[1]), fld('Negative Melt Ratio (fraction)', sIn[2]), fld('Elevation above MSL (' + u.L + ')', sIn[3]), fld('Latitude (degrees)', sIn[4]), fld('Longitude Correction (+/- minutes)', sIn[5]),
      h('div', { class: 'note' }, 'Used by the snowmelt model (Snow Packs); written only when a value differs from the defaults or snow packs exist.'));
    // Areal depletion
    const adcType = (a) => !a || a.every(v => Math.abs(v - 1) < 1e-9) ? 'NONE' : a.every((v, i) => Math.abs(v - NATURAL_ADC[i]) < 1e-9) ? 'NATURAL' : 'CUSTOM';
    const ti = sel([['NONE', 'No Depletion'], ['NATURAL', 'Natural Area'], ['CUSTOM', 'Custom']], adcType(c.adcI), 200), tp = sel([['NONE', 'No Depletion'], ['NATURAL', 'Natural Area'], ['CUSTOM', 'Custom']], adcType(c.adcP), 200);
    const ag = grid(['Impervious', 'Pervious'], NATURAL_ADC.map((_, i) => [(c.adcI || Array(10).fill(1))[i], (c.adcP || Array(10).fill(1))[i]]), { rowHead: 'Depth Ratio', rowLabels: NATURAL_ADC.map((_, i) => (i / 10).toFixed(1)) });
    const setCol = (col, type) => { if (type === 'CUSTOM') return; ag.ins.forEach((r, i) => { r[col].value = type === 'NATURAL' ? NATURAL_ADC[i] : 1; }); };
    ti.onchange = () => setCol(0, ti.value); tp.onchange = () => setCol(1, tp.value);
    ag.ins.forEach(r => r.forEach((x, j) => x.addEventListener('input', () => { (j ? tp : ti).value = 'CUSTOM'; })));
    const tAdc = h('div', null, form(fld('Impervious Area Depletion Type', ti), fld('Pervious Area Depletion Type', tp)), h('div', { class: 'psub', style: { textAlign: 'center' } }, 'Fraction of Area Covered By Snow'), ag.el);
    // Adjustments
    const KEYS = ['TEMPERATURE', 'EVAPORATION', 'RAINFALL', 'CONDUCTIVITY'];
    const adg = grid(['Temperature', 'Evaporation', 'Rain', 'Conductivity'], MONTHS.map((_, i) => KEYS.map(k => c.adj[k][i])), { rowHead: 'Month', rowLabels: MONTHS });
    const tAdj = h('div', null, adg.el, h('div', { class: 'note pnote' }, 'Temperature: temperature adjustment (+/- ' + u.T + ')', h('br'), 'Evaporation: evaporation adjustment (+/- ' + u.E + ')', h('br'), 'Rain: rainfall multiplier', h('br'), 'Conductivity: soil conductivity multiplier'));
    const tabs = [{ name: 'Climate File', el: tFile }, { name: 'Temperature', el: tTemp }, { name: 'Evaporation', el: tEvap }, { name: 'Wind Speed', el: tWind }, { name: 'Snow Melt', el: tSnow }, { name: 'Areal Depletion', el: tAdc }, { name: 'Adjustments', el: tAdj }];
    const res = await tabbed('Climatology Editor', tabs, start, 800, () => {
      const tempSrc = r1.checked ? 'file' : r2.checked ? 'ts' : 'none'; const evap = eSrc.value, wind = wSrc.value;
      const needFile = tempSrc === 'file' || evap === 'FILE' || evap === 'TEMPERATURE' || wind === 'FILE';
      if (needFile && !fileIn.value.trim()) { AV.toast('Choose a climate file on the Climate File tab (needed by ' + [tempSrc === 'file' ? 'Temperature' : '', evap === 'FILE' || evap === 'TEMPERATURE' ? 'Evaporation' : '', wind === 'FILE' ? 'Wind Speed' : ''].filter(Boolean).join(', ') + ').', true); return false; }
      if (tempSrc === 'ts' && !tTS.value) { AV.toast('Choose the temperature time series.', true); return false; }
      if (evap === 'TIMESERIES' && !eTS.value) { AV.toast('Choose the evaporation time series.', true); return false; }
      const T = [], E = [], A = [];
      if (needFile) T.push(line(['FILE', fileIn.value.trim()].concat(useStart.checked && startIn.value.trim() ? [startIn.value.trim()] : []), 20));
      if (tempSrc === 'ts') T.push(line(['TIMESERIES', tTS.value], 20));
      if (wind === 'FILE') T.push(line(['WINDSPEED', 'FILE'], 20)); else { const w = wM.values()[0].map(v => num(v, 0)); if (w.some(v => v) || c.wind === 'MONTHLY' && (m.raw.TEMPERATURE || []).some(l => /^\s*WINDSPEED/i.test(l))) T.push(line(['WINDSPEED', 'MONTHLY'].concat(w), 20)); }
      const snow = sIn.map((x, i) => num(x.value, sv[i])); const snowDef = [m.isSI ? 1 : 34, 0.5, 0.6, 0, 50, 0];
      if (c.snow || snow.some((v, i) => v !== snowDef[i]) || (m.raw.SNOWPACKS || []).some(isData)) T.push(line(['SNOWMELT'].concat(snow), 20));
      const av = ag.values(); const ai = av.map(r => num(r[0], 1)), ap = av.map(r => num(r[1], 1));
      if (ti.value !== 'NONE') T.push(line(['ADC', 'IMPERVIOUS'].concat(ai), 20)); if (tp.value !== 'NONE') T.push(line(['ADC', 'PERVIOUS'].concat(ap), 20));
      T.push(...c.tOther);
      if (evap === 'CONSTANT') E.push(line(['CONSTANT', num(eC.value, 0)], 16)); else if (evap === 'MONTHLY') E.push(line(['MONTHLY'].concat(eM.values()[0].map(v => num(v, 0))), 16));
      else if (evap === 'TIMESERIES') E.push(line(['TIMESERIES', eTS.value], 16)); else if (evap === 'TEMPERATURE') E.push('TEMPERATURE'); else E.push(line(['FILE'].concat(ePan.values()[0].map(v => num(v, 1))), 16));
      if (eRec.value) E.push(line(['RECOVERY', eRec.value], 16)); if (eDry.checked) E.push(line(['DRY_ONLY', 'YES'], 16)); E.push(...c.eOther);
      const adv = adg.values(); KEYS.forEach((k, j) => { const vals = adv.map(r => num(r[j], k === 'RAINFALL' || k === 'CONDUCTIVITY' ? 1 : 0)); const def = k === 'RAINFALL' || k === 'CONDUCTIVITY' ? 1 : 0; if (vals.some(v => v !== def) || c.aOther.length || (m.raw.ADJUSTMENTS || []).some(l => new RegExp('^\\s*' + k, 'i').test(l))) A.push(line([k].concat(vals), 14)); });
      A.push(...c.aOther);
      return { T, E, A };
    });
    if (!res) return;
    AV.setSections(app, 'Edit climatology', { TEMPERATURE: res.T, EVAPORATION: res.E, ADJUSTMENTS: res.A });
    AV.toast('Climatology updated.');
  };

  // ====================================================================== list + form editors
  // spec: { title, sec(s), width, read(m) -> items[{name,...}], write(items, m) -> {SEC: lines}, blank(name) -> item, form(item, ctx) -> {el, save()} }
  async function listEditor(app, spec, selName) {
    const m = app.model; const items = spec.read(m); items.forEach(it => { it._orig = it.name; }); let cur = Math.max(0, items.findIndex(x => x.name === selName)); if (!items.length) cur = -1;
    const list = h('div', { class: 'plist' }); const right = h('div', { class: 'pright' }); let fm = null;
    const commit = () => { if (fm && cur >= 0) { fm.save(); } };
    const show = () => { right.innerHTML = ''; fm = null; if (cur < 0) { right.appendChild(h('div', { class: 'empty' }, 'Click + to add a new ' + spec.one + '.')); return; } fm = spec.form(items[cur], { m, items, refresh: () => renderList() }); right.appendChild(fm.el); };
    const renderList = () => { list.innerHTML = ''; items.forEach((it, i) => list.appendChild(h('div', { class: 'pli' + (i === cur ? ' sel' : ''), onclick: () => { commit(); cur = i; renderList(); show(); } }, it.name))); };
    const uniq = (b) => { let n = b, i = 1; while (items.some(x => x.name === n)) n = b + (++i); return n; };
    const tools = h('div', { class: 'ptools' },
      h('button', { class: 'pib add', title: 'Add', onclick: () => { commit(); items.push(spec.blank(uniq(spec.prefix + (items.length + 1)), m)); cur = items.length - 1; renderList(); show(); } }, '+'),
      h('button', { class: 'pib del', title: 'Delete', onclick: () => { if (cur < 0) return; items.splice(cur, 1); cur = Math.min(cur, items.length - 1); renderList(); show(); } }, '−'),
      h('button', { class: 'pib cpy', title: 'Copy', onclick: () => { if (cur < 0) return; commit(); const c = JSON.parse(JSON.stringify(items[cur])); delete c._orig; c.name = uniq(items[cur].name + '_copy'); items.push(c); cur = items.length - 1; renderList(); show(); } }, '⧉'));
    renderList(); show();
    const body = h('div', { class: 'pedit plistedit', style: { width: (spec.width || 760) + 'px' } }, h('div', { class: 'pleft' }, tools, list), right);
    const r = await AV.modal({ title: spec.title, body, enterSubmits: false, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => {
      commit(); const names = new Set(); for (const it of items) { it.name = String(it.name || '').trim().replace(/\s+/g, '_'); if (!it.name) { AV.toast('Every ' + spec.one + ' needs a name.', true); return false; } if (names.has(it.name)) { AV.toast('Duplicate name: ' + it.name, true); return false; } names.add(it.name); }
      const err = spec.check && spec.check(items, m); if (err) { AV.toast(err, true); return false; } return 'ok'; } }] }).done;
    if (!r) return;
    const ren = {}; for (const it of items) if (it._orig !== undefined && it._orig !== it.name) ren[it._orig] = it.name;
    const lbl = 'Edit ' + spec.title.replace(/ Editor$/, '');
    if (spec.apply) spec.apply(items, m, ren, lbl);
    else { const secs = spec.write(items, m); if (spec.refs) AV.renameRaw(m, ren, spec.refs, secs); AV.setSections(app, lbl, secs, spec.objRefs ? spec.objRefs(m, ren) : null); }
    AV.toast(spec.title.replace(/ Editor$/, '') + ' updated.');
  }
  AV.listEditor = listEditor;
  // [obj, key, newValue] for object properties that name a renamed item
  const objRen = (objs, key, ren) => { const out = []; for (const o of objs) { const v = o.p[key]; if (v !== undefined && ren[v] !== undefined) out.push([o, key, ren[v]]); } return out; };
  AV.objRen = objRen;
  // form of labelled numeric fields bound to an array
  const nameRow = (it) => { const n = inp(it.name, 220); return { row: fld(it.kindLabel || 'Name', n), save: () => { it.name = n.value.trim(); } }; };

  // ---- Aquifers
  const AQ = [['Porosity', '', 0.5], ['Wilting Point', '', 0.15], ['Field Capacity', '', 0.30], ['Conductivity', 'R', 5.0], ['Conductivity Slope', '', 10], ['Tension Slope', '', 15], ['Upper Evap. Fraction', '', 0.35], ['Lower Evap. Depth', 'L', 14],
    ['Lower GW Loss', 'R', 0.002], ['Bottom Elevation', 'L', 0], ['Water Table Elevation', 'L', 10], ['Unsat. Zone Moisture', '', 0.30]];
  AV.aquiferEditor = (app, selName) => listEditor(app, { title: 'Aquifer Editor', one: 'aquifer', prefix: 'AQ', width: 640, refs: [['GROUNDWATER', 1]],
    read: (m) => (m.raw.AQUIFERS || []).filter(isData).map(l => { const t = tok(l); return { name: t[0], v: AQ.map((a, i) => t[1 + i] !== undefined ? t[1 + i] : a[2]), pat: t[13] || '' }; }),
    blank: (name) => ({ name, v: AQ.map(a => a[2]), pat: '' }),
    write: (items) => ({ AQUIFERS: items.map(it => line([it.name].concat(it.v).concat(it.pat ? [it.pat] : []))) }),
    form: (it, ctx) => { const u = U(ctx.m); const nr = nameRow(Object.assign(it, { kindLabel: 'Aquifer Name' })); const ins = it.v.map(v => inp(v, 140)); const pats = (ctx.m.raw.PATTERNS || []).filter(isData).map(l => tok(l)[0]).filter((v, i, a) => a.indexOf(v) === i); const ps = refSel(pats, it.pat, 140);
      return { el: form(nr.row, AQ.map((a, i) => fld(a[0] + (a[1] ? ' (' + (a[1] === 'R' ? u.R : u.L) + ')' : ''), ins[i])), fld('Upper Evap. Pattern', ps)), save: () => { nr.save(); it.v = ins.map(x => x.value.trim() || '0'); it.pat = ps.value; } }; } }, selName);

  // ---- Snow packs
  const SP_ROWS = ['Min. Melt Coeff.', 'Max. Melt Coeff.', 'Base Temperature', 'Fraction Free Water Capacity', 'Initial Snow Depth', 'Initial Free Water', 'Depth at 100% Cover'];
  const spDef = (m) => { const si = m && m.isSI, c = si ? 0.025 : 0.001, tb = si ? 0 : 32, d100 = si ? 25 : 1; return { PLOWABLE: [c, c, tb, 0.10, 0, 0, 0], IMPERVIOUS: [c, c, tb, 0.10, 0, 0, d100], PERVIOUS: [c, c, tb, 0.10, 0, 0, d100], REMOVAL: [si ? 25 : 1, 0, 0, 0, 0, 0, ''] }; };
  AV.snowPackEditor = (app, selName) => listEditor(app, { title: 'Snow Pack Editor', one: 'snow pack', prefix: 'Snow', width: 820, objRefs: (m, ren) => objRen(m.subcatchments.values(), 'snowPack', ren),
    read: (m) => { const map = new Map(); for (const l of (m.raw.SNOWPACKS || []).filter(isData)) { const t = tok(l); const it = map.get(t[0]) || { name: t[0], P: spDef(m) }; map.set(t[0], it); const k = (t[1] || '').toUpperCase(); if (it.P[k]) it.P[k] = it.P[k].map((d, i) => t[2 + i] !== undefined ? t[2 + i] : d); } return [...map.values()]; },
    blank: (name, m) => ({ name, P: spDef(m) }),
    write: (items) => ({ SNOWPACKS: items.flatMap(it => ['PLOWABLE', 'IMPERVIOUS', 'PERVIOUS', 'REMOVAL'].map(k => { let v = it.P[k].slice(); if (k === 'REMOVAL') { while (v.length && (v[v.length - 1] === '' || v[v.length - 1] === undefined)) v.pop(); } return line([it.name, k].concat(v)); })) }),
    form: (it, ctx) => { const u = U(ctx.m); const nr = nameRow(Object.assign(it, { kindLabel: 'Snow Pack Name' }));
      const g = grid(['Plowable', 'Impervious', 'Pervious'], SP_ROWS.map((_, i) => ['PLOWABLE', 'IMPERVIOUS', 'PERVIOUS'].map(k => i === 6 && k === 'PLOWABLE' ? '' : it.P[k][i])), { rowHead: '', rowLabels: SP_ROWS.map((r, i) => r + (i === 2 ? ' (' + u.T + ')' : i === 0 || i === 1 ? ' (' + u.D + '/hr/deg)' : i >= 4 ? ' (' + u.D + ')' : '')), readonly: (i, j) => i === 6 && j === 0 });
      const frac = inp(it.P.PLOWABLE[6], 120);
      const RL = ['Depth at which snow removal begins (' + u.D + ')', 'Fraction transferred out of the watershed', 'Fraction transferred to the impervious area', 'Fraction transferred to the pervious area', 'Fraction converted into immediate melt', 'Fraction moved to another subcatchment', 'Subcatchment name'];
      const rem = it.P.REMOVAL.map((v, i) => i === 6 ? refSel([...ctx.m.subcatchments.keys()], v, 160) : inp(v, 120));
      const t1 = h('div', null, g.el, form(fld('Fraction of Impervious Area That is Plowable', frac))), t2 = form(RL.map((l, i) => fld(l, rem[i])));
      const tb = h('div', { class: 'tabs2' }); const pages = [t1, t2]; t2.style.display = 'none';
      ['Snow Pack Parameters', 'Snow Removal Parameters'].forEach((n, i) => tb.appendChild(h('div', { class: 't2' + (i ? '' : ' active'), onclick: (e) => { AV.$$('.t2', tb).forEach(x => x.classList.remove('active')); e.currentTarget.classList.add('active'); pages.forEach((p, j) => p.style.display = j === i ? '' : 'none'); } }, n)));
      return { el: h('div', null, form(nr.row), tb, t1, t2), save: () => { nr.save(); const v = g.values(); ['PLOWABLE', 'IMPERVIOUS', 'PERVIOUS'].forEach((k, j) => { it.P[k] = v.map((r, i) => r[j] === '' ? spDef(ctx.m)[k][i] : r[j]); }); it.P.PLOWABLE[6] = frac.value.trim() || '0'; it.P.REMOVAL = rem.map(x => x.value.trim()); } }; } }, selName);

  // ---- Unit hydrographs
  const UH_M = ['ALL', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], TERMS = ['SHORT', 'MEDIUM', 'LONG'];
  AV.unitHydrographEditor = (app, selName) => listEditor(app, { title: 'Unit Hydrograph Editor', one: 'unit hydrograph group', prefix: 'UH', width: 820, refs: [['RDII', 1]],
    read: (m) => { const map = new Map(); for (const l of (m.raw.HYDROGRAPHS || []).filter(isData)) { const t = tok(l); let it = map.get(t[0]); if (!it) { it = { name: t[0], gage: '', M: {} }; map.set(t[0], it); }
      if (t.length === 2) it.gage = t[1]; else { const mo = (t[1] || 'ALL').toUpperCase(), te = (t[2] || 'SHORT').toUpperCase(); (it.M[mo] = it.M[mo] || {})[te] = t.slice(3, 9); } } return [...map.values()]; },
    blank: (name, m) => ({ name, gage: [...m.gages.keys()][0] || '', M: {} }),
    check: (items) => { const b = items.find(it => !it.gage); return b ? 'Choose the rain gage used by ' + b.name + '.' : null; },
    write: (items) => ({ HYDROGRAPHS: items.flatMap(it => [line([it.name, it.gage])].concat(UH_M.flatMap(mo => TERMS.map(te => { const v = it.M[mo] && it.M[mo][te]; if (!v || !v.some(x => x !== '' && +x !== 0)) return null; const vv = v.slice(0, 3).map(x => x === '' ? 0 : x); const ia = v.slice(3, 6); return line([it.name, mo, te].concat(vv).concat(ia.some(x => x !== '' && +x !== 0) ? ia.map(x => x === '' ? 0 : x) : [])); }).filter(Boolean)))) }),
    form: (it, ctx) => { const u = U(ctx.m); const nr = nameRow(Object.assign(it, { kindLabel: 'Name of UH Group' })); const gs = refSel([...ctx.m.gages.keys()], it.gage, 220);
      let mo = Object.keys(it.M)[0] || 'ALL'; const moSel = sel(UH_M.map(x => [x, x === 'ALL' ? 'All Months' : x.charAt(0) + x.slice(1).toLowerCase()]), mo, 160);
      const host = h('div'); let g1, g2;
      const saveMonth = () => { if (!g1) return; const a = g1.values(), b = g2.values(); it.M[mo] = {}; TERMS.forEach((te, i) => { it.M[mo][te] = a[i].concat(b[i]); }); };
      const showMonth = () => { host.innerHTML = ''; const d = it.M[mo] || {}; const pad = (a, i0) => [0, 1, 2].map(k => a && a[i0 + k] !== undefined ? a[i0 + k] : ''); g1 = grid(['R', 'T', 'K'], TERMS.map(te => pad(d[te], 0)), { rowHead: '', rowLabels: ['Short-Term', 'Medium-Term', 'Long-Term'] }); g2 = grid(['Maximum Depth', 'Recovery Rate', 'Initial Depth'], TERMS.map(te => pad(d[te], 3)), { rowHead: '', rowLabels: ['Short-Term', 'Medium-Term', 'Long-Term'] });
        const p1 = h('div', null, g1.el, h('div', { class: 'note pnote' }, 'R = fraction of rainfall that becomes I&I', h('br'), 'T = time to hydrograph peak (hours)', h('br'), 'K = falling limb duration / rising limb duration')), p2 = h('div', { style: { display: 'none' } }, g2.el, h('div', { class: 'note pnote' }, 'Initial abstraction depths in ' + u.D + '; recovery rate in ' + u.D + '/day.'));
        const tb = h('div', { class: 'tabs2' }); [['Unit Hydrographs', p1], ['Initial Abstraction Depth', p2]].forEach(([n, p], i) => tb.appendChild(h('div', { class: 't2' + (i ? '' : ' active'), onclick: (e) => { AV.$$('.t2', tb).forEach(x => x.classList.remove('active')); e.currentTarget.classList.add('active'); p1.style.display = i ? 'none' : ''; p2.style.display = i ? '' : 'none'; } }, n))); host.append(tb, p1, p2); };
      moSel.onchange = () => { saveMonth(); mo = moSel.value; showMonth(); }; showMonth();
      return { el: h('div', null, h('div', { class: 'psub' }, 'General'), form(nr.row, fld('Rain Gage Used', gs)), h('div', { class: 'psub' }, 'Response'), form(fld('Hydrographs For', moSel)), host), save: () => { nr.save(); it.gage = gs.value; saveMonth(); } }; } }, selName);

  // ---- LID controls
  const LID_TYPES = [['BC', 'Bio-Retention Cell'], ['RG', 'Rain Garden'], ['GR', 'Green Roof'], ['IT', 'Infiltration Trench'], ['PP', 'Permeable Pavement'], ['RB', 'Rain Barrel'], ['RD', 'Rooftop Disconnection'], ['VS', 'Vegetative Swale']];
  const LID_LAYERS = { BC: ['SURFACE', 'SOIL', 'STORAGE', 'DRAIN'], RG: ['SURFACE', 'SOIL', 'STORAGE'], GR: ['SURFACE', 'SOIL', 'DRAINMAT'], IT: ['SURFACE', 'STORAGE', 'DRAIN'], PP: ['SURFACE', 'PAVEMENT', 'SOIL', 'STORAGE', 'DRAIN'], RB: ['STORAGE', 'DRAIN'], RD: ['SURFACE', 'DRAIN'], VS: ['SURFACE'] };
  const LAYER_F0 = (u) => ({
    SURFACE: [['Berm Height (' + u.D + ')', 6], ['Vegetation Volume Fraction', 0], ['Surface Roughness (Manning n)', 0.1], ['Surface Slope (%)', 1], ['Swale Side Slope (run/rise)', 5]],
    SOIL: [['Thickness (' + u.D + ')', 12], ['Porosity (volume fraction)', 0.5], ['Field Capacity (volume fraction)', 0.2], ['Wilting Point (volume fraction)', 0.1], ['Conductivity (' + u.R + ')', 0.5], ['Conductivity Slope', 10], ['Suction Head (' + u.D + ')', 3.5]],
    PAVEMENT: [['Thickness (' + u.D + ')', 6], ['Void Ratio (voids / solids)', 0.15], ['Impervious Surface Fraction', 0], ['Permeability (' + u.R + ')', 100], ['Clogging Factor', 0], ['Regeneration Interval (days)', 0], ['Regeneration Fraction', 0]],
    STORAGE: [['Thickness / Height (' + u.D + ')', 12], ['Void Ratio (voids / solids)', 0.75], ['Seepage Rate (' + u.R + ')', 0.5], ['Clogging Factor', 0], ['Covered (YES / NO)', 'YES']],
    DRAIN: [['Flow Coefficient', 0], ['Flow Exponent', 0.5], ['Offset (' + u.D + ')', 6], ['Drain Delay (hours)', 6], ['Flow Open Level (' + u.D + ')', 0], ['Flow Closed Level (' + u.D + ')', 0], ['Control Curve', '']],
    DRAINMAT: [['Thickness (' + u.D + ')', 3], ['Void Fraction', 0.5], ['Roughness (Manning n)', 0.1]] });
  const LAYER_F = (u) => { const F = LAYER_F0(u); if (u.D === 'mm') for (const k in F) F[k].forEach(f => { if (/\((mm|mm\/hr)\)/.test(f[0]) && typeof f[1] === 'number') f[1] = Math.round(f[1] * 25.4 * 100) / 100; }); return F; };
  AV.lidEditor = (app, selName) => listEditor(app, { title: 'LID Control Editor', one: 'LID control', prefix: 'LID', width: 820, refs: [['LID_USAGE', 1]],
    read: (m) => { const map = new Map(); for (const l of (m.raw.LID_CONTROLS || []).filter(isData)) { const t = tok(l); let it = map.get(t[0]); if (!it) { it = { name: t[0], type: 'BC', L: {}, extra: [] }; map.set(t[0], it); }
      const k = (t[1] || '').toUpperCase(); if (t.length === 2) it.type = k; else if (k === 'REMOVALS') it.extra.push(t.slice(1)); else it.L[k] = t.slice(2); } return [...map.values()]; },
    blank: (name) => ({ name, type: 'BC', L: {}, extra: [] }),
    write: (items, m) => { const F = LAYER_F(U(m)); return { LID_CONTROLS: items.flatMap(it => [line([it.name, it.type])].concat((LID_LAYERS[it.type] || []).map(ly => { const v = F[ly].map((f, i) => it.L[ly] && it.L[ly][i] !== undefined && it.L[ly][i] !== '' ? it.L[ly][i] : f[1]); while (v.length && v[v.length - 1] === '') v.pop(); return line([it.name, ly].concat(v)); })).concat(it.extra.map(e => line([it.name].concat(e))))) }; },
    form: (it, ctx) => { const F = LAYER_F(U(ctx.m)); const nr = nameRow(Object.assign(it, { kindLabel: 'LID Name' })); const ty = sel(LID_TYPES, it.type, 220); const host = h('div'); let ins = {};
      const saveL = () => { for (const ly in ins) it.L[ly] = ins[ly].map(x => x.value.trim()); };
      const showL = () => { host.innerHTML = ''; ins = {}; const lys = LID_LAYERS[ty.value] || []; const tb = h('div', { class: 'tabs2' }); const pages = [];
        lys.forEach((ly, i) => { const vals = F[ly].map((f, k) => it.L[ly] && it.L[ly][k] !== undefined ? it.L[ly][k] : f[1]); ins[ly] = vals.map(v => inp(v, 140)); const pg = form(F[ly].map((f, k) => fld(f[0], ins[ly][k]))); pg.style.display = i ? 'none' : ''; pages.push(pg);
          tb.appendChild(h('div', { class: 't2' + (i ? '' : ' active'), onclick: (e) => { AV.$$('.t2', tb).forEach(x => x.classList.remove('active')); e.currentTarget.classList.add('active'); pages.forEach((p, j) => p.style.display = j === i ? '' : 'none'); } }, ly.charAt(0) + ly.slice(1).toLowerCase().replace('mat', ' Mat'))); });
        host.append(h('div', { class: 'psub' }, 'Structure Layer'), tb, ...pages); };
      ty.onchange = () => { saveL(); showL(); }; showL();
      return { el: h('div', null, h('div', { class: 'psub' }, 'General'), form(nr.row, fld('LID Type', ty)), host), save: () => { nr.save(); saveL(); it.type = ty.value; } }; } }, selName);

  // small x-y plot with axes, ticks, grid and axis titles (transects, cross sections ...)
  // opts: pts [[x,y]], xLabel, yLabel, fill 'below' (ground) | 'none', vlines [{x, label}], markers
  AV.xyPlot = function (cv, opts) {
    const dpr = window.devicePixelRatio || 1; const W = cv.clientWidth || +cv.getAttribute('width') || 480, H = cv.clientHeight || +cv.getAttribute('height') || 240;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    const pts = (opts.pts || []).filter(p => isFinite(p[0]) && isFinite(p[1]));
    const L = 54, R = 14, T = 12, B = 42, PW = W - L - R, PH = H - T - B;
    c.font = '11px Segoe UI, Arial'; c.fillStyle = '#546e7a';
    if (pts.length < 2) { c.textAlign = 'center'; c.fillText('Enter at least two points', W / 2, H / 2); return; }
    let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
    if (opts.yFromZero && y0 > 0) y0 = 0; if (x1 === x0) x1 = x0 + 1; if (y1 === y0) y1 = y0 + 1;
    const tk = (a, b, n) => AV.Chart.prototype.ticks.call(null, a, b, n);
    const yt = tk(y0, y1, Math.max(3, Math.floor(PH / 40))); const xt = tk(x0, x1, Math.max(3, Math.floor(PW / 70)));
    // axes snap to tick marks so the box looks tidy
    const ys = (yt[1] - yt[0]) || 1; y0 = Math.min(y0, Math.floor(y0 / ys) * ys); y1 = Math.max(y1, Math.ceil(y1 / ys) * ys);
    const X = (x) => L + (x - x0) / (x1 - x0) * PW, Y = (y) => T + PH - (y - y0) / (y1 - y0) * PH;
    c.fillStyle = '#f4f6f8'; c.fillRect(L, T, PW, PH);
    c.strokeStyle = '#d5dbe0'; c.lineWidth = 1; c.setLineDash([3, 3]);
    const yT = tk(y0, y1, Math.max(3, Math.floor(PH / 40)));
    for (const t of yT) { const y = Math.round(Y(t)) + .5; c.beginPath(); c.moveTo(L, y); c.lineTo(L + PW, y); c.stroke(); }
    for (const t of xt) { const x = Math.round(X(t)) + .5; c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + PH); c.stroke(); }
    c.setLineDash([]);
    if (opts.fill !== 'none') { c.fillStyle = opts.fillColor || 'rgba(240,226,120,.85)'; c.beginPath(); c.moveTo(X(pts[0][0]), Y(y0)); pts.forEach(p => c.lineTo(X(p[0]), Y(p[1]))); c.lineTo(X(pts[pts.length - 1][0]), Y(y0)); c.closePath(); c.fill(); }
    c.strokeStyle = opts.lineColor || '#7d6b1f'; c.lineWidth = 1.4; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))); c.stroke();
    if (opts.markers !== false) { c.fillStyle = opts.lineColor || '#7d6b1f'; for (const p of pts) { c.beginPath(); c.arc(X(p[0]), Y(p[1]), 2.4, 0, 7); c.fill(); } }
    for (const v of opts.vlines || []) { if (!(v.x >= x0 && v.x <= x1)) continue; const x = Math.round(X(v.x)) + .5; c.strokeStyle = v.color || '#1565c0'; c.setLineDash([5, 3]); c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + PH); c.stroke(); c.setLineDash([]);
      c.fillStyle = v.color || '#1565c0'; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(v.label || '', x, T + 2); }
    c.strokeStyle = '#78909c'; c.lineWidth = 1; c.strokeRect(L + .5, T + .5, PW, PH);
    c.fillStyle = '#37474f'; c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const t of yT) { const y = Y(t); c.beginPath(); c.moveTo(L - 4, Math.round(y) + .5); c.lineTo(L, Math.round(y) + .5); c.stroke(); c.fillText(AV.fmt(t), L - 6, y); }
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (const t of xt) { const x = X(t); c.beginPath(); c.moveTo(Math.round(x) + .5, T + PH); c.lineTo(Math.round(x) + .5, T + PH + 4); c.stroke(); c.fillText(AV.fmt(t), x, T + PH + 6); }
    c.font = '12px Segoe UI, Arial'; c.fillText(opts.xLabel || '', L + PW / 2, T + PH + 22);
    c.save(); c.translate(14, T + PH / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText(opts.yLabel || '', 0, 0); c.restore();
  };

  // ---- Transects (HEC-2 NC / X1 / GR); a ';' comment line before NC is the description
  AV.transectEditor = (app, selName) => listEditor(app, { title: 'Transect Editor', one: 'transect', prefix: 'TST_', width: 940, objRefs: (m, ren) => objRen([...m.links.values()].filter(l => l.p.shape === 'IRREGULAR'), 'g1', ren),
    read: (m) => { const out = []; let nc = [0.01, 0.01, 0.01], cur = null, desc = '';
      for (const l of (m.raw.TRANSECTS || [])) { const t0 = l.trim(); if (!t0) continue; if (t0[0] === ';') { if (!t0.startsWith(';;')) desc = t0.slice(1).trim(); continue; }
        const t = tok(l); const k = (t[0] || '').toUpperCase();
        if (k === 'NC') nc = [t[1], t[2], t[3]]; else if (k === 'X1') { cur = { name: t[1], desc, nc: nc.slice(), xl: t[3] || 0, xr: t[4] || 0, mean: t[8] || 0, sta: t[9] || 0, elev: t[10] || 0, pts: [] }; out.push(cur); desc = ''; }
        else if (k === 'GR' && cur) for (let i = 1; i + 1 < t.length; i += 2) cur.pts.push([t[i + 1], t[i]]); } return out; },
    blank: (name) => ({ name, desc: '', nc: [0.01, 0.01, 0.01], xl: 0, xr: 0, mean: 0, sta: 0, elev: 0, pts: [] }),
    write: (items) => ({ TRANSECTS: items.flatMap(it => { const L = (it.desc ? [';' + it.desc.replace(/[\r\n]+/g, ' ')] : []).concat([line(['NC'].concat(it.nc), 4), line(['X1', it.name, it.pts.length, it.xl, it.xr, 0, 0, 0, it.mean, it.sta, it.elev], 4)]); for (let i = 0; i < it.pts.length; i += 5) L.push(line(['GR'].concat(it.pts.slice(i, i + 5).flatMap(p => [p[1], p[0]])), 4)); return L.concat(['']); }) }),
    check: (items) => { const b = items.find(it => it.pts.length < 2); return b ? 'Transect ' + b.name + ' needs at least 2 station / elevation points.' : null; },
    form: (it, ctx) => { const u = U(ctx.m); const rows = it.pts.map(p => p.slice()); while (rows.length < 30) rows.push(['', '']);
      const g = grid(['Station', 'Elevation'], rows, { rowHead: '', rowLabels: rows.map((_, i) => i + 1) }); const nm = inp(it.name, 160), ds = inp(it.desc, 160);
      const ins = { l: inp(it.nc[0], 110), r: inp(it.nc[1], 110), c: inp(it.nc[2], 110), xl: inp(it.xl, 110), xr: inp(it.xr, 110), sta: inp(it.sta, 110), elev: inp(it.elev, 110), mean: inp(it.mean, 110) };
      const cv = h('canvas', { class: 'tcanvas' });
      const draw = () => { const pts = g.values().filter(r => r[0] !== '' && r[1] !== '').map(r => [+r[0], +r[1]]); const vl = [];
        const xl = parseFloat(ins.xl.value), xr = parseFloat(ins.xr.value); if (xl) vl.push({ x: xl, label: 'L' }); if (xr) vl.push({ x: xr, label: 'R' });
        AV.xyPlot(cv, { pts, xLabel: 'Station (' + u.L + ')', yLabel: 'Elevation (' + u.L + ')', vlines: vl, yFromZero: pts.length && Math.min(...pts.map(p => p[1])) >= 0 }); };
      g.ins.forEach(r => r.forEach(x => x.addEventListener('input', draw))); [ins.xl, ins.xr].forEach(x => x.addEventListener('input', draw)); setTimeout(draw, 30);
      const props = form(fld('Name', nm), fld('Description', ds), h('h4', null, 'Roughness'), fld('Left Bank', ins.l), fld('Right Bank', ins.r), fld('Channel', ins.c), h('h4', null, 'Bank Stations (' + u.L + ')'), fld('Left', ins.xl), fld('Right', ins.xr), h('h4', null, 'Modifiers'), fld('Stations', ins.sta), fld('Elevations', ins.elev), fld('Meander', ins.mean));
      return { el: h('div', { class: 'ptrans' }, h('div', { class: 'ptdata' }, h('div', { class: 'psub' }, 'Data'), h('div', { class: 'ptgrid' }, g.el), cv), h('div', { class: 'ptprops' }, h('div', { class: 'psub' }, 'Properties'), props)),
        save: () => { it.name = nm.value.trim(); it.desc = ds.value.trim(); it.pts = g.values().filter(r => r[0] !== '' && r[1] !== ''); it.nc = [ins.l.value || 0.01, ins.r.value || 0.01, ins.c.value || 0.01]; it.xl = ins.xl.value || 0; it.xr = ins.xr.value || 0; it.sta = ins.sta.value || 0; it.elev = ins.elev.value || 0; it.mean = ins.mean.value || 0; } }; } }, selName);

  // ---- Control rules (RULE blocks) with VARIABLE / EXPRESSION definitions
  AV.controlEditor = async function (app, selName) {
    const m = app.model; const head = []; let defs = []; const rules = []; let cur = null;
    for (const l of (m.raw.CONTROLS || [])) { const t = l.trim(); if (/^RULE\s/i.test(t)) { cur = { name: tok(t)[1] || 'R' + (rules.length + 1), text: [] }; rules.push(cur); }
      else if (/^(VARIABLE|EXPRESSION)\s/i.test(t)) defs.push(t); else if (cur) cur.text.push(l); else if (t) head.push(l); }
    rules.forEach(r => { while (r.text.length && !r.text[r.text.length - 1].trim()) r.text.pop(); r.text = r.text.join('\n'); });
    await listEditor(app, { title: 'Control Rule Editor', one: 'control rule', prefix: 'R', width: 820,
      read: () => rules, blank: (name) => ({ name, text: 'IF NODE  DEPTH > 0\nTHEN PUMP  STATUS = ON\nPRIORITY 1' }),
      write: (items) => ({ CONTROLS: head.concat(defs).concat(items.flatMap(r => ['RULE ' + r.name].concat(r.text.split('\n')).concat(['']))) }),
      form: (it) => { const nm = inp(it.name, 220); const ta = h('textarea', { class: 'pcode', spellcheck: 'false' }, it.text);
        const defBtn = (kind) => h('button', { class: 'btn small', onclick: async () => { const cur = defs.filter(d => d.toUpperCase().startsWith(kind)).join('\n'); const r = await AV.formDialog(kind === 'VARIABLE' ? 'Named Variables' : 'Named Expressions', [{ k: 'v', l: kind === 'VARIABLE' ? 'VARIABLE name = object id attribute   (one per line)' : 'EXPRESSION name = math expression   (one per line)', t: 'textarea', rows: 10 }], { v: cur }, { width: 620 }); if (r === null) return; defs = defs.filter(d => !d.toUpperCase().startsWith(kind)).concat(r.v.split('\n').map(x => x.trim()).filter(Boolean).map(x => /^(VARIABLE|EXPRESSION)\s/i.test(x) ? x : kind + ' ' + x)); } }, kind === 'VARIABLE' ? 'Variables' : 'Expressions');
        return { el: h('div', null, form(fld('Name', nm)), h('div', { class: 'psub' }, 'Control Statement'), ta, h('div', { class: 'note pnote' }, 'IF / AND / OR conditions, THEN / ELSE actions and an optional PRIORITY, e.g.  IF NODE J1 DEPTH > 2  THEN PUMP P1 STATUS = ON'), h('div', { class: 'exbtnrow' }, defBtn('VARIABLE'), defBtn('EXPRESSION'))),
          save: () => { it.name = nm.value.trim(); it.text = ta.value.replace(/\s+$/, ''); } }; } }, selName);
  };

  // ====================================================================== table editors (one row per object)
  const TABLES = {
    GROUNDWATER: { title: 'Groundwater', cols: (u) => [['Subcatchment', 'sub'], ['Aquifer', 'aq'], ['Receiving Node', 'node'], ['Surface Elev. (' + u.L + ')'], ['A1 (GW flow coeff.)'], ['B1 (GW flow exp.)'], ['A2 (SW flow coeff.)'], ['B2 (SW flow exp.)'], ['A3 (SW-GW interaction)'], ['Fixed Surface Water Depth (' + u.L + ')'], ['Threshold Water Table Elev. (' + u.L + ')'], ['Aquifer Bottom Elev. (' + u.L + ')'], ['Initial Water Table Elev. (' + u.L + ')'], ['Initial Upper Moisture']] },
    LID_USAGE: { title: 'LID Usage', cols: (u) => [['Subcatchment', 'sub'], ['LID Control', 'lid'], ['Number of Units'], ['Area of Each Unit (' + (u.L === 'm' ? 'm2' : 'ft2') + ')'], ['Surface Width (' + u.L + ')'], ['% Initially Saturated'], ['% of Impervious Area Treated'], ['Send Outflow to Pervious (1/0)'], ['Detailed Report File'], ['Drain To'], ['% of Pervious Area Treated']] },
    RDII: { title: 'RDII Assignments', cols: (u) => [['Node', 'node'], ['Unit Hydrograph', 'uh'], ['Sewershed Area (' + (u.L === 'm' ? 'ha' : 'ac') + ')']] },
    STREETS: { title: 'Streets', cols: (u) => [['Name'], ['Crown Width (' + u.L + ')'], ['Curb Height (' + u.L + ')'], ['Cross Slope (%)'], ['Roughness'], ['Depression Height (' + (u.L === 'm' ? 'mm' : 'in') + ')'], ['Depression Width (' + u.L + ')'], ['Sides (1/2)'], ['Backing Width (' + u.L + ')'], ['Backing Slope (%)'], ['Backing Roughness']] },
    INLETS: { title: 'Inlets', cols: (u) => [['Name'], ['Type', ['GRATE', 'CURB', 'SLOTTED', 'DROP_GRATE', 'DROP_CURB', 'CUSTOM']], ['Param 1 (length / curve)'], ['Param 2 (width / height)'], ['Param 3 (grate type / throat)'], ['Param 4 (open area)'], ['Param 5 (splash velocity)']] },
    INLET_USAGE: { title: 'Inlet Usage', cols: (u) => [['Conduit', 'link'], ['Inlet', 'inlet'], ['Capture Node', 'node'], ['Number of Inlets'], ['% Clogged'], ['Flow Restriction'], ['Local Depression Height'], ['Local Depression Width'], ['Placement', ['AUTOMATIC', 'ON_GRADE', 'ON_SAG']]] },
    INFLOWS: { title: 'External Inflows', cols: (u, m) => [['Node', 'node'], ['Constituent', ['FLOW'].concat((m.raw.POLLUTANTS || []).filter(isData).map(l => tok(l)[0]))], ['Time Series', 'ts'], ['Type', ['FLOW', 'CONCEN', 'MASS']], ['Units Factor'], ['Scale Factor'], ['Baseline Value'], ['Baseline Pattern', 'pat']] },
    DWF: { title: 'Dry Weather Flow', cols: (u, m) => [['Node', 'node'], ['Constituent', ['FLOW'].concat((m.raw.POLLUTANTS || []).filter(isData).map(l => tok(l)[0]))], ['Average Value (' + m.flowUnits + ')'], ['Pattern 1', 'pat'], ['Pattern 2', 'pat'], ['Pattern 3', 'pat'], ['Pattern 4', 'pat']] },
    TREATMENT: { title: 'Pollutant Treatment', cols: (u, m) => [['Node', 'node'], ['Pollutant', (m.raw.POLLUTANTS || []).filter(isData).map(l => tok(l)[0])], ['Treatment Expression (e.g. R = 0.5 * R_TSS  or  C = TSS * exp(-0.1*HRT))']], joinFrom: 2 },
    COVERAGES: { title: 'Land Uses', cols: (u, m) => [['Subcatchment', 'sub'], ['Land Use', (m.raw.LANDUSES || []).filter(isData).map(l => tok(l)[0])], ['% of Area']], pairs: true },
    LOADINGS: { title: 'Initial Buildup', cols: (u, m) => [['Subcatchment', 'sub'], ['Pollutant', (m.raw.POLLUTANTS || []).filter(isData).map(l => tok(l)[0])], ['Initial Buildup (' + (m.isSI ? 'kg/ha' : 'lbs/ac') + ')']], pairs: true },
  };
  AV.TABLE_SECTIONS = TABLES;
  // table editor; with forId only the rows of that object are shown (rows of other objects are kept as they are)
  AV.sectionTableEditor = async function (app, sec, forId) {
    const m = app.model, spec = TABLES[sec], u = U(m), cols = spec.cols(u, m);
    const lists = { sub: [...m.subcatchments.keys()], node: [...m.nodes.keys()], link: [...m.links.keys()], ts: [...m.timeseries.keys()], pat: (m.raw.PATTERNS || []).filter(isData).map(l => tok(l)[0]).filter((v, i, a) => a.indexOf(v) === i),
      aq: (m.raw.AQUIFERS || []).filter(isData).map(l => tok(l)[0]), lid: [...new Set((m.raw.LID_CONTROLS || []).filter(isData).map(l => tok(l)[0]))], uh: [...new Set((m.raw.HYDROGRAPHS || []).filter(isData).map(l => tok(l)[0]))], inlet: (m.raw.INLETS || []).filter(isData).map(l => tok(l)[0]) };
    const all = m.raw[sec] || [];
    const comments = all.filter(l => !isData(l) && l.trim());
    let rows = all.filter(isData).map(l => { const t = tok(l); return spec.joinFrom ? t.slice(0, spec.joinFrom).concat([t.slice(spec.joinFrom).join(' ')]) : t; });
    if (spec.pairs) rows = rows.flatMap(t => { const out = []; for (let i = 1; i + 1 < t.length; i += 2) out.push([t[0], t[i], t[i + 1]]); return out; });
    const keep = forId ? rows.filter(t => t[0] !== forId) : [];
    if (forId) rows = rows.filter(t => t[0] === forId);
    const tbody = h('tbody'); const dl = h('div', { style: { display: 'none' } });
    for (const k in lists) { const d = h('datalist', { id: 'pdl-' + k }); lists[k].slice(0, 5000).forEach(v => d.appendChild(h('option', { value: v }))); dl.appendChild(d); }
    const mkRow = (t) => { const tr = h('tr'); const cells = cols.map((c, j) => { const v = t[j] === undefined ? '' : t[j] === '""' ? '' : t[j]; let x;
        if (Array.isArray(c[1])) { x = sel(c[1].includes(v) || !v ? c[1] : c[1].concat([v]), v || c[1][0]); } else { x = h('input', { type: 'text', value: v }); if (c[1]) x.setAttribute('list', 'pdl-' + c[1]); }
        if (forId && j === 0) { x.value = forId; x.disabled = true; }
        tr.appendChild(h('td', null, x)); return x; });
      tr._cells = cells; tr._extra = spec.pairs || spec.joinFrom ? [] : t.slice(cols.length);
      tr.appendChild(h('td', null, h('button', { class: 'pib del', title: 'Delete row', onclick: () => tr.remove() }, '−'))); tbody.appendChild(tr); };
    rows.forEach(mkRow);
    if (forId && !rows.length) mkRow([forId]);
    const table = h('table', { class: 'ptable' }, h('thead', null, h('tr', null, cols.map(c => h('th', null, c[0])).concat([h('th')]))), tbody);
    const body = h('div', { class: 'pedit', style: { width: Math.min(1180, 160 + cols.length * (spec.joinFrom ? 160 : 110)) + 'px' } }, dl, h('div', { class: 'ptwrap' }, table),
      h('div', { class: 'exbtnrow' }, h('button', { class: 'btn small', onclick: () => mkRow(forId ? [forId] : []) }, '+ Add Row'), h('span', { class: 'note' }, forId ? '' : rows.length + ' rows. Leave optional trailing values blank.')));
    const r = await AV.modal({ title: spec.title + (forId ? ' - ' + forId : ''), body, enterSubmits: false, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => 'ok' }] }).done;
    if (!r) return;
    const out = comments.slice(); const wr = (v) => out.push(spec.joinFrom ? line(v.slice(0, spec.joinFrom)) + '  ' + v.slice(spec.joinFrom).join(' ') : line(v));
    keep.forEach(t => wr(t));
    for (const tr of tbody.children) { const v = tr._cells.map(x => x.value.trim()); if (!v[0]) continue; if ((spec.pairs || spec.joinFrom) && (v[1] === '' || v[2] === '')) continue; while (v.length > 1 && v[v.length - 1] === '' && !tr._extra.length) v.pop();
      wr(v.map(x => x === '' ? '*' : x).map((x, i) => (sec === 'INFLOWS' && i === 2 && x === '*') || (sec === 'DWF' && i >= 3 && x === '*') ? '""' : x).concat(tr._extra)); }
    AV.setSections(app, 'Edit ' + spec.title + (forId ? ' (' + forId + ')' : ''), { [sec]: out.map(l => l.replace(/""""/g, '""')) });
    AV.toast(spec.title + ' updated.');
  };
  // short summary of the rows an object has in a section, shown in the property browser
  AV.sectionSummary = function (m, sec, id) {
    const rows = (m.raw[sec] || []).filter(isData).map(l => tok(l)).filter(t => t[0] === id);
    if (!rows.length) return 'None';
    if (sec === 'INFLOWS' || sec === 'DWF' || sec === 'TREATMENT') return rows.map(t => t[1]).join(', ');
    if (sec === 'COVERAGES' || sec === 'LOADINGS') { const n = rows.reduce((a, t) => a + Math.floor((t.length - 1) / 2), 0); return n + (sec === 'COVERAGES' ? ' land use' : ' pollutant') + (n > 1 ? 's' : ''); }
    if (sec === 'GROUNDWATER') return rows[0][1] || 'Yes';
    return String(rows.length);
  };

  // ====================================================================== shared pieces for curves / series / patterns
  AV.viewXY = function (title, xl, yl, series) {
    const host = h('div', { style: { width: '600px', height: '360px', display: 'flex', flexDirection: 'column' } });
    const ch = new AV.Chart(host, {});
    AV.modal({ title: title || 'Curve Viewer', body: host, buttons: [{ label: 'Close', primary: true, value: true }] });
    setTimeout(() => { ch.resize(); ch.setSeries(series.map(s => ({ name: s.name, x: Float64Array.from(s.x), y: Float32Array.from(s.y), bars: s.bars, steps: s.steps })), { xLabel: xl, yLabel: yl, title: '' }); }, 40);
  };
  const ibtn = (icon, title, fn) => h('button', { class: 'pbtn', title, onclick: fn }, h('span', { class: 'pbi' }, icon), title);
  // editable two-column table that always keeps a few blank rows at the bottom
  // open a time series ('ts') or curve in its editor (curve group from the curve type, or grp)
  AV.openRef = async function (app, kind, name, grp) { const m = app.model; name = name && name !== '*' ? name : undefined;
    if (kind === 'ts') return AV.timeSeriesEditor(app, name);
    const c = name && m.curves.get(name); const g = c && c.type ? (/^PUMP/.test(c.type) ? 'PUMP' : c.type) : grp || 'STORAGE'; return AV.curveTypeEditor(app, CURVE_GROUPS[g] ? g : 'STORAGE', name); };
  // a <select> of time series / curves with a button that opens the chosen item in its editor; the list is refreshed afterwards
  AV.refEdit = function (app, s, kind, grp) {
    const names = () => kind === 'ts' ? [...app.model.timeseries.keys()] : [...app.model.curves.entries()].filter(([, c]) => !grp || (grp === 'PUMP' ? /^PUMP/.test(c.type || '') : (c.type || '') === grp)).map(([n]) => n);
    const b = h('button', { class: 'btn small refed', title: kind === 'ts' ? 'Open in the Time Series Editor (view / edit)' : 'Open in the Curve Editor (view / edit)', onclick: async (e) => { e.preventDefault(); e.stopPropagation();
      const before = names(), keep = s.value; await AV.openRef(app, kind, keep, grp); const after = names();
      const fixed = [...s.options].filter(o => o.value === '' || o.value === '*').map(o => [o.value, o.textContent]);
      s.innerHTML = ''; for (const [v, t] of fixed) s.appendChild(h('option', { value: v }, t)); for (const n of after) s.appendChild(h('option', { value: n }, n));
      const added = after.filter(n => !before.includes(n)); s.value = after.includes(keep) || fixed.some(f => f[0] === keep) ? keep : added.length === 1 ? added[0] : (s.options[0] ? s.options[0].value : '');
      s.dispatchEvent(new Event('change')); } }, '✎');
    return h('span', { class: 'prow refrow' }, s, b); };
  // copy a table to the clipboard as tab-separated text (pastes into Excel as cells) / read it back
  const copyTSV = (heads, rows) => navigator.clipboard.writeText([heads].concat(rows).map(r => r.join('\t')).join('\r\n') + '\r\n').then(() => AV.toast(rows.length + ' row(s) copied - paste into Excel with Ctrl+V.'), () => AV.toast('Clipboard not accessible.', true));
  const pasteTSV = async () => { let t = ''; try { t = await navigator.clipboard.readText(); } catch (e) { AV.toast('Clipboard not accessible.', true); return null; }
    const R = t.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '').map(l => l.split('\t').map(x => x.trim())); if (!R.length) { AV.toast('The clipboard is empty.', true); return null; } return R; };
  AV.copyTSV = copyTSV; AV.pasteTSV = pasteTSV;
  function xyTable(heads, pts, minRows) {
    const tb = h('tbody'); const t = h('table', { class: 'pgridtab pxy' }, h('thead', null, h('tr', null, heads.map(x => h('th', null, x)))), tb);
    const addRow = (a, b) => { const r = h('tr', null, [a, b].map(v => h('td', null, h('input', { type: 'text', value: v === undefined || v === null ? '' : String(v) })))); r.addEventListener('input', () => { if (r === tb.lastChild) addRow('', ''); }); tb.appendChild(r); };
    const set = (P) => { tb.innerHTML = ''; P.forEach(p => addRow(p[0], p[1])); for (let i = P.length; i < Math.max(minRows || 15, P.length + 5); i++) addRow('', ''); };
    set(pts);
    const raw = () => [...tb.children].map(r => [...r.querySelectorAll('input')].map(x => x.value.trim())).filter(r => r[0] !== '' || r[1] !== '');
    return { el: h('div', { class: 'pxywrap' }, t), set, raw, values: () => raw().map(r => [parseFloat(r[0]), parseFloat(r[1])]) };
  }
  const readPairs = (text) => text.split(/\r?\n/).map(l => l.trim().split(/[\s,;\t]+/)).filter(t => t.length >= 2 && isFinite(parseFloat(t[0])) && isFinite(parseFloat(t[1]))).map(t => [parseFloat(t[0]), parseFloat(t[1])]);
  async function importPairs(tab) { const p = await window.host.openDialog({ title: 'Import data', filters: [{ name: 'Text / CSV', extensions: ['txt', 'csv', 'dat', 'crv'] }, { name: 'All files', extensions: ['*'] }] }); if (!p) return; const P = readPairs(await window.host.readText(p)); if (!P.length) { AV.toast('No numeric x / y pairs found in the file.', true); return; } tab.set(P); }
  async function exportPairs(tab, name, heads) { const p = await window.host.saveDialog({ title: 'Export data', defaultPath: (name || 'data') + '.txt', filters: [{ name: 'Text', extensions: ['txt'] }, { name: 'CSV', extensions: ['csv'] }] }); if (!p) return; const sep = /\.csv$/i.test(p) ? ',' : '\t'; await window.host.writeText(p, [heads.join(sep)].concat(tab.raw().map(r => r.join(sep))).join('\r\n') + '\r\n'); AV.toast('Exported to ' + p); }

  // ====================================================================== Curves (one editor per curve type, as in Avaris)
  const CURVE_GROUPS = { CONTROL: 'Control Curves', DIVERSION: 'Diversion Curves', PUMP: 'Pump Curves', RATING: 'Rating Curves', SHAPE: 'Shape Curves', STORAGE: 'Storage Curves', TIDAL: 'Tidal Curves', WEIR: 'Weir Curves' };
  AV.CURVE_GROUPS = CURVE_GROUPS;
  const curveHeads = (m, type) => { const u = U(m), Q = m.flowUnits, A = m.isSI ? 'm²' : 'ft²', V3 = m.isSI ? 'm³' : 'ft³';
    switch (type) { case 'CONTROL': return ['Controller Value', 'Controller Setting']; case 'DIVERSION': return ['Inflow (' + Q + ')', 'Outflow (' + Q + ')'];
      case 'PUMP1': return ['Volume (' + V3 + ')', 'Flow (' + Q + ')']; case 'PUMP2': case 'PUMP4': return ['Depth (' + u.L + ')', 'Flow (' + Q + ')']; case 'PUMP3': case 'PUMP5': return ['Head (' + u.L + ')', 'Flow (' + Q + ')'];
      case 'RATING': return ['Head (' + u.L + ')', 'Outflow (' + Q + ')']; case 'SHAPE': return ['Depth / Full Depth', 'Width / Full Depth']; case 'STORAGE': return ['Depth (' + u.L + ')', 'Area (' + A + ')'];
      case 'TIDAL': return ['Hour of Day', 'Stage (' + u.L + ')']; case 'WEIR': return ['Head (' + u.L + ')', 'Coefficient']; } return ['X', 'Y']; };
  const PUMP_NOTE = { PUMP1: 'Type 1: off-line pump with a wet well; flow increases in steps with the available wet well volume.', PUMP2: 'Type 2: in-line pump; flow increases in steps with the inlet node depth.',
    PUMP3: 'Type 3: in-line pump; flow varies continuously with the head difference between outlet and inlet nodes.', PUMP4: 'Type 4: variable speed in-line pump; flow varies continuously with the inlet node depth.',
    PUMP5: 'Type 5: variable speed version of Type 3; the curve is for full speed and the pump setting scales it.' };
  AV.curveTypeEditor = (app, group, selName) => listEditor(app, { title: CURVE_GROUPS[group], one: 'curve', prefix: 'CV_', width: 800,
    read: (m) => [...m.curves].filter(([, c]) => group === 'PUMP' ? /^PUMP/.test(c.type || '') : (c.type || '') === group).map(([n, c]) => ({ name: n, desc: c.desc || '', type: c.type || group, pts: c.pts.map(p => p.slice()) })),
    blank: (name) => ({ name, desc: '', type: group === 'PUMP' ? 'PUMP1' : group, pts: [] }),
    check: (items, m) => { const own = new Set(items.map(x => x._orig).filter(x => x !== undefined));
      for (const it of items) { if (m.curves.has(it.name) && !own.has(it.name)) return 'A curve named ' + it.name + ' already exists (another curve type).';
        if (!it.pts.length) return 'Curve ' + it.name + ' has no data points.'; if (it.pts.some(p => !isFinite(p[0]) || !isFinite(p[1]))) return 'Curve ' + it.name + ': all values must be numbers.';
        for (let i = 1; i < it.pts.length; i++) if (!(it.pts[i][0] > it.pts[i - 1][0])) return 'Curve ' + it.name + ': ' + curveHeads(m, it.type)[0] + ' values must increase.'; } return null; },
    apply: (items, m, ren, lbl) => {
      const old = [...m.curves.entries()]; const nw = old.filter(([n, c]) => !(group === 'PUMP' ? /^PUMP/.test(c.type || '') : (c.type || '') === group));
      for (const it of items) nw.push([it.name, Object.assign({ type: it.type, pts: it.pts }, it.desc ? { desc: it.desc } : {})]);
      const L = [...m.links.values()], N = [...m.nodes.values()];
      const oc = [].concat(objRen(L.filter(l => l.type === 'PUMP'), 'curve', ren), objRen(L.filter(l => l.type === 'WEIR'), 'coeffCurve', ren), objRen(L.filter(l => l.type === 'OUTLET'), 'c1', ren),
        objRen(L.filter(l => l.p.shape === 'CUSTOM'), 'g2', ren), objRen(N.filter(n => n.type === 'STORAGE'), 'sp1', ren), objRen(N.filter(n => n.type === 'DIVIDER'), 'dparam', ren), objRen(N.filter(n => n.type === 'OUTFALL'), 'stage', ren));
      const secs = AV.renameRaw(m, ren, [['CONTROLS', '*'], ['LID_CONTROLS', 8, null]]);
      const setAll = (E) => { m.curves.clear(); for (const [k, v] of E) m.curves.set(k, v); };
      AV.setSections(app, lbl, secs, oc, { do: () => setAll(nw), undo: () => setAll(old) });
    },
    form: (it, ctx) => { const m = ctx.m; const nm = inp(it.name, 330), ds = inp(it.desc, 330);
      let tab = xyTable(curveHeads(m, it.type), it.pts, 15); const tabHost = h('div', null, tab.el);
      const note = h('div', { class: 'note pnote' }, PUMP_NOTE[it.type] || '');
      const ty = group === 'PUMP' ? sel(['PUMP1', 'PUMP2', 'PUMP3', 'PUMP4', 'PUMP5'], it.type, 90) : null;
      if (ty) ty.onchange = () => { const P = tab.raw(); tab = xyTable(curveHeads(m, ty.value), P, 15); tabHost.innerHTML = ''; tabHost.appendChild(tab.el); note.textContent = PUMP_NOTE[ty.value]; };
      const cpy = () => copyTSV(curveHeads(m, ty ? ty.value : it.type), tab.raw());
      const pst = async () => { const R = await pasteTSV(); if (!R) return; const P = R.filter(r => r.length >= 2 && isFinite(parseFloat(r[0])) && isFinite(parseFloat(r[1]))).map(r => [r[0], r[1]]); if (!P.length) { AV.toast('No numeric x / y pairs on the clipboard.', true); return; } tab.set(P); AV.toast(P.length + ' row(s) pasted.'); };
      const tools = h('div', { class: 'ptoolbar' }, ibtn('⇩', 'Import', () => importPairs(tab)), ibtn('⇧', 'Export', () => exportPairs(tab, nm.value, curveHeads(m, ty ? ty.value : it.type))), ibtn('⧉', 'Copy', cpy), ibtn('📋', 'Paste', pst), ibtn('✕', 'Clear', () => tab.set([])),
        ibtn('📈', 'View', () => { const P = tab.values().filter(p => isFinite(p[0]) && isFinite(p[1])); const hd = curveHeads(m, ty ? ty.value : it.type); AV.viewXY('Curve Viewer - ' + nm.value, hd[0], hd[1], [{ name: nm.value, x: P.map(p => p[0]), y: P.map(p => p[1]), steps: /^PUMP[12]$/.test(ty ? ty.value : '') }]); }),
        ty ? h('span', { class: 'ptype' }, 'Type ', ty) : null);
      return { el: h('div', null, h('div', { class: 'psub' }, 'Curve Name'), nm, h('div', { class: 'psub' }, 'Description'), ds, tools, tabHost, group === 'PUMP' ? note : null),
        save: () => { it.name = nm.value.trim(); it.desc = ds.value.trim(); if (ty) it.type = ty.value; it.pts = tab.values(); } }; } }, selName);

  // ====================================================================== Time Series
  AV.timeSeriesEditor = (app, selName) => listEditor(app, { title: 'Time Series Editor', one: 'time series', prefix: 'TS_', width: 820,
    read: (m) => [...m.timeseries].map(([n, t]) => ({ name: n, desc: t.desc || '', file: t.file || '', useFile: !!t.file && !t.rows.length, rows: t.rows.map(r => r.slice()) })),
    blank: (name) => ({ name, desc: '', file: '', useFile: false, rows: [] }),
    check: (items) => { for (const it of items) { if (it.useFile && !it.file) return 'Time series ' + it.name + ': choose the data file.'; if (!it.useFile) { if (!it.rows.length) return 'Time series ' + it.name + ' has no data.'; const b = it.rows.find(r => !r[1] || !isFinite(r[2])); if (b) return 'Time series ' + it.name + ': every row needs a time and a numeric value.'; } } return null; },
    apply: (items, m, ren, lbl) => {
      const old = [...m.timeseries.entries()]; const nw = items.map(it => [it.name, Object.assign({ file: it.useFile ? it.file : null, rows: it.useFile ? [] : it.rows }, it.desc ? { desc: it.desc } : {})]);
      const oc = [].concat(objRen(m.gages.values(), 'series', ren), objRen([...m.nodes.values()].filter(n => n.type === 'OUTFALL'), 'stage', ren));
      const secs = AV.renameRaw(m, ren, [['INFLOWS', 2], ['TEMPERATURE', 1, 'TIMESERIES'], ['EVAPORATION', 1, 'TIMESERIES'], ['CONTROLS', '*'], ['BUILDUP', 6]]);
      const setAll = (E) => { m.timeseries.clear(); for (const [k, v] of E) m.timeseries.set(k, v); };
      AV.setSections(app, lbl, secs, oc, { do: () => setAll(nw), undo: () => setAll(old) });
    },
    form: (it, ctx) => { const nm = inp(it.name, 330), ds = inp(it.desc, 330);
      const rf = h('input', { type: 'radio', name: 'tsrc', checked: it.useFile }), rd = h('input', { type: 'radio', name: 'tsrc', checked: !it.useFile });
      const fp = inp(it.file, 300); const fb = h('button', { class: 'btn small', onclick: async () => { const p = await window.host.openDialog({ title: 'Time series file', filters: [{ name: 'Data files', extensions: ['dat', 'txt', 'csv', 'tsf'] }, { name: 'All files', extensions: ['*'] }] }); if (p) { fp.value = p; rf.checked = true; } } }, '…');
      const tb = h('tbody'); const addRow = (r) => { const tr = h('tr', null, [r[0] || '', r[1] || '', r[2] === undefined ? '' : r[2]].map(v => h('td', null, h('input', { type: 'text', value: String(v) })))); tr.addEventListener('input', () => { if (tr === tb.lastChild) addRow(['', '', '']); rd.checked = true; }); tb.appendChild(tr); };
      const fill = (R) => { tb.innerHTML = ''; R.forEach(addRow); for (let i = R.length; i < Math.max(20, R.length + 10); i++) addRow(['', '', '']); };
      fill(it.rows);
      const rowsNow = () => [...tb.children].map(tr => [...tr.querySelectorAll('input')].map(x => x.value.trim())).filter(r => r[1] !== '' || r[2] !== '').map(r => [r[0], r[1], parseFloat(r[2])]);
      const view = () => { const R = rowsNow(); if (!R.length) return; let last = ''; const d0r = R.find(r => r[0]); const d0 = d0r ? AV.parseSwmmDate(d0r[0], '0:00') : null;
        const x = R.map(r => { if (r[0]) last = r[0]; const hasClock = r[1].includes(':'); return last && d0 !== null ? (AV.parseSwmmDate(last, hasClock ? r[1] : '0:00') - d0) * 24 + (hasClock ? 0 : parseFloat(r[1])) : (hasClock ? AV.hmsToSec(r[1]) / 3600 : parseFloat(r[1])); });
        const rain = [...ctx.m.gages.values()].some(g => g.p.series === it._orig && g.p.source !== 'FILE');
        AV.viewXY('Time Series - ' + nm.value, 'Elapsed Time (hours)', 'Value', [{ name: nm.value, x, y: R.map(r => r[2]), bars: rain }]); };
      const imp = async () => { const p = await window.host.openDialog({ title: 'Import time series', filters: [{ name: 'Text / CSV', extensions: ['txt', 'csv', 'dat'] }, { name: 'All files', extensions: ['*'] }] }); if (!p) return;
        const R = (await window.host.readText(p)).split(/\r?\n/).map(l => l.trim().split(/[\s,;\t]+/).filter(Boolean)).filter(t => t.length >= 2 && isFinite(parseFloat(t[t.length - 1]))).map(t => t.length >= 3 ? [t[0], t[1], t[2]] : ['', t[0], t[1]]);
        if (!R.length) { AV.toast('No time / value rows found in the file.', true); return; } fill(R); rd.checked = true; };
      const exp = async () => { const p = await window.host.saveDialog({ title: 'Export time series', defaultPath: nm.value + '.dat', filters: [{ name: 'SWMM time series', extensions: ['dat', 'txt'] }, { name: 'CSV', extensions: ['csv'] }] }); if (!p) return; const sep = /\.csv$/i.test(p) ? ',' : '\t';
        await window.host.writeText(p, rowsNow().map(r => (r[0] ? [r[0], r[1], r[2]] : [r[1], r[2]]).join(sep)).join('\r\n') + '\r\n'); AV.toast('Exported to ' + p); };
      const cpy = () => copyTSV(['Date (M/D/Y)', 'Time (H:M)', 'Value'], [...tb.children].map(tr => [...tr.querySelectorAll('input')].map(x => x.value.trim())).filter(r => r[1] !== '' || r[2] !== ''));
      // paste rows copied from Excel: date / time / value, or time / value (a header row is skipped)
      const pst = async () => { const R0 = await pasteTSV(); if (!R0) return; const R = R0.filter(r => isFinite(parseFloat(r[r.length - 1])) && r.length >= 2).map(r => r.length >= 3 ? [r[0], r[1], r[2]] : ['', r[0], r[1]]);
        if (!R.length) { AV.toast('No time / value rows on the clipboard.', true); return; } fill(R); rd.checked = true; AV.toast(R.length + ' row(s) pasted.'); };
      const tools = h('div', { class: 'ptoolbar' }, ibtn('⇩', 'Import', imp), ibtn('⇧', 'Export', exp), ibtn('⧉', 'Copy', cpy), ibtn('📋', 'Paste', pst), ibtn('✕', 'Clear', () => fill([])), ibtn('📈', 'View', view));
      const table = h('div', { class: 'pxywrap tsx' }, h('table', { class: 'pgridtab pxy' }, h('thead', null, h('tr', null, h('th', null, 'Date (M/D/Y)'), h('th', null, 'Time (H:M)'), h('th', null, 'Value'))), tb));
      return { el: h('div', null, h('div', { class: 'psub' }, 'Name'), nm, h('div', { class: 'psub' }, 'Description'), ds,
          h('label', { class: 'prad pradrow' }, rf, ' File'), h('div', { class: 'prow' }, fp, fb), h('label', { class: 'prad pradrow' }, rd, ' Data'), tools, table,
          h('div', { class: 'note pnote' }, 'Dates may be left blank to use elapsed hours since the start of the simulation; a date applies to the rows below it.')),
        save: () => { it.name = nm.value.trim(); it.desc = ds.value.trim(); it.useFile = rf.checked; it.file = fp.value.trim(); it.rows = rowsNow(); } }; } }, selName);

  // ====================================================================== Time Patterns
  const PAT_LABELS = { MONTHLY: MONTHS, DAILY: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], HOURLY: [...Array(24).keys()].map(i => (i % 12 || 12) + ' ' + (i < 12 ? 'AM' : 'PM')), WEEKEND: [...Array(24).keys()].map(i => (i % 12 || 12) + ' ' + (i < 12 ? 'AM' : 'PM')) };
  AV.patternEditor = (app, selName) => listEditor(app, { title: 'Time Pattern Editor', one: 'time pattern', prefix: 'PTN_', width: 640,
    refs: [['DWF', [3, 4, 5, 6]], ['INFLOWS', 7], ['AQUIFERS', 13], ['EVAPORATION', 1, 'RECOVERY'], ['ADJUSTMENTS', 2, 'N-PERV'], ['ADJUSTMENTS', 2, 'DSTORE'], ['ADJUSTMENTS', 2, 'INFIL']],
    read: (m) => { const map = new Map(); let desc = '';
      for (const l of (m.raw.PATTERNS || [])) { const t0 = l.trim(); if (!t0) continue; if (t0[0] === ';') { if (!t0.startsWith(';;')) desc = t0.slice(1).trim(); continue; }
        const t = tok(l); let it = map.get(t[0]); let vals = t.slice(1);
        if (!it) { it = { name: t[0], desc, type: 'MONTHLY', vals: [] }; map.set(t[0], it); if (vals.length && PAT_LABELS[vals[0].toUpperCase()]) { it.type = vals[0].toUpperCase(); vals = vals.slice(1); } }
        it.vals.push(...vals); desc = ''; }
      return [...map.values()]; },
    blank: (name) => ({ name, desc: '', type: 'MONTHLY', vals: Array(12).fill(1) }),
    check: (items) => { for (const it of items) { const n = PAT_LABELS[it.type].length; if (it.vals.length !== n || it.vals.some(v => !isFinite(parseFloat(v)))) return 'Pattern ' + it.name + ' needs ' + n + ' numeric multipliers.'; } return null; },
    write: (items) => ({ PATTERNS: items.flatMap(it => { const L = it.desc ? [';' + it.desc] : []; for (let i = 0; i < it.vals.length; i += 6) L.push(line([it.name].concat(i === 0 ? [it.type] : ['']).concat(it.vals.slice(i, i + 6)))); L.push(''); return L; }) }),
    form: (it) => { const nm = inp(it.name, 330), ds = inp(it.desc, 330); const ty = sel(['MONTHLY', 'DAILY', 'HOURLY', 'WEEKEND'], it.type, 120); const host = h('div'); let g = null;
      const show = (vals) => { const L = PAT_LABELS[ty.value]; const v = L.map((_, i) => vals[i] !== undefined ? vals[i] : 1); g = grid(['Multiplier'], v.map(x => [x]), { rowHead: '', rowLabels: L }); host.innerHTML = ''; host.appendChild(h('div', { class: 'pxywrap pat' }, g.el)); };
      show(it.vals); ty.onchange = () => show(g.values().map(r => r[0]));
      const view = () => { const v = g.values().map(r => parseFloat(r[0])); AV.viewXY('Time Pattern - ' + nm.value, ty.value === 'MONTHLY' ? 'Month' : ty.value === 'DAILY' ? 'Day of Week' : 'Hour of Day', 'Multiplier', [{ name: nm.value, x: v.map((_, i) => i), y: v, bars: true }]); };
      return { el: h('div', null, h('div', { class: 'psub' }, 'Pattern Name'), nm, h('div', { class: 'psub' }, 'Description'), ds, h('div', { class: 'ptoolbar' }, h('span', { class: 'ptype' }, 'Type ', ty), ibtn('📈', 'View', view)), host),
        save: () => { it.name = nm.value.trim(); it.desc = ds.value.trim().replace(/[\r\n]+/g, ' '); it.type = ty.value; it.vals = g.values().map(r => r[0] === '' ? '1' : r[0]); } }; } }, selName);

  // ====================================================================== Rain gages
  AV.rainGageEditor = (app, selName) => listEditor(app, { title: 'Rain Gage Editor', one: 'rain gage', prefix: 'RG_', width: 640,
    read: (m) => [...m.gages.values()].map(g => ({ name: g.id, desc: g.desc || '', format: g.p.format || 'INTENSITY', interval: g.p.interval || '1:00', scf: g.p.scf === undefined ? 1 : g.p.scf, source: g.p.source || 'TIMESERIES',
      series: g.p.source === 'FILE' ? '' : g.p.series || '', file: g.p.source === 'FILE' ? g.p.series || '' : '', station: g.p.station || '', units: ((g.p.source === 'FILE' ? g.p.units : g.p.tsUnits) || (m.isSI ? 'MM' : 'IN')).toUpperCase() })),
    blank: (name, m) => ({ name, desc: '', format: 'INTENSITY', interval: '1:00', scf: 1, source: 'TIMESERIES', series: [...m.timeseries.keys()][0] || '', file: '', station: '*', units: m.isSI ? 'MM' : 'IN' }),
    check: (items, m) => { for (const it of items) { if (it.source === 'TIMESERIES' && !it.series) return 'Rain gage ' + it.name + ': choose a time series.'; if (it.source === 'FILE' && !it.file) return 'Rain gage ' + it.name + ': choose the rainfall file.'; if (!/^\d+(:\d{1,2})?(:\d{1,2})?$/.test(String(it.interval))) return 'Rain gage ' + it.name + ': time interval must look like 0:05 or 1:00.'; }
      const keep = new Set(items.map(x => x._orig)); const used = [...m.subcatchments.values()].filter(s => s.p.gage && m.gages.has(s.p.gage) && !keep.has(s.p.gage));
      return used.length ? 'Rain gage ' + used[0].p.gage + ' is used by ' + used.length + ' subcatchment(s) (e.g. ' + used[0].id + '); assign another gage to them before deleting it.' : null; },
    apply: (items, m, ren, lbl) => {
      const old = [...m.gages.entries()]; const b = m.bounds(true) || { x1: 0, y2: 0 };
      const nw = items.map((it, i) => { const g0 = it._orig !== undefined ? m.gages.get(it._orig) : null; const g = g0 ? Object.assign({}, g0, { p: Object.assign({}, g0.p) }) : { kind: 'GAGE', x: b.x1, y: b.y2, tag: '', p: AV.defaults('GAGE') };
        g.id = it.name; if (it.desc) g.desc = it.desc; else delete g.desc;
        Object.assign(g.p, { format: it.format, interval: it.interval, scf: num(it.scf, 1), source: it.source, series: it.source === 'FILE' ? it.file : it.series, station: it.source === 'FILE' ? it.station || '*' : '', units: it.source === 'FILE' ? it.units : '', tsUnits: it.source === 'FILE' ? '' : it.units });
        return [it.name, g]; });
      const oc = objRen(m.subcatchments.values(), 'gage', ren); const secs = AV.renameRaw(m, ren, [['HYDROGRAPHS', 1]]);
      // only the header line "name gage" of a unit hydrograph names a gage
      if (secs.HYDROGRAPHS) secs.HYDROGRAPHS = (m.raw.HYDROGRAPHS || []).map((l, i) => isData(l) && tok(l).length === 2 ? secs.HYDROGRAPHS[i] : l);
      const setAll = (E) => { m.gages.clear(); for (const [k, v] of E) m.gages.set(k, v); };
      AV.setSections(app, lbl, secs, oc, { do: () => setAll(nw), undo: () => setAll(old) });
      app.selection.clear();
    },
    form: (it, ctx) => { const m = ctx.m; const nm = inp(it.name, 200), ds = inp(it.desc, 200); const fmt = sel(['INTENSITY', 'VOLUME', 'CUMULATIVE'], it.format, 200);
      const iv = inp(it.interval, 200), scf = inp(it.scf, 200), src = sel(['TIMESERIES', 'FILE'], it.source, 200), ts = refSel([...m.timeseries.keys()], it.series, 200);
      // choosing a rainfall file switches the data source to FILE; rain units apply to both sources
      const fp = inp(it.file, 170); const fb = h('button', { class: 'btn small', onclick: async () => { const p = await window.host.openDialog({ title: 'Rainfall file', filters: [{ name: 'Rainfall files', extensions: ['dat', 'txt', 'csv', 'prn'] }, { name: 'All files', extensions: ['*'] }] }); if (p) { fp.value = p; src.value = 'FILE'; sync(); } } }, '…');
      const st = inp(it.station, 200), un = sel(['IN', 'MM'], it.units, 200);
      const sync = () => { const f = src.value === 'FILE'; ts.disabled = f; fp.disabled = st.disabled = !f; }; src.onchange = sync; sync();
      return { el: form(fld('Gage Name', nm), fld('Description', ds), fld('Rain Format', fmt), fld('Time Interval (H:MM)', iv), fld('Snow Catch Factor', scf), fld('Data Source', src), fld('Time Series', AV.refEdit(app, ts, 'ts')), fld('File Name', h('span', { class: 'prow' }, fp, fb)), fld('Station ID', st), fld('Rain Units', un),
          h('div', { class: 'note' }, 'Rain Units: units of the rainfall values (time series or file). A time series in other units than the project (' + (m.isSI ? 'MM' : 'IN') + ') is converted when the model is run. Station ID applies to rainfall files only.')),
        save: () => { Object.assign(it, { name: nm.value.trim(), desc: ds.value.trim(), format: fmt.value, interval: iv.value.trim(), scf: scf.value.trim() || '1', source: src.value, series: ts.value, file: fp.value.trim(), station: st.value.trim(), units: un.value }); } }; } }, selName);

  // ====================================================================== Pollutants
  const pollNames = (m) => (m.raw.POLLUTANTS || []).filter(isData).map(l => tok(l)[0]);
  AV.pollutantEditor = (app, selName) => listEditor(app, { title: 'Pollutant Editor', one: 'pollutant', prefix: 'PLT_', width: 600,
    refs: [['BUILDUP', 1], ['WASHOFF', 1], ['TREATMENT', 1], ['INFLOWS', 1], ['DWF', 1], ['POLLUTANTS', 7], ['LID_CONTROLS', 2, null]],
    read: (m) => (m.raw.POLLUTANTS || []).filter(isData).map(l => { const t = tok(l); return { name: t[0], units: (t[1] || 'MG/L').toUpperCase(), crain: t[2] || '0', cgw: t[3] || '0', crdii: t[4] || '0', kdecay: t[5] || '0', snow: (t[6] || 'NO').toUpperCase() === 'YES', copoll: t[7] || '*', cofrac: t[8] || '0', cdwf: t[9] || '0', cinit: t[10] || '0' }; }),
    blank: (name) => ({ name, units: 'MG/L', crain: '0', cgw: '0', crdii: '0', kdecay: '0', snow: false, copoll: '*', cofrac: '0', cdwf: '0', cinit: '0' }),
    write: (items) => ({ POLLUTANTS: items.map(it => line([it.name, it.units, it.crain, it.cgw, it.crdii, it.kdecay, it.snow ? 'YES' : 'NO', it.copoll || '*', it.cofrac, it.cdwf, it.cinit])) }),
    form: (it, ctx) => { const nm = inp(it.name, 180), un = sel([['MG/L', 'MG/L'], ['UG/L', 'UG/L'], ['#/L', '#/L (counts)']], it.units, 180);
      const f = ['crain', 'cgw', 'crdii', 'cdwf', 'cinit', 'kdecay', 'cofrac'].reduce((a, k) => (a[k] = inp(it[k], 180), a), {});
      const cp = sel([['*', '<None>']].concat(ctx.items.filter(x => x !== it).map(x => [x.name, x.name])), it.copoll, 180); const sn = h('input', { type: 'checkbox', checked: it.snow });
      return { el: form(h('h4', null, 'Properties'), fld('Name', nm), fld('Unit Type', un), fld('Rain Concen.', f.crain), fld('GW Concen.', f.cgw), fld('I&I Concen.', f.crdii), fld('DWF Concen.', f.cdwf), fld('Init. Concen.', f.cinit), fld('Decay Coeff. (1/days)', f.kdecay),
          fld('Co-Pollutant', cp), fld('Co-Fraction', f.cofrac), h('label', { class: 'full prad' }, sn, ' Snow Only'), h('div', { class: 'note' }, 'Concentrations in the unit type above; Snow Only = buildup occurs only when there is snow cover.')),
        save: () => { it.name = nm.value.trim(); it.units = un.value; for (const k in f) it[k] = f[k].value.trim() || '0'; it.copoll = cp.value; it.snow = sn.checked; } }; } }, selName);

  // ====================================================================== Land uses (with buildup / washoff per pollutant)
  const BU_FN = [['NONE', 'No Buildup'], ['POW', 'Power'], ['EXP', 'Exponential'], ['SAT', 'Saturation'], ['EXT', 'External Time Series']];
  const WO_FN = [['NONE', 'No Washoff'], ['EXP', 'Exponential'], ['RC', 'Rating Curve'], ['EMC', 'Event Mean Concentration']];
  AV.landUseEditor = (app, selName) => listEditor(app, { title: 'Landuse Editor', one: 'land use', prefix: 'LU_', width: 780,
    refs: [['COVERAGES', '*']],
    read: (m) => { const P = pollNames(m); const map = new Map();
      for (const l of (m.raw.LANDUSES || []).filter(isData)) { const t = tok(l); map.set(t[0], { name: t[0], desc: '', interval: t[1] || '0', avail: t[2] || '0', last: t[3] || '0', B: {}, W: {} }); }
      for (const l of (m.raw.BUILDUP || []).filter(isData)) { const t = tok(l); const it = map.get(t[0]); if (it) it.B[t[1]] = { fn: (t[2] || 'NONE').toUpperCase(), c1: t[3] || '0', c2: t[4] || '0', c3: t[5] || '0', norm: (t[6] || 'AREA').toUpperCase() }; }
      for (const l of (m.raw.WASHOFF || []).filter(isData)) { const t = tok(l); const it = map.get(t[0]); if (it) it.W[t[1]] = { fn: (t[2] || 'NONE').toUpperCase(), c1: t[3] || '0', c2: t[4] || '0', sweep: t[5] || '0', bmp: t[6] || '0' }; }
      for (const it of map.values()) for (const p of P) { it.B[p] = it.B[p] || { fn: 'NONE', c1: '0', c2: '0', c3: '0', norm: 'AREA' }; it.W[p] = it.W[p] || { fn: 'NONE', c1: '0', c2: '0', sweep: '0', bmp: '0' }; }
      return [...map.values()]; },
    blank: (name, m) => { const it = { name, desc: '', interval: '0', avail: '0', last: '0', B: {}, W: {} }; for (const p of pollNames(m)) { it.B[p] = { fn: 'NONE', c1: '0', c2: '0', c3: '0', norm: 'AREA' }; it.W[p] = { fn: 'NONE', c1: '0', c2: '0', sweep: '0', bmp: '0' }; } return it; },
    write: (items, m) => { const P = pollNames(m); const LU = [], BU = [], WO = [];
      for (const it of items) { LU.push(line([it.name, it.interval, it.avail, it.last]));
        for (const p of P) { const b = it.B[p]; if (b && b.fn !== 'NONE') BU.push(line([it.name, p, b.fn, b.c1, b.c2, b.fn === 'EXT' ? b.c3 || '""' : b.c3, b.norm])); const w = it.W[p]; if (w && w.fn !== 'NONE') WO.push(line([it.name, p, w.fn, w.c1, w.c2, w.sweep, w.bmp])); } }
      return { LANDUSES: LU, BUILDUP: BU, WASHOFF: WO }; },
    form: (it, ctx) => { const P = pollNames(ctx.m); const nm = inp(it.name, 200), ds = inp(it.desc, 200), iv = inp(it.interval, 200), av = inp(it.avail, 200), ls = inp(it.last, 200);
      const tb = h('div', { class: 'tabs2' }); const pages = []; const savers = [];
      P.forEach((p, i) => { const b = it.B[p], w = it.W[p];
        const bf = sel(BU_FN, b.fn, 170), b1 = inp(b.c1, 170), b2 = inp(b.c2, 170), b3 = inp(b.c3, 170), bn = sel([['AREA', 'Area'], ['CURB', 'Curb Length']], b.norm, 170);
        const bts = refSel([...ctx.m.timeseries.keys()], b.fn === 'EXT' ? b.c3 : '', 170); const btsW = AV.refEdit(app, bts, 'ts');
        const L1 = h('label', null, 'Max. Buildup'), L2 = h('label', null, 'Rate Constant'), L3 = h('label', null, 'Power/Sat. Constant');
        const b3cell = h('span'); const syncB = () => { const f = bf.value; [b1, b2, b3, bn, bts].forEach(x => x.disabled = f === 'NONE'); L2.textContent = f === 'EXT' ? 'Scaling Factor' : 'Rate Constant'; L3.textContent = f === 'EXT' ? 'Time Series' : f === 'SAT' ? 'Half-Saturation Constant (days)' : 'Power/Sat. Constant'; b3cell.innerHTML = ''; b3cell.appendChild(f === 'EXT' ? btsW : b3); }; bf.onchange = syncB; syncB();
        const wf = sel(WO_FN, w.fn, 170), w1 = inp(w.c1, 170), w2 = inp(w.c2, 170), ws = inp(w.sweep, 170), wb = inp(w.bmp, 170);
        const syncW = () => { [w1, w2, ws, wb].forEach(x => x.disabled = wf.value === 'NONE'); w2.disabled = wf.value === 'NONE' || wf.value === 'EMC'; }; wf.onchange = syncW; syncW();
        const pg = h('div', { style: { display: i ? 'none' : '' } }, form(h('h4', null, 'Buildup'), fld('Function', bf), L1, b1, L2, b2, L3, b3cell, fld('Normalizer', bn), h('h4', null, 'Washoff'), fld('Function', wf), fld('Coefficient', w1), fld('Exponent', w2), fld('Cleaning Effic. (%)', ws), fld('BMP Effic. (%)', wb)));
        pages.push(pg); tb.appendChild(h('div', { class: 't2' + (i ? '' : ' active'), onclick: (e) => { AV.$$('.t2', tb).forEach(x => x.classList.remove('active')); e.currentTarget.classList.add('active'); pages.forEach((q, j) => q.style.display = j === i ? '' : 'none'); } }, p));
        savers.push(() => { it.B[p] = { fn: bf.value, c1: b1.value.trim() || '0', c2: b2.value.trim() || '0', c3: bf.value === 'EXT' ? bts.value : b3.value.trim() || '0', norm: bn.value }; it.W[p] = { fn: wf.value, c1: w1.value.trim() || '0', c2: w2.value.trim() || '0', sweep: ws.value.trim() || '0', bmp: wb.value.trim() || '0' }; }); });
      return { el: h('div', null, form(h('h4', null, 'General'), fld('Landuse Name', nm), fld('Description', ds), fld('Sweeping Interval (days)', iv), fld('Availability (fraction)', av), fld('Last Swept (days)', ls)),
          h('div', { class: 'psub' }, 'Pollutant'), P.length ? h('div', null, tb, ...pages) : h('div', { class: 'note pnote' }, 'Add pollutants first (Quality → Pollutants) to define buildup and washoff.')),
        save: () => { it.name = nm.value.trim(); it.desc = ds.value.trim(); it.interval = iv.value.trim() || '0'; it.avail = av.value.trim() || '0'; it.last = ls.value.trim() || '0'; savers.forEach(f => f()); } }; } }, selName);

  // ====================================================================== Reporting (SWMM [REPORT] section)
  AV.reportingDialog = async function (app) {
    const m = app.model; const rep = { INPUT: 'NO', CONTROLS: 'NO', AVERAGES: 'NO', NODES: [], LINKS: [], SUBCATCHMENTS: [] }; const other = [];
    for (const l of m.report || []) { const t = tok(l); const k = (t[0] || '').toUpperCase(); if (['INPUT', 'CONTROLS', 'AVERAGES'].includes(k)) rep[k] = (t[1] || 'NO').toUpperCase(); else if (rep[k] !== undefined) rep[k].push(...t.slice(1)); else if (t.length) other.push(l); }
    const pages = [], tb = h('div', { class: 'tabs2' }), getters = {};
    [['NODES', 'Nodes', [...m.nodes.keys()]], ['LINKS', 'Links', [...m.links.keys()]], ['SUBCATCHMENTS', 'Subcatchments', [...m.subcatchments.keys()]]].forEach(([k, label, all], i) => {
      const allChk = h('input', { type: 'checkbox', checked: !rep[k].length || rep[k].map(x => x.toUpperCase()).includes('ALL') }); const lst = h('select', { multiple: true, size: 10, style: { width: '100%' } });
      rep[k].filter(x => !/^(ALL|NONE)$/i.test(x)).forEach(x => lst.appendChild(h('option', { value: x }, x)));
      const pick = inp('', 160); const dlId = 'rep-' + k; const dl = h('datalist', { id: dlId }, all.slice(0, 5000).map(x => h('option', { value: x }))); pick.setAttribute('list', dlId);
      const add = h('button', { class: 'pib add', title: 'Add', onclick: () => { const v = pick.value.trim(); if (!v) return; if (!all.includes(v)) { AV.toast(v + ' not found.', true); return; } if (![...lst.options].some(o => o.value === v)) lst.appendChild(h('option', { value: v }, v)); pick.value = ''; allChk.checked = false; } }, '+');
      const del = h('button', { class: 'pib del', title: 'Remove', onclick: () => [...lst.selectedOptions].forEach(o => o.remove()) }, '−');
      const clr = h('button', { class: 'pib cpy', title: 'Clear', onclick: () => { lst.innerHTML = ''; } }, '✕');
      const selBtn = h('button', { class: 'btn small', onclick: () => { [...app.selection].filter(o => (k === 'NODES' ? o.kind === 'NODE' : k === 'LINKS' ? o.kind === 'LINK' : o.kind === 'SUBCATCH')).forEach(o => { if (![...lst.options].some(x => x.value === o.id)) lst.appendChild(h('option', { value: o.id }, o.id)); }); allChk.checked = false; } }, 'Add Map Selection');
      const pg = h('div', { style: { display: i ? 'none' : '' } }, dl, h('div', { class: 'ptools', style: { border: '1px solid var(--border)' } }, add, del, clr, pick, selBtn), lst, h('label', { class: 'prad pradrow' }, allChk, ' All ' + label));
      pages.push(pg); getters[k] = () => allChk.checked ? ['ALL'] : [...lst.options].map(o => o.value);
      tb.appendChild(h('div', { class: 't2' + (i ? '' : ' active'), onclick: (e) => { AV.$$('.t2', tb).forEach(x => x.classList.remove('active')); e.currentTarget.classList.add('active'); pages.forEach((q, j) => q.style.display = j === i ? '' : 'none'); } }, label));
    });
    const c1 = h('input', { type: 'checkbox', checked: rep.INPUT === 'YES' }), c2 = h('input', { type: 'checkbox', checked: rep.CONTROLS === 'YES' }), c3 = h('input', { type: 'checkbox', checked: rep.AVERAGES === 'YES' });
    const body = h('div', { class: 'pedit', style: { width: '460px' } }, tb, ...pages, h('div', { style: { marginTop: '10px' } }, h('label', { class: 'prad pradrow' }, c1, ' Report Input Summary'), h('label', { class: 'prad pradrow' }, c2, ' Report Control Actions'), h('label', { class: 'prad pradrow' }, c3, ' Report Average Results')),
      h('div', { class: 'note pnote' }, 'These options control what is written to the status report (.rpt). The binary results file always holds all objects, so maps, plots and themes are not affected.'));
    const r = await AV.modal({ title: 'Reporting Options', body, enterSubmits: false, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: true }] }).done;
    if (!r) return;
    const out = ['INPUT ' + (c1.checked ? 'YES' : 'NO'), 'CONTROLS ' + (c2.checked ? 'YES' : 'NO'), 'AVERAGES ' + (c3.checked ? 'YES' : 'NO')];
    for (const k of ['SUBCATCHMENTS', 'NODES', 'LINKS']) { const v = getters[k](); if (v[0] === 'ALL') out.push(k + ' ALL'); else if (!v.length) out.push(k + ' NONE'); else for (let i = 0; i < v.length; i += 8) out.push(k + ' ' + v.slice(i, i + 8).join(' ')); }
    const nw = out.concat(other), old = (m.report || []).slice();
    app.exec({ label: 'Edit reporting options', do: () => { m.report = nw; }, undo: () => { m.report = old; } });
    AV.toast('Reporting options updated.');
  };

  // [CONTROLS] without the rules that use any of the ids in 'gone': a rule is removed when an object keyword
  // (NODE, LINK, PUMP ...) is followed by a deleted id, or when it uses a VARIABLE / EXPRESSION that depends on one
  AV.controlsWithout = function (lines, gone) {
    const KW = /^(NODE|LINK|CONDUIT|PUMP|ORIFICE|WEIR|OUTLET|GAGE|JUNCTION|STORAGE|OUTFALL|DIVIDER|SUBCATCH|SUBCATCHMENT)$/i;
    const usesGone = (toks) => toks.some((t, i) => gone.has(t) && i > 0 && (KW.test(toks[i - 1]) || (i > 1 && KW.test(toks[i - 2]))));
    const head = [], defs = [], rules = []; let cur = null;
    for (const l of lines) { const t = l.trim(); if (/^RULE\s/i.test(t)) { cur = { name: tok(t)[1] || '', lines: [l] }; rules.push(cur); } else if (/^(VARIABLE|EXPRESSION)\s/i.test(t)) defs.push(l); else if (cur) cur.lines.push(l); else head.push(l); }
    const bad = new Set(); let changed = true;
    while (changed) { changed = false; for (const d of defs) { const t = tok(d); const name = t[1]; if (!name || bad.has(name)) continue; const body = t.slice(3);
      if (usesGone(body) || body.some(x => bad.has(x)) || body.join(' ').split(/[^A-Za-z0-9_.\-]+/).some(x => bad.has(x))) { bad.add(name); changed = true; } } }
    const out = { rules: [], defs: [...bad], lines: null };
    const keep = rules.filter(r => { const toks = r.lines.slice(1).flatMap(l => tok(l)); const words = r.lines.slice(1).join(' ').split(/[^A-Za-z0-9_.\-]+/);
      const hit = usesGone(toks) || toks.some(x => bad.has(x)) || words.some(x => bad.has(x)); if (hit) out.rules.push(r.name); return !hit; });
    out.lines = head.concat(defs.filter(d => !bad.has(tok(d)[1]))).concat(keep.flatMap(r => r.lines));
    return out;
  };
})(window.AV);
