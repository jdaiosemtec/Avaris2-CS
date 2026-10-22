// Model Partition (Tools ▸ Partition): splits a large model into sub-models for coupled parallel simulation.
//
// Rules (OSEMTEC partition method):
//  - every partition drains in one direction: flow directions come from a base run (Base results); a link that flows
//    mostly backwards is turned round
//  - links with reverse flow (flag rule: flow for >= N min and reverse >= W % of that time), pumps / orifices / weirs /
//    outlets, links of flow dividers and the manholes of one 2D ponding area are never separated
//  - as few cut points as possible, partitions of about the same size (nodes), count <= 1.5 x CPU cores
//  - at a cut, the conduit stays in the upstream partition; its downstream node becomes an outfall there (stage set by
//    the coupling engine: the water level of the downstream partition) and receives the conduit flow as an inflow in
//    the downstream partition
// The partition definition (node -> partition, settings, couplings, object signatures) is saved in
// <model>.partition.json next to the model; Regenerate re-creates the sub-models from the current master model.
'use strict';
(function (AV) {
  const h = AV.h;
  const pad2 = (i) => String(i + 1).padStart(2, '0');
  const PID = (i) => 'P' + pad2(i);
  const COL = (i) => `hsl(${(i * 137.508) % 360},62%,${i % 2 ? 50 : 42}%)`;
  const COLA = (i, a) => `hsla(${(i * 137.508) % 360},62%,${i % 2 ? 50 : 42}%,${a})`;
  AV.partColor = COL;
  const fnv = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); } return (x >>> 0).toString(16).padStart(8, '0'); };
  AV.fnvHash = fnv;

  const DEF = { n: 12, revMin: 60, revPct: 5, revMax: 95, revRel: 2, keepPonds: true, pondMin: 30, pondDist: 0, tol: 25, ctrl: 60, boundary: true, folder: '', pattern: '{model}_P{nn}.inp' };

  // ------------------------------------------------------------------ analysis of the base run
  // per link: minutes with flow, minutes with reverse flow, peak |Q|; per node: minutes flooded; 2D ponding areas
  AV.partAnalyse = async function (app, S) {
    const m = app.model, R = app.results; const SI = m.isSI; const eps = SI ? 0.0001 : 0.001;
    const A = { links: new Map(), flood: new Map(), ponds: [], hasResults: !!R, eps, resultsName: R ? (R.name || AV.basename(R.meta.file || '')) : '' };
    if (R) {
      const lf = AV.exprFields(app, 'link'), nf = AV.exprFields(app, 'node');
      // flow counts when |Q| exceeds a share of the pipe's own peak flow (tiny flows around zero are numerical noise)
      const thr = 'max(' + eps + ', ' + (+S.revRel >= 0 ? +S.revRel : 2) + ' / 100 * rptMaxFlow)';
      const cF = AV.compileExpr('totdur(abs(rptFlow) > ' + thr + ')', lf), cR = AV.compileExpr('totdur(rptFlow < -' + thr + ')', lf), cQ = AV.compileExpr('peak(abs(rptFlow))', lf);
      const cN = AV.compileExpr('totdur(rptFlooding > 0)', nf);
      await AV.Temporal.ensure([].concat(cF.temporals, cR.temporals, cQ.temporals, cN.temporals));
      for (const l of m.links.values()) A.links.set(l.id, { f: +cF.fn(l) || 0, r: +cR.fn(l) || 0, q: +cQ.fn(l) || 0 });
      for (const n of m.nodes.values()) { const v = +cN.fn(n) || 0; if (v > 0) A.flood.set(n.id, v); }
    }
    // 2D ponding areas: connected wet cells (max depth >= flood depth threshold) and the manholes coupled to them
    const mesh = app.mesh2d, MR = app.meshResults;
    if (mesh && MR && mesh.cells && mesh.couplings) {
      const thr = S.pondDepth > 0 ? S.pondDepth : MR.thr > 0 ? MR.thr : (SI ? 0.3 : 1.0); A.pondDepth = thr; const wet = new Map(); const key = (x, y, s) => Math.round(x / s) + ',' + Math.round(y / s);
      mesh.cells.forEach((c, k) => { if (MR.maxd[k] >= thr) wet.set(key(c.x, c.y, c.s), k); });
      const comp = new Map(); let nc = 0;
      for (const [kk, k] of wet) { if (comp.has(k)) continue; const id = nc++; const st = [k]; comp.set(k, id);
        while (st.length) { const j = st.pop(); const c = mesh.cells[j]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const o = wet.get(key(c.x + dx * c.s, c.y + dy * c.s, c.s)); if (o !== undefined && !comp.has(o)) { comp.set(o, id); st.push(o); } } } }
      const cellIdx = new Map(mesh.cells.map((c, k) => [c.id, k])); const groups = new Map();
      for (const x of mesh.couplings) { const k = cellIdx.get(x.cell); if (k === undefined || !comp.has(k)) continue; const g = comp.get(k); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x.node); }
      A.ponds = [...groups.values()].filter(a => a.length); A.pondSource = '2D';
    } else if (A.flood.size) {
      // 1D only: manholes flooded for >= pondMin minutes, closer than pondDist to each other, form one ponding area
      const fl = [...A.flood].filter(([, v]) => v >= S.pondMin).map(([id]) => m.nodes.get(id)).filter(Boolean);
      const D = S.pondDist > 0 ? S.pondDist : (/FEET/i.test(m.mapInfo.units || '') ? 150 : 50); const grid = new Map(); const gk = (x, y) => Math.floor(x / D) + ',' + Math.floor(y / D);
      fl.forEach((n, i) => { const k = gk(n.x, n.y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
      const comp = new Array(fl.length).fill(-1); let nc = 0;
      for (let i = 0; i < fl.length; i++) { if (comp[i] >= 0) continue; const id = nc++; comp[i] = id; const st = [i];
        while (st.length) { const j = st.pop(); const a = fl[j]; const gx = Math.floor(a.x / D), gy = Math.floor(a.y / D);
          for (let u = gx - 1; u <= gx + 1; u++) for (let v = gy - 1; v <= gy + 1; v++) for (const t of grid.get(u + ',' + v) || []) if (comp[t] < 0 && Math.hypot(fl[t].x - a.x, fl[t].y - a.y) <= D) { comp[t] = id; st.push(t); } } }
      const groups = new Map(); fl.forEach((n, i) => { if (!groups.has(comp[i])) groups.set(comp[i], []); groups.get(comp[i]).push(n.id); });
      A.ponds = [...groups.values()]; A.pondSource = '1D'; A.pondDist = D;
    }
    return A;
  };

  // ------------------------------------------------------------------ the partition algorithm
  // nodes joined by links that must not be cut form blocks; every block drains through its main downstream link
  // (largest peak flow) -> drainage trees; bottom-up the big branches are split off and a branch is closed when it
  // reaches the target size; small remainders join a neighbour; the target is searched to give the wanted count.
  // links that must not be cut, with the reason, and the ponding area of each node
  AV.partGlue = function (app, A, S) {
    const m = app.model; const info = (id) => A.links.get(id) || { f: 0, r: 0, q: 0 };
    // oscillating flow: the flow changes direction - reverse for at least revPct % but less than revMax % of the time with
    // flow (a pipe that flows backwards nearly all the time is one-directional and may be cut; it is turned round)
    const revMax = S.revMax > 0 ? S.revMax : 95;
    const isRev = (l) => { const x = info(l.id); const sh = x.r / Math.max(x.f, 1e-9) * 100; return x.f >= S.revMin && sh >= S.revPct && sh < revMax; };
    const isBack = (l) => { const x = info(l.id); return x.f > 0 && x.r / x.f > 0.5; };
    const divL = new Set(); for (const n of m.nodes.values()) if (n.type === 'DIVIDER') { for (const l of m.links.values()) if (l.from === n.id) divL.add(l.id); }
    const why = new Map(); // link -> reason it must not be cut
    // hard: never cut (pumps, orifices, weirs, outlets, divider links, links that flow mostly backwards);
    // soft: reverse flow by the rule - kept whole unless they join more nodes than one partition can hold
    const hard = new Set(), rev = new Map();
    for (const l of m.links.values()) { const x = info(l.id); const pct = x.r / Math.max(x.f, 1e-9) * 100;
      const r = l.type !== 'CONDUIT' ? l.type.toLowerCase() : divL.has(l.id) ? 'flow divider' : isRev(l) ? 'oscillating flow ' + pct.toFixed(0) + ' %' : null;
      if (!r) continue; why.set(l.id, r); if (r.startsWith('oscillating')) rev.set(l.id, Math.min(pct, 100 - pct)); else hard.add(l.id); }
    const pondOf = new Map(); A.ponds.forEach((g, k) => { for (const id of g) if (m.nodes.has(id)) pondOf.set(id, k); });
    return { why, hard, rev, pondOf, isBack, info };
  };
  AV.partCompute = function (app, A, S) {
    const m = app.model; const G0 = AV.partGlue(app, A, S); const { why, isBack, info } = G0;
    // union-find
    const ids = [...m.nodes.keys()]; const ix = new Map(ids.map((id, i) => [id, i])); const par = new Int32Array(ids.length).map((_, i) => i);
    const sz = new Int32Array(ids.length).fill(1);
    const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const un = (a, b, cap) => { a = f(a); b = f(b); if (a === b) return true; if (cap && sz[a] + sz[b] > cap) return false; par[a] = b; sz[b] += sz[a]; return true; };
    // a group kept whole may hold at most about one partition
    const cap = Math.max(2, Math.floor(ids.length / Math.max(1, S.n) * 0.9)); const splitRev = new Set(), splitPond = new Set();
    for (const l of m.links.values()) if (G0.hard.has(l.id) && ix.has(l.from) && ix.has(l.to)) un(ix.get(l.from), ix.get(l.to));
    for (const [id, pct] of [...G0.rev].sort((a, b) => b[1] - a[1])) { const l = m.links.get(id); if (ix.has(l.from) && ix.has(l.to) && !un(ix.get(l.from), ix.get(l.to), cap)) splitRev.add(id); }
    const pondOf = G0.pondOf; (S.keepPonds === false ? [] : A.ponds).map((g, k) => [g.filter(id => ix.has(id)), k]).sort((a, b) => a[0].length - b[0].length).forEach(([a, k]) => {
      // members joined nearest first, so that a split ponding area keeps compact pieces
      if (a.length < 2) return;
      const pts = a.map(id => m.nodes.get(id));
      if (a.length > 3000) { const o = [...pts.keys()].sort((i, j) => (pts[i].x + pts[i].y) - (pts[j].x + pts[j].y)); for (let t = 1; t < o.length; t++) un(ix.get(a[o[t - 1]]), ix.get(a[o[t]])); return; }
      const done = [0]; const left = new Set(pts.keys()); left.delete(0);
      while (left.size) { let bi = -1, bj = -1, bd = Infinity; for (const j of left) { const q = pts[j]; for (const i of done.slice(-30)) { const d = (pts[i].x - q.x) ** 2 + (pts[i].y - q.y) ** 2; if (d < bd) { bd = d; bi = i; bj = j; } } }
        left.delete(bj); done.push(bj); un(ix.get(a[bi]), ix.get(a[bj])); } });
    // blocks
    const blk = new Int32Array(ids.length); const B = []; const bix = new Map();
    for (let i = 0; i < ids.length; i++) { const r = f(i); let b = bix.get(r); if (b === undefined) { b = B.length; bix.set(r, b); B.push({ w: 0, nodes: [], down: -1, dl: null, ups: [] }); } blk[i] = b; B[b].w++; B[b].nodes.push(i); }
    // main downstream link of every block, no cycles
    const cand = []; for (const l of m.links.values()) { if (!ix.has(l.from) || !ix.has(l.to)) continue; const back = isBack(l); const u = ix.get(back ? l.to : l.from), d = ix.get(back ? l.from : l.to); const bu = blk[u], bd = blk[d]; if (bu !== bd) cand.push([info(l.id).q, bu, bd, l]); }
    cand.sort((a, b) => b[0] - a[0]);
    const reaches = (from, to) => { let x = from, k = 0; while (x >= 0 && k++ < B.length + 2) { if (x === to) return true; x = B[x].down; } return false; };
    for (const [, bu, bd, l] of cand) { if (B[bu].down >= 0 || reaches(bd, bu)) continue; B[bu].down = bd; B[bu].dl = l; B[bd].ups.push(bu); }
    const order = []; for (let r = 0; r < B.length; r++) { if (B[r].down >= 0) continue; const st = [[r, 0]]; while (st.length) { const t = st[st.length - 1]; const ch = B[t[0]].ups; if (t[1] < ch.length) st.push([ch[t[1]++], 0]); else { st.pop(); order.push(t[0]); } } }
    const cen = B.map(b => { let x = 0, y = 0; for (const i of b.nodes) { const n = m.nodes.get(ids[i]); x += n.x; y += n.y; } return [x / b.nodes.length, y / b.nodes.length]; });
    const total = ids.length;
    const run = (T) => {
      const owner = new Int32Array(B.length).fill(-1), open = new Float64Array(B.length); let k = 0;
      const close = (g) => { const id = k++; const st = [g]; while (st.length) { const y = st.pop(); owner[y] = id; for (const c of B[y].ups) if (owner[c] < 0) st.push(c); } };
      for (const g of order) { const b = B[g]; let s = b.w; const ch = []; for (const c of b.ups) if (owner[c] < 0) { ch.push(c); s += open[c]; }
        if (s > T * 1.25 && ch.length) { ch.sort((x, y) => open[y] - open[x]); for (const c of ch) { if (s <= T * 1.25) break; if (open[c] >= T * 0.45) { close(c); s -= open[c]; } } }
        open[g] = s; if (b.down < 0 || s >= T * 0.85) close(g); }
      // partitions joined: a small one goes to its smallest upstream neighbour, else downstream, else the nearest
      const size = new Float64Array(k), cx = new Float64Array(k), cy = new Float64Array(k), pp = new Int32Array(k).map((_, i) => i);
      for (let g = 0; g < B.length; g++) { size[owner[g]] += B[g].w; cx[owner[g]] += cen[g][0] * B[g].w; cy[owner[g]] += cen[g][1] * B[g].w; }
      const pf = (x) => { while (pp[x] !== x) { pp[x] = pp[pp[x]]; x = pp[x]; } return x; };
      const adj = new Map(); const addA = (a, b, up) => { if (a === b) return; let s = adj.get(a); if (!s) adj.set(a, s = []); s.push([b, up]); };
      for (let g = 0; g < B.length; g++) if (B[g].down >= 0) { const a = owner[g], b = owner[B[g].down]; if (a !== b) { addA(b, a, true); addA(a, b, false); } }
      const small = [...Array(k).keys()].filter(p => size[p] < T * 0.4).sort((a, b) => size[a] - size[b]);
      for (const p0 of small) { const p = pf(p0); if (size[p] >= T * 0.4) continue; let nb = -1, best = Infinity, down = -1;
        for (const [q0, up] of adj.get(p0) || []) { const q = pf(q0); if (q === p) continue; if (up && size[q] < best) { best = size[q]; nb = q; } if (!up) down = q; }
        if (nb < 0) nb = down;
        if (nb < 0) { let bd = Infinity; const x = cx[p] / size[p], y = cy[p] / size[p]; for (let q = 0; q < k; q++) { if (pf(q) !== q || q === p) continue; const d = (cx[q] / size[q] - x) ** 2 + (cy[q] / size[q] - y) ** 2; if (d < bd) { bd = d; nb = q; } } }
        if (nb < 0) continue; pp[p] = nb; size[nb] += size[p]; cx[nb] += cx[p]; cy[nb] += cy[p]; if (adj.has(p0)) for (const e of adj.get(p0)) addA(nb, e[0], e[1]); }
      const roots = [...new Set([...Array(k).keys()].map(pf))].sort((a, b) => a - b); const ren = new Map(roots.map((p, i) => [p, i]));
      const no = new Int32Array(B.length); for (let g = 0; g < B.length; g++) no[g] = ren.get(pf(owner[g]));
      const sizes = roots.map(p => size[p]); return { blockOwner: no, count: roots.length, spread: Math.max(...sizes) / Math.max(1, Math.min(...sizes)) };
    };
    let lo = 1, hi = total, best = null; const n = Math.max(1, S.n);
    const better = (r) => !best || Math.abs(r.count - n) < Math.abs(best.count - n) || (r.count === n && r.spread < best.spread);
    for (let it = 0; it < 36; it++) { const T = (lo + hi) / 2; const r = run(T); if (better(r)) best = r; if (r.count > n) lo = T; else hi = T; }
    for (let k = 0; k <= 60; k++) { const r = run(total / n * (0.7 + 0.01 * k)); if (better(r)) best = r; }
    const owner = new Map(); for (let i = 0; i < ids.length; i++) owner.set(ids[i], best.blockOwner[blk[i]]);
    // still too many (whole outfall systems cannot be split further): join the smallest partition to a coupled
    // neighbour (removes cut points) or to the nearest one
    let cnt = best.count;
    while (cnt > n) { const size = new Array(cnt).fill(0), cx = new Array(cnt).fill(0), cy = new Array(cnt).fill(0);
      for (const [id, p] of owner) { const q = m.nodes.get(id); size[p]++; cx[p] += q.x; cy[p] += q.y; }
      let sm = 0; for (let p = 1; p < cnt; p++) if (size[p] < size[sm]) sm = p;
      const nb = new Map(); for (const l of m.links.values()) { const a = owner.get(l.from), b = owner.get(l.to); if (a === undefined || b === undefined || a === b) continue; if (a === sm) nb.set(b, (nb.get(b) || 0) + 1); if (b === sm) nb.set(a, (nb.get(a) || 0) + 1); }
      let to = -1; if (nb.size) { let bs = Infinity; for (const [q] of nb) if (size[q] < bs) { bs = size[q]; to = q; } }
      else { let bd = Infinity; for (let q = 0; q < cnt; q++) { if (q === sm) continue; const d = (cx[q] / size[q] - cx[sm] / size[sm]) ** 2 + (cy[q] / size[q] - cy[sm] / size[sm]) ** 2; if (d < bd) { bd = d; to = q; } } }
      for (const [id, p] of owner) owner.set(id, p === sm ? (to > sm ? to - 1 : to) : p > sm ? p - 1 : p); cnt--; }
    best.count = cnt;
    const P = { owner, count: best.count, why, hard: G0.hard, pondOf, blocks: B.length, manual: 0, splitRev, splitPond, cap };
    AV.partRecut(app, P, A); return P;
  };
  // couplings: every link between two partitions; the upstream end follows the base-run flow direction
  AV.partRecut = function (app, P, A) {
    const m = app.model; const cuts = [];
    for (const l of m.links.values()) { const pa = P.owner.get(l.from), pb = P.owner.get(l.to); if (pa === undefined || pb === undefined || pa === pb) continue;
      const x = A.links.get(l.id); const back = x && x.f > 0 && x.r / x.f > 0.5;
      const up = back ? l.to : l.from, dn = back ? l.from : l.to; cuts.push({ link: l, up, down: dn, upPart: P.owner.get(up), downPart: P.owner.get(dn), back }); }
    P.cuts = cuts; P.count = Math.max(0, ...P.owner.values()) + 1; AV.partStats(app, P); return P;
  };
  AV.partStats = function (app, P) {
    const m = app.model; const st = []; for (let i = 0; i < P.count; i++) st.push({ i, nodes: 0, links: 0, subs: 0, area: 0, outfalls: [], cin: 0, cout: 0, cx: 0, cy: 0 });
    for (const [id, p] of P.owner) { const n = m.nodes.get(id); const s = st[p]; s.nodes++; s.cx += n.x; s.cy += n.y; if (n.type === 'OUTFALL') s.outfalls.push(id); }
    for (const l of m.links.values()) { const pa = P.owner.get(l.from); if (pa !== undefined && pa === P.owner.get(l.to)) st[pa].links++; }
    for (const c of P.cuts) { st[c.upPart].cout++; st[c.upPart].links++; st[c.downPart].cin++; }
    const subPart = AV.partSubOwner(app, P); for (const [sid, p] of subPart) { const s = m.subcatchments.get(sid); st[p].subs++; st[p].area += +s.p.area || 0; }
    P.stats = st; P.subOwner = subPart; return st;
  };
  // subcatchments follow their outlet node (through outlet subcatchments)
  AV.partSubOwner = function (app, P) {
    const m = app.model; const out = new Map();
    const res = (s, k) => { if (k > 50) return undefined; const o = s.p.outlet; if (P.owner.has(o)) return P.owner.get(o); const s2 = m.subcatchments.get(o); return s2 ? res(s2, k + 1) : undefined; };
    for (const s of m.subcatchments.values()) { const p = res(s, 0); if (p !== undefined) out.set(s.id, p); }
    return out;
  };
  // checks shown in the panel; errors block generation
  AV.partChecks = function (app, P, A, S, cores) {
    const out = []; const st = P.stats; const avg = app.model.nodes.size / Math.max(1, st.length);
    const hard = P.hard || new Set(); const bad = P.cuts.filter(c => hard.has(c.link.id)); const rv = P.cuts.filter(c => P.why.has(c.link.id) && !hard.has(c.link.id));
    const badP = P.cuts.filter(c => P.pondOf.has(c.up) && P.pondOf.get(c.up) === P.pondOf.get(c.down)); const nRev = [...P.why.values()].filter(v => v.startsWith('oscillating')).length;
    out.push(bad.length ? { t: 'er', s: bad.length + ' cut(s) on links that must never be cut: ' + bad.slice(0, 5).map(c => c.link.id + ' (' + P.why.get(c.link.id) + ')').join(', ') } : { t: 'ok', s: 'No cut on pumps, orifices, weirs, outlets or flow dividers' });
    out.push(rv.length ? { t: 'wn', s: rv.length + ' cut(s) on pipes with oscillating flow: ' + rv.slice(0, 6).map(c => c.link.id + ' (' + P.why.get(c.link.id).replace('oscillating flow ', '') + ' reverse)').join(', ') + (rv.length > 6 ? ' …' : '') + '. ' + nRev + ' of ' + app.model.links.size + ' links have oscillating flow in the base results and form groups larger than one partition, so some had to be cut (the least oscillating ones).' } : { t: 'ok', s: 'No cut on pipes with oscillating flow' + (nRev ? ' (' + nRev + ' kept whole)' : '') });
    const pondCut = new Set(badP.map(c => P.pondOf.get(c.up)));
    if (S.keepPonds === false) out.push({ t: 'ok', s: 'Ponding areas are not used as a constraint (option off)' }); else out.push(badP.length ? { t: 'wn', s: badP.length + ' cut(s) through ' + pondCut.size + ' ponding area(s) (added by hand)' } : { t: 'ok', s: A.ponds.length ? 'No cut through any of the ' + A.ponds.length + ' ponding areas (' + A.pondSource + ')' : 'No ponding areas in the base results' });
    if (S.keepPonds !== false && A.ponds.length) { const big = Math.max(...A.ponds.map(g => g.length)); if (big > app.model.nodes.size / Math.max(2, st.length)) out.push({ t: 'wn', s: 'The largest ponding area holds ' + big + ' manholes (more than one partition): it is kept in one partition, so the partitions cannot be balanced. Check the base results, raise the 2D ponding depth or untick "Keep ponding areas whole".' }); }
    const empty = st.filter(s => !s.outfalls.length && !s.cout); out.push(empty.length ? { t: 'er', s: empty.map(s => PID(s.i)).join(', ') + ': no outfall and no cut point' } : { t: 'ok', s: 'Every partition drains to an outfall or a cut point' });
    const dev = Math.max(...st.map(s => Math.abs(s.nodes - avg) / avg)) * 100;
    out.push(dev > S.tol ? { t: 'wn', s: 'Largest deviation from the average size: ' + dev.toFixed(0) + ' % (tolerance ' + S.tol + ' %) – move branches if needed' } : { t: 'ok', s: 'Partition sizes within ' + dev.toFixed(0) + ' % of the average' });
    const mx = Math.floor(cores * 1.5); out.push(st.length > mx ? { t: 'wn', s: st.length + ' partitions > ' + mx + ' (1.5 × ' + cores + ' cores): more partitions than the computer can run in parallel' } : { t: 'ok', s: st.length + ' partitions ≤ ' + mx + ' (1.5 × ' + cores + ' cores)' });
    if (!A.hasResults) out.push({ t: 'wn', s: 'No base results: flow directions follow the link directions and reverse flow is not checked' });
    return out;
  };
  // levels of the partition graph (upstream first) for the coupling engine
  AV.partLevels = function (P) { const d = new Array(P.count).fill(0); for (let it = 0; it < P.count; it++) { let ch = false; for (const c of P.cuts) if (d[c.downPart] < d[c.upPart] + 1 && it < P.count) { d[c.downPart] = d[c.upPart] + 1; ch = true; } if (!ch) break; }
    const mx = Math.max(0, ...d); const out = []; for (let k = 0; k <= mx; k++) out.push(d.map((v, i) => v === k ? PID(i) : null).filter(Boolean)); return out; };

  // ------------------------------------------------------------------ sub-models
  // signature of every object (its own line(s) in the .inp + rows that refer to it), for the difference report
  const REFN = ['INFLOWS', 'DWF', 'RDII', 'TREATMENT'];
  AV.partSignatures = function (m) {
    const sig = { N: {}, L: {}, S: {} }; const rowsOf = new Map();
    for (const sec of REFN) for (const r of m.raw[sec] || []) { const t = r.trim(); if (!t || t[0] === ';') continue; const id = t.split(/\s+/)[0]; rowsOf.set(id, (rowsOf.get(id) || '') + r); }
    const J = (o, extra) => fnv(JSON.stringify([o.type, o.p, o.x, o.y, o.from, o.to, o.verts, o.poly, o.tag, o.desc || '', extra || '']));
    for (const n of m.nodes.values()) sig.N[n.id] = J(n, rowsOf.get(n.id)); for (const l of m.links.values()) sig.L[l.id] = J(l); for (const s of m.subcatchments.values()) sig.S[s.id] = J(s);
    const shared = Object.assign(new AV.Model(), { title: [], options: m.options, report: m.report, curves: m.curves, timeseries: m.timeseries, gages: m.gages, raw: Object.fromEntries(Object.entries(m.raw).filter(([k]) => !REFN.includes(k))), rawOrder: m.rawOrder.filter(k => !REFN.includes(k)) });
    sig.shared = fnv(shared.toINP()); return sig;
  };
  // filter the rules of [CONTROLS]: a rule that refers to an object outside the sub-model is dropped
  const filterControls = (rows, has) => { const out = [], dropped = []; let cur = null;
    const flush = () => { if (!cur) return; if (cur.ok) out.push(...cur.rows); else dropped.push(cur.name); cur = null; };
    for (const r of rows) { const t = r.trim(); const k = t.split(/\s+/);
      if (/^RULE$/i.test(k[0])) { flush(); cur = { name: k[1] || '?', rows: [r], ok: true }; continue; }
      if (!cur) { out.push(r); continue; } cur.rows.push(r);
      for (let i = 0; i < k.length - 1; i++) if (/^(NODE|LINK|CONDUIT|PUMP|ORIFICE|WEIR|OUTLET|JUNCTION|OUTFALL|STORAGE|DIVIDER)$/i.test(k[i]) && !has(k[i + 1])) cur.ok = false; }
    flush(); return { out, dropped }; };
  // build the .inp text of every partition. bnd: base-run boundary series {flow: Map(linkId->[t,q]), head: Map(nodeId->[t,h])}
  AV.partBuild = function (app, P, opt) {
    const m = app.model; const name = AV.basename(app.filePath || 'Model.inp').replace(/\.inp$/i, ''); const res = []; const bnd = opt.bnd;
    const byPart = [...Array(P.count)].map(() => ({ nodes: new Set(), links: [], cutsOut: [], cutsIn: [] }));
    for (const [id, p] of P.owner) byPart[p].nodes.add(id);
    for (const l of m.links.values()) { const pa = P.owner.get(l.from); if (pa !== undefined && pa === P.owner.get(l.to)) byPart[pa].links.push(l); }
    for (const c of P.cuts) { byPart[c.upPart].cutsOut.push(c); byPart[c.downPart].cutsIn.push(c); }
    const couplings = []; let ck = 0; const warn = [];
    for (let p = 0; p < P.count; p++) {
      const B = byPart[p]; const sm = new AV.Model();
      sm.title = ['Sub-model ' + PID(p) + ' of ' + name + '.inp (' + P.count + ' partitions)', 'Generated by Avaris2 CS Model Partition - change the master model and regenerate, do not edit this file'];
      sm.options = Object.assign({}, m.options); sm.report = m.report.slice(); sm.mapInfo = Object.assign({}, m.mapInfo); sm.labels = [];
      sm.curves = m.curves; sm.gages = m.gages; sm.timeseries = new Map(m.timeseries);
      // data files (rainfall, time series, hotstart, temperature) are referred to from the sub-model folder
      if (opt.fixPath) {
        sm.gages = new Map([...m.gages].map(([k, g]) => [k, g.p.source === 'FILE' && g.p.series ? Object.assign({}, g, { p: Object.assign({}, g.p, { series: opt.fixPath(g.p.series) }) }) : g]));
        for (const [k, ts] of sm.timeseries) if (ts.file) sm.timeseries.set(k, Object.assign({}, ts, { file: opt.fixPath(ts.file) }));
      }
      if (m.osem2d) { sm.osem2d = Object.assign({}, m.osem2d); if (opt.fixPath) for (const k of ['DEM', 'WATERFRONT', 'CUTOFF', 'EXCLUSION']) if (sm.osem2d[k]) sm.osem2d[k] = opt.fixPath(sm.osem2d[k]);
        const bf = opt.boundaryFile ? opt.boundaryFile(p) : null; if (bf) sm.osem2d.BOUNDARY = bf; else if (sm.osem2d.BOUNDARY) { delete sm.osem2d.BOUNDARY; if (/^Y/i.test(sm.osem2d.ENABLED || '')) { sm.osem2d.ENABLED = 'NO'; if (p === 0) warn.push('2D: no partition areas were made (no DEM), so 2D is switched off in the sub-models; set their 2D boundary before creating meshes.'); } } }
      for (const id of B.nodes) sm.nodes.set(id, m.nodes.get(id));
      for (const l of B.links) sm.links.set(l.id, l);
      for (const [sid, q] of P.subOwner) if (q === p) sm.subcatchments.set(sid, m.subcatchments.get(sid));
      // cut points leaving this partition: the conduit stays here, its downstream end becomes an outfall
      const outByNode = new Map(); for (const c of B.cutsOut) { if (!outByNode.has(c.down)) outByNode.set(c.down, []); outByNode.get(c.down).push(c); }
      for (const [dn, cs] of outByNode) cs.forEach((c) => {
        const N = m.nodes.get(dn); const oid = cs.length === 1 ? dn : dn + '__' + c.link.id; const ser = bnd && bnd.head.has(dn) ? 'CPL_H_' + oid : null;
        sm.nodes.set(oid, { id: oid, kind: 'NODE', type: 'OUTFALL', x: N.x, y: N.y, tag: 'PartitionOut', desc: 'Coupling outlet to ' + PID(c.downPart) + ' node ' + dn, p: { elev: +N.p.elev || 0, otype: ser ? 'TIMESERIES' : 'FIXED', stage: ser || String(+N.p.elev || 0), gated: 'NO', routeTo: '' } });
        if (ser) sm.timeseries.set(ser, { file: null, rows: bnd.head.get(dn).map(([t, v]) => ['', t.toFixed(4), +v.toFixed(4)]), desc: 'Base-run water level at ' + dn + ' (' + PID(c.downPart) + ')' });
        // a pipe that flows backwards is written turned round, so that the outfall is its downstream end
        const l = c.link; let lk = Object.assign({}, l, { from: l.from === dn ? oid : l.from, to: l.to === dn ? oid : l.to });
        if (l.from === dn) lk = Object.assign({}, l, { from: l.to, to: oid, verts: (l.verts || []).slice().reverse(), p: Object.assign({}, l.p, { inOff: l.p.outOff, outOff: l.p.inOff, kEntry: l.p.kExit, kExit: l.p.kEntry }) });
        sm.links.set(l.id, lk);
        couplings.push({ id: 'C' + String(++ck).padStart(3, '0'), link: l.id, reversed: l.from === dn, up: { partition: PID(p), node: oid, type: 'OUTFALL', receives: 'stage' }, down: { partition: PID(c.downPart), node: dn, type: N.type, receives: 'inflow' } });
      });
      // raw sections: copied, rows of objects outside dropped (toINP), controls filtered, coupling inflows added
      sm.raw = {}; sm.rawOrder = m.rawOrder.slice();
      const has = (id) => sm.nodes.has(id) || sm.links.has(id);
      for (const sec of m.rawOrder) { let rows = (m.raw[sec] || []).slice();
        if (sec === 'CONTROLS') { const r = filterControls(rows, has); rows = r.out; if (r.dropped.length) warn.push(PID(p) + ': ' + r.dropped.length + ' control rule(s) refer to objects in other partitions and were left out (' + r.dropped.slice(0, 4).join(', ') + (r.dropped.length > 4 ? ' …' : '') + ')'); }
        if (sec === 'GROUNDWATER') rows = rows.filter(r => { const t = AV.tokenize(r); return !t[2] || sm.nodes.has(t[2]); });
        if (sec === 'INLET_USAGE') rows = rows.filter(r => { const t = AV.tokenize(r); return (!t[0] || sm.links.has(t[0])) && (!t[2] || sm.nodes.has(t[2])); });
        if (opt.fixPath && (sec === 'FILES' || sec === 'TEMPERATURE')) rows = rows.map(r => { const t = AV.tokenize(r); if (!t.length || r.trim()[0] === ';') return r;
          const qp = (p) => /\s/.test(p) ? '"' + p + '"' : p;
          if (sec === 'FILES' && t.length >= 3) return t[0] + ' ' + t[1] + ' ' + qp(opt.fixPath(t.slice(2).join(' ')));
          if (sec === 'TEMPERATURE' && /^FILE$/i.test(t[0]) && t[1]) return t[0] + ' ' + qp(opt.fixPath(t[1])) + (t[2] ? ' ' + t.slice(2).join(' ') : '');
          return r; });
        sm.raw[sec] = rows; }
      for (const s of sm.subcatchments.values()) if (s.p.outlet && !sm.nodes.has(s.p.outlet) && !sm.subcatchments.has(s.p.outlet)) warn.push(PID(p) + ': outlet of subcatchment ' + s.id + ' missing');
      const inNodes = new Map(); for (const c of B.cutsIn) { if (!inNodes.has(c.down)) inNodes.set(c.down, []); inNodes.get(c.down).push(c); }
      if (bnd && inNodes.size) { if (!sm.raw.INFLOWS) { sm.raw.INFLOWS = []; if (!sm.rawOrder.includes('INFLOWS')) sm.rawOrder.push('INFLOWS'); }
        for (const [dn, cs] of inNodes) {
          if (sm.raw.INFLOWS.some(r => { const t = AV.tokenize(r); return t[0] === dn && /^FLOW$/i.test(t[1] || ''); })) { warn.push(PID(p) + ': ' + dn + ' already has an external inflow; the base-run coupling inflow is not added (the coupled run sets it)'); continue; }
          const acc = new Map(); for (const c of cs) for (const [t, q] of bnd.flow.get(c.link.id) || []) acc.set(t, (acc.get(t) || 0) + Math.abs(q));
          if (!acc.size) continue; const ser = 'CPL_Q_' + dn; sm.timeseries.set(ser, { file: null, rows: [...acc].sort((a, b) => a[0] - b[0]).map(([t, q]) => ['', t.toFixed(4), +q.toPrecision(6)]), desc: 'Base-run inflow from ' + [...new Set(cs.map(c => PID(c.upPart)))].join(', ') });
          sm.raw.INFLOWS.push(dn.padEnd(17) + 'FLOW'.padEnd(17) + ser.padEnd(17) + 'FLOW     1.0      1.0'); } }
      // written as for a run (all objects reported, rainfall series in the project units), so that the coupled run
      // matches a run of the whole model
      const text = sm.toINP({ reportAll: true }); const st = P.stats[p];
      res.push({ p, file: opt.pattern.replace('{model}', name).replace('{nn}', pad2(p)), text, nodes: sm.nodes.size, links: sm.links.size, subs: sm.subcatchments.size, cin: st.cin, cout: st.cout, outfalls: st.outfalls });
    }
    return { files: res, couplings, warn, name };
  };
  // base-run boundary series for the standalone sub-models
  AV.partBoundary = async function (app, P) {
    const R = app.results; if (!R || !R.idx) return null; const fu = R.meta.flowUnits; const FU = typeof fu === 'number' ? ['CFS', 'GPM', 'MGD', 'CMS', 'LPS', 'MLD'][fu] : String(fu || '').toUpperCase(); if (FU && FU !== app.model.flowUnits) return null;
    const n = R.meta.nPeriods, dt = R.meta.reportStep / 3600; const t = (k) => (k + 1) * dt;
    const flow = new Map(), head = new Map();
    for (const c of P.cuts) {
      const li = R.idx.link.get(c.link.id); if (li !== undefined && !flow.has(c.link.id)) { const y = await window.host.outSeries(R.handle, 'link', li, 0); const a = [[0, 0]]; for (let k = 0; k < n; k++) a.push([t(k), y[k]]); flow.set(c.link.id, a); }
      const ni = R.idx.node.get(c.down); if (ni !== undefined && !head.has(c.down)) { const y = await window.host.outSeries(R.handle, 'node', ni, 1); const a = [[0, y[0]]]; for (let k = 0; k < n; k++) a.push([t(k), y[k]]); head.set(c.down, a); }
    }
    return { flow, head };
  };
  // relationship file
  AV.partDefinition = function (app, P, A, S, built, cores) {
    const m = app.model; const sig = AV.partSignatures(m); const asg = {}; for (const [id, p] of P.owner) asg[id] = p;
    return { format: 'avaris-partition', version: 1, master: built.name + '.inp', created: new Date().toISOString(), program: 'Avaris2 CS ' + ((app.info && app.info.version) || ''),
      baseResults: A.resultsName || null, settings: { partitions: P.count, balanceBy: 'nodes', tolerancePct: S.tol, doNotCut: { oscillatingFlow: { minFlowMin: S.revMin, minReversePct: S.revPct, maxReversePct: S.revMax || 95, flowAbovePctOfPeak: +S.revRel >= 0 ? +S.revRel : 2 }, keepPondingAreas: S.keepPonds !== false, ponding: { source: A.pondSource || null, depth2D: A.pondDepth || null, minFloodMin: S.pondMin, distance: A.pondDist || null } } },
      simulation: { coupling: 'every iteration', couplingNote: 'coupled run: all sub-models take the same routing step; flows and water levels at the cut points are exchanged in every iteration of every step', reportStep: m.options.REPORT_STEP || null, cores, maxPartitions: Math.floor(cores * 1.5) },
      partitions: built.files.map(f => ({ id: PID(f.p), inp: f.file, nodes: f.nodes, links: f.links, subcatchments: f.subs, outfalls: f.outfalls, couplingsIn: f.cin, couplingsOut: f.cout, hotstart: null, hash: fnv(f.text) })),
      couplings: built.couplings, levels: AV.partLevels(P), pattern: S.pattern, folder: S.folderRel || '.', manualChanges: P.manual || 0, assignment: asg, signatures: sig };
  };

  // ------------------------------------------------------------------ map display
  AV.partStyle = function (app, layer, o) {
    const V = app.partView; if (!V || !V.P) return null; const P = V.P;
    if (layer === 'node') { const p = P.owner.get(o.id); if (p === undefined) return null; return { color: V.sel === null || V.sel === p ? COL(p) : '#cfd8dc', size: 3, hide: false }; }
    if (layer === 'link') { const pa = P.owner.get(o.from), pb = P.owner.get(o.to); if (pa === undefined) return null;
      return { color: pa !== pb ? '#37474f' : (V.sel === null || V.sel === pa ? COL(pa) : '#cfd8dc'), size: pa !== pb ? 3 : 1.8, hide: false }; }
    if (layer === 'sub') { const p = P.subOwner && P.subOwner.get(o.id); if (p === undefined) return null; return { color: COLA(p, V.sel === null || V.sel === p ? 0.30 : 0.07), size: null, hide: false }; }
    return null;
  };
  AV.partOverlay = function (map, ctx) {
    const app = map.app, V = app.partView; if (!V || !V.P) return; const P = V.P, m = app.model; ctx.save();
    if (V.showNo && V.A && V.S.keepPonds !== false) for (const [k, g] of V.A.ponds.entries()) { if (P.splitPond && P.splitPond.has(k)) continue; for (const id of g) { const n = m.nodes.get(id); if (!n) continue; const [x, y] = map.toScreen(n.x, n.y); ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.strokeStyle = 'rgba(30,136,229,.85)'; ctx.setLineDash([3, 2]); ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]); } }
    if (V.showNo) { ctx.save(); ctx.strokeStyle = 'rgba(142,36,170,.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); const vb = map.visibleBox();
      for (const id of P.why.keys()) { const l = m.links.get(id); if (!l) continue; const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) continue;
        if (Math.max(a.x, b.x) < vb.x1 || Math.min(a.x, b.x) > vb.x2 || Math.max(a.y, b.y) < vb.y1 || Math.min(a.y, b.y) > vb.y2) continue;
        ctx.beginPath(); const p0 = map.toScreen(a.x, a.y); ctx.moveTo(p0[0], p0[1]); for (const v of l.verts) { const q = map.toScreen(v[0], v[1]); ctx.lineTo(q[0], q[1]); } const p1 = map.toScreen(b.x, b.y); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); }
      ctx.restore(); }
    const linePath = (l) => { const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) return false; ctx.beginPath(); const p0 = map.toScreen(a.x, a.y); ctx.moveTo(p0[0], p0[1]); for (const v of l.verts) { const q = map.toScreen(v[0], v[1]); ctx.lineTo(q[0], q[1]); } const p1 = map.toScreen(b.x, b.y); ctx.lineTo(p1[0], p1[1]); return true; };
    // Move Cut: the released cut (grey) and the blinking candidate conduits
    if (V.move) { const on = Math.floor((Date.now() - V.move.t0) / 400) % 2 === 0; ctx.save(); ctx.lineCap = 'round';
      if (linePath(V.move.c.link)) { ctx.strokeStyle = 'rgba(96,96,96,.9)'; ctx.lineWidth = 3; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); }
      for (const k of V.move.cand.values()) if (linePath(k.link)) { ctx.strokeStyle = on ? 'rgba(255,234,0,.95)' : 'rgba(255,61,0,.9)'; ctx.lineWidth = on ? 10 : 6; ctx.stroke(); ctx.strokeStyle = '#212121'; ctx.lineWidth = 1.2; ctx.stroke(); }
      ctx.restore(); }
    if (V.showCut) for (const c of P.cuts) { if (V.move && V.move.c.link === c.link) continue; const a = m.nodes.get(c.link.from), b = m.nodes.get(c.link.to); const pts = [map.toScreen(a.x, a.y)].concat(c.link.verts.map(v => map.toScreen(v[0], v[1]))).concat([map.toScreen(b.x, b.y)]); const k = Math.floor(pts.length / 2);
      const X = pts.length % 2 ? pts[k][0] : (pts[k - 1][0] + pts[k][0]) / 2, Y = pts.length % 2 ? pts[k][1] : (pts[k - 1][1] + pts[k][1]) / 2;
      const bad = P.why.has(c.link.id); ctx.beginPath(); ctx.arc(X, Y, 7, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = bad ? '#ff6d00' : '#d32f2f'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X - 3.5, Y - 3.5); ctx.lineTo(X + 3.5, Y + 3.5); ctx.moveTo(X + 3.5, Y - 3.5); ctx.lineTo(X - 3.5, Y + 3.5); ctx.lineWidth = 1.8; ctx.stroke(); }
    ctx.font = '600 12px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of P.stats) { if (!s.nodes) continue; const [X, Y] = map.toScreen(s.cx / s.nodes, s.cy / s.nodes); ctx.lineWidth = 3.5; ctx.strokeStyle = '#fff'; ctx.strokeText(PID(s.i), X, Y); ctx.fillStyle = '#111'; ctx.fillText(PID(s.i), X, Y); }
    ctx.restore();
  };
  AV.partLegend = function (app) {
    const V = app.partView; if (!V || !V.P) return null;
    return h('div', null, h('div', { class: 'lt' }, 'Model partition: ' + V.P.count + ' partitions'),
      h('div', { class: 'lr' }, h('span', { style: { display: 'inline-block', width: '18px', borderTop: '3px solid #37474f', verticalAlign: 'middle', marginRight: '6px' } }), 'Coupling link (cut point ⊗)'), h('div', { class: 'lr', style: { color: '#555' } }, 'Areas: subcatchments in the colour of the partition their outlet drains to'),
      V.showNo ? h('div', { class: 'lr' }, h('span', { style: { display: 'inline-block', width: '18px', borderTop: '2px dashed #8e24aa', verticalAlign: 'middle', marginRight: '6px' } }), 'Not cut (oscillating flow, pump, weir …)') : null,
      V.showNo && V.A && V.A.ponds.length && V.S.keepPonds !== false ? h('div', { class: 'lr' }, h('span', { style: { display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', border: '1.5px dashed #1e88e5', verticalAlign: 'middle', marginRight: '9px' } }), 'Ponding area – kept together') : null);
  };

  // ------------------------------------------------------------------ surface area of every partition (DEM, D8)
  // the pipes of each partition are burnt into the DEM (with a buffer that grows with the peak flow); every DEM cell
  // is assigned to the partition it drains to (priority-flood from the burnt pipes = D8 on the depression-filled DEM),
  // optionally only inside the 2D boundary; the cells of each partition are traced into polygons.
  AV.partSurface = async function (app, P, A, demPath, maskPath, progress) {
    const m = app.model; const dem = await AV.readRasterFull(demPath);
    const [c0, c1, c2] = dem.corners; let W = dem.w, H = dem.h; let px = (c1[0] - c0[0]) / W, py = (c0[1] - c2[1]) / H; const nod = dem.nodata;
    // limit to the model extent (plus a margin) and to about 4 million cells
    const bb = m.bounds(false); const mg = Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) * 0.05 + 5 * Math.max(px, py);
    let i0 = Math.max(0, Math.floor((bb.x1 - mg - c0[0]) / px)), i1 = Math.min(W, Math.ceil((bb.x2 + mg - c0[0]) / px)), j0 = Math.max(0, Math.floor((c0[1] - bb.y2 - mg) / py)), j1 = Math.min(H, Math.ceil((c0[1] - bb.y1 + mg) / py));
    if (i1 <= i0 || j1 <= j0) throw new Error('The DEM does not cover the model.');
    const f = Math.max(1, Math.ceil(Math.sqrt((i1 - i0) * (j1 - j0) / 4e6))); const w = Math.ceil((i1 - i0) / f), hh = Math.ceil((j1 - j0) / f);
    const ox = c0[0] + i0 * px, oy = c0[1] - j0 * py, cx = px * f, cy = py * f; const N = w * hh;
    const z = new Float32Array(N).fill(NaN);
    for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) { let s = 0, n = 0; for (let b = 0; b < f; b++) { const jj = j0 + j * f + b; if (jj >= j1) break; for (let a = 0; a < f; a++) { const ii = i0 + i * f + a; if (ii >= i1) break; const v = dem.data[jj * W + ii];
      if (!isFinite(v) || Math.abs(v) > 1e30 || (nod !== null && Math.abs(v - nod) <= Math.max(1e-6, Math.abs(nod) * 1e-6))) continue; s += v; n++; } } if (n) z[j * w + i] = s / n; }
    // optional mask: the 2D boundary polygons (scanline fill)
    if (maskPath) { try { const L = await AV.loadDataFile(app, maskPath); const rings = L.features.filter(x => x.type === 'polygon').flatMap(x => x.coords); if (rings.length) {
      const inside = new Uint8Array(N);
      for (let j = 0; j < hh; j++) { const y = oy - (j + 0.5) * cy; const xs = []; for (const r of rings) for (let k = 0, l = r.length - 1; k < r.length; l = k++) { const a = r[k], b = r[l]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
        xs.sort((a, b) => a - b); for (let k = 0; k + 1 < xs.length; k += 2) { const ia = Math.max(0, Math.ceil((xs[k] - ox) / cx - 0.5)), ib = Math.min(w - 1, Math.floor((xs[k + 1] - ox) / cx - 0.5)); for (let i = ia; i <= ib; i++) inside[j * w + i] = 1; } }
      for (let k = 0; k < N; k++) if (!inside[k]) z[k] = NaN; } } catch (e) { console.warn('mask', e); } }
    // burn the pipes: label = partition + 1, buffer radius grows with the peak flow
    const lab = new Int32Array(N); const qmax = Math.max(1e-9, ...[...A.links.values()].map(x => x.q));
    const cell = (x, y) => { const i = Math.floor((x - ox) / cx), j = Math.floor((oy - y) / cy); return i < 0 || j < 0 || i >= w || j >= hh ? -1 : j * w + i; };
    const burn = (pts, L, r) => { for (let k = 1; k < pts.length; k++) { const [x1, y1] = pts[k - 1], [x2, y2] = pts[k]; const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (Math.min(cx, cy) * 0.5)));
      for (let t = 0; t <= n; t++) { const x = x1 + (x2 - x1) * t / n, y = y1 + (y2 - y1) * t / n; const c = cell(x, y); if (c < 0) continue; const ci = c % w, cj = (c - ci) / w;
        for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) { const ii = ci + a, jj = cj + b; if (ii < 0 || jj < 0 || ii >= w || jj >= hh) continue; const q = jj * w + ii; if (isNaN(z[q])) continue; if (!lab[q] || (a === 0 && b === 0)) lab[q] = L; } } } };
    for (const l of m.links.values()) { const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) continue; const pa = P.owner.get(l.from), pb = P.owner.get(l.to); const c = pa === pb ? pa : (P.cuts.find(x => x.link === l) || {}).upPart; if (c === undefined) continue;
      const q = (A.links.get(l.id) || {}).q || 0; burn([[a.x, a.y]].concat(l.verts).concat([[b.x, b.y]]), c + 1, Math.round(2 * Math.sqrt(q / qmax))); }
    if (progress) progress('Assigning the DEM cells to partitions (D8)…'); await new Promise(r => setTimeout(r, 0));
    // priority flood from the burnt cells
    const hk = new Float64Array(N + 8), hi = new Int32Array(N + 8); let hn = 0;
    const push = (k, v) => { let i = hn++; while (i > 0) { const pi = (i - 1) >> 1; if (hk[pi] <= v) break; hk[i] = hk[pi]; hi[i] = hi[pi]; i = pi; } hk[i] = v; hi[i] = k; };
    const pop = () => { const k = hi[0]; const v = hk[--hn]; const x = hi[hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hk[c + 1] < hk[c]) c++; if (hk[c] >= v) break; hk[i] = hk[c]; hi[i] = hi[c]; i = c; } hk[i] = v; hi[i] = x; return k; };
    const lev = new Float32Array(N); for (let k = 0; k < N; k++) if (lab[k]) { lev[k] = z[k]; push(k, z[k]); }
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (hn) { const k = pop(); const i = k % w, j = (k - i) / w; for (const [a, b] of D) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= w || jj >= hh) continue; const q = jj * w + ii; if (lab[q] || isNaN(z[q])) continue; lab[q] = lab[k]; lev[q] = Math.max(z[q], lev[k]); push(q, lev[q]); } }
    if (progress) progress('Tracing the partition areas…'); await new Promise(r => setTimeout(r, 0));
    // trace the boundary of every label into rings (outer clockwise, holes counter-clockwise)
    const X = (i) => ox + i * cx, Y = (j) => oy - j * cy; const out = [];
    for (let L = 1; L <= P.count; L++) {
      const edges = new Map(); const key = (i, j) => i + ',' + j; const add = (a, b, c, d) => { const k = key(a, b); let e = edges.get(k); if (!e) edges.set(k, e = []); e.push([c, d]); };
      let n = 0; for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) { if (lab[j * w + i] !== L) continue; n++; const at = (ii, jj) => ii >= 0 && jj >= 0 && ii < w && jj < hh && lab[jj * w + ii] === L;
        if (!at(i, j - 1)) add(i, j, i + 1, j); if (!at(i + 1, j)) add(i + 1, j, i + 1, j + 1); if (!at(i, j + 1)) add(i + 1, j + 1, i, j + 1); if (!at(i - 1, j)) add(i, j + 1, i, j); }
      const rings = [];
      for (const [k0, list] of edges) while (list.length) { const [sx, sy] = k0.split(',').map(Number); const ring = [[sx, sy]]; let [cxx, cyy] = list.pop(); let dx = cxx - sx, dy = cyy - sy; let guard = 0;
        while (!(cxx === sx && cyy === sy) && guard++ < 4 * N) { ring.push([cxx, cyy]); const e = edges.get(key(cxx, cyy)); if (!e || !e.length) break;
          // at a pinch point turn right first (keeps the rings simple)
          let pick = 0; if (e.length > 1) { const pref = [[-dy, dx], [dx, dy], [dy, -dx]]; for (const [ax, ay] of pref) { const t = e.findIndex(([ex, ey]) => ex - cxx === ax && ey - cyy === ay); if (t >= 0) { pick = t; break; } } }
          const [nx, ny] = e.splice(pick, 1)[0]; dx = nx - cxx; dy = ny - cyy; cxx = nx; cyy = ny; }
        // drop collinear points
        const r = []; for (let t = 0; t < ring.length; t++) { const a = ring[(t - 1 + ring.length) % ring.length], b = ring[t], c = ring[(t + 1) % ring.length]; if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) r.push([X(b[0]), Y(b[1])]); }
        if (r.length >= 3) { r.push(r[0].slice()); rings.push(r); } }
      out.push({ p: L - 1, rings, cells: n, areaMap: n * cx * cy });
    }
    return { areas: out, cellSize: cx, factor: f };
  };
  // write the area of every partition as a 2D boundary shapefile (fields length and roughness for Create Meshes)
  AV.partWriteSurface = async function (app, S, folder, name, size, rough, prj) {
    const files = [];
    for (const a of S.areas) { if (!a.rings.length) { files.push(null); continue; } const feats = [{ type: 'polygon', coords: a.rings, props: { partition: 'P' + String(a.p + 1).padStart(2, '0'), length: size, roughness: rough } }];
      const fields = AV.SHP.fieldsFor(feats.map(f => f.props), ['partition', 'length', 'roughness']); const wr = AV.SHP.write('polygon', feats, fields);
      const b = AV.joinPath(folder, name + '_P' + String(a.p + 1).padStart(2, '0') + '_2d_boundary'); await window.host.writeBinary(b + '.shp', new Uint8Array(wr.shp)); await window.host.writeBinary(b + '.shx', new Uint8Array(wr.shx)); await window.host.writeBinary(b + '.dbf', new Uint8Array(wr.dbf)); if (prj) await window.host.writeText(b + '.prj', prj);
      files.push(AV.basename(b) + '.shp'); }
    const feats = S.areas.filter(a => a.rings.length).map(a => ({ type: 'polygon', coords: a.rings, props: { partition: 'P' + String(a.p + 1).padStart(2, '0'), length: size, roughness: rough } }));
    if (feats.length) { const fields = AV.SHP.fieldsFor(feats.map(f => f.props), ['partition', 'length', 'roughness']); const wr = AV.SHP.write('polygon', feats, fields); const b = AV.joinPath(folder, name + '_partitions');
      await window.host.writeBinary(b + '.shp', new Uint8Array(wr.shp)); await window.host.writeBinary(b + '.shx', new Uint8Array(wr.shx)); await window.host.writeBinary(b + '.dbf', new Uint8Array(wr.dbf)); if (prj) await window.host.writeText(b + '.prj', prj); }
    return files;
  };

  // ------------------------------------------------------------------ coupled parallel run
  // what the Run dialog needs: the partition definition next to the model, its sub-model files and whether the master
  // model changed since the sub-models were written (then they must be regenerated first)
  AV.partitionRunInfo = async function (app) {
    if (!app.filePath) return null; const p = app.filePath.replace(/\.inp$/i, '.partition.json');
    let def = null; try { if (!await window.host.exists(p)) return null; def = JSON.parse(await window.host.readText(p)); } catch (e) { return null; }
    if (!def || def.format !== 'avaris-partition' || !(def.partitions || []).length) return null;
    const mdir = AV.dirname(app.filePath); const f = def.folder || '.';
    const folder = /^([a-zA-Z]:|[\\/])/.test(f) ? f : f === '.' ? mdir : AV.joinPath(mdir, f.replace(/^\.[\\/]/, '').replace(/\//g, mdir.includes('\\') ? '\\' : '/'));
    const lev = new Map(); (def.levels || []).forEach((L, i) => L.forEach(id => lev.set(id, i)));
    const parts = def.partitions.map(x => ({ id: x.id, inp: AV.joinPath(folder, x.inp), level: lev.get(x.id) || 0, hash: x.hash }));
    const missing = [], edited = [];
    for (const x of parts) { try { if (!await window.host.exists(x.inp)) { missing.push(AV.basename(x.inp)); continue; } if (x.hash && AV.fnvHash(await window.host.readText(x.inp)) !== x.hash) edited.push(AV.basename(x.inp)); } catch (e) { missing.push(AV.basename(x.inp)); } }
    // changes of the master model since the partition (object signatures)
    const sig = AV.partSignatures(app.model), old = def.signatures || { N: {}, L: {}, S: {} }; let stale = 0;
    for (const k of ['N', 'L', 'S']) { const a = sig[k], b = old[k] || {}; for (const id in a) if (a[id] !== b[id]) stale++; for (const id in b) if (!(id in a)) stale++; }
    if (old.shared && old.shared !== sig.shared) stale++;
    return { def, folder, parts, missing, edited, stale, has2D: AV.f2dEnabled ? AV.f2dEnabled(app.model) : false };
  };
  AV.partitionRunJob = function (app, ci) {
    const m = app.model, def = ci.def; const pidx = new Map(def.partitions.map((x, i) => [x.id, i]));
    return {
      parts: ci.parts.map(x => ({ inp: x.inp, level: x.level })),
      couplings: def.couplings.map(c => ({ up: pidx.get(c.up.partition), outfall: c.up.node, link: c.link, down: pidx.get(c.down.partition), node: c.down.node, reversed: !!c.reversed })),
      order: { subcatch: [...m.subcatchments.keys()], node: [...m.nodes.keys()], link: [...m.links.keys()] },
      nodeOwner: def.assignment, title: (m.title || []).slice(0, 3), usUnits: /^(CFS|GPM|MGD)$/i.test(m.flowUnits || '') };
  };
})(window.AV);
