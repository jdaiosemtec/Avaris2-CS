// Long-section (profile) view: soil, manhole shafts, pipes, water (current HGL), max HGL / EGL, information table
'use strict';
(function (AV) {
  const h = AV.h;

  // columns the information table can show (Profile Settings)
  const COLS = {
    general: {
      node: [['invert', 'Chamber Floor Elev.'], ['ndepth', 'Chamber Depth'], ['ground', 'Rim Elevation']],
      link: [['inOff', 'In Offset'], ['outOff', 'Out Offset'], ['length', 'Length'], ['size', 'Size'], ['gradient', 'Gradient %'], ['rough', 'Roughness'], ['shape', 'Shape']],
    },
    stats: {
      node: [['maxDepth', 'Max. Depth'], ['maxHGL', 'Max. HGL'], ['minFree', 'Min. Freeboard'], ['nOcc', 'Occ. Date/Time'], ['maxLat', 'Max. Lateral Inflow'], ['maxTot', 'Max. Total Inflow'],
        ['latVol', 'Lateral Inflow Volume'], ['totVol', 'Total Inflow Volume'], ['balErr', 'Flow Balance Error %'], ['hrsSur', 'Hours Surcharged'], ['aboveCrown', 'Max. Height Above Crown'], ['belowRim', 'Min. Depth Below Rim'],
        ['hrsFlood', 'Hours Flooded'], ['maxFlood', 'Max. Flood Rate'], ['floodVol', 'Total Flood Volume'], ['pondDepth', 'Max. Ponded Depth']],
      link: [['maxFlow', 'Max. Flow'], ['maxVel', 'Max. Velocity'], ['maxCap', 'Max. Capacity d/D'], ['mfFlow', 'Max. / Full Flow'], ['lOcc', 'Occ. Date/Time'], ['maxLDepth', 'Max. Link Depth'],
        ['hfBoth', 'Hours Full (Both Ends)'], ['hfUp', 'Hours Full (Upstream)'], ['hfDn', 'Hours Full (Downstream)'], ['hAboveNormal', 'Hours Above Full Normal Flow'], ['hCapLim', 'Hours Capacity Limited']],
    },
    dyn: {
      node: [['depth', 'Depth'], ['hgl', 'HGL'], ['vol', 'Volume'], ['lat', 'Lateral Inflow'], ['tot', 'Total Inflow'], ['flood', 'Flooding']],
      link: [['flow', 'Flow'], ['ldepth', 'Link Depth'], ['vel', 'Velocity'], ['cap', 'Capacity d/D']],
    },
  };
  const NODE_KEYS = new Set([].concat(...['general', 'stats', 'dyn'].map(k => COLS[k].node.map(x => x[0]))));
  const LABEL = {}; for (const k of ['general', 'stats', 'dyn']) for (const [c, l] of COLS[k].node.concat(COLS[k].link)) LABEL[c] = l;
  const DEFAULT_OPT = { nodes: true, maxHGL: true, egl: false, table: true, cols: ['invert', 'ndepth', 'minFree', 'maxTot', 'inOff', 'outOff', 'size'] };
  AV.profileOptions = (app) => { const o = Object.assign({}, DEFAULT_OPT, app.prefs.profile || {}); o.cols = (o.cols || DEFAULT_OPT.cols).slice(); return o; };

  AV.profileSettingsDialog = async function (app) {
    const o = AV.profileOptions(app); const sel = new Set(o.cols);
    const chk = (v) => h('input', { type: 'checkbox', checked: !!v });
    const c1 = chk(o.nodes), c2 = chk(o.egl), c3 = chk(o.maxHGL), c4 = chk(o.table);
    const boxes = {};
    const list = (items) => h('div', { class: 'pslist' }, items.map(([k, l]) => { const b = chk(sel.has(k)); boxes[k] = b; return h('label', null, b, ' ' + l); }));
    const pages = {}, tabs = h('div', { class: 'tabs2' });
    const body = h('div', { class: 'psbox' },
      h('div', { class: 'psflags' }, h('label', null, c1, ' Node Visible'), h('label', null, c2, ' EGL Visible'), h('label', null, c3, ' Max. HGL Visible'), h('label', null, c4, ' Information Table Visible')), tabs);
    [['general', 'General Properties'], ['stats', 'Statistic Results'], ['dyn', 'Dynamic Results']].forEach(([k, l], i) => {
      pages[k] = h('div', { class: 'pspage', style: { display: i ? 'none' : 'flex' } },
        h('div', null, h('div', { class: 'psh' }, 'Node'), list(COLS[k].node)), h('div', null, h('div', { class: 'psh' }, 'Link'), list(COLS[k].link)));
      tabs.appendChild(h('div', { class: 't2' + (i ? '' : ' active'), onclick: (e) => { AV.$$('.t2', tabs).forEach(t => t.classList.remove('active')); e.target.classList.add('active'); for (const p in pages) pages[p].style.display = p === k ? 'flex' : 'none'; } }, l));
      body.appendChild(pages[k]);
    });
    const r = await AV.modal({ title: 'Profile Settings', body, buttons: [{ label: 'OK', primary: true, value: true }, { label: 'Cancel', value: null }] }).done;
    if (!r) return false;
    const order = [].concat(...['general', 'stats', 'dyn'].map(k => COLS[k].node.concat(COLS[k].link).map(x => x[0])));
    app.prefs.profile = { nodes: c1.checked, egl: c2.checked, maxHGL: c3.checked, table: c4.checked, cols: order.filter(k => boxes[k] && boxes[k].checked) };
    app.savePrefs();
    for (const v of app.sim.profileViews) v.applyOptions();
    return true;
  };

  class ProfileView {
    constructor(app, path) {
      this.app = app; this.path = path; this.opt = AV.profileOptions(app);
      this.el = h('div', { class: 'profview' });
      const sim = app.sim;
      this.slider = h('input', { type: 'range', min: 0, max: 0, value: 0, style: { flex: 1, minWidth: '80px' }, oninput: (e) => sim.setPeriod(+e.target.value) });
      this.timeEl = h('span', { class: 'ptime' }, '');
      const tools = h('div', { class: 'chart-tools' },
        sim.makePlayButton(),
        h('button', { class: 'btn small', title: 'Previous time step', onclick: () => sim.results && sim.setPeriod(sim.results.period - 1) }, '‹'),
        h('button', { class: 'btn small', title: 'Next time step', onclick: () => sim.results && sim.setPeriod(sim.results.period + 1) }, '›'),
        this.timeEl, this.slider,
        h('button', { class: 'btn small', title: 'Choose what the profile and its information table show', onclick: () => AV.profileSettingsDialog(app) }, '⚙ Options'),
        h('button', { class: 'btn small', onclick: () => this.exportCSV() }, 'Export CSV'),
        h('button', { class: 'btn small', onclick: () => { const objs = path.nodes.map(id => app.model.nodes.get(id)).concat(path.links.map(x => x.link)); app.selectMany(objs.filter(Boolean)); app.activateView('map'); app.map.zoomToObjects(objs.filter(Boolean)); } }, 'Select on Map'),
        this.info = h('span', { style: { marginLeft: '6px', color: 'var(--muted)' } }));
      this.box = h('div', { class: 'chartbox' }); this.canvas = h('canvas'); this.box.appendChild(this.canvas);
      this.tableEl = h('div', { class: 'lsgrid' });
      this.el.append(tools, this.box);
      this.ctx = this.canvas.getContext('2d');
      new ResizeObserver(() => this.resize()).observe(this.box);
      this.bindMouse();
      const un = app.on('selection', () => { if (!this.el.isConnected) { un(); return; } this.draw(); });
      this.compute(); this.applyOptions(true);
    }
    get showMax() { return this.opt.maxHGL; }
    applyOptions(noDraw) { this.opt = AV.profileOptions(this.app); if (!noDraw) { this.draw(); } }
    compute() {
      const m = this.app.model, offElev = (m.options.LINK_OFFSETS || 'DEPTH').toUpperCase() === 'ELEVATION';
      const P = this.path; this.pts = []; this.segs = [];
      let x = 0;
      P.nodes.forEach((id, i) => {
        const n = m.nodes.get(id);
        if (i > 0) { const L = P.links[i - 1].link; x += (L.type === 'CONDUIT' ? +L.p.length : 0) || m.linkLengthGeom(L) || 10; }
        this.pts.push({ id, n, x, inv: +n.p.elev, rim: n.type === 'OUTFALL' ? null : +n.p.elev + (+n.p.maxDepth || 0) });
      });
      P.links.forEach(({ link: L, dir }, i) => {
        const a = this.pts[i], b = this.pts[i + 1];
        const o1 = L.type === 'CONDUIT' ? +L.p.inOff : (+L.p.offset || +L.p.crest || 0), o2 = L.type === 'CONDUIT' ? +L.p.outOff : 0;
        let z1, z2;
        if (dir > 0) { z1 = offElev ? o1 : a.inv + o1; z2 = offElev ? o2 : b.inv + o2; } else { z1 = offElev ? o2 : a.inv + o2; z2 = offElev ? o1 : b.inv + o1; }
        if (L.type !== 'CONDUIT') { z1 = a.inv + (dir > 0 ? o1 : 0); z2 = b.inv; }
        const hgt = L.type === 'CONDUIT' ? (parseFloat(L.p.g1) || 0) : 0;
        this.segs.push({ L, dir, x1: a.x, x2: b.x, z1, z2, hgt });
      });
      for (const p of this.pts) if (p.rim === null) { const s = this.segs.find(s => s.x2 === p.x || s.x1 === p.x); p.rim = p.inv + (s ? Math.max(s.hgt, 1) * 1.2 : 2); p.outfall = true; }
    }
    resize() { const r = this.box.getBoundingClientRect(); this.dpr = window.devicePixelRatio || 1; this.w = r.width; this.hh = r.height; this.canvas.width = this.w * this.dpr; this.canvas.height = this.hh * this.dpr; this.draw(); }
    heads(max) {
      const R = this.app.results; if (!R) return null;
      return this.pts.map(p => { const v = R.valueOf(p.n, 1, max); return v === null ? null : v; });
    }
    linkVal(L, v, max, abs) { const R = this.app.results; if (!R) return null; return R.valueOf(L, v, max, abs); }
    // ---- mouse: wheel = zoom along the profile, drag = pan, double-click = full extent, click = select object
    bindMouse() {
      const c = this.canvas; let drag = null;
      const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      c.addEventListener('wheel', (e) => {
        e.preventDefault(); const g = this.geo; if (!g) return; const [mx] = pos(e);
        const full = this.viewRange(); const span = g.X2 - g.X1; const xv = g.X1 + (Math.max(g.L, Math.min(g.L + g.W, mx)) - g.L) / g.W * span;
        let ns = span * (e.deltaY < 0 ? 0.8 : 1.25); ns = Math.max((full[1] - full[0]) * 0.01, Math.min(full[1] - full[0], ns));
        const f = (xv - g.X1) / span; let x1 = xv - f * ns, x2 = x1 + ns;
        if (x1 < full[0]) { x2 += full[0] - x1; x1 = full[0]; } if (x2 > full[1]) { x1 -= x2 - full[1]; x2 = full[1]; }
        this.view = ns >= full[1] - full[0] - 1e-9 ? null : [Math.max(full[0], x1), Math.min(full[1], x2)]; this.draw();
      }, { passive: false });
      c.addEventListener('mousedown', (e) => { if (e.button !== 0 || !this.geo) return; const [x, y] = pos(e); drag = { x, y, v: [this.geo.X1, this.geo.X2], moved: false }; });
      window.addEventListener('mousemove', (e) => {
        if (!drag) return; const [x] = pos(e); if (Math.abs(x - drag.x) > 3) drag.moved = true; if (!drag.moved || !this.view) return;
        const g = this.geo, full = this.viewRange(); const dx = (x - drag.x) / g.W * (drag.v[1] - drag.v[0]);
        let x1 = drag.v[0] - dx, x2 = drag.v[1] - dx; if (x1 < full[0]) { x2 += full[0] - x1; x1 = full[0]; } if (x2 > full[1]) { x1 -= x2 - full[1]; x2 = full[1]; }
        this.view = [x1, x2]; this.draw();
      });
      window.addEventListener('mouseup', (e) => { if (!drag) return; const d = drag; drag = null; if (!d.moved) this.clickAt(d.x, d.y, e); });
      c.addEventListener('dblclick', () => { this.view = null; this.draw(); });
      c.addEventListener('mousemove', (e) => { const [x, y] = pos(e); this.hover = x; this.hoverY = y; this.draw(); });
      c.addEventListener('mouseleave', () => { this.hover = null; this.draw(); });
    }
    fullRange() { return [this.pts[0].x, this.pts[this.pts.length - 1].x || 1]; }
    viewRange() { const [a, b] = this.fullRange(); const W = this.geo ? this.geo.W : 800; const p = (b - a) * 8 / Math.max(1, W - 16) || 1; return [a - p, b + p]; }
    clickAt(x, y, e) {
      const g = this.geo; if (!g) return; let obj = null;
      if (g.table && y >= g.table.y0 && y <= g.table.y1) { const hit = g.table.cells.find(c => x >= c.x1 && x <= c.x2 && y >= c.y1 && y <= c.y2); if (hit) obj = hit.o; }
      else if (y >= g.T && y <= g.T + g.H) {
        let best = null, bd = 12; this.pts.forEach(p => { const d = Math.abs(g.sx(p.x) - x); if (d < bd) { bd = d; best = p.n; } });
        if (!best) { const s = this.segs.find(s => x >= g.sx(s.x1) && x <= g.sx(s.x2)); if (s) best = s.L; }
        obj = best;
      }
      if (obj) this.app.select(obj, e.ctrlKey);
    }
    // values of one node (and the link that follows it) for the information table
    valuesAt(i) {
      const R = this.app.results; const p = this.pts[i], s = this.segs[i]; const L = s ? s.L : null, n = p.n;
      const hNow = this._hNow, hMax = this._hMaxAll;
      const nv = (o, v, max, abs) => R ? R.valueOf(o, v, max, abs) : null;
      const occ = (o, t, v) => { if (!R) return null; const r = R.index(o); if (!r) return null; const k = r.i * R.meta.nVars[t] + v; return R.timeLabel(R.stats[t].tmax[k]); };
      return {
        node: p.id, ground: p.outfall ? null : p.rim, invert: p.inv, ndepth: p.outfall ? null : p.rim - p.inv,
        link: L ? L.id : '', length: s ? s.x2 - s.x1 : '', size: s && s.hgt ? s.hgt : '', gradient: s ? (s.z1 - s.z2) / ((s.x2 - s.x1) || 1) * 100 : '',
        inOff: L ? (L.type === 'CONDUIT' ? +L.p.inOff : +(L.p.offset || L.p.crest || 0)) : '', outOff: L ? (L.type === 'CONDUIT' ? +L.p.outOff : '') : '',
        rough: L && L.type === 'CONDUIT' ? L.p.rough : '', shape: L && L.type === 'CONDUIT' ? L.p.shape : (L ? L.type : ''),
        maxDepth: nv(n, 0, true), maxHGL: hMax ? hMax[i] : null, minFree: hMax && hMax[i] !== null && !p.outfall ? p.rim - hMax[i] : null, nOcc: occ(n, 'node', 1),
        maxLat: nv(n, 3, true), maxTot: nv(n, 4, true), maxFlood: nv(n, 5, true),
        maxFlow: L ? nv(L, 0, true, true) : null, maxVel: L ? nv(L, 2, true) : null, maxCap: L ? nv(L, 4, true) : null, lOcc: L ? occ(L, 'link', 0) : null, maxLDepth: L ? nv(L, 1, true) : null,
        // report summary tables (as in the Avaris DS Statistic Results); objects missing from the surcharge / flooding tables had none
        ...(() => { if (!R) return {}; const rr = (t, id) => AV.rptRow(this.app, t, id); const f = (r, k, zero) => r ? (r[k] === undefined ? null : parseFloat(r[k])) : (zero ? 0 : null);
          const ni = rr('Node Inflow Summary', n.id), ns = rr('Node Surcharge Summary', n.id), nf = rr('Node Flooding Summary', n.id), lf = L ? rr('Link Flow Summary', L.id) : null, cs = L ? rr('Conduit Surcharge Summary', L.id) : null;
          const isC = L && L.type === 'CONDUIT', fl = !p.outfall;
          return { latVol: f(ni, 6), totVol: f(ni, 7), balErr: f(ni, 8), hrsSur: fl ? f(ns, 2, true) : null, aboveCrown: fl ? f(ns, 3, true) : null, belowRim: fl ? f(ns, 4, true) : null,
            hrsFlood: fl ? f(nf, 1, true) : null, floodVol: fl ? f(nf, 5, true) : null, pondDepth: fl ? f(nf, 6, true) : null,
            mfFlow: lf ? (isC ? f(lf, 6) : L.type === 'PUMP' ? f(lf, 5) : null) : null,
            hfBoth: isC ? f(cs, 1, true) : null, hfUp: isC ? f(cs, 2, true) : null, hfDn: isC ? f(cs, 3, true) : null, hAboveNormal: isC ? f(cs, 4, true) : null, hCapLim: isC ? f(cs, 5, true) : null }; })(),
        depth: nv(n, 0), hgl: hNow ? hNow[i] : null, vol: nv(n, 2), lat: nv(n, 3), tot: nv(n, 4), flood: nv(n, 5),
        flow: L ? nv(L, 0) : null, ldepth: L ? nv(L, 1) : null, vel: L ? nv(L, 2) : null, cap: L ? nv(L, 4) : null,
      };
    }
    draw() {
      if (!this.w) return;
      const R = this.app.results;
      if (R) { this.slider.max = R.meta.nPeriods - 1; this.slider.value = R.period; this.timeEl.textContent = R.timeLabel(R.period); } else { this.timeEl.textContent = 'No results'; }
      const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.w, this.hh);
      const pts = this.pts, segs = this.segs; if (!pts.length) return;
      const O = this.opt; const sel = this.app.selection;
      const hNow = this.heads(false), hMaxAll = this.heads(true), hMax = O.maxHGL ? hMaxAll : null;
      this._hNow = hNow; this._hMaxAll = hMaxAll;
      const g9 = this.app.model.isSI ? 9.81 : 32.2;
      const [F1, F2] = this.fullRange();
      // ---- layout: information table on top (Avaris style), chart below
      const nodeRows = O.table ? ['node'].concat(O.cols.filter(c => NODE_KEYS.has(c))) : [];
      const linkRows = O.table ? ['link'].concat(O.cols.filter(c => LABEL[c] && !NODE_KEYS.has(c))) : [];
      const RH = 19, TB = O.table ? (nodeRows.length + linkRows.length) * RH + 6 : 0;
      ctx.font = '12px Segoe UI'; const labW = O.table ? Math.max(...nodeRows.concat(linkRows).map(k => ctx.measureText(k === 'node' || k === 'link' ? 'ID' : LABEL[k]).width)) : 0;
      const L = O.table ? Math.max(70, Math.ceil(labW) + 36) : 64, Rr = 18, T = TB + 26, B = O.nodes ? 74 : 40, W = this.w - L - Rr, H = this.hh - T - B;
      if (W < 40 || H < 40) return;
      // no blank margin at the ends: just enough room for half a manhole shaft at the first / last node
      const PADX = (F2 - F1) * 8 / Math.max(1, W - 16) || 1;
      const X1 = this.view ? this.view[0] : F1 - PADX, X2 = this.view ? this.view[1] : F2 + PADX;
      const sx = (x) => L + (x - X1) / ((X2 - X1) || 1) * W;
      const vis = (x) => x >= X1 - (X2 - X1) * 0.02 && x <= X2 + (X2 - X1) * 0.02;
      // y range from what is visible
      let y1 = Infinity, y2 = -Infinity;
      pts.forEach((p, i) => { if (!vis(p.x) && !(i && vis(pts[i - 1].x)) && !(i < pts.length - 1 && vis(pts[i + 1].x))) return; y1 = Math.min(y1, p.inv); y2 = Math.max(y2, p.rim); if (hMax && hMax[i] !== null) y2 = Math.max(y2, hMax[i]); if (hNow && hNow[i] !== null) y2 = Math.max(y2, hNow[i]); });
      segs.forEach(s => { if (!(vis(s.x1) || vis(s.x2) || (s.x1 < X1 && s.x2 > X2))) return; y1 = Math.min(y1, s.z1, s.z2); y2 = Math.max(y2, s.z1 + s.hgt, s.z2 + s.hgt); });
      if (!isFinite(y1)) { y1 = 0; y2 = 1; }
      const pad = (y2 - y1) * 0.06 || 1; y1 -= pad; y2 += pad;
      const sy = (y) => T + H - (y - y1) / (y2 - y1) * H;
      const ticks = (a, b, n) => AV.Chart.prototype.ticks.call(null, a, b, n);
      const nVis = Math.max(1, pts.filter(p => p.x >= X1 && p.x <= X2).length);
      const mhW = Math.max(5, Math.min(14, W / nVis / 5)), half = mhW / 2;
      this.geo = { L, W, T, H, X1, X2, sx, table: null };
      // ---- information table
      if (O.table) this.drawTable(ctx, { L, W, RH, nodeRows, linkRows, sx, X1, X2, top: 4 });
      // ---- grid & axes
      ctx.strokeStyle = '#d5dbe0'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.fillStyle = '#546e7a'; ctx.font = '11px Segoe UI'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const t of ticks(y1, y2, 7)) { const y = Math.round(sy(t)) + .5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + W, y); ctx.stroke(); ctx.fillText(AV.fmt(t), L - 6, y); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const t of ticks(X1, X2, Math.max(3, Math.floor(W / 100)))) { const x = Math.round(sx(t)) + .5; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + H); ctx.stroke(); ctx.fillText(AV.fmt(t), x, T + H + 4); }
      ctx.setLineDash([]);
      const lu = this.app.lengthUnits();
      ctx.fillStyle = '#37474f'; ctx.fillText('Distance (' + lu + ')' + (this.view ? '   — wheel to zoom, drag to pan, double-click for full length' : ''), L + W / 2, T + H + 18);
      ctx.save(); ctx.translate(L - 46, T + H / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText('Elevation (' + lu + ')', 0, 0); ctx.restore();
      ctx.font = 'bold 12.5px Segoe UI'; ctx.textBaseline = 'middle'; ctx.fillText('Profile ' + pts[0].id + ' → ' + pts[pts.length - 1].id + (R ? '   ' + R.timeLabel(R.period) : ''), L + W / 2, T - 12);

      ctx.save(); ctx.beginPath(); ctx.rect(L, T, W, H); ctx.clip();
      // ---- geometry: the ground is flat across each manhole so shaft walls end exactly at the ground
      const ground = []; pts.forEach(p => { ground.push([sx(p.x) - half, sy(p.rim)], [sx(p.x) + half, sy(p.rim)]); });
      const pipes = segs.map((s, i) => {
        const xa = sx(s.x1) + half, xb = sx(s.x2) - half; const span = (sx(s.x2) - sx(s.x1)) || 1;
        const fa = half / span, fb = 1 - half / span;
        return { s, i, xa, xb, za: s.z1 + (s.z2 - s.z1) * fa, zb: s.z1 + (s.z2 - s.z1) * fb, ok: xb > xa };
      });
      const soil = new Path2D(); soil.moveTo(ground[0][0], T + H + 2); for (const q of ground) soil.lineTo(q[0], q[1]); soil.lineTo(ground[ground.length - 1][0], T + H + 2); soil.closePath();
      ctx.fillStyle = '#f5eb9c'; ctx.fill(soil);
      const cav = new Path2D();
      for (const q of pipes) if (q.ok && q.s.hgt > 0) { cav.moveTo(q.xa, sy(q.za)); cav.lineTo(q.xb, sy(q.zb)); cav.lineTo(q.xb, sy(q.zb + q.s.hgt)); cav.lineTo(q.xa, sy(q.za + q.s.hgt)); cav.closePath(); }
      for (const p of pts) cav.rect(sx(p.x) - half, sy(p.rim), mhW, sy(p.inv) - sy(p.rim));
      ctx.fillStyle = '#fff'; ctx.fill(cav);
      const WATER = '#29d3f5'; const ws = [];
      if (hNow) {
        ctx.fillStyle = WATER;
        pts.forEach((p, i) => { const hv = hNow[i]; if (hv === null || hv <= p.inv) return; const top = Math.min(hv, p.rim); ctx.fillRect(sx(p.x) - half, sy(top), mhW, sy(p.inv) - sy(top)); });
        for (const q of pipes) {
          const s = q.s; const dL = this.linkVal(s.L, 1, false) || 0; const hu = hNow[q.i], hd = hNow[q.i + 1];
          const wa = hu !== null && hu > q.za ? hu : q.za + dL, wb = hd !== null && hd > q.zb ? hd : q.zb + dL; ws[q.i] = { wa, wb };
          if (!q.ok || s.hgt <= 0) continue;
          ctx.save(); const cp = new Path2D(); cp.moveTo(q.xa, sy(q.za)); cp.lineTo(q.xb, sy(q.zb)); cp.lineTo(q.xb, sy(q.zb + s.hgt)); cp.lineTo(q.xa, sy(q.za + s.hgt)); cp.closePath(); ctx.clip(cp);
          ctx.beginPath(); ctx.moveTo(q.xa, sy(wa)); ctx.lineTo(q.xb, sy(wb)); ctx.lineTo(q.xb, T + H); ctx.lineTo(q.xa, T + H); ctx.closePath(); ctx.fill(); ctx.restore();
        }
        if (pts.some((p, i) => hNow[i] !== null && hNow[i] > p.rim + 1e-6 && !p.outfall)) { // surface flooding
          ctx.save(); const above = new Path2D(); above.moveTo(ground[0][0], T - 2); for (const q of ground) above.lineTo(q[0], q[1]); above.lineTo(ground[ground.length - 1][0], T - 2); above.closePath(); ctx.clip(above);
          ctx.beginPath(); pts.forEach((p, i) => { const v = hNow[i] === null ? p.rim : Math.max(hNow[i], p.rim); const X = sx(p.x); i ? ctx.lineTo(X - half, sy(v)) : ctx.moveTo(X - half, sy(v)); ctx.lineTo(X + half, sy(v)); });
          ctx.lineTo(ground[ground.length - 1][0], T + H); ctx.lineTo(ground[0][0], T + H); ctx.closePath(); ctx.fillStyle = 'rgba(41,211,245,.75)'; ctx.fill(); ctx.restore();
        }
      }
      // ---- outlines: pipes, shaft walls (open where pipes connect), ground
      ctx.lineWidth = 1; ctx.strokeStyle = '#8a8f94';
      for (const q of pipes) {
        if (!q.ok) continue;
        if (q.s.hgt > 0) { ctx.beginPath(); ctx.moveTo(q.xa, sy(q.za)); ctx.lineTo(q.xb, sy(q.zb)); ctx.moveTo(q.xa, sy(q.za + q.s.hgt)); ctx.lineTo(q.xb, sy(q.zb + q.s.hgt)); ctx.stroke(); }
        else { ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(q.xa, sy(q.za)); ctx.lineTo(q.xb, sy(q.zb)); ctx.stroke(); ctx.restore(); }
      }
      const wall = (x, zBot, zTop, gaps) => {
        gaps = gaps.filter(gp => gp[1] > gp[0]).sort((a, b) => a[0] - b[0]); let z = zBot; ctx.beginPath();
        for (const [g0, g1] of gaps) { if (g0 > z) { ctx.moveTo(x, sy(z)); ctx.lineTo(x, sy(Math.min(g0, zTop))); } z = Math.max(z, g1); }
        if (z < zTop) { ctx.moveTo(x, sy(z)); ctx.lineTo(x, sy(zTop)); } ctx.stroke();
      };
      pts.forEach((p, i) => {
        const x = sx(p.x), qi = pipes[i - 1], qo = pipes[i];
        wall(x - half, p.inv, p.rim, qi && qi.ok && qi.s.hgt > 0 ? [[qi.zb, qi.zb + qi.s.hgt]] : []);
        wall(x + half, p.inv, p.rim, qo && qo.ok && qo.s.hgt > 0 ? [[qo.za, qo.za + qo.s.hgt]] : []);
        ctx.beginPath(); ctx.moveTo(x - half, sy(p.inv)); ctx.lineTo(x + half, sy(p.inv)); ctx.stroke();
      });
      ctx.strokeStyle = '#8d7d3a'; ctx.lineWidth = 1.2; ctx.beginPath(); ground.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke();
      // selected nodes / links on the profile
      pts.forEach(p => { if (sel.has(p.n)) { ctx.fillStyle = 'rgba(0,229,255,.25)'; ctx.fillRect(sx(p.x) - half - 2, T, mhW + 4, H); } });
      pipes.forEach(q => { if (sel.has(q.s.L) && q.ok) { ctx.strokeStyle = '#00b8d4'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(q.xa, sy(q.za)); ctx.lineTo(q.xb, sy(q.zb)); ctx.moveTo(q.xa, sy(q.za + q.s.hgt)); ctx.lineTo(q.xb, sy(q.zb + q.s.hgt)); ctx.stroke(); } });
      // ---- HGL, EGL, max HGL
      if (hNow) {
        const pl = []; pts.forEach((p, i) => {
          const hv = hNow[i] === null ? p.inv : Math.max(hNow[i], p.inv);
          pl.push([sx(p.x) - (i ? half : 0), sy(hv)], [sx(p.x) + (i < pts.length - 1 ? half : 0), sy(hv)]);
          const w = ws[i], q = pipes[i]; if (w && q && q.ok) pl.push([q.xa, sy(w.wa)], [q.xb, sy(w.wb)]);
        });
        ctx.strokeStyle = '#0d47a1'; ctx.lineWidth = 1.6; ctx.beginPath(); pl.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])); ctx.stroke();
        if (O.egl) {
          ctx.strokeStyle = '#2e7d32'; ctx.setLineDash([6, 3]); ctx.lineWidth = 1.4; ctx.beginPath(); let st = false;
          for (const q of pipes) { const w = ws[q.i]; if (!w || !q.ok) continue; const v = Math.abs(this.linkVal(q.s.L, 2, false) || 0); const hv = v * v / (2 * g9); st ? ctx.lineTo(q.xa, sy(w.wa + hv)) : ctx.moveTo(q.xa, sy(w.wa + hv)); ctx.lineTo(q.xb, sy(w.wb + hv)); st = true; }
          ctx.stroke(); ctx.setLineDash([]);
        }
      }
      if (hMax) { ctx.strokeStyle = '#c62828'; ctx.setLineDash([7, 4]); ctx.lineWidth = 1.4; ctx.beginPath(); let st = false; hMax.forEach((v, i) => { if (v === null) { st = false; return; } const X = sx(pts[i].x), Y = sy(v); st ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); st = true; }); ctx.stroke(); ctx.setLineDash([]); }
      if (hNow) pts.forEach((p, i) => { if (hNow[i] !== null && hNow[i] >= p.rim - 1e-3 && !p.outfall) { ctx.fillStyle = '#d32f2f'; ctx.beginPath(); ctx.arc(sx(p.x), sy(Math.max(hNow[i], p.rim)) - 6, 3.5, 0, 7); ctx.fill(); } });
      ctx.restore();
      ctx.strokeStyle = '#90a4ae'; ctx.lineWidth = 1; ctx.strokeRect(L + .5, T + .5, W, H);
      // node labels
      if (O.nodes) {
        ctx.save(); ctx.beginPath(); ctx.rect(L - 30, T + H, W + 40, B); ctx.clip();
        ctx.fillStyle = '#263238'; ctx.font = '10.5px Segoe UI'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const every = Math.max(1, Math.ceil(nVis / (W / 14)));
        pts.forEach((p, i) => { if (i % every || !vis(p.x)) return; ctx.save(); ctx.translate(sx(p.x), T + H + 30); ctx.rotate(-Math.PI / 3); ctx.fillStyle = sel.has(p.n) ? '#00838f' : '#263238'; ctx.fillText(p.id, 0, 0); ctx.restore(); });
        ctx.restore();
      }
      // legend
      ctx.font = '11px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const lg = [['box', '#f5eb9c', 'Ground'], ['box', WATER, 'Water'], ['line', '#0d47a1', 'HGL', []]];
      if (O.egl) lg.push(['line', '#2e7d32', 'EGL', [6, 3]]); if (O.maxHGL) lg.push(['line', '#c62828', 'Max HGL', [7, 4]]);
      const lw = lg.reduce((a, x) => a + 30 + ctx.measureText(x[2]).width, 0);
      let lx = L + W - lw - 6; ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(lx - 6, T + 3, lw + 8, 17);
      lg.forEach(([k, c, t, d]) => { if (k === 'box') { ctx.fillStyle = c; ctx.fillRect(lx, T + 6, 16, 10); ctx.strokeStyle = '#90a4ae'; ctx.strokeRect(lx + .5, T + 6.5, 16, 10); } else { ctx.strokeStyle = c; ctx.setLineDash(d); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx, T + 11); ctx.lineTo(lx + 16, T + 11); ctx.stroke(); ctx.setLineDash([]); } ctx.fillStyle = '#37474f'; ctx.fillText(t, lx + 20, T + 11); lx += 30 + ctx.measureText(t).width; });
      // hover read-out
      if (this.hover !== null && this.hover !== undefined && this.hover >= L && this.hover <= L + W && this.hoverY >= T) {
        const xv = X1 + (this.hover - L) / W * (X2 - X1);
        let best = 0; pts.forEach((p, i) => { if (Math.abs(p.x - xv) < Math.abs(pts[best].x - xv)) best = i; });
        const p = pts[best]; const X = sx(p.x);
        ctx.strokeStyle = '#ff6d00'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, T + H); ctx.stroke();
        const lines = ['Node ' + p.id, 'Invert ' + AV.fmt(p.inv, 3), 'Rim ' + AV.fmt(p.rim, 3)];
        if (hNow && hNow[best] !== null) lines.push('HGL ' + AV.fmt(hNow[best], 3) + '  (depth ' + AV.fmt(hNow[best] - p.inv, 3) + ')');
        if (hMaxAll && hMaxAll[best] !== null) lines.push('Max HGL ' + AV.fmt(hMaxAll[best], 3));
        const seg = segs.find(s => xv >= s.x1 && xv <= s.x2); if (seg) lines.push('Link ' + seg.L.id + (seg.hgt ? '  D=' + AV.fmt(seg.hgt) : '') + '  S=' + AV.fmt((seg.z1 - seg.z2) / ((seg.x2 - seg.x1) || 1) * 100, 3) + '%');
        ctx.font = '11.5px Segoe UI'; const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14; let bx = X + 10; if (bx + bw > L + W) bx = X - bw - 10;
        ctx.fillStyle = 'rgba(38,50,56,.92)'; ctx.fillRect(bx, T + 24, bw, lines.length * 16 + 6); ctx.fillStyle = '#fff'; lines.forEach((l, i) => ctx.fillText(l, bx + 7, T + 33 + i * 16));
      }
      this.info.textContent = pts.length + ' nodes, ' + segs.length + ' links, ' + AV.fmt(F2 - F1, 1) + ' ' + lu + (this.view ? ' (zoomed)' : '');
    }
    // Avaris-style information table: node values centred on each manhole, link values spanning each pipe;
    // the selected node / link column is highlighted, click a cell to select that object
    drawTable(ctx, g) {
      const pts = this.pts, segs = this.segs, sel = this.app.selection;
      const { L, W, RH, nodeRows, linkRows, sx, top } = g;
      const vals = pts.map((p, i) => this.valuesAt(i));
      const f = (v) => v === null || v === undefined || v === '' ? '-' : typeof v === 'number' ? AV.fmt(v, 2) : String(v);
      const cells = []; const y0 = top, nodeY = y0, linkY = y0 + nodeRows.length * RH, y1 = linkY + linkRows.length * RH;
      ctx.save();
      ctx.fillStyle = '#fafbfc'; ctx.fillRect(0, y0, L, y1 - y0);
      ctx.font = '12px Segoe UI'; ctx.textBaseline = 'middle';
      // group captions + row labels
      const cap = (txt, ya, yb) => { ctx.save(); ctx.translate(12, (ya + yb) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = '#90a4ae'; ctx.fillText(txt, 0, 0); ctx.restore(); };
      cap('Node', nodeY, linkY); cap('Link', linkY, y1);
      ctx.textAlign = 'right'; ctx.fillStyle = '#546e7a';
      nodeRows.forEach((k, r) => ctx.fillText(k === 'node' ? 'ID' : LABEL[k], L - 8, nodeY + r * RH + RH / 2));
      linkRows.forEach((k, r) => ctx.fillText(k === 'link' ? 'ID' : LABEL[k], L - 8, linkY + r * RH + RH / 2));
      ctx.beginPath(); ctx.rect(L, y0, W, y1 - y0); ctx.clip();
      // node columns: boundaries half way to the neighbours
      const xs = pts.map(p => sx(p.x));
      const cellText = (txt, x1, x2, y, hi) => {
        if (x2 < L || x1 > L + W) return;
        x1 = Math.max(L, x1); x2 = Math.min(L + W, x2);
        if (hi) { ctx.fillStyle = '#00e5ff'; ctx.fillRect(x1, y, x2 - x1, RH); }
        ctx.strokeStyle = '#cfd8dc'; ctx.strokeRect(Math.round(x1) + .5, Math.round(y) + .5, Math.round(x2 - x1), RH);
        const w = x2 - x1; if (w < 14) return; ctx.fillStyle = hi ? '#004d57' : '#263238';
        let t = txt; while (t.length > 1 && ctx.measureText(t).width > w - 4) t = t.slice(0, -1);
        ctx.fillText(t, (x1 + x2) / 2, y + RH / 2);
      };
      ctx.textAlign = 'center';
      pts.forEach((p, i) => {
        let a = i ? (xs[i - 1] + xs[i]) / 2 : L, b = i < pts.length - 1 ? (xs[i] + xs[i + 1]) / 2 : L + W;
        a = Math.max(L, a); b = Math.min(L + W, b);
        const hi = sel.has(p.n);
        nodeRows.forEach((k, r) => { const y = nodeY + r * RH; cellText(f(vals[i][k]), a, b, y, hi); cells.push({ x1: a, x2: b, y1: y, y2: y + RH, o: p.n }); });
      });
      segs.forEach((s, i) => {
        const a = xs[i], b = xs[i + 1]; const hi = sel.has(s.L);
        linkRows.forEach((k, r) => { const y = linkY + r * RH; cellText(f(vals[i][k]), a, b, y, hi); cells.push({ x1: a, x2: b, y1: y, y2: y + RH, o: s.L }); });
      });
      ctx.restore();
      ctx.strokeStyle = '#90a4ae'; ctx.strokeRect(L + .5, y0 + .5, W, y1 - y0); ctx.beginPath(); ctx.moveTo(0, linkY + .5); ctx.lineTo(L + W, linkY + .5); ctx.stroke();
      this.geo.table = { y0, y1, cells };
    }
    // information table (columns chosen in Profile Settings)
    tableData() {
      this._hNow = this.heads(false); this._hMaxAll = this.heads(true);
      const cols = ['node'].concat(this.opt.cols.filter(c => LABEL[c] && NODE_KEYS.has(c))).concat(['link']).concat(this.opt.cols.filter(c => LABEL[c] && !NODE_KEYS.has(c)));
      const rows = this.pts.map((p, i) => { const v = this.valuesAt(i); return cols.map(c => v[c]); });
      return { cols, heads: cols.map(c => c === 'node' ? 'Node' : c === 'link' ? 'Link to next' : LABEL[c]), rows };
    }
    fillTable() {
      const d = this.tableData(); const t = this.tableEl; t.innerHTML = '';
      const f = (v) => v === null || v === undefined ? '' : typeof v === 'number' ? AV.fmt(v, 3) : String(v);
      t.appendChild(h('table', { class: 'grid', style: { width: '100%' } }, h('thead', null, h('tr', null, d.heads.map(c => h('th', null, c)))),
        h('tbody', null, d.rows.map((r, i) => h('tr', { style: { cursor: 'pointer' }, onclick: () => this.app.select(this.pts[i].n) }, r.map((v, j) => h('td', { class: typeof v === 'number' ? 'num' : '' }, f(v))))))));
    }
    exportCSV() {
      const d = this.tableData();
      const rows = [d.heads.map(AV.csvCell).join(',')].concat(d.rows.map(r => r.map(v => v === null ? '' : v).map(AV.csvCell).join(',')));
      AV.downloadText(rows.join('\n'), 'profile_' + this.pts[0].id + '_' + this.pts[this.pts.length - 1].id + '.csv');
    }
  }
  AV.ProfileView = ProfileView;
})(window.AV);
