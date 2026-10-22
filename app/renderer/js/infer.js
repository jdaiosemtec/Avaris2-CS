// Data inference and cleaning (Tools ▸ Model Data ▸ Infer & Clean).
//   Inference fills missing data from the network itself, the way an engineer would:
//     conduit length   from the drawn geometry
//     conduit size     from the upstream conduits (largest), else the downstream conduits (smallest), repeated along chains
//     roughness        most common value of the connected conduits, else a default
//     node invert      interpolated between the nearest known inverts upstream and downstream along the pipes (by
//                      length); with one side only, carried on at the minimum slope
//     manhole depth    ground from the DEM minus the invert (only where the depth is missing)
//   Checks (listed, not changed): adverse slopes, duplicate conduits, orphan nodes, pipe crown above the rim,
//   parts of the network without an outfall, subcatchments without a valid outlet, missing data that could not be inferred.
//   Apply writes the ticked inferences in one undoable step; the changed objects can be tagged.
'use strict';
(function (AV) {
  const h = AV.h;
  const SKIP_SHAPES = new Set(['DUMMY', 'IRREGULAR', 'STREET', 'CUSTOM']);

  class Inference {
    constructor(app) { this.app = app; const si = app.model.isSI; this.S = Object.assign({ zeroMissing: true, below: -999, slope: 0.5, n: 0.013, tol: si ? 0.003 : 0.01, dem: '', tag: '', len: true, dia: true, rough: true, inv: true, depth: false }, app.prefs.infer || {}); this.on = { len: true, dia: true, rough: true, inv: true, depth: true }; }
    open() {
      const app = this.app;
      if (!this.el) { this.el = h('div', { class: 'csoview' }); app.addView('infer', 'Infer & Clean', this.el, { onClose: () => { this.el = null; } }); } else app.activateView('infer');
      if (!this.S.dem) { const F2 = AV.f2d ? AV.f2d(app.model) : {}; if (F2.DEM && app.filePath) { const d = String(F2.DEM).replace(/^"|"$/g, ''); this.S.dem = /^([a-zA-Z]:|[\\/])/.test(d) ? d : AV.joinPath(AV.dirname(app.filePath), d); } }
      this.render();
    }
    missing(v) { const x = parseFloat(v); return !isFinite(x) || x <= this.S.below || (this.S.zeroMissing && x === 0); }
    async analyse() {
      const app = this.app, m = app.model, S = this.S; app.prefs.infer = S; app.savePrefs && app.savePrefs();
      const busy = AV.busy.start('Analysing the model data'); const props = []; const probs = [];
      try {
        const elevOff = /ELEVATION/i.test(m.options.LINK_OFFSETS || '');
        const conduits = [...m.links.values()].filter(l => l.type === 'CONDUIT');
        const geomLen = (l) => { const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) return 0; const pts = [[a.x, a.y]].concat(l.verts || []).concat([[b.x, b.y]]); let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
        const P = (o, key, old, nw, rule, how) => props.push({ o, key, old, nw, rule, how });
        // ---- length
        const len = new Map(conduits.map(l => [l.id, +l.p.length || 0]));
        for (const l of conduits) if (!(+l.p.length > 0)) { const g = geomLen(l); if (g > 0) { len.set(l.id, g); P(l, 'length', l.p.length, +g.toFixed(3), 'len', 'length of the drawn conduit'); } }
        // ---- size (geom1), repeated so that chains of missing sizes fill from their known ends
        const inC = new Map(), outC = new Map(); for (const l of conduits) { (inC.get(l.to) || inC.set(l.to, []).get(l.to)).push(l); (outC.get(l.from) || outC.set(l.from, []).get(l.from)).push(l); }
        const dia = new Map(conduits.map(l => [l.id, parseFloat(l.p.g1) || 0])); const miss = conduits.filter(l => !(dia.get(l.id) > 0) && !SKIP_SHAPES.has(String(l.p.shape || '').toUpperCase()));
        for (let pass = 0; pass < 50 && miss.length; pass++) { let ch = false;
          for (let i = miss.length - 1; i >= 0; i--) { const l = miss[i];
            const up = (inC.get(l.from) || []).map(x => dia.get(x.id)).filter(v => v > 0), dn = (outC.get(l.to) || []).map(x => dia.get(x.id)).filter(v => v > 0);
            let v = null, how = ''; if (up.length) { v = Math.max(...up); how = 'largest upstream conduit'; } else if (dn.length) { v = Math.min(...dn); how = 'smallest downstream conduit'; }
            if (v) { dia.set(l.id, v); P(l, 'g1', l.p.g1, v, 'dia', how + (pass ? ' (along a chain)' : '')); miss.splice(i, 1); ch = true; } }
          if (!ch) break; }
        for (const l of miss) probs.push({ o: l, kind: 'Missing size', text: 'size could not be inferred (no connected conduit with a size)' });
        // ---- roughness
        for (const l of conduits) if (!(+l.p.rough > 0)) { const nb = [...(inC.get(l.from) || []), ...(outC.get(l.to) || []), ...(outC.get(l.from) || []), ...(inC.get(l.to) || [])].filter(x => x !== l && +x.p.rough > 0).map(x => +x.p.rough);
          const cnt = new Map(); for (const v of nb) cnt.set(v, (cnt.get(v) || 0) + 1); const best = [...cnt].sort((a, b) => b[1] - a[1])[0];
          P(l, 'rough', l.p.rough, best ? best[0] : S.n, 'rough', best ? 'most common value of the connected conduits' : 'default'); }
        // ---- ground level from the DEM (optional): used for inverts (ground − depth) and for missing manhole depths
        let groundAt = null;
        if (S.dem) {
          let R = null; try { R = await AV.readRasterFull(S.dem); } catch (e) { probs.push({ o: null, kind: 'DEM', text: 'DEM not read: ' + e.message }); }
          if (R) { const [c0, c1, c2] = R.corners; const px = (c1[0] - c0[0]) / R.w, py = (c0[1] - c2[1]) / R.h;
            groundAt = (n) => { const i = Math.floor((n.x - c0[0]) / px), j = Math.floor((c0[1] - n.y) / py); if (i < 0 || j < 0 || i >= R.w || j >= R.h) return null; const v = R.data[j * R.w + i]; return !isFinite(v) || Math.abs(v) > 1e30 || (R.nodata !== null && Math.abs(v - R.nodata) < 1e-6) ? null : v; }; }
        }
        // ---- node inverts: interpolation along the pipes between known inverts
        const nodes = [...m.nodes.values()]; const known = new Map(); for (const n of nodes) if (!this.missing(n.p.elev)) known.set(n.id, +n.p.elev);
        const adjD = new Map(), adjU = new Map(); const L = (l) => l.type === 'CONDUIT' ? (len.get(l.id) || geomLen(l)) : geomLen(l);
        for (const l of m.links.values()) { const w = Math.max(L(l), 1e-6); (adjD.get(l.from) || adjD.set(l.from, []).get(l.from)).push([l.to, w]); (adjU.get(l.to) || adjU.set(l.to, []).get(l.to)).push([l.from, w]); }
        // nearest known invert upstream / downstream of every node: multi-source Dijkstra (binary heap) from all known
        // nodes, along the flow direction (upstream source) and against it (downstream source)
        const msd = (adj) => { const best = new Map(); const hp = [];
          const push = (d, id, src) => { hp.push([d, id, src]); let i = hp.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hp[p][0] <= hp[i][0]) break; [hp[p], hp[i]] = [hp[i], hp[p]]; i = p; } };
          const pop = () => { const top = hp[0], last = hp.pop(); if (hp.length) { hp[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let k = i; if (l < hp.length && hp[l][0] < hp[k][0]) k = l; if (r < hp.length && hp[r][0] < hp[k][0]) k = r; if (k === i) break; [hp[k], hp[i]] = [hp[i], hp[k]]; i = k; } } return top; };
          for (const [id] of known) push(0, id, id);
          while (hp.length) { const [d, id, src] = pop(); if (best.has(id)) continue; best.set(id, { id: src, d, z: known.get(src) }); for (const [nb, w] of adj.get(id) || []) if (!best.has(nb)) push(d + w, nb, src); }
          return best; };
        const UP = msd(adjD), DN = msd(adjU);
        const sl = S.slope / 100; const invNew = new Map();
        const depthBelow = (id) => { const nn = m.nodes.get(id); const g = nn && groundAt ? groundAt(nn) : null; const z = known.get(id); return g === null || z === undefined ? null : g - z; };
        for (const n of nodes) { if (known.has(n.id)) continue;
          const u = UP.get(n.id), d = DN.get(n.id); let z = null, how = ''; const g = groundAt ? groundAt(n) : null;
          // with the ground level: the recorded manhole depth, else the depth below ground interpolated between the neighbours
          if (g !== null && +n.p.maxDepth > 0) { z = g - +n.p.maxDepth; how = 'DEM ground − recorded depth'; }
          else if (g !== null && (u || d)) { const du = u ? depthBelow(u.id) : null, dd = d ? depthBelow(d.id) : null;
            if (du !== null && dd !== null) { z = g - (du + (dd - du) * u.d / (u.d + d.d)); how = 'DEM ground − depth interpolated between ' + u.id + ' and ' + d.id; }
            else if (du !== null || dd !== null) { z = g - (du !== null ? du : dd); how = 'DEM ground − depth of ' + (du !== null ? u.id : d.id); } }
          if (z !== null) { /* found */ }
          else if (u && d) { z = u.z + (d.z - u.z) * u.d / (u.d + d.d); how = 'interpolated between ' + u.id + ' and ' + d.id; }
          else if (u) { z = u.z - sl * u.d; how = 'from ' + u.id + ' upstream at ' + S.slope + ' % slope'; }
          else if (d) { z = d.z + sl * d.d; how = 'from ' + d.id + ' downstream at ' + S.slope + ' % slope'; }
          if (z === null || !isFinite(z)) { probs.push({ o: n, kind: 'Missing invert', text: 'invert could not be inferred (no known invert connected)' }); continue; }
          invNew.set(n.id, z); P(n, 'elev', n.p.elev, +z.toFixed(3), 'inv', how); }
        // ---- manhole depth from the DEM
        if (groundAt) {
          for (const n of nodes) { if (n.type !== 'JUNCTION' || +n.p.maxDepth > 0) continue; const z = invNew.has(n.id) ? invNew.get(n.id) : known.get(n.id); if (z === undefined) continue; const g = groundAt(n); if (g === null) continue;
            if (g - z > 0) P(n, 'maxDepth', n.p.maxDepth, +(g - z).toFixed(3), 'depth', 'DEM ground ' + AV.fmt(g, 2) + ' − invert'); else probs.push({ o: n, kind: 'Invert above ground', text: 'DEM ground ' + AV.fmt(g, 2) + ' is below the invert ' + AV.fmt(z, 2) }); }
        }
        // ---- checks (on the data after inference)
        const zN = (id) => invNew.has(id) ? invNew.get(id) : known.get(id);
        const endInv = (l, end) => { const n = end ? l.to : l.from; const off = +(end ? l.p.outOff : l.p.inOff) || 0; if (elevOff) return off || zN(n); const z = zN(n); return z === undefined ? undefined : z + off; };
        for (const l of conduits) { const a = endInv(l, 0), b = endInv(l, 1); if (a !== undefined && b !== undefined && b > a + S.tol) probs.push({ o: l, kind: 'Adverse slope', text: 'downstream invert ' + AV.fmt(b, 3) + ' above upstream ' + AV.fmt(a, 3) }); }
        const pair = new Map(); for (const l of conduits) { const k = [l.from, l.to].sort().join('|'); (pair.get(k) || pair.set(k, []).get(k)).push(l); }
        for (const g of pair.values()) if (g.length > 1) for (const l of g.slice(1)) probs.push({ o: l, kind: 'Duplicate conduit', text: 'same nodes as ' + g[0].id });
        const deg = new Map(); for (const l of m.links.values()) { deg.set(l.from, (deg.get(l.from) || 0) + 1); deg.set(l.to, (deg.get(l.to) || 0) + 1); }
        for (const n of nodes) if (!deg.get(n.id)) probs.push({ o: n, kind: 'Orphan node', text: 'no link connected' });
        for (const n of nodes) { if (n.type !== 'JUNCTION' || !(+n.p.maxDepth > 0)) continue; const z = zN(n.id); if (z === undefined) continue; const rim = z + +n.p.maxDepth;
          for (const l of [...(inC.get(n.id) || []), ...(outC.get(n.id) || [])]) { const e = l.to === n.id ? endInv(l, 1) : endInv(l, 0); const d = dia.get(l.id) || 0; if (e !== undefined && d > 0 && e + d > rim + S.tol) { probs.push({ o: l, kind: 'Crown above rim', text: 'crown ' + AV.fmt(e + d, 3) + ' above the rim of ' + n.id + ' (' + AV.fmt(rim, 3) + ')' }); break; } } }
        // parts of the network without an outfall
        const comp = new Map(); let ci = 0; const nb = new Map(); for (const l of m.links.values()) { (nb.get(l.from) || nb.set(l.from, []).get(l.from)).push(l.to); (nb.get(l.to) || nb.set(l.to, []).get(l.to)).push(l.from); }
        for (const n of nodes) { if (comp.has(n.id) || !deg.get(n.id)) continue; const st = [n.id]; comp.set(n.id, ci); const mem = [n.id]; let hasOut = false;
          while (st.length) { const x = st.pop(); const xn = m.nodes.get(x); if (xn && (xn.type === 'OUTFALL' || xn.type === 'STORAGE')) hasOut = true; for (const y of nb.get(x) || []) if (!comp.has(y)) { comp.set(y, ci); st.push(y); mem.push(y); } }
          if (!hasOut) probs.push({ o: m.nodes.get(mem[0]), kind: 'No outfall', text: mem.length + ' connected node(s) without an outfall or storage', members: mem.map(id => m.nodes.get(id)).filter(Boolean) }); ci++; }
        for (const s of m.subcatchments.values()) { const t = s.p.outlet; if (!t || (!m.nodes.has(t) && !m.subcatchments.has(t))) probs.push({ o: s, kind: 'Subcatchment outlet', text: t ? 'outlet ' + t + ' does not exist' : 'no outlet' }); }
        for (const l of conduits) if (!(len.get(l.id) > 0)) probs.push({ o: l, kind: 'Zero length', text: 'length 0 and no drawn length' });
      } finally { busy.done(); }
      this.props = props; this.probs = probs; this.render();
      this.app.status('Infer & Clean: ' + props.length + ' value(s) can be inferred, ' + probs.length + ' issue(s) found.');
    }
    apply() {
      const app = this.app; if (!this.props) return; const sel = this.props.filter(p => this.on[p.rule]); if (!sel.length) { AV.toast('Nothing ticked to apply.', true); return; }
      const objs = [...new Set(sel.map(p => p.o))]; const tag = this.S.tag.trim();
      app.tools.bulk('Infer & Clean: ' + sel.length + ' value(s)', objs, () => { for (const p of sel) p.o.p[p.key] = p.nw; if (tag) for (const o of objs) o.tag = tag; });
      app.refreshAll && app.refreshAll(); app.map.redraw();
      AV.toast(sel.length + ' value(s) written to ' + objs.length + ' object(s). Undo with Ctrl+Z.'); this.props = null; this.analyse();
    }
    render() {
      const E = this.el; if (!E) return; E.innerHTML = ''; const S = this.S, m = this.app.model; const LU = m.isSI ? 'm' : 'ft';
      const cb = (k, l, o) => h('label', null, h('input', { type: 'checkbox', checked: !!(o || S)[k], onchange: (e) => { (o || S)[k] = e.target.checked; if (o) this.render(); } }), ' ' + l);
      const num = (k, w) => h('input', { type: 'number', step: 'any', value: S[k], style: { width: (w || 60) + 'px' }, onchange: (e) => { S[k] = +e.target.value; } });
      const dem = h('input', { type: 'text', value: S.dem, placeholder: 'DEM for manhole depths (optional)', style: { width: '260px' }, onchange: (e) => { S.dem = e.target.value.trim(); } });
      const tag = h('input', { type: 'text', value: S.tag, placeholder: '(no tag)', style: { width: '90px' }, onchange: (e) => { S.tag = e.target.value; } });
      E.appendChild(h('div', { class: 'cmpbar' }, h('b', null, 'Missing values'), cb('zeroMissing', '0 is missing'), h('label', null, 'and ≤ ', num('below', 70)),
        h('span', { class: 'cmpsep' }), h('label', null, 'Min. slope ', num('slope', 50), ' %'), h('label', null, 'Default n ', num('n', 60)), h('label', null, 'Tolerance ', num('tol', 60), ' ' + LU), dem,
        h('button', { class: 'btn small', onclick: async () => { const p = await window.host.openDialog({ filters: [{ name: 'DEM', extensions: ['tif', 'tiff', 'asc'] }] }); if (p) { S.dem = p; this.render(); } } }, '…'),
        h('button', { class: 'btn small primary', onclick: () => this.analyse() }, 'Analyse')));
      if (!this.props) { E.appendChild(h('div', { class: 'hint', style: { padding: '14px' } }, 'Analyse checks the network for missing data and problems. Nothing is changed until you Apply the ticked inferences (one undo step).')); return; }
      const RULES = [['len', 'Conduit length'], ['dia', 'Conduit size'], ['rough', 'Roughness'], ['inv', 'Node invert'], ['depth', 'Manhole depth (DEM)']];
      const cnt = (r) => this.props.filter(p => p.rule === r).length;
      E.appendChild(h('div', { class: 'cmpbar' }, h('b', null, 'Apply'), RULES.map(([k, l]) => h('label', { style: { opacity: cnt(k) ? 1 : 0.5 } }, h('input', { type: 'checkbox', checked: this.on[k], disabled: !cnt(k), onchange: (e) => { this.on[k] = e.target.checked; } }), ' ' + l + ' (' + cnt(k) + ')')),
        h('label', null, 'Tag changed objects ', tag), h('span', { style: { flex: 1 } }), h('button', { class: 'btn small', onclick: () => this.exportCSV() }, 'Export CSV'),
        h('button', { class: 'btn small primary', disabled: !this.props.length, onclick: () => this.apply() }, 'Apply Ticked')));
      const fmt = (v) => v === undefined || v === null || v === '' ? '–' : typeof v === 'number' ? AV.fmt(v, 4) : String(v);
      const key = { length: 'Length', g1: 'Size (geom 1)', rough: 'Roughness', elev: 'Invert', maxDepth: 'Max. depth' };
      const zoom = (objs) => { objs = objs.filter(Boolean); if (!objs.length) return; this.app.selectMany(objs); this.app.activateView('map'); this.app.map.zoomToObjects(objs); };
      const tp = h('table', { class: 'ptbl csotbl' }, h('tr', null, ['Object', 'Field', 'Now', 'Inferred', 'How'].map(t => h('th', null, t))),
        this.props.slice(0, 3000).map(p => h('tr', { class: this.on[p.rule] ? '' : 'dim', onclick: () => this.app.selectMany([p.o]), ondblclick: () => zoom([p.o]) }, h('td', null, p.o.id), h('td', null, key[p.key] || p.key), h('td', { class: 'num' }, fmt(p.old)), h('td', { class: 'num' }, fmt(p.nw)), h('td', null, p.how))));
      const kinds = [...new Set(this.probs.map(p => p.kind))];
      const tq = h('table', { class: 'ptbl csotbl' }, h('tr', null, ['Object', 'Issue', 'Details'].map(t => h('th', null, t))),
        this.probs.slice(0, 3000).map(p => h('tr', { onclick: () => p.o && this.app.selectMany(p.members || [p.o]), ondblclick: () => zoom(p.members || [p.o]) }, h('td', null, p.o ? p.o.id : ''), h('td', null, p.kind), h('td', null, p.text))));
      E.appendChild(h('div', { class: 'csobody' },
        h('div', { class: 'csopane' }, h('div', { class: 'psec2' }, 'Inferred values (' + this.props.length + ')' + (this.props.length > 3000 ? ' – first 3000 shown' : '')), h('div', { class: 'ptwrap' }, this.props.length ? tp : h('div', { class: 'hint', style: { padding: '8px' } }, 'No missing value found.'))),
        h('div', { class: 'csopane' }, h('div', { class: 'psec2' }, 'Issues (' + this.probs.length + ')  ', kinds.map(k => h('button', { class: 'btn small', style: { marginLeft: '4px' }, title: 'Select all objects with this issue', onclick: () => { const o = this.probs.filter(p => p.kind === k).flatMap(p => p.members || [p.o]).filter(Boolean); this.app.selectMany(o); AV.toast(o.length + ' object(s) selected: ' + k); } }, k + ' ' + this.probs.filter(p => p.kind === k).length))),
          h('div', { class: 'ptwrap' }, this.probs.length ? tq : h('div', { class: 'hint', style: { padding: '8px' } }, 'No issue found.')))));
    }
    async exportCSV() {
      const q = (s) => /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
      const L = ['Type,Object,Field / issue,Now,Inferred,Details'];
      for (const p of this.props || []) L.push(['Inferred', q(p.o.id), p.key, q(p.old === undefined ? '' : p.old), p.nw, q(p.how)].join(','));
      for (const p of this.probs || []) L.push(['Issue', q(p.o ? p.o.id : ''), q(p.kind), '', '', q(p.text)].join(','));
      await AV.downloadText(L.join('\r\n') + '\r\n', (this.app.filePath ? AV.basename(this.app.filePath).replace(/\.inp$/i, '') : 'model') + '_infer_clean.csv', [{ name: 'CSV', extensions: ['csv'] }]);
    }
  }
  AV.openInference = function (app) { if (!app.model.nodes.size) { AV.alert('The model is empty.'); return; } app.infer = app.infer && app.infer.app === app ? app.infer : new Inference(app); app.infer.open(); };
})(window.AV);
