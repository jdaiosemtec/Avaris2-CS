// Avaris2 CS features: map-synced floating tools, groups, scenarios, summary, converters, editing helpers
'use strict';
(function (AV) {
  const h = AV.h;
  const kindToType = (k) => k === 'NODE' ? 'node' : k === 'LINK' ? 'link' : k === 'SUBCATCH' ? 'subcatch' : null;

  // ------------------------------------------------------------------ floating windows (modeless, map stays usable)
  const panels = new Map();
  let zTop = 1500, cascade = 0;
  AV.closeFloatPanel = (id) => { const p = panels.get(id); if (p) p.close(); };
  AV.floatPanel = function (opts) {
    if (opts.id && panels.has(opts.id)) { const p = panels.get(opts.id); p.restore(); p.focus(); return p; }
    const W = opts.w || 560, H = opts.h || 420;
    const area = AV.$('#views').getBoundingClientRect();
    const x = opts.x !== undefined ? opts.x : Math.max(10, area.right - W - 16 - (cascade % 5) * 24), y = opts.y !== undefined ? opts.y : area.top + 12 + (cascade % 5) * 24; cascade++;
    const title = h('span', { class: 'ft' }, opts.title || '');
    const body = h('div', { class: 'fb' });
    const el = h('div', { class: 'fpanel', style: { left: x + 'px', top: y + 'px', width: W + 'px', height: H + 'px', zIndex: ++zTop } },
      h('div', { class: 'fh' }, title, opts.minimize ? h('button', { class: 'fmin', title: 'Minimize', onclick: () => api.toggleMin() }, '–') : null, opts.dock ? h('button', { title: 'Open as a tab', onclick: () => { api.close(true); opts.dock(); } }, '❐') : null, h('button', { title: 'Close', onclick: () => api.close() }, '×')), body);
    if (opts.body) body.appendChild(opts.body);
    document.body.appendChild(el);
    const head = el.querySelector('.fh');
    head.addEventListener('dblclick', (e) => { if (opts.minimize && e.target.tagName !== 'BUTTON') api.toggleMin(); });
    head.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return; api.focus();
      const r = el.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = (ev) => { el.style.left = Math.max(0, ev.clientX - ox) + 'px'; el.style.top = Math.max(0, ev.clientY - oy) + 'px'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    el.addEventListener('mousedown', () => api.focus());
    const ro = new ResizeObserver(() => { if (api.onResize) api.onResize(); }); ro.observe(body);
    const api = {
      el, body, setTitle: (t) => title.textContent = t,
      focus: () => { el.style.zIndex = ++zTop; },
      // minimize: only the title bar stays (what the panel shows on the map stays on); click – / the title bar to restore
      minimized: false,
      toggleMin: () => { if (api.minimized) return api.restore(); api._h = el.style.height; api._w = el.style.width; api.minimized = true; el.classList.add('min'); el.style.height = ''; el.style.width = Math.min(360, el.getBoundingClientRect().width) + 'px';
        const b = el.querySelector('.fmin'); if (b) { b.textContent = '▢'; b.title = 'Restore'; } if (opts.onMinimize) opts.onMinimize(true); },
      restore: () => { if (!api.minimized) return; api.minimized = false; el.classList.remove('min'); el.style.height = api._h; el.style.width = api._w;
        const b = el.querySelector('.fmin'); if (b) { b.textContent = '–'; b.title = 'Minimize'; } if (opts.onMinimize) opts.onMinimize(false); },
      close: (silent) => { ro.disconnect(); el.remove(); if (opts.id) panels.delete(opts.id); if (opts.onClose) opts.onClose(silent); },
    };
    if (opts.id) panels.set(opts.id, api);
    return api;
  };

  class Features {
    constructor(app) {
      this.app = app; this.logLines = [];
      app.on('selection', (sel) => { for (const g of this.graphs || []) g.onSelection(sel); });
      // a 2D cell clicked on the map: graphs that follow the selection show the cell
      app.on('cellselect', (k) => { if (!app.mesh2d || !app.mesh2d.cells[k]) return; for (const g of this.graphs || []) g.onSelection([AV.cellNode(app, k)]); });
    }
    get m() { return this.app.model; }

    // ================================================================ log window
    log(msg) {
      if (!msg || msg === this._last) return; this._last = msg;
      const t = new Date(); const line = t.toTimeString().slice(0, 8) + '  ' + msg;
      this.logLines.push(line); if (this.logLines.length > 2000) this.logLines.shift();
      if (this.logEl) { this.logEl.textContent += line + '\n'; this.logEl.scrollTop = 1e9; }
    }
    logWindow() {
      const pre = h('div', { class: 'loglines' }, this.logLines.join('\n') + '\n');
      this.logEl = pre;
      const p = AV.floatPanel({ id: 'log', title: 'Log Window', w: 560, h: 300, body: h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h('div', { class: 'followbar' }, h('button', { class: 'btn small', onclick: () => { this.logLines = []; pre.textContent = ''; } }, 'Clear'), h('button', { class: 'btn small', onclick: () => AV.downloadText(this.logLines.join('\r\n'), 'osemcm_log.txt', [{ name: 'Text', extensions: ['txt'] }]) }, 'Save...'), h('button', { class: 'btn small primary', title: 'Every recorded change to this model, with the user who made it', onclick: () => this.app.hist.openWindow() }, 'Full Change History...')), pre),
        onClose: () => { this.logEl = null; } });
      pre.scrollTop = 1e9; return p;
    }
    notAvailable(name, what) {
      AV.alert(name + ' is not available in this version of Avaris2 CS.\n\nAvaris2 CS currently runs 1D network simulations. ' + what.charAt(0).toUpperCase() + what.slice(1) + ' will be added in a later release; until then use Avaris DS for this step.', name);
    }

    // ================================================================ picking helper
    startPick(opts) {
      const app = this.app, map = app.map;
      if (this.pickEnd) { const f = this.pickEnd; this.pickEnd = null; f(); }
      app.setTool('pick');
      map.pickKinds = opts.kinds || null; map.pickHint = opts.hint;
      map.setHint(opts.hint);
      map.onPick = (hit, wx, wy, e) => opts.onPick(hit, wx, wy, e);
      this.pickEnd = opts.onEnd || null;
      map.onPickEnd = () => { const f = this.pickEnd; this.pickEnd = null; if (f) f(); };
    }
    endPick() { if (this.app.map.mode === 'pick') this.app.setTool('select'); }

    // ================================================================ connectivity tools (map-synced)
    traceTool(dir) {
      const app = this.app;
      const run = (objs) => { app.selectMany(objs); app.tools.trace(dir); };
      const sel = [...app.selection].filter(o => o.kind === 'NODE' || o.kind === 'LINK');
      if (sel.length) run(sel);
      this.startPick({ kinds: ['NODE', 'LINK'], hint: 'Trace ' + (dir === 'up' ? 'upstream' : 'downstream') + ': click a node or link on the map (Esc to finish).', onPick: (hit) => { if (hit) run([hit]); } });
    }
    pathTool() {
      const app = this.app; let armed = 'from';
      const fromI = h('input', { type: 'text', placeholder: 'click a node on the map' }), toI = h('input', { type: 'text', placeholder: 'then click the end node' });
      const directed = h('input', { type: 'checkbox', checked: true });
      const info = h('div', { class: 'note', style: { padding: '6px 10px', color: 'var(--muted)', lineHeight: 1.5 } });
      const arm = (w) => { armed = w; fromI.classList.toggle('armed', w === 'from'); toI.classList.toggle('armed', w === 'to'); };
      const find = () => {
        const a = fromI.value.trim(), b = toI.value.trim(); if (!a || !b) return;
        const p = AV.findPath(this.m, a, b, directed.checked);
        if (!p) { info.textContent = 'No ' + (directed.checked ? 'downstream ' : '') + 'path from ' + a + ' to ' + b + '.'; app.map.highlight = new Set(); app.map.redrawOverlay(); return; }
        const objs = p.nodes.map(id => this.m.nodes.get(id)).concat(p.links.map(x => x.link));
        app.map.highlight = new Set(objs); app.selectMany(objs);
        const len = p.links.reduce((s, x) => s + (+x.link.p.length || 0), 0);
        info.textContent = p.nodes.length + ' nodes, ' + p.links.length + ' links, length ' + AV.fmt(len, 1) + ' ' + app.lengthUnits() + '.';
        this.lastPath = [a, b];
      };
      fromI.addEventListener('focus', () => arm('from')); toI.addEventListener('focus', () => arm('to'));
      fromI.addEventListener('change', find); toI.addEventListener('change', find);
      const pick = () => this.startPick({ kinds: ['NODE'], hint: 'Path: click the start node, then the end node.', onPick: (hit) => {
        if (!hit) return;
        if (armed === 'from') { fromI.value = hit.id; arm('to'); toI.value = ''; app.map.highlight = new Set([hit]); app.map.redrawOverlay(); }
        else { toI.value = hit.id; arm('from'); find(); }
      } });
      const body = h('div', { style: { padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('div', { class: 'form' }, h('label', null, 'From node'), h('div', { class: 'pickfield' }, fromI, h('button', { class: 'btn small', title: 'Pick on map', onclick: () => { arm('from'); pick(); } }, '⌖')),
          h('label', null, 'To node'), h('div', { class: 'pickfield' }, toI, h('button', { class: 'btn small', title: 'Pick on map', onclick: () => { arm('to'); pick(); } }, '⌖')),
          h('label', null, 'Follow flow direction'), directed),
        h('div', { style: { display: 'flex', gap: '6px' } }, h('button', { class: 'btn primary', onclick: find }, 'Find Path'), h('button', { class: 'btn', onclick: () => { const t = fromI.value; fromI.value = toI.value; toI.value = t; find(); } }, 'Swap'),
          h('button', { class: 'btn', onclick: () => { if (fromI.value && toI.value) this.profileTool(fromI.value.trim(), toI.value.trim()); } }, 'Profile'), h('button', { class: 'btn', onclick: () => { app.tools.clearTrace(); fromI.value = toI.value = ''; arm('from'); info.textContent = ''; } }, 'Clear')), info);
      const sel = [...app.selection].filter(o => o.kind === 'NODE');
      if (sel[0]) { fromI.value = sel[0].id; arm('to'); } else arm('from');
      if (sel[1]) { toI.value = sel[1].id; find(); }
      AV.floatPanel({ id: 'path', title: 'Path', w: 380, h: 250, body, onClose: () => this.endPick() });
      pick();
    }

    // ================================================================ editing helpers
    insertVertex(l, wx, wy) {
      const m = this.m; const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) return;
      const pts = [[a.x, a.y]].concat(l.verts).concat([[b.x, b.y]]);
      let best = 0, bd = Infinity; for (let i = 1; i < pts.length; i++) { const d = AV.distSeg(wx, wy, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); if (d < bd) { bd = d; best = i - 1; } }
      const old = l.verts.map(v => v.slice()); const nw = old.slice(); nw.splice(best, 0, [wx, wy]);
      this.app.exec({ label: 'Add vertex', light: true, do: () => l.verts = nw.map(v => v.slice()), undo: () => l.verts = old.map(v => v.slice()) });
    }
    removeVertex(l, i) {
      const old = l.verts.map(v => v.slice()); const nw = old.filter((_, k) => k !== i);
      this.app.exec({ label: 'Remove vertex', light: true, do: () => l.verts = nw.map(v => v.slice()), undo: () => l.verts = old.map(v => v.slice()) });
    }
    splitMode() {
      const sel = [...this.app.selection];
      if (sel.length === 1 && sel[0].kind === 'SUBCATCH') { this.subSplitStart(sel[0]); return; }
      const map = this.app.map;
      this.startPick({ kinds: ['LINK'], hint: 'Split: click on a conduit where the new junction should go (triangle cursor on a conduit; Esc to finish).', onPick: (hit, wx, wy) => { if (hit) this.splitLink(hit, wx, wy); },
        onEnd: () => { map.pickSplit = false; map.splitCur = null; map.canvas.style.cursor = ''; map.redrawOverlay(); } });
      map.pickSplit = true; map.splitCur = null; map.canvas.style.cursor = 'default';
    }
    // ================================================================ split a subcatchment polygon with a cut line
    subSplitStart(sc) {
      let P = sc.poly.map(p => p.slice()); if (P.length > 3 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P.pop();
      if (P.length < 3) { AV.toast('Subcatchment ' + sc.id + ' has no polygon to split.', true); return; }
      this.ss = { sc, P }; this.app.setTool('splitsub'); this.app.map.temp = { kind: 'ssplit', pts: [], startPos: null, snap: null, cursor: null };
    }
    _ssSnap(sx, sy) {
      const map = this.app.map, P = this.ss.P, n = P.length; let best = null;
      for (let k = 0; k < n; k++) { const [ax, ay] = map.toScreen(P[k][0], P[k][1]), [bx, by] = map.toScreen(P[(k + 1) % n][0], P[(k + 1) % n][1]);
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let t = L2 ? ((sx - ax) * dx + (sy - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
        const vd = Math.min(Math.hypot(sx - ax, sy - ay), Math.hypot(sx - bx, sy - by)); if (vd <= 8) t = Math.hypot(sx - ax, sy - ay) <= Math.hypot(sx - bx, sy - by) ? 0 : 1; // prefer corners
        const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(sx - px, sy - py);
        if (d <= 8 && (!best || d < best.d - 1e-9)) { const a = P[k], b = P[(k + 1) % n]; best = { d, pos: t >= 1 ? (k + 1) % n : k + t, pt: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] }; } }
      return best;
    }
    // square cursor on / inside the subcatchment being split, the normal pointer outside it
    subSplitMove(sx, sy) { const map = this.app.map, t = map.temp; if (!t || !this.ss) return; t.mouse = [sx, sy]; t.snap = this._ssSnap(sx, sy);
      const [wx, wy] = map.toWorld(sx, sy); const on = !!t.snap || AV.pointInPoly(wx, wy, this.ss.P);
      t.cursor = on ? [sx, sy] : null; map.canvas.style.cursor = on ? 'none' : 'default'; }
    subSplitClick(sx, sy, wx, wy) {
      const t = this.app.map.temp; if (!t || !this.ss) return; const snap = this._ssSnap(sx, sy);
      if (!t.pts.length) { if (!snap) { AV.toast('Start the cut on the subcatchment boundary (square cursor).', true); return; } t.pts.push(snap.pt); t.startPos = snap.pos; this.app.map.redrawOverlay(); return; }
      if (snap) { if (Math.abs(snap.pos - t.startPos) < 1e-9) return; this.subSplitFinish(t.pts.slice(1), t.pts[0], t.startPos, snap.pt, snap.pos); return; }
      if (!AV.pointInPoly(wx, wy, this.ss.P)) { AV.toast('Cut points must lie inside the subcatchment.', true); return; }
      t.pts.push([wx, wy]); this.app.map.redrawOverlay();
    }
    subSplitFinish(mid, S, posS, E, posE) {
      const app = this.app, m = this.m, { sc, P } = this.ss, n = P.length;
      const walk = (a, b) => { const fa = Math.floor(a), fb = Math.floor(b); if (fa === fb && b > a) return []; const out = []; let k = (fa + 1) % n; for (let g = 0; g <= n; g++) { out.push(P[k].slice()); if (k === fb) break; k = (k + 1) % n; } return out; };
      const A = [S, ...mid, E, ...walk(posE, posS)], B = [E, ...mid.slice().reverse(), S, ...walk(posS, posE)];
      const area = (Q) => { let a = 0; for (let i = 0; i < Q.length; i++) { const p = Q[i], q = Q[(i + 1) % Q.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };
      const aA = area(A), aB = area(B), tot = aA + aB;
      if (!(aA > tot * 1e-6) || !(aB > tot * 1e-6)) { AV.toast('The cut does not divide the subcatchment into two parts.', true); return; }
      const [keep, other, fk] = aA >= aB ? [A, B, aA / tot] : [B, A, aB / tot];
      let id = sc.id + '_1', k = 1; while (m.idExists(id)) id = sc.id + '_' + (++k);
      const ns = { id, kind: 'SUBCATCH', p: JSON.parse(JSON.stringify(sc.p)), poly: other, tag: sc.tag || '' }; if (sc.desc) ns.desc = sc.desc;
      const r4 = (x) => +x.toPrecision(8); const area0 = +sc.p.area || 0, width0 = +sc.p.width || 0;
      ns.p.area = r4(area0 * (1 - fk)); ns.p.width = r4(width0 * (1 - fk));
      const oldPoly = sc.poly.map(p => p.slice()), oldArea = sc.p.area, oldWidth = sc.p.width, newPoly = keep, newArea = r4(area0 * fk), newWidth = r4(width0 * fk);
      // data rows that describe the subcatchment (land use, buildup, groundwater, patterns) are copied to the new part
      const COPY = [['COVERAGES', 0], ['LOADINGS', 0], ['GROUNDWATER', 0], ['GWF', 0], ['ADJUSTMENTS', 1]]; const oldRaw = {}, newRaw = {};
      for (const [sec, col] of COPY) { const rows = m.raw[sec]; if (!rows) continue; const add = [];
        for (const l of rows) { const tl = l.trim(); if (!tl || tl[0] === ';') continue; const t = AV.tokenize(l); if (t[col] === sc.id) { t[col] = id; add.push(t.map((x, j) => j === t.length - 1 ? x : x.padEnd(j === 0 ? 17 : 11)).join('')); } }
        if (add.length) { oldRaw[sec] = rows.slice(); newRaw[sec] = rows.concat(add); } }
      app.exec({ label: 'Split subcatchment ' + sc.id,
        do: () => { sc.poly = newPoly.map(p => p.slice()); sc.p.area = newArea; sc.p.width = newWidth; m.subcatchments.set(id, ns); for (const s in newRaw) m.raw[s] = newRaw[s].slice(); },
        undo: () => { sc.poly = oldPoly.map(p => p.slice()); sc.p.area = oldArea; sc.p.width = oldWidth; m.subcatchments.delete(id); for (const s in oldRaw) m.raw[s] = oldRaw[s].slice(); },
        changes: [{ o: sc, key: 'area', old: oldArea, nw: newArea }, { o: ns, key: '_created', old: '', nw: '' }] });
      this.ss = null; app.setTool('select'); app.selectMany([sc, ns]);
      AV.toast(sc.id + ' split into ' + sc.id + ' (' + Math.round(fk * 100) + '%) and ' + id + ' (' + Math.round((1 - fk) * 100) + '%). Area and width were divided in proportion to the polygon areas; other properties were copied.', false, 7000);
    }
    splitLink(l, wx, wy) {
      const m = this.m, app = this.app;
      if (l.type !== 'CONDUIT') { AV.toast('Only conduits can be split.', true); return; }
      const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) return;
      const pts = [[a.x, a.y]].concat(l.verts).concat([[b.x, b.y]]);
      let seg = 0, bd = Infinity, bt = 0;
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i]; const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
        let t = L2 ? ((wx - x1) * dx + (wy - y1) * dy) / L2 : 0; t = Math.max(0.02, Math.min(0.98, t));
        const d = Math.hypot(wx - (x1 + t * dx), wy - (y1 + t * dy)); if (d < bd) { bd = d; seg = i; bt = t; }
      }
      const P = [pts[seg - 1][0] + bt * (pts[seg][0] - pts[seg - 1][0]), pts[seg - 1][1] + bt * (pts[seg][1] - pts[seg - 1][1])];
      let Ltot = 0, Lcut = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (i < seg) Lcut += d; if (i === seg) Lcut += d * bt; Ltot += d; }
      const f = Ltot > 0 ? Lcut / Ltot : 0.5;
      const elevOff = (m.options.LINK_OFFSETS || 'DEPTH').toUpperCase() === 'ELEVATION';
      const z1 = elevOff ? +l.p.inOff : +a.p.elev + +l.p.inOff, z2 = elevOff ? +l.p.outOff : +b.p.elev + +l.p.outOff;
      const r1 = +a.p.elev + (+a.p.maxDepth || 0), r2 = b.type === 'OUTFALL' ? null : +b.p.elev + (+b.p.maxDepth || 0);
      const zj = z1 + (z2 - z1) * f; const rim = r2 === null ? r1 + (zj - z1) : r1 + (r2 - r1) * f;
      const nid = m.nextId('J'); const n = { id: nid, kind: 'NODE', type: 'JUNCTION', p: AV.defaults('JUNCTION'), x: P[0], y: P[1], tag: '' };
      n.p.elev = +zj.toFixed(4); n.p.maxDepth = +Math.max(0, rim - zj).toFixed(4);
      const cid = m.nextId('C'); const l2 = JSON.parse(JSON.stringify(l)); l2.id = cid; l2.from = nid; delete l2.xt;
      const oldP = Object.assign({}, l.p), oldTo = l.to, oldVerts = l.verts.map(v => v.slice());
      const v1 = pts.slice(1, seg).map(v => v.slice()), v2 = pts.slice(seg, pts.length - 1).map(v => v.slice());
      const L = +l.p.length || Ltot;
      l2.verts = v2; l2.p.length = +(L * (1 - f)).toFixed(3); l2.p.inOff = elevOff ? +zj.toFixed(4) : 0;
      app.exec({
        label: 'Split ' + l.id,
        do: () => { m.nodes.set(nid, n); m.links.set(cid, l2); l.to = nid; l.verts = v1.map(v => v.slice()); l.p.length = +(L * f).toFixed(3); l.p.outOff = elevOff ? +zj.toFixed(4) : 0; },
        undo: () => { m.nodes.delete(nid); m.links.delete(cid); l.to = oldTo; l.verts = oldVerts.map(v => v.slice()); l.p = Object.assign({}, oldP); },
      });
      app.select(n); AV.toast(l.id + ' split at new junction ' + nid + ' (' + cid + ' created).');
    }
    // Merge: two or more adjacent subcatchments become one ("Merge To" picks the one that is kept).
    // With a junction selected instead, the two conduits meeting there are merged.
    merge() {
      const app = this.app; const subs = [...app.selection].filter(o => o.kind === 'SUBCATCH');
      if (subs.length >= 2) { this.endPick(); return this.mergeSubcatchments(subs); }
      if (!subs.length && [...app.selection].some(o => o.kind === 'NODE')) return this.mergeConduits();
      // pick mode: click the subcatchments to merge, then press Merge again
      this.startPick({ kinds: ['SUBCATCH'], hint: 'Merge: click the subcatchments to merge (click again to drop one), then click Merge again. Esc to cancel.', onPick: (hit) => {
        if (!hit) return; app.select(hit, true);
        const n = [...app.selection].filter(o => o.kind === 'SUBCATCH').length;
        app.map.setHint(n >= 2 ? n + ' subcatchments chosen - click Merge again to merge them (Esc to cancel).' : 'Merge: click the next subcatchment.');
      } });
      if (subs.length === 1) app.map.setHint('Merge: click the subcatchment(s) to merge with ' + subs[0].id + ', then click Merge again.');
    }
    async mergeSubcatchments(subs) {
      const app = this.app, m = this.m;
      const poly = AV.unionPolygons(subs.map(s => s.poly));
      if (!poly) { AV.alert('These subcatchments do not form one connected area (they must share boundaries).', 'Merge'); return; }
      const byArea = subs.slice().sort((a, b) => (+b.p.area || 0) - (+a.p.area || 0));
      const r = await AV.formDialog('Merge To', [{ k: 'to', l: 'Merge to', t: 'choice', o: subs.map(s => s.id) },
        { t: 'note', l: subs.length + ' subcatchments become one. Area, width and curb length are summed; % impervious, % slope and roughness/storage values are area-weighted; outlet, rain gage and other settings come from the subcatchment merged to.' }], { to: byArea[0].id }, { okLabel: 'OK', width: 440 });
      if (!r) return;
      const T = m.subcatchments.get(r.to); const others = subs.filter(s => s !== T);
      const A = subs.map(s => +s.p.area || 0), At = A.reduce((a, b) => a + b, 0) || 1;
      const wavg = (k) => { let v = 0; subs.forEach((s, i) => v += (+s.p[k] || 0) * A[i]); return +(v / At).toPrecision(6); };
      const oldT = { p: Object.assign({}, T.p), poly: T.poly.map(v => v.slice()) };
      const nwP = Object.assign({}, T.p, { area: +At.toPrecision(8), width: +subs.reduce((a, s) => a + (+s.p.width || 0), 0).toPrecision(8), curbLen: +subs.reduce((a, s) => a + (+s.p.curbLen || 0), 0).toPrecision(8) });
      for (const k of ['imperv', 'slope', 'nImp', 'nPerv', 'sImp', 'sPerv', 'pctZero']) if (k in T.p) nwP[k] = wavg(k);
      const mapArea = app.tools.areaFromPoly(poly); if (mapArea && (m.mapInfo.units || 'None').toUpperCase() !== 'NONE') nwP.area = +mapArea.toFixed(4);
      const removed = new Set(others.map(s => s.id));
      const redirect = [...m.subcatchments.values()].filter(s => !removed.has(s.id) && removed.has(s.p.outlet)).map(s => [s, s.p.outlet]);
      const changes = [{ o: T, key: 'poly', old: oldT.poly, nw: poly }].concat(Object.keys(nwP).filter(k => String(nwP[k]) !== String(oldT.p[k])).map(k => ({ o: T, key: k, old: oldT.p[k], nw: nwP[k] })))
        .concat(others.map(o => ({ o, key: '_deleted', old: '', nw: '' }))).concat(redirect.map(([s, o]) => ({ o: s, key: 'outlet', old: o, nw: T.id })));
      app.exec({
        label: 'Merge ' + subs.length + ' subcatchments into ' + T.id, changes,
        do: () => { T.p = Object.assign({}, nwP); T.poly = poly.map(v => v.slice()); for (const o of others) m.subcatchments.delete(o.id); for (const [s] of redirect) s.p.outlet = T.id; },
        undo: () => { T.p = Object.assign({}, oldT.p); T.poly = oldT.poly.map(v => v.slice()); for (const o of others) m.subcatchments.set(o.id, o); for (const [s, o] of redirect) s.p.outlet = o; },
      });
      app.map.grid = null; app.select(T);
      AV.toast(subs.length + ' subcatchments merged into ' + T.id + ' (area ' + AV.fmt(T.p.area, 3) + ').');
    }
    mergeConduits() {
      const app = this.app, m = this.m;
      const n = [...app.selection].find(o => o.kind === 'NODE');
      if (!n) { AV.toast('Select the junction between the two conduits to merge.', true); return; }
      const adj = m.adjacency(); const ins = adj.inn.get(n.id) || [], outs = adj.out.get(n.id) || [];
      if (n.type !== 'JUNCTION' || ins.length !== 1 || outs.length !== 1 || ins[0].type !== 'CONDUIT' || outs[0].type !== 'CONDUIT') { AV.alert('Merge needs a junction with exactly one incoming and one outgoing conduit.'); return; }
      const a = ins[0], b = outs[0];
      const oldA = { to: a.to, verts: a.verts.map(v => v.slice()), p: Object.assign({}, a.p) };
      const subs = [...m.subcatchments.values()].filter(s => s.p.outlet === n.id);
      app.exec({
        label: 'Merge ' + a.id + ' + ' + b.id,
        do: () => { a.to = b.to; a.verts = oldA.verts.concat([[n.x, n.y]]).concat(b.verts.map(v => v.slice())); a.p.length = +((+oldA.p.length || 0) + (+b.p.length || 0)).toFixed(3); a.p.outOff = b.p.outOff; m.links.delete(b.id); m.nodes.delete(n.id); subs.forEach(s => s.p.outlet = a.to); },
        undo: () => { m.nodes.set(n.id, n); m.links.set(b.id, b); a.to = oldA.to; a.verts = oldA.verts.map(v => v.slice()); a.p = Object.assign({}, oldA.p); subs.forEach(s => s.p.outlet = n.id); },
      });
      app.select(a); AV.toast('Merged into ' + a.id + (subs.length ? '; ' + subs.length + ' subcatchment outlet(s) moved to ' + a.to : '') + '.');
    }
    // Assign: give subcatchments their runoff target. Click a subcatchment (or use the selected ones), then the
    // junction / subcatchment it drains to. Stays active for the next subcatchment until Esc.
    assignMode() {
      const app = this.app, map = app.map;
      let subs = [...app.selection].filter(o => o.kind === 'SUBCATCH');
      const show = () => { map.assignSubs = new Set(subs); map.redrawOverlay(); };
      const hint = () => map.setHint(subs.length ? 'Assign: click the junction (or subcatchment) that ' + (subs.length === 1 ? subs[0].id + ' drains' : 'the ' + subs.length + ' selected subcatchments drain') + ' to.' : 'Assign: click a subcatchment, then the junction it drains to (Esc to finish).');
      this.startPick({ kinds: ['NODE', 'SUBCATCH'], hint: '', onEnd: () => { map.assignSubs = null; map.redrawOverlay(); }, onPick: (hit, wx, wy, e) => {
        if (!hit) return;
        if (hit.kind === 'SUBCATCH' && (!subs.length || e.ctrlKey || subs.includes(hit))) {
          if (e.ctrlKey) { subs = subs.includes(hit) ? subs.filter(s => s !== hit) : subs.concat([hit]); } else subs = [hit];
          app.selectMany(subs); show(); hint(); return;
        }
        if (!subs.length) return;
        const targets = subs.filter(s => s !== hit); if (!targets.length) return;
        const olds = targets.map(s => s.p.outlet);
        app.exec({ label: 'Assign outlet ' + hit.id, changes: targets.map((s, i) => ({ o: s, key: 'outlet', old: olds[i], nw: hit.id })),
          do: () => targets.forEach(s => s.p.outlet = hit.id), undo: () => targets.forEach((s, i) => s.p.outlet = olds[i]) });
        AV.toast(targets.map(s => s.id).join(', ') + ' now drain' + (targets.length === 1 ? 's' : '') + ' to ' + hit.id + '.');
        app.selectMany(targets); subs = []; show(); hint();
      } });
      show(); hint();
    }
    async convertType() {
      const app = this.app, m = this.m; const sel = [...app.selection].filter(o => o.kind === 'NODE' || o.kind === 'LINK');
      if (!sel.length) { AV.toast('Select nodes or links to convert.', true); return; }
      const isNode = sel[0].kind === 'NODE'; const objs = sel.filter(o => o.kind === sel[0].kind);
      const types = isNode ? AV.NODE_TYPES : AV.LINK_TYPES;
      const r = await AV.formDialog('Convert ' + objs.length + ' ' + (isNode ? 'node(s)' : 'link(s)'), [{ k: 'to', l: 'Convert to', t: 'choice', o: types },
        { t: 'note', l: isNode ? 'Invert elevation and depth are kept; other properties get defaults.' : 'Cross-section and offset are kept where the new type uses them. For orifices -> conduits with loss coefficients, use Tools > Orifice to Conduit.' }], { to: types[0] });
      if (!r) return;
      const deg = new Map(); for (const l of m.links.values()) { deg.set(l.from, (deg.get(l.from) || 0) + 1); deg.set(l.to, (deg.get(l.to) || 0) + 1); }
      app.tools.bulk('Convert to ' + r.to, objs, () => {
        for (const o of objs) {
          if (o.type === r.to) continue;
          const old = o.p; o.type = r.to; o.p = AV.defaults(r.to); delete o.xt;
          if (isNode) { o.p.elev = old.elev; if ('maxDepth' in o.p && old.maxDepth !== undefined) o.p.maxDepth = old.maxDepth; }
          else {
            for (const k of ['shape', 'g1', 'g2', 'g3', 'g4']) if (k in o.p && old[k] !== undefined) o.p[k] = old[k];
            if (r.to === 'CONDUIT') { o.p.length = +m.linkLengthGeom(o).toFixed(2) || 10; o.p.inOff = +(old.offset || old.crest || old.inOff || 0); if (!['CIRCULAR', 'RECT_CLOSED', 'RECT_OPEN', 'TRAPEZOIDAL', 'TRIANGULAR'].includes(o.p.shape)) o.p.shape = 'CIRCULAR'; }
            if ('offset' in o.p) o.p.offset = +(old.inOff || old.offset || 0);
            if (r.to === 'ORIFICE' && !['CIRCULAR', 'RECT_CLOSED'].includes(o.p.shape)) o.p.shape = 'CIRCULAR';
            if (r.to === 'WEIR' && !['RECT_OPEN', 'TRAPEZOIDAL', 'TRIANGULAR'].includes(o.p.shape)) o.p.shape = 'RECT_OPEN';
          }
        }
      });
      const bad = isNode && r.to === 'OUTFALL' ? objs.filter(o => (deg.get(o.id) || 0) > 1).map(o => o.id) : [];
      this.app.panels.refreshTree();
      AV.toast(objs.length + ' object(s) converted to ' + r.to + (bad.length ? '. Warning: outfalls ' + bad.slice(0, 5).join(', ') + ' have more than one link.' : ''));
    }

    // ================================================================ groups (Avaris [GROUPS] section)
    groups() {
      const m = this.m; if (m._groups) return m._groups;
      const g = new Map();
      for (const line of m.raw.GROUPS || []) {
        const t = AV.tokenize(line); if (t.length < 3) continue;
        const kind = t[0].toUpperCase(); const key = kind + ':' + t[1];
        for (const name of t.slice(2)) { if (!g.has(name)) g.set(name, new Set()); g.get(name).add(key); }
      }
      m._groups = g; return g;
    }
    keyOf(o) { return (o.kind === 'SUBCATCH' ? 'SUBCATCH' : o.kind) + ':' + o.id; }
    groupsOf(o) { const k = this.keyOf(o); const out = []; for (const [n, s] of this.groups()) if (s.has(k)) out.push(n); return out; }
    objFromKey(k) { const i = k.indexOf(':'); const kind = k.slice(0, i), id = k.slice(i + 1); return kind === 'NODE' ? this.m.nodes.get(id) : kind === 'LINK' ? this.m.links.get(id) : kind === 'SUBCATCH' ? this.m.subcatchments.get(id) : null; }
    writeGroups(label, mutate) {
      const m = this.m; const oldRaw = (m.raw.GROUPS || []).slice(); const hadSec = m.rawOrder.includes('GROUPS');
      mutate(this.groups());
      const per = new Map();
      for (const [name, set] of this.groups()) for (const k of set) { if (!per.has(k)) per.set(k, []); per.get(k).push(name); }
      const pad = (s, n) => s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length);
      const order = { SUBCATCH: 0, NODE: 1, LINK: 2 };
      const lines = [...per.entries()].sort((a, b) => (order[a[0].split(':')[0]] - order[b[0].split(':')[0]]) || a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([k, names]) => { const i = k.indexOf(':'); return pad(k.slice(0, i), 17) + pad(k.slice(i + 1), 17) + names.map(n => pad(n, 17)).join('').trimEnd(); });
      const newRaw = lines;
      this.app.exec({ label, do: () => { m.raw.GROUPS = newRaw.slice(); if (!m.rawOrder.includes('GROUPS')) m.rawOrder.push('GROUPS'); m._groups = null; }, undo: () => { m.raw.GROUPS = oldRaw.slice(); if (!hadSec) m.rawOrder = m.rawOrder.filter(s => s !== 'GROUPS'); m._groups = null; } });
      if (this.grpRefresh) this.grpRefresh();
    }
    async createGroup() {
      const sel = [...this.app.selection].filter(o => o.kind !== 'GAGE' && o.kind !== 'LABEL');
      if (!sel.length) { AV.toast('Select the objects on the map first (Select tool, click or box), then click Create Group.', true); return null; }
      let n = 1; while (this.groups().has('Group' + n)) n++;
      const name = await AV.prompt('Create Group', 'Group name (' + sel.length + ' selected object' + (sel.length > 1 ? 's' : '') + ')', 'Group' + n); if (!name) return null;
      const nm = name.trim().replace(/\s+/g, '_'); if (!nm) return null;
      if (this.groups().has(nm) && !await AV.confirm('Group ' + nm + ' already exists. Add the selected objects to it?', 'Create Group', 'Add', 'Cancel')) return null;
      this.writeGroups('Create group ' + nm, (g) => { if (!g.has(nm)) g.set(nm, new Set()); for (const o of sel) g.get(nm).add(this.keyOf(o)); });
      AV.toast('Group ' + nm + ': ' + sel.length + ' object(s) added.');
      return nm;
    }
    // Manage Groups: group table on the left, actions grouped by purpose on the right
    manageGroups() {
      const app = this.app; let cur = null;
      const SV = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', 'gico'); s.innerHTML = d; return s; };
      const IC = { add: '<path d="M8 3v10M3 8h10"/>', ren: '<path d="M3 13l1-3 7-7 2 2-7 7z"/>', del: '<path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5"/>', sel: '<path d="M4 2.5l8 5.5-3.6.8 2 3.7-1.6.8-2-3.7L4 12z"/>', zoom: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>', plus: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M8 5.5v5M5.5 8h5"/>', minus: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5.5 8h5"/>' };
      const tbody = h('tbody');
      const tbl = h('table', { class: 'grptbl' }, h('thead', null, h('tr', null, h('th', null, 'Group'), h('th', { class: 'n' }, 'Nodes'), h('th', { class: 'n' }, 'Links'), h('th', { class: 'n' }, 'Subcatch.'), h('th', { class: 'n' }, 'Total'))), tbody);
      const info = h('div', { class: 'grpinfo' });
      const objs = (name) => [...(this.groups().get(name) || [])].map(k => this.objFromKey(k)).filter(Boolean);
      const selCount = () => [...app.selection].filter(o => o.kind !== 'GAGE' && o.kind !== 'LABEL').length;
      const needGroup = [], needSel = [];
      const btn = (ic, label, fn, tip) => h('button', { class: 'btn grpbtn', title: tip || label, onclick: fn }, SV(IC[ic]), h('span', null, label));
      const refresh = () => {
        const G = this.groups(); if (cur && !G.has(cur)) cur = null;
        tbody.innerHTML = '';
        for (const [name, set] of G) {
          const c = { NODE: 0, LINK: 0, SUBCATCH: 0 }; for (const k of set) { const t = k.slice(0, k.indexOf(':')); c[t] = (c[t] || 0) + 1; }
          const tr = h('tr', { class: name === cur ? 'sel' : '', onclick: () => { cur = name; refresh(); }, ondblclick: () => { cur = name; app.selectMany(objs(name)); app.map.zoomToObjects(objs(name)); refresh(); } },
            h('td', null, name), h('td', { class: 'n' }, String(c.NODE || '')), h('td', { class: 'n' }, String(c.LINK || '')), h('td', { class: 'n' }, String(c.SUBCATCH || '')), h('td', { class: 'n' }, h('b', null, String(set.size))));
          tbody.appendChild(tr);
        }
        if (!G.size) tbody.appendChild(h('tr', null, h('td', { colspan: 5, class: 'empty' }, 'No groups yet. Select objects on the map, then click Create Group.')));
        const ns = selCount();
        info.innerHTML = ''; info.append(h('span', null, cur ? 'Group ' : 'No group chosen', cur ? h('b', null, cur) : null), h('span', null, 'Map selection: ', h('b', null, String(ns)), ' object' + (ns === 1 ? '' : 's')));
        needGroup.forEach(b => b.disabled = !cur); needSel.forEach(b => b.disabled = !cur || !ns);
      };
      this.grpRefresh = refresh;
      const bCreate = btn('add', 'Create Group...', async () => { const nm = await this.createGroup(); if (nm) { cur = nm; refresh(); } }, 'Create a group from the objects selected on the map');
      bCreate.classList.add('primary');
      const bRen = btn('ren', 'Rename...', async () => { const n = await AV.prompt('Rename Group', 'New name', cur); if (!n) return; const nm = n.trim().replace(/\s+/g, '_'); if (!nm || nm === cur) return; if (this.groups().has(nm)) { AV.toast('Group ' + nm + ' already exists.', true); return; } const old = cur; this.writeGroups('Rename group', (g) => { const s = g.get(old); g.delete(old); g.set(nm, s); }); cur = nm; refresh(); });
      const bDel = btn('del', 'Delete', async () => { if (await AV.confirm('Delete group ' + cur + '? The objects themselves are not deleted.', 'Manage Groups', 'Delete')) { this.writeGroups('Delete group', (g) => g.delete(cur)); cur = null; refresh(); } });
      const bSel = btn('sel', 'Select on Map', () => { app.selectMany(objs(cur)); refresh(); }), bZoom = btn('zoom', 'Zoom To', () => app.map.zoomToObjects(objs(cur)));
      const bAdd = btn('plus', 'Add Selection', () => { this.writeGroups('Add to group', (g) => { for (const o of app.selection) if (o.kind !== 'GAGE' && o.kind !== 'LABEL') g.get(cur).add(this.keyOf(o)); }); refresh(); }, 'Add the objects selected on the map to this group');
      const bRem = btn('minus', 'Remove Selection', () => { this.writeGroups('Remove from group', (g) => { for (const o of app.selection) g.get(cur).delete(this.keyOf(o)); }); refresh(); }, 'Remove the objects selected on the map from this group');
      needGroup.push(bRen, bDel, bSel, bZoom); needSel.push(bAdd, bRem);
      const sec = (title, ...b) => h('div', { class: 'grpsec' }, h('div', { class: 'grpsh' }, title), ...b);
      const body = h('div', { class: 'grpdlg' },
        h('div', { class: 'grpleft' }, h('div', { class: 'grptblw' }, tbl), info),
        h('div', { class: 'grpright' }, sec('Group', bCreate, bRen, bDel), sec('Show', bSel, bZoom), sec('Members', bAdd, bRem)),
        h('div', { class: 'grpfoot' }, 'Double-click a group to select and zoom to it. Groups are saved in the [GROUPS] section of the .inp file (Avaris DS compatible).'));
      const p = AV.floatPanel({ id: 'groups', title: 'Manage Groups', w: 560, h: 400, body, onClose: () => { this.grpRefresh = null; clearInterval(tm); } });
      const tm = setInterval(() => { if (this.grpRefresh) { const ns = selCount(); if (ns !== this._grpLastSel) { this._grpLastSel = ns; refresh(); } } }, 700);
      refresh();
      return p;
    }
    manageBookmarks() {
      const app = this.app; const bm = app.settings.bookmarks || (app.settings.bookmarks = []);
      const list = h('div', { class: 'list-box', style: { height: '200px' } });
      let cur = -1;
      const refresh = () => { list.innerHTML = ''; bm.forEach((b, i) => list.appendChild(h('div', { class: i === cur ? 'sel' : '', onclick: () => { cur = i; refresh(); }, ondblclick: () => app.map.zoomToBox(b.box, 0) }, b.name))); if (!bm.length) list.appendChild(h('div', { style: { color: 'var(--muted)' } }, 'No bookmarks yet.')); };
      const save = () => window.host.setSettings(app.settings);
      AV.floatPanel({ id: 'bm', title: 'Manage Bookmarks', w: 340, h: 320, body: h('div', { style: { padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' } }, list,
        h('div', { style: { display: 'flex', gap: '4px' } }, h('button', { class: 'btn small', onclick: () => { if (bm[cur]) app.map.zoomToBox(bm[cur].box, 0); } }, 'Go To'),
          h('button', { class: 'btn small', onclick: async () => { if (!bm[cur]) return; const n = await AV.prompt('Rename Bookmark', 'Name', bm[cur].name); if (n) { bm[cur].name = n; save(); refresh(); } } }, 'Rename'),
          h('button', { class: 'btn small', onclick: () => { if (!bm[cur]) return; bm.splice(cur, 1); cur = -1; save(); refresh(); } }, 'Delete'),
          h('button', { class: 'btn small', onclick: async () => { await app.createBookmark(); refresh(); } }, 'Create'))) });
      refresh();
    }

    // ================================================================ new drawable layer
    async newLayer() {
      const r = await AV.formDialog('New Layer', [{ k: 'name', l: 'Layer name', t: 'text' }, { k: 'geom', l: 'Geometry', t: 'choice', o: [['point', 'Point'], ['line', 'Polyline'], ['polygon', 'Polygon']] },
        { t: 'note', l: 'After creating the layer, click on the map to draw features (double-click or Enter finishes a line/polygon; Esc stops). Export it as a shapefile from the Layer View.' }], { name: 'Layer' + (this.app.map.extLayers.length + 1), geom: 'polygon' });
      if (!r) return;
      const L = { name: r.name, path: '', kind: r.geom, features: [], bbox: [0, 0, 1, 1], fields: ['ID'], editable: true, visible: true, stroke: '#e65100', fill: 'rgba(230,81,0,.12)', width: 2, opacity: 1, order: 'above' };
      this.app.map.extLayers.unshift(L); this.drawLayer = L; this.app.panels.refreshLayers();
      this.startDraw(L);
    }
    startDraw(L) {
      this.onDrawHook = null; this.drawLayer = L; this.app.setTool('draw-ext'); this.app.map.drawGeom = L.kind;
      this.app.map.setHint('Drawing on layer "' + L.name + '": click to add ' + (L.kind === 'point' ? 'points' : 'vertices; double-click or Enter to finish') + '. Esc to stop.');
    }
    onDraw(pts) {
      if (this.onDrawHook) { const f = this.onDrawHook; this.onDrawHook = null; this.app.setTool('select'); f(pts); return; }
      const L = this.drawLayer; if (!L) return;
      const f = { type: L.kind, coords: L.kind === 'point' ? pts : [L.kind === 'polygon' ? pts.concat([pts[0]]) : pts], props: { ID: L.features.length + 1 } };
      let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of pts) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }
      f.bbox = b; L.features.push(f);
      L.bbox = L.features.reduce((a, x) => [Math.min(a[0], x.bbox[0]), Math.min(a[1], x.bbox[1]), Math.max(a[2], x.bbox[2]), Math.max(a[3], x.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);
      this.app.panels.refreshLayers(); this.app.map.redraw();
    }
    async exportLayer(L) {
      const p = await window.host.saveDialog({ title: 'Export layer as shapefile', defaultPath: String(L.name).replace(/\.\w+$/, '') + '.shp', filters: [{ name: 'Shapefile', extensions: ['shp'] }] }); if (!p) return;
      const b = p.replace(/\.shp$/i, ''); const feats = L.features.map(f => ({ coords: f.coords, props: f.props }));
      const keys = Object.keys(feats.reduce((a, f) => Object.assign(a, f.props), {})); const fields = AV.SHP.fieldsFor(feats.map(f => f.props), keys.length ? keys : ['ID']);
      const w = AV.SHP.write(L.kind, feats, fields);
      await window.host.writeBinary(b + '.shp', new Uint8Array(w.shp)); await window.host.writeBinary(b + '.shx', new Uint8Array(w.shx)); await window.host.writeBinary(b + '.dbf', new Uint8Array(w.dbf));
      if (L.prj) await window.host.writeText(b + '.prj', L.prj);
      AV.toast('Layer exported to ' + b + '.shp');
    }

    // ================================================================ ICM-style object graph (follows map selection)
    graphTool(objs) {
      if (!this.app.results && !this.app.sim.scen.length) { AV.alert('Run a simulation (or load a results file) first, then select objects on the map to graph their results.', 'Graph'); return; }
      const a = this.app; const g = new GraphPanel(this, objs || (a.selection.size || !(a.meshSel >= 0) || !a.mesh2d ? [...a.selection] : [AV.cellNode(a, a.meshSel)]));
      (this.graphs || (this.graphs = [])).push(g);
    }
    profileTool(from, to) {
      const g = new ProfilePanel(this, from, to);
      (this.profiles || (this.profiles = [])).push(g);
    }

    // ================================================================ results summary
    async summary() {
      const app = this.app; const R = app.results;
      let text = R && R.reportText; const rp = (R && R.rpt) || (app.sim.lastRun && app.sim.lastRun.rpt) || (app.filePath ? app.filePath.replace(/\.inp$/i, '.rpt') : null);
      if (!text && rp && await window.host.exists(rp)) text = await window.host.readText(rp);
      if (!text) { AV.alert('Run a simulation first.'); return; }
      const tables = AV.parseReportTables(text);
      const getNum = (re) => { const m = re.exec(text); return m ? parseFloat(m[1]) : null; };
      const card = (label, val, warn) => h('div', { style: { border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 12px', minWidth: '150px', background: warn ? '#fff4e5' : '#fff' } }, h('div', { style: { color: 'var(--muted)', fontSize: '11.5px' } }, label), h('div', { style: { fontSize: '18px', fontWeight: 600, color: warn ? '#e65100' : 'var(--text)' } }, val));
      const runoffErr = getNum(/Runoff Quantity Continuity[\s\S]*?Continuity Error \(%\) \.+\s+(-?[\d.]+)/), flowErr = getNum(/Flow Routing Continuity[\s\S]*?Continuity Error \(%\) \.+\s+(-?[\d.]+)/);
      const flood = tables['Node Flooding Summary'] ? tables['Node Flooding Summary'].rows : [];
      const surch = tables['Node Surcharge Summary'] ? tables['Node Surcharge Summary'].rows : [];
      const csur = tables['Conduit Surcharge Summary'] ? tables['Conduit Surcharge Summary'].rows : [];
      const floodVol = getNum(/Flooding Loss \.+\s+(-?[\d.]+)/);
      const nc = getNum(/% of Steps Not Converging\s+:\s+(-?[\d.]+)/);
      const cards = h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '10px' } },
        card('Runoff continuity error', runoffErr === null ? '-' : runoffErr.toFixed(2) + ' %', Math.abs(runoffErr || 0) > 5),
        card('Flow routing continuity error', flowErr === null ? '-' : flowErr.toFixed(2) + ' %', Math.abs(flowErr || 0) > 5),
        card('Flooded nodes', String(flood.length), flood.length > 0), card('Flooding loss', floodVol === null ? '-' : AV.fmt(floodVol) + (this.m.isSI ? ' ha-m' : ' ac-ft'), floodVol > 0),
        card('Surcharged nodes', String(surch.length), surch.length > 0), card('Surcharged conduits', String(csur.length), csur.length > 0),
        card('% steps not converging', nc === null ? '-' : nc.toFixed(2), nc > 10));
      const names = Object.keys(tables);
      const sel = h('select', null, names.map(n => h('option', { value: n }, n + ' (' + tables[n].rows.length + ')')));
      const pref = ['Node Flooding Summary', 'Node Surcharge Summary', 'Link Flow Summary'].find(n => tables[n] && tables[n].rows.length) || names[0]; if (pref) sel.value = pref;
      const holder = h('div', { class: 'grid-scroll' });
      let sortK = -1, sortD = -1;
      const show = () => {
        const t = tables[sel.value]; holder.innerHTML = ''; if (!t) return;
        let rows = t.rows.slice(); if (sortK >= 0) rows.sort((a, b) => { const x = parseFloat(a[sortK]), y = parseFloat(b[sortK]); return (isFinite(x) && isFinite(y) ? x - y : String(a[sortK]).localeCompare(String(b[sortK]))) * sortD; });
        const tb = h('tbody');
        for (const r of rows.slice(0, 20000)) tb.appendChild(h('tr', { style: { cursor: 'pointer' }, onclick: () => { const o = this.m.nodes.get(r[0]) || this.m.links.get(r[0]) || this.m.subcatchments.get(r[0]); if (o) { app.select(o); app.activateView('map'); app.map.zoomToObjects([o]); } } }, r.map(c => h('td', { class: /^-?[\d.]+$/.test(c) ? 'num' : '' }, c))));
        holder.appendChild(h('table', { class: 'grid' }, h('thead', null, h('tr', null, t.cols.map((c, i) => h('th', { onclick: () => { if (sortK === i) sortD *= -1; else { sortK = i; sortD = -1; } show(); } }, c + (sortK === i ? (sortD > 0 ? ' ▲' : ' ▼') : ''))))), tb));
      };
      sel.onchange = () => { sortK = -1; show(); };
      const view = h('div', null, h('div', { class: 'grid-tools' }, h('b', null, 'Results Summary'), sel,
        h('button', { class: 'btn small', onclick: () => { const t = tables[sel.value]; if (t) AV.downloadText([t.cols.map(AV.csvCell).join(',')].concat(t.rows.map(r => r.map(AV.csvCell).join(','))).join('\n'), sel.value.replace(/\W+/g, '_') + '.csv'); } }, 'Export CSV'),
        h('span', { style: { color: 'var(--muted)' } }, 'Click a row to locate the object on the map; click a header to sort.')), cards, holder);
      app.closeView('summary'); app.addView('summary', 'Summary', view); show();
    }

    // ================================================================ unit converter
    unitConverter() {
      const U = {
        Flow: { 'CFS (ft3/s)': 0.0283168466, 'GPM (US gal/min)': 6.30901964e-5, 'MGD (US Mgal/d)': 0.0438126364, 'CMS (m3/s)': 1, 'LPS (L/s)': 0.001, 'MLD (ML/d)': 0.0115740741, 'm3/h': 1 / 3600, 'm3/d': 1 / 86400 },
        Length: { 'ft': 0.3048, 'in': 0.0254, 'mi': 1609.344, 'm': 1, 'mm': 0.001, 'cm': 0.01, 'km': 1000, 'US survey ft': 1200 / 3937 },
        Area: { 'acre': 4046.8564224, 'ft2': 0.09290304, 'mi2': 2589988.110336, 'ha': 10000, 'm2': 1, 'km2': 1e6 },
        Volume: { 'ft3': 0.0283168466, 'US gal': 0.00378541178, 'Mgal (US)': 3785.41178, 'acre-ft': 1233.48184, 'm3': 1, 'L': 0.001, 'ML': 1000, 'ha-m': 10000 },
        Velocity: { 'ft/s': 0.3048, 'm/s': 1, 'km/h': 1 / 3.6, 'mph': 0.44704 },
        'Rainfall intensity': { 'in/hr': 0.0254, 'mm/hr': 0.001, 'mm/min': 0.06 },
        Pressure: { 'psi': 6894.757, 'kPa': 1000, 'bar': 100000, 'ft of water': 2989.067, 'm of water': 9806.65 },
      };
      const cat = h('select', null, Object.keys(U).map(k => h('option', { value: k }, k)));
      const from = h('select'), to = h('select'); const val = h('input', { type: 'number', step: 'any', value: 1, style: { width: '160px' } });
      const out = h('div', { style: { fontSize: '20px', fontWeight: 600, padding: '10px 0', color: 'var(--accent3)' } });
      const all = h('div', { class: 'note', style: { lineHeight: 1.6, fontFamily: 'var(--mono)', fontSize: '12px' } });
      const fill = () => { const u = Object.keys(U[cat.value]); from.innerHTML = ''; to.innerHTML = ''; u.forEach(x => { from.appendChild(h('option', { value: x }, x)); to.appendChild(h('option', { value: x }, x)); }); to.selectedIndex = Math.min(u.length - 1, 3); calc(); };
      const calc = () => { const f = U[cat.value]; const base = (+val.value || 0) * f[from.value]; out.textContent = AV.fmt(base / f[to.value], 6) + ' ' + to.value; all.textContent = Object.keys(f).map(k => k.padEnd(18) + AV.fmt(base / f[k], 6)).join('\n'); };
      cat.onchange = fill; from.onchange = calc; to.onchange = calc; val.oninput = calc;
      AV.floatPanel({ id: 'units', title: 'Unit Converter', w: 420, h: 430, body: h('div', { style: { padding: '12px', overflow: 'auto' } }, h('div', { class: 'form' }, h('label', null, 'Quantity'), cat, h('label', null, 'Value'), val, h('label', null, 'From'), from, h('label', null, 'To'), to), out, all) });
      fill();
    }

    // ================================================================ scenarios (Avaris .ini [Scenarios] compatible)
    iniPath() { return this.app.filePath ? this.app.filePath.replace(/\.inp$/i, '.ini') : null; }
    async readIni(p) {
      const out = { lines: [], scen: [] };
      if (p && await window.host.exists(p)) out.lines = (await window.host.readText(p)).split(/\r?\n/);
      let inS = false;
      for (const l of out.lines) { const t = l.trim(); if (/^\[.*\]$/.test(t)) { inS = t.toLowerCase() === '[scenarios]'; continue; } if (inS && t.includes('=')) out.scen.push(t.slice(t.indexOf('=') + 1).trim()); }
      return out;
    }
    async writeIni(p, ini, list) {
      const lines = []; let inS = false, done = false;
      const block = ['[Scenarios]'].concat(list.map((s, i) => (i + 1) + '=' + s));
      for (const l of ini.lines) {
        const t = l.trim();
        if (/^\[.*\]$/.test(t)) { if (inS) { lines.push(...block, ''); done = true; } inS = t.toLowerCase() === '[scenarios]'; if (inS) continue; }
        if (!inS) lines.push(l);
      }
      if (inS) { lines.push(...block); done = true; }
      if (!done) { while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); lines.push('', ...block); }
      await window.host.writeText(p, lines.join('\r\n') + '\r\n');
    }
    async scenarios() {
      const app = this.app;
      if (!app.filePath) { AV.alert('Save the model first; scenarios are stored next to the model file (Avaris-compatible .ini).'); return; }
      const ip = this.iniPath(); let ini = await this.readIni(ip);
      const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
      if (!ini.scen.some(s => norm(s) === norm(app.filePath))) ini.scen.unshift(app.filePath.replace(/\\/g, '/'));
      const list = h('div', { class: 'list-box scenlist', style: { height: 'auto', flex: 1, minHeight: '140px' } });
      let cur = ini.scen.findIndex(s => norm(s) === norm(app.filePath));
      const chk = (this.scenChk = this.scenChk || new Set()); if (!this._scenInit) { ini.scen.forEach(s => chk.add(norm(s))); this._scenInit = true; }
      const refresh = () => { list.innerHTML = ''; ini.scen.forEach((s, i) => { const isCur = norm(s) === norm(app.filePath);
        const cb = h('input', { type: 'checkbox', checked: chk.has(norm(s)), title: 'Include in Run Selected / comparison graphs', onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? chk.add(norm(s)) : chk.delete(norm(s)); } });
        const loaded = isCur ? !!app.results : app.sim.scen.some(r => r.scenName === AV.basename(s).replace(/\.inp$/i, ''));
        list.appendChild(h('div', { class: (i === cur ? 'sel' : ''), title: s, onclick: () => { cur = i; refresh(); }, ondblclick: () => open() }, cb, h('span', { class: 'scnm' }, AV.basename(s).replace(/\.inp$/i, '')), isCur ? h('span', { class: 'sctag cur' }, 'open') : null, loaded ? h('span', { class: 'sctag res' }, 'results') : null, h('span', { class: 'scdir' }, AV.dirname(s)))); }); };
      const open = async () => { const s = ini.scen[cur]; if (!s || norm(s) === norm(app.filePath)) return; if (!await window.host.exists(s)) { AV.alert('File not found:\n' + s); return; } await app.openFile(s); this.scenarios(); };
      const create = async () => {
        const name = await AV.prompt('New Scenario', 'Scenario name', 'Scenario' + ini.scen.length); if (!name) return;
        const p = AV.joinPath(AV.dirname(app.filePath), AV.basename(app.filePath).replace(/\.inp$/i, '') + '_' + name.trim().replace(/[^\w\-]+/g, '_') + '.inp');
        if (await window.host.exists(p) && !await AV.confirm(p + ' exists. Overwrite?')) return;
        await window.host.writeText(p, app.model.toINP(), await window.host.encoding(app.filePath));
        ini.scen.push(p.replace(/\\/g, '/')); chk.add(norm(p)); await this.writeIni(ip, ini, ini.scen);
        for (const s of ini.scen) { const o = s.replace(/\.inp$/i, '.ini'); if (norm(o) !== norm(ip)) { try { if (await window.host.exists(s)) { const oi = await this.readIni(o); await this.writeIni(o, oi, ini.scen); } } catch (e) { } } }
        cur = ini.scen.length - 1; refresh(); AV.toast('Scenario created: ' + AV.basename(p) + '. Double-click to switch to it.');
      };
      const runSel = async () => { const sel = ini.scen.filter(s => chk.has(norm(s))); if (!sel.length) { AV.toast('Tick the scenarios to run.', true); return; } await this.runScenarios(sel); refresh(); };
      const body = h('div', { style: { padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minHeight: 0 } }, list,
        h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
          h('button', { class: 'btn small', onclick: create }, 'New from Current'), h('button', { class: 'btn small', onclick: open }, 'Open'),
          h('button', { class: 'btn small primary', title: 'Run every ticked scenario, then compare them in Graph (tick the scenarios to show in the graph)', onclick: runSel }, '▶ Run Selected & Compare'),
          h('button', { class: 'btn small', title: 'Compare the loaded scenario results: KPIs, difference table, scatter plot and difference map', onclick: () => app.compareScenarios() }, 'Compare'),
          h('button', { class: 'btn small', title: 'Load the existing results (.out) of the ticked scenarios without running', onclick: async () => { await this.loadScenarioResults(ini.scen.filter(s => chk.has(norm(s)))); refresh(); } }, 'Load Results'),
          h('button', { class: 'btn small', onclick: async () => { if (cur < 0 || norm(ini.scen[cur]) === norm(app.filePath)) { AV.toast('The current scenario cannot be removed.'); return; } ini.scen.splice(cur, 1); await this.writeIni(ip, ini, ini.scen); cur = 0; refresh(); } }, 'Remove from List')));
      AV.floatPanel({ id: 'scen', title: 'Scenarios', w: 600, h: 340, body }); refresh();
    }

    // run the given scenario .inp files at the same time: one engine process per scenario (at most logical processors
    // - 1 at once, each engine with 1 thread), each with its own progress bar; then show them together
    async runScenarios(paths) {
      const app = this.app, sim = app.sim; const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
      if (!AV.licenceGate(app, 'Running simulations')) return;
      const rn = await AV.askRunName(app, 'Run Scenarios', { ok: 'Run ' + paths.length + ' scenario' + (paths.length > 1 ? 's' : '') }); if (!rn) return;
      const limit = Math.max(1, Math.min(paths.length, (app.info.cpus || 2) - 1));
      const one = (t) => /^\s*THREADS\s/im.test(t) ? t.replace(/^(\s*THREADS\s+)\S+/im, '$11') : t.replace(/^\[OPTIONS\][^\n]*\n/im, (x) => x + 'THREADS              1\n');
      const jobs = paths.map((p, i) => ({ id: 'scen' + i + '_' + Date.now().toString(36), p, name: AV.basename(p).replace(/\.inp$/i, ''), isCur: !!(app.filePath && norm(p) === norm(app.filePath)), state: 'waiting', pct: 0 }));
      const rows = jobs.map(j => { const bar = h('div'); const st = h('span', { class: 'scst' }, 'waiting'); j.el = { bar, st }; return h('div', { class: 'scrow' }, h('div', { class: 'scname', title: j.p }, (j.isCur ? '● ' : '') + j.name), h('div', { class: 'progress' }, bar), st); });
      let stopped = false; const t0 = Date.now(); const head = h('div', { style: { marginBottom: '8px' } });
      const dlg = AV.modal({ title: 'Running Scenarios - ' + rn.name, width: 560, body: h('div', null, head, h('div', { class: 'sclist' }, rows)), enterSubmits: false,
        buttons: [{ label: 'Stop All', danger: true, onClick: () => { stopped = true; for (const j of jobs) if (j.state === 'running') window.host.cancelEngine(j.id); return false; } }] });
      const upd = () => { const run = jobs.filter(j => j.state === 'running').length, fin = jobs.filter(j => /done|failed|stopped/.test(j.state)).length; head.textContent = 'Running ' + run + ' at the same time (up to ' + limit + ', 1 thread each) · ' + fin + ' / ' + jobs.length + ' finished · ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s'; };
      const tick = setInterval(upd, 1000); upd();
      sim.scenProgress = (id, p) => { const j = jobs.find(x => x.id === id); if (!j) return; j.pct = p; j.el.bar.style.width = Math.min(100, p) + '%'; j.el.st.textContent = p.toFixed(0) + ' %'; };
      const runOne = async (j) => {
        j.state = 'running'; j.el.st.textContent = 'starting'; const ts = Date.now(); upd();
        try {
          let text, enc, flood2d = false, m;
          if (j.isCur) { m = app.model; enc = await window.host.encoding(j.p);
            if (AV.f2dEnabled(m) && AV.has2D(app) && app.mesh2d && app.mesh2d.cells.length) { text = AV.mesh2DToINP(m.toINP({ reportAll: true, runSI: AV.f2dRun(m).si }), app.mesh2d, m); flood2d = true; } else text = m.toINP({ reportAll: true }); }
          else { if (!await window.host.exists(j.p)) throw new Error('file not found'); enc = await window.host.encoding(j.p); m = AV.Model.parse(await window.host.readText(j.p)); text = m.toINP({ reportAll: true }); }
          const dir = AV.resultsDir(j.p); try { await window.host.mkdir(dir); } catch (e) { }
          const res = await window.host.runEngine({ inpText: AV.runDataPaths(one(text), AV.dirname(j.p), dir), dir, base: rn.name, detail: false, encoding: enc, flood2d, named: true, id: j.id });
          const secs = (Date.now() - ts) / 1000;
          if (res.canceled) { j.state = 'stopped'; j.el.st.textContent = 'stopped'; return; }
          const ok = res.code === 0 && !res.errors.length;
          await AV.writeRunMeta(dir, rn.name, { name: rn.name, desc: rn.desc, date: new Date().toISOString(), model: AV.basename(j.p), type: flood2d ? '1D-2D' : '1D', flowUnits: m.flowUnits, code: ok ? 0 : (res.code || 1), seconds: +secs.toFixed(1), massBal: res.massBal, scenario: true });
          if (!ok) { j.state = 'failed'; j.err = res.errors[0] || 'engine code ' + res.code; j.el.st.textContent = 'failed'; j.el.bar.style.background = 'var(--danger)'; return; }
          j.state = 'done'; j.out = res.out; j.rpt = res.rpt; j.el.bar.style.width = '100%'; j.el.st.textContent = secs.toFixed(0) + ' s ✓';
        } catch (e) { j.state = 'failed'; j.err = e.message; j.el.st.textContent = 'failed'; }
        upd();
      };
      // simple pool: start up to "limit" engines, start the next one as soon as one finishes
      let next = 0; const worker = async () => { while (next < jobs.length && !stopped) { const j = jobs[next++]; await runOne(j); } };
      await Promise.all([...Array(limit)].map(worker));
      for (const j of jobs) if (j.state === 'waiting') { j.state = 'stopped'; j.el.st.textContent = 'not run'; }
      clearInterval(tick); sim.scenProgress = null; dlg.close();
      const done = jobs.filter(j => j.state === 'done'), failed = jobs.filter(j => j.state === 'failed').map(j => j.name + ': ' + j.err);
      for (const d of done) { if (d.isCur) await sim.loadResults(d.out, d.rpt, true); }
      for (const d of done) { if (!d.isCur) { try { await sim.loadScenario(d.out, d.rpt, d.name); } catch (e) { failed.push(d.name + ': ' + e.message); } } }
      if (app.db) app.db.render();
      if (failed.length) AV.alert('Some scenarios did not run:\n\n' + failed.join('\n'), 'Scenarios');
      if (done.length) { AV.toast(done.length + ' scenario(s) finished in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s (run in parallel).', false, 6000); this.afterScenarios(done.length); }
    }
    async loadScenarioResults(paths) {
      const app = this.app, sim = app.sim; const norm = (p) => p.replace(/\\/g, '/').toLowerCase(); let n = 0; const miss = [];
      for (const p of paths) {
        const name = AV.basename(p).replace(/\.inp$/i, ''); let out = p.replace(/\.inp$/i, '.out'), rpt = p.replace(/\.inp$/i, '.rpt');
        const runs = await AV.listRuns(p); const last = runs.find(r => r.out && !r.is2D); if (last) { out = last.out; rpt = last.rpt; } // latest named results of that scenario
        if (!await window.host.exists(out)) { miss.push(name); continue; }
        if (app.filePath && norm(p) === norm(app.filePath)) await sim.loadResults(out, rpt, false); else await sim.loadScenario(out, rpt, name);
        n++;
      }
      if (miss.length) AV.toast('No results yet for: ' + miss.join(', ') + ' (use Run Selected).', true, 6000);
      if (n) this.afterScenarios(n);
    }
    afterScenarios(n) {
      const app = this.app; AV.toast(n + ' scenario result(s) loaded.', false, 4000);
      if (this.graphs && this.graphs.length) this.graphs.forEach(g => g.render());
      if (app.sim.sources().length > 1) app.compareScenarios();
    }

    // ================================================================ spatial reference
    reprojectRaster() { this.notAvailable('Reproject Raster', 'raster (GeoTIFF / DEM) layers'); }
    async convertSR() {
      if (!this.app.canModify()) return;
      const app = this.app; const P = AV.Proj;
      const presets = [['', '(choose...)'], ['GEO', 'Geographic WGS84 / NAD83 (degrees)'], ['WEBM', 'Web Mercator (EPSG:3857)']].concat(Array.from({ length: 60 }, (_, i) => ['UTM' + (i + 1), 'UTM zone ' + (i + 1) + 'N (WGS84/NAD83, m)']));
      const mkSide = (label) => {
        const pre = h('select', null, presets.map(([v, l]) => h('option', { value: v }, l)));
        const wkt = h('textarea', { rows: 4, style: { width: '100%', fontFamily: 'var(--mono)', fontSize: '11px' }, placeholder: 'Paste WKT / .prj text, or load a .prj file' });
        pre.onchange = () => { if (pre.value) wkt.value = P.presetWKT(pre.value); };
        const load = h('button', { class: 'btn small', onclick: async () => { const p = await window.host.openDialog({ filters: [{ name: 'Projection', extensions: ['prj', 'sw', 'ini', 'wkt', 'txt'] }] }); if (!p) return; let t = await window.host.readText(p); const m = /^\s*\d+="(.+)"\s*$/m.exec(t); if (/\.(sw|ini)$/i.test(p)) { const cur = /current=(\d+)/.exec(t); const re = new RegExp('^' + (cur ? cur[1] : '1') + '="(.+)"$', 'm'); const mm = re.exec(t) || m; if (mm) t = mm[1].replace(/\\"/g, '"'); } wkt.value = t.trim(); } }, 'Load .prj / .sw...');
        return { pre, wkt, el: h('div', { style: { marginBottom: '10px' } }, h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, label), h('div', { style: { display: 'flex', gap: '6px', marginBottom: '4px' } }, pre, load), wkt) };
      };
      const A = mkSide('Current (source) coordinate system'), Bs = mkSide('Target coordinate system');
      if (app.crsWKT) A.wkt.value = app.crsWKT;
      const test = h('div', { class: 'note', style: { color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '11px' } });
      const body = h('div', { style: { width: '600px' } }, A.el, Bs.el,
        h('div', { class: 'note', style: { lineHeight: 1.5 } }, 'Supported projections: geographic, Transverse Mercator / UTM, Lambert Conformal Conic (1SP/2SP, e.g. US State Plane), Mercator / Web Mercator, in metres, feet or US survey feet. No datum shift is applied (NAD83 and WGS84 are treated as the same). All nodes, vertices, polygons, gages and labels are converted.'), test);
      const r = await AV.modal({ title: 'Convert Spatial Reference', body, buttons: [{ label: 'Test', onClick: () => { try { const s = P.parse(A.wkt.value), t = P.parse(Bs.wkt.value); const b = app.model.bounds(false) || { x1: 0, y1: 0 }; const g = P.toGeo(s, b.x1, b.y1); const o = P.fromGeo(t, g[0], g[1]); test.textContent = 'Map corner (' + AV.fmt(b.x1, 3) + ', ' + AV.fmt(b.y1, 3) + ') -> lon/lat (' + g[0].toFixed(6) + ', ' + g[1].toFixed(6) + ') -> (' + o[0].toFixed(3) + ', ' + o[1].toFixed(3) + ')'; } catch (e) { test.textContent = 'Error: ' + e.message; } return false; } }, { label: 'Cancel', value: null }, { label: 'Convert', primary: true, value: 'go' }] }).done;
      if (r !== 'go') return;
      let S, T; try { S = P.parse(A.wkt.value); T = P.parse(Bs.wkt.value); } catch (e) { AV.alert('Could not read the coordinate system: ' + e.message); return; }
      const f = (x, y) => { const g = P.toGeo(S, x, y); return P.fromGeo(T, g[0], g[1]); };
      const m = app.model; const objs = [...m.nodes.values(), ...m.links.values(), ...m.subcatchments.values(), ...m.gages.values()];
      const lbs = m.labels.map(l => [l, l.x, l.y]); const oldUnits = m.mapInfo.units;
      app.tools.bulk('Convert spatial reference', objs, () => {
        for (const n of m.nodes.values()) [n.x, n.y] = f(n.x, n.y);
        for (const g of m.gages.values()) [g.x, g.y] = f(g.x, g.y);
        for (const l of m.links.values()) l.verts = l.verts.map(v => f(v[0], v[1]));
        for (const s of m.subcatchments.values()) s.poly = s.poly.map(v => f(v[0], v[1]));
        for (const l of m.labels) [l.x, l.y] = f(l.x, l.y);
        m.mapInfo.units = T.type === 'geographic' ? 'Degrees' : (Math.abs(T.unit - 0.3048) < 1e-3 ? 'Feet' : 'Meters');
      });
      const top = app.undoStack[app.undoStack.length - 1]; const u = top.undo, d = top.do; const newUnits = m.mapInfo.units; top.undo = () => { u(); for (const [l, x, y] of lbs) { l.x = x; l.y = y; } m.mapInfo.units = oldUnits; app.refreshAll(); }; top.do = () => { d(); m.mapInfo.units = newUnits; app.refreshAll(); };
      for (const L of app.map.extLayers) if (L.convertWith === undefined) { /* background layers keep their own coordinates */ }
      app.refreshAll(); app.map.zoomAll(); AV.toast('Coordinates converted. Background layers were not changed.');
    }
  }
  AV.Features = Features;

  // ================================================================== report table parser (summary)
  AV.parseReportTables = function (text) {
    const L = text.split(/\r?\n/); const out = {};
    const COLS = {
      'Node Depth Summary': ['Node', 'Type', 'Average Depth', 'Maximum Depth', 'Maximum HGL', 'Day of Max', 'Time of Max', 'Reported Max Depth'],
      'Node Inflow Summary': ['Node', 'Type', 'Max Lateral Inflow', 'Max Total Inflow', 'Day of Max', 'Time of Max', 'Lateral Inflow Volume', 'Total Inflow Volume', 'Flow Balance Error %'],
      'Node Surcharge Summary': ['Node', 'Type', 'Hours Surcharged', 'Max Height Above Crown', 'Min Depth Below Rim'],
      'Node Flooding Summary': ['Node', 'Hours Flooded', 'Maximum Rate', 'Day of Max', 'Time of Max', 'Total Flood Volume', 'Maximum Ponded Depth'],
      'Storage Volume Summary': ['Storage Unit', 'Average Volume', 'Avg Pcnt Full', 'Evap Pcnt Loss', 'Exfil Pcnt Loss', 'Maximum Volume', 'Max Pcnt Full', 'Day of Max', 'Time of Max', 'Maximum Outflow'],
      'Outfall Loading Summary': ['Outfall Node', 'Flow Freq Pcnt', 'Avg Flow', 'Max Flow', 'Total Volume'],
      'Link Flow Summary': ['Link', 'Type', 'Maximum |Flow|', 'Day of Max', 'Time of Max', 'Maximum |Veloc|', 'Max/Full Flow', 'Max/Full Depth'],
      'Conduit Surcharge Summary': ['Conduit', 'Hours Both Ends Full', 'Hours Upstream Full', 'Hours Dnstream Full', 'Hours Above Full Normal Flow', 'Hours Capacity Limited'],
      'Subcatchment Runoff Summary': ['Subcatchment', 'Total Precip', 'Total Runon', 'Total Evap', 'Total Infil', 'Imperv Runoff', 'Perv Runoff', 'Total Runoff (depth)', 'Total Runoff (volume)', 'Peak Runoff', 'Runoff Coeff'],
      'Flow Classification Summary': ['Conduit', 'Adjusted/Actual Length', 'Dry', 'Up Dry', 'Down Dry', 'Sub Crit', 'Sup Crit', 'Up Crit', 'Down Crit', 'Norm Ltd', 'Inlet Ctrl'],
      'Pumping Summary': ['Pump', 'Percent Utilized', 'Number of Start-Ups', 'Min Flow', 'Avg Flow', 'Max Flow', 'Total Volume', 'Power Usage', '% Time Below Pump Curve', '% Time Above Pump Curve'],
    };
    for (let i = 1; i < L.length - 1; i++) {
      const title = L[i].trim();
      if (!COLS[title] || !/^\s*\*{5,}/.test(L[i - 1]) || !/^\s*\*{5,}/.test(L[i + 1])) continue;
      let j = i + 2; while (j < L.length && !/^\s*-{10,}/.test(L[j])) { if (/^\s*\*{5,}/.test(L[j])) break; j++; }
      j++; while (j < L.length && !/^\s*-{10,}/.test(L[j])) j++;
      j++; const rows = [];
      for (; j < L.length; j++) { const t = L[j].trim(); if (!t) break; if (/^-{10,}/.test(t)) continue; rows.push(t.split(/\s+/)); }
      const cols = COLS[title].slice(); const maxLen = rows.reduce((a, r) => Math.max(a, r.length), 0); while (cols.length < maxLen) cols.push('Col ' + (cols.length + 1));
      out[title] = { cols, rows };
    }
    return out;
  };

  // ================================================================== ICM-style graph panel
  const GVARS = {
    link: [['Flow', 0, true], ['Depth', 1, true], ['Velocity', 2, true], ['Capacity', 4, false], ['Volume', 3, false]],
    node: [['Level (HGL)', 1, true], ['Depth', 0, false], ['Total Inflow', 4, true], ['Flooding', 5, true], ['Lateral Inflow', 3, false], ['Volume', 2, false]],
    subcatch: [['Rainfall', 0, true], ['Runoff', 4, true], ['Infiltration', 3, false], ['Evaporation', 2, false]],
  };
  class GraphPanel {
    constructor(feat, objs) {
      this.feat = feat; this.app = feat.app; this.follow = true; this.showRain = true; this.xmode = 'h'; this.cache = new Map();
      this.vars = {}; for (const k in GVARS) this.vars[k] = new Set(GVARS[k].filter(v => v[2]).map(v => v[1]));
      this.objs = (objs || []).filter(o => kindToType(o.kind)).slice(0, 10);
      this.tags = h('span', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', flex: 1 } });
      const followChk = h('input', { type: 'checkbox', checked: true, onchange: (e) => { this.follow = e.target.checked; } });
      const xSel = h('select', { onchange: () => { this.xmode = xSel.value; this.render(); } }, [['h', 'Elapsed hours'], ['d', 'Date/time']].map(([v, l]) => h('option', { value: v }, l)));
      this.varBar = h('div', { class: 'followbar', style: { background: '#fff' } });
      this.stack = h('div', { class: 'graphstack' });
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h('div', { class: 'followbar' }, h('label', { title: 'When on, the graph shows whatever is selected on the map' }, followChk, ' Follow map selection'),
          h('label', { title: 'Show the rainfall feeding the selected objects above the result graphs' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { this.showRain = e.target.checked; this.render(); } }), ' Rainfall'), xSel,
          this.app.sim.makePlayButton(), h('button', { class: 'btn small', onclick: () => this.exportCSV() }, 'CSV'), this.tags), this.varBar, this.stack);
      this.panel = AV.floatPanel({ title: 'Graph', w: 620, h: 560, body, onClose: () => this.dispose(), dock: () => this.dockAsTab() });
      this.panel.onResize = AV.debounce(() => this.charts && this.charts.forEach(c => c.resize()), 50);
      this.render();
    }
    dispose() { this.feat.graphs = (this.feat.graphs || []).filter(g => g !== this); AV.openCharts = (AV.openCharts || []).filter(c => !(this.charts || []).includes(c)); }
    dockAsTab() { this.dispose(); const ids = this.objs; if (ids.length) { const t = kindToType(ids[0].kind); this.app.sim.openPlot(t, t === 'subcatch' ? 4 : 0, ids.filter(o => kindToType(o.kind) === t).map(o => o.id), this.xmode, !!this.app.sim.compare); } }
    onSelection(sel) {
      if (!this.follow) return;
      const objs = sel.filter(o => kindToType(o.kind)).slice(0, 10);
      if (!objs.length) return;
      this.objs = objs; this.render();
    }
    async series(res, t, i, v) {
      const key = res.handle + ':' + t + ':' + i + ':' + v;
      if (!this.cache.has(key)) this.cache.set(key, await window.host.outSeries(res.handle, t, i, v));
      return this.cache.get(key);
    }
    async render() {
      const all = this.app.sim.sources(); this.scenOff = this.scenOff || new Set();
      const src = all.filter(x => !this.scenOff.has(x.name)); const multi = src.length > 1;
      AV.openCharts = (AV.openCharts || []).filter(c => !(this.charts || []).includes(c));
      this.charts = []; this.stack.innerHTML = ''; this.tags.innerHTML = '';
      for (const o of this.objs) this.tags.appendChild(h('span', { class: 'tag' }, o.id));
      // scenario picker (like Avaris: tick the runs to compare)
      if (this.scenBox) this.scenBox.remove(); this.scenBox = null;
      if (all.length > 1) {
        this.scenBox = h('div', { class: 'scenpick' }, h('b', null, 'Scenarios'), all.map(x => h('label', { title: x.res.meta && x.res.meta.file || '' }, h('input', { type: 'checkbox', checked: !this.scenOff.has(x.name), onchange: (e) => { e.target.checked ? this.scenOff.delete(x.name) : this.scenOff.add(x.name); this.render(); } }), ' ' + x.name)));
        this.varBar.after(this.scenBox);
      }
      if (!all.length) { this.stack.appendChild(h('div', { class: 'empty' }, 'No results loaded.')); return; }
      if (!src.length) { this.stack.appendChild(h('div', { class: 'empty' }, 'Tick at least one scenario.')); return; }
      if (!this.objs.length) { this.stack.appendChild(h('div', { class: 'empty' }, 'Select one or more nodes, links or subcatchments on the map.', h('br'), 'The graph follows the map selection.')); return; }
      const R = src[0].res; const UR = this.app.results || (all.find(x => x.res.unitsFor) || {}).res || R;
      const kinds = [...new Set(this.objs.map(o => kindToType(o.kind)))];
      this.varBar.innerHTML = '';
      for (const k of kinds) {
        this.varBar.appendChild(h('b', null, ({ node: 'Nodes', link: 'Links', subcatch: 'Subcatchments' })[k] + ':'));
        for (const [n, v] of GVARS[k]) this.varBar.appendChild(h('label', null, h('input', { type: 'checkbox', checked: this.vars[k].has(v), onchange: (e) => { e.target.checked ? this.vars[k].add(v) : this.vars[k].delete(v); this.render(); } }), ' ' + n));
      }
      const meta = R.meta;
      const xs = (m) => { const a = new Float64Array(m.nPeriods); for (let i = 0; i < m.nPeriods; i++) a[i] = this.xmode === 'd' ? m.startDate + (i + 1) * m.reportStep / 86400 : (i + 1) * m.reportStep / 3600; return a; };
      const X = xs(meta); const XS = src.map(x => xs(x.res.meta));
      const per = this.app.results ? this.app.results.period : 0;
      const marker = this.xmode === 'd' ? meta.startDate + (per + 1) * meta.reportStep / 86400 : (per + 1) * meta.reportStep / 3600;
      const title = this.objs.length === 1 && this.objs[0].mesh ? '2D Cell ' + this.objs[0].id : this.objs.length === 1 ? (this.objs[0].kind === 'NODE' || this.objs[0].kind === 'LINK' ? this.objs[0].type.charAt(0) + this.objs[0].type.slice(1).toLowerCase() : 'Subcatchment') + ' ' + this.objs[0].id : this.objs.length + ' objects';
      this.panel.setTitle('Graph - ' + title + (multi ? '  (' + src.length + ' scenarios)' : ''));
      const inv = this.app.prefs.invertRain;
      const SC = ['#e040fb', '#e91e63', '#1e88e5', '#43a047', '#fb8c00', '#00acc1', '#6d4c41', '#3949ab'];
      if (this.showRain && !kinds.includes('subcatch')) {
        // precipitation for the selected nodes / links: from the subcatchment(s) draining to them, else system rainfall
        const m = this.app.model; const rs = [];
        const subFor = (o) => { const nid = o.kind === 'LINK' ? o.from : o.id; for (const sc of m.subcatchments.values()) if (sc.p.outlet === nid) return sc; return null; };
        const seen = new Set();
        for (const o of this.objs) { const sc = subFor(o); if (!sc) continue; const g = sc.p.gage || sc.id; if (seen.has(g)) continue; seen.add(g); const i = R.idx.subcatch.get(sc.id); if (i !== undefined) rs.push({ name: '[' + g + '] (Precipitation)', x: X, y: await this.series(R, 'subcatch', i, 0), color: '#b39ddb', bars: true }); }
        if (!rs.length) rs.push({ name: 'System (Precipitation)', x: X, y: await this.series(R, 'system', 0, 1), color: '#b39ddb', bars: true });
        const box = h('div', { class: 'gpanel rain' }); this.stack.appendChild(box);
        const ch = new AV.Chart(box, {}); ch.dateMode = this.xmode === 'd'; ch.markerX = marker; ch.setSeries(rs, { title: '', invert: inv, yLabel: 'Precipitation (' + UR.unitsFor('subcatch', 0) + ')', xLabel: '', xFmt: this.xmode === 'd' ? (x) => AV.fmtDateTime(x).slice(0, 16) : null });
        this.charts.push(ch);
      }
      for (const k of kinds) {
        const objs = this.objs.filter(o => kindToType(o.kind) === k);
        for (const [name, v] of GVARS[k]) {
          if (!this.vars[k].has(v)) continue;
          const series = [];
          for (const [oi, o] of objs.entries()) {
            const col = AV.SERIES_COLORS[oi % AV.SERIES_COLORS.length];
            const isRain = k === 'subcatch' && v === 0;
            for (const [si, S] of src.entries()) {
              const i = S.res.idx[k].get(o.id); if (i === undefined) continue;
              const nm = multi ? '[' + S.name + ']' + (objs.length > 1 ? ' ' + o.id : '') + '  (' + name + ')' : o.id;
              const c = multi ? (objs.length > 1 ? col : SC[si % SC.length]) : (isRain ? ['#b39ddb', '#7986cb', '#4fc3f7', '#81c784'][oi % 4] : col);
              series.push({ name: nm, x: XS[si], y: await this.series(S.res, k, i, v), color: c, dash: multi && objs.length > 1 && si > 0 ? [[6, 4], [2, 3], [10, 3, 2, 3]][(si - 1) % 3] : null, width: multi ? 2 : undefined, bars: !multi && isRain && objs.length <= 4 });
            }
            if (k === 'node' && v === 1 && objs.length <= 3) {
              const iv = +o.p.elev, rim = iv + (+o.p.maxDepth || 0);
              series.push({ name: o.id + ' invert', x: Float64Array.from([X[0], X[X.length - 1]]), y: Float32Array.from([iv, iv]), color: '#8d6e63', dash: [2, 3], width: 1 });
              if (o.type !== 'OUTFALL') series.push({ name: o.id + ' ground', x: Float64Array.from([X[0], X[X.length - 1]]), y: Float32Array.from([rim, rim]), color: '#6d4c41', dash: [8, 3], width: 1.2 });
            }
          }
          const box = h('div', { class: 'gpanel' }); this.stack.appendChild(box);
          const ch = new AV.Chart(box, {});
          ch.setSeries(series, { invert: k === 'subcatch' && v === 0 && inv, title: name, yLabel: name + ' (' + UR.unitsFor(k, v) + ')', xLabel: this.xmode === 'd' ? 'Date / Time' : 'Elapsed Time (hours)', xFmt: this.xmode === 'd' ? (x) => AV.fmtDateTime(x).slice(0, 16) : null });
          ch.dateMode = this.xmode === 'd'; ch.markerX = marker;
          this.charts.push(ch);
        }
      }
      for (const c of this.charts) c.peers = this.charts.filter(x => x !== c);
      AV.openCharts = (AV.openCharts || []).concat(this.charts);
      setTimeout(() => this.charts.forEach(c => c.resize()), 20);
    }
    exportCSV() { if (!this.charts || !this.charts.length) return; AV.downloadText(this.charts.map(c => '# ' + c.title + '\n' + c.toCSV()).join('\n\n'), 'graph.csv'); }
  }

  // ================================================================== long section panel (pick start/end on map)
  class ProfilePanel {
    constructor(feat, from, to) {
      this.feat = feat; this.app = feat.app; this.from = from || null; this.to = to || null; this.armed = 'from';
      const sel = [...this.app.selection];
      if (!this.from) {
        const nodes = sel.filter(o => o.kind === 'NODE'), links = sel.filter(o => o.kind === 'LINK');
        if (nodes.length >= 2) { this.from = nodes[0].id; this.to = nodes[nodes.length - 1].id; }
        else if (links.length) { const ids = new Set(links.map(l => l.id)); let st = links.find(l => !links.some(k => k.to === l.from)) || links[0]; const chain = [st]; let c = st; for (; ;) { const nx = links.find(l => l.from === c.to && ids.has(l.id) && !chain.includes(l)); if (!nx) break; chain.push(nx); c = nx; } this.from = chain[0].from; this.to = chain[chain.length - 1].to; }
        else if (nodes.length === 1) { this.from = nodes[0].id; this.armed = 'to'; }
      }
      this.info = h('span', { style: { color: 'var(--muted)' } });
      this.host = h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } });
      this.grid = h('div', { class: 'lsgrid' });
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h('div', { class: 'followbar' }, h('button', { class: 'btn small primary', onclick: () => this.pick() }, '⌖ Pick on Map'),
          h('button', { class: 'btn small', title: 'Build the long section from the nodes / links selected on the map (e.g. a traced path)', onclick: () => this.useSelection() }, 'Use Selection'),
          this.info),
        this.host);
      this.panel = AV.floatPanel({ title: 'Long Section', w: 900, h: 660, body, onClose: () => { this.feat.endPick(); this.dispose(); }, dock: () => { if (this.from && this.to) this.app.sim.openProfile(this.from, this.to); this.dispose(); } });
      this.panel.onResize = AV.debounce(() => this.view && this.view.resize(), 50);
      this.build();
      if (!this.from || !this.to) this.pick();
    }
    // end nodes of the current map selection: the selected links (plus links between selected nodes) form a chain;
    // its most upstream end is the start and its most downstream end the end of the section
    useSelection() {
      const app = this.app, m = app.model; let sel = [...app.selection];
      const enough = (a) => a.filter(o => o.kind === 'LINK').length >= 1 || a.filter(o => o.kind === 'NODE').length >= 2;
      if (!enough(sel) && app.map.highlight && app.map.highlight.size) sel = sel.concat([...app.map.highlight]);
      const nodeIds = new Set(sel.filter(o => o.kind === 'NODE').map(o => o.id));
      let links = sel.filter(o => o.kind === 'LINK');
      for (const l of links) { nodeIds.add(l.from); nodeIds.add(l.to); }
      if (!links.length && nodeIds.size >= 2) links = [...m.links.values()].filter(l => nodeIds.has(l.from) && nodeIds.has(l.to));
      if (nodeIds.size < 2) { AV.toast('Select at least two nodes, or the links of a path (e.g. with Tools > Path / Upstream / Downstream).', true); return; }
      const inD = new Map(), outD = new Map(); for (const id of nodeIds) { inD.set(id, 0); outD.set(id, 0); }
      for (const l of links) { outD.set(l.from, (outD.get(l.from) || 0) + 1); inD.set(l.to, (inD.get(l.to) || 0) + 1); }
      const inv = (id) => { const n = m.nodes.get(id); return n ? +n.p.elev : 0; };
      const ids = [...nodeIds].filter(id => m.nodes.has(id));
      let starts = ids.filter(id => inD.get(id) === 0 && outD.get(id) > 0), ends = ids.filter(id => outD.get(id) === 0 && inD.get(id) > 0);
      if (!starts.length) starts = ids.slice(); if (!ends.length) ends = ids.slice();
      starts.sort((a, b) => inv(b) - inv(a)); ends.sort((a, b) => inv(a) - inv(b));
      // pick the start/end pair that gives the longest connected path
      let best = null;
      for (const a of starts.slice(0, 6)) for (const b of ends.slice(0, 6)) {
        if (a === b) continue; const p = AV.findPath(m, a, b, true) || AV.findPath(m, a, b, false);
        if (p && (!best || p.nodes.length > best.n)) best = { a, b, n: p.nodes.length };
      }
      if (!best) { AV.toast('The selected objects are not connected.', true); return; }
      this.feat.endPick(); this.from = best.a; this.to = best.b; this.armed = 'from'; this.build();
      AV.toast('Long section ' + best.a + ' → ' + best.b + ' (' + best.n + ' nodes).');
    }
    dispose() { if (this.view) this.app.sim.profileViews = this.app.sim.profileViews.filter(v => v !== this.view); this.feat.profiles = (this.feat.profiles || []).filter(p => p !== this);
      // the path highlight belongs to this window: remove it so the map does not look selected after closing
      if (this._hi && this.app.map.highlight === this._hi) { this.app.map.highlight = new Set(); this.app.map.redrawOverlay(); } }
    pick() {
      this.feat.startPick({ kinds: ['NODE'], hint: 'Long section: click the upstream node, then the downstream node (click again to change the end).', onPick: (hit) => {
        if (!hit) return;
        if (this.armed === 'from' || !this.from) { this.from = hit.id; this.to = null; this.armed = 'to'; this.app.map.highlight = this._hi = new Set([hit]); this.app.map.redrawOverlay(); this.info.textContent = 'Start ' + hit.id + ' - now click the end node.'; }
        else { this.to = hit.id; this.armed = 'from'; this.build(); }
      } });
    }
    build() {
      if (this.view) this.app.sim.profileViews = this.app.sim.profileViews.filter(v => v !== this.view);
      this.host.innerHTML = '';
      if (!this.from || !this.to) { this.host.appendChild(h('div', { class: 'empty' }, 'Click the start node and then the end node on the map.')); return; }
      const m = this.app.model;
      const path = AV.findPath(m, this.from, this.to, true) || AV.findPath(m, this.from, this.to, false);
      if (!path) { this.host.appendChild(h('div', { class: 'empty' }, 'No connected path from ' + this.from + ' to ' + this.to + '.')); return; }
      const objs = path.nodes.map(id => m.nodes.get(id)).concat(path.links.map(x => x.link));
      this.app.map.highlight = this._hi = new Set(objs); this.app.map.redrawOverlay();
      this.view = new AV.ProfileView(this.app, path);
      this.view.el.style.flex = '1'; this.view.el.style.display = 'flex'; this.view.el.style.flexDirection = 'column'; this.view.el.style.minHeight = '0';
      this.host.appendChild(this.view.el); this.app.sim.profileViews.push(this.view);
      this.panel.setTitle('Long Section: ' + this.from + ' → ' + this.to);
      this.info.textContent = path.nodes.length + ' nodes, ' + path.links.length + ' links';
      setTimeout(() => this.view.resize(), 20);
    }
    fillGrid() {
      const v = this.view; if (!v || !v.pts) return;
      const hNow = v.heads(false), hMax = v.heads(true);
      const rows = [];
      v.pts.forEach((p, i) => {
        const s = v.segs[i];
        rows.push(h('tr', { style: { cursor: 'pointer' }, onclick: () => this.app.select(p.n) }, h('td', null, p.id), h('td', { class: 'num' }, AV.fmt(p.x, 1)), h('td', { class: 'num' }, AV.fmt(p.rim, 3)), h('td', { class: 'num' }, AV.fmt(p.inv, 3)),
          h('td', { class: 'num' }, hNow && hNow[i] !== null ? AV.fmt(hNow[i], 3) : ''), h('td', { class: 'num' }, hMax && hMax[i] !== null ? AV.fmt(hMax[i], 3) : ''),
          h('td', null, s ? s.L.id : ''), h('td', { class: 'num' }, s ? AV.fmt(s.x2 - s.x1, 2) : ''), h('td', { class: 'num' }, s && s.hgt ? AV.fmt(s.hgt, 3) : ''), h('td', { class: 'num' }, s ? AV.fmt((s.z1 - s.z2) / ((s.x2 - s.x1) || 1) * 100, 3) : '')));
      });
      this.grid.innerHTML = '';
      this.grid.appendChild(h('table', { class: 'grid', style: { width: '100%' } }, h('thead', null, h('tr', null, ['Node', 'Chainage', 'Ground', 'Invert', 'HGL', 'Max HGL', 'Link to next', 'Length', 'Size', 'Gradient %'].map(c => h('th', null, c)))), h('tbody', null, rows)));
    }
  }
  AV.GraphPanel = GraphPanel; AV.ProfilePanel = ProfilePanel;
})(window.AV);
