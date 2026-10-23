// Network tools: tracing, recalculation, design inverts, orifice conversion, import/export, validation
'use strict';
(function (AV) {
  const h = AV.h;
  class Tools {
    constructor(app) { this.app = app; }
    get m() { return this.app.model; }

    scopeField(def, kind) { return { k: 'scope', l: 'Apply to', t: 'choice', o: [['sel', 'Selected objects'], ['all', 'All objects']], d: def || ([...this.app.selection].some(o => !kind || o.kind === kind) ? 'sel' : 'all') }; }
    scoped(scope, kind, typeFilter) {
      const src = scope === 'sel' ? [...this.app.selection] : [...(kind === 'NODE' ? this.m.nodes.values() : kind === 'LINK' ? this.m.links.values() : this.m.subcatchments.values())];
      return src.filter(o => o.kind === kind && (!typeFilter || typeFilter.includes(o.type)));
    }
    // snapshot-based undo for bulk property edits
    bulk(label, objs, fn) {
      if (!this.app.canModify()) return;
      const before = objs.map(o => ({ o, p: Object.assign({}, o.p), from: o.from, to: o.to, verts: o.verts ? o.verts.slice() : null, x: o.x, y: o.y, type: o.type, tag: o.tag, poly: o.poly ? o.poly.slice() : null }));
      fn();
      const after = objs.map(o => ({ o, p: Object.assign({}, o.p), from: o.from, to: o.to, verts: o.verts ? o.verts.slice() : null, x: o.x, y: o.y, type: o.type, tag: o.tag, poly: o.poly ? o.poly.slice() : null }));
      const apply = (snap) => { for (const s of snap) { const o = s.o; o.p = Object.assign({}, s.p); if (o.kind === 'LINK') { o.from = s.from; o.to = s.to; o.verts = s.verts; o.type = s.type; } if (o.kind === 'NODE') o.type = s.type; if (o.kind === 'NODE' || o.kind === 'GAGE') { o.x = s.x; o.y = s.y; } if (o.kind === 'SUBCATCH') o.poly = s.poly; o.tag = s.tag; } };
      // field-level changes for the change history
      const changes = [];
      for (let i = 0; i < objs.length; i++) {
        const A = before[i], Z = after[i], o = A.o;
        for (const k of new Set([...Object.keys(A.p), ...Object.keys(Z.p)])) if (String(A.p[k]) !== String(Z.p[k]) && typeof Z.p[k] !== 'object') changes.push({ o, key: k, old: A.p[k], nw: Z.p[k] });
        for (const k of ['from', 'to', 'type', 'tag', 'x', 'y']) if (A[k] !== Z[k]) changes.push({ o, key: k, old: A[k], nw: Z[k] });
        if (JSON.stringify(A.verts) !== JSON.stringify(Z.verts)) changes.push({ o, key: 'verts', old: A.verts, nw: Z.verts });
        if (JSON.stringify(A.poly) !== JSON.stringify(Z.poly)) changes.push({ o, key: 'poly', old: A.poly, nw: Z.poly });
      }
      const cmd = { label, do: () => apply(after), undo: () => apply(before), changes };
      this.app.undoStack.push(cmd); this.app.redoStack = []; if (this.app.hist) this.app.hist.record(cmd, 'do');
      this.app.afterEdit({ label });
    }

    // ------------------------------------------------------------------ find
    // Search panel: type part of an ID (or a tag); every match is listed - click one to select it and show its properties
    find() {
      const app = this.app, h = AV.h;
      const TN = (o) => o.kind === 'SUBCATCH' ? 'Subcatchment' : o.kind === 'GAGE' ? 'Rain Gage' : o.type.charAt(0) + o.type.slice(1).toLowerCase();
      const q = h('input', { type: 'text', placeholder: 'ID, part of an ID, or tag', style: { flex: 1, minWidth: '120px' } });
      const kind = h('select', null, [['', 'All'], ['NODE', 'Nodes'], ['LINK', 'Links'], ['SUBCATCH', 'Subcatchments'], ['GAGE', 'Rain Gages']].map(([v, l]) => h('option', { value: v }, l)));
      const tagChk = h('input', { type: 'checkbox' });
      const info = h('span', { class: 'sub' });
      const list = h('div', { class: 'searchlist' });
      let hits = [], cur = -1;
      const pick = (i, zoomClose) => {
        cur = i; const o = hits[i]; if (!o) return;
        AV.$$('.searchlist .si', list).forEach((e, k) => e.classList.toggle('sel', k === i));
        app.select(o); app.activateView('map');
        if (zoomClose || !app.map.isVisible || !app.map.isVisible(o)) app.map.zoomToObjects([o]);
      };
      const run = () => {
        const s = q.value.trim().toLowerCase(); list.innerHTML = ''; hits = []; cur = -1;
        if (!s) { info.textContent = ''; return; }
        const m = this.m; const cols = { NODE: m.nodes, LINK: m.links, SUBCATCH: m.subcatchments, GAGE: m.gages };
        const exact = [], part = [];
        for (const k of Object.keys(cols)) {
          if (kind.value && kind.value !== k) continue;
          for (const o of cols[k].values()) {
            const id = o.id.toLowerCase();
            if (id === s) exact.push(o); else if (id.includes(s) || (tagChk.checked && String(o.tag || '').toLowerCase().includes(s))) part.push(o);
          }
        }
        part.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        hits = exact.concat(part);
        info.textContent = hits.length + ' found' + (hits.length > 2000 ? ' (first 2000 listed)' : '');
        hits.slice(0, 2000).forEach((o, i) => list.appendChild(h('div', { class: 'si', onclick: () => pick(i), ondblclick: () => pick(i, true) },
          h('span', { class: 'st' }, TN(o)), h('span', { class: 'sn' }, o.id), o.tag ? h('span', { class: 'sg' }, o.tag) : null)));
        if (hits.length === 1) pick(0, true);
      };
      const deb = AV.debounce(run, 150);
      q.addEventListener('input', deb); kind.addEventListener('change', run); tagChk.addEventListener('change', run);
      q.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); pick(Math.min(hits.length - 1, cur + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); pick(Math.max(0, cur - 1)); }
        else if (e.key === 'Enter') { run(); if (hits.length) pick(Math.max(0, cur), true); }
      });
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h('div', { class: 'followbar' }, q, kind, h('label', { title: 'Also match the Tag field' }, tagChk, ' Tag')),
        h('div', { class: 'followbar' }, info, h('span', { style: { flex: 1 } }),
          h('button', { class: 'btn small', onclick: () => { if (hits.length) { app.selectMany(hits.slice(0, 5000)); app.map.zoomToObjects(hits.slice(0, 2000)); } } }, 'Select All Results')),
        list);
      const p = AV.floatPanel({ id: 'search', title: 'Search', w: 360, h: 460, body });
      setTimeout(() => q.focus(), 30); return p;
    }

    // ------------------------------------------------------------------ connectivity
    trace(dir) {
      const m = this.m; const sel = [...this.app.selection].filter(o => o.kind === 'NODE' || o.kind === 'LINK');
      if (!sel.length) { AV.toast('Select a node or link first.', true); return; }
      const adj = m.adjacency(); const nodes = new Set(), links = new Set(); const stack = [];
      for (const o of sel) { if (o.kind === 'NODE') stack.push(o.id); else { links.add(o); stack.push(dir === 'up' ? o.from : o.to); } }
      while (stack.length) {
        const id = stack.pop(); if (nodes.has(id)) continue; nodes.add(id);
        const ls = dir === 'up' ? adj.inn.get(id) || [] : adj.out.get(id) || [];
        for (const l of ls) { links.add(l); stack.push(dir === 'up' ? l.from : l.to); }
        // divider diversions are links too; subcatchments draining to traced nodes
      }
      const objs = [...nodes].map(id => m.nodes.get(id)).filter(Boolean).concat([...links]);
      if (dir === 'up') for (const s of m.subcatchments.values()) if (nodes.has(s.p.outlet)) objs.push(s);
      this.app.map.highlight = new Set(objs);
      this.app.selectMany(objs);
      const len = [...links].reduce((a, l) => a + (l.type === 'CONDUIT' ? +l.p.length || 0 : 0), 0);
      const area = objs.filter(o => o.kind === 'SUBCATCH').reduce((a, s) => a + (+s.p.area || 0), 0);
      this.app.status(`${dir === 'up' ? 'Upstream' : 'Downstream'} trace: ${nodes.size} nodes, ${links.size} links, conduit length ${AV.fmt(len, 1)} ${this.app.lengthUnits()}` + (dir === 'up' ? `, ${objs.filter(o => o.kind === 'SUBCATCH').length} subcatchments (${AV.fmt(area, 2)} ${this.m.isSI ? 'ha' : 'ac'})` : ''));
    }
    clearTrace(silent) { if (this.app.map) { this.app.map.highlight = new Set(); this.app.map.redrawOverlay(); } }
    async queryPath(fromId) {
      const sel = [...this.app.selection].filter(o => o.kind === 'NODE');
      const r = await AV.formDialog('Query Path', [{ k: 'from', l: 'From node', t: 'text' }, { k: 'to', l: 'To node', t: 'text' }, { k: 'directed', l: 'Follow flow direction only', t: 'check' }, { k: 'profile', l: 'Open profile plot', t: 'check' }],
        { from: fromId || (sel[0] ? sel[0].id : ''), to: sel[1] ? sel[1].id : '', directed: true, profile: false });
      if (!r) return;
      const p = AV.findPath(this.m, r.from.trim(), r.to.trim(), r.directed) || (r.directed ? null : null);
      if (!p) { AV.alert('No ' + (r.directed ? 'downstream ' : '') + 'path found between ' + r.from + ' and ' + r.to + '.'); return; }
      const objs = p.nodes.map(id => this.m.nodes.get(id)).concat(p.links.map(x => x.link));
      this.app.map.highlight = new Set(objs); this.app.selectMany(objs); this.app.map.zoomToObjects(objs);
      const len = p.links.reduce((a, x) => a + (+x.link.p.length || 0), 0);
      this.app.status(`Path: ${p.nodes.length} nodes, ${p.links.length} links, length ${AV.fmt(len, 1)} ${this.app.lengthUnits()}`);
      if (r.profile) this.app.sim.openProfile(r.from.trim(), r.to.trim());
    }

    // ------------------------------------------------------------------ subcatchments
    areaFromPoly(poly) {
      if (!poly || poly.length < 3) return null;
      const units = (this.m.mapInfo.units || 'None').toUpperCase(); const si = this.m.isSI;
      let a;
      if (units === 'DEGREES') {
        const lat0 = poly.reduce((s, p) => s + p[1], 0) / poly.length * Math.PI / 180; const R = 6371008.8;
        a = AV.polyArea(poly.map(p => [p[0] * Math.PI / 180 * R * Math.cos(lat0), p[1] * Math.PI / 180 * R])); // m2
        return si ? a / 10000 : a / 4046.8564224;
      }
      a = AV.polyArea(poly);
      const isFeet = units === 'FEET' || (units === 'NONE' && !si);
      return isFeet ? (si ? a * 0.09290304 / 10000 : a / 43560) : (si ? a / 10000 : a / 4046.8564224);
    }
    async recalcArea() {
      const r = await AV.formDialog('Recalculate Subcatchment Area', [this.scopeField(null, 'SUBCATCH'), { t: 'note', l: 'Area is computed from the polygon using the map units (status bar) and reported in ' + (this.m.isSI ? 'hectares' : 'acres') + '. Set Map Units first if they are "None".' }]);
      if (!r) return;
      const subs = this.scoped(r.scope, 'SUBCATCH').filter(s => s.poly.length > 2);
      if (!subs.length) { AV.toast('No subcatchments with polygons in scope.', true); return; }
      this.bulk('Recalculate area', subs, () => { for (const s of subs) s.p.area = +this.areaFromPoly(s.poly).toFixed(4); });
      AV.toast('Area recalculated for ' + subs.length + ' subcatchment(s).');
    }
    async batchAssignOutlet() {
      const r = await AV.formDialog('Batch Assign Outlet', [this.scopeField(null, 'SUBCATCH'), { k: 'method', l: 'Method', t: 'choice', o: [['lowest', 'Lowest-invert node inside polygon (else nearest)'], ['nearest', 'Node nearest to centroid']], d: 'lowest' },
      { k: 'only', l: 'Only subcatchments without a valid outlet', t: 'check', d: false }]);
      if (!r) return;
      const subs = this.scoped(r.scope, 'SUBCATCH').filter(s => !r.only || !this.m.nodes.has(s.p.outlet));
      const nodes = [...this.m.nodes.values()]; if (!nodes.length) { AV.toast('There are no nodes.', true); return; }
      this.app.map.ensureIndex();
      let n = 0;
      this.bulk('Assign outlets', subs, () => {
        for (const s of subs) {
          let best = null;
          if (r.method === 'lowest' && s.poly.length > 2 && s._bb) {
            this.app.map.grid.query(s._bb[0], s._bb[1], s._bb[2], s._bb[3], (o) => { if (o.kind === 'NODE' && AV.pointInPoly(o.x, o.y, s.poly) && (!best || +o.p.elev < +best.p.elev)) best = o; });
          }
          if (!best) { const c = s.poly.length ? AV.polyCentroid(s.poly) : null; if (!c) continue; let bd = Infinity; for (const o of nodes) { const d = Math.hypot(o.x - c[0], o.y - c[1]); if (d < bd) { bd = d; best = o; } } }
          if (best) { s.p.outlet = best.id; n++; }
        }
      });
      AV.toast('Outlet assigned for ' + n + ' subcatchment(s).');
    }
    async assignGage() {
      const gs = [...this.m.gages.keys()]; if (!gs.length) { AV.alert('There are no rain gages.'); return; }
      const r = await AV.formDialog('Assign Rain Gage', [this.scopeField(null, 'SUBCATCH'), { k: 'g', l: 'Rain gage', t: 'choice', o: gs }]); if (!r) return;
      const subs = this.scoped(r.scope, 'SUBCATCH'); this.bulk('Assign gage', subs, () => subs.forEach(s => s.p.gage = r.g));
      AV.toast('Gage ' + r.g + ' assigned to ' + subs.length + ' subcatchment(s).');
    }

    // ------------------------------------------------------------------ conduits
    async recalcLength() {
      const r = await AV.formDialog('Recalculate Conduit Length', [this.scopeField(null, 'LINK'), { k: 'min', l: 'Minimum length', t: 'num', d: this.m.isSI ? 1 : 3 },
      { t: 'note', l: 'Length = map distance along the link vertices, in map units. Map units must match the model length units (' + this.app.lengthUnits() + ').' }]);
      if (!r) return;
      const ls = this.scoped(r.scope, 'LINK', ['CONDUIT']);
      this.bulk('Recalculate length', ls, () => ls.forEach(l => { l.p.length = +Math.max(r.min, this.m.linkLengthGeom(l)).toFixed(3); }));
      AV.toast('Length recalculated for ' + ls.length + ' conduit(s).');
    }
    async deriveElevation() {
      const si = this.m.isSI;
      const r = await AV.formDialog('Derive Elevation (Design Inverts)', [this.scopeField('all'),
      { k: 'cover', l: 'Minimum cover over pipe crown', t: 'num', d: si ? 1.0 : 3.0 }, { k: 'slope', l: 'Minimum slope (%)', t: 'num', d: 0.5 },
      { k: 'drops', l: 'Use drop structures (inlet offsets) where needed', t: 'check', d: true },
      { t: 'note', l: 'For planning networks without surveyed inverts. Ground level at each node = current rim (Invert + Max. Depth); set rims first. Inverts are worked downstream from the most upstream nodes so every conduit has at least the minimum cover and slope. Junction invert and max. depth are rewritten; conduit offsets become drops.' }]);
      if (!r) return;
      const m = this.m; const links = this.scoped(r.scope, 'LINK', ['CONDUIT']); if (!links.length) { AV.toast('No conduits in scope.', true); return; }
      if ((m.options.LINK_OFFSETS || 'DEPTH').toUpperCase() !== 'DEPTH') { AV.alert('Derive Elevation requires LINK_OFFSETS = DEPTH (Simulation Options > General).'); return; }
      const nodeSet = new Set(); links.forEach(l => { nodeSet.add(l.from); nodeSet.add(l.to); });
      const nodes = [...nodeSet].map(id => m.nodes.get(id)).filter(Boolean);
      const ground = new Map(nodes.map(n => [n.id, +n.p.elev + (+n.p.maxDepth || 0)]));
      // topological order (Kahn) over conduits in scope
      const indeg = new Map(nodes.map(n => [n.id, 0])); const outL = new Map(nodes.map(n => [n.id, []]));
      const inL = new Map(); for (const l of links) { indeg.set(l.to, indeg.get(l.to) + 1); outL.get(l.from).push(l); if (!inL.has(l.to)) inL.set(l.to, []); inL.get(l.to).push(l); }
      const q = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id); const order = [];
      while (q.length) { const id = q.shift(); order.push(id); for (const l of outL.get(id)) { indeg.set(l.to, indeg.get(l.to) - 1); if (indeg.get(l.to) === 0) q.push(l.to); } }
      if (order.length < nodes.length) { AV.alert('The selected network contains a loop; derive elevation needs a tree / dendritic network.'); return; }
      const inv = new Map(); const dia = (l) => parseFloat(l.p.g1) || 0;
      const maxDiaOut = (id) => Math.max(0, ...outL.get(id).map(dia));
      const linkUp = new Map(); // conduit upstream-end invert
      this.bulk('Derive elevation', nodes.concat(links), () => {
        for (const id of order) {
          const n = m.nodes.get(id);
          const incoming = inL.get(id) || [];
          const zGround = ground.get(id) - r.cover - Math.max(maxDiaOut(id), ...incoming.map(dia), 0);
          const zEnd = (l) => linkUp.get(l.id) - r.slope / 100 * (+l.p.length || 0);
          // node invert: at least minimum cover, and at or below every incoming pipe end (min slope)
          const z = Math.min(zGround, ...incoming.map(zEnd));
          inv.set(id, z);
          // with drop structures the incoming pipe keeps the minimum slope and drops into the manhole;
          // without them it is steepened to end at the node invert
          for (const l of incoming) l.p.outOff = r.drops ? +Math.max(0, zEnd(l) - z).toFixed(3) : 0;
          for (const l of outL.get(id)) { linkUp.set(l.id, z); l.p.inOff = 0; }
          if (n.type !== 'OUTFALL') { n.p.elev = +z.toFixed(3); n.p.maxDepth = +Math.max(0, ground.get(id) - z).toFixed(3); } else n.p.elev = +z.toFixed(3);
        }
        // pipe slopes: conduit downstream end ends at node invert + outOff
      });
      AV.toast('Inverts derived for ' + nodes.length + ' nodes and ' + links.length + ' conduits.');
    }

    // ------------------------------------------------------------------ orifice -> conduit (Avaris convergence fix)
    async orificeToConduit(list) {
      const m = this.m; const si = m.isSI;
      let cands = list || null;
      const r = await AV.formDialog('Convert Orifices to Equivalent Conduits', [
        list ? { t: 'note', l: list.length + ' orifice(s) will be converted.' } : { k: 'scope', l: 'Orifices', t: 'choice', o: [['sel', 'Selected orifices'], ['all', 'All orifices']], d: [...this.app.selection].some(o => o.type === 'ORIFICE') ? 'sel' : 'all' },
        { k: 'length', l: 'Conduit length (' + (si ? 'm' : 'ft') + ')', t: 'num', d: si ? 3.048 : 10 },
        { k: 'kEntry', l: 'Entry loss coefficient', t: 'num', d: 0.5 }, { k: 'kExit', l: 'Exit loss coefficient', t: 'num', d: 1.0 },
        { k: 'rough', l: 'Manning roughness', t: 'num', d: 0.013 }, { k: 'tag', l: 'Tag converted conduits as', t: 'text', d: 'orifice' },
        { k: 'skipCtl', l: 'Skip orifices referenced by control rules', t: 'check', d: true },
        { t: 'note', l: 'Orifices that cause dynamic-wave nonconvergence are replaced by short conduits that approximate orifice behaviour: same ID, same cross-section shape and size, inlet offset kept, entry/exit losses applied, flap gate kept. In the reference DWSD case, converting 477 orifices this way reduced the worst node from 70% to 5.86% nonconverging steps. Compare hydrographs before/after to confirm.' }]);
      if (!r) return;
      if (!cands) cands = (r.scope === 'sel' ? [...this.app.selection] : [...m.links.values()]).filter(l => l.kind === 'LINK' && l.type === 'ORIFICE');
      cands = cands.filter(l => l.type === 'ORIFICE');
      const ctl = (m.raw.CONTROLS || []).join('\n');
      const skipped = [];
      if (r.skipCtl) cands = cands.filter(l => { const re = new RegExp('\\bORIFICE\\s+' + l.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'); if (re.test(ctl)) { skipped.push(l.id); return false; } return true; });
      if (!cands.length) { AV.alert('No orifices to convert.' + (skipped.length ? '\n\nSkipped (used in control rules): ' + skipped.join(', ') : '')); return; }
      const elevOff = (m.options.LINK_OFFSETS || 'DEPTH').toUpperCase() === 'ELEVATION';
      this.bulk('Convert ' + cands.length + ' orifice(s) to conduits', cands, () => {
        for (const l of cands) {
          const o = l.p; const shape = o.shape === 'RECT_CLOSED' ? 'RECT_CLOSED' : 'CIRCULAR';
          const outNode = m.nodes.get(l.to);
          l.type = 'CONDUIT';
          l.p = Object.assign(AV.defaults('CONDUIT'), {
            length: r.length, rough: r.rough, inOff: +o.offset || 0, outOff: elevOff && outNode ? +outNode.p.elev : 0, initFlow: 0, maxFlow: 0,
            shape, g1: o.g1 || '1', g2: shape === 'RECT_CLOSED' ? (o.g2 || '1') : '0', g3: '0', g4: '0', barrels: 1, culvert: '',
            kEntry: r.kEntry, kExit: r.kExit, kAvg: 0, flap: o.gated === 'YES' ? 'YES' : 'NO', seepage: 0,
          });
          if (o.otype === 'BOTTOM') l.p.inOff = 0;
          l.tag = r.tag;
        }
      });
      this.app.panels.refreshTree();
      AV.alert('Converted ' + cands.length + ' orifice(s) to conduits tagged "' + r.tag + '".' + (skipped.length ? '\n\nSkipped ' + skipped.length + ' orifice(s) referenced in control rules: ' + skipped.slice(0, 20).join(', ') : '') + '\n\nSave the model under a new name, re-run, and use Results > Compare Hydrographs to check the before/after flows.', 'Orifice Conversion');
    }

    reverseLinks(list) {
      const ls = (list || [...this.app.selection]).filter(o => o.kind === 'LINK'); if (!ls.length) { AV.toast('Select one or more links.', true); return; }
      this.bulk('Reverse links', ls, () => { for (const l of ls) { [l.from, l.to] = [l.to, l.from]; l.verts = l.verts.slice().reverse(); if (l.type === 'CONDUIT') [l.p.inOff, l.p.outOff] = [l.p.outOff, l.p.inOff]; } });
      AV.toast(ls.length + ' link(s) reversed.');
    }
    async batchEdit() {
      const sel = [...this.app.selection]; if (!sel.length) { AV.toast('Select objects first.', true); return; }
      const types = [...new Set(sel.map(o => o.kind === 'NODE' || o.kind === 'LINK' ? o.type : o.kind))];
      const tSel = h('select', null, types.map(t => h('option', { value: t }, AV.TYPE_LABEL[t] || t)));
      const fSel = h('select'); const fill = () => { fSel.innerHTML = ''; fSel.appendChild(h('option', { value: 'tag' }, 'Tag')); for (const f of AV.SCHEMA[tSel.value === 'SUBCATCH' ? 'SUBCATCH' : tSel.value]) fSel.appendChild(h('option', { value: f.k }, f.l)); }; fill(); tSel.onchange = fill;
      const val = h('input', { type: 'text', style: { width: '220px' } });
      const r = await AV.modal({ title: 'Batch Edit', body: h('div', { class: 'form' }, h('label', null, 'Object type'), tSel, h('label', null, 'Property'), fSel, h('label', null, 'New value'), val,
        h('div', { class: 'note' }, 'Enter a value, or an expression using x for the current value, e.g. "x*1.1" or "x+0.5".')), buttons: [{ label: 'Cancel', value: null }, { label: 'Apply', primary: true, onClick: () => ({ t: tSel.value, k: fSel.value, v: val.value }) }] }).done;
      if (!r) return;
      const objs = sel.filter(o => (o.kind === 'NODE' || o.kind === 'LINK' ? o.type : o.kind) === r.t);
      const isExpr = /\bx\b/.test(r.v); let fn = null;
      if (isExpr) { if (!/^[\dx+\-*/().\se^]+$/i.test(r.v)) { AV.alert('Only numbers, x and + - * / ( ) are allowed in expressions.'); return; } fn = new Function('x', 'return (' + r.v.replace(/\^/g, '**') + ');'); }
      const schema = AV.SCHEMA[r.t === 'SUBCATCH' ? 'SUBCATCH' : r.t].find(f => f.k === r.k);
      this.bulk('Batch edit ' + r.k, objs, () => {
        for (const o of objs) {
          if (r.k === 'tag') { o.tag = r.v; continue; }
          let v = isExpr ? fn(parseFloat(o.p[r.k]) || 0) : r.v;
          if (schema && schema.t === 'num') v = parseFloat(v); if (schema && schema.t === 'num' && !isFinite(v)) continue;
          if (isExpr && schema && schema.t !== 'num') v = String(+v.toFixed(6));
          o.p[r.k] = v;
        }
      });
      AV.toast(objs.length + ' object(s) updated.');
    }

    // ------------------------------------------------------------------ coordinates
    async transformCoords() {
      if (!this.app.canModify()) return;
      const r = await AV.formDialog('Convert Coordinates', [{ k: 'dx', l: 'Offset X', t: 'num', d: 0 }, { k: 'dy', l: 'Offset Y', t: 'num', d: 0 }, { k: 's', l: 'Scale factor', t: 'num', d: 1 }, { k: 'rot', l: 'Rotation (degrees, CCW about map center)', t: 'num', d: 0 },
      { k: 'units', l: 'New map units', t: 'choice', o: ['(unchanged)', 'Feet', 'Meters', 'Degrees', 'None'], d: '(unchanged)' },
      { t: 'note', l: 'Applies an affine transform to every node, vertex, polygon, gage and label. Useful to move a model into a projected grid or convert feet <-> meters (scale 0.3048 / 3.28084). For full datum reprojection, reproject the source GIS data and re-import.' }]);
      if (!r) return;
      const m = this.m; const b = m.bounds(false) || { x1: 0, y1: 0, x2: 0, y2: 0 }; const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      const a = r.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      const T = (x, y) => { const X = x - cx, Y = y - cy; return [cx + (X * c - Y * s) * r.s + r.dx, cy + (X * s + Y * c) * r.s + r.dy]; };
      const objs = [...m.nodes.values(), ...m.links.values(), ...m.subcatchments.values(), ...m.gages.values()];
      const lbs = m.labels.map(l => [l, l.x, l.y]); const oldUnits = m.mapInfo.units;
      this.bulk('Transform coordinates', objs, () => {
        for (const n of m.nodes.values()) [n.x, n.y] = T(n.x, n.y);
        for (const g of m.gages.values()) [g.x, g.y] = T(g.x, g.y);
        for (const l of m.links.values()) l.verts = l.verts.map(v => T(v[0], v[1]));
        for (const sc of m.subcatchments.values()) sc.poly = sc.poly.map(v => T(v[0], v[1]));
        for (const lb of m.labels) [lb.x, lb.y] = T(lb.x, lb.y);
        if (r.units !== '(unchanged)') m.mapInfo.units = r.units;
      });
      const top = this.app.undoStack[this.app.undoStack.length - 1]; const u = top.undo, d = top.do;
      top.undo = () => { u(); for (const [l, x, y] of lbs) { l.x = x; l.y = y; } m.mapInfo.units = oldUnits; };
      const after = m.labels.map(l => [l, l.x, l.y]); const nu = m.mapInfo.units; top.do = () => { d(); for (const [l, x, y] of after) { l.x = x; l.y = y; } m.mapInfo.units = nu; };
      this.app.refreshAll(); this.app.map.zoomAll();
    }

    // ------------------------------------------------------------------ validation & summary
    validate() {
      const m = this.m; const issues = [];
      const add = (sev, obj, msg) => issues.push({ sev, obj, msg });
      // the quick checks return text: find the object named at the start so the row can select / zoom to it
      const objOf = (t) => { const r = /^(Link|Conduit|Pump|Subcatchment|Rain gage) (.+?):/.exec(t); if (!r) return null; return r[1] === 'Subcatchment' ? m.subcatchments.get(r[2]) || null : r[1] === 'Rain gage' ? m.gages.get(r[2]) || null : m.links.get(r[2]) || null; };
      for (const s of AV.validateQuick(m)) add('Error', objOf(s), s);
      const deg = new Map(); for (const l of m.links.values()) { deg.set(l.from, (deg.get(l.from) || 0) + 1); deg.set(l.to, (deg.get(l.to) || 0) + 1); }
      const subOut = new Set([...m.subcatchments.values()].map(s => s.p.outlet));
      for (const n of m.nodes.values()) {
        if (!deg.get(n.id) && !subOut.has(n.id)) add('Warning', n, 'Node ' + n.id + ' is not connected to any link');
        if (n.type === 'JUNCTION' && !(+n.p.maxDepth > 0)) add('Info', n, 'Junction ' + n.id + ' has zero max. depth (engine uses the deepest connecting conduit)');
      }
      for (const l of m.links.values()) {
        if (l.type !== 'CONDUIT') continue;
        const s = AV.conduitSlope(m, l); if (s !== null && s < 0) add('Warning', l, 'Conduit ' + l.id + ' has an adverse slope (' + AV.fmt(s * 100, 3) + ' %)');
        const a = m.nodes.get(l.from), b = m.nodes.get(l.to);
        if (a && b && a.type !== 'OUTFALL' && +l.p.inOff + (parseFloat(l.p.g1) || 0) > (+a.p.maxDepth || 0) && +a.p.maxDepth > 0 && (m.options.LINK_OFFSETS || 'DEPTH').toUpperCase() === 'DEPTH') add('Info', l, 'Conduit ' + l.id + ' crown is above the rim of node ' + a.id);
        if (+l.p.length > 0 && (parseFloat(l.p.g1) || 0) > 0 && +l.p.length < 2 * parseFloat(l.p.g1)) add('Info', l, 'Conduit ' + l.id + ' is very short relative to its depth (may limit the time step)');
        if (l.from === l.to) add('Error', l, 'Conduit ' + l.id + ' starts and ends at the same node');
      }
      const orifices = [...m.links.values()].filter(l => l.type === 'ORIFICE').length;
      if (orifices && (m.options.FLOW_ROUTING || '').toUpperCase() === 'DYNWAVE') add('Info', null, orifices + ' orifice(s) in a dynamic-wave model: if the run reports high nonconvergence near them, use Tools > Convergence > Convert Orifices to Equivalent Conduits.');
      const tbl = h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'Severity'), h('th', null, 'Object'), h('th', null, 'Message'))));
      const tb = h('tbody'); tbl.appendChild(tb);
      for (const it of issues.slice(0, 20000)) tb.appendChild(h('tr', { style: { cursor: it.obj ? 'pointer' : 'default' }, onclick: () => { if (it.obj) { this.app.select(it.obj); this.app.activateView('map'); this.app.map.zoomToObjects([it.obj]); } } },
        h('td', { style: { color: it.sev === 'Error' ? 'var(--danger)' : it.sev === 'Warning' ? 'var(--warn)' : 'var(--muted)', fontWeight: 600 } }, it.sev), h('td', null, it.obj ? it.obj.id : ''), h('td', { style: { whiteSpace: 'normal', maxWidth: '900px' } }, it.msg)));
      const view = h('div', null, h('div', { class: 'grid-tools' }, h('b', null, 'Network Validation'), h('span', { class: 'badge' }, issues.filter(i => i.sev === 'Error').length + ' errors'), h('span', { class: 'badge' }, issues.filter(i => i.sev === 'Warning').length + ' warnings'), h('span', { class: 'badge' }, issues.filter(i => i.sev === 'Info').length + ' notes'),
        h('button', { class: 'btn small', onclick: () => this.validate() }, 'Re-check')), h('div', { class: 'grid-scroll' }, issues.length ? tbl : h('div', { class: 'empty' }, 'No problems found.')));
      this.app.closeView('validate'); this.app.addView('validate', 'Validation', view);
    }
    summary() {
      const m = this.m; let len = 0, area = 0; for (const l of m.links.values()) if (l.type === 'CONDUIT') len += +l.p.length || 0; for (const s of m.subcatchments.values()) area += +s.p.area || 0;
      const c = {}; for (const n of m.nodes.values()) c[n.type] = (c[n.type] || 0) + 1; for (const l of m.links.values()) c[l.type] = (c[l.type] || 0) + 1;
      AV.alert(['Nodes: ' + m.nodes.size + '  (' + Object.entries(c).filter(([k]) => AV.NODE_TYPES.includes(k)).map(([k, v]) => v + ' ' + k.toLowerCase()).join(', ') + ')',
        'Links: ' + m.links.size + '  (' + Object.entries(c).filter(([k]) => AV.LINK_TYPES.includes(k)).map(([k, v]) => v + ' ' + k.toLowerCase()).join(', ') + ')',
        'Total conduit length: ' + AV.fmt(len, 1) + ' ' + this.app.lengthUnits() + (m.isSI ? ' (' + AV.fmt(len / 1000, 2) + ' km)' : ' (' + AV.fmt(len / 5280, 2) + ' mi)'),
        'Subcatchments: ' + m.subcatchments.size + ', total area ' + AV.fmt(area, 2) + (m.isSI ? ' ha' : ' ac'),
        'Rain gages: ' + m.gages.size + ', time series: ' + m.timeseries.size + ', curves: ' + m.curves.size,
        'Routing: ' + (m.options.FLOW_ROUTING || 'KINWAVE') + ', flow units: ' + m.flowUnits + ', threads: ' + (m.options.THREADS || 1)].join('\n'), 'Model Summary');
    }

    // ------------------------------------------------------------------ GIS layers / import / export
    async loadLayer() { this.app.showRightTab('catalog'); return this.app.catalog.browse();
      const ps = await window.host.openDialog({ title: 'Load background layer', multi: true, filters: [{ name: 'Shapefile / GeoJSON', extensions: ['shp', 'geojson', 'json'] }] });
      if (!ps) return;
      for (const p of ps) {
        try {
          const L = await AV.SHP.load(p);
          const pal = ['#78909c', '#8d6e63', '#26a69a', '#ab47bc', '#ffa726'];
          Object.assign(L, { name: AV.basename(p), path: p, visible: true, stroke: pal[this.app.map.extLayers.length % pal.length], fill: 'rgba(120,144,156,.12)', width: 1, opacity: 1, order: 'below' });
          this.app.map.extLayers.push(L);
          this.app.status('Loaded layer ' + L.name + ' (' + L.features.length + ' features)');
        } catch (e) { AV.alert('Could not read ' + p + ':\n' + e.message); }
      }
      this.app.panels.refreshLayers(); if (!this.m.nodes.size) this.app.map.zoomAll(); else this.app.map.redraw();
    }
    async importNetwork(path) {
      const p = path || await window.host.openDialog({ title: 'Import GIS data into the network', filters: [{ name: 'Shapefile / GeoJSON', extensions: ['shp', 'geojson', 'json'] }] });
      if (!p) return;
      let L; try { L = AV.GDB.isGdbLayerPath(p) ? await AV.loadDataFile(this.app, p) : await AV.SHP.load(p); } catch (e) { AV.alert('Could not read file: ' + e.message); return; }
      if (!L.features.length) { AV.alert('The file has no features.'); return; }
      const F = ['(none)'].concat(L.fields);
      const guess = (...names) => L.fields.find(f => names.some(n => f.toLowerCase() === n)) || L.fields.find(f => names.some(n => f.toLowerCase().includes(n))) || '(none)';
      let fields, target;
      if (L.kind === 'point') {
        target = 'node';
        fields = [{ k: 'type', l: 'Import points as', t: 'choice', o: ['JUNCTION', 'OUTFALL', 'STORAGE', 'DIVIDER'], d: 'JUNCTION' }, { k: 'id', l: 'ID field', t: 'choice', o: F, d: guess('id', 'name', 'facilityid', 'mh_id') },
        { k: 'elev', l: 'Invert elevation field', t: 'choice', o: F, d: guess('invert', 'inv_elev', 'elev', 'ie') }, { k: 'rim', l: 'Rim / ground elevation field', t: 'choice', o: F, d: guess('rim', 'ground', 'grnd', 'top') },
        { k: 'depth', l: 'Max. depth field (if no rim)', t: 'choice', o: F, d: guess('depth', 'maxdepth') }, { k: 'tag', l: 'Tag field', t: 'choice', o: F, d: '(none)' }];
      } else if (L.kind === 'line') {
        target = 'link';
        fields = [{ k: 'id', l: 'ID field', t: 'choice', o: F, d: guess('id', 'name', 'facilityid', 'pipe_id') }, { k: 'from', l: 'From-node field', t: 'choice', o: F, d: guess('from', 'us_node', 'upstream', 'fromnode', 'node1') },
        { k: 'to', l: 'To-node field', t: 'choice', o: F, d: guess('to', 'ds_node', 'downstream', 'tonode', 'node2') }, { k: 'diam', l: 'Diameter / height field', t: 'choice', o: F, d: guess('diam', 'diameter', 'geom1', 'size', 'height') },
        { k: 'dscale', l: 'Diameter scale (e.g. 1/12 for inches -> ft)', t: 'text', d: '1' }, { k: 'rough', l: 'Roughness field', t: 'choice', o: F, d: guess('rough', 'manning', 'n') },
        { k: 'usinv', l: 'Upstream invert field', t: 'choice', o: F, d: guess('us_inv', 'upinv', 'inv_up', 'us_invert') }, { k: 'dsinv', l: 'Downstream invert field', t: 'choice', o: F, d: guess('ds_inv', 'dninv', 'inv_dn', 'ds_invert') },
        { k: 'tol', l: 'Endpoint snap tolerance (map units)', t: 'num', d: 1 }, { k: 'tag', l: 'Tag field', t: 'choice', o: F, d: '(none)' },
        { t: 'note', l: 'Without from/to fields, line endpoints are snapped to existing nodes within the tolerance; new junctions are created where no node is found. Conduit length = line length.' }];
      } else if (L.kind === 'polygon') {
        target = 'sub';
        fields = [{ k: 'id', l: 'ID field', t: 'choice', o: F, d: guess('id', 'name') }, { k: 'imperv', l: '% impervious field', t: 'choice', o: F, d: guess('imperv', 'pct_imp') },
        { k: 'width', l: 'Width field', t: 'choice', o: F, d: guess('width') }, { k: 'slope', l: '% slope field', t: 'choice', o: F, d: guess('slope') }, { k: 'outlet', l: 'Outlet field', t: 'choice', o: F, d: guess('outlet') },
        { t: 'note', l: 'Area is computed from the polygon and map units. Missing outlets can be assigned afterwards with Tools > Subcatchment > Batch Assign Outlet.' }];
      } else { AV.alert('Unsupported geometry type.'); return; }
      const r = await AV.formDialog('Import ' + L.features.length + ' ' + L.kind + ' feature(s) - ' + AV.basename(p), fields, {}, { width: 560 }); if (!r) return;
      const m = this.m; const val = (f, k) => r[k] && r[k] !== '(none)' ? f.props[r[k]] : undefined; const num = (v, d) => { const x = parseFloat(v); return isFinite(x) ? x : d; };
      const added = { nodes: [], links: [], subs: [] };
      const uniq = (id, pre) => { id = String(id === undefined || id === null || id === '' ? '' : id).trim().replace(/\s+/g, '_'); if (!id || m.idExists(id) || added.nodes.some(n => n.id === id) || added.links.some(l => l.id === id) || added.subs.some(s => s.id === id)) { let k = m.nextId(pre); while (added.nodes.concat(added.links, added.subs).some(o => o.id === k)) k = pre + (parseInt(k.slice(pre.length)) + 1); return k; } return id; };
      if (target === 'node') {
        for (const f of L.features) for (const c of f.coords) {
          const id = uniq(val(f, 'id'), this.app.prefixFor(r.type)); const n = { id, kind: 'NODE', type: r.type, p: AV.defaults(r.type), x: c[0], y: c[1], tag: val(f, 'tag') || '' };
          const inv = num(val(f, 'elev'), 0); n.p.elev = inv; const rim = num(val(f, 'rim'), null); const dep = num(val(f, 'depth'), null);
          if (r.type !== 'OUTFALL') n.p.maxDepth = rim !== null ? Math.max(0, rim - inv) : dep !== null ? dep : this.app.defaults.junctionDepth;
          added.nodes.push(n);
        }
      } else if (target === 'link') {
        const tmpNodes = new Map();
        const allNodes = () => [...m.nodes.values(), ...added.nodes];
        const grid = new Map(); const cell = Math.max(r.tol * 4, 1e-9); const key = (x, y) => Math.floor(x / cell) + ':' + Math.floor(y / cell);
        const index = (n) => { const k = key(n.x, n.y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); };
        allNodes().forEach(index);
        const snap = (x, y) => { let best = null, bd = r.tol; const i = Math.floor(x / cell), j = Math.floor(y / cell); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const n of grid.get((i + a) + ':' + (j + b)) || []) { const d = Math.hypot(n.x - x, n.y - y); if (d <= bd) { bd = d; best = n; } } return best; };
        for (const f of L.features) for (const part of f.coords) {
          if (part.length < 2) continue;
          const a = part[0], b = part[part.length - 1];
          let n1 = val(f, 'from') !== undefined ? (m.nodes.get(String(val(f, 'from'))) || added.nodes.find(n => n.id === String(val(f, 'from')))) : null;
          let n2 = val(f, 'to') !== undefined ? (m.nodes.get(String(val(f, 'to'))) || added.nodes.find(n => n.id === String(val(f, 'to')))) : null;
          if (!n1) n1 = snap(a[0], a[1]); if (!n2) n2 = snap(b[0], b[1]);
          const mk = (pt, nm) => { const id = uniq(nm, 'J'); const n = { id, kind: 'NODE', type: 'JUNCTION', p: AV.defaults('JUNCTION'), x: pt[0], y: pt[1], tag: '' }; n.p.maxDepth = this.app.defaults.junctionDepth; added.nodes.push(n); index(n); return n; };
          if (!n1) n1 = mk(a, val(f, 'from')); if (!n2) n2 = mk(b, val(f, 'to'));
          if (n1 === n2) continue;
          const id = uniq(val(f, 'id'), 'C');
          const l = { id, kind: 'LINK', type: 'CONDUIT', from: n1.id, to: n2.id, p: AV.defaults('CONDUIT'), verts: part.slice(1, -1), tag: val(f, 'tag') || '' };
          let len = 0; for (let i = 1; i < part.length; i++) len += Math.hypot(part[i][0] - part[i - 1][0], part[i][1] - part[i - 1][1]);
          l.p.length = +Math.max(len, 0.1).toFixed(3);
          const d = num(val(f, 'diam'), null); l.p.g1 = String(d !== null ? +(d * (Function('return ' + (/^[\d./\s]+$/.test(r.dscale) ? r.dscale : '1'))())).toFixed(4) : this.app.defaults.conduitDiameter);
          l.p.rough = num(val(f, 'rough'), this.app.defaults.conduitRough);
          const ui = num(val(f, 'usinv'), null), di = num(val(f, 'dsinv'), null);
          if (ui !== null && n1.p) { if (added.nodes.includes(n1) && (n1.p.elev === 0 || ui < n1.p.elev)) n1.p.elev = ui; l.p.inOff = +Math.max(0, ui - n1.p.elev).toFixed(3); }
          if (di !== null && n2.p) { if (added.nodes.includes(n2) && (n2.p.elev === 0 || di < n2.p.elev)) n2.p.elev = di; l.p.outOff = +Math.max(0, di - n2.p.elev).toFixed(3); }
          added.links.push(l);
        }
      } else {
        for (const f of L.features) {
          const ring = f.coords[0]; if (!ring || ring.length < 3) continue;
          const poly = ring.slice(0, ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? -1 : undefined);
          const id = uniq(val(f, 'id'), 'S'); const s = { id, kind: 'SUBCATCH', p: AV.defaults('SUBCATCH'), poly, tag: '' };
          s.p.area = +(this.areaFromPoly(poly) || 0).toFixed(4); s.p.imperv = num(val(f, 'imperv'), this.app.defaults.subImperv); s.p.width = num(val(f, 'width'), Math.sqrt(AV.polyArea(poly)) || this.app.defaults.subWidth);
          s.p.slope = num(val(f, 'slope'), this.app.defaults.subSlope); s.p.outlet = val(f, 'outlet') !== undefined ? String(val(f, 'outlet')) : '';
          const g = [...m.gages.keys()][0]; if (g) s.p.gage = g;
          added.subs.push(s);
        }
      }
      this.app.exec({
        label: 'Import ' + AV.basename(p),
        do: () => { added.nodes.forEach(n => m.nodes.set(n.id, n)); added.links.forEach(l => m.links.set(l.id, l)); added.subs.forEach(s => m.subcatchments.set(s.id, s)); },
        undo: () => { added.nodes.forEach(n => m.nodes.delete(n.id)); added.links.forEach(l => m.links.delete(l.id)); added.subs.forEach(s => m.subcatchments.delete(s.id)); },
      });
      this.app.showWelcome(false); this.app.map.zoomAll();
      AV.alert(`Imported ${added.nodes.length} node(s), ${added.links.length} link(s), ${added.subs.length} subcatchment(s).` + (L.prj ? '\n\nCoordinate system (.prj): ' + L.prj.slice(0, 160) + '...' : ''), 'Import');
    }
    networkFeatures(withResults) {
      const m = this.m; const R = withResults ? this.app.results : null;
      const res = (o, t, names) => { if (!R) return {}; const r = R.index(o); if (!r) return {}; const nv = R.meta.nVars[t]; const st = R.stats[t]; const out = {}; names.forEach(([v, key, abs]) => { if (v < nv) out[key] = (abs ? st.absmax : st.max)[r.i * nv + v]; }); return out; };
      const nodes = [...m.nodes.values()].map(n => ({ coords: [[n.x, n.y]], props: Object.assign({ ID: n.id, TYPE: n.type, INVERT: +n.p.elev, MAXDEPTH: +n.p.maxDepth || 0, RIM: +n.p.elev + (+n.p.maxDepth || 0), TAG: n.tag || '' }, res(n, 'node', [[0, 'MAX_DEPTH'], [1, 'MAX_HGL'], [4, 'MAX_INFLOW'], [5, 'MAX_FLOOD']]), R && R.nonconv ? { NONCONV: R.nonconv.get(n.id) || 0 } : {}) }));
      const links = [...m.links.values()].map(l => { const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) return null; return { coords: [[[a.x, a.y]].concat(l.verts).concat([[b.x, b.y]])], props: Object.assign({ ID: l.id, TYPE: l.type, FROM: l.from, TO: l.to, LENGTH: +l.p.length || 0, SHAPE: l.p.shape || '', GEOM1: parseFloat(l.p.g1) || 0, ROUGH: +l.p.rough || 0, INOFF: +l.p.inOff || 0, OUTOFF: +l.p.outOff || 0, TAG: l.tag || '' }, res(l, 'link', [[0, 'MAX_FLOW', true], [2, 'MAX_VEL', true], [4, 'MAX_DD']])) }; }).filter(Boolean);
      const subs = [...m.subcatchments.values()].filter(s => s.poly.length > 2).map(s => ({ coords: [s.poly.concat([s.poly[0]])], props: Object.assign({ ID: s.id, GAGE: s.p.gage, OUTLET: s.p.outlet, AREA: +s.p.area, IMPERV: +s.p.imperv, WIDTH: +s.p.width, SLOPE: +s.p.slope, TAG: s.tag || '' }, res(s, 'subcatch', [[4, 'MAX_RUNOFF']])) }));
      return { nodes, links, subs };
    }
    async exportShapefiles(withResults) {
      if (withResults && !this.app.results) { AV.alert('Run a simulation first.'); return; }
      const base = await window.host.saveDialog({ title: 'Export shapefiles (base name)', defaultPath: (this.app.filePath ? AV.basename(this.app.filePath).replace(/\.inp$/i, '') : 'network'), filters: [{ name: 'Shapefile', extensions: ['shp'] }] });
      if (!base) return;
      const b = base.replace(/\.shp$/i, ''); const F = this.networkFeatures(withResults);
      const out = [];
      for (const [suffix, kind, feats] of [['_nodes', 'point', F.nodes], ['_links', 'line', F.links], ['_subcatchments', 'polygon', F.subs]]) {
        if (!feats.length) continue;
        const keys = Object.keys(feats.reduce((a, f) => Object.assign(a, f.props), {}));
        const fields = AV.SHP.fieldsFor(feats.map(f => f.props), keys);
        const w = AV.SHP.write(kind, feats, fields);
        await window.host.writeBinary(b + suffix + '.shp', new Uint8Array(w.shp)); await window.host.writeBinary(b + suffix + '.shx', new Uint8Array(w.shx)); await window.host.writeBinary(b + suffix + '.dbf', new Uint8Array(w.dbf));
        out.push(AV.basename(b + suffix + '.shp'));
      }
      AV.alert('Exported:\n' + out.join('\n') + '\n\nCoordinates are written in the model\'s map coordinates (no .prj file).', 'Export Shapefiles');
    }
    async exportGeoJSON() {
      const F = this.networkFeatures(!!this.app.results);
      const g = (kind, f) => ({ type: 'Feature', geometry: kind === 'point' ? { type: 'Point', coordinates: f.coords[0] } : kind === 'line' ? { type: 'LineString', coordinates: f.coords[0] } : { type: 'Polygon', coordinates: f.coords }, properties: f.props });
      const fc = { type: 'FeatureCollection', features: F.subs.map(f => g('polygon', f)).concat(F.links.map(f => g('line', f)), F.nodes.map(f => g('point', f))) };
      AV.downloadText(JSON.stringify(fc), (this.app.filePath ? AV.basename(this.app.filePath).replace(/\.inp$/i, '') : 'network') + '.geojson', [{ name: 'GeoJSON', extensions: ['geojson'] }]);
    }
    async exportCSVTables() {
      const base = await window.host.saveDialog({ title: 'Export tables (base name)', defaultPath: 'network.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] }); if (!base) return;
      const b = base.replace(/\.csv$/i, ''); const out = [];
      for (const t of ['JUNCTION', 'OUTFALL', 'STORAGE', 'DIVIDER', 'CONDUIT', 'PUMP', 'ORIFICE', 'WEIR', 'OUTLET', 'SUBCATCH', 'GAGE']) {
        const rows = AV.tableRows(this.app, t); if (!rows.objs.length) continue;
        const lines = [rows.cols.map(c => AV.csvCell(c.l)).join(',')].concat(rows.objs.map(o => rows.cols.map(c => AV.csvCell(c.get(o))).join(',')));
        const p = b + '_' + t.toLowerCase() + '.csv'; await window.host.writeText(p, lines.join('\n')); out.push(AV.basename(p));
      }
      AV.alert('Exported:\n' + out.join('\n'), 'Export Tables');
    }
  }
  AV.Tools = Tools;
})(window.AV);
