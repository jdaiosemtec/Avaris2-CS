// Model Partition panel (Tools ▸ Partition Model / Regenerate Sub-models). Algorithm and file building: partition.js.
'use strict';
(function (AV) {
  const h = AV.h;
  const pad2 = (i) => String(i + 1).padStart(2, '0'); const PID = (i) => 'P' + pad2(i);
  const COL = (i) => AV.partColor(i);
  const defPath = (app) => app.filePath ? app.filePath.replace(/\.inp$/i, '.partition.json') : null;
  const prefsOf = (app) => Object.assign({ n: 12, revMin: 60, revPct: 5, revMax: 95, revRel: 2, keepPonds: true, pondMin: 30, pondDist: 0, pondDepth: 0, tol: 25, ctrl: 60, pattern: '{model}_P{nn}.inp', folder: '', boundary: true }, app.prefs.partition || {});
  let cores = null;
  const getCores = async () => { if (cores) return cores; try { const c = await window.host.cpuInfo(); cores = c.physical || c.logical || 4; } catch (e) { cores = 4; } return cores; };

  AV.openPartition = async function (app, tab) {
    if (!AV.hasHPS(app)) { AV.needHPS(app, 'Model Partition'); return; }
    if (!app.model || !app.model.nodes.size) { AV.toast('Open a model first.', true); return; }
    if (!app.filePath) { AV.toast('Save the model first: the sub-models are written next to it.', true); return; }
    const C = await getCores();
    const V = app.partView || (app.partView = { P: null, A: null, sel: null, showCut: true, showNo: true, tab: 'part', S: prefsOf(app) });
    if (tab) V.tab = tab;
    const P0 = AV.floatPanel({ id: 'partition', title: 'Model Partition', minimize: true, w: 530, h: Math.min(780, window.innerHeight - 150), body: h('div', { class: 'flp' }),
      onClose: () => { app.partView = null; endPick(); app.theme.invalidate(); app.map.redraw(); } });
    const root = P0.el ? AV.$('.flp', P0.el) : AV.$('.flp');
    const redrawMap = () => { app.theme.invalidate(); app.map.redraw(); };
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
      const R = app.results; const mx = Math.floor(C * 1.5);
      body.appendChild(sec(1, 'Settings'));
      body.appendChild(h('div', { class: 'form' },
        h('label', null, 'Number of partitions'), h('span', null, num('n', 64, { min: 2, max: 400 }), h('span', { class: 'hint' }, '  this computer: ' + C + ' cores → at most ' + mx + ' in parallel')),
        h('label', null, 'Base results'), h('span', { class: R ? '' : 'hint' }, R ? AV.basename(R.meta.file || '') + ' (' + R.meta.nPeriods + ' steps)' : 'none – run a simulation or open results (Database) first')));
      const unit = app.model.isSI ? 'm' : 'ft'; const opt = (label, ctl, hint) => [h('div', { class: 'al' }, label), h('div', { class: 'ac' }, ctl), hint ? h('div', { class: 'ah' }, hint) : null];
      const keep = h('input', { type: 'checkbox', checked: V.S.keepPonds !== false, onchange: (e) => { V.S.keepPonds = e.target.checked; app.prefs.partition = V.S; app.savePrefs(); } });
      body.appendChild(h('details', { open: !!V.adv, ontoggle: (e) => { V.adv = e.target.open; } }, h('summary', null, 'Advanced'), h('div', { class: 'padv' },
        opt('Oscillating flow (not cut)', ['flow ≥', num('revMin', 46), 'min, reverse', num('revPct', 40), '–', num('revMax', 40), '%'], 'Share of the time with flow in reverse. Above the upper value the pipe simply flows backwards: it may be cut.'),
        opt('Flow counts above', [num('revRel', 40, { step: 0.5 }), '% of the pipe\'s peak flow'], 'Smaller flows (noise around zero) count neither as flow nor as reverse flow.'),
        opt('Keep ponding areas whole', [keep, 'manholes of one area stay together']),
        opt('2D ponding depth', ['cells ≥', num('pondDepth', 46, { step: 0.05 }), unit], '0 = flood depth of the 2D options, else ' + (app.model.isSI ? '0.3 m' : '1 ft') + '.'),
        opt('1D ponding (no 2D results)', ['flooded ≥', num('pondMin', 46), 'min, within', num('pondDist', 52)], 'Flooded manholes closer than this distance (map units) to each other form one ponding area. 0 = ' + (app.model.isSI ? '50 m' : '150 ft') + '.'),
        opt('Size tolerance', ['±', num('tol', 46), '% of the average size']),
        h('div', { class: 'ah', style: { gridColumn: '1 / -1', marginTop: '4px' } }, 'Pumps, orifices, weirs, outlets and the links of flow dividers are never cut.'))));
      const status = h('span', { class: 'hint' });
      body.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '10px 0 2px' } }, B(V.P ? 'Partition Again' : 'Partition', () => go(status), true, busy), V.P && V.sel !== null ? B('Show All', () => { V.sel = null; render(); redrawMap(); }) : null, status));
      if (!V.P) { body.appendChild(h('div', { class: 'note', style: { marginTop: '8px' } }, 'Every partition drains in one direction (flow directions of the base results); pipes with oscillating flow, pumps, weirs … and ponding areas are not cut; the cut points are placed so that the partitions have about the same size with as few cuts as possible.')); return; }
      const P = V.P, st = P.stats; const mxN = Math.max(...st.map(s => s.nodes)), mnN = Math.min(...st.map(s => s.nodes));
      body.appendChild(sec(2, 'Result'));
      body.appendChild(h('div', { class: 'pchips' }, [[P.count, 'partitions'], [P.cuts.length, 'cut points'], [mnN + '–' + mxN, 'nodes per partition'], [[...P.why.values()].filter(v => v.startsWith('oscillating')).length, 'oscillating pipes'], [P.hard ? P.hard.size : 0, 'never cut (pumps …)'], [V.A.ponds.length, 'ponding areas']].map(([v, l]) => h('div', { class: 'pchip' }, h('b', null, String(v)), h('span', null, l)))));
      const tb = h('table', { class: 'ptbl' }, h('tr', null, ['', 'Partition', 'Nodes', '', 'Links', 'Subc.', 'In', 'Out', 'Outfalls'].map(x => h('th', null, x))),
        st.map(s => h('tr', { class: 'p' + (V.sel === s.i ? ' sel' : ''), onclick: () => { V.sel = V.sel === s.i ? null : s.i; render(); redrawMap(); }, ondblclick: () => zoomTo(s.i) },
          h('td', null, h('span', { class: 'sw', style: { background: COL(s.i) } })), h('td', null, PID(s.i)), h('td', { class: 'num' }, String(s.nodes)),
          h('td', null, h('span', { class: 'pbar' }, h('i', { style: { width: (100 * s.nodes / mxN) + '%', background: COL(s.i) } }))), h('td', { class: 'num' }, String(s.links)), h('td', { class: 'num' }, String(s.subs)),
          h('td', { class: 'num' }, String(s.cin)), h('td', { class: 'num' }, String(s.cout)), h('td', { class: 'ellip', title: s.outfalls.join(', ') }, s.outfalls.length ? s.outfalls.slice(0, 3).join(', ') + (s.outfalls.length > 3 ? ' …' : '') : '→ coupled'))));
      body.appendChild(h('div', { class: 'ptwrap' }, tb));
      body.appendChild(h('div', { class: 'hint' }, 'In / Out = couplings from upstream / to downstream partitions. Click a row to highlight, double-click to zoom.'));
      body.appendChild(sec(3, 'Adjust'));
      body.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        B(V.picking === 'remove' ? 'Finish' : 'Move Cut…', () => V.picking === 'remove' ? endPick() : startPick('remove'), V.picking === 'remove'),
        B(V.picking === 'add' ? 'Finish' : 'Add Cut…', () => V.picking === 'add' ? endPick() : startPick('add'), V.picking === 'add'),
        P.manual ? h('span', { class: 'hint' }, P.manual + ' manual change(s)') : null));
      body.appendChild(h('div', { class: 'hint', style: { marginTop: '4px' } }, 'The number of partitions never changes here – only the boundary between two adjacent partitions moves. Move Cut: click a cut point (⊗); the feasible conduits nearby blink – click one as the new cut point. Add Cut: click a conduit; its upstream branch joins the neighbouring partition (refused if that would create a new partition; warning for oscillating flow and ponding areas; pumps, weirs … cannot be cut).'));
      body.appendChild(sec(4, 'Checks'));
      const chk = AV.partChecks(app, P, V.A, V.S, C); V.errors = chk.filter(c => c.t === 'er').length;
      body.appendChild(h('div', { class: 'pchecks' }, chk.map(c => h('div', { class: c.t }, (c.t === 'ok' ? '✓ ' : c.t === 'er' ? '✗ ' : '⚠ ') + c.s))));
      body.appendChild(sec(5, 'Generate sub-models'));
      const dir = AV.dirname(app.filePath); const folder = h('input', { type: 'text', value: V.S.folder || AV.joinPath(dir, 'Partition'), style: { width: '100%' } });
      const patt = h('input', { type: 'text', value: V.S.pattern, style: { width: '100%' } });
      const bnd = h('input', { type: 'checkbox', checked: V.S.boundary !== false });
      const F2 = AV.f2d(app.model); const demAbs = F2.DEM ? absPath(AV.dirname(app.filePath), F2.DEM.replace(/^"|"$/g, '')) : '';
      const dem = h('input', { type: 'text', value: V.S.dem || demAbs, placeholder: 'DEM (GeoTIFF / ASCII grid) – optional', style: { width: '100%' } });
      const surf = h('input', { type: 'checkbox', checked: V.S.surface !== false });
      body.appendChild(h('div', { class: 'form' }, h('label', null, 'Folder'), h('span', { style: { display: 'flex', gap: '4px' } }, folder,
          B('…', async () => { let d = folder.value; while (d && !await window.host.exists(d)) { const up = AV.dirname(d); if (!up || up === d) break; d = up; } const p = await window.host.openDialog({ folder: true, defaultPath: d || folder.value, title: 'Folder for the sub-models' }); if (p) folder.value = p; })),
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
        V.P = AV.partCompute(app, V.A, V.S); V.sel = null; V.time = ((performance.now() - t0) / 1000).toFixed(1);
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
        if (k) { const old = V.move.c.link.id; for (const id of k.nodes) P.owner.set(id, k.to); stopMove();
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
      for (const id of br) P.owner.set(id, q);
      changed(P, 'Cut added at ' + l.id + ': ' + br.length + ' node(s) moved from ' + PID(pa) + ' to ' + PID(q) + ' (still ' + P.count + ' partitions).');
    }
    // ---- generate the sub-models and the relationship file
    async function generate(folder, pattern, withBnd, demPath) {
      const P = V.P; if (!P || V.errors) return; V.S.folder = folder; V.S.pattern = pattern; V.S.boundary = withBnd; V.S.surface = !!demPath; if (demPath) V.S.dem = demPath; app.prefs.partition = V.S; app.savePrefs();
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
