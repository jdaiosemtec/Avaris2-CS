// OsemCM V2.0 - 2D surface flood module (Avaris DS compatible approach)
//
// The ground surface inside a boundary polygon is covered by a square grid (cell size = boundary attribute "length").
// Every cell becomes a SWMM junction at the DEM elevation of its centre; neighbouring cells are joined by wide open
// rectangular conduits (width = cell / 2, length = cell / 2 * (4 / degree_a + 4 / degree_b) so that the plan area
// carried by each cell equals the cell area). Manholes that lie in a cell are coupled to it by an orifice at the rim,
// so water leaving a surcharged manhole spreads over the 2D surface and can drain back. Cells crossed by a water
// front (coast) line get a free outfall at the line elevation. Cut-off lines block flow between cells; exclusion
// polygons (buildings ...) remove cells. The result is written to <model>.finp and run by the normal engine.
'use strict';
(function (AV) {
  const h = AV.h;
  const KEYS = ['ENABLED', 'BOUNDARY', 'WATERFRONT', 'CUTOFF', 'EXCLUSION', 'DEM', 'ROUTING_STEP', 'FLOOD_DEPTH', 'CELL_SIZE', 'ROUGHNESS', 'UNITS'];
  const DEF = { ENABLED: 'NO', BOUNDARY: '', WATERFRONT: '', CUTOFF: '', EXCLUSION: '', DEM: '', ROUTING_STEP: '5', FLOOD_DEPTH: '0', CELL_SIZE: '', ROUGHNESS: '', UNITS: 'AUTO' };
  const MAXD2D = 30; // depth of the 2D surface "channels" and cells (as in Avaris DS)
  AV.F2D_KEYS = KEYS;
  AV.f2d = (m) => Object.assign({}, DEF, (m && m.osem2d) || {});
  // units of the 1D-2D run. AUTO (as Avaris DS): a model in US units whose map is in metres is run in SI (FLOW_UNITS CMS,
  // values unchanged) so that the metre-based mesh, DEM and model share one unit system. MODEL: keep the model units
  // and convert the mesh lengths from map units.
  AV.f2dRun = (m) => { const mapU = String((m.mapInfo && m.mapInfo.units) || 'None').toUpperCase(); const auto = String(AV.f2d(m).UNITS).toUpperCase() !== 'MODEL';
    if (auto && mapU === 'METERS' && !m.isSI) return { flow: 'CMS', lenFactor: 1, si: true };
    return { flow: null, lenFactor: mapU === 'METERS' && !m.isSI ? 3.28084 : mapU === 'FEET' && m.isSI ? 0.3048 : 1, si: !!m.isSI }; };
  AV.f2dEnabled = (m) => /^(YES|TRUE|1)$/i.test(AV.f2d(m).ENABLED);

  // ------------------------------------------------------------------ geometry helpers
  const pip = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) ins = !ins; } return ins; };
  const inPoly = (x, y, rings) => { let k = 0; for (const r of rings) if (pip(x, y, r)) k++; return k % 2 === 1; };
  const segX = (p1, p2, p3, p4) => { const d = (a, b, c) => (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0; };
  // Liang-Barsky clip of segment a-b to a box
  const clip = (a, b, x1, y1, x2, y2) => { let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0] - x1], [dx, x2 - a[0]], [-dy, a[1] - y1], [dy, y2 - a[1]]]) { if (p === 0) { if (q < 0) return null; continue; } const r = q / p; if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; } }
    return t1 > t0 ? [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]] : null; };

  // ------------------------------------------------------------------ mesh builder (pure; also used by the tests)
  // opt: boundary [{rings, size, n}], exclusion [rings[]], cutoff [[pt...]], coast [{pts, elev}], sample(x,y) -> elev|null,
  //      nodes [{id, x, y, rim}] (1D nodes to couple), lenFactor (map units -> model length units)
  AV.buildMesh2D = function (opt) {
    const cells = [], links = [], outfalls = [], couplings = []; const lf = opt.lenFactor || 1; let skippedNoData = 0, skippedExcl = 0;
    const grids = [];
    opt.boundary.forEach((B, bi) => {
      const s = B.size; const xs = B.rings.flat().map(p => p[0]), ys = B.rings.flat().map(p => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
      const nx = Math.ceil((x1 - x0) / s), ny = Math.ceil((y1 - y0) / s); const idx = new Map();
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const cx = x0 + s / 2 + i * s, cy = y0 + s / 2 + j * s;
        if (!inPoly(cx, cy, B.rings)) continue;
        if (opt.exclusion.some(r => inPoly(cx, cy, r))) { skippedExcl++; continue; }
        const z = opt.sample(cx, cy); if (z === null || !isFinite(z)) { skippedNoData++; continue; }
        const c = { k: cells.length, id: '', x: cx, y: cy, s, n: B.n, elev: +z.toFixed(4), bi, i, j, deg: 0 };
        idx.set(i + ',' + j, c); cells.push(c);
      }
      grids.push({ x0, y0, s, idx });
      const cut = opt.cutoff.flatMap(L => L.slice(1).map((p, k) => [L[k], p]));
      for (const c of cells) if (c.bi === bi) for (const [di, dj] of [[1, 0], [0, 1]]) {
        const o = idx.get((c.i + di) + ',' + (c.j + dj)); if (!o) continue;
        const a = [c.x, c.y], b = [o.x, o.y];
        if (cut.some(([p, q]) => Math.max(p[0], q[0]) >= Math.min(a[0], b[0]) && Math.min(p[0], q[0]) <= Math.max(a[0], b[0]) && Math.max(p[1], q[1]) >= Math.min(a[1], b[1]) && Math.min(p[1], q[1]) <= Math.max(a[1], b[1]) && segX(a, b, p, q))) continue;
        links.push({ a: c, b: o }); c.deg++; o.deg++;
      }
    });
    // ids: 2D_<n> in creation order (stable for a given input)
    cells.forEach((c, k) => { c.id = '2D_' + (k + 1); });
    const L2 = links.map((l, k) => ({ id: '2DL_' + (k + 1), a: l.a.id, b: l.b.id, len: +(l.a.s / 2 * (4 / l.a.deg + 4 / l.b.deg) * lf).toFixed(4), w: +(l.a.s / 2 * lf).toFixed(4), n: Math.max(l.a.n, l.b.n) }));
    const cellAt = (x, y) => { for (const g of grids) { const i = Math.floor((x - g.x0) / g.s), j = Math.floor((y - g.y0) / g.s); const c = g.idx.get(i + ',' + j); if (c) return c; } return null; };
    // water front (as Avaris DS): points every cell size along each line (at 1, 2, 3 ... cell sizes from its start);
    // each point that lies in a cell becomes a free outfall joined to that cell
    let ko = 0; const used = new Set(); const step0 = grids.length ? grids[0].s : 0;
    for (const C of opt.coast) { if (!(step0 > 0)) break; let ch = 0, next = step0;
      for (let k = 1; k < C.pts.length; k++) { const a = C.pts[k - 1], b = C.pts[k]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        while (L > 0 && next <= ch + L + 1e-9) { const f = (next - ch) / L; const x = a[0] + f * (b[0] - a[0]), y = a[1] + f * (b[1] - a[1]);
          const c = cellAt(x, y); if (c) { outfalls.push({ id: '2DO_' + (++ko), x, y, elev: isFinite(C.elev) ? C.elev : c.elev, cell: c.id, w: +(c.s * lf).toFixed(4) }); }
          next += step0; }
        ch += L; } }
    // 1D-2D coupling: an orifice at the rim of every 1D node that lies in a cell
    for (const nd of opt.nodes) { const c = cellAt(nd.x, nd.y); if (!c) continue; couplings.push({ id: '2DX_' + nd.id, node: nd.id, cell: c.id, offset: nd.offset, w: +(c.s * lf).toFixed(4) }); }
    return { version: 1, created: new Date().toISOString(), lenFactor: lf, cells: cells.map(c => ({ id: c.id, x: +c.x.toFixed(4), y: +c.y.toFixed(4), s: c.s, elev: c.elev, n: c.n, deg: c.deg })), links: L2, outfalls, couplings,
      stats: { cells: cells.length, links: L2.length, outfalls: outfalls.length, couplings: couplings.length, skippedNoData, skippedExcl } };
  };

  // ------------------------------------------------------------------ .finp: model + 2D elements
  AV.mesh2DToINP = function (text, mesh, m) {
    const f = AV.f2d(m); const elevOff = /ELEVATION/i.test(m.options.LINK_OFFSETS || '');
    const pad = (a) => a.map((x, i) => i === a.length - 1 ? String(x) : String(x).padEnd(i === 0 ? 17 : 11)).join(' ');
    const add = { JUNCTIONS: [], OUTFALLS: [], CONDUITS: [], ORIFICES: [], XSECTIONS: [], COORDINATES: [] };
    for (const c of mesh.cells) { add.JUNCTIONS.push(pad([c.id, c.elev, MAXD2D, 0, 0, 0])); add.COORDINATES.push(pad([c.id, c.x, c.y])); }
    for (const o of mesh.outfalls) { add.OUTFALLS.push(pad([o.id, o.elev, 'FREE', 'NO'])); add.COORDINATES.push(pad([o.id, o.x, o.y]));
      add.ORIFICES.push(pad([o.id + 'X', o.id, o.cell, 'SIDE', elevOff ? o.elev : 0, 0.65, 'NO', 0])); add.XSECTIONS.push(pad([o.id + 'X', 'RECT_CLOSED', MAXD2D, o.w, 0, 0])); }
    for (const l of mesh.links) { add.CONDUITS.push(pad([l.id, l.a, l.b, l.len, l.n, 0, 0, 0, 0])); add.XSECTIONS.push(pad([l.id, 'RECT_OPEN', MAXD2D, l.w, 0, 0, 1])); }
    for (const x of mesh.couplings) { const nd = m.nodes.get(x.node); if (!nd) continue; const rim = (+nd.p.maxDepth || 0);
      add.ORIFICES.push(pad([x.id, x.node, x.cell, 'SIDE', elevOff ? +nd.p.elev + rim : rim, 0.65, 'NO', 0])); add.XSECTIONS.push(pad([x.id, 'RECT_CLOSED', MAXD2D, x.w, 0, 0])); }
    const lines = text.split(/\r?\n/); const out = []; let sec = null; const seen = new Set();
    const rs = parseFloat(f.ROUTING_STEP); const run = AV.f2dRun(m);
    for (const ln of lines) {
      const t = ln.trim();
      if (t.startsWith('[')) { sec = t.slice(1, t.indexOf(']')).toUpperCase(); out.push(ln); if (add[sec]) { seen.add(sec); out.push(';;OsemCM 2D surface elements'); out.push(...add[sec]); } continue; }
      if (sec === 'OPTIONS' && /^ROUTING_STEP\b/i.test(t) && rs > 0) { out.push(pad(['ROUTING_STEP', rs])); continue; }
      if (sec === 'OPTIONS' && /^FLOW_UNITS\b/i.test(t) && run.flow) { out.push(pad(['FLOW_UNITS', run.flow]) + '   ;;OsemCM 2D: run in SI units (map in metres)'); continue; }
      out.push(ln);
    }
    for (const s in add) if (!seen.has(s) && add[s].length) { out.push('', '[' + s + ']'); out.push(...add[s]); }
    return out.join('\r\n') + '\r\n';
  };

  // ------------------------------------------------------------------ file helpers
  const resolve = (app, p) => { if (!p) return ''; if (/^([a-z]:[\\/]|\/|\\\\)/i.test(p)) return p; return app.filePath ? AV.joinPath(AV.dirname(app.filePath), p) : p; };
  // path of a layer relative to the model folder (../ allowed up to a shared folder below the drive root), else absolute
  const relative = (app, p) => { if (!p || !app.filePath) return p;
    const A = AV.dirname(app.filePath).replace(/\\/g, '/').split('/'), B = p.replace(/\\/g, '/').split('/'); let k = 0;
    while (k < A.length && k < B.length - 1 && A[k].toLowerCase() === B[k].toLowerCase()) k++;
    if (k < 2) return p; return Array(A.length - k).fill('..').concat(B.slice(k)).join('/'); };
  AV.f2dResolve = resolve;
  AV.meshPath = (app) => app.filePath ? app.filePath.replace(/\.inp$/i, '') + '.mesh2d.json' : null;
  const quoteless = (p) => String(p || '').replace(/^"|"$/g, '');
  async function readVector(app, path, what) {
    const p = resolve(app, quoteless(path)); if (!p) return null;
    if (!await window.host.exists(p)) throw new Error(what + ' file not found: ' + p);
    return await AV.loadDataFile(app, p);
  }
  const numProp = (props, names) => { if (!props) return NaN; for (const k of Object.keys(props)) if (names.includes(k.toLowerCase())) { const v = parseFloat(props[k]); if (isFinite(v)) return v; } return NaN; };

  // ------------------------------------------------------------------ Create Meshes
  AV.createMeshes = async function (app, quiet) {
    if (!AV.has2D(app)) { if (!quiet) AV.need2D(app, 'Create Meshes'); return; }
    const m = app.model, f = AV.f2d(m);
    if (!f.BOUNDARY || !f.DEM) { if (quiet) return; AV.alert('Set the 2D boundary and the DEM first (Simulation Options → 2D Flood).', 'Create Meshes'); app.sim.optionsDialog('2D Flood'); return; }
    const dlg = quiet ? { body: {}, close() {} } : AV.modal({ title: 'Create Meshes', width: 420, body: h('div', null, 'Reading boundary, DEM and lines...'), noFooter: true });
    try {
      const B = await readVector(app, f.BOUNDARY, 'Boundary');
      const polys = B.features.filter(x => x.type === 'polygon');
      if (!polys.length) throw new Error('The boundary layer has no polygons.');
      const cellOver = parseFloat(f.CELL_SIZE), nOver = parseFloat(f.ROUGHNESS);
      const mapU = (m.mapInfo.units || 'None').toUpperCase(); const lenFactor = AV.f2dRun(m).lenFactor;
      const boundary = polys.map(p => { const size = isFinite(cellOver) && cellOver > 0 ? cellOver : numProp(p.props, ['length', 'size', 'cellsize']); const n = isFinite(nOver) && nOver > 0 ? nOver : numProp(p.props, ['roughness', 'n', 'manning']);
        return { rings: p.coords, size: size > 0 ? size : NaN, n: n > 0 ? n : 0.03 }; });
      const bad = boundary.find(b => !(b.size > 0));
      if (bad) throw new Error('The boundary polygon has no cell size. Add a numeric field "length" (cell size in map units) and "roughness" (Manning n) to its attribute table, or enter a cell size in Simulation Options → 2D Flood.');
      const area = boundary.reduce((a, b) => { const xs = b.rings.flat(); let A = 0; for (const r of b.rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) A += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return a + Math.abs(A / 2) / (b.size * b.size); }, 0);
      if (area > 400000 && (quiet || !await AV.confirm('About ' + Math.round(area).toLocaleString() + ' cells would be created. Large meshes run slowly; a larger cell size ("length") is recommended. Continue?', 'Create Meshes', 'Continue'))) { dlg.close(); return; }
      dlg.body.textContent = 'Reading DEM...';
      const dem = await AV.readRasterFull(resolve(app, quoteless(f.DEM)));
      const [c0, c1, c2] = dem.corners; const W = dem.w, H = dem.h; const px = (c1[0] - c0[0]) / W, py = (c0[1] - c2[1]) / H;
      const nod = dem.nodata;
      const sample = (x, y) => { const i = Math.floor((x - c0[0]) / px), j = Math.floor((c0[1] - y) / py); if (i < 0 || j < 0 || i >= W || j >= H) return null; const v = dem.data[j * W + i];
        if (!isFinite(v) || Math.abs(v) > 1e30 || (nod !== null && Math.abs(v - nod) <= Math.max(1e-6, Math.abs(nod) * 1e-6))) return null; return v; };
      const lines = async (key, what) => { if (!f[key]) return []; const L = await readVector(app, f[key], what); return L.features.filter(x => x.type === 'line' || x.type === 'polygon'); };
      const cut = (await lines('CUTOFF', 'Cut-off')).flatMap(x => x.coords);
      const coast = (await lines('WATERFRONT', 'Water front')).flatMap(x => x.coords.map(pts => ({ pts, elev: numProp(x.props, ['elev', 'elevation', 'stage', 'z']) })));
      const exL = f.EXCLUSION ? await readVector(app, f.EXCLUSION, 'Exclusion') : null; const exclusion = exL ? exL.features.filter(x => x.type === 'polygon').map(x => x.coords) : [];
      // 1D nodes to couple: those tagged "Link2D" (Avaris DS) when any node has that tag, otherwise every junction / storage / divider
      const N = [...m.nodes.values()].filter(n => n.type !== 'OUTFALL'); const tagged = N.filter(n => /^link2d$/i.test(String(n.tag || '').trim()));
      const nodes = (tagged.length ? tagged : N).map(n => ({ id: n.id, x: n.x, y: n.y }));
      dlg.body.textContent = 'Building the mesh...'; await new Promise(r => setTimeout(r, 30));
      const mesh = AV.buildMesh2D({ boundary, exclusion, cutoff: cut, coast, sample, nodes, lenFactor });
      if (!mesh.cells.length) throw new Error('No cells were created: check that the boundary overlaps the DEM and that the cell size is smaller than the boundary.');
      mesh.source = { boundary: f.BOUNDARY, dem: f.DEM, cutoff: f.CUTOFF, waterfront: f.WATERFRONT, exclusion: f.EXCLUSION, cellSize: boundary.map(b => b.size), roughness: boundary.map(b => b.n) };
      const mp = AV.meshPath(app); if (mp) await window.host.writeText(mp, JSON.stringify(mesh));
      app.mesh2d = mesh; app.meshResults = null; dlg.close();
      app.panels.refreshLayers(); app.map.redraw();
      const s = mesh.stats; if (quiet) { app.status('2D mesh rebuilt: ' + s.cells + ' cells.'); return; }
      AV.alert('Mesh created:\n\n' + s.cells.toLocaleString() + ' cells (' + boundary.map(b => b.size).join(', ') + ' ' + (mapU === 'NONE' ? 'map units' : mapU.toLowerCase()) + ')\n' + s.links.toLocaleString() + ' surface links\n' + s.couplings + ' manholes coupled to the surface' + (tagged.length ? ' (nodes tagged Link2D)' : '') + '\n' + s.outfalls + ' water-front outfalls' +
        (s.skippedExcl ? '\n' + s.skippedExcl + ' cells removed by exclusion polygons' : '') + (s.skippedNoData ? '\n' + s.skippedNoData + ' cells skipped (no DEM data)' : '') + (mp ? '\n\nSaved to ' + mp : '\n\nSave the model to keep the mesh.') + '\n\nRun the simulation to compute the 1D-2D flooding.', 'Create Meshes');
    } catch (e) { dlg.close(); if (quiet) { app.status('2D mesh not built: ' + e.message); return; } AV.alert('Could not create the mesh:\n\n' + e.message, 'Create Meshes'); }
  };
  AV.loadMesh2D = async function (app) {
    app.mesh2d = null; app.meshResults = null; app._meshRemoved = false; const mp = AV.meshPath(app); if (!mp) return;
    try { if (await window.host.exists(mp)) { const j = JSON.parse(await window.host.readText(mp)); app.mesh2d = j && j.cells ? j : null; app._meshRemoved = !app.mesh2d; } } catch (e) { app.mesh2d = null; }
  };
  // Avaris DS keeps the 2D settings in <model>.ini [2D]; take them over when the model has none of its own
  AV.importAvaris2D = async function (app) {
    const m = app.model; if (!app.filePath || (m.osem2d && Object.keys(m.osem2d).length)) return;
    const ini = app.filePath.replace(/\.inp$/i, '.ini'); if (!await window.host.exists(ini)) return;
    const t = await window.host.readText(ini); const sec = /\[2D\]([\s\S]*?)(\n\[|$)/i.exec(t); if (!sec) return;
    const kv = {}; for (const l of sec[1].split(/\r?\n/)) { const mm = /^\s*([^=]+?)\s*=\s*(.*)$/.exec(l); if (mm) kv[mm[1].toLowerCase()] = mm[2].trim(); }
    const o = {}; if (kv.enabled) o.ENABLED = /true|1|yes/i.test(kv.enabled) ? 'YES' : 'NO';
    for (const [a, b] of [['boundary', 'BOUNDARY'], ['waterfront', 'WATERFRONT'], ['cutoff', 'CUTOFF'], ['dem', 'DEM'], ['exclusion', 'EXCLUSION']]) if (kv[a]) o[b] = relative(app, kv[a]);
    if (kv.routingstep) o.ROUTING_STEP = kv.routingstep; if (kv.flooddepth) o.FLOOD_DEPTH = kv.flooddepth;
    if (Object.keys(o).length) { m.osem2d = o; AV.toast('2D flood settings taken over from the Avaris DS project file (' + AV.basename(ini) + ').', false, 5000); }
  };
  AV.f2dRelative = relative;

  // ------------------------------------------------------------------ results on the mesh
  // per-cell node index in the output file, max depth, hours above the flood depth, hours to recede after the peak
  AV.computeMeshResults = async function (app) {
    const R = app.results, mesh = app.mesh2d; if (!R || !mesh || !AV.has2D(app)) { app.meshResults = null; return; }
    const idx = mesh.cells.map(c => { const i = R.idx.node.get(c.id); return i === undefined ? -1 : i; });
    if (!idx.some(i => i >= 0)) { app.meshResults = null; return; }
    const thr = parseFloat(AV.f2d(app.model).FLOOD_DEPTH) || 0;
    let st = null; try { st = await window.host.outPondStats(R.handle, idx.filter(i => i >= 0), thr); } catch (e) { st = null; }
    const nv = R.meta.nVars.node; const maxd = new Float32Array(idx.length), tp = new Float32Array(idx.length), tr = new Float32Array(idx.length);
    let k = 0; idx.forEach((i, c) => { if (i < 0) { maxd[c] = NaN; tp[c] = NaN; tr[c] = NaN; return; } maxd[c] = R.stats.node.max[i * nv]; if (st) { tp[c] = st.tpond[k]; tr[c] = st.trecede[k]; } k++; });
    app.meshResults = { idx, maxd, tpond: tp, trecede: tr, thr, si: AV.f2dRun(app.model).si };
  };
  AV.meshSI = (app) => app.meshResults ? app.meshResults.si : AV.f2dRun(app.model).si;
  AV.cellValue = function (app, k, field) {
    const c = app.mesh2d.cells[k]; const MR = app.meshResults, R = app.results;
    if (field === 'elev') return c.elev;
    if (!MR || MR.idx[k] < 0) return null;
    if (field === 'depth') return R.snap && R.snap.node ? R.snap.node[MR.idx[k] * R.meta.nVars.node] : null;
    if (field === 'wse') return R.snap && R.snap.node ? R.snap.node[MR.idx[k] * R.meta.nVars.node + 1] : null;
    if (field === 'maxdepth') return MR.maxd[k];
    if (field === 'tpond') return MR.tpond[k];
    if (field === 'trecede') return MR.trecede[k];
    return null;
  };
  const FIELDS = { depth: 'Depth (current time)', maxdepth: 'Max. Depth', tpond: 'Time Ponded (hr)', trecede: 'Time to Recede (hr)', wse: 'Water Surface Elev. (current time)', elev: 'Ground Elevation' };
  AV.MESH_FIELDS = FIELDS;
  const DEPTH_RAMP = ['#bdeeff', '#5fd0ff', '#1e9bff', '#1659ff', '#0d2fc4', '#08156e'];
  const TIME_RAMP = ['#fff3b0', '#ffd166', '#f8961e', '#e85d04', '#c1121f', '#6a040f'];
  AV.meshStyle = function (app) {
    const P = app.prefs.mesh2d || (app.prefs.mesh2d = {}); const field = FIELDS[P.field] ? P.field : 'depth';
    const si = app.model && AV.meshSI(app);
    const defB = { depth: si ? [0.05, 0.15, 0.3, 0.5, 1.0] : [0.15, 0.5, 1, 1.5, 3], maxdepth: si ? [0.05, 0.15, 0.3, 0.5, 1.0] : [0.15, 0.5, 1, 1.5, 3], tpond: [0.25, 0.5, 1, 2, 4], trecede: [0.25, 0.5, 1, 2, 4], wse: null, elev: null };
    const breaks = (P.breaks && P.breaks[field]) || defB[field];
    return { field, breaks, colors: field === 'tpond' || field === 'trecede' ? TIME_RAMP : DEPTH_RAMP, opacity: P.opacity === undefined ? 0.8 : P.opacity, outline: P.outline !== false, visible: P.visible !== false };
  };
  const terrain = (t) => { const C = [[0, [46, 125, 50]], [0.35, [174, 213, 129]], [0.6, [255, 241, 118]], [0.8, [188, 140, 92]], [1, [245, 245, 245]]]; for (let i = 1; i < C.length; i++) if (t <= C[i][0]) { const a = C[i - 1], b = C[i]; const f = (t - a[0]) / (b[0] - a[0]); return 'rgb(' + a[1].map((v, j) => Math.round(v + (b[1][j] - v) * f)).join(',') + ')'; } return 'rgb(245,245,245)'; };
  // colour of a cell, or null when it is dry / has no value (only the outline is drawn)
  AV.meshColor = function (app, k, S) {
    const v = AV.cellValue(app, k, S.field); if (v === null || !isFinite(v)) return null;
    if (!S.breaks) { const r = app._meshRange || (app._meshRange = {}); const key = S.field; if (!r[key]) { let a = Infinity, b = -Infinity; for (let i = 0; i < app.mesh2d.cells.length; i++) { const x = AV.cellValue(app, i, key); if (x !== null && isFinite(x)) { a = Math.min(a, x); b = Math.max(b, x); } } r[key] = [a, b]; }
      const [a, b] = r[key]; return terrain(b > a ? (v - a) / (b - a) : 0.5); }
    if (v < S.breaks[0]) return null;
    let c = S.colors[S.colors.length - 1]; for (let i = 1; i < S.breaks.length; i++) if (v < S.breaks[i]) { c = S.colors[i - 1]; break; }
    return c;
  };
  AV.drawMesh = function (map, ctx) {
    const app = map.app, mesh = app.mesh2d; if (!mesh || !mesh.cells.length) return; const S = AV.meshStyle(app); if (!S.visible) return;
    const vb = map.visibleBox(); const sc = map.scale; const cells = mesh.cells; const big = cells.length > 60000;
    const groups = new Map(); const outline = new Path2D(); let nOut = 0;
    for (let k = 0; k < cells.length; k++) { const c = cells[k], hs = c.s / 2; if (c.x + hs < vb.x1 || c.x - hs > vb.x2 || c.y + hs < vb.y1 || c.y - hs > vb.y2) continue;
      const [x, y] = map.toScreen(c.x - hs, c.y + hs); const w = c.s * sc; const col = AV.meshColor(app, k, S);
      if (col) { let p = groups.get(col); if (!p) groups.set(col, p = new Path2D()); p.rect(x, y, w, w); }
      if (S.outline && w > 4 && !big) { outline.rect(x, y, w, w); nOut++; } }
    ctx.save(); ctx.globalAlpha = S.opacity; for (const [col, p] of groups) { ctx.fillStyle = col; ctx.fill(p); } ctx.globalAlpha = 1;
    if (nOut) { ctx.strokeStyle = 'rgba(80,96,110,.35)'; ctx.lineWidth = 0.6; ctx.stroke(outline); }
    ctx.restore();
  };
  AV.meshHit = function (map, wx, wy) {
    const mesh = map.app.mesh2d; if (!mesh || !AV.meshStyle(map.app).visible) return -1;
    // bucket index (bucket = largest cell size), built once per mesh
    if (!mesh._ix) { const B = Math.max(...mesh.cells.map(c => c.s)); const ix = new Map(); mesh.cells.forEach((c, k) => { const key = Math.floor(c.x / B) + ',' + Math.floor(c.y / B); let a = ix.get(key); if (!a) ix.set(key, a = []); a.push(k); });
      Object.defineProperty(mesh, '_ix', { value: { B, ix }, enumerable: false, writable: true }); }
    const { B, ix } = mesh._ix; const bi = Math.floor(wx / B), bj = Math.floor(wy / B);
    for (let i = bi - 1; i <= bi + 1; i++) for (let j = bj - 1; j <= bj + 1; j++) { const a = ix.get(i + ',' + j); if (a) for (const k of a) { const c = mesh.cells[k], hs = c.s / 2; if (Math.abs(wx - c.x) <= hs && Math.abs(wy - c.y) <= hs) return k; } }
    return -1;
  };
  // legend for result fields (bottom-left of the map)
  AV.drawMeshLegend = function (map, ctx) {
    const app = map.app; if (!app.mesh2d || !app.mesh2d.cells.length) return; const S = AV.meshStyle(app); if (!S.visible || !S.breaks) return;
    if (S.field !== 'elev' && !app.meshResults) return;
    const u = S.field === 'tpond' || S.field === 'trecede' ? 'hr' : (AV.meshSI(app) ? 'm' : 'ft');
    const rows = S.breaks.map((b, i) => [S.colors[i], i < S.breaks.length - 1 ? AV.fmt(b) + ' – ' + AV.fmt(S.breaks[i + 1]) : '> ' + AV.fmt(b)]);
    const W = 150, H = 22 + rows.length * 16, x = 10, y = map.hgt - H - 34;
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.strokeStyle = '#b0bec5'; ctx.fillRect(x, y, W, H); ctx.strokeRect(x + .5, y + .5, W, H);
    ctx.font = 'bold 11px Segoe UI'; ctx.fillStyle = '#263238'; ctx.textBaseline = 'middle'; ctx.fillText('2D: ' + FIELDS[S.field].replace(/ \(.*\)/, '') + ' (' + u + ')', x + 7, y + 11);
    ctx.font = '11px Segoe UI'; rows.forEach(([c, t], i) => { const yy = y + 22 + i * 16; ctx.fillStyle = c; ctx.fillRect(x + 7, yy, 18, 11); ctx.fillStyle = '#37474f'; ctx.fillText(t, x + 31, yy + 6); });
    ctx.restore();
  };

  // ------------------------------------------------------------------ mesh style dialog / layer menu / cell info
  AV.meshStyleDialog = async function (app) {
    const S = AV.meshStyle(app); const P = app.prefs.mesh2d;
    const fs = h('select', null, Object.keys(FIELDS).map(k => h('option', { value: k }, FIELDS[k]))); fs.value = S.field;
    const brk = h('input', { type: 'text', value: S.breaks ? S.breaks.join(' ') : '', style: { width: '260px' } }); const op = h('input', { type: 'text', value: S.opacity, style: { width: '80px' } });
    const ol = h('input', { type: 'checkbox', checked: S.outline });
    const sync = () => { const b = AV.meshStyle(Object.assign({}, app, { prefs: { mesh2d: Object.assign({}, P, { field: fs.value }) } })).breaks; brk.value = b ? b.join(' ') : ''; brk.disabled = !b; };
    fs.onchange = sync; brk.disabled = !S.breaks;
    const body = h('div', { class: 'form', style: { width: '480px' } }, h('label', null, 'Colour cells by'), fs, h('label', null, 'Class breaks'), brk, h('label', null, 'Opacity (0-1)'), op, h('label', null, 'Cell outlines'), ol,
      h('div', { class: 'note' }, 'Cells below the first break are left uncoloured (dry). Depth and water surface follow the current time step (Play to animate the flooding); Max. Depth, Time Ponded and Time to Recede come from the whole run. Time Ponded counts the hours the depth is above the Flood Depth set in Simulation Options → 2D Flood.'));
    const r = await AV.modal({ title: '2D Mesh Style', body, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: true }] }).done; if (!r) return;
    P.field = fs.value; const b = brk.value.trim().split(/[\s,;]+/).map(Number).filter(isFinite); if (b.length) { P.breaks = P.breaks || {}; P.breaks[fs.value] = b.sort((x, y) => x - y); }
    const o = parseFloat(op.value); if (o >= 0 && o <= 1) P.opacity = o; P.outline = ol.checked; app.savePrefs(); app._meshRange = null; app.map.redraw();
  };
  AV.exportMeshShapefile = async function (app) {
    const mesh = app.mesh2d; if (!mesh) return; const p = await window.host.saveDialog({ title: 'Export 2D mesh', defaultPath: 'Meshes.shp', filters: [{ name: 'Shapefile', extensions: ['shp'] }] }); if (!p) return;
    const feats = mesh.cells.map((c, k) => { const hs = c.s / 2; const props = { id: c.id, elev: c.elev, maxdepth: 0, tpond: 0, trecede: 0 };
      if (app.meshResults) { props.maxdepth = +(AV.cellValue(app, k, 'maxdepth') || 0).toFixed(4); props.tpond = +(AV.cellValue(app, k, 'tpond') || 0).toFixed(3); props.trecede = +(AV.cellValue(app, k, 'trecede') || 0).toFixed(3); }
      return { coords: [[[c.x - hs, c.y - hs], [c.x - hs, c.y + hs], [c.x + hs, c.y + hs], [c.x + hs, c.y - hs], [c.x - hs, c.y - hs]]], props }; });
    const fields = [{ name: 'id', type: 'C', len: 20 }, { name: 'elev', type: 'N', len: 18, dc: 4 }, { name: 'maxdepth', type: 'N', len: 18, dc: 4 }, { name: 'tpond', type: 'N', len: 18, dc: 3 }, { name: 'trecede', type: 'N', len: 18, dc: 3 }];
    const w = AV.SHP.write('polygon', feats, fields); const base = p.replace(/\.shp$/i, '');
    await window.host.writeBinary(base + '.shp', new Uint8Array(w.shp)); await window.host.writeBinary(base + '.shx', new Uint8Array(w.shx)); await window.host.writeBinary(base + '.dbf', new Uint8Array(w.dbf));
    if (app.crs && app.crs.wkt) await window.host.writeText(base + '.prj', app.crs.wkt);
    AV.toast('Mesh exported to ' + base + '.shp');
  };
  // pseudo node used to plot the depth of a cell with the normal graph tools
  AV.cellNode = (app, k) => { const c = app.mesh2d.cells[k]; return { id: c.id, kind: 'NODE', type: 'JUNCTION', x: c.x, y: c.y, p: { elev: c.elev, maxDepth: MAXD2D }, tag: '', mesh: true }; };
  AV.showCellInfo = function (app, k) {
    const el = AV.$('#props'); if (!el) return; const c = app.mesh2d.cells[k]; el.innerHTML = '';
    const L = AV.meshSI(app) ? 'm' : 'ft'; const f = (v, d) => v === null || v === undefined || !isFinite(v) ? '-' : AV.fmt(v, d);
    el.appendChild(h('div', { class: 'phead' }, h('div', { class: 'pt' }, '2D Cell ' + c.id), h('div', { class: 'ps' }, 'X ' + AV.fmt(c.x, 2) + '   Y ' + AV.fmt(c.y, 2))));
    const rows = [['Ground Elevation (' + L + ')', f(c.elev, 3)], ['Cell Size (map units)', f(c.s)], ['Roughness (n)', f(c.n, 4)], ['Connected Neighbours', String(c.deg)]];
    const MR = app.meshResults; const res = MR ? [['Depth at ' + app.results.timeLabel(app.results.period) + ' (' + L + ')', f(AV.cellValue(app, k, 'depth'), 3)], ['Water Surface Elev. (' + L + ')', f(AV.cellValue(app, k, 'wse'), 3)], ['Max. Depth (' + L + ')', f(AV.cellValue(app, k, 'maxdepth'), 3)],
      ['Time Ponded (hr)', f(AV.cellValue(app, k, 'tpond'), 2)], ['Time to Recede (hr)', f(AV.cellValue(app, k, 'trecede'), 2)]] : [];
    const tb = h('table', { class: 'pgrid' }, h('tr', { class: 'pg0' }, h('td', { colspan: 2 }, 'General')), rows.map(([a, b]) => h('tr', null, h('td', { class: 'k' }, a), h('td', { class: 'v' }, h('div', { class: 'ro' }, b)))),
      res.length ? h('tr', { class: 'pg0' }, h('td', { colspan: 2 }, 'Flooding Results')) : null, res.map(([a, b]) => h('tr', { class: 'st' }, h('td', { class: 'k' }, a), h('td', { class: 'v' }, h('div', { class: 'ro' }, b)))));
    el.appendChild(tb);
    if (MR) el.appendChild(h('div', { style: { padding: '8px 10px' } }, h('button', { class: 'btn', onclick: () => app.feat.graphTool([AV.cellNode(app, k)]) }, 'Graph Depth')));
    if (app.showRightTab) app.showRightTab('props');
  };
})(window.AV);
