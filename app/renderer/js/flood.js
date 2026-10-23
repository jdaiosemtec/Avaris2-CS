// 2D Flood Analysis (Simulation ▸ Results ▸ 2D Flood Analysis, 2D licence): summary of the 2D results of the mesh.
//   - key figures (flooded area, max depth / velocity, hazard, earliest arrival)
//   - area by depth class and by hazard class (Defra FD2320 hazard rating, see mesh2d.js)
//   - statistics per zone (polygons of an imported / drawn layer) or per point (cell under each point)
//   - difference against another 1D-2D run of the same mesh (max depth difference, newly flooded cells)
//   - exports: flood extent / classes as polygons (shapefile), ASCII grid of a field, cells CSV
//   - 2D cross section: a line drawn on the map, ground / max water surface / current water surface along it
'use strict';
(function (AV) {
  const h = AV.h;
  const pip = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) ins = !ins; } return ins; };
  const inParts = (x, y, parts) => { let k = 0; for (const r of parts) if (pip(x, y, r)) k++; return k % 2 === 1; };
  const fin = (v) => v !== null && v !== undefined && isFinite(v);

  // area of a cell in model units² and the display unit (ha / ac)
  function areaInfo(app) { const lf = app.mesh2d.lenFactor || 1; const si = AV.meshSI(app); return { cell: (c) => (c.s * lf) * (c.s * lf), k: si ? 1e-4 : 1 / 43560, u: si ? 'ha' : 'ac' }; }

  // ---------------------------------------------------------------- polygons from cells (dissolve)
  // Every cell gives its 4 edges counter-clockwise; an edge shared by two selected cells appears in both directions and
  // cancels. The remaining edges are chained into rings: counter-clockwise = outer, clockwise = hole. Shapefile rings are
  // written outer clockwise / holes counter-clockwise, so the rings are reversed.
  AV.cellsToRings = function (cells) {
    const q = (v) => Math.round(v * 1000); const E = new Map(); const key = (a, b) => a + '|' + b;
    const add = (a, b) => { const r = key(b, a); if (E.has(r)) E.delete(r); else E.set(key(a, b), [a, b]); };
    for (const c of cells) { const hs = c.s / 2; const p = [[c.x - hs, c.y - hs], [c.x + hs, c.y - hs], [c.x + hs, c.y + hs], [c.x - hs, c.y + hs]].map(([x, y]) => q(x) + ',' + q(y));
      for (let i = 0; i < 4; i++) add(p[i], p[(i + 1) % 4]); }
    const from = new Map(); for (const [k, [a, b]] of E) { let l = from.get(a); if (!l) from.set(a, l = []); l.push(b); }
    const rings = [];
    for (const [start, l] of from) while (l.length) { const ring = [start]; let cur = l.pop(); let guard = 0;
      while (cur !== start && guard++ < 1e7) { ring.push(cur); const n = from.get(cur); if (!n || !n.length) break; cur = n.pop(); }
      if (ring.length >= 3) { const pts = ring.map(s => s.split(',').map(v => +v / 1000)); pts.push(pts[0].slice()); rings.push(pts.reverse()); } }
    return rings;
  };

  class FloodView {
    constructor(app) { this.app = app; this.S = Object.assign({ zoneLayer: '', zoneField: '' }, app.prefs.flood2d || {}); }
    open() {
      const app = this.app;
      if (!AV.has2D(app)) { AV.need2D(app, '2D Flood Analysis'); return; }
      if (!app.mesh2d) { AV.alert('There is no 2D mesh in this model (Simulation ▸ Create Meshes).', '2D Flood Analysis'); return; }
      if (!app.meshResults) { AV.alert('Run the 1D-2D model or load its results (.fout) first.', '2D Flood Analysis'); return; }
      if (!this.el) { this.el = h('div', { class: 'csoview fldview' }); app.addView('flood2d', '2D Flood Analysis', this.el, { onClose: () => { this.el = null; } }); if (!this._off) this._off = app.on('meshresults', () => this.el && this.render()); }
      else app.activateView('flood2d');
      if (this.S.thr === undefined) this.S.thr = app.meshResults.thr > 0 ? app.meshResults.thr : AV.meshDefaultBreaks(app, 'maxdepth')[0];
      this.render();
    }
    save() { this.app.prefs.flood2d = this.S; this.app.savePrefs && this.app.savePrefs(); }
    // figures of the whole mesh
    summary() {
      const app = this.app, MR = app.meshResults, cells = app.mesh2d.cells, A = areaInfo(app), thr = this.S.thr;
      const s = { cells: 0, wet: 0, area: 0, total: 0, maxd: 0, maxv: 0, maxhr: 0, danger: 0, arrive: Infinity, vol: 0 };
      const db = AV.meshDefaultBreaks(app, 'maxdepth'); const P = app.prefs.mesh2d || {}; const dB = (P.classes && P.classes.maxdepth && P.classes.maxdepth.map(c => +c.v)) || db;
      const byD = dB.map(() => 0); const byH = AV.HAZARD_CLASSES.map(() => 0); let lowA = 0;
      for (let k = 0; k < cells.length; k++) { if (MR.idx[k] < 0) continue; const a = A.cell(cells[k]); s.cells++; s.total += a; const d = MR.maxd[k]; if (!(d >= thr) || !(d > 0)) continue;
        s.wet++; s.area += a; s.maxd = Math.max(s.maxd, d); if (fin(MR.maxv[k])) s.maxv = Math.max(s.maxv, MR.maxv[k]); const hr = MR.maxhr[k]; if (fin(hr)) { s.maxhr = Math.max(s.maxhr, hr); if (hr >= 0.75) s.danger += a; }
        if (fin(MR.arrive[k])) s.arrive = Math.min(s.arrive, MR.arrive[k]); s.vol += a * d;
        let ci = -1; for (let i = dB.length - 1; i >= 0; i--) if (d >= dB[i]) { ci = i; break; } if (ci >= 0) byD[ci] += a; else lowA += a;
        if (fin(hr)) for (let i = 0; i < AV.HAZARD_CLASSES.length; i++) if (hr < AV.HAZARD_CLASSES[i][0]) { byH[i] += a; break; } }
      return Object.assign(s, { dB, byD, byH, A, lowA: thr < dB[0] ? lowA : undefined });
    }
    // statistics of the cells inside each polygon of a layer (or under each point)
    zones() {
      const app = this.app, MR = app.meshResults, cells = app.mesh2d.cells, A = areaInfo(app), thr = this.S.thr; const L = this.layer(); if (!L) return null;
      const name = (f, i) => this.S.zoneField && f.props && f.props[this.S.zoneField] !== undefined ? String(f.props[this.S.zoneField]) : String(i + 1);
      const out = [];
      if (L.kind === 'point') { L.features.forEach((f, i) => { for (const p of f.coords) { const k = AV.meshHit(app.map, p[0], p[1]); if (k < 0) { out.push({ f, name: name(f, i), none: true }); continue; }
          const d = MR.maxd[k]; out.push({ f, name: name(f, i), cell: cells[k].id, area: A.cell(cells[k]), wet: d >= thr && d > 0 ? A.cell(cells[k]) : 0, maxd: d, meand: d, maxv: MR.maxv[k], maxhr: MR.maxhr[k], arrive: MR.arrive[k], tpond: MR.tpond[k] }); } }); return out; }
      if (L.kind !== 'polygon') return null;
      L.features.forEach((f, i) => { const b = f.bbox || [-Infinity, -Infinity, Infinity, Infinity]; const z = { f, name: name(f, i), area: 0, wet: 0, maxd: 0, sd: 0, maxv: 0, maxhr: 0, arrive: Infinity, tpond: 0, n: 0 };
        for (let k = 0; k < cells.length; k++) { const c = cells[k]; if (c.x < b[0] || c.x > b[2] || c.y < b[1] || c.y > b[3] || MR.idx[k] < 0 || !inParts(c.x, c.y, f.coords)) continue;
          const a = A.cell(c); z.area += a; z.n++; const d = MR.maxd[k]; if (!(d >= thr) || !(d > 0)) continue; z.wet += a; z.sd += d * a; z.maxd = Math.max(z.maxd, d);
          if (fin(MR.maxv[k])) z.maxv = Math.max(z.maxv, MR.maxv[k]); if (fin(MR.maxhr[k])) z.maxhr = Math.max(z.maxhr, MR.maxhr[k]); if (fin(MR.arrive[k])) z.arrive = Math.min(z.arrive, MR.arrive[k]); if (fin(MR.tpond[k])) z.tpond = Math.max(z.tpond, MR.tpond[k]); }
        z.meand = z.wet ? z.sd / z.wet : NaN; if (!isFinite(z.arrive)) z.arrive = NaN; out.push(z); });
      return out;
    }
    layers() { return (this.app.map.extLayers || []).filter(L => !L.raster && (L.kind === 'polygon' || L.kind === 'point') && L.features && L.features.length); }
    layer() { return this.layers().find(L => L.name === this.S.zoneLayer) || null; }

    render() {
      const E = this.el; if (!E) return; E.innerHTML = ''; const app = this.app, MR = app.meshResults; if (!MR) { E.appendChild(h('div', { class: 'hint', style: { padding: '12px' } }, 'No 2D results.')); return; }
      const S = this.S; const L = AV.meshSI(app) ? 'm' : 'ft', V = AV.meshUnit(app, 'vel');
      const thrIn = h('input', { type: 'number', value: S.thr, step: 'any', min: 0, style: { width: '64px' }, onchange: (e) => { S.thr = Math.max(0, +e.target.value || 0); this.save(); this.render(); } });
      const dfSel = h('select', { title: 'Debris factor of the hazard rating', onchange: async () => { app.prefs.mesh2d = app.prefs.mesh2d || {}; app.prefs.mesh2d.df = dfSel.value; app.savePrefs && app.savePrefs(); await AV.computeMeshResults(app); app.map.redraw(); this.render(); } },
        Object.entries(AV.HAZARD_DF).map(([k, o]) => h('option', { value: k, title: o.label }, o.short))); dfSel.value = (app.prefs.mesh2d && AV.HAZARD_DF[app.prefs.mesh2d.df]) ? app.prefs.mesh2d.df : 'conservative';
      const exp = h('select', { title: 'Export', style: { width: '96px' }, onchange: () => { const v = exp.value; exp.value = ''; if (v) this.exportAs(v); } },
        h('option', { value: '' }, 'Export…'), h('option', { value: 'extent' }, 'Flood extent (shapefile)'), h('option', { value: 'dclass' }, 'Depth classes (shapefile)'), h('option', { value: 'hclass' }, 'Hazard classes (shapefile)'),
        h('option', { value: 'grid' }, 'Raster grid of a field (.asc)'), h('option', { value: 'cells' }, 'Cell results (CSV)'), h('option', { value: 'zones' }, 'Zone statistics (CSV)'));
      E.appendChild(h('div', { class: 'cmpbar' }, h('label', { title: 'A cell is counted as flooded when its max. depth reaches this value' }, 'Flooded at depth ≥ ', thrIn, ' ' + L), h('label', null, 'Debris factor ', dfSel),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn small', title: 'Draw a line on the map: ground and water surface along it', onclick: () => AV.crossSection2D(app) }, 'Cross Section'),
        h('button', { class: 'btn small', title: 'Max depth difference against another 1D-2D run of the same mesh', onclick: () => this.compare() }, MR.cmp ? 'vs. ' + MR.cmp.name : 'Compare…'), exp));
      const s = this.summary(); const A = s.A; const fa = (v) => AV.fmt(v * A.k, v * A.k < 10 ? 3 : 1);
      const kp = [['Flooded area (' + A.u + ')', fa(s.area) + '  (' + AV.fmt(s.total ? 100 * s.area / s.total : 0, 1) + '%)'], ['Flooded cells', s.wet + ' / ' + s.cells], ['Max. depth (' + L + ')', AV.fmt(s.maxd, 3)],
        ['Max. velocity (' + V + ')', AV.fmt(s.maxv, 3)], ['Max. hazard rating', AV.fmt(s.maxhr, 2) + (s.maxhr > 0 ? ' ' + AV.hazardClass(s.maxhr) : '')], ['Area HR ≥ 0.75 (' + A.u + ')', fa(s.danger)],
        ['Earliest arrival (hr)', isFinite(s.arrive) ? AV.fmt(s.arrive, 2) : '–']];
      E.appendChild(h('div', { class: 'cmpkpis' }, kp.map(([l, v]) => h('div', { class: 'cmpkpi neutral' }, h('div', { class: 'kl' }, l), h('div', { class: 'kv' }, h('span', { class: 'kc' }, v))))));
      // class tables with bars
      const S0 = AV.meshStyle(Object.assign(Object.create(app), { playMode: false, prefs: Object.assign({}, app.prefs, { mesh2d: Object.assign({}, app.prefs.mesh2d, { field: 'maxdepth' }) }) }));
      const bar = (a, tot, col) => h('div', { class: 'fldbar' }, h('span', { style: { width: (tot ? Math.max(0.5, 100 * a / tot) : 0) + '%', background: col } }));
      const dRows = (s.lowA !== undefined ? [['#e3f2fd', AV.fmt(this.S.thr) + ' – ' + AV.fmt(s.dB[0]) + ' ' + L, s.lowA]] : []).concat(s.dB.map((b, i) => [S0.colors && S0.colors[i] ? S0.colors[i] : '#1e88e5', (i < s.dB.length - 1 ? AV.fmt(b) + ' – ' + AV.fmt(s.dB[i + 1]) : '≥ ' + AV.fmt(b)) + ' ' + L, s.byD[i]]));
      const hCols = AV.RAMPS['Flood Hazard']; const hRows = AV.HAZARD_CLASSES.map(([b, l], i) => [hCols[i], (i ? AV.fmt(AV.HAZARD_CLASSES[i - 1][0]) : '0') + (isFinite(b) ? ' – ' + AV.fmt(b) : '+') + '  ' + l, s.byH[i]]);
      const ctab = (title, rows, note) => h('div', { class: 'csopane' }, h('div', { class: 'psec2' }, title), h('div', { class: 'ptwrap', style: { flex: 'none', minHeight: 0 } }, h('table', { class: 'ptbl csotbl' },
        h('tr', null, h('th', null, ''), h('th', null, 'Class'), h('th', null, 'Area (' + A.u + ')'), h('th', null, '% of flooded'), h('th', { style: { width: '22%' } }, '')),
        rows.map(([c, l, a]) => h('tr', null, h('td', null, h('span', { class: 'fldsw', style: { background: c } })), h('td', null, l), h('td', { class: 'num' }, fa(a)), h('td', { class: 'num' }, AV.fmt(s.area ? 100 * a / s.area : 0, 1)), h('td', null, bar(a, s.area, c)))))),
        note ? h('div', { class: 'hint', style: { padding: '4px 2px' } }, note) : null);
      const left = h('div', { class: 'csopane' }, ctab('Area by max. depth', dRows, 'Classes of the Max. Depth ranges of the 2D Meshes layer (Symbology). Arrival time and hazard use the Flood Depth Threshold of Options → 2D Flood (' + AV.fmt(MR.thr) + ' ' + L + ').'),
        ctab('Area by max. hazard rating', hRows, 'HR = d × (v + 0.5) + DF (Defra/EA FD2320), ' + (AV.HAZARD_DF[dfSel.value] || AV.HAZARD_DF.conservative).label.toLowerCase() + '.'),
        MR.cmp ? this.cmpPane(A, fa) : null);
      // zones
      const lays = this.layers(); const zl = h('select', { onchange: () => { S.zoneLayer = zl.value; S.zoneField = ''; this.save(); this.render(); } }, h('option', { value: '' }, lays.length ? '(choose a layer)' : '(no polygon / point layer)'), lays.map(L2 => h('option', { value: L2.name }, L2.name + ' (' + L2.kind + ')')));
      zl.value = this.layer() ? S.zoneLayer : ''; const Ly = this.layer();
      const zf = h('select', { onchange: () => { S.zoneField = zf.value; this.save(); this.render(); } }, h('option', { value: '' }, '(feature number)'), (Ly && Ly.fields ? Ly.fields : []).map(f => h('option', { value: f }, f))); zf.value = S.zoneField || '';
      const Z = Ly ? this.zones() : null; this.Z = Z;
      const f2 = (v, d) => fin(v) ? AV.fmt(v, d) : '–';
      const ztab = Z ? h('table', { class: 'ptbl csotbl' }, h('tr', null, ['Zone', Ly.kind === 'point' ? 'Cell' : 'Area (' + A.u + ')', 'Flooded (' + A.u + ')', '%', 'Max. depth (' + L + ')', 'Mean depth (' + L + ')', 'Max. vel. (' + V + ')', 'Max. HR', 'Arrival (hr)', 'Ponded (hr)'].map(t => h('th', null, t))),
        Z.map(z => h('tr', { class: z.wet ? '' : 'dim', title: 'Double-click: zoom to the zone', ondblclick: () => this.zoomTo(z.f) }, h('td', null, z.name), h('td', { class: Ly.kind === 'point' ? '' : 'num' }, Ly.kind === 'point' ? (z.cell || 'outside the mesh') : fa(z.area)), h('td', { class: 'num' }, z.none ? '–' : fa(z.wet)),
          h('td', { class: 'num' }, z.area ? AV.fmt(100 * z.wet / z.area, 1) : '–'), h('td', { class: 'num' }, z.wet ? f2(z.maxd, 3) : '–'), h('td', { class: 'num' }, z.wet ? f2(z.meand, 3) : '–'), h('td', { class: 'num' }, z.wet ? f2(z.maxv, 3) : '–'),
          h('td', { class: 'num' }, z.wet ? f2(z.maxhr, 2) : '–'), h('td', { class: 'num' }, z.wet ? f2(z.arrive, 2) : '–'), h('td', { class: 'num' }, z.wet ? f2(z.tpond, 2) : '–')))) : null;
      const right = h('div', { class: 'csopane' }, h('div', { class: 'psec2' }, 'Statistics by zone / point'),
        h('div', { class: 'dwfrow', style: { marginBottom: '6px' } }, 'Layer ', zl, ' Name field ', zf, Z ? h('button', { class: 'btn small', onclick: () => this.exportAs('zones') }, 'Export CSV') : null),
        h('div', { class: 'ptwrap' }, ztab || h('div', { class: 'hint', style: { padding: '8px' } }, 'Choose a polygon layer (e.g. property boundaries, catchments, a study area) or a point layer (e.g. buildings, receptors) imported with Add Data or drawn with New Layer. Polygons: cells whose centre is inside. Points: the cell under the point.')));
      E.appendChild(h('div', { class: 'csobody' }, left, right));
    }
    cmpPane(A, fa) {
      const app = this.app, MR = app.meshResults, C = MR.cmp, thr = this.S.thr, cells = app.mesh2d.cells; let nw = 0, dr = 0, up = 0, dn = 0, inc = -Infinity, dec = Infinity, both = 0;
      for (let k = 0; k < cells.length; k++) { if (MR.idx[k] < 0 || !fin(C.maxd[k])) continue; const a = A.cell(cells[k]); const d1 = MR.maxd[k] || 0, d0 = C.maxd[k] || 0; const w1 = d1 >= thr && d1 > 0, w0 = d0 >= thr && d0 > 0;
        if (w1 && !w0) nw += a; else if (w0 && !w1) dr += a; else if (w0 && w1) both += a; const dd = d1 - d0; if (w0 || w1) { inc = Math.max(inc, dd); dec = Math.min(dec, dd); if (dd > thr) up += a; else if (dd < -thr) dn += a; } }
      const L = AV.meshSI(app) ? 'm' : 'ft'; const f = (v) => isFinite(v) ? AV.fmt(v, 3) : '–';
      return h('div', { class: 'csopane' }, h('div', { class: 'psec2' }, 'Difference: this run − ' + C.name),
        h('div', { class: 'ptwrap', style: { flex: 'none', minHeight: 0 } }, h('table', { class: 'ptbl csotbl' }, [['Newly flooded (' + A.u + ')', fa(nw)], ['No longer flooded (' + A.u + ')', fa(dr)], ['Flooded in both (' + A.u + ')', fa(both)],
          ['Deeper by more than ' + AV.fmt(thr) + ' ' + L + ' (' + A.u + ')', fa(up)], ['Shallower by more than ' + AV.fmt(thr) + ' ' + L + ' (' + A.u + ')', fa(dn)], ['Largest increase (' + L + ')', f(inc)], ['Largest decrease (' + L + ')', f(dec)]]
          .map(([a, b]) => h('tr', null, h('td', null, a), h('td', { class: 'num' }, b))))),
        h('div', { class: 'dwfrow', style: { marginTop: '6px' } }, h('button', { class: 'btn small primary', onclick: () => { const P = app.prefs.mesh2d || (app.prefs.mesh2d = {}); P.field = 'ddepth'; app.savePrefs && app.savePrefs(); app._meshRange = null; app.activateView('map'); app.map.redraw(); app.symPane.open({ mesh: true }); } }, 'Show Difference on Map'),
          h('button', { class: 'btn small', onclick: () => { MR.cmp = null; const P = app.prefs.mesh2d || {}; if (P.field === 'ddepth') P.field = 'maxdepth'; app.map.redraw(); this.render(); } }, 'Clear Comparison')));
    }
    zoomTo(f) { const b = f.bbox; if (!b) return; const app = this.app; app.activateView('map'); const pad = Math.max(b[2] - b[0], b[3] - b[1], 1) * 0.3; app.map.zoomToBox({ x1: b[0] - pad, y1: b[1] - pad, x2: b[2] + pad, y2: b[3] + pad }); }
    // ---- comparison with another run of the same mesh
    async compare() {
      const app = this.app, MR = app.meshResults, R = app.results; const runs = app.filePath ? (await AV.listRuns(app.filePath)).filter(r => r.out && r.is2D) : [];
      const curF = String(R.outFile || (R.meta && R.meta.file) || '').toLowerCase(); const opts = runs.filter(r => r.out.toLowerCase() !== curF).map(r => [r.out, r.name]); opts.push(['__file', 'Other results file (.fout)…']);
      const r = await AV.formDialog('Compare 2D Results', [{ k: 'run', l: 'Compare this run with', t: 'choice', o: opts, d: opts[0][0] }, { t: 'note', l: 'The other run must use the same 2D mesh (cells are matched by ID). Difference = this run − the other run.' }], {});
      if (!r) return; let file = r.run, name = (opts.find(o => o[0] === r.run) || [])[1];
      if (file === '__file') { file = await window.host.openDialog({ title: 'Results of the other run', filters: [{ name: '1D-2D results', extensions: ['fout', 'out'] }] }); if (!file) return; name = AV.basename(file).replace(/\.\w+$/, ''); }
      let meta = null; try {
        meta = await window.host.outOpen(file); const ni = new Map(meta.ids.node.map((id, i) => [id, i])); const cells = app.mesh2d.cells;
        const idx = cells.map(c => { const i = ni.get(c.id); return i === undefined ? -1 : i; }); if (!idx.some(i => i >= 0)) { AV.alert('The 2D cells of this model are not in ' + name + '.', 'Compare 2D Results'); return; }
        const st = await AV.busy.track(window.host.outMesh2d(meta.handle, idx, [], [], MR.thr, MR.siK, MR.df), 'Reading the 2D results of ' + name);
        MR.cmp = { name, file, maxd: st.maxd };
      } catch (e) { AV.alert('Cannot read ' + file + ': ' + e.message, 'Compare 2D Results'); return; }
      finally { if (meta) window.host.outClose(meta.handle); }
      app._meshRange = null; app.map.redraw(); this.render();
    }
    // ---- exports
    async exportAs(what, opts = {}) {
      const app = this.app, MR = app.meshResults, mesh = app.mesh2d, cells = mesh.cells, thr = this.S.thr; const base0 = app.filePath ? AV.basename(app.filePath).replace(/\.inp$/i, '') : 'model';
      const writeShp = async (feats, fields, def) => { const p = await window.host.saveDialog({ title: 'Export', defaultPath: def, filters: [{ name: 'Shapefile', extensions: ['shp'] }] }); if (!p) return;
        const w = AV.SHP.write('polygon', feats, fields); const b = p.replace(/\.shp$/i, ''); await window.host.writeBinary(b + '.shp', new Uint8Array(w.shp)); await window.host.writeBinary(b + '.shx', new Uint8Array(w.shx)); await window.host.writeBinary(b + '.dbf', new Uint8Array(w.dbf));
        if (app.crsWKT) await window.host.writeText(b + '.prj', app.crsWKT); AV.toast('Exported ' + feats.length + ' polygon feature(s) to ' + b + '.shp'); };
      const A = areaInfo(app);
      const group = (fn, labels) => { const G = labels.map(() => []); cells.forEach((c, k) => { if (MR.idx[k] < 0) return; const g = fn(k); if (g >= 0) G[g].push(c); });
        return G.map((cs, i) => cs.length ? { coords: AV.cellsToRings(cs), props: Object.assign({ class: labels[i], cells: cs.length, area: +(cs.reduce((a, c) => a + A.cell(c), 0) * A.k).toFixed(4) }) } : null).filter(Boolean); };
      const fields = [{ name: 'class', type: 'C', len: 40 }, { name: 'cells', type: 'N', len: 12, dc: 0 }, { name: 'area', type: 'N', len: 18, dc: 4 }];
      if (what === 'extent') { const F = group(k => MR.maxd[k] >= thr && MR.maxd[k] > 0 ? 0 : -1, ['Max depth >= ' + thr]); if (!F.length) { AV.toast('No flooded cell.', true); return; } return writeShp(F, fields, base0 + '_flood_extent.shp'); }
      if (what === 'dclass') { const B = this.summary().dB; const lab = B.map((b, i) => i < B.length - 1 ? b + ' - ' + B[i + 1] : '>= ' + b);
        return writeShp(group(k => { const d = MR.maxd[k]; if (!(d >= thr) || !(d > 0)) return -1; for (let i = B.length - 1; i >= 0; i--) if (d >= B[i]) return i; return -1; }, lab), fields, base0 + '_depth_classes.shp'); }
      if (what === 'hclass') { const lab = AV.HAZARD_CLASSES.map(c => c[1]);
        return writeShp(group(k => { const hr = MR.maxhr[k]; if (!(MR.maxd[k] >= thr) || !fin(hr) || !(hr > 0)) return -1; for (let i = 0; i < AV.HAZARD_CLASSES.length; i++) if (hr < AV.HAZARD_CLASSES[i][0]) return i; return -1; }, lab), fields, base0 + '_hazard_classes.shp'); }
      if (what === 'grid') {
        const keys = AV.MESH_GROUPS.flatMap(g => g[1]).filter(k => k !== 'ddepth' || MR.cmp);
        const r = await AV.formDialog('Export Raster Grid', [{ k: 'f', l: 'Field', t: 'choice', o: keys.filter(k => !AV.MESH_DYNAMIC[k] || app.playMode).map(k => [k, AV.MESH_FIELDS[k] + (AV.MESH_DYNAMIC[k] ? ' (time step ' + app.results.timeLabel(app.results.period) + ')' : '')]), d: 'maxdepth' },
          { k: 'fmt', l: 'Format', t: 'choice', o: [['tif', 'GeoTIFF (.tif)'], ['asc', 'ESRI ASCII grid (.asc)']], d: 'tif' },
          { t: 'note', l: 'Cell size = the finest mesh cells, map coordinates. Dry / outside cells = -9999 (no data).' }], { f: opts.field || 'maxdepth' }); if (!r) return;
        return AV.exportMeshRaster(app, r.f, r.fmt, base0);
      }
      if (what === 'cells') {
        const F = AV.MESH_GROUPS.flatMap(g => g[1]).filter(k => !AV.MESH_DYNAMIC[k] && k !== 'elev' && (k !== 'ddepth' || MR.cmp));
        const L2 = ['id,x,y,elev,' + F.join(',') + ',hazard_class']; cells.forEach((c, k) => { const v = F.map(f => { const x = AV.cellValue(app, k, f); return fin(x) ? +(+x).toPrecision(6) : ''; }); const hr = MR.maxhr[k]; L2.push([c.id, c.x, c.y, c.elev].concat(v, hr > 0 ? AV.hazardClass(hr) : '').join(',')); });
        return AV.downloadText(L2.join('\r\n') + '\r\n', base0 + '_2d_cells.csv', [{ name: 'CSV', extensions: ['csv'] }]);
      }
      if (what === 'zones') { const Z = this.zones(); if (!Z) { AV.toast('Choose a zone layer first.', true); return; } const q = (s) => /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s); const g = (v, d) => fin(v) ? (+v).toFixed(d) : '';
        const L2 = ['zone,cell,area_' + A.u + ',flooded_' + A.u + ',max_depth,mean_depth,max_velocity,max_hazard,arrival_hr,ponded_hr'];
        for (const z of Z) L2.push([q(z.name), z.cell || '', g(z.area * A.k, 5), g(z.wet * A.k, 5), z.wet ? g(z.maxd, 4) : '', z.wet ? g(z.meand, 4) : '', z.wet ? g(z.maxv, 4) : '', z.wet ? g(z.maxhr, 3) : '', z.wet ? g(z.arrive, 3) : '', z.wet ? g(z.tpond, 3) : ''].join(','));
        return AV.downloadText(L2.join('\r\n') + '\r\n', base0 + '_zone_flood_statistics.csv', [{ name: 'CSV', extensions: ['csv'] }]); }
    }
  }

  // raster of a mesh field at the finest cell size (map units): G[row * nc + col], row 0 = top, -9999 = no data
  AV.meshRaster = function (app, field) {
    const cells = app.mesh2d.cells; let s0 = Infinity, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cells) { s0 = Math.min(s0, c.s); x0 = Math.min(x0, c.x - c.s / 2); y0 = Math.min(y0, c.y - c.s / 2); x1 = Math.max(x1, c.x + c.s / 2); y1 = Math.max(y1, c.y + c.s / 2); }
    const nc = Math.max(1, Math.round((x1 - x0) / s0)), nr = Math.max(1, Math.round((y1 - y0) / s0)); const G = new Float32Array(nc * nr).fill(-9999);
    const dry = !/^(elev|maxwse|wse|ddepth)$/.test(field);
    cells.forEach((c, k) => { const v = AV.cellValue(app, k, field); if (!fin(v)) return; if (dry && !(v > 0)) return;
      const i0 = Math.round((c.x - c.s / 2 - x0) / s0), j0 = Math.round((y1 - (c.y + c.s / 2)) / s0), n = Math.max(1, Math.round(c.s / s0));
      for (let j = j0; j < j0 + n && j < nr; j++) for (let i = i0; i < i0 + n && i < nc; i++) G[j * nc + i] = v; });
    return { nc, nr, x0, y0, y1, s0, G };
  };
  // ESRI ASCII grid
  AV.meshGrid = function (app, field) {
    const { nc, nr, x0, y0, s0, G } = AV.meshRaster(app, field);
    const out = ['ncols ' + nc, 'nrows ' + nr, 'xllcorner ' + x0, 'yllcorner ' + y0, 'cellsize ' + s0, 'NODATA_value -9999'];
    for (let j = 0; j < nr; j++) { const row = new Array(nc); for (let i = 0; i < nc; i++) { const v = G[j * nc + i]; row[i] = v === -9999 ? '-9999' : String(+v.toPrecision(6)); } out.push(row.join(' ')); }
    return out.join('\n') + '\n';
  };
  // EPSG code of a WKT (the AUTHORITY / ID of the outer CRS), or 0
  AV.wktEPSG = (wkt) => { const m = /(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]\s*\]\s*$/i.exec(String(wkt || '').trim()); return m ? +m[1] : 0; };
  // GeoTIFF (single band Float32, uncompressed, strips of 16 rows, little endian). geographic: CRS in degrees.
  //   CRS: EPSG GeoKey when the WKT has an EPSG code; the full WKT is written in the .aux.xml (read by GDAL / QGIS / ArcGIS).
  AV.writeGeoTIFF = function (R, epsg, geographic) {
    const { nc, nr, x0, y1, s0, G } = R; const RPS = 16, ns = Math.ceil(nr / RPS);
    const keys = [[1024, 0, 1, geographic ? 2 : 1], [1025, 0, 1, 1]]; if (epsg) keys.push([geographic ? 2048 : 3072, 0, 1, epsg]);
    const gk = [1, 1, 0, keys.length].concat(...keys); const nod = '-9999\0';
    // entries: tag, type, count, value(s)   types: 3 SHORT, 4 LONG, 12 DOUBLE, 2 ASCII
    const E = [[256, 4, 1, [nc]], [257, 4, 1, [nr]], [258, 3, 1, [32]], [259, 3, 1, [1]], [262, 3, 1, [1]], [273, 4, ns, null], [277, 3, 1, [1]], [278, 4, 1, [RPS]], [279, 4, ns, null],
      [284, 3, 1, [1]], [339, 3, 1, [3]], [33550, 12, 3, [s0, s0, 0]], [33922, 12, 6, [0, 0, 0, x0, y1, 0]], [34735, 3, gk.length, gk], [42113, 2, nod.length, nod]];
    const sz = { 2: 1, 3: 2, 4: 4, 12: 8 }; const ifdLen = 2 + E.length * 12 + 4; let extra = 8 + ifdLen; const ext = [];
    for (const e of E) { const n = e[2] * sz[e[1]]; if (n > 4) { e.off = extra; extra += n + (n % 2); } }
    const dataOff = (extra + 3) & ~3; const strip = (k) => Math.min(RPS, nr - k * RPS) * nc * 4; const offs = [], cnts = []; let o = dataOff; for (let k = 0; k < ns; k++) { offs.push(o); cnts.push(strip(k)); o += strip(k); }
    E[5][3] = offs; E[8][3] = cnts;
    const buf = new ArrayBuffer(o); const dv = new DataView(buf); const u8 = new Uint8Array(buf);
    u8[0] = 0x49; u8[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, 8, true); dv.setUint16(8, E.length, true);
    const put = (p, t, v) => { if (t === 3) dv.setUint16(p, v, true); else if (t === 4) dv.setUint32(p, v, true); else if (t === 12) dv.setFloat64(p, v, true); else if (t === 2) dv.setUint8(p, v.charCodeAt ? v.charCodeAt(0) : v); };
    E.forEach((e, i) => { const p = 10 + i * 12; dv.setUint16(p, e[0], true); dv.setUint16(p + 2, e[1], true); dv.setUint32(p + 4, e[2], true); const vals = e[1] === 2 ? [...e[3]] : e[3];
      const base = e.off !== undefined ? e.off : p + 8; if (e.off !== undefined) dv.setUint32(p + 8, e.off, true); vals.forEach((v, k) => put(base + k * sz[e[1]], e[1], v)); });
    dv.setUint32(10 + E.length * 12, 0, true);
    new Float32Array(buf, dataOff, nc * nr).set(G);
    return new Uint8Array(buf);
  };
  // ---------------------------------------------------------------- 2D cross section
  AV.crossSection2D = function (app) {
    if (!app.mesh2d || !app.meshResults) { AV.toast('Run the 1D-2D model first.', true); return; }
    app.activateView('map'); app.feat.drawLayer = null; app.feat.onDrawHook = (pts) => AV.showCrossSection2D(app, pts);
    app.setTool('draw-ext'); app.map.drawGeom = 'line'; app.map.setHint('2D cross section: click the vertices of the line; double-click or Enter to finish. Esc to cancel.');
  };
  AV.showCrossSection2D = function (app, pts) {
    const mesh = app.mesh2d, MR = app.meshResults, lf = mesh.lenFactor || 1; let s0 = Infinity; for (const c of mesh.cells) s0 = Math.min(s0, c.s); const step = s0 / 4;
    const samp = []; let ch = 0;
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(L / step));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) { const t = k / n; samp.push({ x: a[0] + t * (b[0] - a[0]), y: a[1] + t * (b[1] - a[1]), ch: (ch + t * L) * lf }); } ch += L; }
    for (const s of samp) s.k = AV.meshHit(app.map, s.x, s.y);
    app._xsec2d = { pts };
    const U = AV.meshSI(app) ? 'm' : 'ft';
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }); const box = h('div', { style: { flex: 1, minHeight: '200px', display: 'flex' } }); body.appendChild(box);
    const info = h('div', { class: 'note', style: { padding: '4px 10px' } }); body.appendChild(info);
    const P = AV.floatPanel({ id: 'xsec2d', title: '2D Cross Section', w: 760, h: 420, body, onClose: () => { app._xsec2d = null; if (off) off(); app.map.redrawOverlay(); } });
    const fb = P.el.querySelector('.fb'); if (fb && fb.firstChild !== body) { fb.innerHTML = ''; fb.appendChild(body); }
    const chart = new AV.Chart(box, { title: '2D cross section', yLabel: 'Elevation (' + U + ')', xLabel: 'Distance along the line (' + U + ')' });
    const draw = () => { const x = samp.map(s => s.ch); const val = (s, f) => s.k < 0 ? NaN : AV.cellValue(app, s.k, f);
      const g = samp.map(s => val(s, 'elev')), mw = samp.map(s => { const d = s.k < 0 ? NaN : MR.maxd[s.k]; return d > 0.001 ? mesh.cells[s.k].elev + d : NaN; });
      const ser = [{ name: 'Ground', x, y: g, color: '#795548' }, { name: 'Max. water surface', x, y: mw, color: '#1565c0' }];
      if (app.playMode) ser.push({ name: 'Water surface at ' + app.results.timeLabel(app.results.period), x, y: samp.map(s => { const d = val(s, 'depth'); return d > 0.001 ? val(s, 'wse') : NaN; }), color: '#00acc1', dash: [6, 3] });
      if (MR.cmp) ser.push({ name: 'Max. water surface (' + MR.cmp.name + ')', x, y: samp.map(s => { const d = s.k < 0 ? NaN : MR.cmp.maxd[s.k]; return d > 0.001 ? mesh.cells[s.k].elev + d : NaN; }), color: '#e65100', dash: [5, 4] });
      chart.setSeries(ser, { title: '2D cross section (' + AV.fmt(ch * lf, 1) + ' ' + U + ')' });
      const cs = new Set(samp.filter(s => s.k >= 0).map(s => s.k)); const md = Math.max(0, ...[...cs].map(k => MR.maxd[k] || 0));
      info.textContent = cs.size + ' cells crossed · max. depth along the line ' + AV.fmt(md, 3) + ' ' + U + (samp.some(s => s.k < 0) ? ' · gaps = outside the mesh' : '') + ' · drag to zoom, double-click to reset'; };
    draw(); const off = app.on('period', draw); app.map.redrawOverlay();
    return P;
  };
  // the cross-section line on the map
  AV.mapOverlays = AV.mapOverlays || [];
  AV.mapOverlays.push((map, ctx) => { const X = map.app._xsec2d; if (!X) return; ctx.save(); ctx.strokeStyle = '#d500f9'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 4]); ctx.beginPath();
    X.pts.forEach((p, i) => { const [x, y] = map.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.restore(); });

  // raster export of a mesh field (GeoTIFF or ASCII grid); asks for the file
  AV.exportMeshRaster = async function (app, field, fmt, base0) {
    if (!app.mesh2d) return; if (field !== 'elev' && !app.meshResults) { AV.toast('Run the 1D-2D model first.', true); return; }
    base0 = base0 || (app.filePath ? AV.basename(app.filePath).replace(/\.inp$/i, '') : 'model'); fmt = fmt || 'tif';
    const p = await window.host.saveDialog({ title: 'Export ' + AV.MESH_FIELDS[field], defaultPath: base0 + '_' + field + '.' + fmt, filters: fmt === 'tif' ? [{ name: 'GeoTIFF', extensions: ['tif', 'tiff'] }] : [{ name: 'ESRI ASCII grid', extensions: ['asc'] }] }); if (!p) return;
    const wkt = app.crsWKT || ''; const b = p.replace(/\.(tif|tiff|asc)$/i, '');
    if (fmt === 'tif') { const R = AV.meshRaster(app, field); const geo = /^\s*(GEOGCS|GEOGCRS|GEODCRS)/i.test(wkt) || /^deg/i.test((app.model.mapInfo && app.model.mapInfo.units) || '');
      await window.host.writeBinary(p, AV.writeGeoTIFF(R, AV.wktEPSG(wkt), geo));
      if (wkt) await window.host.writeText(p + '.aux.xml', '<PAMDataset>\n  <SRS>' + wkt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</SRS>\n</PAMDataset>\n');
      await window.host.writeText(b + '.tfw', [R.s0, 0, 0, -R.s0, R.x0 + R.s0 / 2, R.y1 - R.s0 / 2].join('\r\n') + '\r\n');
      AV.toast(AV.MESH_FIELDS[field] + ' exported to ' + p + ' (' + R.nc + ' × ' + R.nr + ' cells of ' + R.s0 + ')'); }
    else { await window.host.writeText(p, AV.meshGrid(app, field)); AV.toast('Grid exported to ' + p); }
    if (wkt) await window.host.writeText(b + '.prj', wkt);
  };
  // exports without opening the analysis view (2D Meshes layer menu)
  AV.flood2DExport = function (app, what, opts) { if (!app.meshResults) { AV.toast('Run the 1D-2D model first.', true); return; } app.flood2d = app.flood2d || new FloodView(app);
    const V = app.flood2d; if (V.S.thr === undefined) V.S.thr = app.meshResults.thr > 0 ? app.meshResults.thr : AV.meshDefaultBreaks(app, 'maxdepth')[0]; return V.exportAs(what, opts); };
  AV.openFlood2D = function (app) { app.flood2d = app.flood2d || new FloodView(app); app.flood2d.open(); };
})(window.AV);
