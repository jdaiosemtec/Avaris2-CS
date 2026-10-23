// Avaris2 CS - unstructured (triangular) 2D mesh generator (2.9.0)
//
// The 2D surface is covered by triangles that follow the boundary, the exclusion polygons (buildings), the cut-off
// lines, the water front and optional break lines; mesh zones can make the cells finer or coarser locally.
//
//   1. size field: target edge length h(x, y) on a background grid. "Cell size" s means a cell of about the same area
//      as an s x s square, i.e. an equilateral triangle with edge h = s * sqrt(4 / sqrt 3) = 1.52 s. Mesh zones
//      (polygons with a size) and break lines with a size lower it locally; it grows by at most GRADE per unit
//      distance, so cell sizes change gradually.
//   2. points: the constraint lines are sampled at the local h (points closer than 0.35 h are merged, so lines that
//      cross share a point), then the area is filled by a hexagonal lattice grown from a seed point (6 candidates at
//      distance h(p) around every accepted point; a candidate closer than 0.72 h to an existing point is rejected),
//      which gives equilateral triangles where h is uniform.
//   3. Delaunay triangulation (Delaunator, ISC licence); constraint pieces missing from it are split at their midpoint
//      until they appear (conforming Delaunay); free points are smoothed (Laplacian) and triangulated again.
//   4. triangles with the centroid outside the boundary or inside a VOID exclusion polygon are dropped; very small
//      triangles are merged with the neighbour across their longest edge (the cell becomes a quadrilateral).
//
// Cells and links for the engine (same link-node scheme as the square grid, generalised):
//   every pair of cells sharing an edge is joined by a wide open rectangular conduit. T_a = area of the triangle
//   (centroid of a, edge end 1, edge end 2) = the part of cell a that drains through that edge. Each cell's parts are
//   scaled by f_a = A_a / sum of its linked parts (edges on the boundary or on a cut-off line have no link), so the
//   plan area of all links of a cell equals the cell area (for squares this is exactly the Avaris DS rule
//   len = s/2 (4/deg_a + 4/deg_b), w = s/2). Link width w = (T_a + T_b) / L (L = distance between the centroids; half
//   the edge length when the centroid line is normal to the edge, as w = s/2 for squares), link length = plan area / w.
//   Porous cells (exclusion type POROUS): area x porosity, width of their links x porosity. Raised cells (RAISED):
//   ground + height. The engine is not changed.
'use strict';
(function (AV) {
  const SQ = Math.sqrt(4 / Math.sqrt(3)); // edge of the equilateral triangle with the area of a unit square
  const GRADE = 0.35;                       // max. growth of the edge length per unit distance

  // ---------------------------------------------------------------- geometry
  const pip = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) ins = !ins; } return ins; };
  const inRings = (x, y, rings) => { let k = 0; for (const r of rings) if (pip(x, y, r)) k++; return k % 2 === 1; };
  const bboxOf = (rings) => { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const r of rings) for (const p of r) { if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1]; } return [x1, y1, x2, y2]; };
  const segX = (ax, ay, bx, by, cx, cy, dx, dy) => { const d = (px, py, qx, qy, rx, ry) => (rx - px) * (qy - py) - (ry - py) * (qx - px);
    const d1 = d(cx, cy, dx, dy, ax, ay), d2 = d(cx, cy, dx, dy, bx, by), d3 = d(ax, ay, bx, by, cx, cy), d4 = d(ax, ay, bx, by, dx, dy);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0; };
  // index of polygons by bounding box (bucket grid): at(x, y) -> index of the first polygon containing the point, or -1
  function polyIndex(polys, B) {
    const ix = new Map(); const boxes = polys.map(p => bboxOf(p.rings));
    boxes.forEach((b, k) => { for (let i = Math.floor(b[0] / B); i <= Math.floor(b[2] / B); i++) for (let j = Math.floor(b[1] / B); j <= Math.floor(b[3] / B); j++) { const key = i * 1e7 + j; let a = ix.get(key); if (!a) ix.set(key, a = []); a.push(k); } });
    return { at(x, y) { const a = ix.get(Math.floor(x / B) * 1e7 + Math.floor(y / B)); if (!a) return -1; for (const k of a) { const b = boxes[k]; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue; if (inRings(x, y, polys[k].rings)) return k; } return -1; } };
  }
  // segments index: crosses(ax, ay, bx, by) -> true when the segment a-b crosses one of the segments
  function segIndex(segs, B) {
    const ix = new Map();
    segs.forEach((s, k) => { const x1 = Math.min(s[0], s[2]), x2 = Math.max(s[0], s[2]), y1 = Math.min(s[1], s[3]), y2 = Math.max(s[1], s[3]);
      for (let i = Math.floor(x1 / B); i <= Math.floor(x2 / B); i++) for (let j = Math.floor(y1 / B); j <= Math.floor(y2 / B); j++) { const key = i * 1e7 + j; let a = ix.get(key); if (!a) ix.set(key, a = []); a.push(k); } });
    return { crosses(ax, ay, bx, by) { const seen = new Set();
      for (let i = Math.floor(Math.min(ax, bx) / B); i <= Math.floor(Math.max(ax, bx) / B); i++) for (let j = Math.floor(Math.min(ay, by) / B); j <= Math.floor(Math.max(ay, by) / B); j++) { const a = ix.get(i * 1e7 + j); if (!a) continue;
        for (const k of a) { if (seen.has(k)) continue; seen.add(k); const s = segs[k]; if (segX(ax, ay, bx, by, s[0], s[1], s[2], s[3])) return true; } }
      return false; } };
  }

  // ---------------------------------------------------------------- generator
  // opt: as AV.buildMesh2D plus
  //   exclusion: [{ rings, type: 'VOID' | 'RAISED' | 'POROUS', height, porosity }]
  //   zones: [{ kind: 'polygon' | 'line', coords (rings or points), size }]   (size in the cell-size meaning; NaN = break line only)
  //   progress(text)   (optional)
  AV.buildUMesh = function (opt) {
    const lf = opt.lenFactor || 1; const t0 = Date.now(); const D = AV.Delaunator || (typeof Delaunator !== 'undefined' ? Delaunator : null);
    if (!D) throw new Error('Delaunator is not loaded.');
    const Bnd = opt.boundary.map((b, bi) => ({ rings: b.rings, h: b.size * SQ, n: b.n, bi }));
    const excl = (opt.exclusion || []).map(e => Array.isArray(e) ? { rings: e, type: 'VOID' } : e);
    const voids = excl.filter(e => e.type === 'VOID'), others = excl.filter(e => e.type !== 'VOID');
    const zones = opt.zones || [];
    let hmin = Math.min(...Bnd.map(b => b.h)), hmax = Math.max(...Bnd.map(b => b.h));
    for (const z of zones) if (z.size > 0) { hmin = Math.min(hmin, z.size * SQ); hmax = Math.max(hmax, z.size * SQ); }
    const all = bboxOf(Bnd.flatMap(b => b.rings)); const W0 = all[2] - all[0], H0 = all[3] - all[1];
    const bIdx = polyIndex(Bnd, Math.max(hmax * 4, Math.max(W0, H0) / 64)); const vIdx = polyIndex(voids, Math.max(hmax, Math.max(W0, H0) / 256)); const oIdx = polyIndex(others, Math.max(hmax, Math.max(W0, H0) / 256));
    const domain = (x, y) => { const b = bIdx.at(x, y); if (b < 0) return -1; if (voids.length && vIdx.at(x, y) >= 0) return -2; return b; };
    // ---- 1. size field on a background grid
    let g = hmin / 2; if ((W0 / g) * (H0 / g) > 4e6) g = Math.sqrt(W0 * H0 / 4e6);
    const gx = Math.max(1, Math.ceil(W0 / g) + 1), gy = Math.max(1, Math.ceil(H0 / g) + 1); const HF = new Float32Array(gx * gy).fill(hmax);
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) { const b = bIdx.at(all[0] + i * g, all[1] + j * g); if (b >= 0) HF[j * gx + i] = Bnd[b].h; }
    // zone polygons set the size inside (finer or coarser; larger zones first, so a small zone inside a large one wins),
    // then break lines with a size and building outlines can only make it finer
    const zp = zones.filter(z => z.kind === 'polygon' && z.size > 0).map(z => ({ z, bb: bboxOf(z.coords) })).sort((a, b) => (b.bb[2] - b.bb[0]) * (b.bb[3] - b.bb[1]) - (a.bb[2] - a.bb[0]) * (a.bb[3] - a.bb[1]));
    for (const { z, bb } of zp) { const hz = z.size * SQ; for (let j = Math.max(0, Math.floor((bb[1] - all[1]) / g)); j <= Math.min(gy - 1, Math.ceil((bb[3] - all[1]) / g)); j++) for (let i = Math.max(0, Math.floor((bb[0] - all[0]) / g)); i <= Math.min(gx - 1, Math.ceil((bb[2] - all[0]) / g)); i++) if (inRings(all[0] + i * g, all[1] + j * g, z.coords)) HF[j * gx + i] = hz; }
    for (const z of zones) { if (!(z.size > 0) || z.kind === 'polygon') continue; const hz = z.size * SQ;
      for (let k = 1; k < z.coords.length; k++) { const a = z.coords[k - 1], b = z.coords[k]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(L / (g / 2)));
        for (let t = 0; t <= n; t++) { const x = a[0] + (b[0] - a[0]) * t / n, y = a[1] + (b[1] - a[1]) * t / n; const i = Math.round((x - all[0]) / g), j = Math.round((y - all[1]) / g); if (i >= 0 && j >= 0 && i < gx && j < gy) HF[j * gx + i] = Math.min(HF[j * gx + i], hz); } } }
    // building outlines (all exclusion polygons): about 4 points along the outline at least, so the corners are kept
    // (cell size along the outline = perimeter / 4, between 1/4 and 1 x the local size)
    for (const e of excl) for (const r of e.rings) { let per = 0; for (let k = 1; k < r.length; k++) per += Math.hypot(r[k][0] - r[k - 1][0], r[k][1] - r[k - 1][1]); if (!(per > 0)) continue;
      for (let k = 1; k < r.length; k++) { const a = r[k - 1], b = r[k]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(L / (g / 2)));
        for (let t = 0; t <= n; t++) { const x = a[0] + (b[0] - a[0]) * t / n, y = a[1] + (b[1] - a[1]) * t / n; const i = Math.round((x - all[0]) / g), j = Math.round((y - all[1]) / g); if (i < 0 || j < 0 || i >= gx || j >= gy) continue;
          const o = j * gx + i; const hb = HF[o]; HF[o] = Math.min(hb, Math.max(hb / 4, per / 4)); } } }
    // gradation: two chamfer sweeps (8 neighbours)
    const gd = GRADE * g, gd2 = GRADE * g * Math.SQRT2;
    for (let it = 0; it < 2; it++) {
      for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) { const o = j * gx + i; let v = HF[o];
        if (i > 0) v = Math.min(v, HF[o - 1] + gd); if (j > 0) { v = Math.min(v, HF[o - gx] + gd); if (i > 0) v = Math.min(v, HF[o - gx - 1] + gd2); if (i < gx - 1) v = Math.min(v, HF[o - gx + 1] + gd2); } HF[o] = v; }
      for (let j = gy - 1; j >= 0; j--) for (let i = gx - 1; i >= 0; i--) { const o = j * gx + i; let v = HF[o];
        if (i < gx - 1) v = Math.min(v, HF[o + 1] + gd); if (j < gy - 1) { v = Math.min(v, HF[o + gx] + gd); if (i < gx - 1) v = Math.min(v, HF[o + gx + 1] + gd2); if (i > 0) v = Math.min(v, HF[o + gx - 1] + gd2); } HF[o] = v; } }
    const hAt = (x, y) => { const i = Math.max(0, Math.min(gx - 1, Math.round((x - all[0]) / g))), j = Math.max(0, Math.min(gy - 1, Math.round((y - all[1]) / g))); return HF[j * gx + i]; };

    // ---- 2. points
    const X = [], Y = [], fixed = []; const cs = hmin * 0.5; const hash = new Map(); const hk = (i, j) => i * 1e7 + j;
    const addPt = (x, y, fx) => { const k = X.length; X.push(x); Y.push(y); fixed.push(fx ? 1 : 0); const key = hk(Math.floor(x / cs), Math.floor(y / cs)); let a = hash.get(key); if (!a) hash.set(key, a = []); a.push(k); return k; };
    const near = (x, y, r) => { const i0 = Math.floor((x - r) / cs), i1 = Math.floor((x + r) / cs), j0 = Math.floor((y - r) / cs), j1 = Math.floor((y + r) / cs); const r2 = r * r; let best = -1, bd = r2;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = hash.get(hk(i, j)); if (!a) continue; for (const k of a) { const d = (X[k] - x) ** 2 + (Y[k] - y) ** 2; if (d < bd) { bd = d; best = k; } } } return best; };
    const pieces = []; // constraint pieces [p, q, kind] kind: 0 boundary / void outline, 1 cut-off, 2 break line (flow allowed)
    const cutSegs = [];
    // sample a polyline: corners (direction change > 25°) and the ends of open lines are kept; between them the line
    // is split evenly into pieces of about the local h (corners closer than 0.3 h to the previous one are dropped)
    const sampleLine = (pts, closed, kind, keep) => {
      let P = pts.filter((p, k) => k === 0 || p[0] !== pts[k - 1][0] || p[1] !== pts[k - 1][1]);
      if (closed && P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P = P.slice(0, -1);
      if (P.length < 2) return; const n = P.length;
      const turn = (k) => { const a = P[(k - 1 + n) % n], b = P[k], c = P[(k + 1) % n]; const ux = b[0] - a[0], uy = b[1] - a[1], wx = c[0] - b[0], wy = c[1] - b[1];
        const cs = (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy) || 1); return Math.acos(Math.max(-1, Math.min(1, cs))) > 25 * Math.PI / 180; };
      const corner = P.map((p, k) => closed ? turn(k) : (k === 0 || k === n - 1 || turn(k)));
      if (!corner.some(Boolean)) corner[0] = true;
      // walk from a corner around (closed) or from the start (open)
      const start = closed ? corner.indexOf(true) : 0; const seq = []; const m = closed ? n + 1 : n;
      for (let k = 0; k < m; k++) seq.push(P[(start + k) % n]); const isC = seq.map((p, k) => closed ? corner[(start + k) % n] : corner[k]);
      const ids = []; const push = (x, y) => { if (!keep(x, y)) { ids.push(-1); return; } const r = 0.3 * hAt(x, y); let k = near(x, y, r); if (k < 0) k = addPt(x, y, true); else fixed[k] = 1; if (ids[ids.length - 1] !== k) ids.push(k); };
      let a = 0; push(seq[0][0], seq[0][1]);
      while (a < seq.length - 1) { let b = a + 1; while (b < seq.length - 1 && !isC[b]) b++;
        // path a..b: length and evenly spaced points
        const cum = [0]; for (let k = a + 1; k <= b; k++) cum.push(cum[cum.length - 1] + Math.hypot(seq[k][0] - seq[k - 1][0], seq[k][1] - seq[k - 1][1])); const S = cum[cum.length - 1];
        const mid = seq[Math.floor((a + b) / 2)]; const hh = Math.min(hAt(seq[a][0], seq[a][1]), hAt(seq[b][0], seq[b][1]), hAt(mid[0], mid[1]));
        const np = Math.max(1, Math.round(S / hh));
        if (np === 1 && S < 0.3 * hh && b < seq.length - 1) { isC[b] = false; continue; } // corner too close: treat as a plain vertex
        for (let q = 1; q < np; q++) { const d = S * q / np; let k = 1; while (k < cum.length - 1 && cum[k] < d) k++; const f = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1); const p0 = seq[a + k - 1], p1 = seq[a + k]; push(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f); }
        push(seq[b][0], seq[b][1]); a = b; }
      for (let k = 1; k < ids.length; k++) { const p = ids[k - 1], q = ids[k]; if (p >= 0 && q >= 0 && p !== q) { pieces.push([p, q, kind]); } }
    };
    const inDom = (x, y) => domain(x, y) >= 0; const always = () => true; const inBnd = (x, y) => bIdx.at(x, y) >= 0;
    if (opt.progress) opt.progress('Sampling the boundary and lines…');
    for (const b of Bnd) for (const r of b.rings) sampleLine(r, true, 0, always);
    for (const v of voids) for (const r of v.rings) sampleLine(r, true, 0, inBnd);
    for (const L of opt.cutoff || []) { sampleLine(L, false, 1, inDom); for (let k = 1; k < L.length; k++) cutSegs.push([L[k - 1][0], L[k - 1][1], L[k][0], L[k][1]]); }
    for (const o of others) for (const r of o.rings) sampleLine(r, true, 2, inDom);
    for (const z of zones) { if (z.kind === 'polygon') for (const r of z.coords) sampleLine(r, true, 2, inDom); else sampleLine(z.coords, false, 2, inDom); }
    for (const C of opt.coast || []) sampleLine(C.pts, false, 2, inDom);
    const nFixed = X.length;
    // hexagonal lattice from a seed in every boundary polygon, then from the constraint points (pockets)
    if (opt.progress) opt.progress('Filling the area…');
    const queue = []; const ANG = [0, 1, 2, 3, 4, 5].map(k => [Math.cos(k * Math.PI / 3), Math.sin(k * Math.PI / 3)]);
    for (const b of Bnd) { const bb = bboxOf(b.rings); let seed = null, bd = Infinity; const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2; const st = Math.max(b.h, Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 40);
      for (let x = bb[0] + st / 2; x < bb[2]; x += st) for (let y = bb[1] + st / 2; y < bb[3]; y += st) { if (domain(x, y) !== b.bi) continue; const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd && near(x, y, 0.72 * hAt(x, y)) < 0) { bd = d; seed = [x, y]; } }
      if (seed) queue.push(addPt(seed[0], seed[1], false)); }
    const LIMIT = 3e6;
    const grow = (from) => { let qi = from; while (qi < queue.length) { const k = queue[qi++]; const hk0 = hAt(X[k], Y[k]);
        for (const [ux, uy] of ANG) { const x = X[k] + ux * hk0, y = Y[k] + uy * hk0; if (domain(x, y) < 0) continue; const hh = hAt(x, y); if (near(x, y, 0.72 * Math.min(hh, hk0 * 1.2)) >= 0) continue;
          queue.push(addPt(x, y, false)); if (X.length > LIMIT) throw new Error('More than ' + (LIMIT / 1e6) + ' million mesh points: use a larger cell size.'); } } return qi; };
    let qi = grow(0); for (let k = 0; k < nFixed; k++) queue.push(k); grow(qi);

    // ---- 3. triangulation, constraint recovery, smoothing
    let tri = null; const ekey = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;
    const triangulate = () => { const c = new Float64Array(2 * X.length); for (let k = 0; k < X.length; k++) { c[2 * k] = X[k]; c[2 * k + 1] = Y[k]; } tri = new D(c).triangles; };
    const recover = () => { for (let round = 0; round < 8; round++) { triangulate(); const E = new Set(); for (let t = 0; t < tri.length; t += 3) { E.add(ekey(tri[t], tri[t + 1])); E.add(ekey(tri[t + 1], tri[t + 2])); E.add(ekey(tri[t + 2], tri[t])); }
        const miss = []; for (let k = 0; k < pieces.length; k++) if (!E.has(ekey(pieces[k][0], pieces[k][1]))) miss.push(k); if (!miss.length) return 0; if (round === 7) return miss.length;
        for (const k of miss) { const [p, q, kind] = pieces[k]; const m = addPt((X[p] + X[q]) / 2, (Y[p] + Y[q]) / 2, true); pieces[k] = [p, m, kind]; pieces.push([m, q, kind]); } } return 0; };
    if (opt.progress) opt.progress('Triangulating ' + X.length.toLocaleString() + ' points…');
    recover();
    // Laplacian smoothing of the free points (3 passes), then triangulate again
    for (let it = 0; it < 3; it++) { const sx = new Float64Array(X.length), sy = new Float64Array(X.length), sn = new Uint16Array(X.length);
      for (let t = 0; t < tri.length; t += 3) for (let e = 0; e < 3; e++) { const a = tri[t + e], b = tri[t + (e + 1) % 3]; sx[a] += X[b]; sy[a] += Y[b]; sn[a]++; sx[b] += X[a]; sy[b] += Y[a]; sn[b]++; }
      for (let k = 0; k < X.length; k++) { if (fixed[k] || !sn[k]) continue; const nx = sx[k] / sn[k], ny = sy[k] / sn[k]; if (domain(nx, ny) >= 0) { X[k] = nx; Y[k] = ny; } }
      triangulate(); }
    const missing = recover();

    // ---- 4. triangles inside the domain, merge of very small ones
    const T = []; let skippedExcl = 0; const triOf = new Int32Array(tri.length / 3).fill(-1);
    for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; const cx = (X[a] + X[b] + X[c]) / 3, cy = (Y[a] + Y[b] + Y[c]) / 3;
      const ar = ((X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a])) / 2; if (!(Math.abs(ar) > 1e-9 * hmin * hmin)) continue; const d = domain(cx, cy); if (d === -2) { skippedExcl++; continue; } if (d < 0) continue;
      triOf[t / 3] = T.length; T.push({ v: ar > 0 ? [a, b, c] : [a, c, b], bi: d, a: Math.abs(ar), cell: -1 }); }
    // edges -> triangles
    const ET = new Map(); T.forEach((t, k) => { for (let e = 0; e < 3; e++) { const key = ekey(t.v[e], t.v[(e + 1) % 3]); const o = ET.get(key); if (o === undefined) ET.set(key, k); else ET.set(key, [o, k]); } });
    const cutPiece = new Set(pieces.filter(p => p[2] === 1).map(p => ekey(p[0], p[1]))); const bndPiece = new Set(pieces.filter(p => p[2] === 0).map(p => ekey(p[0], p[1])));
    // every triangle is a cell; very small or sliver triangles (area < 0.2 x target or smallest angle < 12°) are joined
    // to the neighbouring cell across their longest free edge (its polygon gets the third vertex; at most 6 sides)
    const cells0 = T.map((t, k) => { t.cell = k; return { v: t.v.slice(), bi: t.bi, alive: true }; });
    const angMin = (v) => { let mn = 180; for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3], c = v[(e + 2) % 3]; const ux = X[b] - X[a], uy = Y[b] - Y[a], wx = X[c] - X[a], wy = Y[c] - Y[a]; mn = Math.min(mn, Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy) || 1)))) * 180 / Math.PI); } return mn; };
    for (let k = 0; k < T.length; k++) { const t = T[k]; const hh = hAt((X[t.v[0]] + X[t.v[1]] + X[t.v[2]]) / 3, (Y[t.v[0]] + Y[t.v[1]] + Y[t.v[2]]) / 3);
      if (t.cell !== k || cells0[k].v.length !== 3) continue; if (t.a >= 0.2 * hh * hh * Math.sqrt(3) / 4 && angMin(t.v) >= 12) continue;
      const cand = []; for (let e = 0; e < 3; e++) { const p = t.v[e], q = t.v[(e + 1) % 3]; const key = ekey(p, q); const o = ET.get(key); if (!Array.isArray(o) || cutPiece.has(key)) continue; const nb = o[0] === k ? o[1] : o[0]; const C = T[nb].cell; if (C === k || T[nb].bi !== t.bi || cells0[C].v.length >= 6) continue; cand.push([(X[p] - X[q]) ** 2 + (Y[p] - Y[q]) ** 2, p, q, t.v[(e + 2) % 3], C]); }
      if (!cand.length) continue; cand.sort((a, b) => b[0] - a[0]); const [, p, q, r, C] = cand[0]; const V = cells0[C].v; const n = V.length;
      let at = -1; for (let i = 0; i < n; i++) if (V[i] === q && V[(i + 1) % n] === p) { at = i; break; } if (at < 0) continue;
      V.splice(at + 1, 0, r); cells0[k].alive = false; t.cell = C; }
    { const nw = new Int32Array(cells0.length).fill(-1); const out = []; cells0.forEach((c, k) => { if (c.alive) { nw[k] = out.length; out.push(c); } }); for (const t of T) t.cell = nw[t.cell]; cells0.length = 0; cells0.push(...out); }

    // ---- 5. cells: centroid, area, elevation, building type
    if (opt.progress) opt.progress('Cell elevations…');
    const cells = []; let skippedNoData = 0, nRaised = 0, nPorous = 0; const cellNew = new Int32Array(cells0.length).fill(-1);
    cells0.forEach((c0, k) => { const v = c0.v; let A = 0, cx = 0, cy = 0;
      for (let i = 0; i < v.length; i++) { const a = v[i], b = v[(i + 1) % v.length]; const cr = X[a] * Y[b] - X[b] * Y[a]; A += cr; cx += (X[a] + X[b]) * cr; cy += (Y[a] + Y[b]) * cr; }
      A /= 2; if (!(A > 0)) return; cx /= 6 * A; cy /= 6 * A;
      const z0 = opt.sample(cx, cy); if (z0 === null || !isFinite(z0)) { skippedNoData++; return; }
      let sz = z0, nz = 1; for (const i of v) { const z = opt.sample((cx + X[i]) / 2, (cy + Y[i]) / 2); if (z !== null && isFinite(z)) { sz += z; nz++; } }
      const B = Bnd[c0.bi]; const c = { k: cells.length, id: '', x: cx, y: cy, A, v, n: B.n, elev: sz / nz * lf, bi: c0.bi, deg: 0, por: 1 };
      if (others.length) { const o = oIdx.at(cx, cy); if (o >= 0) { const E = others[o]; if (E.type === 'RAISED') { c.elev += (E.height > 0 ? E.height : 0) * lf; c.bt = 1; nRaised++; } else if (E.type === 'POROUS') { c.por = E.porosity > 0 && E.porosity <= 1 ? E.porosity : 0.5; c.bt = 2; nPorous++; } } }
      c.elev = +c.elev.toFixed(4); cellNew[k] = cells.length; cells.push(c); });
    cells.forEach((c, k) => { c.id = '2D_' + (k + 1); });

    // ---- 6. faces between cells -> links
    const cutIdx = cutSegs.length ? segIndex(cutSegs, Math.max(hmax * 2, Math.max(W0, H0) / 256)) : null;
    const faces = new Map(); // pair key -> { a, b, Ta, Tb, len (edge) }
    const triArea = (px, py, ax, ay, bx, by) => Math.abs((ax - px) * (by - py) - (bx - px) * (ay - py)) / 2;
    for (const [key, o] of ET) { if (!Array.isArray(o)) continue; const ca = cellNew[T[o[0]].cell], cb = cellNew[T[o[1]].cell]; if (ca < 0 || cb < 0 || ca === cb) continue;
      if (cutPiece.has(key)) continue; const p = Math.floor(key / 4194304), q = key % 4194304; const A = cells[ca], B = cells[cb];
      if (cutIdx && cutIdx.crosses(A.x, A.y, B.x, B.y)) continue;
      const a = Math.min(ca, cb), b = Math.max(ca, cb); const ck = a * 4194304 + b; let f = faces.get(ck); if (!f) faces.set(ck, f = { a, b, Ta: 0, Tb: 0, e: 0 });
      f.Ta += triArea(cells[a].x, cells[a].y, X[p], Y[p], X[q], Y[q]); f.Tb += triArea(cells[b].x, cells[b].y, X[p], Y[p], X[q], Y[q]); f.e += Math.hypot(X[p] - X[q], Y[p] - Y[q]); }
    const sumT = new Float64Array(cells.length); for (const f of faces.values()) { sumT[f.a] += f.Ta; sumT[f.b] += f.Tb; cells[f.a].deg++; cells[f.b].deg++; }
    const links = []; let k2 = 0;
    for (const f of faces.values()) { const A = cells[f.a], B = cells[f.b]; const L = Math.hypot(B.x - A.x, B.y - A.y); if (!(L > 0)) continue;
      const fa = A.A * A.por / sumT[f.a], fb = B.A * B.por / sumT[f.b]; const plan = (f.Ta * fa + f.Tb * fb) * lf * lf; const p = Math.min(A.por, B.por);
      const w = (f.Ta + f.Tb) / L * lf * p; let len = plan / w; len = Math.max(len, 0.25 * L * lf);
      links.push({ id: '2DL_' + (++k2), a: A.id, b: B.id, len: +len.toFixed(4), w: +w.toFixed(4), n: Math.max(A.n, B.n) }); }

    // ---- 7. cell locator, water-front outfalls, 1D couplings
    const cB = Math.max(hmax * 1.5, Math.max(W0, H0) / 2048); const cix = new Map();
    cells.forEach((c, k) => { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const i of c.v) { x1 = Math.min(x1, X[i]); x2 = Math.max(x2, X[i]); y1 = Math.min(y1, Y[i]); y2 = Math.max(y2, Y[i]); }
      for (let i = Math.floor(x1 / cB); i <= Math.floor(x2 / cB); i++) for (let j = Math.floor(y1 / cB); j <= Math.floor(y2 / cB); j++) { const key = i * 1e7 + j; let a = cix.get(key); if (!a) cix.set(key, a = []); a.push(k); } });
    const cellAt = (x, y) => { const a = cix.get(Math.floor(x / cB) * 1e7 + Math.floor(y / cB)); if (!a) return null; for (const k of a) { const c = cells[k]; if (pip(x, y, c.v.map(i => [X[i], Y[i]]))) return c; } return null; };
    const outfalls = []; let ko = 0;
    for (const C of opt.coast || []) { let ch = 0, next = null;
      for (let k = 1; k < C.pts.length; k++) { const a = C.pts[k - 1], b = C.pts[k]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (next === null) next = hAt(a[0], a[1]) / SQ;
        while (L > 0 && next <= ch + L + 1e-9) { const f = (next - ch) / L; const x = a[0] + f * (b[0] - a[0]), y = a[1] + f * (b[1] - a[1]);
          const c = cellAt(x, y); if (c) outfalls.push({ id: '2DO_' + (++ko), x, y, elev: isFinite(C.elev) ? +(C.elev * lf).toFixed(4) : c.elev, cell: c.id, w: +(Math.sqrt(c.A) * lf).toFixed(4) });
          next += hAt(x, y) / SQ; }
        ch += L; } }
    const couplings = [];
    for (const nd of opt.nodes) { const c = cellAt(nd.x, nd.y); if (!c) continue; couplings.push({ id: '2DX_' + nd.id, node: nd.id, cell: c.id, offset: nd.offset, w: +(Math.sqrt(c.A) * lf).toFixed(4) }); }

    // ---- output: vertices used by the cells, renumbered
    const vmap = new Int32Array(X.length).fill(-1); const verts = [];
    for (const c of cells) c.v = c.v.map(i => { if (vmap[i] < 0) { vmap[i] = verts.length / 2; verts.push(+X[i].toFixed(3), +Y[i].toFixed(3)); } return vmap[i]; });
    // quality: smallest angle of the triangles kept
    let minAng = 180, bad = 0; for (const t of T) { if (cells0[t.cell] && cells0[t.cell].v.length !== 3) continue; const v = t.v; const ang = []; for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3], c = v[(e + 2) % 3]; const ux = X[b] - X[a], uy = Y[b] - Y[a], wx = X[c] - X[a], wy = Y[c] - Y[a]; ang.push(Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / Math.hypot(ux, uy) / Math.hypot(wx, wy)))) * 180 / Math.PI); }
      const m = Math.min(...ang); if (m < minAng) minAng = m; if (m < 20) bad++; }
    return { version: 2, type: 'tri', created: new Date().toISOString(), lenFactor: lf, verts,
      cells: cells.map(c => { const o = { id: c.id, x: +c.x.toFixed(4), y: +c.y.toFixed(4), s: +Math.sqrt(c.A).toFixed(4), a: +c.A.toFixed(3), v: c.v, elev: c.elev, n: c.n, deg: c.deg }; if (c.bt) o.bt = c.bt; if (c.por < 1) o.por = c.por; return o; }),
      links, outfalls, couplings,
      stats: { cells: cells.length, links: links.length, outfalls: outfalls.length, couplings: couplings.length, skippedNoData, skippedExcl, raised: nRaised, porous: nPorous, points: X.length, missingConstraints: missing,
        triangles: T.length, quads: cells.filter(c => c.v.length > 3).length, minAngle: +minAng.toFixed(1), below20: bad, seconds: (Date.now() - t0) / 1000 } };
  };
  AV.UMESH_SQ = SQ;
})(typeof window !== 'undefined' ? window.AV : module.exports);
