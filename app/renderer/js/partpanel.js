// Model Partition panel (Tools ▸ Partition Model / Regenerate Sub-models). Algorithm and file building: partition.js.
'use strict';
(function (AV) {
  const h = AV.h;
  const pad2 = (i) => String(i + 1).padStart(2, '0'); const PID = (i) => 'P' + pad2(i);
  const COL = (i) => AV.partColor(i);
  const defPath = (app) => app.filePath ? app.filePath.replace(/\.inp$/i, '.partition.json') : null;
  const prefsOf = (app) => Object.assign({ n: 12, revMin: 60, revPct: 5, revMax: 95, revRel: 2, keepPonds: true, pondMin: 30, pondDist: 0, pondDepth: 0, tol: 25, ctrl: 60, pattern: '{model}_P{nn}.inp', folder: '', boundary: true }, app.prefs.partition || {});
  let cores = null;
  // processor profile (2.10.0, Detect): kept in the preferences; valid only on the processor it was measured on
  AV.cpuTopoNow = null;
  AV.cpuProfileOK = (app) => { const p = app.prefs && app.prefs.cpuProfile; if (!p || !p.cores || !p.A) return null; if (AV.cpuTopoNow && AV.cpuTopoNow.sig !== p.sig) return null; return p; };
  const loadTopo = async () => { if (AV.cpuTopoNow) return; try { const t = await window.host.cpuTopology(); if (t) AV.cpuTopoNow = Object.assign(t, { sig: AV.cpuPlan.sig(t.model, t) }); } catch (e) { } };
  const getCores = async () => { if (cores) return cores; try { const c = await window.host.cpuInfo(); cores = c.physical || c.logical || 4; } catch (e) { cores = 4; } return cores; };

  AV.openPartition = async function (app, tab) {
    if (!AV.hasHPS(app)) { AV.needHPS(app, 'Model Partition'); return; }
    if (!app.model || !app.model.nodes.size) { AV.toast('Open a model first.', true); return; }
    if (!app.filePath) { AV.toast('Save the model first: the sub-models are written next to it.', true); return; }
    const C = await getCores(); await loadTopo();
    const V = app.partView || (app.partView = { P: null, A: null, sel: null, showCut: true, showNo: true, tab: 'part', S: prefsOf(app) });
    if (tab) V.tab = tab;
    const P0 = AV.floatPanel({ id: 'partition', title: 'Model Partition', minimize: true, w: 530, h: Math.min(780, window.innerHeight - 150), body: h('div', { class: 'flp' }),
      onClose: () => { app.partView = null; endPick(); app.theme.invalidate(); app.map.redraw(); app.theme.updateLegend && app.theme.updateLegend(); } });
    const root = P0.el ? AV.$('.flp', P0.el) : AV.$('.flp');
    const redrawMap = () => { app.theme.invalidate(); app.map.redraw(); app.theme.updateLegend && app.theme.updateLegend(); };
    let busy = false;
    const B = (l, fn, pri, dis) => h('button', { class: 'btn small' + (pri ? ' primary' : ''), onclick: fn, disabled: !!dis }, l);
    const num = (k, w, attrs) => h('input', Object.assign({ type: 'number', value: V.S[k], style: { width: (w || 64) + 'px' }, onchange: (e) => { V.S[k] = +e.target.value; app.prefs.partition = V.S; app.savePrefs(); } }, attrs || {}));
    const render = () => {
      root.innerHTML = '';
      root.appendChild(h('div', { class: 'fltb' }, ['part', 'regen'].map(t => h('button', { class: 'btn small' + (V.tab === t ? ' primary' : ''), onclick: () => { V.tab = t; render(); } }, t === 'part' ? 'Partition' : 'Regenerate')),
        h('span', { style: { flex: 1 } }), h('span', { class: 'flunit' }, app.model.nodes.size.toLocaleString() + ' nodes · ' + app.model.links.size.toLocaleString() + ' links')));
      const body = h('div', { class: 'fllist partp', style: { padding: '8px 12px 14px' } }); root.appendChild(body);
      if (V.tab === 'regen') { regenView(body); return; }
      const sec = (n, t) => h('div', { class: 'psec' }, h('span', { class: 'pn' }, String(n)), t);
      const R = app.results; const mx = C; const prof = AV.cpuProfileOK(app); const prof0 = app.prefs.cpuProfile;
      body.appendChild(sec(1, 'Settings'));
      body.appendChild(h('div', { class: 'form' },
        h('label', null, 'Number of partitions'), h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, num('n', 64, { min: 2, max: 400 }),
          B(V.detecting ? 'Detecting…' : 'Detect', () => detect(), false, V.detecting || busy),
          h('span', { class: 'hint' }, V.detecting ? V.detecting : prof ? '' : 'measures this computer and sets the best number and sizes of the partitions')),
        h('label', null, 'Base results'), h('span', { class: R ? '' : 'hint' }, R ? AV.basename(R.meta.file || '') + ' (' + R.meta.nPeriods + ' steps)' : 'none – run a simulation or open results (Database) first')));
      if (prof) { const pl = AV.cpuPlan.plan(prof, maxParts()); const sl = AV.cpuPlan.slotsFor(prof, V.S.n).map(x => x.speed); const tw = AV.cpuPlan.twoClass(sl); const tot = app.model.nodes.size;
        const T = tot / (V.S.n * (1 - tw.frac) + V.S.n * tw.frac * tw.r); const cls = [...new Set(prof.cores.map(c => c.cls))].sort((a, b) => b - a);
        const spd = cls.map(c => (cls.length < 2 ? 'core' : c === cls[0] ? 'performance core' : 'efficiency core') + ' ' + (prof.A[c] || 0).toFixed(2)).join(' · ') + (prof.B ? ' · with both threads busy ' + cls.map(c => (prof.B[c] || 0).toFixed(2)).join(' / ') : '');
        body.appendChild(h('div', { class: 'pmach' }, h('b', null, prof.model || 'This computer'), ' · ' + AV.cpuPlan.describe(prof) + ' · detected ' + (prof.date ? new Date(prof.date).toLocaleString() : ''), h('br'),
          'Relative speed: ' + spd, h('br'),
          h('b', null, 'Set for this computer: ' + pl.n + ' partitions'), tw.r < 0.95 ? ' – about ' + Math.round(T).toLocaleString() + ' nodes on each fast core and ' + Math.round(T * tw.r).toLocaleString() + ' on each slower one' : ' – the same size on every core', '; the cores are bound automatically at every run.',
          V.S.n !== pl.n ? h('div', { class: 'hint', style: { color: 'var(--warn)' } }, 'Number of partitions changed to ' + V.S.n + ' by hand (best for this computer: ' + pl.n + ').') : null)); }
      else if (prof0 && prof0.cores) body.appendChild(h('div', { class: 'pmach warn' }, 'The processor profile was measured on ' + (prof0.model || 'another processor') + ' – this computer is different (' + (AV.cpuTopoNow ? AV.cpuTopoNow.model : '?') + '). Click Detect to measure this computer; until then the partitions are balanced by number of nodes.'));
      const unit = app.model.isSI ? 'm' : 'ft'; const opt = (label, ctl, hint) => [h('div', { class: 'al' }, label), h('div', { class: 'ac' }, ctl), hint ? h('div', { class: 'ah' }, hint) : null];
      const keep = h('input', { type: 'checkbox', checked: V.S.keepPonds !== false, onchange: (e) => { V.S.keepPonds = e.target.checked; app.prefs.partition = V.S; app.savePrefs(); } });
      body.appendChild(h('details', { open: !!V.adv, ontoggle: (e) => { V.adv = e.target.open; } }, h('summary', null, 'Advanced'), h('div', { class: 'padv' },
        opt('Flow counts', ['above', num('revRel', 44, { step: 0.5, min: 0 }), '% of the peak, for ≥', num('revMin', 48, { min: 0 }), 'min']),
        opt('Oscillating flow', ['reverse ≥', num('revPct', 44, { min: 0 }), '% of that time → not cut']),
        opt('Flows backwards', ['reverse ≥', num('revMax', 44, { min: 0 }), '% → may be cut (drawn reversed)'],
          'Same rule as the flag Reverse flow event (Operation ▸ Flag), with its own values here. Smaller flows (noise around zero) count neither as flow nor as reverse flow.'),
        opt('Keep ponding areas whole', [keep, 'manholes of one area stay together']),
        opt('2D ponding depth', ['cells ≥', num('pondDepth', 46, { step: 0.05 }), unit], '0 = flood depth of the 2D options, else ' + (app.model.isSI ? '0.3 m' : '1 ft') + '.'),
        opt('1D ponding (no 2D results)', ['flooded ≥', num('pondMin', 46), 'min, within', num('pondDist', 52)], 'Flooded manholes closer than this distance (map units) to each other form one ponding area. 0 = ' + (app.model.isSI ? '50 m' : '150 ft') + '.'),
        opt('Size tolerance', ['±', num('tol', 46), '% of the average size']),
        h('div', { class: 'ah', style: { gridColumn: '1 / -1', marginTop: '4px' } }, 'Pumps, orifices, weirs, outlets and the links of flow dividers are never cut.'))));
      const status = h('span', { class: 'hint' });
      body.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '10px 0 2px' } }, B(V.P ? 'Partition Again' : 'Partition', () => go(status), true, busy), V.P && V.sel !== null ? B('Show All', () => { V.sel = null; render(); redrawMap(); }) : null, status));
      if (!V.P) { body.appendChild(h('div', { class: 'note', style: { marginTop: '8px' } }, 'Every partition drains in one direction (flow directions of the base results); pipes with oscillating flow, pumps, weirs … and ponding areas are not cut; the cut points are placed so that the partitions have about the same size with as few cuts as possible.')); return; }
      const P = V.P, st = P.stats; const mxN = Math.max(...st.map(s => s.nodes)), mnN = Math.min(...st.map(s => s.nodes));
      const asg = prof ? AV.cpuPlan.assign(st.map(s => s.nodes), prof) : null;
      body.appendChild(sec(2, 'Result'));
      body.appendChild(h('div', { class: 'pchips' }, [[P.count, 'partitions'], [P.cuts.length, 'cut points'], [mnN + '–' + mxN, 'nodes per partition'], [[...P.why.values()].filter(v => v.startsWith('oscillating')).length, 'oscillating pipes'], [P.hard ? P.hard.size : 0, 'never cut (pumps …)'], [V.A.ponds.length, 'ponding areas']].map(([v, l]) => h('div', { class: 'pchip' }, h('b', null, String(v)), h('span', null, l))),
        asg ? h('div', { class: 'pchip', title: 'Against one sub-model on one fastest core: total nodes / the slowest partition (its nodes / the speed of its core). Exchange costs not included.' }, h('b', { style: { color: asg.speedup >= 0.75 * asg.ideal ? 'var(--ok)' : 'var(--warn)' } }, '×' + asg.speedup.toFixed(1)), h('span', null, 'est. speed-up')) : null));
      const tb = h('table', { class: 'ptbl' }, h('tr', null, ['', 'Partition', 'Nodes', ''].concat(asg ? ['Core', 'Load'] : []).concat(['Links', 'Subc.', 'In', 'Out', 'Outfalls']).map(x => h('th', null, x))),
        st.map(s => h('tr', { class: 'p' + (V.sel === s.i ? ' sel' : ''), onclick: () => { V.sel = V.sel === s.i ? null : s.i; V.hl = null; render(); redrawMap(); }, ondblclick: () => zoomTo(s.i) },
          h('td', null, h('span', { class: 'sw', style: { background: COL(s.i) } })), h('td', null, PID(s.i)), h('td', { class: 'num' }, String(s.nodes)),
          h('td', null, h('span', { class: 'pbar' }, h('i', { style: { width: (100 * s.nodes / mxN) + '%', background: COL(s.i) } }))),
          asg ? h('td', null, h('span', { class: 'pcore ' + (asg.parts[s.i].cls === Math.max(...prof.cores.map(c => c.cls)) ? 'P' : 'E') }, AV.cpuPlan.slotLabel(prof, asg.parts[s.i]))) : null,
          asg ? h('td', { class: 'num', style: { color: asg.parts[s.i].load * 100 > 100 + +V.S.tol ? 'var(--danger)' : 'var(--ok)', fontWeight: asg.parts[s.i].load * 100 > 100 + +V.S.tol ? 600 : 400 } }, Math.round(asg.parts[s.i].load * 100) + ' %') : null,
          h('td', { class: 'num' }, String(s.links)), h('td', { class: 'num' }, String(s.subs)),
          h('td', { class: 'num' }, String(s.cin)), h('td', { class: 'num' }, String(s.cout)), h('td', { class: 'ellip', title: s.outfalls.join(', ') }, s.outfalls.length ? s.outfalls.slice(0, 3).join(', ') + (s.outfalls.length > 3 ? ' …' : '') : '→ coupled'))));
      body.appendChild(h('div', { class: 'ptwrap' }, tb));
      body.appendChild(h('div', { class: 'hint' }, (asg ? 'Core = the core the sub-model is bound to at the run (largest partition on the fastest core); Load = its work on that core against the best balance for this computer. ' : '') + 'In / Out = couplings from upstream / to downstream partitions. Click a row to highlight, double-click to zoom.'));
      body.appendChild(sec(3, 'Adjust'));
      body.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        B(V.picking === 'remove' ? 'Finish' : 'Move Cut…', () => V.picking === 'remove' ? endPick() : startPick('remove'), V.picking === 'remove'),
        B(V.picking === 'add' ? 'Finish' : 'Add Cut…', () => V.picking === 'add' ? endPick() : startPick('add'), V.picking === 'add'),
        B('Split Partition…', () => splitDlg(V.sel), false, V.sel === null || busy),
        B('Merge Partitions…', () => mergeDlg(), false, P.count < 2 || busy),
        V.undo && V.undo.length ? B('Undo', () => undo()) : null,
        V.sel === null ? h('span', { class: 'hint' }, 'select a partition to split it') : null,
        P.manual ? h('span', { class: 'hint' }, P.manual + ' manual change(s)') : null));
      body.appendChild(h('div', { class: 'hint', style: { marginTop: '4px' } }, 'Split Partition: only the selected partition is partitioned again (same settings as above); the other partitions and their cut points do not change, the new partitions get the next numbers. Merge Partitions: two adjacent partitions become one. Move Cut / Add Cut never change the number of partitions – only the boundary between two adjacent partitions moves. Move Cut: click a cut point (⊗); the feasible conduits nearby blink – click one as the new cut point. Add Cut: click a conduit; its upstream branch joins the neighbouring partition (refused if that would create a new partition; warning for oscillating flow and ponding areas; pumps, weirs … cannot be cut).'));
      body.appendChild(sec(4, 'Checks'));
      const chk = AV.partChecks(app, P, V.A, V.S, C); V.errors = chk.filter(c => c.t === 'er').length;
      body.appendChild(h('div', { class: 'pchecks' }, chk.map(c => h('div', { class: c.t }, (c.t === 'ok' ? '✓ ' : c.t === 'er' ? '✗ ' : '⚠ ') + c.s))));
      body.appendChild(sec(5, 'Generate sub-models'));
      const dir = AV.dirname(app.filePath); const folder = h('input', { type: 'text', value: (V.S.folderBy && V.S.folderBy[app.filePath]) || AV.joinPath(dir, 'Partition'), style: { width: '100%' } }); // remembered per model
      const patt = h('input', { type: 'text', value: V.S.pattern, style: { width: '100%' } });
      const bnd = h('input', { type: 'checkbox', checked: V.S.boundary !== false });
      const F2 = AV.f2d(app.model); const demAbs = F2.DEM ? absPath(AV.dirname(app.filePath), F2.DEM.replace(/^"|"$/g, '')) : '';
      const dem = h('input', { type: 'text', value: V.S.dem || demAbs, placeholder: 'DEM (GeoTIFF / ASCII grid) – optional', style: { width: '100%' } });
      const surf = h('input', { type: 'checkbox', checked: V.S.surface !== false });
      body.appendChild(h('div', { class: 'form' }, h('label', null, 'Folder'), h('span', { style: { display: 'flex', gap: '4px' } }, folder,
          B('…', async () => { let d = folder.value; while (d && !await window.host.exists(d)) { const up = AV.dirname(d); if (!up || up === d) break; d = up; } const p = await AV.folderDialog({ defaultPath: d || folder.value, title: 'Folder for the sub-models', modelFolder: AV.dirname(app.filePath) }); if (p) folder.value = p; })),
        h('label', null, 'File names'), patt, h('label', null, 'Standalone boundaries'), h('label', { style: { color: 'inherit' } }, bnd, ' base-run inflows and water levels at the cut points (each sub-model can run on its own)'),
        h('label', null, 'Partition areas'), h('label', { style: { color: 'inherit' } }, surf, ' surface area of each partition from the DEM (D8), written as its 2D boundary'),
        h('label', null, 'DEM'), h('span', { style: { display: 'flex', gap: '4px' } }, dem, B('…', async () => { const p = await window.host.openDialog({ filters: [{ name: 'DEM', extensions: ['tif', 'tiff', 'asc'] }] }); if (p) dem.value = p; }))));
      body.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, B('Generate ' + P.count + ' Sub-models', () => generate(folder.value, patt.value, bnd.checked, surf.checked ? dem.value.trim() : ''), true, V.errors || busy)));
      if (V.errors) body.appendChild(h('div', { class: 'note', style: { color: 'var(--danger)' } }, 'Fix the errors in the checks first (move the branch back, or partition again).'));
    };
    const zoomTo = (i) => { const objs = [...V.P.owner].filter(([, p]) => p === i).map(([id]) => app.model.nodes.get(id)); app.map.zoomToObjects(objs); };
    async function go(status) {
      if (busy) return; stopMove(); busy = true; status.textContent = 'Analysing the base results…'; render(); const bz = AV.busy.start('Partitioning the model');
      try { await new Promise(r => setTimeout(r, 30)); const t0 = performance.now();
        V.A = await AV.partAnalyse(app, V.S); status.textContent = 'Partitioning…'; await new Promise(r => setTimeout(r, 20));
        const pr = AV.cpuProfileOK(app); const w = pr ? AV.cpuPlan.twoClass(AV.cpuPlan.slotsFor(pr, V.S.n).map(x => x.speed)) : null;
        V.P = AV.partCompute(app, V.A, V.S, { w }); if (pr) V.P.cpu = { model: pr.model, sig: pr.sig, cores: AV.cpuPlan.describe(pr), date: pr.date }; V.sel = null; V.undo = []; V.hl = null; V.time = ((performance.now() - t0) / 1000).toFixed(1);
        app.status('Model partition: ' + V.P.count + ' partitions, ' + V.P.cuts.length + ' cut points (' + V.time + ' s).');
      } catch (e) { console.error(e); AV.alert('Partition failed: ' + e.message); }
      bz.done(); busy = false; render(); redrawMap();
    }
    // ---- manual change: move a cut, or add one – the number of partitions never changes, only adjacent partitions grow/shrink
    const HINT = { remove: 'Move Cut: click a cut point ⊗ – feasible new cut points nearby will blink – Esc to finish',
      add: 'Add Cut: click a conduit – its upstream branch joins the neighbouring partition (the number of partitions stays the same) – Esc to finish' };
    function startPick(mode) { endPick(); V.picking = mode; render();
      app.feat.startPick({ kinds: ['LINK'], hint: HINT[mode], onPick: (hit) => { if (hit && hit.kind === 'LINK') (mode === 'remove' ? movePick : addCut)(hit); }, onEnd: () => { V.picking = null; stopMove(); if (app.partView) render(); } }); }
    function endPick() { stopMove(); if (V.picking) { V.picking = null; app.setTool && app.setTool('select'); } }
    const setHint = (s) => { app.map.pickHint = s; app.map.setHint(s); };
    // flow-direction graph from the base run (a link flowing backwards most of the time points the other way)
    const flowGraph = () => { const inn = new Map(), out = new Map(); const add = (M, k, v) => { let a = M.get(k); if (!a) M.set(k, a = []); a.push(v); };
      for (const l of app.model.links.values()) { const x = V.A.links.get(l.id); const back = x && x.f > 0 && x.r / x.f > 0.5; const u = back ? l.to : l.from, d = back ? l.from : l.to; add(inn, d, { n: u, l }); add(out, u, { n: d, l }); }
      return { inn, out }; };
    const branch = (G, id, p) => { const out = [id], seen = new Set([id]), st = [id]; while (st.length) { const x = st.pop(); for (const e of G.inn.get(x) || []) if (!seen.has(e.n) && V.P.owner.get(e.n) === p) { seen.add(e.n); out.push(e.n); st.push(e.n); } } return out; };
    const sizeOf = (p) => { let n = 0; for (const q of V.P.owner.values()) if (q === p) n++; return n; };
    const flowDir = (l) => { const x = V.A.links.get(l.id); const back = x && x.f > 0 && x.r / x.f > 0.5; return back ? [l.to, l.from] : [l.from, l.to]; };
    // why a conduit is not a good cut point ('' = fine); hard = cannot be cut at all
    const cutIssue = (l, g) => { if (g.hard.has(l.id)) return 'hard';
      const [u, d] = flowDir(l); const x = V.A.links.get(l.id); const w = [];
      if (g.why.has(l.id)) w.push('it has oscillating flow (' + g.why.get(l.id).replace('oscillating flow ', '') + ' of the time with flow in reverse): the coupled run exchanges water in both directions at this point');
      if (V.S.keepPonds !== false && V.P.pondOf.has(u) && V.P.pondOf.get(u) === V.P.pondOf.get(d)) w.push('it lies in a ponding area: the ponding area would be split between two sub-models');
      if (x && x.f === 0 && V.A.hasResults) w.push('it has no flow in the base results');
      return w; };
    // links that would become cuts if the nodes 'mv' moved to partition 'to' – none of them may be a pump, weir …
    const newCuts = (G, mv, to) => { const S = new Set(mv), res = new Set();
      for (const id of mv) for (const e of [...(G.out.get(id) || []), ...(G.inn.get(id) || [])]) if (!S.has(e.n) && V.P.owner.get(e.n) !== to) res.add(e.l); return [...res]; };
    // Move Cut: release the cut, offer the feasible conduits nearby (up to K links up- or downstream) as the new cut point
    function candidates(c) {
      const P = V.P, G = flowGraph(), g = AV.partGlue(app, V.A, V.S), K = 15, cand = new Map(); const Pu = c.upPart, Pd = c.downPart;
      const ok = (l, mv, to) => { if (l.type !== 'CONDUIT' || cutIssue(l, g) === 'hard' || cutIssue(l, g).length) return false; return newCuts(G, mv, to).every(x => !g.hard.has(x.id) && !g.why.has(x.id)); };
      // downstream: a conduit inside Pd – the branch above it moves to Pu
      const nD = sizeOf(Pd); let front = [c.down], seen = new Set(front);
      for (let k = 0; k < K && front.length; k++) { const nx = []; for (const a of front) for (const e of G.out.get(a) || []) { if (P.owner.get(e.n) !== Pd || seen.has(e.n)) continue; seen.add(e.n); nx.push(e.n);
        if (!cand.has(e.l.id)) { const mv = branch(G, a, Pd); if (mv.length < nD && ok(e.l, mv, Pu)) cand.set(e.l.id, { link: e.l, to: Pu, from: Pd, nodes: mv }); } } front = nx; }
      // upstream: a conduit inside Pu – the nodes between it and the old cut move to Pd
      const all = new Set(branch(G, c.up, Pu)); front = [c.up]; seen = new Set(front);
      for (let k = 0; k < K && front.length; k++) { const nx = []; for (const a of front) for (const e of G.inn.get(a) || []) { if (P.owner.get(e.n) !== Pu || seen.has(e.n)) continue; seen.add(e.n); nx.push(e.n);
        if (!cand.has(e.l.id)) { const keep = new Set(branch(G, e.n, Pu)); const mv = [...all].filter(id => !keep.has(id)); if (mv.length && ok(e.l, mv, Pd)) cand.set(e.l.id, { link: e.l, to: Pd, from: Pu, nodes: mv }); } } front = nx; }
      return cand; }
    let blink = null;
    function stopMove() { if (blink) { clearInterval(blink); blink = null; } if (V.move) { V.move = null; app.map.redrawOverlay(); } }
    function movePick(l) {
      const P = V.P;
      if (V.move) { const k = V.move.cand.get(l.id);
        if (k) { const old = V.move.c.link.id; pushUndo(); for (const id of k.nodes) P.owner.set(id, k.to); stopMove();
          changed(P, 'Cut moved from ' + old + ' to ' + l.id + ': ' + k.nodes.length + ' node(s) moved from ' + PID(k.from) + ' to ' + PID(k.to) + ' (still ' + P.count + ' partitions).'); setHint(HINT.remove); return; }
        if (l === V.move.c.link) { stopMove(); setHint(HINT.remove); app.status('Cut ' + l.id + ' kept.'); return; } }
      const c = P.cuts.find(x => x.link === l);
      if (!c) { AV.toast(V.move ? l.id + ' is not one of the blinking conduits. Click a blinking conduit, or ' + V.move.c.link.id + ' to keep the cut there.' : l.id + ' is not a cut point. Click a conduit marked ⊗.', true); return; }
      stopMove(); const cand = candidates(c);
      if (!cand.size) { AV.toast('No feasible conduit near ' + l.id + ' (within 15 links up- or downstream) can take over this cut without changing the number of partitions. The cut stays.', true); return; }
      V.move = { c, cand, t0: Date.now() }; blink = setInterval(() => app.map.redrawOverlay(), 400); app.map.redrawOverlay();
      setHint('Move Cut: ' + l.id + ' is released. Click one of the ' + cand.size + ' blinking conduits as the new cut point (only ' + PID(c.upPart) + ' and ' + PID(c.downPart) + ' change; the number of partitions stays ' + P.count + '). Click ' + l.id + ' again to keep it, Esc to finish.');
    }
    const renumber = (P) => { const used = [...new Set(P.owner.values())].sort((a, b) => a - b); const ren = new Map(used.map((q, i) => [q, i])); for (const [id, q] of P.owner) P.owner.set(id, ren.get(q)); };
    const changed = (P, msg) => { renumber(P); P.manual = (P.manual || 0) + 1; AV.partRecut(app, P, V.A); render(); redrawMap(); app.status(msg); };
    // Add Cut: the branch above the conduit joins the neighbouring partition it borders – refused if it borders none
    async function addCut(l) {
      const P = V.P; const pa = P.owner.get(l.from), pb = P.owner.get(l.to);
      if (pa !== pb) { AV.toast(l.id + ' is already a cut point.', true); return; }
      const g = AV.partGlue(app, V.A, V.S); const iss = cutIssue(l, g);
      if (iss === 'hard') { AV.alert(l.id + ' cannot be cut: ' + g.why.get(l.id) + '. Only conduits that are not links of a flow divider can be cut.', 'Add Cut'); return; }
      const G = flowGraph(); const [u] = flowDir(l); const br = branch(G, u, pa);
      if (br.length >= sizeOf(pa)) { AV.alert('Cutting ' + l.id + ' would leave nothing downstream of it in ' + PID(pa) + ', so ' + PID(pa) + ' would disappear and the number of partitions would change.', 'Add Cut'); return; }
      const score = new Map(); const S = new Set(br);
      for (const id of br) { for (const e of G.out.get(id) || []) { const q = P.owner.get(e.n); if (!S.has(e.n) && q !== undefined && q !== pa) score.set(q, (score.get(q) || 0) + 2); }
        for (const e of G.inn.get(id) || []) { const q = P.owner.get(e.n); if (!S.has(e.n) && q !== undefined && q !== pa) score.set(q, (score.get(q) || 0) + 1); } }
      if (!score.size) { AV.alert('Cutting ' + l.id + ' would create a new partition: the ' + br.length + ' node(s) upstream of it border no other partition, so they cannot join a neighbouring one.\n\nThe number of partitions must stay ' + P.count + '. Choose a conduit whose upstream branch touches a neighbouring partition, use Move Cut, or partition again with another number.', 'Add Cut'); return; }
      const q = [...score].sort((a, b) => b[1] - a[1])[0][0];
      const bad = newCuts(G, br, q).filter(x => x !== l && g.hard.has(x.id));
      if (bad.length) { AV.alert('Cutting ' + l.id + ' is not possible: moving its upstream branch to ' + PID(q) + ' would also cut ' + bad.map(x => x.id).slice(0, 5).join(', ') + ' (' + g.why.get(bad[0].id) + '), which cannot be cut.', 'Add Cut'); return; }
      if (iss.length && !await AV.confirm('Cutting ' + l.id + ' is not recommended:\n\n• ' + iss.join('\n• ') + '\n\nCut it anyway?', 'Add Cut', 'Cut Anyway')) return;
      pushUndo(); for (const id of br) P.owner.set(id, q);
      changed(P, 'Cut added at ' + l.id + ': ' + br.length + ' node(s) moved from ' + PID(pa) + ' to ' + PID(q) + ' (still ' + P.count + ' partitions).');
    }
    // ---- Detect (2.10.0): measure this computer, set the best number of partitions; the sizes follow the core speeds
    const maxParts = () => Math.max(2, Math.floor(app.model.nodes.size / 500));
    async function detect() {
      if (V.detecting) return; V.detecting = 'Reading the processor…'; render(); const off = window.host.onCpuProgress ? window.host.onCpuProgress((t) => { V.detecting = t; render(); }) : null;
      try { const r = await window.host.cpuDetect(); app.prefs.cpuProfile = r; AV.cpuTopoNow = { sig: r.sig, model: r.model };
        const pl = AV.cpuPlan.plan(r, maxParts()); V.S.n = pl.n; app.prefs.partition = V.S; app.savePrefs();
        app.status('Detect: ' + r.model + ' – ' + AV.cpuPlan.describe(r) + '; ' + pl.n + ' partitions' + (V.P ? ' (Partition Again to apply)' : '') + '.');
      } catch (e) { console.error(e); AV.alert('Detect failed: ' + e.message, 'Model Partition'); }
      if (off) off(); V.detecting = null; render(); }
    // ---- undo of the manual changes (Move / Add Cut, Split, Merge)
    const pushUndo = () => { (V.undo = V.undo || []).push({ owner: new Map(V.P.owner), manual: V.P.manual || 0 }); if (V.undo.length > 30) V.undo.shift(); };
    function undo() { const u = V.undo && V.undo.pop(); if (!u) return; V.P.owner = u.owner; V.P.manual = u.manual; V.hl = null; V.sel = null; AV.partRecut(app, V.P, V.A); render(); redrawMap(); app.status('Undone (' + V.P.count + ' partitions).'); }
    // partitions sharing a cut point with p
    const neighbours = (P, p) => { const s = new Map(); for (const c of P.cuts) { const o = c.upPart === p ? c.downPart : c.downPart === p ? c.upPart : -1; if (o >= 0 && o !== p) s.set(o, (s.get(o) || 0) + 1); } return s; };
    const smallestPair = (P, without) => { let best = null; const st = P.stats; for (const c of P.cuts) { const a = c.upPart, b = c.downPart; if (a === b || a === without || b === without) continue; const sz = st[a].nodes + st[b].nodes; if (!best || sz < best.sz) best = { a: Math.min(a, b), b: Math.max(a, b), sz }; } return best; };
    const physCores = () => { const p = AV.cpuProfileOK(app); return p ? p.cores.length : C; };
    // ---- Split Partition: the selected partition only, with the settings of the main partition (editable here)
    function splitDlg(p0) {
      const P = V.P; if (p0 === null || p0 === undefined) return; const st = P.stats[p0]; const pr = AV.cpuProfileOK(app);
      const S2 = Object.assign({}, V.S); const tgt = pr ? (() => { const sl = AV.cpuPlan.slotsFor(pr, P.count).map(x => x.speed); const tw = AV.cpuPlan.twoClass(sl); return app.model.nodes.size / (P.count * (1 - tw.frac) + P.count * tw.frac * tw.r); })() : app.model.nodes.size / P.count;
      S2.n = Math.max(2, Math.round(st.nodes / tgt));
      const n2 = (k, w, a) => h('input', Object.assign({ type: 'number', value: S2[k], style: { width: (w || 50) + 'px' }, onchange: (e) => { S2[k] = +e.target.value; } }, a || {}));
      const keep = h('input', { type: 'checkbox', checked: S2.keepPonds !== false, onchange: (e) => { S2.keepPonds = e.target.checked; } });
      const prevBox = h('div'); let pending = null;
      const restore = () => { if (pending) { P.owner = pending.before; AV.partRecut(app, P, V.A); pending = null; V.hl = null; render(); redrawMap(); } };
      const optRow = (l, c) => [h('div', { class: 'al' }, l), h('div', { class: 'ac' }, c)];
      const body = h('div', { class: 'partp', style: { width: '560px' } },
        h('div', { class: 'hint' }, PID(p0) + ': ' + st.nodes.toLocaleString() + ' nodes, ' + st.cin + ' cut points in, ' + st.cout + ' out. The other partitions and their cut points do not change; ' + PID(p0) + ' keeps its number and the new partitions get the next numbers (P' + pad2(P.count) + ' …). Manual cut changes inside ' + PID(p0) + ' are replaced.'),
        h('div', { class: 'psec' }, h('span', { class: 'pn' }, '1'), 'Settings (as the main partition, for this split only)'),
        h('div', { class: 'padv' }, ...optRow('Split into', [n2('n', 50, { min: 2, max: 64 }), 'partitions', h('span', { class: 'hint' }, 'suggested ' + S2.n + ' (about ' + Math.round(st.nodes / S2.n).toLocaleString() + ' nodes each)')]),
          ...optRow('Flow counts', ['above', n2('revRel', 44, { step: 0.5, min: 0 }), '% of the peak, for ≥', n2('revMin', 48, { min: 0 }), 'min']),
          ...optRow('Oscillating flow', ['reverse ≥', n2('revPct', 44, { min: 0 }), '% of that time → not cut']),
          ...optRow('Flows backwards', ['reverse ≥', n2('revMax', 44, { min: 0 }), '% → may be cut']),
          ...optRow('Keep ponding areas whole', [keep, 'manholes of one area stay together'])),
        h('div', { style: { margin: '10px 0 2px', display: 'flex', gap: '8px' } }, h('button', { class: 'btn small primary', onclick: () => preview() }, 'Preview')), prevBox);
      let dlg = null;
      async function preview() {
        restore(); prevBox.innerHTML = ''; const n = Math.max(2, Math.round(S2.n));
        const only = new Set([...P.owner].filter(([, q]) => q === p0).map(([id]) => id));
        let Q; try { Q = AV.partCompute(app, V.A, Object.assign({}, S2, { n }), { only }); } catch (e) { AV.alert('Split failed: ' + e.message, 'Split Partition'); return; }
        if (Q.count < n) { failed(n, Q); return; }
        show(Q, n);
      }
      function failed(n, Q) {
        const nOnly = P.stats[p0].nodes; const B2 = Q.blockers || []; V.hl = new Set(B2.flatMap(b => b.nodes)); redrawMap(); if (V.hl.size) { const iv = setInterval(() => { if (!V.hl || !V.hl.size || !app.partView) { clearInterval(iv); return; } app.map.redrawOverlay(); }, 450); }
        const pl = (k, w) => k.toLocaleString() + ' ' + w + (k === 1 ? '' : 's');
        const why = B2.map(b => { const r = []; if (b.ponds) r.push(b.ponds === 1 ? 'a ponding area (' + pl(b.pondNodes, 'manhole') + ')' : pl(b.ponds, 'ponding area') + ' (largest ' + pl(b.pondNodes, 'manhole') + ')'); if (b.osc) r.push(pl(b.osc, 'pipe') + ' with oscillating flow'); if (b.hard) r.push(pl(b.hard, 'pump / weir / orifice link').replace('links', 'links'));
          return '• ' + b.size.toLocaleString() + ' nodes must stay together' + (r.length ? ' – ' + r.join(', ') : '') + ' – more than one part of about ' + Math.round(nOnly / n).toLocaleString() + ' nodes'; });
        const can = Q.count >= 2 ? Q.count : 0;
        AV.modal({ title: 'Split Partition – not possible as set', width: 560, body: h('div', { style: { lineHeight: 1.6 } },
          h('div', null, PID(p0) + ' cannot be split into ' + n + ' partitions with these settings.'),
          why.length ? h('div', null, ...why.map(t => h('div', null, t))) : h('div', null, 'The branches of ' + PID(p0) + ' do not divide into ' + n + ' parts of about the same size that each drain in one direction.'),
          why.length ? h('div', { class: 'hint' }, 'Highlighted on the map (blinking).') : null,
          h('div', { class: 'note', style: { marginTop: '6px' } }, can ? 'At most ' + can + ' partitions are possible with these settings.' : 'No split is possible with these settings.')),
          buttons: [{ label: 'Cancel', value: 'c' }, { label: 'Change Settings', value: 's' }].concat(can ? [{ label: 'Split into ' + can, primary: true, value: 'k' }] : []) }).done.then(r => {
            if (r === 'k') { S2.n = can; show(Q, can); return; }
            if (r !== 's') { V.hl = null; redrawMap(); if (dlg) dlg.close(); } });
      }
      function show(Q, n) {
        const before = new Map(P.owner); const base = P.count; let next = base;
        const map = new Map(); for (const [id, q] of Q.owner) { if (!map.has(q)) map.set(q, map.size === 0 ? p0 : next++); }
        for (const [id, q] of Q.owner) P.owner.set(id, map.get(q));
        AV.partRecut(app, P, V.A); pending = { before }; V.hl = null; render(); redrawMap();
        const st2 = P.stats; const newIds = [...new Set(map.values())]; const cutsNew = P.cuts.filter(c => newIds.includes(c.upPart) && newIds.includes(c.downPart));
        const badCuts = cutsNew.filter(c => P.why.has(c.link.id)); const asB = pr ? AV.cpuPlan.assign([...before.values()].reduce((a, q) => { a[q] = (a[q] || 0) + 1; return a; }, []), pr) : null; const asA = pr ? AV.cpuPlan.assign(st2.map(s => s.nodes), pr) : null;
        const over = P.count > physCores(); const pair = over ? smallestPair(P, -1) : null;
        prevBox.innerHTML = '';
        prevBox.appendChild(h('div', { class: 'psec' }, h('span', { class: 'pn' }, '2'), 'Preview (shown on the map)'));
        prevBox.appendChild(h('table', { class: 'ptbl' }, h('tr', null, ['Partition', 'Nodes', 'Cut points in', 'out'].map(x => h('th', null, x))), newIds.map(q => h('tr', null, h('td', null, h('span', { class: 'sw', style: { background: COL(q) } }), ' ' + PID(q)), h('td', { class: 'num' }, st2[q].nodes.toLocaleString()), h('td', { class: 'num' }, String(st2[q].cin)), h('td', { class: 'num' }, String(st2[q].cout))))));
        prevBox.appendChild(h('div', { class: 'hint', style: { marginTop: '4px' } }, cutsNew.length + ' new cut points' + (badCuts.length ? ' (' + badCuts.length + ' on pipes with oscillating flow)' : ', all one-way in the base run') + ' · total ' + P.count + ' partitions' + (asA ? ' · est. speed-up ×' + asB.speedup.toFixed(1) + ' → ×' + asA.speedup.toFixed(1) : '')));
        if (over && pair) prevBox.appendChild(h('div', { class: 'note', style: { color: 'var(--warn)', marginTop: '6px' } }, P.count + ' partitions on ' + physCores() + ' processor cores. Suggested: merge the two smallest adjacent partitions ' + PID(pair.a) + ' (' + st2[pair.a].nodes.toLocaleString() + ') + ' + PID(pair.b) + ' (' + st2[pair.b].nodes.toLocaleString() + ').'));
        dlg.setButtons([{ label: 'Cancel', onClick: () => { restore(); return true; } }].concat(over && pair ? [{ label: 'Apply', onClick: () => { apply(null); return true; } }, { label: 'Apply and Merge ' + PID(pair.a) + ' + ' + PID(pair.b), primary: true, onClick: () => { apply(pair); return true; } }] : [{ label: 'Apply', primary: true, onClick: () => { apply(null); return true; } }]));
      }
      function apply(pair) {
        const before = pending.before; pending = null; (V.undo = V.undo || []).push({ owner: before, manual: P.manual || 0 });
        let msg = PID(p0) + ' split into ' + (P.count - (Math.max(...before.values()) + 1) + 1) + ' partitions';
        if (pair) { for (const [id, q] of P.owner) if (q === pair.b) P.owner.set(id, pair.a); msg += '; ' + PID(pair.b) + ' merged into ' + PID(pair.a); }
        V.sel = null; changed(P, msg + ' (' + (Math.max(...P.owner.values()) + 1) + ' partitions).');
      }
      dlg = AV.modal({ title: 'Split Partition ' + PID(p0), width: 600, body, buttons: [{ label: 'Cancel', onClick: () => { restore(); return true; } }] });
      if (dlg.done) dlg.done.then(() => { if (pending) restore(); });
    }
    // ---- Merge Partitions: two adjacent partitions become one
    function mergeDlg() {
      const P = V.P; const pair = smallestPair(P, -1); const a = h('select'), b = h('select');
      for (let i = 0; i < P.count; i++) a.appendChild(h('option', { value: i }, PID(i) + ' (' + P.stats[i].nodes.toLocaleString() + ')'));
      const info = h('div', { class: 'note', style: { marginTop: '6px' } });
      const fillB = () => { const nb = neighbours(P, +a.value); b.innerHTML = ''; [...nb.keys()].sort((x, y) => P.stats[x].nodes - P.stats[y].nodes).forEach(q => b.appendChild(h('option', { value: q }, PID(q) + ' (' + P.stats[q].nodes.toLocaleString() + ')'))); upd(); };
      const upd = () => { const x = +a.value, y = +b.value; if (!b.options.length) { info.textContent = PID(x) + ' shares no cut point with another partition.'; return; } const nb = neighbours(P, x); info.textContent = PID(x) + ' + ' + PID(y) + ' → ' + (P.stats[x].nodes + P.stats[y].nodes).toLocaleString() + ' nodes · ' + (P.count - 1) + ' partitions · ' + (nb.get(y) || 0) + ' cut points removed. The partitions after ' + PID(Math.max(x, y)) + ' move up one number.'; };
      a.onchange = fillB; b.onchange = upd; a.value = pair ? pair.a : (V.sel !== null ? V.sel : 0); fillB(); if (pair && +a.value === pair.a) { b.value = pair.b; upd(); }
      AV.modal({ title: 'Merge Partitions', width: 520, body: h('div', { class: 'partp', style: { lineHeight: 1.8 } }, 'Merge ', a, ' with the adjacent ', b, h('div', { class: 'hint' }, 'Only partitions that share a cut point can be merged. Suggested: the two smallest adjacent partitions.'), info),
        buttons: [{ label: 'Cancel', value: null }, { label: 'Merge', primary: true, onClick: () => { if (!b.options.length) return false; const x = +a.value, y = +b.value; const keep = Math.min(x, y), go = Math.max(x, y);
          pushUndo(); for (const [id, q] of P.owner) if (q === go) P.owner.set(id, keep); V.sel = null; changed(P, PID(go) + ' merged into ' + PID(keep) + '.'); return true; } }] });
    }
    // ---- generate the sub-models and the relationship file
    async function generate(folder, pattern, withBnd, demPath) {
      const P = V.P; if (!P || V.errors) return; V.S.folder = folder; V.S.folderBy = Object.assign({}, V.S.folderBy, { [app.filePath]: folder }); V.S.pattern = pattern; V.S.boundary = withBnd; V.S.surface = !!demPath; if (demPath) V.S.dem = demPath; app.prefs.partition = V.S; app.savePrefs();
      busy = true; render(); app.status('Writing sub-models…'); const bz = AV.busy.start('Writing the sub-models');
      try {
        const bnd = withBnd ? await AV.partBoundary(app, P) : null;
        if (withBnd && !bnd) AV.toast('Base results not usable for boundaries (none loaded or other flow units): sub-models get fixed outfalls without inflows.', true, 7000);
        await window.host.mkdir(folder);
        const name = AV.basename(app.filePath).replace(/\.inp$/i, ''); const mdir = AV.dirname(app.filePath); let surfFiles = null, surfInfo = null;
        if (demPath) { try { const F2 = AV.f2d(app.model); const mask = F2.BOUNDARY ? absPath(mdir, F2.BOUNDARY.replace(/^"|"$/g, '')) : '';
          const S2 = await AV.partSurface(app, P, V.A, demPath, mask, (t) => app.status(t));
          let size = parseFloat(F2.CELL_SIZE), rough = parseFloat(F2.ROUGHNESS);
          if (mask && (!(size > 0) || !(rough > 0))) { try { const L = await AV.loadDataFile(app, mask); const pr = (L.features.find(x => x.type === 'polygon') || {}).props || {}; const g = (ks) => { for (const k of Object.keys(pr)) if (ks.includes(k.toLowerCase())) return parseFloat(pr[k]); return NaN; }; if (!(size > 0)) size = g(['length', 'size', 'cellsize']); if (!(rough > 0)) rough = g(['roughness', 'n', 'manning']); } catch (e) { } }
          if (!(size > 0)) size = +(S2.cellSize * 5).toPrecision(3); if (!(rough > 0)) rough = 0.03;
          surfFiles = await AV.partWriteSurface(app, S2, folder, name, size, rough, app.crsWKT); surfInfo = { cellSize: S2.cellSize, size, rough, mask: !!mask };
        } catch (e) { console.error(e); AV.toast('Partition areas not made: ' + e.message, true, 8000); } }
        const fixPath = (v) => { const a = absPath(mdir, String(v).replace(/^"|"$/g, '')); return relPath(folder, a); };
        const built = AV.partBuild(app, P, { pattern, bnd, fixPath, boundaryFile: surfFiles ? (p) => surfFiles[p] : null });
        for (const f of built.files) { await window.host.writeText(AV.joinPath(folder, f.file), f.text, 'utf8'); if (app.crsWKT) await window.host.writeText(AV.joinPath(folder, f.file.replace(/\.inp$/i, '.prj')), app.crsWKT); }
        const def = AV.partDefinition(app, P, V.A, Object.assign({}, V.S, { folderRel: relPath(AV.dirname(app.filePath), folder) }), built, C);
        def.standaloneBoundaries = !!bnd; def.surface = surfFiles ? { dem: relPath(mdir, demPath), files: surfFiles } : null;
        await window.host.writeText(AV.joinPath(folder, built.name + '.partition.json'), JSON.stringify(def), 'utf8');
        await window.host.writeText(defPath(app), JSON.stringify(def), 'utf8');
        busy = false; render();
        AV.modal({ title: 'Sub-models Written', width: 620, body: h('div', { style: { lineHeight: 1.55 } },
          h('div', null, built.files.length + ' sub-models and the relationship file were written to ', h('b', null, folder), '.'),
          h('div', { class: 'ptwrap', style: { maxHeight: '260px', marginTop: '6px' } }, h('table', { class: 'ptbl' }, h('tr', null, ['File', 'Nodes', 'Links', 'Subc.', 'In', 'Out'].map(x => h('th', null, x))),
            built.files.map(f => h('tr', null, h('td', null, f.file), h('td', { class: 'num' }, String(f.nodes)), h('td', { class: 'num' }, String(f.links)), h('td', { class: 'num' }, String(f.subs)), h('td', { class: 'num' }, String(f.cin)), h('td', { class: 'num' }, String(f.cout))))),
          ),
          h('div', { class: 'hint', style: { marginTop: '6px' } }, built.name + '.partition.json: ' + built.couplings.length + ' couplings, ' + def.levels.length + ' levels. A copy is kept next to the model for Regenerate.'),
          surfInfo ? h('div', { class: 'hint' }, 'Partition areas: ' + built.name + '_partitions.shp and one 2D boundary per sub-model (DEM cell ' + +surfInfo.cellSize.toPrecision(3) + (surfInfo.mask ? ', inside the 2D boundary' : '') + '; mesh cell size ' + surfInfo.size + ', roughness ' + surfInfo.rough + ').') : null,
          built.warn.length ? h('div', { class: 'note', style: { marginTop: '6px', whiteSpace: 'pre-wrap', maxHeight: '140px', overflow: 'auto' } }, built.warn.join('\n')) : null),
          buttons: [{ label: 'Open Folder', onClick: () => { window.host.showItem(AV.joinPath(folder, built.files[0].file)); return false; } }, { label: 'OK', primary: true }] });
        app.status('Sub-models written: ' + built.files.length + ' files in ' + folder);
      } catch (e) { console.error(e); busy = false; render(); AV.alert('Could not write the sub-models: ' + e.message); }
      finally { bz.done(); }
    }
    const relPath = (base, p) => { const sep = /[\\/]/; const A = base.replace(/[\\/]+$/, '').split(sep), Bp = p.split(sep); let k = 0; while (k < A.length && k < Bp.length && A[k].toLowerCase() === Bp[k].toLowerCase()) k++;
      if (k <= 1) return p; const up = A.length - k; return (up ? '../'.repeat(up) : './') + Bp.slice(k).join('/'); };
    const absPath = (base, p) => !p || p === '.' ? base : /^([a-zA-Z]:|[\\/])/.test(p) ? p : AV.joinPath(base, p.replace(/^\.[\\/]/, '').replace(/\//g, base.includes('\\') ? '\\' : '/'));

    // ---- regenerate from the saved definition
    function regenView(body) {
      body.appendChild(h('div', { class: 'hint' }, 'Applies the saved partition definition (' + AV.basename(defPath(app)) + ') to the current master model and writes the sub-models that changed.'));
      const st = h('div', { style: { marginTop: '8px' } }); body.appendChild(st);
      body.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, B('Compare with Sub-models', () => compare(st), true, busy)));
      if (V.regen) showRegen(st);
    }
    async function compare(st) {
      const p = defPath(app); let def = null;
      try { if (await window.host.exists(p)) def = JSON.parse(await window.host.readText(p)); } catch (e) { def = null; }
      if (!def || def.format !== 'avaris-partition') { st.innerHTML = ''; st.appendChild(h('div', { class: 'note' }, 'No partition definition next to this model. Use the Partition tab first.')); return; }
      busy = true; st.innerHTML = ''; st.appendChild(h('div', { class: 'hint' }, 'Comparing…'));
      try {
        const m = app.model; const dn = def.settings.doNotCut, osc = dn.oscillatingFlow || dn.reverseFlow || {}; const S = Object.assign({}, V.S, { revMin: osc.minFlowMin, revPct: osc.minReversePct, revMax: osc.maxReversePct || 95, revRel: osc.flowAbovePctOfPeak !== undefined ? osc.flowAbovePctOfPeak : 0, keepPonds: dn.keepPondingAreas !== false, pattern: def.pattern || V.S.pattern });
        const A = await AV.partAnalyse(app, S);
        // assignment: known nodes keep their partition; new nodes follow the flow (downstream first, then upstream, then nearest)
        const owner = new Map(); const added = [], deleted = [], decide = [];
        for (const id of m.nodes.keys()) if (def.assignment[id] !== undefined) owner.set(id, def.assignment[id]);
        for (const id of Object.keys(def.assignment)) if (!m.nodes.has(id)) deleted.push(id);
        const pending = [...m.nodes.keys()].filter(id => !owner.has(id)); added.push(...pending);
        for (let pass = 0; pass < 50 && pending.length; pass++) { let ch = false;
          for (let i = pending.length - 1; i >= 0; i--) { const id = pending[i]; const nb = { down: new Set(), up: new Set() };
            for (const l of m.links.values()) { if (l.from === id && owner.has(l.to)) nb.down.add(owner.get(l.to)); if (l.to === id && owner.has(l.from)) nb.up.add(owner.get(l.from)); }
            const c = nb.down.size ? nb.down : nb.up; if (!c.size) continue; owner.set(id, [...c][0]); if (c.size > 1 || (nb.down.size && nb.up.size && ![...nb.up].some(x => nb.down.has(x)))) decide.push(id); pending.splice(i, 1); ch = true; }
          if (!ch) break; }
        for (const id of pending) { const n = m.nodes.get(id); let bd = Infinity, bp = 0; for (const [o, q] of owner) { const x = m.nodes.get(o); const d = (x.x - n.x) ** 2 + (x.y - n.y) ** 2; if (d < bd) { bd = d; bp = q; } } owner.set(id, bp); }
        const P = { owner, why: new Map(), pondOf: new Map(), manual: def.manualChanges || 0 };
        // links that must not be cut, with the latest results
        const g = AV.partGlue(app, A, S); P.why = g.why; P.hard = g.hard; P.pondOf = g.pondOf; AV.partRecut(app, P, A);
        const sig = AV.partSignatures(m); const old = def.signatures || { N: {}, L: {}, S: {} };
        const changes = []; const pOfL = (l) => P.owner.get(l.from);
        for (const [k, coll, lab] of [['N', m.nodes, 'Node'], ['L', m.links, 'Link'], ['S', m.subcatchments, 'Subcatchment']]) {
          for (const [id, o] of coll) { if (old[k][id] === undefined) { if (k !== 'N') changes.push({ id, what: lab + ' added', p: k === 'L' ? pOfL(o) : P.subOwner.get(id) }); } else if (old[k][id] !== sig[k][id]) changes.push({ id, what: lab + ' changed', p: k === 'N' ? P.owner.get(id) : k === 'L' ? pOfL(o) : P.subOwner.get(id) }); }
          for (const id of Object.keys(old[k])) if (!coll.has(id)) changes.push({ id, what: lab + ' deleted', p: k === 'N' ? def.assignment[id] : null }); }
        for (const id of added) changes.push({ id, what: 'Node added', p: owner.get(id), decide: decide.includes(id) });
        if (old.shared && old.shared !== sig.shared) changes.push({ id: 'Options / curves / time series / controls', what: 'shared data changed', p: null });
        const folder = absPath(AV.dirname(app.filePath), def.folder);
        const bnd = def.standaloneBoundaries ? await AV.partBoundary(app, P) : null;
        const mdir = AV.dirname(app.filePath); const fixPath = (v) => relPath(folder, absPath(mdir, String(v).replace(/^"|"$/g, '')));
        const sf = def.surface && def.surface.files; const built = AV.partBuild(app, P, { pattern: S.pattern, bnd, fixPath, boundaryFile: sf ? (p) => sf[p] || null : null });
        const files = []; for (const f of built.files) { const fp = AV.joinPath(folder, f.file); let cur = null; try { if (await window.host.exists(fp)) cur = await window.host.readText(fp); } catch (e) { cur = null; }
          const was = (def.partitions || []).find(x => x.inp === f.file); const edited = cur !== null && was && was.hash && AV.fnvHash(cur) !== was.hash;
          files.push({ f, fp, status: cur === null ? 'new' : cur === f.text ? 'same' : 'changed', edited }); }
        for (const x of def.partitions || []) if (!built.files.some(f => f.file === x.inp)) files.push({ f: { file: x.inp }, status: 'not used any more' });
        const chk = AV.partChecks(app, P, A, S, C);
        V.regen = { def, P, A, S, built, files, changes, folder, chk, bnd }; V.P = P; V.A = A; render(); redrawMap();
      } catch (e) { console.error(e); st.innerHTML = ''; st.appendChild(h('div', { class: 'note', style: { color: 'var(--danger)' } }, 'Compare failed: ' + e.message)); }
      busy = false;
    }
    function showRegen(st) {
      const G = V.regen; st.innerHTML = ''; const nCh = G.files.filter(x => x.status !== 'same').length;
      st.appendChild(h('div', { class: 'pchips' }, [[G.changes.filter(c => /changed/.test(c.what)).length, 'changed'], [G.changes.filter(c => /added/.test(c.what)).length, 'added'], [G.changes.filter(c => /deleted/.test(c.what)).length, 'deleted'], [nCh, 'sub-model files to write']].map(([v, l]) => h('div', { class: 'pchip' }, h('b', null, String(v)), h('span', null, l)))));
      const rows = G.changes.slice(0, 300).map(c => h('tr', { class: c.decide ? 'wn' : '' }, h('td', null, c.id), h('td', null, c.what + (c.decide ? ' – joins two partitions, check' : '')), h('td', null, c.p === null || c.p === undefined ? 'all' : PID(c.p))));
      st.appendChild(h('div', { class: 'psec2' }, 'Changes in the master model since ' + String(G.def.created || '').slice(0, 16).replace('T', ' ')));
      st.appendChild(h('div', { class: 'ptwrap', style: { maxHeight: '200px' } }, G.changes.length ? h('table', { class: 'ptbl' }, h('tr', null, h('th', null, 'Object'), h('th', null, 'Change'), h('th', null, 'Partition')), rows) : h('div', { class: 'hint', style: { padding: '6px' } }, 'No object changed.')));
      st.appendChild(h('div', { class: 'psec2' }, 'Sub-model files'));
      st.appendChild(h('div', { class: 'ptwrap', style: { maxHeight: '200px' } }, h('table', { class: 'ptbl' }, h('tr', null, h('th', null, 'File'), h('th', null, 'Status')),
        G.files.map(x => h('tr', { class: x.edited ? 'er' : '' }, h('td', null, x.f.file), h('td', null, x.status + (x.edited ? ' – edited directly since it was generated: will be overwritten' : '')))))));
      st.appendChild(h('div', { class: 'pchecks', style: { marginTop: '6px' } }, G.chk.map(c => h('div', { class: c.t }, (c.t === 'ok' ? '✓ ' : c.t === 'er' ? '✗ ' : '⚠ ') + c.s))));
      const err = G.chk.some(c => c.t === 'er');
      st.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, h('button', { class: 'btn small primary', disabled: !nCh || err, onclick: async () => {
        if (G.files.some(x => x.edited) && !await AV.confirm('Some sub-models were edited directly since they were generated. Overwrite them with the master model?', 'Regenerate', 'Overwrite')) return;
        try { await window.host.mkdir(G.folder); let n = 0; for (const x of G.files) if (x.status === 'changed' || x.status === 'new') { await window.host.writeText(x.fp, x.f.text, 'utf8'); if (app.crsWKT) await window.host.writeText(x.fp.replace(/\.inp$/i, '.prj'), app.crsWKT); n++; }
          const def = AV.partDefinition(app, G.P, G.A, Object.assign({}, G.S, { folderRel: G.def.folder }), G.built, C); def.standaloneBoundaries = !!G.bnd; def.surface = G.def.surface || null;
          await window.host.writeText(AV.joinPath(G.folder, G.built.name + '.partition.json'), JSON.stringify(def), 'utf8'); await window.host.writeText(defPath(app), JSON.stringify(def), 'utf8');
          V.regen = null; render(); AV.toast(n + ' sub-model(s) rewritten; the partition definition was updated.');
          if (G.built.warn.length) AV.alert(G.built.warn.join('\n'), 'Regenerate');
        } catch (e) { AV.alert('Could not write the sub-models: ' + e.message); } } }, 'Regenerate ' + nCh + ' Sub-model' + (nCh === 1 ? '' : 's')),
        err ? h('span', { class: 'hint', style: { color: 'var(--danger)' } }, 'A new cut is not allowed: partition again in the Partition tab.') : null));
    }
    V.render = render; render(); redrawMap();
  };
})(window.AV);
