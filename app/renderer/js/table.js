// Attribute table: virtualized grid with editing, sorting, selection queries, calculator, statistics
'use strict';
(function (AV) {
  const h = AV.h;
  const ROW_H = 22;
  const ALL_TYPES = ['JUNCTION', 'OUTFALL', 'STORAGE', 'DIVIDER', 'CONDUIT', 'PUMP', 'ORIFICE', 'WEIR', 'OUTLET', 'SUBCATCH', 'GAGE'];

  // 2D cells (2D module): ground elevation and roughness can be edited; results are read only
  function meshRows(app) {
    const mesh = app.mesh2d; const objs = mesh ? mesh.cells : []; const L = AV.meshSI(app) ? 'm' : 'ft'; const K = (c) => AV.cellIndex(app, c);
    const r4 = (v) => v === null || v === undefined || !isFinite(v) ? '' : +(+v).toFixed(4);
    const cols = [{ k: 'id', l: 'ID', get: (c) => c.id, ro: true }, { k: 'x', l: 'X', get: (c) => +c.x.toFixed(3), num: true, ro: true }, { k: 'y', l: 'Y', get: (c) => +c.y.toFixed(3), num: true, ro: true },
      { k: 'elev', l: 'Ground Elev. (' + L + ')', get: (c) => c.elev, num: true, mesh: true }, { k: 'n', l: 'Roughness', get: (c) => c.n, num: true, mesh: true },
      { k: 's', l: 'Cell Size', get: (c) => c.s, num: true, ro: true }, { k: 'deg', l: 'Neighbours', get: (c) => c.deg, num: true, ro: true }];
    if (app.meshResults) cols.push({ k: '_maxdepth', l: 'Max. Depth (' + L + ') (result)', get: (c) => r4(AV.cellValue(app, K(c), 'maxdepth')), num: true, ro: true, res: true },
      { k: '_tpond', l: 'Time Ponded (hr) (result)', get: (c) => r4(AV.cellValue(app, K(c), 'tpond')), num: true, ro: true, res: true },
      { k: '_trecede', l: 'Time to Recede (hr) (result)', get: (c) => r4(AV.cellValue(app, K(c), 'trecede')), num: true, ro: true, res: true });
    if (app.meshResults && app.playMode) cols.push({ k: '_depth', l: 'Depth (' + L + ') at current time', get: (c) => r4(AV.cellValue(app, K(c), 'depth')), num: true, ro: true, res: true }, { k: '_wse', l: 'Water Surface (' + L + ') at current time', get: (c) => r4(AV.cellValue(app, K(c), 'wse')), num: true, ro: true, res: true });
    return { kind: 'MESH', cols, objs };
  }
  // imported (external) vector layers: one row per feature, columns = the layer's attribute fields
  AV.extTableId = (L) => L._tid || (L._tid = 'EXT' + (AV._extSeq = (AV._extSeq || 0) + 1));
  AV.extLayerOf = (app, type) => app.map.extLayers.find(L => L._tid === type) || null;
  function extRows(app, L) {
    const objs = L ? L.features : [];
    if (L) objs.forEach((f, i) => { f._fid = i + 1; if (!f.props) f.props = {}; });
    const names = L ? (L.fields && L.fields.length ? L.fields.slice() : [...new Set(objs.flatMap(f => Object.keys(f.props)))]) : [];
    const cols = [{ k: '_fid', l: 'FID', get: (f) => f._fid, num: true, ro: true }];
    for (const n of names) {
      let num = 0, any = 0; for (let i = 0; i < objs.length && any < 500; i++) { const v = objs[i].props[n]; if (v === null || v === undefined || v === '') continue; any++; if (typeof v === 'number' || (isFinite(+v) && String(v).trim() !== '')) num++; }
      cols.push({ k: n, l: n, get: (f) => { const v = f.props[n]; return v === undefined || v === null ? '' : v; }, num: any > 0 && num === any, ext: true });
    }
    cols.push({ k: '_geom', l: 'Geometry', get: (f) => f.type, ro: true });
    return { kind: 'EXT', cols, objs, layer: L };
  }
  AV.tableRows = function (app, type) {
    if (type === 'MESH') return meshRows(app);
    if (/^EXT/.test(type)) return extRows(app, AV.extLayerOf(app, type));
    const m = app.model; const kind = AV.NODE_TYPES.includes(type) ? 'NODE' : AV.LINK_TYPES.includes(type) ? 'LINK' : type;
    const coll = kind === 'NODE' ? m.nodes : kind === 'LINK' ? m.links : kind === 'SUBCATCH' ? m.subcatchments : m.gages;
    const objs = (kind === 'NODE' || kind === 'LINK') ? [...coll.values()].filter(o => o.type === type) : [...coll.values()];
    const cols = [{ k: 'id', l: 'ID', get: (o) => o.id, ro: false, id: true }];
    if (kind === 'LINK') cols.push({ k: 'from', l: 'From Node', get: (o) => o.from, ends: true }, { k: 'to', l: 'To Node', get: (o) => o.to, ends: true });
    if (kind === 'NODE' || kind === 'GAGE') cols.push({ k: 'x', l: 'X', get: (o) => +o.x.toFixed(3), num: true, xy: true }, { k: 'y', l: 'Y', get: (o) => +o.y.toFixed(3), num: true, xy: true });
    for (const f of AV.SCHEMA[kind === 'NODE' || kind === 'LINK' ? type : kind]) cols.push({ k: f.k, l: AV.fieldLabel(m, objs[0] || null, f), get: (o) => o.p[f.k], num: f.t === 'num', f });
    cols.push({ k: 'tag', l: 'Tag', get: (o) => o.tag || '', tag: true });
    if (type === 'CONDUIT') cols.push({ k: '_slope', l: 'Slope % (computed)', get: (o) => { const s = AV.conduitSlope(m, o); return s === null ? '' : +(s * 100).toFixed(4); }, num: true, ro: true });
    if (kind === 'NODE' && type !== 'OUTFALL') cols.push({ k: '_rim', l: 'Rim Elev. (computed)', get: (o) => +(+o.p.elev + (+o.p.maxDepth || 0)).toFixed(3), num: true, ro: true });
    const R = app.results;
    if (R && (kind === 'NODE' || kind === 'LINK' || kind === 'SUBCATCH')) {
      const t = kind === 'NODE' ? 'node' : kind === 'LINK' ? 'link' : 'subcatch';
      const vars = t === 'node' ? [[0, 'Max Depth'], [1, 'Max HGL'], [4, 'Max Inflow'], [5, 'Max Flooding']] : t === 'link' ? [[0, 'Max |Flow|', true], [2, 'Max |Velocity|', true], [4, 'Max Capacity']] : [[4, 'Max Runoff']];
      for (const [v, l, abs] of vars) cols.push({ k: '_r' + v, l: l + ' (result)', get: (o) => { const x = R.valueOf(o, v, true, abs); return x === null ? '' : +x.toFixed(4); }, num: true, ro: true, res: true });
      if (t === 'node' && R.nonconv) cols.push({ k: '_nc', l: 'Nonconverging %', get: (o) => R.nonconv.get(o.id) || 0, num: true, ro: true, res: true });
    }
    return { kind, cols, objs };
  };

  class TableView {
    constructor(app, type) {
      this.app = app; this.type = type; this.sortCol = null; this.sortDir = 1; this.filter = ''; this.selOnly = false;
      this.el = h('div', { class: 'grid-wrap' });
      this.typeSel = h('select', { onchange: () => { this.type = this.typeSel.value; this.sortCol = null; this.refresh(); } });
      this.fillTypes(); this.typeSel.value = type;
      this.filterInp = h('input', { type: 'text', placeholder: 'Filter ID...', style: { width: '130px' }, oninput: AV.debounce(() => { this.filter = this.filterInp.value.toLowerCase(); this.refresh(); }, 200) });
      this.count = h('span', { style: { color: 'var(--muted)' } });
      const B = (label, fn, title) => h('button', { class: 'btn small', onclick: fn, title }, label);
      this.selOnlyChk = h('input', { type: 'checkbox', onchange: (e) => { this.selOnly = e.target.checked; this.refresh(); } });
      this.el.appendChild(h('div', { class: 'grid-tools' }, this.typeSel, this.filterInp,
        B('Select by Attribute...', () => this.selectByAttr()), B('Select All', () => this.selMany(this.rows.objs, false)), B('Invert', () => { const s = new Set(this.rows.objs.filter(o => !this.isSel(o))); this.selMany([...s]); }),
        B('Clear', () => this.ext() ? this.selMany([], false) : this.mesh() ? AV.meshClearSel(this.app) : this.app.clearSelection()), h('label', null, this.selOnlyChk, ' Selected only'),
        B('Zoom to Selected', () => this.zoomSel()),
        B('Copy', () => this.copy(), 'Copy selected rows (or all) as tab-separated text for Excel'), B('Paste', () => this.paste(), 'Paste tab-separated rows from Excel; first column = ID, header row = column names'),
        B('Export CSV', () => this.exportCSV()), this.count));
      this.scroll = h('div', { class: 'grid-scroll' });
      this.table = h('table', { class: 'grid' }); this.thead = h('thead'); this.tbody = h('tbody'); this.table.append(this.thead, this.tbody);
      this.scroll.appendChild(this.table); this.el.appendChild(this.scroll);
      this.scroll.addEventListener('scroll', () => this.renderRows());
      new ResizeObserver(() => this.renderRows()).observe(this.scroll);
      this.refresh();
    }
    // layer list: network types, 2D meshes and the imported vector layers
    fillTypes() {
      const app = this.app; const ext = app.map.extLayers.filter(L => !L.raster && L.features);
      const opts = ALL_TYPES.map(t => [t, AV.TYPE_LABEL[t]]).concat(app.mesh2d ? [['MESH', '2D Meshes']] : []).concat(ext.map(L => [AV.extTableId(L), 'Layer: ' + L.name]));
      const key = opts.map(o => o.join('=')).join('|'); if (key === this._optKey) return; this._optKey = key;
      const cur = this.typeSel.value; this.typeSel.innerHTML = ''; for (const [v, l] of opts) this.typeSel.appendChild(h('option', { value: v }, l)); if (cur) this.typeSel.value = cur;
    }
    // ---- selection helpers (network objects, 2D cells for the 2D Meshes table, features of an imported layer)
    mesh() { return this.type === 'MESH'; }
    ext() { return /^EXT/.test(this.type); }
    extSet() { const L = this.rows && this.rows.layer; if (!L) return new Set(); return L.sel || (L.sel = new Set()); }
    isSel(o) { return this.ext() ? this.extSet().has(o) : this.mesh() ? !!(this.app.meshSelSet && this.app.meshSelSet.has(o)) : this.app.selection.has(o); }
    selMany(objs, add) { if (this.ext()) { const S = this.extSet(); if (!add) S.clear(); for (const o of objs) S.add(o); this.app.map.redraw(); this.refreshSel(); return; } if (this.mesh()) AV.meshSelect(this.app, objs, add); else this.app.selectMany(objs, add); if (this.mesh()) this.refreshSel(); }
    sel1(o, add) { if (this.ext()) { const S = this.extSet(); if (!add) S.clear(); if (add && S.has(o)) S.delete(o); else S.add(o); this.app.map.redraw(); this.refreshSel(); return; } if (this.mesh()) { if (add && this.isSel(o)) { this.app.meshSelSet.delete(o); AV.meshSelect(this.app, [], true); } else AV.meshSelect(this.app, [o], add); this.refreshSel(); } else this.app.select(o, add); }
    refreshSel() { if (this.selOnly) this.refresh(); else { this.updateSel(); this.count.textContent = this.view.length + ' of ' + this.rows.objs.length + ' rows, ' + this.rows.objs.filter(o => this.isSel(o)).length + ' selected'; } }
    zoomSel() { this.app.activateView('map');
      if (this.ext()) { const S = [...this.extSet()]; if (!S.length) { AV.toast('No features are selected.', true); return; } let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const f of S) { const pts = f.type === 'point' ? f.coords : f.coords.flat(); for (const p of pts) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); } }
        const pad = Math.max(x2 - x1, y2 - y1, 1) * 0.1; this.app.map.zoomToBox({ x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad }); return; }
      if (this.mesh()) { const S = [...(this.app.meshSelSet || [])]; if (!S.length) { AV.toast('No 2D cells are selected.', true); return; } let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const c of S) { x1 = Math.min(x1, c.x - c.s); y1 = Math.min(y1, c.y - c.s); x2 = Math.max(x2, c.x + c.s); y2 = Math.max(y2, c.y + c.s); } this.app.map.zoomToBox({ x1, y1, x2, y2 }); } else this.app.map.zoomToObjects([...this.app.selection]); }
    // set a property of objects (network: setProps with undo; 2D cells: elevation / roughness with undo, mesh file saved)
    setPropsAny(objs, key, vals) {
      if (this.ext()) { const app = this.app; const old = objs.map(f => f.props[key]); const nw = vals.slice(); const L = this.rows.layer;
        const upd = () => { if (L && L.fields && !L.fields.includes(key)) L.fields.push(key); if (L) L.dirty = true; this.refresh(); };
        app.exec({ label: 'Edit ' + (L ? L.name : 'layer') + ' (' + key + ')', do: () => { objs.forEach((f, i) => { f.props[key] = nw[i]; }); upd(); }, undo: () => { objs.forEach((f, i) => { f.props[key] = old[i]; }); upd(); } }); return; }
      if (!this.mesh()) { this.app.setProps(objs, key, vals); return; }
      const app = this.app; const old = objs.map(c => c[key]); const nw = vals.map(v => +v);
      const save = () => { const mp = AV.meshPath(app); if (mp && app.mesh2d) window.host.writeText(mp, JSON.stringify(app.mesh2d)).catch(() => {}); app._meshRange = null; app.map.redraw(); this.refresh(); };
      app.exec({ label: 'Edit 2D cells (' + key + ')', do: () => { objs.forEach((c, i) => { c[key] = nw[i]; }); save(); }, undo: () => { objs.forEach((c, i) => { c[key] = old[i]; }); save(); } });
    }
    refresh() {
      const app = this.app;
      // keep the "2D Meshes" entry in the layer list in step with the model
      const hasMeshOpt = [...this.typeSel.options].some(o => o.value === 'MESH');
      if (app.mesh2d && !hasMeshOpt) this.typeSel.appendChild(h('option', { value: 'MESH' }, '2D Meshes'));
      if (!app.mesh2d && hasMeshOpt) { [...this.typeSel.options].find(o => o.value === 'MESH').remove(); if (this.type === 'MESH') { this.type = 'JUNCTION'; this.typeSel.value = 'JUNCTION'; } }
      this._optKey = null; this.fillTypes();
      if (this.ext() && !AV.extLayerOf(app, this.type)) this.type = 'JUNCTION';   // the layer was removed
      this.typeSel.value = this.type;
      this.filterInp.placeholder = this.ext() ? 'Filter (any field)...' : 'Filter ID...';
      this.rows = AV.tableRows(app, this.type);
      let objs = this.rows.objs;
      if (this.filter) objs = this.ext() ? objs.filter(o => this.rows.cols.some(c => String(c.get(o)).toLowerCase().includes(this.filter))) : objs.filter(o => o.id.toLowerCase().includes(this.filter));
      if (this.selOnly) objs = objs.filter(o => this.isSel(o));
      if (this.sortCol) { const c = this.rows.cols.find(x => x.k === this.sortCol); if (c) { const d = this.sortDir; objs = objs.slice().sort((a, b) => { let x = c.get(a), y = c.get(b); if (c.num) { x = parseFloat(x); y = parseFloat(y); x = isFinite(x) ? x : -Infinity; y = isFinite(y) ? y : -Infinity; return (x - y) * d; } return String(x).localeCompare(String(y), undefined, { numeric: true }) * d; }); } }
      this.view = objs;
      this.thead.innerHTML = '';
      this.thead.appendChild(h('tr', null, h('th', { class: 'rowh' }, '#'), this.rows.cols.map(c => h('th', { title: c.l + (c.ro ? ' (read-only)' : '') + '\nClick to sort, right-click for statistics / calculator', onclick: () => { if (this.sortCol === c.k) this.sortDir *= -1; else { this.sortCol = c.k; this.sortDir = 1; } this.refresh(); }, oncontextmenu: (e) => { e.preventDefault(); this.colMenu(e, c); } }, c.l + (this.sortCol === c.k ? (this.sortDir > 0 ? ' ▲' : ' ▼') : '')))));
      this.count.textContent = objs.length + ' of ' + this.rows.objs.length + ' rows, ' + this.rows.objs.filter(o => this.isSel(o)).length + ' selected';
      this.renderRows(true);
    }
    renderRows() {
      if (!this.view) return;
      const top = this.scroll.scrollTop, hgt = this.scroll.clientHeight || 600;
      const first = Math.max(0, Math.floor(top / ROW_H) - 10), last = Math.min(this.view.length, Math.ceil((top + hgt) / ROW_H) + 10);
      this.tbody.innerHTML = '';
      const ncol = this.rows.cols.length + 1;
      if (first > 0) this.tbody.appendChild(h('tr', { style: { height: (first * ROW_H) + 'px' } }, h('td', { colspan: ncol, style: { padding: 0, border: 0 } })));
      for (let i = first; i < last; i++) {
        const o = this.view[i];
        const tr = h('tr', { class: this.isSel(o) ? 'sel' : '' }); tr.__obj = o;
        tr.appendChild(h('td', { class: 'rowh' }, String(i + 1)));
        for (const c of this.rows.cols) {
          const v = c.get(o);
          const td = h('td', { class: c.num ? 'num' : '' }, c.num && v !== '' ? AV.fmt(+v) : String(v === undefined || v === null ? '' : v));
          if (!c.ro && !c.res) td.addEventListener('dblclick', () => this.editCell(td, o, c));
          tr.appendChild(td);
        }
        tr.addEventListener('mousedown', (e) => { if (e.shiftKey) e.preventDefault(); });
        tr.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT') return;
          // Shift+click: select the range from the last clicked row; Ctrl+click: toggle one row
          if (e.shiftKey && this.anchor !== undefined && this.anchor < this.view.length) { const a = Math.min(this.anchor, i), b = Math.max(this.anchor, i); this.selMany(this.view.slice(a, b + 1), e.ctrlKey); return; }
          this.anchor = i; this.sel1(o, e.ctrlKey);
        });
        this.tbody.appendChild(tr);
      }
      const rest = this.view.length - last;
      if (rest > 0) this.tbody.appendChild(h('tr', { style: { height: (rest * ROW_H) + 'px' } }, h('td', { colspan: ncol, style: { padding: 0, border: 0 } })));
    }
    updateSel() { for (const tr of this.tbody.children) if (tr.__obj) tr.classList.toggle('sel', this.isSel(tr.__obj)); }
    editCell(td, o, c) {
      const old = c.get(o);
      const inp = h('input', { type: 'text', value: old === undefined ? '' : old });
      td.innerHTML = ''; td.appendChild(inp); inp.focus(); inp.select();
      const done = (commit) => {
        if (!inp.isConnected) return;
        if (commit && inp.value !== String(old)) this.setValue(o, c, inp.value);
        this.renderRows();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => done(true));
    }
    setValue(o, c, val) {
      const app = this.app, m = app.model;
      if (c.ext) { let v = val; if (c.num && val.trim() !== '') { v = parseFloat(val); if (!isFinite(v)) { AV.toast(c.l + ' must be numeric.', true); return false; } } this.setPropsAny([o], c.k, [v]); return true; }
      if (c.mesh) { const v = parseFloat(val); if (!isFinite(v) || (c.k === 'n' && !(v > 0))) { AV.toast(c.l + ' must be a ' + (c.k === 'n' ? 'positive ' : '') + 'number.', true); return false; } this.setPropsAny([o], c.k, [v]); return true; }
      if (c.id) { val = val.trim(); if (!val || /\s/.test(val) || m.idExists(val)) { AV.toast('Invalid or duplicate ID.', true); return false; } const old = o.id; app.exec({ label: 'Rename', do: () => m.renameObject(o, val), undo: () => m.renameObject(o, old) }); return true; }
      if (c.ends) { if (!m.nodes.has(val)) { AV.toast('Node ' + val + ' not found.', true); return false; } const old = o[c.k]; app.exec({ label: 'Reconnect', do: () => o[c.k] = val, undo: () => o[c.k] = old }); return true; }
      if (c.xy) { const x = parseFloat(val); if (!isFinite(x)) return false; const old = o[c.k]; app.exec({ label: 'Move', do: () => o[c.k] = x, undo: () => o[c.k] = old }); return true; }
      if (c.tag) { app.setProps([o], 'tag', [val]); return true; }
      if (c.f) {
        let v = val; if (c.f.t === 'num') { v = parseFloat(val); if (!isFinite(v)) { AV.toast(c.l + ' must be numeric.', true); return false; } }
        if (c.f.t === 'choice') { v = String(val).toUpperCase(); if (!c.f.o.includes(v)) { AV.toast('Allowed: ' + c.f.o.join(', '), true); return false; } }
        app.setProps([o], c.k, [v]); return true;
      }
      return false;
    }
    colMenu(e, c) {
      const items = [{ label: 'Sort Ascending', fn: () => { this.sortCol = c.k; this.sortDir = 1; this.refresh(); } }, { label: 'Sort Descending', fn: () => { this.sortCol = c.k; this.sortDir = -1; this.refresh(); } }, '-',
      { label: 'Statistics', fn: () => this.stats(c) }];
      if (!c.ro && !c.res && !c.id && !c.ends) items.push({ label: 'Field Calculator...', fn: () => this.calculator(c) });
      if ((c.num || c.res) && !this.ext()) items.push({ label: 'Color Map by This Field', fn: () => this.themeBy(c) });
      this.app.contextMenu(e.clientX, e.clientY, items);
    }
    themeBy(c) {
      if (this.mesh()) { const f = { elev: 'elev', _maxdepth: 'maxdepth', _tpond: 'tpond', _trecede: 'trecede', _depth: 'depth', _wse: 'wse' }[c.k]; if (!f) { AV.toast('This field is not available for map rendering.', true); return; }
        const P = this.app.prefs.mesh2d || (this.app.prefs.mesh2d = {}); if (AV.MESH_DYNAMIC[f]) P.playField = f; else P.field = f; this.app.savePrefs(); this.app._meshRange = null; this.app.activateView('map'); this.app.map.redraw(); this.app.symPane.open({ mesh: true }); return; }
      const layer = this.rows.kind === 'NODE' ? 'node' : this.rows.kind === 'LINK' ? 'link' : this.rows.kind === 'SUBCATCH' ? 'sub' : null; if (!layer) return;
      const map = { elev: 'elev', maxDepth: 'maxDepth', _rim: 'rim', g1: 'diam', length: 'length', rough: 'rough', _slope: 'slope', area: 'area', imperv: 'imperv', width: 'width', slope: 'slope', _r0: 'm:0', _r1: 'm:1', _r2: 'm:2', _r4: 'm:4', _r5: 'm:5', _nc: 'nc' };
      const a = map[c.k]; if (!a || !AV.THEME_ATTRS[layer].some(x => x[0] === a)) { AV.toast('This field is not available for map rendering.', true); return; }
      this.app.theme.setAttr(layer, a); this.app.activateView('map');
    }
    stats(c) {
      const objs = this.rows.objs.some(o => this.isSel(o)) ? this.rows.objs.filter(o => this.isSel(o)) : this.rows.objs;
      const vals = objs.map(o => parseFloat(c.get(o))).filter(isFinite);
      if (!vals.length) { AV.alert('No numeric values in this column.'); return; }
      const n = vals.length, sum = vals.reduce((a, b) => a + b, 0), mean = sum / n, sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
      AV.alert(`Field: ${c.l}\nRows: ${objs.length === this.rows.objs.length ? 'all' : 'selected'} (${n} numeric)\n\nMinimum: ${AV.fmt(Math.min(...vals))}\nMaximum: ${AV.fmt(Math.max(...vals))}\nMean: ${AV.fmt(mean)}\nSum: ${AV.fmt(sum)}\nStd. deviation: ${AV.fmt(sd)}`, 'Statistics');
    }
    async calculator(c) {
      const keys = this.rows.cols.filter(x => x.num).map(x => x.k.replace(/^_/, ''));
      const r = await AV.formDialog('Field Calculator - ' + c.l, [{ k: 'expr', l: c.k + ' =', t: 'text', w: 300 }, { k: 'scope', l: 'Rows', t: 'choice', o: [['sel', 'Selected rows'], ['all', 'All rows']], d: this.rows.objs.some(o => this.isSel(o)) ? 'sel' : 'all' },
      { t: 'note', l: 'Use + - * / ^ ( ), numbers and numeric field names: ' + keys.join(', ') + '. Text fields: enter a literal value.' }], { expr: '' });
      if (!r || r.expr === '') return;
      const objs = r.scope === 'sel' ? this.rows.objs.filter(o => this.isSel(o)) : this.rows.objs;
      let fn = null;
      if (c.num) {
        const safe = /^[\w\s+\-*/().^]+$/.test(r.expr) && r.expr.split(/[^A-Za-z_]+/).filter(Boolean).every(w => keys.includes(w) || /^e$/i.test(w));
        if (!safe) { AV.alert('Invalid expression. Use numbers, operators and numeric field names only.'); return; }
        const numCols = this.rows.cols.filter(x => x.num);
        fn = (o) => { const env = {}; for (const col of numCols) env[col.k.replace(/^_/, '')] = parseFloat(col.get(o)) || 0; return Function(...Object.keys(env), 'return (' + r.expr.replace(/\^/g, '**') + ');')(...Object.values(env)); };
      }
      const key = c.k; const tagCol = !!c.tag;
      const vals = objs.map(o => fn ? fn(o) : r.expr);
      if (fn && vals.some(v => !isFinite(v))) { if (!await AV.confirm('Some results are not finite numbers and will be skipped. Continue?')) return; }
      const pairs = objs.map((o, i) => [o, vals[i]]).filter(([, v]) => !fn || isFinite(v));
      this.setPropsAny(pairs.map(p => p[0]), tagCol ? 'tag' : key, pairs.map(p => fn && c.f && c.f.t !== 'num' ? String(+(+p[1]).toFixed(6)) : (fn ? +(+p[1]).toFixed(6) : p[1])));
      AV.toast(pairs.length + ' value(s) updated.');
    }
    async selectByAttr() {
      const t = this.type;
      if (this.ext()) return this.extSelectByAttr();
      if (t === 'MESH') { // numeric condition on the cell columns, e.g.  elev < 60 and maxdepth > 0.3
        const cols = this.rows.cols.filter(x => x.num); const keys = cols.map(x => x.k.replace(/^_/, ''));
        const r = await AV.formDialog('Select by Attribute - 2D Meshes', [{ k: 'expr', l: 'Where', t: 'text', w: 340 }, { k: 'mode', l: 'Selection', t: 'choice', o: [['new', 'New selection'], ['add', 'Add to selection'], ['sub', 'Select from current selection']], d: 'new' },
          { t: 'note', l: 'Fields: ' + keys.join(', ') + '. Operators: < <= > >= = != and or not ( ) + - * /. Example: maxdepth > 0.3 and elev < 60' }], { expr: this._meshWhere || '' });
        if (!r || !r.expr.trim()) return; this._meshWhere = r.expr;
        const src = r.expr.replace(/\band\b/gi, '&&').replace(/\bor\b/gi, '||').replace(/\bnot\b/gi, '!').replace(/([^<>!=])=([^=])/g, '$1==$2');
        if (!/^[\w\s+\-*/().<>=!&|]+$/.test(src) || src.split(/[^A-Za-z_]+/).filter(Boolean).some(w => !keys.includes(w))) { AV.alert('Invalid condition. Use the numeric field names listed and comparison operators only.'); return; }
        let fn; try { fn = Function(...keys, 'return (' + src + ');'); } catch (e) { AV.alert('Invalid condition: ' + e.message); return; }
        const pool = r.mode === 'sub' ? this.rows.objs.filter(o => this.isSel(o)) : this.rows.objs;
        const hit = pool.filter(o => { try { return !!fn(...cols.map(x => parseFloat(x.get(o)))); } catch (e) { return false; } });
        this.selMany(hit, r.mode === 'add'); AV.toast(hit.length + ' cell(s) selected.'); return; } const kind = t === 'SUBCATCH' ? 'sub' : AV.NODE_TYPES.includes(t) ? 'node' : AV.LINK_TYPES.includes(t) ? 'link' : null;
      if (!kind) { AV.toast('Select by Attribute is available for nodes, links and subcatchments.', true); return; }
      await AV.selectByAttribute(this.app, { kind, kindFixed: true, objs: this.rows.objs, zoom: false });
    }
    // imported layer: condition on its fields, e.g.  DIAMETER >= 24 and MATERIAL = 'RCP'
    async extSelectByAttr() {
      const cols = this.rows.cols.filter(c => c.ext); const ids = cols.map(c => c.k.replace(/\W/g, '_').replace(/^(\d)/, '_$1'));
      const r = await AV.formDialog('Select by Attribute - ' + this.rows.layer.name, [{ k: 'expr', l: 'Where', t: 'text', w: 340 }, { k: 'mode', l: 'Selection', t: 'choice', o: [['new', 'New selection'], ['add', 'Add to selection'], ['sub', 'Select from current selection']], d: 'new' },
        { t: 'note', l: 'Fields: ' + ids.join(', ') + '. Operators: < <= > >= = != and or not ( ) + - * /; text in quotes. Example: ' + (ids[0] || 'FIELD') + " > 10" }], { expr: this._extWhere || '' });
      if (!r || !r.expr.trim()) return; this._extWhere = r.expr;
      const strs = []; let src = r.expr.replace(/'([^']*)'|"([^"]*)"/g, (m, a, b) => { strs.push(a !== undefined ? a : b); return ' __s' + (strs.length - 1) + ' '; });
      src = src.replace(/\band\b/gi, '&&').replace(/\bor\b/gi, '||').replace(/\bnot\b/gi, '!').replace(/([^<>!=])=([^=])/g, '$1==$2').replace(/<>/g, '!=');
      const words = src.split(/[^A-Za-z_0-9]+/).filter(w => w && !/^\d/.test(w));
      if (!/^[\w\s+\-*/().<>=!&|]+$/.test(src) || words.some(w => !ids.includes(w) && !/^__s\d+$/.test(w))) { AV.alert('Invalid condition. Use the field names listed, numbers, quoted text and comparison operators only.'); return; }
      let fn; try { fn = Function(...ids, ...strs.map((_, i) => '__s' + i), 'return (' + src + ');'); } catch (e) { AV.alert('Invalid condition: ' + e.message); return; }
      const pool = r.mode === 'sub' ? this.rows.objs.filter(o => this.isSel(o)) : this.rows.objs;
      const hit = pool.filter(o => { try { return !!fn(...cols.map(c => { const v = c.get(o); return c.num && v !== '' ? +v : v; }), ...strs); } catch (e) { return false; } });
      this.selMany(hit, r.mode === 'add'); AV.toast(hit.length + ' feature(s) selected.');
    }
    copy() {
      const objs = this.view.some(o => this.isSel(o)) ? this.view.filter(o => this.isSel(o)) : this.view;
      const cols = this.rows.cols;
      const text = [cols.map(c => c.k).join('\t')].concat(objs.map(o => cols.map(c => { const v = c.get(o); return v === undefined || v === null ? '' : String(v); }).join('\t'))).join('\n');
      navigator.clipboard.writeText(text).then(() => AV.toast(objs.length + ' row(s) copied.'));
    }
    async paste() {
      if (this.ext()) { AV.toast('Paste is available for network layers; edit imported layer values by double-clicking a cell or with the Field Calculator.', true); return; }
      let text = ''; try { text = await navigator.clipboard.readText(); } catch (e) { AV.alert('Clipboard not accessible.'); return; }
      const lines = text.split(/\r?\n/).filter(l => l.trim()); if (lines.length < 2) { AV.alert('Paste needs a header row (column keys or labels) and at least one data row, with the object ID in the first column.'); return; }
      const hdr = lines[0].split('\t').map(s => s.trim()); const cols = hdr.map(k => this.rows.cols.find(c => c.k === k || c.l === k));
      const byId = new Map(this.rows.objs.map(o => [o.id, o]));
      const changes = new Map(); let n = 0, miss = 0;
      for (const line of lines.slice(1)) {
        const t = line.split('\t'); const o = byId.get(t[0].trim()); if (!o) { miss++; continue; }
        cols.forEach((c, i) => { if (!i || !c || (c.ro && !c.mesh) || c.res || c.id) return; const v = (t[i] || '').trim(); if (!changes.has(c)) changes.set(c, []); changes.get(c).push([o, v]); n++; });
      }
      for (const [c, list] of changes) {
        if (c.mesh) { const ok = list.filter(x => isFinite(parseFloat(x[1]))); if (ok.length) this.setPropsAny(ok.map(x => x[0]), c.k, ok.map(x => parseFloat(x[1]))); }
        else if (c.tag) this.app.setProps(list.map(x => x[0]), 'tag', list.map(x => x[1]));
        else if (c.f) this.app.setProps(list.map(x => x[0]), c.k, list.map(x => c.f.t === 'num' ? (isFinite(parseFloat(x[1])) ? parseFloat(x[1]) : x[0].p[c.k]) : x[1]));
        else if (c.xy || c.ends) for (const [o, v] of list) this.setValue(o, c, v);
      }
      AV.toast(n + ' value(s) pasted' + (miss ? ', ' + miss + ' row(s) with unknown ID skipped' : '') + '.');
    }
    exportCSV() {
      const cols = this.rows.cols; const lines = [cols.map(c => AV.csvCell(c.l)).join(',')].concat(this.view.map(o => cols.map(c => AV.csvCell(c.get(o))).join(',')));
      AV.downloadText(lines.join('\n'), (this.type === 'MESH' ? '2d_meshes' : this.ext() ? String(this.rows.layer ? this.rows.layer.name : 'layer').replace(/\.\w+$/, '').replace(/\W+/g, '_') : this.type.toLowerCase()) + '.csv');
    }
  }

  AV.openTable = function (app, type, selOnly) {
    const v = app.views.get('table');
    if (v && v.table) { v.table.type = type; v.table.fillTypes(); v.table.typeSel.value = type; v.table.sortCol = null; if (selOnly) { v.table.selOnly = true; v.table.selOnlyChk.checked = true; } v.table.refresh(); app.activateView('table'); return; }
    const t = new TableView(app, type);
    if (selOnly) { t.selOnly = true; t.selOnlyChk.checked = true; t.refresh(); }
    const view = app.addView('table', 'Attribute Table', t.el, { onShow: () => t.refresh() });
    view.table = t;
  };
  AV.refreshTables = function (app) { const v = app.views.get('table'); if (v && v.table && app.activeView === 'table') v.table.refresh(); };
  AV.syncTableSelection = function (app) { const v = app.views.get('table'); if (v && v.table && v.table.view) v.table.refreshSel(); };
})(window.AV);
