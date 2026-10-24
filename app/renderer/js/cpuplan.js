// Processor profile for the coupled parallel run (2.10.0): Detect, optimal number of partitions, partition sizes
// weighted by core speed, and the binding of the sub-models to the cores. Used by the renderer (window.AV) and by the
// main process (require), so plain functions only.
//
// profile = { model, logical, cores: [{ i, cls, cpus: [logical ids] }], A: { cls: speed }, B: { cls: speed }, date, sig }
//   cls  = efficiency class of the core (engine -cpuinfo; Intel hybrid: performance 1, efficiency 0)
//   A    = speed of one sub-model per physical core while all physical cores run one each (fastest class = 1)
//   B    = speed of one sub-model per logical processor while all logical processors run one each (same scale)
// A slot = a place for one sub-model: a physical core (mode 'core') or a logical processor (mode 'thread').
'use strict';
(function (root) {
  const CP = {};
  CP.parseInfo = function (text) {
    const cores = []; let logical = 0;
    for (const ln of String(text || '').split(/\r?\n/)) { const t = ln.trim().split(/\s+/);
      if (t[0] === 'CORE' && t.length >= 4) cores.push({ i: +t[1], cls: +t[2], cpus: t[3].split(',').map(Number).filter(x => x >= 0) });
      else if (t[0] === 'CPUS') logical = +t[1]; }
    if (!logical) logical = cores.reduce((s, c) => s + c.cpus.length, 0);
    return { cores, logical };
  };
  CP.sig = (model, info) => String(model || '').trim() + ' / ' + info.cores.length + 'C' + info.logical + 'T';
  // short description: "6 performance + 8 efficiency cores (20 threads)"
  CP.describe = function (p) {
    const cls = [...new Set(p.cores.map(c => c.cls))].sort((a, b) => b - a);
    if (cls.length < 2) return p.cores.length + ' cores (' + p.logical + ' threads)';
    const n = (k) => p.cores.filter(c => c.cls === k).length;
    return cls.length === 2 ? n(cls[0]) + ' performance + ' + n(cls[1]) + ' efficiency cores (' + p.logical + ' threads)' : cls.map(k => n(k) + ' class-' + k).join(' + ') + ' cores (' + p.logical + ' threads)';
  };
  // slots of a mode with their speeds, fastest first: [{ speed, cpus: [one logical id], cls, core }]
  CP.slotsOf = function (p, mode) {
    const out = [];
    const cores = [...p.cores].sort((a, b) => b.cls - a.cls || a.i - b.i);
    if (mode === 'core') for (const c of cores) out.push({ speed: (p.A && p.A[c.cls]) || 1, cpus: [c.cpus[0]], cls: c.cls, core: c.i });
    else { for (const c of cores) c.cpus.forEach((x, k) => out.push({ speed: (p.B && p.B[c.cls]) || (p.A && p.A[c.cls]) || 1, cpus: [x], cls: c.cls, core: c.i, th: k })); out.sort((a, b) => b.speed - a.speed || a.th - b.th || a.core - b.core); }
    if (mode === 'core') out.sort((a, b) => b.speed - a.speed || a.core - b.core);
    return out;
  };
  // the configuration with the most work per time; every sub-model costs a little for the exchange in every
  // iteration (1 % per sub-model), so a configuration only wins clearly. maxN: at most this many partitions (model size)
  CP.plan = function (p, maxN) {
    const opts = [];
    for (const mode of ['core', 'thread']) { let s = CP.slotsOf(p, mode); if (mode === 'thread' && s.length === p.cores.length) continue;
      if (maxN && s.length > maxN) s = s.slice(0, maxN);
      const cap = s.reduce((a, x) => a + x.speed, 0); opts.push({ mode, n: s.length, slots: s, capacity: cap, score: cap * (1 - 0.01 * s.length) }); }
    opts.sort((a, b) => b.score - a.score); return opts[0] || null;
  };
  // speeds of the n slots used by n sub-models, fastest first (no profile: all 1)
  CP.slotsFor = function (p, n) {
    if (!p || !p.cores || !p.cores.length) return new Array(n).fill(1).map(() => ({ speed: 1, cpus: null }));
    const s = n <= p.cores.length ? CP.slotsOf(p, 'core') : CP.slotsOf(p, 'thread');
    if (n <= s.length) return s.slice(0, n);
    // more sub-models than threads: they share the threads (each gets its share)
    const k = Math.ceil(n / s.length); const out = []; for (let i = 0; i < n; i++) { const b = s[i % s.length]; out.push(Object.assign({}, b, { speed: b.speed / k, cpus: null })); } return out;
  };
  // target sizes: two classes (large on the fast slots, small on the slower ones) -> { r: small / large, frac: share of small }
  CP.twoClass = function (speeds) {
    const s = [...speeds].sort((a, b) => b - a); const hi = s[0], lo = s[s.length - 1];
    if (!(hi > 0) || lo / hi > 0.95) return { r: 1, frac: 0 };
    const mid = (hi + lo) / 2; const big = s.filter(x => x >= mid), sm = s.filter(x => x < mid);
    const mb = big.reduce((a, x) => a + x, 0) / big.length, ms = sm.reduce((a, x) => a + x, 0) / sm.length;
    return { r: ms / mb, frac: sm.length / s.length };
  };
  // sizes (nodes) of the partitions -> binding by size: largest on the fastest slot. Returns per partition
  // { rank, speed, cpus, load } where load = (size / speed) / (total / sum of speeds), and the estimated speed-up
  // against one fastest core (= total / the largest size / speed).
  CP.assign = function (sizes, p) {
    const n = sizes.length; const slots = CP.slotsFor(p, n); const ord = [...sizes.keys()].sort((a, b) => sizes[b] - sizes[a] || a - b);
    const tot = sizes.reduce((a, x) => a + x, 0), cap = slots.reduce((a, x) => a + x.speed, 0); const res = new Array(n); let worst = 0;
    ord.forEach((k, i) => { const s = slots[i]; const t = sizes[k] / s.speed; worst = Math.max(worst, t); res[k] = { rank: i, speed: s.speed, cpus: s.cpus, cls: s.cls, core: s.core, th: s.th || 0, load: t / (tot / cap) }; });
    return { parts: res, speedup: worst > 0 ? tot / worst : 1, ideal: cap };
  };
  // label of a slot: "P-core 3", "E-core 2", "P-core 3 · thread 2"; one kind of core: "Core 3"
  CP.slotLabel = function (p, a) {
    if (!p || !p.cores || a.cls === undefined) return '';
    const cls = [...new Set(p.cores.map(c => c.cls))].sort((x, y) => y - x); const same = p.cores.filter(c => c.cls === a.cls).sort((x, y) => x.i - y.i);
    const k = same.findIndex(c => c.i === a.core) + 1; const kind = cls.length < 2 ? 'Core' : a.cls === cls[0] ? 'P-core' : 'E-core';
    return kind + ' ' + k + (a.th ? ' · thread ' + (a.th + 1) : '');
  };
  // binding for a run: logical processors of every sub-model (threads each), or null when there are not enough
  CP.binding = function (sizes, info, p, threads) {
    if (!info || !info.cores || !info.cores.length) return null; threads = Math.max(1, threads || 1);
    const n = sizes.length; if (n * threads > info.logical) return null;
    const prof = Object.assign({}, p || {}, { cores: info.cores, logical: info.logical });
    const order = [...sizes.keys()].sort((a, b) => sizes[b] - sizes[a] || a - b);
    let pool;
    if (n * threads <= info.cores.length) pool = CP.slotsOf(prof, 'core');
    else pool = CP.slotsOf(prof, 'thread');
    const out = new Array(n); let k = 0;
    for (const part of order) { const cpus = []; for (let t = 0; t < threads; t++) { const s = pool[k++]; if (!s) return null; cpus.push(s.cpus[0]); } out[part] = cpus; }
    return out;
  };
  // benchmark model for Detect: a branched sewer (about 1,600 conduits) under a storm, dynamic wave, 1 h simulated
  CP.benchModel = function () {
    const J = [], C = [], X = [], I = [], CO = []; let nj = 0, nc = 0;
    const pad = (a) => a.map((x, i) => i === a.length - 1 ? String(x) : String(x).padEnd(16)).join(' ');
    J.push(pad(['OUT', 0, 'FREE', 'NO'])); CO.push(pad(['OUT', 0, 0]));
    const node = (x, y, inv) => { const id = 'J' + (++nj); J.push(pad([id, inv.toFixed(3), 3, 0, 0, 50])); CO.push(pad([id, x.toFixed(1), y.toFixed(1)])); return id; };
    const pipe = (a, b, len, d) => { const id = 'C' + (++nc); C.push(pad([id, a, b, len, 0.013, 0, 0, 0, 0])); X.push(pad([id, 'CIRCULAR', d, 0, 0, 0, 1])); return id; };
    // trunk of 40 manholes, each with a lateral of 40 manholes
    let down = 'OUT', inv0 = 0;
    for (let i = 0; i < 40; i++) { const inv = inv0 + 0.1 + i * 0.12; const t = node(i * 60, 0, inv); pipe(t, down, 60, 1.5 - i * 0.02); down = t;
      let ld = t; for (let k = 0; k < 40; k++) { const li = node(i * 60, (k + 1) * 40 * (i % 2 ? 1 : -1), inv + 0.3 + k * 0.08); pipe(li, ld, 40, 0.45); I.push(pad([li, 'FLOW', 'Q', 'FLOW', 1, 1])); ld = li; } }
    const TS = ['Q 0:00 0', 'Q 0:10 0.04', 'Q 0:25 0.09', 'Q 0:40 0.03', 'Q 1:00 0.01'];
    return ['[TITLE]', 'Avaris2 CS processor benchmark', '', '[OPTIONS]', 'FLOW_UNITS CMS', 'FLOW_ROUTING DYNWAVE', 'START_DATE 01/01/2020', 'START_TIME 00:00:00',
      'REPORT_START_DATE 01/01/2020', 'REPORT_START_TIME 00:00:00', 'END_DATE 01/01/2020', 'END_TIME 01:00:00', 'REPORT_STEP 00:15:00', 'WET_STEP 00:05:00', 'DRY_STEP 00:05:00',
      'ROUTING_STEP 0.5', 'VARIABLE_STEP 0', 'MAX_TRIALS 8', 'HEAD_TOLERANCE 0.0015', 'THREADS 1', '',
      '[JUNCTIONS]', ...J.filter(l => !l.startsWith('OUT')), '', '[OUTFALLS]', J[0], '', '[CONDUITS]', ...C, '', '[XSECTIONS]', ...X, '', '[INFLOWS]', ...I, '', '[TIMESERIES]', ...TS, '',
      '[REPORT]', 'INPUT NO', 'CONTROLS NO', 'NODES NONE', 'LINKS NONE', '', '[COORDINATES]', ...CO, ''].join('\r\n');
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP;
  if (root && root.AV) root.AV.cpuPlan = CP;
})(typeof window !== 'undefined' ? window : null);
