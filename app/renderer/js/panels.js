// Model tree, layer list, property browser and thematic map rendering
'use strict';
(function (AV) {
  const h = AV.h;
  const TYPE_LABEL = { JUNCTION: 'Junctions', OUTFALL: 'Outfalls', DIVIDER: 'Dividers', STORAGE: 'Storage Units', CONDUIT: 'Conduits', PUMP: 'Pumps', ORIFICE: 'Orifices', WEIR: 'Weirs', OUTLET: 'Outlets', SUBCATCH: 'Subcatchments', GAGE: 'Rain Gages' };
  AV.TYPE_LABEL = TYPE_LABEL;
  // raw sections that have their own editor (dialog or object property); anything else is listed under Other Sections
  const KNOWN_RAW = new Set(['TEMPERATURE', 'EVAPORATION', 'ADJUSTMENTS', 'AQUIFERS', 'GROUNDWATER', 'GWF', 'SNOWPACKS', 'HYDROGRAPHS', 'RDII', 'LID_CONTROLS', 'LID_USAGE', 'TRANSECTS', 'STREETS', 'INLETS', 'INLET_USAGE',
    'CONTROLS', 'INFLOWS', 'DWF', 'POLLUTANTS', 'LANDUSES', 'COVERAGES', 'LOADINGS', 'BUILDUP', 'WASHOFF', 'TREATMENT', 'PATTERNS', 'EVENTS', 'GROUPS', 'PROFILES', 'BACKDROP', 'MAP']);
  const RAW_GROUPS = [
    ['Climatology', [['TEMPERATURE', 'Temperature'], ['EVAPORATION', 'Evaporation'], ['ADJUSTMENTS', 'Adjustments']]],
    ['Hydrology', [['AQUIFERS', 'Aquifers'], ['GROUNDWATER', 'Groundwater'], ['SNOWPACKS', 'Snow Packs'], ['HYDROGRAPHS', 'Unit Hydrographs (RDII)'], ['RDII', 'RDII Assignments'], ['LID_CONTROLS', 'LID Controls'], ['LID_USAGE', 'LID Usage']]],
    ['Hydraulics (other)', [['TRANSECTS', 'Transects'], ['STREETS', 'Streets'], ['INLETS', 'Inlets'], ['INLET_USAGE', 'Inlet Usage'], ['CONTROLS', 'Control Rules'], ['INFLOWS', 'External Inflows'], ['DWF', 'Dry Weather Flow']]],
    ['Quality', [['POLLUTANTS', 'Pollutants'], ['LANDUSES', 'Land Uses'], ['COVERAGES', 'Coverages'], ['LOADINGS', 'Initial Loadings'], ['BUILDUP', 'Buildup'], ['WASHOFF', 'Washoff'], ['TREATMENT', 'Treatment']]],
    ['Patterns & Files', [['PATTERNS', 'Time Patterns'], ['FILES', 'Interface Files']]],
  ];

  class Panels {
    constructor(app) { this.app = app; this.open = new Set(['Hydraulics', 'Nodes', 'Links', 'Hydrology']); }

    // ------------------------------------------------------------------ tree
    refreshTree() {
      const m = this.app.model, el = AV.$('#tree'); el.innerHTML = '';
      const count = (ty) => ty === 'SUBCATCH' ? m.subcatchments.size : ty === 'GAGE' ? m.gages.size : AV.NODE_TYPES.includes(ty) ? [...m.nodes.values()].filter(n => n.type === ty).length : [...m.links.values()].filter(l => l.type === ty).length;
      const counts = {}; for (const n of m.nodes.values()) counts[n.type] = (counts[n.type] || 0) + 1; for (const l of m.links.values()) counts[l.type] = (counts[l.type] || 0) + 1;
      const cnt = (ty) => ty === 'SUBCATCH' ? m.subcatchments.size : ty === 'GAGE' ? m.gages.size : (counts[ty] || 0);
      const root = h('div', { class: 'tree' });
      const group = (label, kids, depth = 0) => {
        const isOpen = this.open.has(label);
        const ch = h('div', { class: 'tchildren' + (isOpen ? ' open' : '') }, kids);
        const tw = h('span', { class: 'tw' }, isOpen ? '▾' : '▸');
        const n = h('div', { class: 'tnode', style: { paddingLeft: (8 + depth * 14) + 'px', fontWeight: depth ? 400 : 600 }, onclick: () => { const o = ch.classList.toggle('open'); tw.textContent = o ? '▾' : '▸'; o ? this.open.add(label) : this.open.delete(label); } }, tw, label);
        return h('div', null, n, ch);
      };
      const leaf = (label, fn, depth, c) => h('div', { class: 'tnode', style: { paddingLeft: (22 + depth * 14) + 'px' }, onclick: fn }, label, c !== undefined ? h('span', { class: 'cnt' }, String(c)) : null);
      const tbl = (ty, depth) => leaf(TYPE_LABEL[ty], () => AV.openTable(this.app, ty), depth, cnt(ty));
      const raw = (sec, label, depth) => leaf(label, () => AV.openSectionEditor(this.app, sec, label), depth, (m.raw[sec] || []).filter(l => l.trim() && !l.trim().startsWith(';')).length || undefined);
      root.appendChild(leaf('Title / Notes', () => this.editTitle(), 0));
      root.appendChild(group('Options', [leaf('Simulation Options', () => this.app.sim.optionsDialog(), 1)]));
      root.appendChild(group('Climatology', ['Temperature', 'Evaporation', 'Wind Speed', 'Snow Melt', 'Areal Depletion', 'Adjustments'].map(t => leaf(t, () => AV.climatologyEditor(this.app, t), 1))));
      const dataRows = (sec) => (m.raw[sec] || []).filter(l => l.trim() && !l.trim().startsWith(';'));
      const names = (sec, col) => new Set(dataRows(sec).map(l => AV.tokenize(l)[col || 0])).size || undefined;
      const ed = (label, fn, c) => leaf(label, fn, 1, c);
      root.appendChild(group('Hydrology', [
        ed('Rain Gages', () => AV.rainGageEditor(this.app), m.gages.size || undefined), ed('Aquifers', () => AV.aquiferEditor(this.app), names('AQUIFERS')),
        ed('Snow Packs', () => AV.snowPackEditor(this.app), names('SNOWPACKS')), ed('Unit Hydrographs', () => AV.unitHydrographEditor(this.app), names('HYDROGRAPHS')),
        ed('LID Controls', () => AV.lidEditor(this.app), names('LID_CONTROLS'))]));
      root.appendChild(group('Hydraulics', [
        ed('Transects', () => AV.transectEditor(this.app), dataRows('TRANSECTS').filter(l => /^\s*X1/i.test(l)).length || undefined),
        ed('Controls', () => AV.controlEditor(this.app), dataRows('CONTROLS').filter(l => /^\s*RULE\s/i.test(l)).length || undefined),
        ed('Streets', () => AV.sectionTableEditor(this.app, 'STREETS'), dataRows('STREETS').length || undefined), ed('Inlets', () => AV.sectionTableEditor(this.app, 'INLETS'), dataRows('INLETS').length || undefined),
        ed('Inlet Usage', () => AV.sectionTableEditor(this.app, 'INLET_USAGE'), dataRows('INLET_USAGE').length || undefined)]));
      root.appendChild(group('Quality', [ed('Pollutants', () => AV.pollutantEditor(this.app), names('POLLUTANTS')), ed('Land Uses', () => AV.landUseEditor(this.app), names('LANDUSES'))]));
      root.appendChild(group('Curves', Object.keys(AV.CURVE_GROUPS).map(g => ed(AV.CURVE_GROUPS[g], () => AV.curveTypeEditor(this.app, g), [...m.curves.values()].filter(c => g === 'PUMP' ? /^PUMP/.test(c.type || '') : (c.type || '') === g).length || undefined))));
      root.appendChild(leaf('Time Series', () => AV.timeSeriesEditor(this.app), 0, m.timeseries.size || undefined));
      root.appendChild(leaf('Time Patterns', () => AV.patternEditor(this.app), 0, names('PATTERNS')));
      const other = Object.keys(m.raw).filter(s => !KNOWN_RAW.has(s) && dataRows(s).length);
      if (other.length) root.appendChild(group('Other Sections', other.map(s => raw(s, s === 'FILES' ? 'Interface Files' : s, 1))));
      el.appendChild(root);
      this.app.updateTitle();
    }
    async editTitle() {
      const r = await AV.formDialog('Title / Notes', [{ k: 'title', l: 'Project title and notes', t: 'textarea', rows: 10 }], { title: this.app.model.title.join('\n') }, { width: 560 });
      if (r === null) return;
      const old = this.app.model.title, nw = r.title.split('\n');
      this.app.exec({ label: 'Edit title', do: () => this.app.model.title = nw, undo: () => this.app.model.title = old });
    }

    // ------------------------------------------------------------------ layers
    refreshLayers() {
      const el = AV.$('#layers'); el.innerHTML = '';
      const map = this.app.map;
      const row = (name, key, color) => h('div', { class: 'layer' },
        h('input', { type: 'checkbox', checked: map.layerVis[key], onchange: (e) => { map.layerVis[key] = e.target.checked; map.redraw(); } }),
        h('span', { class: 'swatch', style: { background: color } }), h('span', { class: 'lname' }, name),
        h('button', { class: 'lbtn', title: 'Attribute table', onclick: () => AV.openTable(this.app, { gages: 'GAGE', subcatchments: 'SUBCATCH', links: 'CONDUIT', nodes: 'JUNCTION' }[key] || 'JUNCTION') }, '☷'),
        h('button', { class: 'lbtn', title: 'Render style', onclick: () => this.app.theme.dialog({ gages: 'node', subcatchments: 'sub', links: 'link', nodes: 'node', labels: 'node' }[key]) }, '✎'));
      el.appendChild(h('div', { style: { padding: '3px 8px', color: 'var(--muted)', fontSize: '11px' } }, 'Network'));
      el.appendChild(row('Labels', 'labels', '#37474f'));
      el.appendChild(row('Nodes', 'nodes', '#1e88e5'));
      el.appendChild(row('Links', 'links', '#546e7a'));
      el.appendChild(row('Subcatchments', 'subcatchments', '#66bb6a'));
      if (map.extLayers.length) el.appendChild(h('div', { style: { padding: '6px 8px 3px', color: 'var(--muted)', fontSize: '11px' } }, 'External layers'));
      map.extLayers.forEach((L, i) => {
        el.appendChild(h('div', { class: 'layer' },
          h('input', { type: 'checkbox', checked: L.visible, onchange: (e) => { L.visible = e.target.checked; map.redraw(); } }),
          h('span', { class: 'swatch', style: { background: L.stroke } }), h('span', { class: 'lname', title: L.path }, L.name + ' (' + L.features.length + ')'),
          h('button', { class: 'lbtn', title: 'Zoom to layer', onclick: () => map.zoomToBox({ x1: L.bbox[0], y1: L.bbox[1], x2: L.bbox[2], y2: L.bbox[3] }) }, '⌖'),
          h('button', { class: 'lbtn', title: 'Style', onclick: () => this.layerStyle(L) }, '✎'),
          L.editable ? h('button', { class: 'lbtn', title: 'Draw features', onclick: () => this.app.feat.startDraw(L) }, '\u270D') : null,
          L.editable ? h('button', { class: 'lbtn', title: 'Export as shapefile', onclick: () => this.app.feat.exportLayer(L) }, '\u21E9') : null,
          h('button', { class: 'lbtn', title: 'Move up', onclick: () => { if (i > 0) { map.extLayers.splice(i, 1); map.extLayers.splice(i - 1, 0, L); this.refreshLayers(); map.redraw(); } } }, '↑'),
          h('button', { class: 'lbtn', title: 'Remove', onclick: () => { map.extLayers.splice(i, 1); this.refreshLayers(); map.redraw(); } }, '✕')));
      });
    }
    async layerStyle(L) {
      const r = await AV.formDialog('Layer Style - ' + L.name, [
        { k: 'stroke', l: 'Line color', t: 'text' }, { k: 'fill', l: 'Fill color (rgba)', t: 'text' }, { k: 'width', l: 'Line width', t: 'num' },
        { k: 'opacity', l: 'Opacity (0-1)', t: 'num' }, { k: 'order', l: 'Draw', t: 'choice', o: [['below', 'Below network'], ['above', 'Above network']] }], L);
      if (!r) return; Object.assign(L, r); this.refreshLayers(); this.app.map.redraw();
    }

    // ------------------------------------------------------------------ properties
    markFilterRow(key) { AV.$$('#props tr[data-key]').forEach(tr => tr.classList.toggle('logfilter', tr.dataset.key === key)); }
    // property grid with collapsible groups (General / sub-groups / Statistic Results), like the Avaris DS Property Browser
    _pgrid() {
      const app = this.app; const C = this.pcollapsed || (this.pcollapsed = new Set());
      const tbl = h('table', { class: 'pgrid' }); let g0 = null, g1 = null;
      const hide = () => { for (const tr of tbl.rows) { const k0 = tr.dataset.g0, k1 = tr.dataset.g1; const hid = (k0 && C.has(k0) && !tr.classList.contains('pg0')) || (k1 && C.has(k1) && !tr.classList.contains('pg1')); tr.style.display = hid ? 'none' : ''; } };
      const head = (label, lvl) => { const key = lvl + ':' + label; if (lvl === 0) { g0 = key; g1 = null; } else g1 = key;
        const tw = h('span', { class: 'gtw' }, C.has(key) ? '▸' : '▾');
        const tr = h('tr', { class: 'pg' + lvl }, h('td', { colspan: 2 }, tw, label)); tr.dataset.g0 = g0 || ''; if (lvl) tr.dataset.g1 = key;
        tr.addEventListener('click', () => { C.has(key) ? C.delete(key) : C.add(key); tw.textContent = C.has(key) ? '▸' : '▾'; hide(); }); tbl.appendChild(tr); };
      const endSub = () => { g1 = null; };
      const row = (label, input, key, title) => {
        const tr = tbl.appendChild(h('tr', { class: g1 ? 'sub' : '' }, h('td', { class: 'k', title: (title || label) + (key ? '\n(click to filter the change log by this variable)' : '') }, label), h('td', { class: 'v' }, input)));
        tr.dataset.g0 = g0 || ''; if (g1) tr.dataset.g1 = g1;
        if (key) { tr.dataset.key = key; if (app.hist && app.hist.filterKey === key) tr.classList.add('logfilter'); tr.addEventListener('mousedown', () => { if (!app.hist) return; tr._was = app.hist.filterKey === key; if (!tr._was) app.hist.setFilter(key); }); tr.querySelector('td.k').addEventListener('click', () => { if (app.hist && tr._was) app.hist.setFilter(key); }); }
        return tr; };
      // rows of AV.propLayout, opening / closing sub-groups as the 'sg' label changes
      const layout = (rows, objs) => { let sg = null;
        for (const f of rows) { if (objs.length > 1 && f.t === 'dlg') continue;
          if ((f.sg || null) !== sg) { sg = f.sg || null; if (sg) head(sg, 1); else endSub(); }
          row(f.l, AV.propInput(app, f, objs), f.t === 'dlg' ? null : f.k, f.title); }
        endSub(); };
      return { tbl, head, row, endSub, layout, hide };
    }
    showProps() {
      const el = AV.$('#props'); const sc = el.parentElement ? el.parentElement.scrollTop : 0; el.innerHTML = '';
      const sel = [...this.app.selection];
      AV.$('#propSub').textContent = sel.length > 1 ? sel.length + ' selected' : '';
      if (!sel.length) { el.appendChild(h('div', { class: 'empty' }, 'Select an object on the map', h('br'), 'or in an attribute table to view and edit its properties.')); this.modelSummary(el); return; }
      if (sel.length > 1) return this.multiProps(el, sel);
      const o = sel[0];
      if (o.kind === 'LABEL') { el.appendChild(h('div', { class: 'phead' }, h('div', { class: 'pt' }, 'Map Label'), h('div', { class: 'ps' }, o.text))); return; }
      const app = this.app, m = app.model;
      const typeName = o.kind === 'NODE' || o.kind === 'LINK' ? o.type : o.kind;
      el.appendChild(h('div', { class: 'phead' }, h('div', { class: 'pt' }, (TYPE_LABEL[typeName] || typeName).replace(/s$/, '').replace(/Storage Unit/, 'Storage Unit') + ' ' + o.id), h('div', { class: 'ps' }, o.kind === 'LINK' ? o.from + ' → ' + o.to : o.kind === 'NODE' ? 'X ' + AV.fmt(o.x, 2) + '   Y ' + AV.fmt(o.y, 2) : '')));
      const G = this._pgrid(); const { tbl, head, row } = G;
      const txt = (val, onSet, attrs = {}) => {
        const i = h('input', Object.assign({ type: 'text', value: val === undefined || val === null ? '' : String(val) }, attrs));
        i.addEventListener('change', () => onSet(i.value, i));
        i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
        return i;
      };
      head('General', 0);
      row('Name', txt(o.id, (v, i) => {
        v = v.trim(); if (!v || v === o.id) { i.value = o.id; return; }
        if (/\s/.test(v)) { AV.toast('IDs cannot contain spaces.', true); i.value = o.id; return; }
        if (m.idExists(v)) { AV.toast('ID "' + v + '" already exists.', true); i.value = o.id; return; }
        const old = o.id; app.exec({ label: 'Rename', do: () => m.renameObject(o, v), undo: () => m.renameObject(o, old), changes: [{ o, key: 'id', old, nw: v }] });
      }), 'id');
      row('Tag', txt(o.tag, (v) => app.setProps([o], 'tag', [v])), 'tag');
      row('Description', AV.propInput(app, { k: 'desc', l: 'Description', t: 'text' }, [o]), 'desc');
      if (o.kind === 'LINK') {
        const setEnd = (k) => (v, i) => { v = v.trim(); if (!m.nodes.has(v)) { AV.toast('Node "' + v + '" not found.', true); i.value = o[k]; return; } const old = o[k]; app.exec({ label: 'Reconnect', do: () => o[k] = v, undo: () => o[k] = old, changes: [{ o, key: k, old, nw: v }] }); };
        row('Upstream Node', txt(o.from, setEnd('from')), 'from'); row('Downstream Node', txt(o.to, setEnd('to')), 'to');
      }
      G.layout(AV.propLayout(app, o), [o]);
      // map position and computed values (OsemCM additions)
      const ro = (label, val) => row(label, h('div', { class: 'ro' }, val));
      if (o.kind === 'NODE' || o.kind === 'GAGE') {
        const setXY = (k) => (v, i) => { const x = parseFloat(v); if (!isFinite(x)) { i.value = o[k]; return; } const old = o[k]; app.exec({ label: 'Move', do: () => o[k] = x, undo: () => o[k] = old, changes: [{ o, key: k, old, nw: x }] }); };
        const mu = AV.unitText(m, 'map'); row('X-Coordinate' + (mu ? ' (' + mu + ')' : ''), txt(+o.x.toFixed(3), setXY('x')), 'x'); row('Y-Coordinate' + (mu ? ' (' + mu + ')' : ''), txt(+o.y.toFixed(3), setXY('y')), 'y');
      }
      if (o.kind === 'LINK' && o.type === 'CONDUIT') {
        const s = AV.conduitSlope(m, o); ro('Slope (%)', s === null ? '-' : AV.fmt(s * 100, 4));
        ro('Map Length (' + app.mapUnitsLabel() + ')', AV.fmt(m.linkLengthGeom(o), 2));
      }
      if (o.kind === 'SUBCATCH' && o.poly.length > 2) { const a = app.tools.areaFromPoly(o.poly); ro('Polygon Area (' + (m.isSI ? 'ha' : 'ac') + ')', a === null ? '-' : AV.fmt(a, 3)); }
      // statistic results from the report summary tables (like Avaris DS)
      const SG = app.results ? AV.statGroups(app, o) : [];
      if (SG.length) { head('Statistic Results', 0); for (const [g, rows] of SG) { head(g, 1); for (const [l, v] of rows) { const tr = row(l, h('div', { class: 'ro' }, v === undefined || v === null ? '-' : String(v))); tr.classList.add('st'); } } G.endSub(); }
      G.hide();
      el.appendChild(tbl);
      this.datalists(el);
      if (app.results) app.sim.resultsCard(el, o);
      if (el.parentElement) el.parentElement.scrollTop = sc;
    }
    // id suggestion lists for outlet / gage / curve / series fields: built once per model change, kept outside the
    // property grid so selecting objects does not rebuild thousands of <option>s
    datalists() {
      const m = this.app.model;
      const key = [m.nodes.size, m.links.size, m.subcatchments.size, m.gages.size, m.curves.size, m.timeseries.size, m.geomVersion || 0].join(',');
      let host = AV.$('#dlHost'); if (!host) { host = h('div', { id: 'dlHost', style: { display: 'none' } }); document.body.appendChild(host); }
      if (this._dlModel === m && this._dlKey === key) return;
      this._dlModel = m; this._dlKey = key; host.innerHTML = '';
      const el = host;
      const dl = (id, items) => { const d = h('datalist', { id }); let i = 0; for (const x of items) { if (i++ > 5000) break; d.appendChild(h('option', { value: x })); } el.appendChild(d); };
      dl('dl-outlet', [...m.nodes.keys(), ...m.subcatchments.keys()]); dl('dl-gage', m.gages.keys()); dl('dl-curve', m.curves.keys()); dl('dl-series', m.timeseries.keys()); dl('dl-divLink', m.links.keys());
    }
    // property editor for one field over one or more objects of the same type ("*Multiple Values" when they differ)
    fieldInput(f, objs) {
      const app = this.app, m = app.model;
      const vals = objs.map(o => AV.getField(m, o, f.k)); const same = vals.every(x => String(x) === String(vals[0]));
      const v = same ? vals[0] : undefined, mixed = !same;
      const MIX = '*Multiple Values';
      const set = (nv) => app.setProps(objs, f.k, objs.map(() => nv));
      const clean = (x) => { if (x === undefined || x === null) return ''; if (typeof x === 'number' || /^-?\d+\.\d{9,}$/.test(String(x))) { const n = +x; if (isFinite(n)) return String(+n.toPrecision(12)); } return String(x); };
      const sel = (opts) => {
        const sl = h('select', null, (mixed ? [h('option', { value: '__mixed', disabled: true }, MIX)] : []).concat(opts.map(x => Array.isArray(x) ? h('option', { value: x[0] }, x[1]) : h('option', { value: x }, x))));
        sl.value = mixed ? '__mixed' : (v === undefined || v === null ? '' : String(v));
        sl.addEventListener('change', () => { if (sl.value !== '__mixed') set(sl.value); });
        return sl;
      };
      const refMap = { series: m.timeseries, gage: m.gages, curve: m.curves };
      if (refMap[f.k] && !objs.some(o => o.kind === 'GAGE' && f.k === 'series' && o.p.source === 'FILE')) {
        const names = [...refMap[f.k].keys()]; for (const x of vals) if (x && !names.includes(x)) names.unshift(x);
        return sel([['', '(none)']].concat(names));
      }
      if (f.k === 'shape' && objs[0].kind === 'LINK') {
        const opts = f.o.slice(); for (const x of vals) if (x && !opts.includes(x)) opts.push(x);
        const sl = sel(opts.map(x => [x, (AV.XS_INFO && AV.XS_INFO[x] ? AV.XS_INFO[x][0] : x)]));
        const b = h('button', { class: 'xsbtn', title: 'Cross Section Editor', onclick: (e) => { e.stopPropagation(); AV.crossSectionEditor(app, objs); } }, '✎');
        return h('span', { class: 'xscell' }, sl, b);
      }
      if (f.t === 'choice') { const opts = f.o.slice(); for (const x of vals) if (x && !opts.includes(x)) opts.push(x); return sel(opts); }
      const i = h('input', { type: 'text', value: mixed ? '' : clean(v), placeholder: mixed ? MIX : '' });
      if (mixed) i.classList.add('mixed');
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
      i.addEventListener('change', () => {
        let nv = i.value;
        if (mixed && nv.trim() === '') return;
        if (f.t === 'num') { nv = parseFloat(nv); if (!isFinite(nv)) { AV.toast(f.l + ' must be a number.', true); i.value = mixed ? '' : clean(v); return; } }
        set(nv);
      });
      if (['outlet', 'gage', 'curve', 'series', 'divLink'].includes(f.k)) i.setAttribute('list', 'dl-' + f.k);
      return i;
    }
    // several objects selected: pick a type group and edit the properties they share
    multiProps(el, sel) {
      const app = this.app;
      const keyOf = (o) => o.kind === 'NODE' || o.kind === 'LINK' ? o.type : o.kind;
      const groups = new Map(); for (const o of sel) { const k = keyOf(o); if (k === 'LABEL') continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
      const keys = [...groups.keys()];
      if (!keys.includes(this.multiKey)) this.multiKey = keys.sort((a, b) => groups.get(b).length - groups.get(a).length)[0];
      const single = (k) => (TYPE_LABEL[k] || k).replace(/s$/, '');
      const gsel = h('select', { class: 'multisel', onchange: () => { this.multiKey = gsel.value; this.showProps(); } }, keys.map(k => h('option', { value: k }, single(k) + '(' + groups.get(k).length + ')')));
      gsel.value = this.multiKey;
      el.appendChild(h('div', { class: 'phead' }, h('div', { class: 'pt' }, sel.length + ' objects selected'), keys.length > 1 ? h('div', { class: 'ps' }, 'Choose which type to edit:') : null, gsel));
      const objs = groups.get(this.multiKey) || [];
      const tbl = h('table', { class: 'pgrid' });
      const addRow = (label, input, key) => { const tr = tbl.appendChild(h('tr', null, h('td', { class: 'k', title: label }, label), h('td', { class: 'v' }, input))); if (key) { tr.dataset.key = key; if (app.hist && app.hist.filterKey === key) tr.classList.add('logfilter'); tr.addEventListener('mousedown', () => { if (app.hist && app.hist.filterKey !== key) app.hist.setFilter(key); }); } return tr; };
      const ro = (t) => h('div', { class: 'ro mixed' }, t);
      addRow('Name', ro(objs.length > 1 ? '*Multiple Values' : objs[0].id));
      const tags = objs.map(o => o.tag || ''); const tagSame = tags.every(t => t === tags[0]);
      const ti = h('input', { type: 'text', value: tagSame ? tags[0] : '', placeholder: tagSame ? '' : '*Multiple Values' });
      ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') ti.blur(); });
      ti.addEventListener('change', () => { if (!tagSame && ti.value === '') return; app.setProps(objs, 'tag', objs.map(() => ti.value)); });
      addRow('Tag', ti, 'tag');
      const k0 = objs[0];
      const G = this._pgrid(); G.head('Common Properties', 0);
      for (const tr of [...tbl.rows]) G.tbl.appendChild(tr);
      // only fields every selected object shows (layouts can differ, e.g. outfall type)
      const lay = AV.propLayout(app, k0); const others = objs.slice(1, 200).map(o => new Set(AV.propLayout(app, o).map(f => f.k)));
      G.layout(lay.filter(f => others.every(sset => sset.has(f.k))), objs);
      G.hide();
      el.appendChild(G.tbl);
      this.datalists(el);
      el.appendChild(h('div', { style: { padding: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        h('button', { class: 'btn', onclick: () => this.app.tools.batchEdit() }, 'Batch Edit...'),
        h('button', { class: 'btn', onclick: () => AV.openTable(this.app, this.multiKey, true) }, 'Open in Table'),
        h('button', { class: 'btn', onclick: () => this.app.map.zoomToObjects(sel) }, 'Zoom To'),
        h('button', { class: 'btn danger', onclick: () => this.app.deleteSelection() }, 'Delete')));
    }
    modelSummary(el) {
      const m = this.app.model; const c = {}; for (const n of m.nodes.values()) c[n.type] = (c[n.type] || 0) + 1; for (const l of m.links.values()) c[l.type] = (c[l.type] || 0) + 1;
      const rows = [['Rain Gages', m.gages.size], ['Subcatchments', m.subcatchments.size]].concat(['JUNCTION', 'OUTFALL', 'DIVIDER', 'STORAGE', 'CONDUIT', 'PUMP', 'ORIFICE', 'WEIR', 'OUTLET'].map(t => [TYPE_LABEL[t], c[t] || 0]))
        .concat([['Curves', m.curves.size], ['Time Series', m.timeseries.size], ['Flow Units', m.flowUnits], ['Routing', m.options.FLOW_ROUTING || 'KINWAVE'], ['Threads', m.options.THREADS || '1']]);
      el.appendChild(h('div', { class: 'rescard' }, h('div', { class: 'rh' }, 'Model Summary'), h('table', null, rows.map(r => h('tr', null, h('td', null, r[0]), h('td', null, String(r[1])))))));
    }
  }
  AV.Panels = Panels;

  AV.conduitSlope = (m, l) => {
    const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) return null;
    const elevOff = (m.options.LINK_OFFSETS || 'DEPTH').toUpperCase() === 'ELEVATION';
    const z1 = elevOff ? +l.p.inOff : +a.p.elev + +l.p.inOff, z2 = elevOff ? +l.p.outOff : +b.p.elev + +l.p.outOff;
    const L = +l.p.length; if (!(L > 0)) return null;
    return (z1 - z2) / L;
  };

  // ======================================================================= Theme
  const NODE_COLORS = { JUNCTION: '#1e88e5', OUTFALL: '#2e7d32', STORAGE: '#8e24aa', DIVIDER: '#ef6c00' };
  const LINK_COLORS = { CONDUIT: '#546e7a', PUMP: '#d32f2f', ORIFICE: '#6d4c41', WEIR: '#00897b', OUTLET: '#5e35b1' };
  const CAT_PALETTE = ['#1e88e5', '#e53935', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#6d4c41', '#c0ca33', '#d81b60', '#3949ab', '#00897b', '#757575'];
  // [key, label, group]  group: S = static property, T = statistic result (whole run), D = dynamic result (current time step)
  const ATTRS = {
    node: [
      ['none', 'Default (by type)', 'S'], ['type', 'Node Type', 'S'], ['tag', 'Tag', 'S'], ['elev', 'Chamber Floor Elev.', 'S'], ['rim', 'Rim Elev.', 'S'], ['maxDepth', 'Chamber Depth', 'S'],
      ['m:0', 'Max. Depth', 'T'], ['m:1', 'Max. HGL', 'T'], ['m:full', 'Max. Depth / Chamber Depth', 'T'], ['m:4', 'Max. Total Inflow', 'T'], ['m:3', 'Max. Lateral Inflow', 'T'], ['m:5', 'Max. Flooding', 'T'], ['nc', 'Nonconvergence %', 'T'],
      ['r:0', 'Depth', 'D'], ['r:1', 'HGL', 'D'], ['r:full', 'Depth / Chamber Depth', 'D'], ['r:2', 'Volume', 'D'], ['r:3', 'Lateral Inflow', 'D'], ['r:4', 'Total Inflow', 'D'], ['r:5', 'Flooding', 'D']],
    link: [
      ['none', 'Default (by type)', 'S'], ['type', 'Link Type', 'S'], ['tag', 'Tag', 'S'], ['diam', 'Diameter / Height', 'S'], ['length', 'Length', 'S'], ['rough', 'Roughness', 'S'], ['slope', 'Slope', 'S'], ['shape', 'Cross-Section Shape', 'S'],
      ['m:0', 'Max. Flow', 'T'], ['m:1', 'Max. Depth', 'T'], ['m:2', 'Max. Velocity', 'T'], ['m:4', 'Max. Capacity', 'T'],
      ['m:sur', 'Max. Surcharge (0/1)', 'T'], ['m:surh', 'Surcharged Duration (hr)', 'T'],
      ['r:0', 'Flow', 'D'], ['r:1', 'Depth', 'D'], ['r:2', 'Velocity', 'D'], ['r:4', 'Capacity', 'D'], ['r:sur', 'Surcharge (0/1)', 'D']],
    sub: [
      ['none', 'Default', 'S'], ['tag', 'Tag', 'S'], ['area', 'Area', 'S'], ['imperv', '% Impervious', 'S'], ['width', 'Width', 'S'], ['slope', '% Slope', 'S'], ['gage', 'Rain Gage', 'S'], ['outlet', 'Outlet', 'S'],
      ['m:4', 'Max. Runoff', 'T'], ['m:0', 'Max. Rainfall', 'T'],
      ['r:0', 'Rainfall', 'D'], ['r:3', 'Infiltration', 'D'], ['r:4', 'Runoff', 'D']],
  };
  AV.THEME_ATTRS = ATTRS;

  class Theme {
    constructor(app) {
      this.app = app;
      this.cfg = { node: { attr: 'none', ramp: 'Blue-Red', classes: 5, method: 'equal', breaks: null, invert: false }, link: { attr: 'none', ramp: 'Blue-Red', classes: 5, method: 'equal', breaks: null, invert: false, widthByValue: false }, sub: { attr: 'none', ramp: 'Green-Red', classes: 5, method: 'equal', breaks: null, invert: false } };
      this.cache = {};
      this.nodeColor = (n) => this._color('node', n, NODE_COLORS[n.type]);
      this.linkColor = (l) => this._color('link', l, LINK_COLORS[l.type]);
      this.subColor = (s) => this._color('sub', s, '#66bb6a');
      this.linkWidth = (l) => {
        const base = this.app.map.linkWidth;
        const C = this.cfg.link; if (!C.widthByValue || C.attr === 'none') return base;
        const k = this._classIndex('link', l); return k < 0 ? base : base + k * 1.4;
      };
      this.flowDir = (l) => {
        const R = this.app.results; if (!R) return 1;
        const v = R.valueOf(l, 0, false); if (v === null) return 1;
        return Math.abs(v) < 1e-6 ? 0 : Math.sign(v);
      };
    }
    invalidate() { this.cache = {}; this.updateLegend(); }
    raw(layer, o) {
      const a = this.cfg[layer].attr; const R = this.app.results;
      if (a === 'none') return null;
      if (a === 'type') return o.type;
      if (a === 'tag') return o.tag || '(none)';
      if (a === 'nc') { return R && R.nonconv ? (R.nonconv.get(o.id) || 0) : null; }
      if (a.startsWith('r:') || a.startsWith('m:')) {
        if (!R) return null;
        const isMax = a[0] === 'm'; const key = a.slice(2);
        if (key === 'full') { const d = R.valueOf(o, 0, isMax); const md = +o.p.maxDepth; return d === null || !(md > 0) ? null : d / md; }
        return R.valueOf(o, +key, isMax, layer === 'link' && isMax && +key === 0);
      }
      const p = o.p;
      switch (a) {
        case 'rim': return +p.elev + (+p.maxDepth || 0);
        case 'diam': return parseFloat(p.g1);
        case 'slope': return o.type === 'CONDUIT' ? AV.conduitSlope(this.app.model, o) : null;
        case 'shape': case 'gage': case 'outlet': return p[a] || '(none)';
        default: { const v = parseFloat(p[a]); return isFinite(v) ? v : null; }
      }
    }
    isCategorical(layer) { return ['type', 'tag', 'shape', 'gage', 'outlet'].includes(this.cfg[layer].attr); }
    objects(layer) { const m = this.app.model; return layer === 'node' ? m.nodes.values() : layer === 'link' ? m.links.values() : m.subcatchments.values(); }
    _prep(layer) {
      if (this.cache[layer]) return this.cache[layer];
      const C = this.cfg[layer]; const c = { cats: null, breaks: null, colors: null };
      if (C.attr === 'none') { this.cache[layer] = c; return c; }
      if (this.isCategorical(layer)) {
        const cats = new Map(); for (const o of this.objects(layer)) { const v = this.raw(layer, o); if (v !== null && !cats.has(v)) cats.set(v, CAT_PALETTE[cats.size % CAT_PALETTE.length]); if (cats.size > 60) break; }
        c.cats = cats;
      } else {
        let breaks = C.breaks && C.method === 'manual' ? C.breaks.slice() : null;
        if (!breaks) {
          // use max-over-time values for result attributes so colors stay stable during playback
          const vals = [];
          const a = C.attr; const tmp = a.startsWith('r:') ? 'm:' + a.slice(2) : null;
          if (tmp) C.attr = tmp;
          for (const o of this.objects(layer)) { const v = this.raw(layer, o); if (v !== null && isFinite(v)) vals.push(layer === 'link' && a.startsWith('r:0') ? Math.abs(v) : v); }
          if (tmp) C.attr = a;
          if (a.endsWith(':4') && layer === 'link' || a.endsWith(':full')) breaks = [0.25, 0.5, 0.75, 1.0].slice(0, C.classes - 1);
          else if (C.method === 'quantile') breaks = AV.quantileBreaks(vals, C.classes);
          else { let mn = Infinity, mx = -Infinity; for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v; } breaks = AV.niceBreaks(mn, mx, C.classes); }
        }
        c.breaks = breaks; c.colors = AV.rampColors(C.ramp, breaks.length + 1, C.invert);
      }
      this.cache[layer] = c; return c;
    }
    _classIndex(layer, o) {
      const c = this._prep(layer); if (!c.breaks) return -1;
      let v = this.raw(layer, o); if (v === null || !isFinite(v)) return -1;
      if (layer === 'link' && this.cfg.link.attr === 'r:0') v = Math.abs(v);
      let k = 0; while (k < c.breaks.length && v >= c.breaks[k]) k++; return k;
    }
    _color(layer, o, def) {
      const C = this.cfg[layer]; if (C.attr === 'none') return def;
      const c = this._prep(layer);
      if (c.cats) { const v = this.raw(layer, o); return v === null ? '#b0bec5' : (c.cats.get(v) || '#b0bec5'); }
      const k = this._classIndex(layer, o); return k < 0 ? '#b0bec5' : c.colors[k];
    }
    label(o) { return ''; }
    tooltip(o) {
      const layer = o.kind === 'NODE' ? 'node' : o.kind === 'LINK' ? 'link' : o.kind === 'SUBCATCH' ? 'sub' : null; if (!layer) return '';
      const a = this.cfg[layer].attr; if (a === 'none') return '';
      const v = this.raw(layer, o); const name = ATTRS[layer].find(x => x[0] === a)[1];
      return name + ': ' + (typeof v === 'number' ? AV.fmt(v) : v === null ? 'n/a' : v);
    }
    updateLegend() {
      const el = AV.$('#legend'); if (!el) return; el.innerHTML = '';
      let any = false;
      for (const layer of ['node', 'link', 'sub']) {
        const C = this.cfg[layer]; if (C.attr === 'none') continue;
        const c = this._prep(layer); any = true;
        const name = ATTRS[layer].find(x => x[0] === C.attr)[1];
        el.appendChild(h('div', { class: 'lt' }, ({ node: 'Nodes', link: 'Links', sub: 'Subcatchments' })[layer] + ': ' + name));
        if (c.cats) { let i = 0; for (const [k, col] of c.cats) { if (i++ > 12) { el.appendChild(h('div', null, '...')); break; } el.appendChild(h('div', { class: 'lr' }, h('span', { class: 'lc', style: { background: col } }), String(k))); } }
        else if (c.breaks) c.colors.forEach((col, i) => {
          const lo = i === 0 ? null : c.breaks[i - 1], hi = i < c.breaks.length ? c.breaks[i] : null;
          const t = lo === null ? '< ' + AV.fmt(hi) : hi === null ? '≥ ' + AV.fmt(lo) : AV.fmt(lo) + ' – ' + AV.fmt(hi);
          el.appendChild(h('div', { class: 'lr' }, h('span', { class: 'lc', style: { background: col } }), t));
        });
      }
      el.style.display = any ? 'block' : 'none';
    }
    setAttr(layer, attr) { this.cfg[layer].attr = attr; this.cfg[layer].breaks = null; if (this.cfg[layer].method === 'manual') this.cfg[layer].method = 'equal'; this.invalidate(); this.app.map.redraw(); }
    async dialog(focus) {
      const layers = [['node', 'Nodes'], ['link', 'Links'], ['sub', 'Subcatchments']];
      const body = h('div');
      const tabs = h('div', { class: 'tabs2' }); body.appendChild(tabs);
      const pages = {}; let current = focus || 'node';
      const forms = {};
      for (const [k, label] of layers) {
        const C = this.cfg[k];
        const attr = h('select', null, ATTRS[k].map(([v, l]) => h('option', { value: v }, l))); attr.value = C.attr;
        const ramp = h('select', null, Object.keys(AV.RAMPS).map(r => h('option', { value: r }, r))); ramp.value = C.ramp;
        const classes = h('input', { type: 'number', min: 2, max: 10, value: C.classes, style: { width: '70px' } });
        const method = h('select', null, [['equal', 'Equal interval (nice)'], ['quantile', 'Quantile'], ['manual', 'Manual breaks']].map(([v, l]) => h('option', { value: v }, l))); method.value = C.method;
        const breaks = h('input', { type: 'text', value: (C.breaks || this._prep(k).breaks || []).join(', '), style: { width: '260px' } });
        const inv = h('input', { type: 'checkbox', checked: C.invert });
        const wbv = h('input', { type: 'checkbox', checked: !!C.widthByValue });
        forms[k] = { attr, ramp, classes, method, breaks, inv, wbv };
        pages[k] = h('div', { class: 'form', style: { display: k === current ? 'grid' : 'none' } },
          h('label', null, 'Color by'), attr, h('label', null, 'Color ramp'), ramp, h('label', null, 'Invert ramp'), inv,
          h('label', null, 'Classes'), classes, h('label', null, 'Classification'), method, h('label', null, 'Breaks (manual)'), breaks,
          k === 'link' ? h('label', null, 'Scale width by value') : null, k === 'link' ? wbv : null,
          h('div', { class: 'note' }, 'Result attributes need a completed run. "(result)" values follow the playback time; "Max." values are the maximum over the simulation. Breaks for result attributes are computed from the maximum values so colors stay comparable while animating.'));
        tabs.appendChild(h('div', { class: 't2' + (k === current ? ' active' : ''), onclick: (e) => { current = k; AV.$$('.t2', tabs).forEach(t => t.classList.remove('active')); e.target.classList.add('active'); for (const p in pages) pages[p].style.display = p === k ? 'grid' : 'none'; } }, label));
        body.appendChild(pages[k]);
      }
      const apply = () => {
        for (const [k] of layers) {
          const f = forms[k], C = this.cfg[k];
          const changedAttr = C.attr !== f.attr.value;
          C.attr = f.attr.value; C.ramp = f.ramp.value; C.classes = Math.max(2, Math.min(10, +f.classes.value || 5)); C.method = f.method.value; C.invert = f.inv.checked; C.widthByValue = f.wbv.checked;
          if (C.method === 'manual' && !changedAttr) C.breaks = f.breaks.value.split(/[,;\s]+/).map(parseFloat).filter(isFinite).sort((a, b) => a - b); else C.breaks = null;
        }
        this.invalidate(); this.app.map.redraw();
        for (const [k] of layers) forms[k].breaks.value = (this._prep(k).breaks || []).join(', ');
      };
      await AV.modal({ title: 'Thematic Rendering', width: 560, body, buttons: [{ label: 'Apply', onClick: () => { apply(); return false; } }, { label: 'OK', primary: true, onClick: () => { apply(); } }] }).done;
    }
  }
  AV.Theme = Theme;
})(window.AV);
