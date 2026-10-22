// Time functions of the expression language (themes, clauses, Insight flags), all in minutes:
//   dur(c)        time c was true from the start up to the current time step
//   run(c)        how long c has been true without a break at the current time step (0 when false now)
//   win(c, W)     time c was true within the last W minutes (up to the current time step)
//   totdur(c)     total time c was true in the whole simulation
//   maxrun(c)     longest uninterrupted period c was true
//   maxwin(c, W)  most time c was true within any W-minute window
//   first(c)      elapsed time when c was first true (null = never)
//   peak(x)       highest value of x over the simulation (x may use the functions above, e.g. a flag level)
// They read every reported time step of the results file once (one pass, all functions requested together,
// inner functions before outer ones) and keep compact per-object intervals, so playing back is instant.
// Accuracy is the report time step: a condition is "true for one step" = one report step.
'use strict';
(function (AV) {
  const T = AV.Temporal = { stores: new Map(), running: new Map(), queue: [], curP: null, listeners: new Set() };
  const truthy = (v) => v !== null && v !== undefined && v !== false && v !== 0 && v !== '' && !(typeof v === 'number' && !isFinite(v));
  const keyOf = (R, node) => R.handle + '|' + (AV.app && AV.app.model ? AV.app.model.version : 0) + '|' + node.kind + '|' + node.key;
  // the store of a node, cached on the node (keyOf builds a long string: too slow for millions of look-ups)
  const storeOf = (R, node) => { const v = AV.app && AV.app.model ? AV.app.model.version : 0; const c = node._sc;
    if (c && c.h === R.handle && c.v === v && T.stores.get(c.k) === c.st) return c.st;
    const k = keyOf(R, node); const st = T.stores.get(k); if (st) node._sc = { h: R.handle, v, k, st }; return st; };

  // number of true steps of an interval list within [a, b] (an open interval runs up to lastP)
  const count = (iv, a, b, lastP) => { let n = 0; for (const [s, e0] of iv) { const e = e0 < 0 ? lastP : e0; if (e < a || s > b) continue; n += Math.min(e, b) - Math.max(s, a) + 1; } return n; };

  T.value = function (node, o) {
    const app = AV.app; const R = app && app.results; if (!R || !o) return null;
    const st = storeOf(R, node);
    if (!st) { T.request(node); return null; }
    const live = T.curP !== null && st.live; if (!st.done && !live) return null;
    // inside a pass over the results (T.curP set) a finished store is read at the pass's time step too
    const p = T.curP !== null ? T.curP : R.period; const lastP = live ? T.curP : st.n - 1; const step = st.stepMin;
    const s = st.data.get(o.id);
    if (node.fn === 'peak') return s ? s.max : null;
    const iv = s || []; const nW = Math.max(1, Math.round((node.W || 60) / step));
    switch (node.fn) {
      case 'dur': return count(iv, 0, p, lastP) * step;
      case 'run': { const L = iv[iv.length - 1]; if (!L) return 0; for (let k = iv.length - 1; k >= 0; k--) { const [a, e0] = iv[k]; const e = e0 < 0 ? lastP : e0; if (a <= p && p <= e) return (p - a + 1) * step; if (e < p) break; } return 0; }
      case 'win': return count(iv, p - nW + 1, p, lastP) * step;
      case 'totdur': return st.done ? count(iv, 0, lastP, lastP) * step : null;
      case 'maxrun': { if (!st.done) return null; let m = 0; for (const [a, e0] of iv) { const e = e0 < 0 ? lastP : e0; m = Math.max(m, e - a + 1); } return m * step; }
      case 'maxwin': {
        if (!st.done) return null; if (s && s.maxwin !== undefined) return s.maxwin;
        const pts = []; for (const [a, e0] of iv) { const e = e0 < 0 ? lastP : e0; for (let q = a; q <= e; q++) pts.push(q); }
        let best = 0, j = 0; for (let k = 0; k < pts.length; k++) { while (pts[k] - pts[j] >= nW) j++; best = Math.max(best, k - j + 1); }
        const v = best * step; if (s) s.maxwin = v; return v;
      }
      case 'first': return iv.length ? (iv[0][0] + 1) * step : null;
    }
    return null;
  };
  // time of the peak (period index) for peak(x); null when unknown
  T.peakPeriod = function (node, o) { const R = AV.app && AV.app.results; if (!R) return null; const st = T.stores.get(keyOf(R, node)); const s = st && st.done && st.data.get(o.id); return s ? s.pmax : null; };
  T.ready = function (nodes) { const R = AV.app && AV.app.results; if (!R) return false; return nodes.every(n => { const st = T.stores.get(keyOf(R, n)); return st && st.done; }); };
  T.onDone = function (fn) { T.listeners.add(fn); return () => T.listeners.delete(fn); };

  // queue a function (and the functions nested in it) for the next pass over the results
  T.request = function (node) {
    const R = AV.app && AV.app.results; if (!R) return;
    const add = (n) => { const k = keyOf(R, n); if (T.stores.has(k) || T.running.has(k) || T.queue.some(q => keyOf(R, q) === k)) return; T.queue.push(n); for (const c of n.children || []) add(c); };
    add(node);
    if (!T._timer) T._timer = setTimeout(() => { T._timer = null; T.runQueue(); }, 0);
  };
  T.ensure = async function (nodes) { for (const n of nodes) T.request(n); while (T.queue.length || T.running.size) await new Promise(r => setTimeout(r, 60)); };

  T.runQueue = async function () {
    const app = AV.app; const R = app && app.results; if (!R || !T.queue.length) return;
    // forget stores of other results / older model versions
    for (const k of [...T.stores.keys()]) if (!k.startsWith(R.handle + '|' + app.model.version + '|')) T.stores.delete(k);
    // a function that uses a whole-run function (totdur, maxrun, …, peak) of an unfinished pass waits for the next pass
    const WH = new Set(['totdur', 'maxrun', 'maxwin', 'first', 'peak']);
    const pending = (nd) => (nd.children || []).some(c => { const s = T.stores.get(keyOf(R, c)); return (WH.has(c.fn) && !(s && s.done)) || pending(c); });
    const all = T.queue.splice(0).sort((a, b) => a.depth - b.depth);
    const nodes = all.filter(nd => !pending(nd)); T.queue.push(...all.filter(nd => pending(nd)));
    if (!nodes.length) { T.queue.length = 0; return; }
    const n = R.meta.nPeriods, stepMin = R.meta.reportStep / 60; const m = app.model;
    const objsOf = (k) => [...(k === 'node' ? m.nodes.values() : k === 'link' ? m.links.values() : m.subcatchments.values())];
    const jobs = nodes.map(node => { const k = keyOf(R, node); const st = { done: false, live: true, n, stepMin, data: new Map() }; T.stores.set(k, st); T.running.set(k, st); return { node, st, objs: objsOf(node.kind) }; });
    const t0 = Date.now(); const handle = R.handle;
    const busy = AV.busy ? AV.busy.start('Computing time functions') : null;
    // which results the conditions read: only those columns are fetched (whole snapshots when unknown)
    const full = jobs.some(J => !Array.isArray(J.node.snaps)); const need = {};
    if (!full) for (const J of jobs) for (const [t, v] of J.node.snaps) (need[t] || (need[t] = new Set())).add(v);
    const types = Object.keys(need); const NV = R.meta.nVars; const NO = { subcatch: R.meta.ids.subcatch.length, node: R.meta.ids.node.length, link: R.meta.ids.link.length, system: 1 };
    const bufs = {}; for (const t of types) bufs[t] = new Float32Array(NO[t] * NV[t]);
    const bytesPer = types.reduce((a, t) => a + 4 * NO[t] * need[t].size, 0);
    const block = full ? 1 : Math.max(1, Math.min(n, Math.floor((24 << 20) / Math.max(1, bytesPer))));
    // simple conditions "rptX op c" / "abs(rptX) op c" are evaluated directly on the arrays (no expression per object)
    const RV = AV.RESULT_VARS || {}; const SHORT = { 'Head (HGL)': 'Hgl', 'Lateral Inflow': 'LatInflow', 'Total Inflow': 'TotInflow', 'Velocity': 'Vel' };
    const varOf = (kind, nm) => { const rk = kind === 'sub' ? 'subcatch' : kind; const L = RV[rk] || []; for (let v = 0; v < L.length; v++) { const s2 = SHORT[L[v]] || L[v].replace(/[^A-Za-z]/g, ''); if (s2.toLowerCase() === nm.toLowerCase() || (nm.toLowerCase() === 'velocity' && s2 === 'Vel')) return [rk, v]; } return null; };
    for (const J of jobs) {
      if (full) break;
      const k = /^(?:dur|run|win|totdur|maxrun|maxwin|first)\(\s*(abs\s*\(\s*)?rpt(\w+)\s*(\))?\s*(<=|>=|<|>)\s*(.+?)\s*(,\s*[\d.]+\s*)?\)$/i.exec(J.node.key || '');
      if (!k || !!k[1] !== !!k[3]) continue;
      const tv = varOf(J.node.kind, k[2]); if (!tv || !need[tv[0]] || !need[tv[0]].has(tv[1])) continue;
      // the right-hand side must not change with the time step (a number, or e.g. max(0.0001, 2 / 100 * rptMaxFlow))
      let rhs = null; try { rhs = AV.compileExpr(k[5], AV.exprFields(app, J.node.kind)); } catch (e) { rhs = null; }
      if (!rhs || rhs.temporals.length) continue; const flds = AV.exprFields(app, J.node.kind); if (rhs.used.some(nm => { const f = flds.find(x => x.n === nm); return !f || f.snap || /snap|surchargeNow|valueOf\([^)]*false/.test(String(f.get)); })) continue;
      const idx = R.idx[tv[0]]; const ii = new Int32Array(J.objs.length), cc = new Float64Array(J.objs.length);
      J.objs.forEach((o, q) => { const x = idx && idx.get(o.id); ii[q] = x === undefined ? -1 : x; const c = rhs.fn(o); cc[q] = typeof c === 'number' && isFinite(c) ? c : NaN; });
      J.fast = { t: tv[0], v: tv[1], abs: !!k[1], op: k[4], cc, ii, nv: NV[tv[0]] };
    }
    let lastYield = performance.now();
    try {
      for (let p0 = 0; p0 < n; p0 += block) {
        if (app.results !== R || R.handle !== handle) throw new Error('results changed');
        const np = Math.min(block, n - p0); let cols = null;
        if (full) { const [s, nd, l, sy] = await Promise.all(['subcatch', 'node', 'link', 'system'].map(t => window.host.outSnapshotAll(handle, p0, t))); cols = { s, nd, l, sy }; }
        else cols = Object.fromEntries(await Promise.all(types.map(async t => [t, await window.host.outColumns(handle, p0, np, t, [...need[t]])])));
        for (let q = 0; q < np; q++) {
          const p = p0 + q; const save = R.snap;
          if (full) R.snap = { subcatch: cols.s, node: cols.nd, link: cols.l, system: cols.sy };
          else { const sn = {}; for (const t of types) { const vs = [...need[t]], A = bufs[t], C = cols[t], N = NO[t], nv = NV[t]; for (let k = 0; k < vs.length; k++) { const o = (q * vs.length + k) * N, v = vs[k]; for (let i = 0; i < N; i++) A[i * nv + v] = C[o + i]; } sn[t] = A; } R.snap = sn; }
          T.curP = p;
          try {
            for (const J of jobs) {
              const { node, st } = J; const F = J.fast;
              if (node.fn === 'peak') {
                // objects whose time-dependent inner functions (dur, run, win) are never true have a constant value:
                // evaluated once only
                if (J.skip === undefined) { J.skip = null;
                  const dyn = (node.children || []).filter(c => /^(dur|run|win)$/.test(c.fn)); const sts = dyn.map(c => storeOf(R, c));
                  if (Array.isArray(node.snaps) && !node.snaps.length && sts.every(x => x && x.done)) { J.skip = new Uint8Array(J.objs.length); J.objs.forEach((o, q) => { J.skip[q] = sts.every(x => { const iv = x.data.get(o.id); return !iv || !iv.length; }) ? 1 : 0; }); } }
                for (let q2 = 0; q2 < J.objs.length; q2++) { if (J.skip && J.skip[q2] && p > 0) continue; const o = J.objs[q2]; let v = node.cond(o); if (typeof v === 'boolean') v = v ? 1 : 0; v = typeof v === 'number' ? v : (v === null || v === undefined ? null : Number(v)); if (v === null || !isFinite(v)) continue;
                  const d = st.data.get(o.id); if (!d) st.data.set(o.id, { max: v, pmax: p }); else if (v > d.max) { d.max = v; d.pmax = p; } }
              } else {
                const A = F ? R.snap[F.t] : null;
                for (let q2 = 0; q2 < J.objs.length; q2++) { const o = J.objs[q2]; let c;
                  if (F) { const i = F.ii[q2], cv = F.cc[q2]; if (i < 0 || cv !== cv) c = false; else { let x = A[i * F.nv + F.v]; if (F.abs) x = Math.abs(x); c = F.op === '>' ? x > cv : F.op === '<' ? x < cv : F.op === '>=' ? x >= cv : x <= cv; } }
                  else c = truthy(node.cond(o));
                  let iv = st.data.get(o.id);
                  if (c) { if (!iv) st.data.set(o.id, iv = []); const L = iv[iv.length - 1]; if (!L || L[1] >= 0) iv.push([p, -1]); }
                  else if (iv) { const L = iv[iv.length - 1]; if (L && L[1] < 0) L[1] = p - 1; } }
              }
            }
          } finally { R.snap = save; T.curP = null; }
          // keep the window responsive
          if (performance.now() - lastYield > 40) { if (busy) busy.set((p + 1) / n); await new Promise(r => setTimeout(r, 0)); lastYield = performance.now(); if (app.results !== R) throw new Error('results changed'); }
        }
        const done = Math.min(n, p0 + np); if (busy) busy.set(done / n);
        app.status('Computing time functions … ' + Math.round(100 * done / n) + ' %'); await new Promise(r => setTimeout(r, 0));
      }
      for (const J of jobs) { for (const iv of J.st.data.values()) if (Array.isArray(iv)) { const L = iv[iv.length - 1]; if (L && L[1] < 0) L[1] = n - 1; } J.st.done = true; J.st.live = false; }
      app.status('Time functions computed (' + nodes.length + ' function' + (nodes.length > 1 ? 's' : '') + ', ' + n + ' time steps, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s).');
    } catch (e) {
      for (const J of jobs) T.stores.delete(keyOf(R, J.node));
      if (!/results changed/.test(e.message)) console.warn('temporal', e);
    } finally { for (const J of jobs) T.running.delete(keyOf(R, J.node)); if (busy) busy.done(); }
    if (T.queue.length) return T.runQueue();
    if (app.theme) { app.theme.invalidate(); app.map.redraw(); }
    for (const fn of T.listeners) { try { fn(); } catch (e) { } }
  };

  // does an expression change with the time step? whole-run functions (totdur, maxrun, maxwin, first, peak) are static
  // even when their condition uses current-step results
  const DYN = /(?:\b|(?<=_))rpt(Depth|Hgl|Volume|LatInflow|TotInflow|Flooding|Flow|Vel|Velocity|Capacity|Surcharge|Rainfall|SnowDepth|Evaporation|Infiltration|Runoff|GWFlow|GWElevation|SoilMoisture)\b|\bsysRain\b|\b(dur|run|win)\s*\(/i;
  AV.exprIsDynamic = function (src) {
    let s = String(src || ''); const re = /\b(totdur|maxrun|maxwin|first|peak)\s*\(/i; let m;
    while ((m = re.exec(s))) { let k = m.index + m[0].length, depth = 1; while (k < s.length && depth) { if (s[k] === '(') depth++; else if (s[k] === ')') depth--; k++; } s = s.slice(0, m.index) + ' 0 ' + s.slice(k); }
    return DYN.test(s);
  };
  // ---------------------------------------------------------------- computed model fields used by flags
  // crown elevation of the highest conduit connected to a node (surcharge = water level above it)
  AV.nodeCrown = function (m, n) {
    if (!m._crownCache || m._crownVer !== m.version) {
      const elevOff = /ELEVATION/i.test(m.options.LINK_OFFSETS || ''); const c = new Map();
      for (const l of m.links.values()) {
        if (l.type !== 'CONDUIT') continue; const yf = parseFloat(l.p.g1); if (!(yf > 0)) continue;
        for (const [id, off] of [[l.from, l.p.inOff], [l.to, l.p.outOff]]) { const nd = m.nodes.get(id); if (!nd) continue; const z = (elevOff ? +off : +nd.p.elev + (+off || 0)) + yf; if (!(c.get(id) >= z)) c.set(id, z); }
      }
      Object.defineProperty(m, '_crownCache', { value: c, writable: true, configurable: true, enumerable: false }); Object.defineProperty(m, '_crownVer', { value: m.version, writable: true, configurable: true, enumerable: false });
    }
    const v = m._crownCache.get(n.id); return v === undefined ? null : v;
  };
  // storage volume between the bottom and depth d (default: full depth) from the storage shape
  AV.storageVolume = function (m, n, d) {
    const p = n.p; const D = d === undefined ? parseFloat(p.maxDepth) : d; if (!(D > 0)) return null;
    const sh = String(p.shape || 'FUNCTIONAL').toUpperCase(); const a = parseFloat(p.sp1), b = parseFloat(p.sp2), c = parseFloat(p.sp3);
    let area;
    if (sh === 'FUNCTIONAL') area = (y) => (a || 0) * Math.pow(y, b || 0) + (c || 0);
    else if (sh === 'TABULAR') { const cv = m.curves.get(p.sp1); if (!cv || !cv.pts || !cv.pts.length) return null; const P = cv.pts.map(([x, y]) => [+x, +y]); area = (y) => { if (y <= P[0][0]) return P[0][1]; for (let i = 1; i < P.length; i++) if (y <= P[i][0]) return P[i - 1][1] + (P[i][1] - P[i - 1][1]) * (y - P[i - 1][0]) / ((P[i][0] - P[i - 1][0]) || 1); return P[P.length - 1][1]; }; }
    else if (sh === 'CYLINDRICAL') area = () => Math.PI / 4 * a * b;
    else if (sh === 'CONICAL') area = (y) => Math.PI / 4 * (a + 2 * c * y) * (b + 2 * c * y) * (a > 0 ? 1 : 0);
    else if (sh === 'PARABOLIC') area = (y) => c > 0 ? Math.PI / 4 * a * b * y / c : 0;
    else if (sh === 'PYRAMIDAL') area = (y) => (a + 2 * c * y) * (b + 2 * c * y);
    else return null;
    const N = 100; let v = 0; for (let i = 0; i < N; i++) { const y0 = D * i / N, y1 = D * (i + 1) / N; v += (area(y0) + area(y1)) / 2 * (y1 - y0); }
    return isFinite(v) && v > 0 ? v : null;
  };
})(window.AV);
