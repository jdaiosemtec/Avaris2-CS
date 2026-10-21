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

  // number of true steps of an interval list within [a, b] (an open interval runs up to lastP)
  const count = (iv, a, b, lastP) => { let n = 0; for (const [s, e0] of iv) { const e = e0 < 0 ? lastP : e0; if (e < a || s > b) continue; n += Math.min(e, b) - Math.max(s, a) + 1; } return n; };

  T.value = function (node, o) {
    const app = AV.app; const R = app && app.results; if (!R || !o) return null;
    const st = T.stores.get(keyOf(R, node));
    if (!st) { T.request(node); return null; }
    const live = T.curP !== null && st.live; if (!st.done && !live) return null;
    const p = live ? T.curP : R.period; const lastP = live ? T.curP : st.n - 1; const step = st.stepMin;
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
    const nodes = T.queue.splice(0).sort((a, b) => a.depth - b.depth);
    const n = R.meta.nPeriods, stepMin = R.meta.reportStep / 60; const m = app.model;
    const objsOf = (k) => [...(k === 'node' ? m.nodes.values() : k === 'link' ? m.links.values() : m.subcatchments.values())];
    const jobs = nodes.map(node => { const k = keyOf(R, node); const st = { done: false, live: true, n, stepMin, data: new Map() }; T.stores.set(k, st); T.running.set(k, st); return { node, st, objs: objsOf(node.kind) }; });
    const t0 = Date.now(); const handle = R.handle;
    try {
      for (let p = 0; p < n; p++) {
        if (app.results !== R || R.handle !== handle) throw new Error('results changed');
        const [s, nd, l, sy] = await Promise.all(['subcatch', 'node', 'link', 'system'].map(t => window.host.outSnapshotAll(handle, p, t)));
        const save = R.snap; R.snap = { subcatch: s, node: nd, link: l, system: sy }; T.curP = p;
        try {
          for (const J of jobs) {
            const { node, st } = J;
            if (node.fn === 'peak') {
              for (const o of J.objs) { let v = node.cond(o); if (typeof v === 'boolean') v = v ? 1 : 0; v = typeof v === 'number' ? v : (v === null || v === undefined ? null : Number(v)); if (v === null || !isFinite(v)) continue;
                const d = st.data.get(o.id); if (!d) st.data.set(o.id, { max: v, pmax: p }); else if (v > d.max) { d.max = v; d.pmax = p; } }
            } else {
              for (const o of J.objs) { const c = truthy(node.cond(o)); let iv = st.data.get(o.id);
                if (c) { if (!iv) st.data.set(o.id, iv = []); const L = iv[iv.length - 1]; if (!L || L[1] >= 0) iv.push([p, -1]); }
                else if (iv) { const L = iv[iv.length - 1]; if (L && L[1] < 0) L[1] = p - 1; } }
            }
          }
        } finally { R.snap = save; T.curP = null; }
        if (p % 25 === 24) { app.status('Computing time functions … ' + Math.round(100 * p / n) + ' %'); await new Promise(r => setTimeout(r, 0)); }
      }
      for (const J of jobs) { for (const iv of J.st.data.values()) if (Array.isArray(iv)) { const L = iv[iv.length - 1]; if (L && L[1] < 0) L[1] = n - 1; } J.st.done = true; J.st.live = false; }
      app.status('Time functions computed (' + nodes.length + ' function' + (nodes.length > 1 ? 's' : '') + ', ' + n + ' time steps, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s).');
    } catch (e) {
      for (const J of jobs) T.stores.delete(keyOf(R, J.node));
      if (!/results changed/.test(e.message)) console.warn('temporal', e);
    } finally { for (const J of jobs) T.running.delete(keyOf(R, J.node)); }
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
