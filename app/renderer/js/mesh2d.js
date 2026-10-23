// Avaris2 V2.0 - 2D surface flood module (Avaris DS compatible approach)
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
  const KEYS = ['ENABLED', 'BOUNDARY', 'WATERFRONT', 'CUTOFF', 'EXCLUSION', 'DEM', 'ROUTING_STEP', 'FLOOD_DEPTH', 'CELL_SIZE', 'ROUGHNESS', 'UNITS', 'MESH_TYPE', 'MESH_ZONES', 'BREAK_LINES', 'EXCL_TYPE', 'EXCL_HEIGHT', 'EXCL_POROSITY'];
  // MESH_TYPE: SQUARE (Avaris DS grid) or UNSTRUCTURED (triangles, umesh.js), chosen in Create Meshes.
  // MESH_ZONES / BREAK_LINES: optional layers for the unstructured mesh: polygons with "size" = finer / coarser cells
  //   inside; lines = break lines (cell edges follow them; optional "size" = cell size along the line).
  // EXCL_TYPE / EXCL_HEIGHT / EXCL_POROSITY: how exclusion polygons (buildings) are modelled when the polygon has no
  //   "type" / "height" / "porosity" attribute: VOID (no cells, water flows around), RAISED (cells raised by the
  //   height), POROUS (cells keep porosity x their area and porosity x the width of their links).
  const DEF = { ENABLED: 'NO', BOUNDARY: '', WATERFRONT: '', CUTOFF: '', EXCLUSION: '', DEM: '', ROUTING_STEP: '', FLOOD_DEPTH: '0', CELL_SIZE: '', ROUGHNESS: '', UNITS: 'MODEL', MESH_TYPE: 'SQUARE', MESH_ZONES: '', BREAK_LINES: '', EXCL_TYPE: 'VOID', EXCL_HEIGHT: '', EXCL_POROSITY: '' };
  const MAXD2D = 30; // depth of the 2D surface "channels" and cells (as in Avaris DS)
  AV.F2D_KEYS = KEYS;
  AV.f2d = (m) => Object.assign({}, DEF, (m && m.osem2d) || {});
  // units of the 1D-2D run (the flow units are never changed here: to run in other units, switch the model's flow
  // units in the status bar and choose "Keep values").
  //   MODEL (default, as Avaris DS): the mesh numbers (cell size, DEM elevations, water-front elevations) are used as
  //          they are, i.e. read as model units.
  //   CONVERT: the mesh numbers are converted from the map units to the model units when the mesh is built
  //          (map in metres + US model: lengths, widths and elevations x 3.28084; map in feet + SI model: x 0.3048).
  AV.f2dRun = (m) => { const mapU = String((m.mapInfo && m.mapInfo.units) || 'None').toUpperCase(); const u = String(AV.f2d(m).UNITS).toUpperCase();
    if (u === 'CONVERT') return { flow: null, lenFactor: mapU === 'METERS' && !m.isSI ? 3.28084 : mapU === 'FEET' && m.isSI ? 0.3048 : 1, si: !!m.isSI };
    return { flow: null, lenFactor: 1, si: !!m.isSI }; };
  AV.f2dEnabled = (m) => /^(YES|TRUE|1)$/i.test(AV.f2d(m).ENABLED);

  // ------------------------------------------------------------------ cell geometry (square grid or unstructured)
  // Unstructured cells keep vertex indexes into mesh.verts; prepMesh gives every cell its polygon (_p, counter-
  // clockwise, not saved) and its bounding box (_b), so the drawing / hit test / export code works for both types.
  AV.prepMesh = function (mesh) {
    if (!mesh || !mesh.cells) return mesh; const V = mesh.verts;
    for (const c of mesh.cells) { let p;
      if (c.v && V) p = c.v.map(i => [V[2 * i], V[2 * i + 1]]); else { const hs = c.s / 2; p = [[c.x - hs, c.y - hs], [c.x + hs, c.y - hs], [c.x + hs, c.y + hs], [c.x - hs, c.y + hs]]; }
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const q of p) { if (q[0] < x1) x1 = q[0]; if (q[0] > x2) x2 = q[0]; if (q[1] < y1) y1 = q[1]; if (q[1] > y2) y2 = q[1]; }
      Object.defineProperty(c, '_p', { value: p, enumerable: false, writable: true, configurable: true }); Object.defineProperty(c, '_b', { value: [x1, y1, x2, y2], enumerable: false, writable: true, configurable: true }); }
    Object.defineProperty(mesh, '_ix', { value: null, enumerable: false, writable: true, configurable: true });
    return mesh;
  };
  const ensure = (c) => { if (!c._p) { const hs = c.s / 2; Object.defineProperty(c, '_p', { value: [[c.x - hs, c.y - hs], [c.x + hs, c.y - hs], [c.x + hs, c.y + hs], [c.x - hs, c.y + hs]], enumerable: false, writable: true, configurable: true }); Object.defineProperty(c, '_b', { value: [c.x - hs, c.y - hs, c.x + hs, c.y + hs], enumerable: false, writable: true, configurable: true }); } return c; };
  AV.cellPoly = (c) => ensure(c)._p;               // [[x, y] ...] counter-clockwise, not closed
  AV.cellBox = (c) => ensure(c)._b;                // [x1, y1, x2, y2]
  AV.cellArea = (c) => c.a > 0 ? c.a : c.s * c.s;  // map units²
  AV.meshIsTri = (mesh) => !!(mesh && mesh.type === 'tri');

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
    const cells = [], links = [], outfalls = [], couplings = []; const lf = opt.lenFactor || 1; let skippedNoData = 0, skippedExcl = 0, nRaised = 0, nPorous = 0;
    const grids = []; const EX = (opt.exclusion || []).map(e => Array.isArray(e) ? { rings: e, type: 'VOID' } : e);
    opt.boundary.forEach((B, bi) => {
      const s = B.size; const xs = B.rings.flat().map(p => p[0]), ys = B.rings.flat().map(p => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
      const nx = Math.ceil((x1 - x0) / s), ny = Math.ceil((y1 - y0) / s); const idx = new Map();
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const cx = x0 + s / 2 + i * s, cy = y0 + s / 2 + j * s;
        if (!inPoly(cx, cy, B.rings)) continue;
        const E = EX.find(e => inPoly(cx, cy, e.rings)); if (E && E.type === 'VOID') { skippedExcl++; continue; }
        const z = opt.sample(cx, cy); if (z === null || !isFinite(z)) { skippedNoData++; continue; }
        const c = { k: cells.length, id: '', x: cx, y: cy, s, n: B.n, elev: +(z * lf).toFixed(4), bi, i, j, deg: 0, por: 1 };
        if (E && E.type === 'RAISED') { c.elev = +((z + (E.height > 0 ? E.height : 0)) * lf).toFixed(4); c.bt = 1; nRaised++; } else if (E && E.type === 'POROUS') { c.por = E.porosity > 0 && E.porosity <= 1 ? E.porosity : 0.5; c.bt = 2; nPorous++; }
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
    const L2 = links.map((l, k) => ({ id: '2DL_' + (k + 1), a: l.a.id, b: l.b.id, len: +(l.a.s / 2 * (4 / l.a.deg + 4 / l.b.deg) * lf).toFixed(4), w: +(l.a.s / 2 * lf * Math.min(l.a.por, l.b.por)).toFixed(4), n: Math.max(l.a.n, l.b.n) }));
    const cellAt = (x, y) => { for (const g of grids) { const i = Math.floor((x - g.x0) / g.s), j = Math.floor((y - g.y0) / g.s); const c = g.idx.get(i + ',' + j); if (c) return c; } return null; };
    // water front (as Avaris DS): points every cell size along each line (at 1, 2, 3 ... cell sizes from its start);
    // each point that lies in a cell becomes a free outfall joined to that cell
    let ko = 0; const used = new Set(); const step0 = grids.length ? grids[0].s : 0;
    for (const C of opt.coast) { if (!(step0 > 0)) break; let ch = 0, next = step0;
      for (let k = 1; k < C.pts.length; k++) { const a = C.pts[k - 1], b = C.pts[k]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        while (L > 0 && next <= ch + L + 1e-9) { const f = (next - ch) / L; const x = a[0] + f * (b[0] - a[0]), y = a[1] + f * (b[1] - a[1]);
          const c = cellAt(x, y); if (c) { outfalls.push({ id: '2DO_' + (++ko), x, y, elev: isFinite(C.elev) ? +(C.elev * lf).toFixed(4) : c.elev, cell: c.id, w: +(c.s * lf).toFixed(4) }); }
          next += step0; }
        ch += L; } }
    // 1D-2D coupling: an orifice at the rim of every 1D node that lies in a cell
    for (const nd of opt.nodes) { const c = cellAt(nd.x, nd.y); if (!c) continue; couplings.push({ id: '2DX_' + nd.id, node: nd.id, cell: c.id, offset: nd.offset, w: +(c.s * lf).toFixed(4) }); }
    return { version: 1, created: new Date().toISOString(), lenFactor: lf, cells: cells.map(c => { const o = { id: c.id, x: +c.x.toFixed(4), y: +c.y.toFixed(4), s: c.s, elev: c.elev, n: c.n, deg: c.deg }; if (c.bt) o.bt = c.bt; if (c.por < 1) o.por = c.por; return o; }), links: L2, outfalls, couplings,
      stats: { cells: cells.length, links: L2.length, outfalls: outfalls.length, couplings: couplings.length, skippedNoData, skippedExcl, raised: nRaised, porous: nPorous } };
  };

  // ------------------------------------------------------------------ .finp: model + 2D elements
  // extra (coupled parallel run, one sub-model): { all: the whole mesh (cell lookups), bnd: [{ id, elev, x, y }] boundary
  //   outfalls standing for the cells of other sub-models at the cut 2D links / coupling orifices }
  AV.mesh2DToINP = function (text, mesh, m, extra) {
    const f = AV.f2d(m); const elevOff = /ELEVATION/i.test(m.options.LINK_OFFSETS || '');
    const allCells = extra && extra.all ? extra.all.cells : mesh.cells;
    const pad = (a) => a.map((x, i) => i === a.length - 1 ? String(x) : String(x).padEnd(i === 0 ? 17 : 11)).join(' ');
    const add = { JUNCTIONS: [], OUTFALLS: [], CONDUITS: [], ORIFICES: [], XSECTIONS: [], COORDINATES: [] };
    for (const c of mesh.cells) { add.JUNCTIONS.push(pad([c.id, c.elev, MAXD2D, 0, 0, 0])); add.COORDINATES.push(pad([c.id, c.x, c.y])); }
    // The crest of every coupling orifice is set to the higher of its own level and the cell ground, and a coupled
    // manhole is deepened to the top of its orifice. The engine would make exactly these adjustments itself
    // (WARNING 10 "crest elevation raised to downstream invert", WARNING 02 "maximum depth increased"); doing it
    // here gives the same results without hundreds of warnings in the report.
    const cellZ = new Map(allCells.map(c => [c.id, c.elev])); const r4 = (v) => +(+v).toFixed(4); const up4 = (v) => Math.ceil(v * 1e4 + 1e-6) / 1e4; const deepen = new Map();
    for (const o of mesh.outfalls) { add.OUTFALLS.push(pad([o.id, o.elev, 'FREE', 'NO'])); add.COORDINATES.push(pad([o.id, o.x, o.y]));
      const zc = cellZ.get(o.cell); const crest = Math.max(o.elev, isFinite(zc) ? zc : o.elev);
      add.ORIFICES.push(pad([o.id + 'X', o.id, o.cell, 'SIDE', crest > o.elev ? up4(elevOff ? crest : crest - o.elev) : r4(elevOff ? crest : 0), 0.65, 'NO', 0])); add.XSECTIONS.push(pad([o.id + 'X', 'RECT_CLOSED', MAXD2D, o.w, 0, 0])); }
    if (extra && extra.bnd) for (const b of extra.bnd) { add.OUTFALLS.push(pad([b.id, b.elev, 'FIXED', b.elev, 'NO'])); add.COORDINATES.push(pad([b.id, b.x, b.y])); }
    const cellN = new Map(allCells.map(c => [c.id, c.n])); // roughness may have been edited per cell in the attribute table
    for (const l of mesh.links) { const na = cellN.get(l.a), nb = cellN.get(l.bOrig || l.b); const n = isFinite(na) && isFinite(nb) ? Math.max(na, nb) : l.n; add.CONDUITS.push(pad([l.id, l.a, l.b, l.len, n, 0, 0, 0, 0])); add.XSECTIONS.push(pad([l.id, 'RECT_OPEN', MAXD2D, l.w, 0, 0, 1])); }
    for (const x of mesh.couplings) { const nd = m.nodes.get(x.node); if (!nd) continue; const z0 = +nd.p.elev || 0, rim = (+nd.p.maxDepth || 0);
      const zc = cellZ.get(x.cellOf || x.cell); const crest = Math.max(z0 + rim, isFinite(zc) ? zc : z0 + rim);
      add.ORIFICES.push(pad([x.id, x.node, x.cell, 'SIDE', crest > z0 + rim ? up4(elevOff ? crest : crest - z0) : r4(elevOff ? crest : rim), 0.65, 'NO', 0])); add.XSECTIONS.push(pad([x.id, 'RECT_CLOSED', MAXD2D, x.w, 0, 0]));
      deepen.set(x.node, +(up4(crest - z0 + MAXD2D) + 0.0001).toFixed(4)); }
    const lines = text.split(/\r?\n/); const out = []; let sec = null; const seen = new Set();
    const rs = parseFloat(f.ROUTING_STEP); const run = AV.f2dRun(m);
    for (const ln of lines) {
      const t = ln.trim();
      if (t.startsWith('[')) { sec = t.slice(1, t.indexOf(']')).toUpperCase(); out.push(ln); if (add[sec]) { seen.add(sec); out.push(';;Avaris2 2D surface elements'); out.push(...add[sec]); } continue; }
      if (sec === 'OPTIONS' && /^ROUTING_STEP\b/i.test(t) && rs > 0) { out.push(pad(['ROUTING_STEP', rs])); continue; }
      if ((sec === 'JUNCTIONS' || sec === 'STORAGE') && t && t[0] !== ';') { const k = AV.tokenize(t); const d = deepen.get(k[0]); if (d !== undefined && k.length >= 3 && !(+k[2] >= d)) { k[2] = String(d); out.push(pad(k)); continue; } }
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
  // exclusion polygon type / height / porosity: attributes "type" (VOID | RAISED | POROUS or 0 | 1 | 2), "height",
  // "porosity"; polygons without them take the defaults of Options → 2D Flood
  const strProp = (props, names) => { if (!props) return ''; for (const k of Object.keys(props)) if (names.includes(k.toLowerCase())) { const v = String(props[k] ?? '').trim(); if (v) return v; } return ''; };
  AV.exclusionType = (v, def) => { const t = String(v || '').trim().toUpperCase(); if (/^(0|VOID|NONE|BUILDING|空|不进水)$/.test(t)) return 'VOID'; if (/^(1|RAISED|RAISE|STUBBY|抬高)$/.test(t)) return 'RAISED'; if (/^(2|POROUS|POROSITY|多孔)$/.test(t)) return 'POROUS'; return def; };
  // mesh type chosen when the mesh is created (SQUARE / UNSTRUCTURED); resolves to null when cancelled
  AV.chooseMeshType = function (app) {
    const f = AV.f2d(app.model); let cur = /^UNSTR/i.test(f.MESH_TYPE) ? 'UNSTRUCTURED' : 'SQUARE';
    const opt = (v, t, d) => h('label', { class: 'mtype' + (cur === v ? ' on' : ''), style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px', border: '1px solid var(--line, #cfd8dc)', borderRadius: '6px', marginBottom: '8px', cursor: 'pointer' } },
      h('input', { type: 'radio', name: 'mtype', value: v, checked: cur === v, onchange: () => { cur = v; } }), h('div', null, h('b', null, t), h('div', { class: 'note', style: { marginTop: '3px', lineHeight: 1.45 } }, d)));
    const body = h('div', { style: { width: '470px' } },
      opt('SQUARE', 'Square grid', 'Square cells of the boundary cell size, as Avaris DS. Building and boundary edges follow the cell centres.'),
      opt('UNSTRUCTURED', 'Unstructured mesh (triangles)', 'Cells follow the boundary, buildings, cut-off lines, water front and break lines exactly; finer or coarser cells in mesh zones (Options → 2D Flood → Mesh Zones). About the same number of cells as the square grid for the same cell size.'));
    return AV.modal({ title: 'Create Meshes', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Create Meshes', primary: true, onClick: () => cur }] }).done;
  };

  // recommended 2D routing step: half the time a shallow-water wave (1 m / 3.3 ft deep) needs to cross the shorter
  // surface links (5th percentile of the link lengths); { len, step } or null
  AV.meshRecStep = function (m, mesh) {
    const L = (mesh.links || []).map(l => +l.len).filter(x => x > 0).sort((a, b) => a - b); if (!L.length) return null;
    const len = L[Math.floor(L.length * 0.05)]; const si = AV.f2dRun(m).si; const c = Math.sqrt(si ? 9.81 * 1 : 32.2 * 3.28);
    const raw = 0.5 * len / c; const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 3, 4, 5, 10, 15, 20, 30]; let st = steps[0]; for (const x of steps) if (x <= raw) st = x;
    return { len, step: st };
  };

  // ------------------------------------------------------------------ Create Meshes
  AV.createMeshes = async function (app, quiet) {
    if (!AV.has2D(app)) { if (!quiet) AV.need2D(app, 'Create Meshes'); return; }
    const m = app.model; let f = AV.f2d(m);
    if (!f.BOUNDARY || !f.DEM) { if (quiet) return; AV.alert('Set the 2D boundary and the DEM first (Simulation Options → 2D Flood).', 'Create Meshes'); app.sim.optionsDialog('2D Flood'); return; }
    if (!quiet) { const t = await AV.chooseMeshType(app); if (!t) return;
      if (t !== (/^UNSTR/i.test(f.MESH_TYPE) ? 'UNSTRUCTURED' : 'SQUARE')) { const old2 = m.osem2d ? Object.assign({}, m.osem2d) : null; const nw2 = Object.assign({}, m.osem2d || {}, { MESH_TYPE: t });
        app.exec({ label: '2D mesh type', do: () => { m.osem2d = Object.assign({}, nw2); }, undo: () => { m.osem2d = old2 ? Object.assign({}, old2) : undefined; }, changes: [{ o: { kind: 'OPTIONS', id: 'Options', type: '' }, key: '2D MESH_TYPE', old: f.MESH_TYPE, nw: t }] }); f = AV.f2d(m); } }
    const tri = /^UNSTR/i.test(f.MESH_TYPE);
    const dlg = quiet ? { body: {}, close() {} } : AV.modal({ title: 'Create Meshes', width: 420, body: h('div', null, 'Reading boundary, DEM and lines...'), noFooter: true });
    const say = async (t) => { dlg.body.textContent = t; await new Promise(r => setTimeout(r, 20)); };
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
      const area = boundary.reduce((a, b) => { let A = 0; for (const r of b.rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) A += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return a + Math.abs(A / 2) / (b.size * b.size); }, 0);
      if (area > 400000 && (quiet || !await AV.confirm('About ' + Math.round(area).toLocaleString() + ' cells would be created. Large meshes run slowly; a larger cell size ("length") is recommended. Continue?', 'Create Meshes', 'Continue'))) { dlg.close(); return; }
      await say('Reading DEM...');
      const dem = await AV.readRasterFull(resolve(app, quoteless(f.DEM)));
      const [c0, c1, c2] = dem.corners; const W = dem.w, H = dem.h; const px = (c1[0] - c0[0]) / W, py = (c0[1] - c2[1]) / H;
      const nod = dem.nodata;
      const sample = (x, y) => { const i = Math.floor((x - c0[0]) / px), j = Math.floor((c0[1] - y) / py); if (i < 0 || j < 0 || i >= W || j >= H) return null; const v = dem.data[j * W + i];
        if (!isFinite(v) || Math.abs(v) > 1e30 || (nod !== null && Math.abs(v - nod) <= Math.max(1e-6, Math.abs(nod) * 1e-6))) return null; return v; };
      const lines = async (key, what) => { if (!f[key]) return []; const L = await readVector(app, f[key], what); return L.features.filter(x => x.type === 'line' || x.type === 'polygon'); };
      const cut = (await lines('CUTOFF', 'Cut-off')).flatMap(x => x.coords);
      const coast = (await lines('WATERFRONT', 'Water front')).flatMap(x => x.coords.map(pts => ({ pts, elev: numProp(x.props, ['elev', 'elevation', 'stage', 'z']) })));
      const defT = AV.exclusionType(f.EXCL_TYPE, 'VOID'), defH = parseFloat(f.EXCL_HEIGHT) >= 0 && f.EXCL_HEIGHT !== '' ? parseFloat(f.EXCL_HEIGHT) : (AV.f2dRun(m).si ? 0.3 : 1.0), defP = parseFloat(f.EXCL_POROSITY) > 0 ? Math.min(1, parseFloat(f.EXCL_POROSITY)) : 0.5;
      const exL = f.EXCLUSION ? await readVector(app, f.EXCLUSION, 'Exclusion') : null;
      const exclusion = exL ? exL.features.filter(x => x.type === 'polygon').map(x => { const hh = numProp(x.props, ['height', 'bheight', 'h', 'raise']), pp = numProp(x.props, ['porosity', 'por']);
        return { rings: x.coords, type: AV.exclusionType(strProp(x.props, ['type', 'btype', 'mode', 'exclusion']), defT), height: isFinite(hh) && hh >= 0 ? hh : defH, porosity: pp > 0 && pp <= 1 ? pp : defP }; }) : [];
      const zones = [];
      if (tri) for (const [key, what] of [['MESH_ZONES', 'Mesh zones'], ['BREAK_LINES', 'Break lines']]) if (f[key]) for (const x of (await readVector(app, f[key], what)).features) { const sz = numProp(x.props, ['size', 'length', 'cellsize']);
        if (x.type === 'polygon') zones.push({ kind: 'polygon', coords: x.coords, size: sz }); else if (x.type === 'line') for (const pts of x.coords) zones.push({ kind: 'line', coords: pts, size: sz }); }
      // 1D nodes to couple: those tagged "Link2D" (Avaris DS) when any node has that tag, otherwise every junction / storage / divider
      const N = [...m.nodes.values()].filter(n => n.type !== 'OUTFALL'); const tagged = N.filter(n => /^link2d$/i.test(String(n.tag || '').trim()));
      const nodes = (tagged.length ? tagged : N).map(n => ({ id: n.id, x: n.x, y: n.y }));
      await say('Building the mesh...');
      const mesh = tri ? AV.buildUMesh({ boundary, exclusion, cutoff: cut, coast, sample, nodes, lenFactor, zones, progress: (t) => { dlg.body.textContent = t; } })
        : AV.buildMesh2D({ boundary, exclusion, cutoff: cut, coast, sample, nodes, lenFactor });
      if (!mesh.cells.length) throw new Error('No cells were created: check that the boundary overlaps the DEM and that the cell size is smaller than the boundary.');
      mesh.source = { boundary: f.BOUNDARY, dem: f.DEM, cutoff: f.CUTOFF, waterfront: f.WATERFRONT, exclusion: f.EXCLUSION, zones: tri ? f.MESH_ZONES : undefined, breakLines: tri ? f.BREAK_LINES : undefined, cellSize: boundary.map(b => b.size), roughness: boundary.map(b => b.n) };
      const mp = AV.meshPath(app); if (mp) await window.host.writeText(mp, JSON.stringify(mesh));
      AV.prepMesh(mesh); app.mesh2d = mesh; app.meshResults = null; app._meshHeat = null; app._meshRange = null; dlg.close();
      app.panels.refreshLayers(); app.map.redraw();
      const s = mesh.stats; if (quiet) { app.status('2D mesh rebuilt: ' + s.cells + ' cells.'); return; }
      const rec = AV.meshRecStep(m, mesh); const cur = parseFloat(f.ROUTING_STEP) > 0 ? parseFloat(f.ROUTING_STEP) : parseFloat(m.options.ROUTING_STEP) || 0;
      await AV.alert('Mesh created (' + (tri ? 'unstructured' : 'square grid') + '):\n\n' + s.cells.toLocaleString() + ' cells' + (tri ? ' (' + s.triangles.toLocaleString() + ' triangles' + (s.quads ? ', ' + s.quads + ' small triangles merged into quadrilaterals' : '') + '; cell size ' : ' (') + boundary.map(b => b.size).join(', ') + ' ' + (mapU === 'NONE' ? 'map units' : mapU.toLowerCase()) + ')\n' + s.links.toLocaleString() + ' surface links\n' + s.couplings + ' manholes coupled to the surface' + (tagged.length ? ' (nodes tagged Link2D)' : '') + '\n' + s.outfalls + ' water-front outfalls' +
        (tri ? '\nSmallest triangle angle ' + s.minAngle + '°' + (s.below20 ? ' (' + s.below20 + ' triangles below 20°)' : '') + (zones.length ? '\n' + zones.length + ' mesh zones / break lines' : '') : '') +
        (s.skippedExcl ? '\n' + s.skippedExcl + (tri ? ' triangles' : ' cells') + ' removed by VOID exclusion polygons' : '') + (s.raised ? '\n' + s.raised + ' cells raised (RAISED exclusion polygons)' : '') + (s.porous ? '\n' + s.porous + ' porous cells (POROUS exclusion polygons)' : '') +
        (s.skippedNoData ? '\n' + s.skippedNoData + ' cells skipped (no DEM data)' : '') + (rec ? '\n\nShortest surface links about ' + AV.fmt(rec.len, 1) + ' ' + (AV.f2dRun(m).si ? 'm' : 'ft') + ': a 2D routing step of ' + rec.step + ' s or less is recommended (now ' + (cur || '-') + ' s).' : '') +
        (mp ? '\n\nSaved to ' + mp : '\n\nSave the model to keep the mesh.') + '\n\nRun the simulation to compute the 1D-2D flooding.', 'Create Meshes');
      if (rec && cur > rec.step * 1.25 && await AV.confirm('The 2D routing step (' + cur + ' s) is long for the smallest cells of this mesh; runs may not converge or may lose water. Set the 2D routing step to ' + rec.step + ' s?', 'Create Meshes', 'Set ' + rec.step + ' s', 'Keep ' + cur + ' s')) {
        const old2 = m.osem2d ? Object.assign({}, m.osem2d) : null; const nw2 = Object.assign({}, m.osem2d || {}, { ROUTING_STEP: String(rec.step) });
        app.exec({ label: '2D routing step', do: () => { m.osem2d = Object.assign({}, nw2); }, undo: () => { m.osem2d = old2 ? Object.assign({}, old2) : undefined; }, changes: [{ o: { kind: 'OPTIONS', id: 'Options', type: '' }, key: '2D ROUTING_STEP', old: f.ROUTING_STEP, nw: String(rec.step) }] }); }
    } catch (e) { console.error(e); dlg.close(); if (quiet) { app.status('2D mesh not built: ' + e.message); return; } AV.alert('Could not create the mesh:\n\n' + e.message, 'Create Meshes'); }
  };
  AV.loadMesh2D = async function (app) {
    app.mesh2d = null; app.meshResults = null; app._meshRemoved = false; const mp = AV.meshPath(app); if (!mp) return;
    try { if (await window.host.exists(mp)) { const j = JSON.parse(await window.host.readText(mp)); app.mesh2d = j && j.cells ? AV.prepMesh(j) : null; app._meshRemoved = !app.mesh2d; } } catch (e) { app.mesh2d = null; }
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
  // 2D flood results of every cell, from one pass over the .out file (outreader mesh2d):
  //   maxd / tpond / trecede, max velocity (+ its x / y components), max hazard rating, max depth x velocity,
  //   flood arrival time (first time above the flood depth), time of the max depth.
  // Cell velocity = average over its x faces and y faces of the velocity of the 2D links (2DL_*), Q / (w y) with w the
  //   width of the link (the Manning velocity the engine computes for that face; also written as link velocity).
  // Hazard rating (Defra / EA FD2320-FD2321): HR = d (v + 0.5) + DF in m and m/s, DF by depth (AV.HAZARD_DF).
  AV.HAZARD_DF = {
    conservative: { short: 'Conservative', label: 'Conservative (DF 0.5 up to 0.25 m, 1.0 above)', df: [0, 0.5, 0.25, 1.0] },
    pasture: { short: 'Pasture / arable', label: 'Pasture / arable (DF 0 up to 0.25 m, 0.5 above)', df: [0.25, 0.5, 1e9, 0] },
    none: { short: 'None', label: 'No debris factor', df: [1e9, 0, 1e9, 0] } };
  AV.meshDF = (app) => { const P = app.prefs.mesh2d || {}; return (AV.HAZARD_DF[P.df] || AV.HAZARD_DF.conservative).df; };
  // faces of the mesh in the results: flat [link index, cell a, cell b] + face width (model units) + unit direction
  // (x, y) from the centre of a to the centre of b. A cell's velocity vector is the least-squares fit to the normal
  // velocities of its faces (for the square grid: the mean of its x faces and of its y faces, as before).
  function meshFaces(app, R0) {
    const R = R0 || app.results, mesh = app.mesh2d; const ci = new Map(mesh.cells.map((c, k) => [c.id, k])); const lf = mesh.lenFactor || 1;
    const F = [], W = [], Dd = [];
    for (const l of mesh.links || []) { const a = ci.get(l.a), b = ci.get(l.b); if (a === undefined || b === undefined) continue; const li = R.idx.link.get(l.id); if (li === undefined) continue;
      const A = mesh.cells[a], B = mesh.cells[b]; let dx = B.x - A.x, dy = B.y - A.y;
      if (!mesh.verts) { if (Math.abs(dx) >= Math.abs(dy)) { dx = Math.sign(dx) || 1; dy = 0; } else { dy = Math.sign(dy) || 1; dx = 0; } } else { const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; }
      F.push(li, a, b); W.push(l.w > 0 ? +l.w : Math.min(A.s, B.s) / 2 * lf); Dd.push(dx, dy); }
    return { F: Int32Array.from(F), W: Float32Array.from(W), D: Float32Array.from(Dd) };
  }
  // velocity vector from the sums of n n' and n u over the faces of a cell
  AV.lsVel = (sxx, sxy, syy, sxu, syu) => { const tr = sxx + syy; if (!(tr > 0)) return [0, 0]; const det = sxx * syy - sxy * sxy;
    if (det > 1e-6 * tr * tr) return [(syy * sxu - sxy * syu) / det, (sxx * syu - sxy * sxu) / det]; return [sxu / tr, syu / tr]; };
  AV.computeMeshResults = async function (app) {
    const R = app.results, mesh = app.mesh2d; if (!R || !mesh || !AV.has2D(app)) { app.meshResults = null; return; }
    const idx = mesh.cells.map(c => { const i = R.idx.node.get(c.id); return i === undefined ? -1 : i; });
    if (!idx.some(i => i >= 0)) { app.meshResults = null; return; }
    const thr = parseFloat(AV.f2d(app.model).FLOOD_DEPTH) || 0; const si = AV.f2dRun(app.model).si; const siK = si ? 1 : 0.3048; const df = AV.meshDF(app);
    const faces = meshFaces(app);
    let st = null; try { st = await AV.busy.track(window.host.outMesh2d(R.handle, idx, Array.from(faces.F), Array.from(faces.W), thr, siK, df, Array.from(faces.D)), 'Computing 2D flood statistics'); } catch (e) { console.error(e); st = null; }
    const n = idx.length, nv = R.meta.nVars.node; const nan = () => new Float32Array(n).fill(NaN);
    if (!st) { st = { maxd: new Float32Array(n), maxv: nan(), vxm: nan(), vym: nan(), maxhr: nan(), maxdv: nan(), arrive: nan(), tmax: nan(), tpond: nan(), trecede: nan() };
      idx.forEach((i, c) => { st.maxd[c] = i < 0 ? NaN : R.stats.node.max[i * nv]; }); }
    app.meshResults = { idx, maxd: st.maxd, tpond: st.tpond, trecede: st.trecede, maxv: st.maxv, vxm: st.vxm, vym: st.vym, maxhr: st.maxhr, maxdv: st.maxdv, arrive: st.arrive, tmax: st.tmax,
      thr, si, siK, df, faces, nFaces: faces.W.length };
    app._meshDyn = null; app.emit && app.emit('meshresults');
  };
  // 2D statistics of any results source with the cells of the current mesh (Scenario Comparison, flood comparison),
  // cached on the source: { maxd, maxv, maxhr, maxdv, arrive, tmax, tpond, trecede } in the order of mesh.cells (NaN = not in that run)
  AV.meshStatsFor = async function (app, R) {
    const mesh = app.mesh2d; if (!mesh || !R) return null; const df = AV.meshDF(app); const key = mesh.cells.length + '|' + df.join(',');
    if (R._m2d && R._m2d.key === key) return R._m2d.st;
    if (app.results === R && app.meshResults && app.meshResults.df.join(',') === df.join(',')) { const M = app.meshResults; const st = { maxd: M.maxd, maxv: M.maxv, maxhr: M.maxhr, maxdv: M.maxdv, arrive: M.arrive, tmax: M.tmax, tpond: M.tpond, trecede: M.trecede }; R._m2d = { key, st }; return st; }
    const idx = mesh.cells.map(c => { const i = R.idx.node.get(c.id); return i === undefined ? -1 : i; }); if (!idx.some(i => i >= 0)) return null;
    const thr = parseFloat(AV.f2d(app.model).FLOOD_DEPTH) || 0; const siK = AV.f2dRun(app.model).si ? 1 : 0.3048; const faces = meshFaces(app, R);
    const st = await AV.busy.track(window.host.outMesh2d(R.handle, idx, Array.from(faces.F), Array.from(faces.W), thr, siK, df, Array.from(faces.D)), 'Computing the 2D statistics of ' + (R.scenName || 'the run'));
    R._m2d = { key, st }; return st;
  };
  // current-time velocity / hazard of every cell (from the link snapshot of the current period), cached per snapshot
  AV.meshDynamic = function (app) {
    const R = app.results, MR = app.meshResults; if (!R || !MR || !R.snap || !R.snap.link || !R.snap.node) return null;
    if (app._meshDyn && app._meshDyn.snap === R.snap.link) return app._meshDyn;
    const n = MR.idx.length, nvL = R.meta.nVars.link, nvN = R.meta.nVars.node, L = R.snap.link, N = R.snap.node; const { F, W, D } = MR.faces;
    const S = new Float64Array(5 * n);
    for (let j = 0; j < W.length; j++) { const li = F[3 * j], q = L[li * nvL], y = L[li * nvL + 1]; const u = y > 0.003 && W[j] > 0 ? q / (W[j] * y) : 0; const ux = D[2 * j], uy = D[2 * j + 1];
      for (const c of [F[3 * j + 1], F[3 * j + 2]]) { const o = 5 * c; S[o] += ux * ux; S[o + 1] += ux * uy; S[o + 2] += uy * uy; S[o + 3] += ux * u; S[o + 4] += uy * u; } }
    const vel = new Float32Array(n).fill(NaN), hzd = new Float32Array(n).fill(NaN), vx = new Float32Array(n), vy = new Float32Array(n); const df = MR.df, K = MR.siK;
    for (let c = 0; c < n; c++) { if (MR.idx[c] < 0) continue; const d = N[MR.idx[c] * nvN]; const o = 5 * c; const vv = AV.lsVel(S[o], S[o + 1], S[o + 2], S[o + 3], S[o + 4]); vx[c] = vv[0]; vy[c] = vv[1]; const v = Math.hypot(vx[c], vy[c]); vel[c] = v;
      const dm = d * K; hzd[c] = d > MR.thr ? dm * (v * K + 0.5) + (dm > df[2] ? df[3] : dm > df[0] ? df[1] : 0) : 0; }
    return (app._meshDyn = { snap: L, vel, hzd, vx, vy });
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
    if (field === 'maxwse') return MR.maxd[k] > 0 ? c.elev + MR.maxd[k] : null;
    if (field === 'maxvel') return MR.maxv[k];
    if (field === 'hazard') return MR.maxhr[k];
    if (field === 'dv') return MR.maxdv[k];
    if (field === 'arrival') return MR.arrive[k];
    if (field === 'tmax') return MR.maxd[k] > MR.thr ? MR.tmax[k] : NaN;
    if (field === 'ddepth' && MR.cmp && MR.cmp.diff) return isFinite(MR.cmp.diff[k]) ? MR.cmp.diff[k] : null;
    if (field === 'ddepth') return MR.cmp && isFinite(MR.cmp.maxd[k]) && isFinite(MR.maxd[k]) && (MR.maxd[k] > 0 || MR.cmp.maxd[k] > 0) ? MR.maxd[k] - MR.cmp.maxd[k] : null;
    if (field === 'vel' || field === 'hzd') { const D = AV.meshDynamic(app); return D ? D[field][k] : null; }
    return null;
  };
  const FIELDS = { depth: 'Depth (current time)', wse: 'Water Surface Elev. (current time)', vel: 'Velocity (current time)', hzd: 'Hazard Rating (current time)',
    maxdepth: 'Max. Depth', maxwse: 'Max. Water Surface Elev.', maxvel: 'Max. Velocity', hazard: 'Max. Hazard Rating', dv: 'Max. Depth x Velocity',
    arrival: 'Flood Arrival Time (hr)', tmax: 'Time of Max. Depth (hr)', tpond: 'Time Ponded (hr)', trecede: 'Time to Recede (hr)', ddepth: 'Max. Depth Difference (vs. compared run)', elev: 'Ground Elevation' };
  AV.MESH_GROUPS = [['Current time step (play mode)', ['depth', 'wse', 'vel', 'hzd']], ['Statistic results (whole run)', ['maxdepth', 'maxwse', 'maxvel', 'hazard', 'dv', 'arrival', 'tmax', 'tpond', 'trecede', 'ddepth']], ['Static properties', ['elev']]];
  // unit of a field for legends / tables
  AV.meshUnit = (app, f) => { const si = AV.meshSI(app); if (/^(tpond|trecede|arrival|tmax)$/.test(f)) return 'hr'; if (f === 'hazard' || f === 'hzd') return '-';
    if (f === 'vel' || f === 'maxvel') return si ? 'm/s' : 'ft/s'; if (f === 'dv') return si ? 'm²/s' : 'ft²/s'; return si ? 'm' : 'ft'; };
  // hazard classes (Defra FD2320): label of a hazard rating
  AV.HAZARD_CLASSES = [[0.75, 'Low (caution)'], [1.25, 'Danger for some'], [2.0, 'Danger for most'], [Infinity, 'Danger for all']];
  AV.hazardClass = (hr) => { for (const [b, l] of AV.HAZARD_CLASSES) if (hr < b) return l; return ''; };
  AV.MESH_FIELDS = FIELDS;
  // ramps for the flood map (also listed in the ramp picker)
  AV.RAMPS['Flood Depth'] = ['#bdeeff', '#5fd0ff', '#1e9bff', '#1659ff', '#0d2fc4', '#08156e'];
  AV.RAMPS['Flood Time'] = ['#fff3b0', '#ffd166', '#f8961e', '#e85d04', '#c1121f', '#6a040f'];
  AV.RAMPS['Terrain'] = ['#2e7d32', '#aed581', '#fff176', '#bc8c5c', '#f5f5f5'];
  AV.RAMPS['Flood Hazard'] = ['#8bc34a', '#ffeb3b', '#ff9800', '#d50000'];
  AV.RAMPS['Depth Difference'] = ['#1a9850', '#f7f7f7', '#fee08b', '#fc8d59', '#d73027'];
  AV.RAMPS['Velocity'] = ['#e0f7fa', '#80deea', '#26c6da', '#7e57c2', '#c2185b', '#4a0072'];
  const DEF_RAMP = { depth: 'Flood Depth', maxdepth: 'Flood Depth', tpond: 'Flood Time', trecede: 'Flood Time', arrival: 'Flood Time', tmax: 'Flood Time', wse: 'Terrain', maxwse: 'Terrain', elev: 'Terrain',
    vel: 'Velocity', maxvel: 'Velocity', dv: 'Velocity', hazard: 'Flood Hazard', hzd: 'Flood Hazard', ddepth: 'Depth Difference' };
  AV.MESH_CONTINUOUS = {}; // every variable is shown by ranges (classes) that can be edited
  AV.MESH_DYNAMIC = { depth: true, wse: true, vel: true, hzd: true };
  // variable shown: in play mode a current-time variable (depth / water surface) unless a static / statistic one was
  // chosen while playing; outside play mode only statistic and static variables (current-time values need Play)
  AV.meshField = (app) => { const P = app.prefs.mesh2d || (app.prefs.mesh2d = {}); const stat = FIELDS[P.field] && !AV.MESH_DYNAMIC[P.field] && !(P.field === 'ddepth' && !(app.meshResults && app.meshResults.cmp)) ? P.field : 'maxdepth';
    return app.playMode && AV.MESH_DYNAMIC[P.playField] ? P.playField : stat; };
  AV.meshDefaultBreaks = (app, field) => { const si = AV.meshSI(app);
    const fixed = { depth: si ? [0.05, 0.15, 0.3, 0.5, 1.0] : [0.15, 0.5, 1, 1.5, 3], maxdepth: si ? [0.05, 0.15, 0.3, 0.5, 1.0] : [0.15, 0.5, 1, 1.5, 3], tpond: [0.25, 0.5, 1, 2, 4], trecede: [0.25, 0.5, 1, 2, 4],
      vel: si ? [0.1, 0.5, 1, 2, 3] : [0.3, 1.5, 3, 6, 10], maxvel: si ? [0.1, 0.5, 1, 2, 3] : [0.3, 1.5, 3, 6, 10], dv: si ? [0.01, 0.1, 0.3, 0.6, 1.0] : [0.1, 1, 3, 6, 10],
      hazard: [0.01, 0.75, 1.25, 2.0], hzd: [0.01, 0.75, 1.25, 2.0], ddepth: app.meshResults && app.meshResults.cmp && app.meshResults.cmp.breaks ? app.meshResults.cmp.breaks : si ? [-0.1, -0.02, 0.02, 0.1, 0.3] : [-0.3, -0.05, 0.05, 0.3, 1] }[field];
    if (field === 'arrival' || field === 'tmax') { const T = app.results ? app.results.times : null; const D = T && T.length ? T[T.length - 1] : 24; const st = D / 6; return [0, 1, 2, 3, 4, 5].map(i => +(i * st).toPrecision(3)); }
    if (fixed) return fixed;
    // elevation / water surface: 5 equal classes over the ground elevations of the mesh
    let [a, b] = app.mesh2d ? AV.meshRange(app, 'elev') : [0, 1]; if (!isFinite(a) || !(b > a)) { a = 0; b = 100; }
    const st = (b - a) / 5; return [0, 1, 2, 3, 4].map(i => +(a + i * st).toPrecision(4)); };
  // style of the Meshes layer (set in the Symbology pane). Class i colours values from breaks[i] up to breaks[i+1];
  // values below the first break are not coloured (dry).
  AV.meshStyle = function (app) {
    // play mode shows a dynamic variable (depth / water surface), otherwise a statistic or static one
    const P = app.prefs.mesh2d || (app.prefs.mesh2d = {}); const field = AV.meshField(app);
    const ramp = (P.ramp && P.ramp[field]) || DEF_RAMP[field], invert = !!(P.invert && P.invert[field]);
    let breaks = null, colors = null;
    if (!AV.MESH_CONTINUOUS[field]) { const cls = P.classes && P.classes[field];
      if (cls && cls.length) { breaks = cls.map(c => +c.v); colors = cls.map(c => c.color); } else { breaks = AV.meshDefaultBreaks(app, field); colors = AV.rampColors(ramp, breaks.length, invert); } }
    return { field, breaks, colors, ramp, invert, opacity: P.opacity === undefined ? 0.8 : P.opacity, outline: P.outline !== false, visible: P.visible !== false, arrows: !!P.arrows, heat: P.render === 'heatmap' };
  };
  const rampAt = (name, t, inv) => { const R = AV.RAMPS[name] || AV.RAMPS['Terrain']; if (inv) t = 1 - t; t = Math.max(0, Math.min(1, t)); const x = t * (R.length - 1), k = Math.min(R.length - 2, Math.floor(x)), f = x - k;
    const c1 = R[k], c2 = R[k + 1]; const g = (c, i) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16); return 'rgb(' + [0, 1, 2].map(i => Math.round(g(c1, i) + (g(c2, i) - g(c1, i)) * f)).join(',') + ')'; };
  AV.meshRange = (app, field) => { const r = app._meshRange || (app._meshRange = {}); if (!r[field]) { let a = Infinity, b = -Infinity; for (let i = 0; i < app.mesh2d.cells.length; i++) { const x = AV.cellValue(app, i, field); if (x !== null && isFinite(x)) { a = Math.min(a, x); b = Math.max(b, x); } } r[field] = [a, b]; } return r[field]; };
  // colour of a cell, or null when it is dry / has no value (only the outline is drawn)
  AV.meshColor = function (app, k, S) {
    const v = AV.cellValue(app, k, S.field); if (v === null || !isFinite(v)) return null;
    if (!S.breaks) { const [a, b] = AV.meshRange(app, S.field); return rampAt(S.ramp, b > a ? (v - a) / (b - a) : 0.5, S.invert); }
    if (v < S.breaks[0]) return S.field === 'ddepth' ? S.colors[0] : null;
    let c = S.colors[S.colors.length - 1]; for (let i = 1; i < S.breaks.length; i++) if (v < S.breaks[i]) { c = S.colors[i - 1]; break; }
    return c;
  };
  // ---- heat map rendering: the cell values on a raster at the finest cell size, coloured continuously through the
  // class colours (colour i at break i), drawn with bilinear smoothing and a slight blur -> smooth surface, soft wet edge
  const rgbOf = (c) => { c = String(c).trim(); let m = /^#([0-9a-f]{3})$/i.exec(c); if (m) return [...m[1]].map(x => parseInt(x + x, 16));
    m = /^#([0-9a-f]{6})/i.exec(c); if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)); m = /rgba?\(([^)]+)\)/i.exec(c); if (m) return m[1].split(',').slice(0, 3).map(x => Math.round(+x)); return [128, 128, 128]; };
  AV.meshHeatColor = function (app, S, v, cache) {
    if (v === null || !isFinite(v)) return null;
    if (!S.breaks) { const [a, b] = AV.meshRange(app, S.field); return rgbOf(rampAt(S.ramp, b > a ? (v - a) / (b - a) : 0.5, S.invert)); }
    const B = S.breaks, C = cache || S.colors.map(rgbOf); if (v < B[0]) return S.field === 'ddepth' ? C[0] : null;
    if (v >= B[B.length - 1]) return C[C.length - 1];
    for (let i = 1; i < B.length; i++) if (v < B[i]) { const f = B[i] > B[i - 1] ? (v - B[i - 1]) / (B[i] - B[i - 1]) : 0; return [0, 1, 2].map(j => Math.round(C[i - 1][j] + (C[i][j] - C[i - 1][j]) * f)); }
    return C[C.length - 1];
  };
  function heatImage(app, S) {
    const mesh = app.mesh2d, cells = mesh.cells, R = app.results;
    const key = [S.field, JSON.stringify(S.breaks), JSON.stringify(S.colors), S.ramp, S.invert, app.meshResults && app.meshResults.cmp ? app.meshResults.cmp.name + ':' + app.meshResults.cmp.label : ''].join('|');
    const H = app._meshHeat; if (H && H.key === key && H.mesh === mesh && H.MR === app.meshResults && (!AV.MESH_DYNAMIC[S.field] || H.snap === (R && R.snap && R.snap.node))) return H;
    let s0 = Infinity, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const tri = !!mesh.verts;
    for (const c of cells) { const b = AV.cellBox(c); s0 = Math.min(s0, tri ? c.s / 1.5 : c.s); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    const cap = AV.MESH_DYNAMIC[S.field] ? 1.5e6 : 4e6; let px = s0; const n0 = ((x1 - x0) / s0) * ((y1 - y0) / s0); if (n0 > cap) px = s0 * Math.ceil(Math.sqrt(n0 / cap));
    const pad = 2; const nc = Math.max(1, Math.round((x1 - x0) / px)) + 2 * pad, nr = Math.max(1, Math.round((y1 - y0) / px)) + 2 * pad;
    const cv = document.createElement('canvas'); cv.width = nc; cv.height = nr; const g = cv.getContext('2d'); const img = g.createImageData(nc, nr); const D = img.data;
    const Cc = S.breaks ? S.colors.map(rgbOf) : null;
    if (tri) { // polygons drawn into the raster
      g.imageSmoothingEnabled = false;
      for (let k = 0; k < cells.length; k++) { const c = cells[k]; const col = AV.meshHeatColor(app, S, AV.cellValue(app, k, S.field), Cc); if (!col) continue; const P = AV.cellPoly(c);
        g.fillStyle = 'rgb(' + col.join(',') + ')'; g.beginPath(); P.forEach((q, i) => { const X = pad + (q[0] - x0) / px, Y = pad + (y1 - q[1]) / px; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath(); g.fill(); g.strokeStyle = g.fillStyle; g.lineWidth = 0.6; g.stroke(); }
    } else {
    for (let k = 0; k < cells.length; k++) { const c = cells[k]; const col = AV.meshHeatColor(app, S, AV.cellValue(app, k, S.field), Cc); if (!col) continue;
      const i0 = pad + Math.round((c.x - c.s / 2 - x0) / px), j0 = pad + Math.round((y1 - (c.y + c.s / 2)) / px), n = Math.max(1, Math.round(c.s / px));
      for (let j = j0; j < j0 + n && j < nr; j++) for (let i = i0; i < i0 + n && i < nc; i++) { const o = (j * nc + i) * 4; D[o] = col[0]; D[o + 1] = col[1]; D[o + 2] = col[2]; D[o + 3] = 255; } }
    g.putImageData(img, 0, 0); }
    // slight blur (about half a cell) so the blocks blend into a continuous surface
    const out = document.createElement('canvas'); out.width = nc; out.height = nr; const go = out.getContext('2d'); try { go.filter = 'blur(' + (0.75) + 'px)'; } catch (e) { /* no filter */ } go.drawImage(cv, 0, 0);
    return (app._meshHeat = { key, mesh, MR: app.meshResults, snap: R && R.snap && R.snap.node, canvas: out, x0: x0 - pad * px, y1: y1 + pad * px, w: nc * px, h: nr * px });
  }
  AV.drawMesh = function (map, ctx) {
    const app = map.app, mesh = app.mesh2d; if (!mesh || !mesh.cells.length || (app.partView && app.partView.P)) return; const S = AV.meshStyle(app); if (!S.visible) return;
    const vb = map.visibleBox(); const sc = map.scale; const cells = mesh.cells; const big = cells.length > 60000;
    if (S.heat && !app.themeHidden && (app.meshResults || S.field === 'elev')) {
      const Hm = heatImage(app, S); const [sx, sy] = map.toScreen(Hm.x0, Hm.y1);
      ctx.save(); ctx.globalAlpha = S.opacity; ctx.imageSmoothingEnabled = true; try { ctx.imageSmoothingQuality = 'high'; } catch (e) { /* old */ }
      ctx.drawImage(Hm.canvas, sx, sy, Hm.w * sc, Hm.h * sc); ctx.restore();
      if (S.arrows && app.meshResults) drawArrows(map, ctx, vb);
      return;
    }
    const groups = new Map(); const outline = new Path2D(); let nOut = 0;
    if (mesh.verts) { // unstructured: polygons
      for (let k = 0; k < cells.length; k++) { const c = cells[k], b = AV.cellBox(c); if (b[2] < vb.x1 || b[0] > vb.x2 || b[3] < vb.y1 || b[1] > vb.y2) continue;
        const P = AV.cellPoly(c); const col = app.themeHidden ? null : AV.meshColor(app, k, S); const wpx = c.s * sc; const ol = (S.outline || app.themeHidden) && wpx > 5 && !big;
        if (!col && !ol) continue; const path = new Path2D(); P.forEach((q, i) => { const [x, y] = map.toScreen(q[0], q[1]); i ? path.lineTo(x, y) : path.moveTo(x, y); }); path.closePath();
        if (col) { let g = groups.get(col); if (!g) groups.set(col, g = new Path2D()); g.addPath(path); }
        if (ol) { outline.addPath(path); nOut++; } }
    } else
    for (let k = 0; k < cells.length; k++) { const c = cells[k], hs = c.s / 2; if (c.x + hs < vb.x1 || c.x - hs > vb.x2 || c.y + hs < vb.y1 || c.y - hs > vb.y2) continue;
      const [x, y] = map.toScreen(c.x - hs, c.y + hs); const w = c.s * sc; const col = app.themeHidden ? null : AV.meshColor(app, k, S);
      if (col) { let p = groups.get(col); if (!p) groups.set(col, p = new Path2D()); p.rect(x, y, w, w); }
      if ((S.outline || app.themeHidden) && w > 4 && !big) { outline.rect(x, y, w, w); nOut++; } }
    ctx.save(); ctx.globalAlpha = S.opacity; for (const [col, p] of groups) { ctx.fillStyle = col; ctx.fill(p); } ctx.globalAlpha = 1;
    if (nOut) { ctx.strokeStyle = 'rgba(80,96,110,.35)'; ctx.lineWidth = 0.6; ctx.stroke(outline); }
    ctx.restore();
    if (S.arrows && app.meshResults && !app.themeHidden) drawArrows(map, ctx, vb);
  };
  // flow direction arrows (current time in play mode, at the max velocity otherwise) on cells at least 12 px wide
  function drawArrows(map, ctx, vb) {
    const app = map.app, MR = app.meshResults, cells = app.mesh2d.cells, sc = map.scale; let VX = MR.vxm, VY = MR.vym;
    if (app.playMode) { const D = AV.meshDynamic(app); if (!D) return; VX = D.vx; VY = D.vy; }
    const vmin = MR.si ? 0.02 : 0.06, vref = MR.si ? 2 : 6; const p = new Path2D(); let n = 0;
    for (let k = 0; k < cells.length; k++) { const c = cells[k], w = c.s * sc * (app.mesh2d.verts ? 0.8 : 1); if (w < 12) continue; const hs = c.s / 2; if (c.x + hs < vb.x1 || c.x - hs > vb.x2 || c.y + hs < vb.y1 || c.y - hs > vb.y2) continue;
      const vx = VX[k], vy = VY[k], v = Math.hypot(vx, vy); if (!(v > vmin)) continue;
      const L = w * (0.3 + 0.55 * Math.min(1, v / vref)); const ux = vx / v, uy = -vy / v; const [cx, cy] = map.toScreen(c.x, c.y);
      const x0 = cx - ux * L / 2, y0 = cy - uy * L / 2, x1 = cx + ux * L / 2, y1 = cy + uy * L / 2; const hl = Math.min(7, L * 0.35);
      p.moveTo(x0, y0); p.lineTo(x1, y1); p.moveTo(x1 - ux * hl - uy * hl * 0.55, y1 - uy * hl + ux * hl * 0.55); p.lineTo(x1, y1); p.lineTo(x1 - ux * hl + uy * hl * 0.55, y1 - uy * hl - ux * hl * 0.55); n++; }
    if (!n) return; ctx.save(); ctx.strokeStyle = '#102027'; ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(p); ctx.restore();
  };
  AV.meshHit = function (map, wx, wy) {
    const mesh = map.app.mesh2d; if (!mesh || !AV.meshStyle(map.app).visible) return -1;
    // bucket index (bucket = largest cell size), built once per mesh
    return AV.meshCellAt(mesh, wx, wy);
  };
  // cell containing a point (bucket index by cell centre; bucket = largest cell extent), -1 when none
  AV.meshCellAt = function (mesh, wx, wy) {
    if (!mesh._ix) { let B = 0; for (const c of mesh.cells) { const b = AV.cellBox(c); B = Math.max(B, b[2] - b[0], b[3] - b[1]); } const ix = new Map(); mesh.cells.forEach((c, k) => { const key = Math.floor(c.x / B) + ',' + Math.floor(c.y / B); let a = ix.get(key); if (!a) ix.set(key, a = []); a.push(k); });
      Object.defineProperty(mesh, '_ix', { value: { B, ix }, enumerable: false, writable: true, configurable: true }); }
    const { B, ix } = mesh._ix; const bi = Math.floor(wx / B), bj = Math.floor(wy / B); const tri = !!mesh.verts;
    for (let i = bi - 1; i <= bi + 1; i++) for (let j = bj - 1; j <= bj + 1; j++) { const a = ix.get(i + ',' + j); if (a) for (const k of a) { const c = mesh.cells[k];
      if (!tri) { const hs = c.s / 2; if (Math.abs(wx - c.x) <= hs && Math.abs(wy - c.y) <= hs) return k; continue; }
      const b = AV.cellBox(c); if (wx < b[0] || wx > b[2] || wy < b[1] || wy > b[3]) continue; if (pip(wx, wy, AV.cellPoly(c))) return k; } }
    return -1;
  };
  // legend for result fields (bottom-left of the map)
  AV.drawMeshLegend = function (map, ctx) {
    if (map.app.themeHidden) return;
    const app = map.app; if (!app.mesh2d || !app.mesh2d.cells.length || (app.partView && app.partView.P)) return; const S = AV.meshStyle(app); if (!S.visible) return;
    if (S.field !== 'elev' && !app.meshResults) return;
    const u = AV.meshUnit(app, S.field); const hz = (S.field === 'hazard' || S.field === 'hzd') && AV.HAZARD_CLASSES.every(([b], i) => i === 0 || Math.abs(S.breaks[i] - AV.HAZARD_CLASSES[i - 1][0]) < 1e-9) && S.breaks.length === 4;
    let rows; if (S.breaks) rows = S.breaks.map((b, i) => [S.colors[i], (i === 0 && S.field === 'ddepth' ? '< ' + AV.fmt(S.breaks[1]) : i < S.breaks.length - 1 ? AV.fmt(b) + ' – ' + AV.fmt(S.breaks[i + 1]) : '> ' + AV.fmt(b)) + (hz ? '  ' + AV.HAZARD_CLASSES[i][1] : '')]);
    else { const [a, b] = AV.meshRange(app, S.field); if (!isFinite(a)) return; rows = [0, 0.25, 0.5, 0.75, 1].map(t => [rampAt(S.ramp, t, S.invert), AV.fmt(a + (b - a) * t, 2)]).reverse(); }
    if (S.heat && S.breaks) { const C = S.colors.map(rgbOf), B = S.breaks; const n = B.length; const hb = Math.max(90, n * 22); ctx.font = '11px Segoe UI'; const tw = Math.max(...B.map(b => ctx.measureText('≥ ' + AV.fmt(b)).width)); ctx.font = 'bold 11px Segoe UI'; const W2 = Math.max(tw + 42, ctx.measureText('2D: ' + FIELDS[S.field].replace(/ \(.*\)/, '') + ' (' + u + ')').width + 16), H2 = hb + 30, x = 10, y = map.hgt - H2 - 34;
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.strokeStyle = '#b0bec5'; ctx.fillRect(x, y, W2, H2); ctx.strokeRect(x + .5, y + .5, W2, H2);
      ctx.font = 'bold 11px Segoe UI'; ctx.fillStyle = '#263238'; ctx.textBaseline = 'middle'; const C2 = S.field === 'ddepth' && app.meshResults && app.meshResults.cmp && app.meshResults.cmp.label ? app.meshResults.cmp : null;
      ctx.fillText('2D: ' + (C2 ? C2.label : FIELDS[S.field].replace(/ \(.*\)/, '') + (u === '-' ? '' : ' (' + u + ')')), x + 7, y + 11);
      const gy0 = y + 22, gy1 = gy0 + hb - 8; const gr = ctx.createLinearGradient(0, gy1, 0, gy0); C.forEach((c, i) => gr.addColorStop(n > 1 ? i / (n - 1) : 0, 'rgb(' + c.join(',') + ')'));
      ctx.fillStyle = gr; ctx.fillRect(x + 7, gy0, 16, gy1 - gy0); ctx.strokeStyle = '#90a4ae'; ctx.strokeRect(x + 7.5, gy0 + .5, 15, gy1 - gy0 - 1);
      ctx.font = '11px Segoe UI'; ctx.fillStyle = '#37474f'; B.forEach((b, i) => { const yy = gy1 - (n > 1 ? i / (n - 1) : 0) * (gy1 - gy0); ctx.fillRect(x + 23, yy - .5, 4, 1); ctx.fillText((i === n - 1 ? '≥ ' : '') + AV.fmt(b), x + 31, yy); });
      ctx.restore(); return; }
    const W = hz ? 210 : (S.field === 'ddepth' && app.meshResults && app.meshResults.cmp && app.meshResults.cmp.label ? Math.max(160, 7 * app.meshResults.cmp.label.length + 20) : 160), H = 22 + rows.length * 16, x = 10, y = map.hgt - H - 34;
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.strokeStyle = '#b0bec5'; ctx.fillRect(x, y, W, H); ctx.strokeRect(x + .5, y + .5, W, H);
    ctx.font = 'bold 11px Segoe UI'; ctx.fillStyle = '#263238'; ctx.textBaseline = 'middle'; const C = S.field === 'ddepth' && app.meshResults && app.meshResults.cmp && app.meshResults.cmp.label ? app.meshResults.cmp : null; ctx.fillText('2D: ' + (C ? C.label : FIELDS[S.field].replace(/ \(.*\)/, '') + (u === '-' ? '' : ' (' + u + ')')), x + 7, y + 11);
    ctx.font = '11px Segoe UI'; rows.forEach(([c, t], i) => { const yy = y + 22 + i * 16; ctx.fillStyle = c; ctx.fillRect(x + 7, yy, 18, 11); ctx.fillStyle = '#37474f'; ctx.fillText(t, x + 31, yy + 6); });
    ctx.restore();
  };

  // ------------------------------------------------------------------ mesh style dialog / layer menu / cell info
  // the Meshes layer style is edited in the Symbology pane (right dock), like the other layers
  AV.meshStyleDialog = (app) => app.symPane.open({ mesh: true });
  AV.exportMeshShapefile = async function (app) {
    const mesh = app.mesh2d; if (!mesh) return; const p = await window.host.saveDialog({ title: 'Export 2D mesh', defaultPath: 'Meshes.shp', filters: [{ name: 'Shapefile', extensions: ['shp'] }] }); if (!p) return;
    const RF = [['maxdepth', 'maxdepth', 4], ['maxwse', 'maxwse', 4], ['maxvel', 'maxvel', 4], ['hazard', 'hazard', 3], ['dv', 'maxdv', 4], ['arrival', 'arrival', 3], ['tmax', 'tmax', 3], ['tpond', 'tpond', 3], ['trecede', 'trecede', 3]];
    const feats = mesh.cells.map((c, k) => { const hs = c.s / 2; const props = { id: c.id, elev: c.elev };
      for (const [f, nm, d] of RF) { const v = app.meshResults ? AV.cellValue(app, k, f) : null; props[nm] = v === null || !isFinite(v) ? (f === 'arrival' || f === 'tmax' ? -1 : 0) : +v.toFixed(d); }
      if (app.meshResults) props.hzclass = props.hazard > 0 ? AV.hazardClass(props.hazard) : '';
      props.area = +AV.cellArea(c).toFixed(3); props.btype = c.bt === 1 ? 'RAISED' : c.bt === 2 ? 'POROUS' : '';
      if (!mesh.verts) return { coords: [[[c.x - hs, c.y - hs], [c.x - hs, c.y + hs], [c.x + hs, c.y + hs], [c.x + hs, c.y - hs], [c.x - hs, c.y - hs]]], props };
      const P = AV.cellPoly(c).slice().reverse(); P.push(P[0].slice()); return { coords: [P], props }; });
    const fields = [{ name: 'id', type: 'C', len: 20 }, { name: 'elev', type: 'N', len: 18, dc: 4 }, { name: 'area', type: 'N', len: 18, dc: 3 }, { name: 'btype', type: 'C', len: 8 }].concat(RF.map(([f, nm, d]) => ({ name: nm, type: 'N', len: 18, dc: d })), app.meshResults ? [{ name: 'hzclass', type: 'C', len: 20 }] : []);
    const w = AV.SHP.write('polygon', feats, fields); const base = p.replace(/\.shp$/i, '');
    await window.host.writeBinary(base + '.shp', new Uint8Array(w.shp)); await window.host.writeBinary(base + '.shx', new Uint8Array(w.shx)); await window.host.writeBinary(base + '.dbf', new Uint8Array(w.dbf));
    if (app.crsWKT) await window.host.writeText(base + '.prj', app.crsWKT);
    AV.toast('Mesh exported to ' + base + '.shp');
  };
  // attribute table of the 2D cells: the normal Attribute Table with the '2D Meshes' layer
  AV.meshTable = (app) => { if (!app.mesh2d) { AV.toast('Create the 2D mesh first.', true); return; } AV.openTable(app, 'MESH'); };
  // pseudo node used to plot the depth of a cell with the normal graph tools
  AV.cellNode = (app, k) => { const c = app.mesh2d.cells[k]; return { id: c.id, kind: 'NODE', type: 'JUNCTION', x: c.x, y: c.y, p: { elev: c.elev, maxDepth: 0 }, tag: '', mesh: true }; };
  // ---- selection of 2D cells (separate from the network selection; used by the map, the attribute table and the graphs)
  const IDX = new WeakMap();
  AV.cellIndex = (app, c) => { const mesh = app.mesh2d; if (!mesh) return -1; let m = IDX.get(mesh); if (!m) { m = new Map(mesh.cells.map((x, i) => [x, i])); IDX.set(mesh, m); } const i = m.get(c); return i === undefined ? -1 : i; };
  AV.meshSelSet = (app) => app.meshSelSet || (app.meshSelSet = new Set());
  AV.meshSelect = function (app, cells, add) {
    const S = AV.meshSelSet(app); if (!add) S.clear(); for (const c of cells) S.add(c);
    if (app.selection.size) { app.selection.clear(); app._keepMesh = true; app.onSelectionChanged(); app._keepMesh = false; }
    const last = cells.length ? cells[cells.length - 1] : [...S].pop();
    app.meshSel = last ? AV.cellIndex(app, last) : -1;
    if (S.size === 1 && app.meshSel >= 0) AV.showCellInfo(app, app.meshSel); else { app.panels.showProps(); if (S.size) app.status(S.size + ' 2D cell(s) selected'); }
    app.map.redrawOverlay(); AV.syncTableSelection(app);
  };
  AV.meshClearSel = function (app) { if (app.meshSelSet) app.meshSelSet.clear(); app.meshSel = -1; app.map.redrawOverlay(); AV.syncTableSelection(app); };
  // 2D cell graph: depth (+ ground / water surface), velocity and hazard rating of a cell over time (3 linked charts)
  AV.cellFaces = function (app, k) { const MR = app.meshResults; const { F, W, D } = MR.faces; const L = [], Wd = [], Dd = [];
    for (let j = 0; j < W.length; j++) if (F[3 * j + 1] === k || F[3 * j + 2] === k) { L.push(F[3 * j]); Wd.push(W[j]); Dd.push(D[2 * j], D[2 * j + 1]); } return { L, Wd, Dd }; };
  AV.cellGraph = async function (app, k) {
    const MR = app.meshResults, R = app.results; if (!MR || !R) { AV.toast('Run the 1D-2D model first.', true); return; } const c = app.mesh2d.cells[k];
    const { L, Wd, Dd } = AV.cellFaces(app, k);
    const S = await AV.busy.track(window.host.outCellSeries(R.handle, MR.idx[k], L, Wd, MR.thr, MR.siK, MR.df, Dd), 'Reading the 2D cell results');
    const x = Array.from(R.times); const U = AV.meshSI(app) ? 'm' : 'ft', V = AV.meshUnit(app, 'vel');
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '2px' } });
    const boxes = [0, 1, 2].map(() => { const b = h('div', { style: { flex: 1, minHeight: '120px', display: 'flex' } }); body.appendChild(b); return b; });
    const info = h('div', { class: 'note', style: { padding: '4px 10px' } }, 'Ground ' + AV.fmt(c.elev, 3) + ' ' + U + '  ·  max depth ' + AV.fmt(MR.maxd[k], 3) + ' ' + U + '  ·  max velocity ' + AV.fmt(MR.maxv[k], 3) + ' ' + V +
      '  ·  max hazard ' + AV.fmt(MR.maxhr[k], 2) + (MR.maxhr[k] > 0 ? ' (' + AV.hazardClass(MR.maxhr[k]) + ')' : '') + '  ·  drag to zoom, double-click to reset');
    body.appendChild(info);
    const P = AV.floatPanel({ id: 'cell2d', title: '2D Cell ' + c.id, w: 640, h: 620, body });
    // reopened panel for another cell: rebuild its body
    const fb = P.el ? P.el.querySelector('.fb') : null; if (fb && fb.firstChild !== body) { fb.innerHTML = ''; fb.appendChild(body); } if (P.setTitle) P.setTitle('2D Cell ' + c.id);
    const ch = [new AV.Chart(boxes[0], { title: 'Depth', yLabel: 'Depth (' + U + ')' }), new AV.Chart(boxes[1], { title: 'Velocity', yLabel: 'Velocity (' + V + ')' }), new AV.Chart(boxes[2], { title: 'Hazard Rating', yLabel: 'HR (-)' })];
    for (const q of ch) q.peers = ch.filter(z => z !== q);
    const thr = Array.from(S.d).map(() => MR.thr);
    ch[0].setSeries([{ name: c.id + ' depth', x, y: Array.from(S.d), color: '#1565c0' }, { name: 'Flood depth threshold', x, y: thr, color: '#90a4ae', dash: [6, 4] }]);
    ch[1].setSeries([{ name: c.id + ' velocity', x, y: Array.from(S.v), color: '#6a1b9a' }]);
    const hz = [[0.75, '#ffeb3b'], [1.25, '#ff9800'], [2.0, '#d50000']].map(([v, col]) => ({ name: 'HR ' + v, x, y: x.map(() => v), color: col, dash: [5, 4] }));
    ch[2].setSeries([{ name: c.id + ' hazard rating', x, y: Array.from(S.hr), color: '#263238' }].concat(hz));
    return P;
  };
  AV.showCellInfo = function (app, k, quiet) {
    if (!quiet) { app.meshSel = k; const S = AV.meshSelSet(app), c = app.mesh2d.cells[k]; if (c && !S.has(c)) { S.clear(); S.add(c); AV.syncTableSelection(app); } app.map.redrawOverlay(); }
    const el = AV.$('#props'); if (!el) return; const c = app.mesh2d.cells[k]; el.innerHTML = '';
    const L = AV.meshSI(app) ? 'm' : 'ft'; const f = (v, d) => v === null || v === undefined || !isFinite(v) ? '-' : AV.fmt(v, d);
    el.appendChild(h('div', { class: 'phead' }, h('div', { class: 'pt' }, '2D Cell ' + c.id), h('div', { class: 'ps' }, 'X ' + AV.fmt(c.x, 2) + '   Y ' + AV.fmt(c.y, 2))));
    const rows = [['Ground Elevation (' + L + ')', f(c.elev, 3)], app.mesh2d.verts ? ['Cell Area (map units²)', f(AV.cellArea(c), 1) + (c.v ? (c.v.length === 3 ? '  (triangle)' : '  (' + c.v.length + ' sides)') : '')] : ['Cell Size (map units)', f(c.s)], ['Roughness (n)', f(c.n, 4)], ['Connected Neighbours', String(c.deg)]];
    if (c.bt) rows.push(['Building', c.bt === 1 ? 'Raised (exclusion polygon)' : 'Porous, porosity ' + f(c.por, 2)]);
    const MR = app.meshResults; const V = AV.meshUnit(app, 'vel'), DV = AV.meshUnit(app, 'dv'); const hr = MR ? AV.cellValue(app, k, 'hazard') : null;
    const res = MR ? [['Max. Depth (' + L + ')', f(AV.cellValue(app, k, 'maxdepth'), 3)], ['Max. Water Surface Elev. (' + L + ')', f(c.elev + (AV.cellValue(app, k, 'maxdepth') || 0), 3)],
      ['Max. Velocity (' + V + ')', f(AV.cellValue(app, k, 'maxvel'), 3)], ['Max. Depth x Velocity (' + DV + ')', f(AV.cellValue(app, k, 'dv'), 3)],
      ['Max. Hazard Rating', f(hr, 2) + (hr > 0 ? '  ' + AV.hazardClass(hr) : '')], ['Flood Arrival Time (hr)', f(AV.cellValue(app, k, 'arrival'), 2)], ['Time of Max. Depth (hr)', f(AV.cellValue(app, k, 'tmax'), 2)],
      ['Time Ponded (hr)', f(AV.cellValue(app, k, 'tpond'), 2)], ['Time to Recede (hr)', f(AV.cellValue(app, k, 'trecede'), 2)]] : [];
    const tb = h('table', { class: 'pgrid' }, h('tr', { class: 'pg0' }, h('td', { colspan: 2 }, 'General')), rows.map(([a, b]) => h('tr', null, h('td', { class: 'k' }, a), h('td', { class: 'v' }, h('div', { class: 'ro' }, b)))),
      res.length ? h('tr', { class: 'pg0' }, h('td', { colspan: 2 }, 'Statistic Results')) : null, res.map(([a, b]) => h('tr', { class: 'st' }, h('td', { class: 'k' }, a), h('td', { class: 'v' }, h('div', { class: 'ro' }, b)))));
    el.appendChild(tb);
    // play mode: depth at the current time step (blue card, like the nodes / links)
    if (MR && app.playMode) el.appendChild(h('div', { class: 'rescard' }, h('div', { class: 'rh' }, 'Results at ' + app.results.timeLabel(app.results.period)),
      h('table', null, h('tr', null, h('td', null, 'Depth (' + L + ')'), h('td', { class: 'num' }, f(AV.cellValue(app, k, 'depth'), 3))), h('tr', null, h('td', null, 'Water Surface Elev. (' + L + ')'), h('td', { class: 'num' }, f(AV.cellValue(app, k, 'wse'), 3))),
        h('tr', null, h('td', null, 'Velocity (' + V + ')'), h('td', { class: 'num' }, f(AV.cellValue(app, k, 'vel'), 3))), h('tr', null, h('td', null, 'Hazard Rating'), h('td', { class: 'num' }, f(AV.cellValue(app, k, 'hzd'), 2))))));
    if (MR) el.appendChild(h('div', { style: { padding: '8px 10px', display: 'flex', gap: '6px' } }, h('button', { class: 'btn', title: 'Depth / velocity / hazard rating of this cell over time', onclick: () => AV.cellGraph(app, k) }, '2D Cell Graph'),
      h('button', { class: 'btn', title: 'Depth with the normal graph tools (compare with nodes)', onclick: () => app.feat.graphTool([AV.cellNode(app, k)]) }, 'Graph')));
    if (quiet) return;
    if (app.showRightTab) app.showRightTab('props');
    app.emit('cellselect', k);
  };
})(window.AV);
