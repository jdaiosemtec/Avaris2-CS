// MapView - canvas plan view of the network with editing interactions
'use strict';
(function (AV) {
  const h = AV.h;
  const TOL = 7;

  class SpatialGrid {
    constructor(cell) { this.cell = cell; this.map = new Map(); }
    key(i, j) { return i * 73856093 ^ j * 19349663; }
    insertBox(obj, x1, y1, x2, y2) {
      const c = this.cell; const i1 = Math.floor(x1 / c), i2 = Math.floor(x2 / c), j1 = Math.floor(y1 / c), j2 = Math.floor(y2 / c);
      if ((i2 - i1 + 1) * (j2 - j1 + 1) > 400) { (this.big || (this.big = [])).push(obj); return; }
      for (let i = i1; i <= i2; i++) for (let j = j1; j <= j2; j++) { const k = this.key(i, j); let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(obj); }
    }
    // de-duplication by a per-query stamp on the objects (much cheaper than a Set for 100k+ objects)
    query(x1, y1, x2, y2, cb) {
      const c = this.cell; const i1 = Math.floor(x1 / c), i2 = Math.floor(x2 / c), j1 = Math.floor(y1 / c), j2 = Math.floor(y2 / c);
      const q = (SpatialGrid.stamp = (SpatialGrid.stamp || 0) + 1);
      const visit = (a) => { for (let k = 0; k < a.length; k++) { const o = a[k]; if (o._q !== q) { o._q = q; cb(o); } } };
      if ((i2 - i1 + 1) * (j2 - j1 + 1) > 20000 || (i2 - i1 + 1) * (j2 - j1 + 1) > this.map.size) { for (const a of this.map.values()) visit(a); }
      else for (let i = i1; i <= i2; i++) for (let j = j1; j <= j2; j++) { const a = this.map.get(this.key(i, j)); if (a) visit(a); }
      if (this.big) visit(this.big);
    }
  }

  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay; const L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  AV.pointInPoly = pointInPoly;

  AV.OV_MAX = 4096;   // longer side of the whole-model overview bitmap (device pixels)
  class MapView {
    constructor(container, app) {
      this.app = app;
      this.wrap = container;
      this.canvas = h('canvas', { id: 'mapCanvas', tabindex: 0 });
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.cx = 5000; this.cy = 5000; this.scale = 0.08;
      this.mode = 'select';
      this.temp = null; // in-progress drawing
      this.showLabels = false; this.showNodeLabels = false; this.showLinkLabels = false;
      this.showArrows = true;
      this.nodeSize = 5; this.linkWidth = 2;
      this.layerVis = { gages: false, subcatchments: true, links: true, nodes: true, labels: true };
      this.extLayers = [];
      this.highlight = new Set(); // traced objects
      this.indexVersion = -1;
      this._raf = 0;
      this._bind();
      new ResizeObserver(() => this.resize()).observe(container);
      this.resize();
    }
    get model() { return this.app.model; }

    resize() {
      const r = this.wrap.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return;   // map tab hidden: keep the last real size
      this.dpr = window.devicePixelRatio || 1;
      this.w = Math.max(10, r.width); this.hgt = Math.max(10, r.height);
      this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.hgt * this.dpr);
      this.redraw();
    }
    toScreen(x, y) { return [(x - this.cx) * this.scale + this.w / 2, (this.cy - y) * this.scale + this.hgt / 2]; }
    toWorld(sx, sy) { return [(sx - this.w / 2) / this.scale + this.cx, this.cy - (sy - this.hgt / 2) / this.scale]; }
    visibleBox() { const a = this.toWorld(0, this.hgt), b = this.toWorld(this.w, 0); return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }; }

    zoomToBox(b, pad = 0.06) {
      if (!b) return;
      if (this.app.activeView !== 'map') this.app.activateView('map');
      let w = b.x2 - b.x1, hh = b.y2 - b.y1;
      if (w <= 0 && hh <= 0) { w = hh = 200; }
      w = Math.max(w, 1e-6); hh = Math.max(hh, 1e-6);
      this.cx = (b.x1 + b.x2) / 2; this.cy = (b.y1 + b.y2) / 2;
      this.scale = Math.min(this.w / (w * (1 + 2 * pad)), this.hgt / (hh * (1 + 2 * pad)));
      if (!isFinite(this.scale) || this.scale <= 0) this.scale = 1;
      this._schedule();
    }
    zoomAll() {
      let b = this.model ? this.model.bounds(false) : null;
      for (const L of this.extLayers) if (L.visible && L.bbox) b = b ? { x1: Math.min(b.x1, L.bbox[0]), y1: Math.min(b.y1, L.bbox[1]), x2: Math.max(b.x2, L.bbox[2]), y2: Math.max(b.y2, L.bbox[3]) } : { x1: L.bbox[0], y1: L.bbox[1], x2: L.bbox[2], y2: L.bbox[3] };
      this.zoomToBox(b || { x1: 0, y1: 0, x2: 10000, y2: 10000 });
    }
    zoomBy(f, sx, sy) {
      if (sx === undefined) { sx = this.w / 2; sy = this.hgt / 2; }
      const [wx, wy] = this.toWorld(sx, sy);
      this.scale *= f;
      const [wx2, wy2] = this.toWorld(sx, sy);
      this.cx += wx - wx2; this.cy += wy - wy2;
      this._schedule();
    }
    isVisible(o) {
      const vb = this.visibleBox(); let x, y;
      if (o.kind === 'NODE' || o.kind === 'GAGE') { x = o.x; y = o.y; }
      else if (o.kind === 'LINK') { const a = this.model.nodes.get(o.from); if (!a) return false; x = a.x; y = a.y; }
      else if (o.kind === 'SUBCATCH' && o.poly.length) { const c = AV.polyCentroid(o.poly); x = c[0]; y = c[1]; } else return false;
      const mx = (vb.x2 - vb.x1) * 0.08, my = (vb.y2 - vb.y1) * 0.08;
      return x > vb.x1 + mx && x < vb.x2 - mx && y > vb.y1 + my && y < vb.y2 - my;
    }
    zoomToObjects(objs) {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      const add = (x, y) => { x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); };
      for (const o of objs) {
        if (o.kind === 'NODE' || o.kind === 'GAGE' || o.kind === 'LABEL') add(o.x, o.y);
        else if (o.kind === 'LINK') { const a = this.model.nodes.get(o.from), b = this.model.nodes.get(o.to); if (a) add(a.x, a.y); if (b) add(b.x, b.y); for (const v of o.verts) add(v[0], v[1]); }
        else if (o.kind === 'SUBCATCH') for (const v of o.poly) add(v[0], v[1]);
      }
      if (x1 === Infinity) return;
      const pad = Math.max(x2 - x1, y2 - y1) * 0.25 + 50;
      this.zoomToBox({ x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad }, 0);
    }

    // ---------------------------------------------------------- index
    rebuildIndex() {
      const _t0 = performance.now(); try { this._rebuildIndex(); } finally { AV.perf.rec('Map: spatial index build', performance.now() - _t0); }
    }
    _rebuildIndex() {
      const m = this.model; if (!m) return;
      const b = m.bounds(false) || { x1: 0, y1: 0, x2: 1, y2: 1 };
      const n = Math.max(1, m.nodes.size + m.links.size);
      const cell = Math.max((b.x2 - b.x1 + b.y2 - b.y1) / Math.sqrt(n) * 2, 1e-6);
      const g = new SpatialGrid(cell);
      for (const nd of m.nodes.values()) g.insertBox(nd, nd.x, nd.y, nd.x, nd.y);
      for (const l of m.links.values()) {
        const a = m.nodes.get(l.from), c = m.nodes.get(l.to); if (!a || !c) continue;
        let x1 = Math.min(a.x, c.x), x2 = Math.max(a.x, c.x), y1 = Math.min(a.y, c.y), y2 = Math.max(a.y, c.y);
        for (const v of l.verts) { x1 = Math.min(x1, v[0]); x2 = Math.max(x2, v[0]); y1 = Math.min(y1, v[1]); y2 = Math.max(y2, v[1]); }
        l._bb = [x1, y1, x2, y2];
        g.insertBox(l, x1, y1, x2, y2);
      }
      for (const s of m.subcatchments.values()) {
        if (!s.poly.length) { s._bb = null; continue; }
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const v of s.poly) { x1 = Math.min(x1, v[0]); x2 = Math.max(x2, v[0]); y1 = Math.min(y1, v[1]); y2 = Math.max(y2, v[1]); }
        s._bb = [x1, y1, x2, y2]; g.insertBox(s, x1, y1, x2, y2);
      }
      for (const gg of m.gages.values()) g.insertBox(gg, gg.x, gg.y, gg.x, gg.y);
      this.grid = g; this.indexVersion = m.geomVersion || 0; this.indexModel = m;
    }
    ensureIndex() { if (!this.grid || this.indexModel !== this.model || this.indexVersion !== (this.model.geomVersion || 0)) this.rebuildIndex(); }

    hitTest(sx, sy, kinds) {
      const m = this.model; if (!m) return null;
      this.ensureIndex();
      const [wx, wy] = this.toWorld(sx, sy); const t = TOL / this.scale;
      let best = null, bestD = Infinity, bestPri = 9;
      const want = (k) => !kinds || kinds.includes(k);
      const symOff = (o) => (o.kind === 'NODE' || o.kind === 'LINK' || o.kind === 'SUBCATCH') && !AV.symOf(this.app, o.kind === 'SUBCATCH' ? 'SUBCATCH' : o.type).visible;
      this.grid.query(wx - t, wy - t, wx + t, wy + t, (o) => {
        if (symOff(o)) return;
        let d = Infinity, pri = 9;
        if (o.kind === 'NODE' && want('NODE') && this.layerVis.nodes) { d = Math.hypot(o.x - wx, o.y - wy) * this.scale; pri = 0; }
        else if (o.kind === 'GAGE' && want('GAGE') && this.layerVis.gages) { d = Math.hypot(o.x - wx, o.y - wy) * this.scale; pri = 0; }
        else if (o.kind === 'LINK' && want('LINK') && this.layerVis.links) {
          const a = m.nodes.get(o.from), b = m.nodes.get(o.to); if (!a || !b) return;
          const pts = [[a.x, a.y]].concat(o.verts).concat([[b.x, b.y]]);
          for (let i = 1; i < pts.length; i++) d = Math.min(d, distSeg(wx, wy, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) * this.scale);
          pri = 1;
        } else if (o.kind === 'SUBCATCH' && want('SUBCATCH') && this.layerVis.subcatchments) {
          if (o.poly.length > 2 && pointInPoly(wx, wy, o.poly)) { d = TOL; pri = 2; }
        }
        if (d <= TOL && (pri < bestPri || (pri === bestPri && d < bestD))) { best = o; bestD = d; bestPri = pri; }
      });
      if (!best && (!kinds || kinds.includes('LABEL'))) {
        for (const lb of m.labels) { const [x, y] = this.toScreen(lb.x, lb.y); if (sx >= x - 4 && sx <= x + 8 * lb.text.length && sy >= y - 14 && sy <= y + 4) { best = Object.assign(lb, { kind: 'LABEL' }); break; } }
      }
      return best;
    }
    // every object under the cursor (for the overlapping-object picker)
    hitAll(sx, sy) {
      const m = this.model; if (!m) return [];
      this.ensureIndex();
      const [wx, wy] = this.toWorld(sx, sy); const t = TOL / this.scale; const out = [];
      this.grid.query(wx - t, wy - t, wx + t, wy + t, (o) => {
        if (out.includes(o)) return;
        if ((o.kind === 'NODE' && this.layerVis.nodes) || (o.kind === 'GAGE' && this.layerVis.gages)) { if (Math.hypot(o.x - wx, o.y - wy) * this.scale <= TOL) out.push(o); }
        else if (o.kind === 'LINK' && this.layerVis.links) {
          const a = m.nodes.get(o.from), b = m.nodes.get(o.to); if (!a || !b) return;
          const pts = [[a.x, a.y]].concat(o.verts).concat([[b.x, b.y]]); let d = Infinity;
          for (let i = 1; i < pts.length; i++) d = Math.min(d, distSeg(wx, wy, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) * this.scale);
          if (d <= TOL) out.push(o);
        } else if (o.kind === 'SUBCATCH' && this.layerVis.subcatchments) {
          // polygon contains the point, or its outline passes within tolerance (e.g. a shared vertex)
          let near = o.poly.length > 2 && pointInPoly(wx, wy, o.poly);
          for (let i = 0; !near && i < o.poly.length; i++) { const p = o.poly[i], q = o.poly[(i + 1) % o.poly.length]; if (distSeg(wx, wy, p[0], p[1], q[0], q[1]) * this.scale <= TOL) near = true; }
          if (near) out.push(o);
        }
      });
      const rank = { LINK: 0, NODE: 1, GAGE: 2, SUBCATCH: 3 };
      return out.sort((a, b) => (rank[a.kind] - rank[b.kind]) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    }
    objectsInBox(x1, y1, x2, y2) {
      this.ensureIndex();
      const out = [];
      const inb = (x, y) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
      this.grid.query(x1, y1, x2, y2, (o) => {
        if ((o.kind === 'NODE' || o.kind === 'LINK' || o.kind === 'SUBCATCH') && !AV.symOf(this.app, o.kind === 'SUBCATCH' ? 'SUBCATCH' : o.type).visible) return;
        if ((o.kind === 'NODE' && this.layerVis.nodes) || (o.kind === 'GAGE' && this.layerVis.gages)) { if (inb(o.x, o.y)) out.push(o); }
        else if (o.kind === 'LINK' && this.layerVis.links) { const a = this.model.nodes.get(o.from), b = this.model.nodes.get(o.to); if (a && b && inb(a.x, a.y) && inb(b.x, b.y)) out.push(o); }
        else if (o.kind === 'SUBCATCH' && this.layerVis.subcatchments && o._bb) { if (o._bb[0] >= x1 && o._bb[2] <= x2 && o._bb[1] >= y1 && o._bb[3] <= y2) out.push(o); }
      });
      return out;
    }

    // ---------------------------------------------------------- drawing
    // Drawing is split in two layers: a cached "base" bitmap (network + theme) that is only re-rendered when the
    // view, model, theme or results change, and a cheap overlay (selection, highlights, rubber bands, scale bar)
    // drawn on top. Selecting, hovering and picking only redraw the overlay, which keeps large models responsive.
    redraw() { this.baseDirty = true; this._schedule(); }
    redrawOverlay() { this._schedule(); }
    redrawBackground() { if (this._bgT) return; this._bgT = setTimeout(() => { this._bgT = null; this.baseCache = []; this.baseKey = null; this._schedule(); }, 60); }
    _schedule() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); }); }
    // geometry being dragged: full redraw on small models, overlay-only (re-render on release) on large ones
    liveEdit() { if ((this._baseMs || 0) > 70) { this.redrawOverlay(); } else { this.grid = null; this.redraw(); } }
    viewKey() { return this.cx + ',' + this.cy + ',' + this.scale + ',' + this.w + ',' + this.hgt + ',' + this.dpr; }
    draw() {
      const ctx = this.ctx;
      const key = this.viewKey();
      const slow = (this._baseMs || 0) > 70;
      if (this.base && this.baseKey !== key && !this.baseDirty && this.cacheGet(key)) { this.blitBase(); }
      else if (!this.base || this.baseDirty || this.baseKey !== key) {
        if (slow && this.base && !this.baseDirty && this.interacting) {
          // large model while panning / zooming: move the last bitmap now, re-render once the view settles
          this.blitTransformed();
          clearTimeout(this._settle); this._settle = setTimeout(() => { this.interacting = false; this.redrawOverlay(); }, 160);
        } else this.renderBase();
      } else this.blitBase();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.model) this.drawOverlay();
      if (this.app.corner) this.app.corner.update();
    }
    blitBase() { const ctx = this.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.base, 0, 0); }
    blitTransformed() {
      const ctx = this.ctx, b = this.baseView, k = this.scale / b.scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mapbg') || '#fff'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      const d = this.dpr; const ox = (this.w / 2 - k * this.w / 2 + (b.cx - this.cx) * this.scale) * d, oy = (this.hgt / 2 - k * this.hgt / 2 + (this.cy - b.cy) * this.scale) * d;
      ctx.drawImage(this.base, ox, oy, this.base.width * k, this.base.height * k);
    }
    // a few rendered views are kept (e.g. "zoom to all") so returning to them is instant on large models
    cacheGet(key) {
      const c = (this.baseCache || []).find(x => x.key === key && x.gen === this.baseGen); if (!c) return false;
      if (this.base) this.cachePut();
      this.base = c.canvas; this.baseKey = key; this.baseView = c.view; this.baseCache = this.baseCache.filter(x => x !== c); return true;
    }
    cachePut() {
      if (!this.base || (this._baseMs || 0) < 120 || this.baseKey === undefined) return;
      this.baseCache = (this.baseCache || []).filter(x => x.key !== this.baseKey && x.gen === this.baseGen);
      this.baseCache.unshift({ key: this.baseKey, gen: this.baseGen, canvas: this.base, view: this.baseView }); this.baseCache.length = Math.min(this.baseCache.length, 3);
      this.base = null;
    }
    renderBase() {
      const t0 = performance.now(); this.overviewShown = false;
      if (this.baseDirty) { this.baseGen = (this.baseGen || 0) + 1; this.baseCache = []; }
      else if (this.base && this.baseKey !== this.viewKey()) this.cachePut();
      if (!this.base) this.base = document.createElement('canvas');
      if (this.base.width !== this.canvas.width || this.base.height !== this.canvas.height) { this.base.width = this.canvas.width; this.base.height = this.canvas.height; }
      const real = this.ctx; this.ctx = this.base.getContext('2d');
      try { this.drawBase(); } finally { this.ctx = real; }
      this.baseDirty = false; this.baseKey = this.viewKey(); this.baseView = { cx: this.cx, cy: this.cy, scale: this.scale };
      this.blitBase();
      this._baseMs = performance.now() - t0; AV.perf.rec('Map: full redraw', this._baseMs);
    }
    drawBase() {
      const ctx = this.ctx, m = this.model; const OV = !!this._ovRender;   // OV: rendering the whole-model overview bitmap
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (!OV) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mapbg') || '#fff';
        ctx.fillRect(0, 0, this.w, this.hgt);
        this.basemapAttr = ''; try { if (this.drawBasemap) this.drawBasemap(); } catch (e) { console.warn('basemap', e); }
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        for (const L of this.extLayers) if (L.visible && L.order === 'below') this.drawExt(L);
      }
      if (!m) return;
      this.ensureIndex();
      // large model seen from far: show the pre-rendered overview bitmap instead of drawing every object
      if (!OV && this._overviewWanted()) { this._drawOverview(); for (const L of this.extLayers) if (L.visible && L.order !== 'below') this.drawExt(L); return; }
      AV._drawing = true; AV.frameId = (AV.frameId || 0) + 1;
      try { this._drawNetwork(OV); } finally { AV._drawing = false; }
      if (!OV) for (const L of this.extLayers) if (L.visible && L.order !== 'below') this.drawExt(L);
    }
    _drawNetwork(OV) {
      const ctx = this.ctx, m = this.model;
      const vb = this.visibleBox();
      const st = this.app.theme;
      const S = this.scale, CX = this.cx, CY = this.cy, HW = this.w / 2, HH = this.hgt / 2;
      const visObjs = { s: [], l: [], n: [] };
      this.grid.query(vb.x1, vb.y1, vb.x2, vb.y2, (o) => {
        if (o.kind === 'SUBCATCH') visObjs.s.push(o); else if (o.kind === 'LINK') visObjs.l.push(o); else if (o.kind === 'NODE') visObjs.n.push(o);
      });
      this.visCount = visObjs.s.length + visObjs.l.length + visObjs.n.length;
      const hid = st.isHidden ? (k, o) => st.isHidden(k, o) : () => false;
      // per-type symbology (Layer View) – theme colours/sizes override the symbol colour/size
      const SY = {}; for (const t of ['JUNCTION', 'OUTFALL', 'STORAGE', 'DIVIDER', 'CONDUIT', 'PUMP', 'ORIFICE', 'WEIR', 'OUTLET', 'SUBCATCH']) SY[t] = AV.symOf(this.app, t);
      // the three network layers are drawn bottom-up in the order chosen in the Layer View (drag to reorder)
      const drawSubs = () => {
      // ---- subcatchments: polygons batched per fill / outline
      if (this.layerVis.subcatchments && SY.SUBCATCH.visible) {
        const ss = SY.SUBCATCH; const groups = new Map(), tiny = new Map(); const CH = 800; const thin = visObjs.s.length > 50000;
        const flushSub = (k, p) => { const [f, o] = k.split('|'); ctx.globalAlpha = ss.opacity; ctx.fillStyle = f; ctx.fill(p); ctx.globalAlpha = Math.min(1, ss.opacity + 0.2); if (visObjs.s.length <= 60000 && ss.width > 0) { ctx.lineWidth = thin ? Math.min(0.5, ss.width) : ss.width; ctx.strokeStyle = o; ctx.stroke(p); } ctx.globalAlpha = 1; };
        const outl = this.app.showSubOutlets && S > 0.02 && visObjs.s.length < 20000 ? new Path2D() : null;
        for (const s of visObjs.s) {
          const P = s.poly; if (P.length < 2 || hid('sub', s)) continue;
          const tc = st.style('sub', s).color; const k = (tc || ss.fill) + '|' + (tc || ss.outline);
          const bb = s._bb; if (bb && (bb[2] - bb[0]) * S < 2.5 && (bb[3] - bb[1]) * S < 2.5) { let r = tiny.get(k); if (!r) { r = []; tiny.set(k, r); } r.push((bb[0] - CX) * S + HW, (CY - bb[3]) * S + HH, Math.max(1, (bb[2] - bb[0]) * S), Math.max(1, (bb[3] - bb[1]) * S)); continue; }
          let g = groups.get(k); if (!g) { g = { p: new Path2D(), n: 0 }; groups.set(k, g); }
          if (g.n >= CH) { flushSub(k, g.p); g.p = new Path2D(); g.n = 0; } g.n++; const p = g.p;
          p.moveTo((P[0][0] - CX) * S + HW, (CY - P[0][1]) * S + HH);
          for (let i = 1; i < P.length; i++) p.lineTo((P[i][0] - CX) * S + HW, (CY - P[i][1]) * S + HH);
          p.closePath();
          if (outl) {
            const o = m.nodes.get(s.p.outlet) || m.subcatchments.get(s.p.outlet);
            if (o) { const cen = s._cen || (s._cen = AV.polyCentroid(P)); const tg = o.kind === 'NODE' ? [o.x, o.y] : (o._cen || (o._cen = AV.polyCentroid(o.poly))); outl.moveTo((cen[0] - CX) * S + HW, (CY - cen[1]) * S + HH); outl.lineTo((tg[0] - CX) * S + HW, (CY - tg[1]) * S + HH); }
          }
        }
        for (const [k, g] of groups) flushSub(k, g.p);
        for (const [k, r] of tiny) { ctx.globalAlpha = ss.opacity; ctx.fillStyle = k.split('|')[0]; for (let i = 0; i < r.length; i += 4) ctx.fillRect(r[i], r[i + 1], r[i + 2], r[i + 3]); ctx.globalAlpha = 1; }
        if (outl) { ctx.setLineDash([4, 3]); ctx.strokeStyle = '#78909c'; ctx.lineWidth = 1; ctx.stroke(outl); ctx.setLineDash([]); }
      }
      };
      const drawLinks = () => {
      // ---- links: batched per type / colour / width
      if (this.layerVis.links) {
        const big = visObjs.l.length > 30000; const simpL = this.app.prefs.simplifyMap !== false;
        const groups = new Map(); const deco = [];
        const flushL = (g) => { const sy = SY[g.t]; ctx.globalAlpha = sy.opacity; ctx.strokeStyle = g.c; ctx.lineWidth = g.w; ctx.setLineDash(AV.lineDash(sy.style, g.w)); ctx.stroke(g.p); ctx.setLineDash([]); ctx.globalAlpha = 1; };
        for (const l of visObjs.l) {
          const sy = SY[l.type] || SY.CONDUIT; if (!sy.visible) continue;
          const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) continue;
          if (hid('link', l)) continue;
          if ((big || simpL) && !l.verts.length && Math.abs(a.x - b.x) * S < (simpL ? 2 : 1) && Math.abs(a.y - b.y) * S < (simpL ? 2 : 1)) continue; // shorter than a pixel or two
          const c = st.linkColor(l), w = st.linkWidth(l);
          const k = l.type + '|' + c + '|' + w; let g = groups.get(k); if (!g) { g = { t: l.type, c, w, p: new Path2D(), n: 0 }; groups.set(k, g); }
          if (g.n >= 800) { flushL(g); g.p = new Path2D(); g.n = 0; } g.n++;
          g.p.moveTo((a.x - CX) * S + HW, (CY - a.y) * S + HH);
          for (const v of l.verts) g.p.lineTo((v[0] - CX) * S + HW, (CY - v[1]) * S + HH);
          g.p.lineTo((b.x - CX) * S + HW, (CY - b.y) * S + HH);
          if (!big && S > 0.005) deco.push([l, a, b, c, sy]);
        }
        for (const g of groups.values()) flushL(g);
        for (const [l, a, b, c, sy] of deco) {
          const pts = [this.toScreen(a.x, a.y)]; for (const v of l.verts) pts.push(this.toScreen(v[0], v[1])); pts.push(this.toScreen(b.x, b.y));
          const mid = this._midpoint(pts); ctx.globalAlpha = sy.opacity;
          if (!sy.arrows || sy.mid === 'none') { ctx.globalAlpha = 1; continue; }
          if (l.type !== 'CONDUIT') { if (S > 0.02) this._linkSymbol(sy, mid, c, 1); }
          else if (this.showArrows && st.flowDir) { const dir = st.flowDir(l); if (dir) this._linkSymbol(sy, mid, c, dir); }
          ctx.globalAlpha = 1;
        }
      }
      };
      const drawNodes = () => {
      // ---- nodes
      // "simplify" (Default Settings): symbols shrink to at most half size when zoomed out and only one symbol is drawn
      // per symbol-sized screen cell, so nothing overlaps and panning stays fast. Off: every node, full size, opaque.
      if (this.layerVis.nodes) {
        const simp = this.app.prefs.simplifyMap !== false;
        let k = 1, cell = 0; const occ = new Set();
        if (simp) { const density = visObjs.n.length / Math.max(1, this.w * this.hgt); k = density > 1 / 900 ? Math.max(0.5, Math.sqrt(1 / (900 * density))) : 1; cell = Math.max(3, 2.4 * 5 * k); }
        const groups = new Map();
        const flushN = (key, G) => { const sy = SY[G.t]; ctx.globalAlpha = sy.opacity; ctx.fillStyle = G.c; ctx.fill(G.p); ctx.strokeStyle = sy.stroke; ctx.lineWidth = G.r > 3 ? 0.8 : 0.5; ctx.stroke(G.p); ctx.globalAlpha = 1; };
        const perNode = visObjs.n.length <= 20000; const dots = OV && visObjs.n.length > 50000; const dotG = new Map();   // overview of a dense model: junctions as plain dots
        const order = simp && visObjs.n.length > 1 ? visObjs.n.filter(n => n.type !== 'JUNCTION').concat(visObjs.n.filter(n => n.type === 'JUNCTION')) : visObjs.n;
        for (const n of order) {
          const sy = SY[n.type] || SY.JUNCTION; if (!sy.visible || hid('node', n)) continue;
          const x = (n.x - CX) * S + HW, y = (CY - n.y) * S + HH;
          if (simp) { const ck = Math.floor(x / cell) * 100003 + Math.floor(y / cell); if (occ.has(ck)) continue; occ.add(ck); }
          const c = st.nodeColor(n); const r = (st.nodeSize ? st.nodeSize(n, sy.size) : sy.size) * k;
          if (dots && n.type === 'JUNCTION') { let a = dotG.get(c); if (!a) dotG.set(c, a = []); a.push(x, y, r); continue; }
          if (!simp) { ctx.beginPath(); AV.nodeShape(ctx, sy.shape, x, y, r); ctx.globalAlpha = sy.opacity; ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = sy.stroke; ctx.lineWidth = 0.8; ctx.stroke(); ctx.globalAlpha = 1; continue; }
          // each symbol filled and outlined on its own so an overlapping symbol covers its neighbour's outline
          // (batched paths are only used for very large views, where it does not show)
          if (perNode) { ctx.beginPath(); AV.nodeShape(ctx, sy.shape, x, y, r); ctx.globalAlpha = sy.opacity; ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = sy.stroke; ctx.lineWidth = r > 3 ? 0.8 : 0.5; ctx.stroke(); ctx.globalAlpha = 1; continue; }
          const key = n.type + '|' + c; let G = groups.get(key); if (!G) { G = { t: n.type, c, r, p: new Path2D(), n: 0 }; groups.set(key, G); }
          if (G.n >= 1500) { flushN(key, G); G.p = new Path2D(); G.n = 0; } G.n++;
          AV.nodeShape(G.p, sy.shape, x, y, r);
        }
        for (const [key, G] of groups) flushN(key, G);
        for (const [c, a] of dotG) { ctx.globalAlpha = SY.JUNCTION.opacity; ctx.fillStyle = c; for (let i = 0; i < a.length; i += 3) { const s = Math.max(1.2, a[i + 2] * 1.2); ctx.fillRect(a[i] - s / 2, a[i + 1] - s / 2, s, s); } ctx.globalAlpha = 1; }
      }
      };
      const drawMeshL = () => { if (this.app.mesh2d) { try { AV.drawMesh(this, ctx); } catch (e) { console.warn('mesh', e); } } };
      const DRAW = { subcatchments: drawSubs, links: drawLinks, nodes: drawNodes, mesh: drawMeshL };
      for (const k of this.netOrder().slice().reverse()) DRAW[k]();
      if (OV) return;
      // ---- ID labels
      const lon = (k) => st.labelsOn ? st.labelsOn(k) : false;
      const showN = (this.showNodeLabels || lon('node')) && visObjs.n.length < 4000, showL = (this.showLinkLabels || lon('link')) && visObjs.l.length < 4000;
      const lt = (k, o) => st.labelText ? st.labelText(k, o) : o.id;
      ctx.font = '11px Segoe UI, Arial'; ctx.fillStyle = '#263238'; ctx.textBaseline = 'bottom';
      if (showN) for (const n of visObjs.n) { const [x, y] = this.toScreen(n.x, n.y); this._label(lt('node', n), x + 6, y - 4); }
      if (showL) for (const l of visObjs.l) {
        const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) continue;
        const pts = [this.toScreen(a.x, a.y)]; for (const v of l.verts) pts.push(this.toScreen(v[0], v[1])); pts.push(this.toScreen(b.x, b.y));
        const mid = this._midpoint(pts); ctx.fillStyle = '#0d47a1'; this._label(lt('link', l), mid.x + 4, mid.y - 3); ctx.fillStyle = '#263238';
      }
      if ((this.showNodeLabels || lon('sub')) && visObjs.s.length < 3000) for (const s of visObjs.s) { if (!s.poly.length) continue; const c = AV.polyCentroid(s.poly); const [x, y] = this.toScreen(c[0], c[1]); ctx.fillStyle = '#2e7d32'; this._label(lt('sub', s), x - 10, y); ctx.fillStyle = '#263238'; }
      // ---- map labels
      if (this.layerVis.labels) for (const lb of m.labels) {
        const [x, y] = this.toScreen(lb.x, lb.y); const sz = Math.max(9, Math.min(28, parseFloat(lb.size) || 11));
        ctx.font = (lb.bold === 'YES' ? 'bold ' : '') + (lb.italic === 'YES' ? 'italic ' : '') + sz + 'px ' + (lb.font || 'Segoe UI');
        ctx.fillStyle = '#37474f'; ctx.fillText(lb.text, x, y);
      }
    }
    // ---------------------------------------------------------------- overview (level of detail for large models)
    // The whole model is rendered once into a bitmap (longer side OV_MAX device pixels). While the view is zoomed out so far
    // that one overview pixel is at most ~1.3 screen pixels, zooming and panning only redraw that bitmap. Content changes
    // (edits, themes, time steps) show the previous bitmap at once and rebuild it a moment later.
    _modelBox() {
      const m = this.model; const key = (m.geomVersion || 0) + '|' + m.nodes.size + '|' + m.links.size + '|' + m.subcatchments.size + '|' + (this.app.mesh2d ? this.app.mesh2d.cells.length : 0);
      if (this._mbModel === m && this._mbKey === key) return this._mb;
      let b = m.bounds(false); const M = this.app.mesh2d;
      if (M && M.cells.length) { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const c of M.cells) { const s = c.s / 2; if (c.x - s < x1) x1 = c.x - s; if (c.y - s < y1) y1 = c.y - s; if (c.x + s > x2) x2 = c.x + s; if (c.y + s > y2) y2 = c.y + s; } b = b ? { x1: Math.min(b.x1, x1), y1: Math.min(b.y1, y1), x2: Math.max(b.x2, x2), y2: Math.max(b.y2, y2) } : { x1, y1, x2, y2 }; }
      if (b) { const pw = Math.max(b.x2 - b.x1, b.y2 - b.y1, 1) * 0.02; b = { x1: b.x1 - pw, y1: b.y1 - pw, x2: b.x2 + pw, y2: b.y2 + pw }; }
      this._mb = b; this._mbModel = m; this._mbKey = key; return b;
    }
    _objCount() { const m = this.model; return m.nodes.size + m.links.size + m.subcatchments.size + (this.app.mesh2d ? this.app.mesh2d.cells.length : 0); }
    _overviewWanted() {
      if (this.app.prefs.mapOverview === false || this._objCount() < 60000) return false;
      const b = this._modelBox(); if (!b) return false;
      const ovs = AV.OV_MAX / Math.max(b.x2 - b.x1, b.y2 - b.y1);         // overview device pixels per map unit
      return this.scale * this.dpr <= ovs * 1.05;   // never enlarge the bitmap noticeably (no blur)
    }
    // the overview is rendered in tiles (TILE device px), a few per animation frame, into a back buffer that replaces the
    // shown bitmap when complete: the map stays responsive while a large model is redrawn (edits, themes, time steps)
    _ovStart(sync) {
      const b = this._modelBox(); const ovs = AV.OV_MAX / Math.max(b.x2 - b.x1, b.y2 - b.y1);
      const W = Math.max(1, Math.ceil((b.x2 - b.x1) * ovs)), H = Math.max(1, Math.ceil((b.y2 - b.y1) * ovs)); const T = 1024;
      const tiles = []; for (let ty = 0; ty < H; ty += T) for (let tx = 0; tx < W; tx += T) tiles.push([tx, ty]);
      // render the tiles nearest the screen centre first
      const sc = this.toWorld(this.w / 2, this.hgt / 2); const cxp = (sc[0] - b.x1) * ovs, cyp = (b.y2 - sc[1]) * ovs; tiles.sort((p, q) => Math.hypot(p[0] + T / 2 - cxp, p[1] + T / 2 - cyp) - Math.hypot(q[0] + T / 2 - cxp, q[1] + T / 2 - cyp));
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const job = { b, ovs, W, H, T, tiles, cv, gen: this.baseGen, model: this.model, t0: performance.now(), progressive: !this._ov || this._ov.model !== this.model || this._ov.box !== b };
      if (this._ovJob) cancelAnimationFrame(this._ovJob.raf); this._ovJob = job;
      if (job.progressive) this._ov = { canvas: cv, box: b, gen: job.gen, model: this.model, partial: true };   // first build: show tiles as they come
      if (sync) { while (job.tiles.length) this._ovTile(job); this._ovFinish(job); return; }
      const step = () => { if (this._ovJob !== job) return; const t1 = performance.now(); while (job.tiles.length && performance.now() - t1 < 40) this._ovTile(job);
        if (job.progressive) { this.baseCache = []; this.baseKey = null; this._schedule(); }
        if (job.tiles.length) job.raf = requestAnimationFrame(step); else this._ovFinish(job); };
      job.raf = requestAnimationFrame(step);
    }
    _ovTile(job) {
      const [tx, ty] = job.tiles.shift(); const pad = 24, T = job.T; const tw = Math.min(T, job.W - tx), th = Math.min(T, job.H - ty);
      const tc = this._ovTc || (this._ovTc = document.createElement('canvas')); if (tc.width !== T + 2 * pad || tc.height !== T + 2 * pad) { tc.width = T + 2 * pad; tc.height = T + 2 * pad; } const c2 = tc.getContext('2d'); c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, tc.width, tc.height);
      const wx = job.b.x1 + (tx + tw / 2) / job.ovs, wy = job.b.y2 - (ty + th / 2) / job.ovs;
      const save = { cx: this.cx, cy: this.cy, scale: this.scale, w: this.w, hgt: this.hgt, dpr: this.dpr, ctx: this.ctx, visCount: this.visCount };
      Object.assign(this, { cx: wx, cy: wy, scale: job.ovs, w: tw + 2 * pad, hgt: th + 2 * pad, dpr: 1, ctx: c2 }); this._ovRender = true;
      try { this.drawBase(); } finally { this._ovRender = false; Object.assign(this, save); }
      job.cv.getContext('2d').drawImage(tc, pad, pad, tw, th, tx, ty, tw, th);
    }
    _ovFinish(job) {
      if (this._ovJob !== job) return; this._ovJob = null;
      this._ov = { canvas: job.cv, box: job.b, gen: job.gen, model: job.model };
      AV.perf.rec('Map: overview bitmap build', performance.now() - job.t0, job.W + ' x ' + job.H + ' px');
      this.baseCache = []; this.baseKey = null; this._schedule();
      if (this.baseGen !== job.gen && this._overviewWanted()) this._ovStart(false);
    }
    _drawOverview() {
      const b = this._modelBox(); const ov = this._ov; const job = this._ovJob;
      const fresh = ov && ov.model === this.model && ov.box === b;
      if (!fresh) { if (!job || job.box !== b) this._ovStart(false); }
      else if (ov.gen !== this.baseGen && !ov.partial && !job) this._ovStart(false);   // a running build is finished first, then redone if needed
      const O = this._ov; if (!O) return; const B = O.box, ctx = this.ctx; const [x, y] = this.toScreen(B.x1, B.y2); const w = (B.x2 - B.x1) * this.scale, h = (B.y2 - B.y1) * this.scale;
      ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(O.canvas, x, y, w, h); ctx.restore();
      this.visCount = this._objCount(); this.overviewShown = true;
    }
    // selection, traced objects, outlet arrows, vertex handles, rubber bands, scale bar
    // top-to-bottom order of the network layers (Layer View); stored in the preferences
    // the 2D mesh takes clicks inside subcatchments only when it is drawn above them (Layer View order)
    meshAboveSubs() { const o = this.netOrder(); return o.indexOf('mesh') < o.indexOf('subcatchments'); }
    netOrder() { const P = this.app.prefs || {}; const K = ['nodes', 'links', 'mesh', 'subcatchments'];
      let o = Array.isArray(P.netOrder) ? P.netOrder.filter((k, i, a) => K.includes(k) && a.indexOf(k) === i) : [];
      if (!['nodes', 'links', 'subcatchments'].every(k => o.includes(k))) o = ['nodes', 'links', 'subcatchments'];
      if (!o.includes('mesh')) o.splice(o.indexOf('subcatchments'), 0, 'mesh'); // the 2D mesh sits right above the subcatchments by default
      return o; }
    drawOverlay() {
      const ctx = this.ctx, m = this.model, st = this.app.theme, sel = this.app.selection;
      const SC = this.app.selColors ? this.app.selColors() : { link: '#ff1744', node: '#ffd600', sub: '#00bcd4' };
      const vb = this.visibleBox(); const S = this.scale;
      const inView = (o) => { const b = o._bb; if (!b) return true; return !(b[2] < vb.x1 || b[0] > vb.x2 || b[3] < vb.y1 || b[1] > vb.y2); };
      const ptIn = (x, y) => x >= vb.x1 && x <= vb.x2 && y >= vb.y1 && y <= vb.y2;
      const hi = this.highlight, asg = this.assignSubs;
      const subs = [], links = [], nodes = [];
      // objects of a hidden layer are not drawn even while selected (the selection itself is kept)
      const hiddenLayer = (o) => (o.kind === 'NODE' || o.kind === 'LINK' || o.kind === 'SUBCATCH') && !AV.symOf(this.app, o.kind === 'SUBCATCH' ? 'SUBCATCH' : o.type).visible;
      const add = (o, how) => { if (hiddenLayer(o)) return; if (o.kind === 'SUBCATCH') subs.push([o, how]); else if (o.kind === 'LINK') links.push([o, how]); else if (o.kind === 'NODE') nodes.push([o, how]); };
      if (hi && hi.size) for (const o of hi) if (!sel.has(o)) add(o, 'hi');
      if (asg && asg.size) for (const o of asg) if (!sel.has(o)) add(o, 'asg');
      for (const o of sel) add(o, 'sel');
      const pathOf = (pts) => { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
      const arrowSubs = [];
      if (this.layerVis.subcatchments) for (const [s, how] of subs) {
        if (s.poly.length < 2 || !inView(s)) { if (how !== 'hi') arrowSubs.push(s); continue; }
        pathOf(s.poly); ctx.closePath();
        const col = how === 'sel' ? SC.sub : how === 'asg' ? '#00e5ff' : '#d500f9';
        if (how !== 'hi') { ctx.fillStyle = col + '70'; ctx.fill(); }
        ctx.lineWidth = how === 'hi' ? 1.5 : 2.5; ctx.strokeStyle = col; ctx.stroke();
        if (how !== 'hi') arrowSubs.push(s);
      }
      for (const s of arrowSubs) {
        const o = m.nodes.get(s.p.outlet) || m.subcatchments.get(s.p.outlet); if (!o || !s.poly.length) continue;
        const cen = AV.polyCentroid(s.poly); const tg = o.kind === 'NODE' ? [o.x, o.y] : AV.polyCentroid(o.poly); const [ax, ay] = this.toScreen(cen[0], cen[1]), [bx, by] = this.toScreen(tg[0], tg[1]);
        ctx.strokeStyle = '#e53935'; ctx.fillStyle = '#e53935'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        const an = Math.atan2(by - ay, bx - ax), r = o.kind === 'NODE' ? 7 : 0; const tx = bx - Math.cos(an) * r, ty = by - Math.sin(an) * r;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - 11 * Math.cos(an - 0.4), ty - 11 * Math.sin(an - 0.4)); ctx.lineTo(tx - 11 * Math.cos(an + 0.4), ty - 11 * Math.sin(an + 0.4)); ctx.closePath(); ctx.fill();
      }
      if (this.layerVis.links) {
        const many = links.length > 5000;
        for (const [l, how] of links) {
          if (!inView(l)) continue;
          const a = m.nodes.get(l.from), b = m.nodes.get(l.to); if (!a || !b) continue;
          pathOf([[a.x, a.y]].concat(l.verts).concat([[b.x, b.y]]));
          const w = st.linkWidth(l);
          ctx.strokeStyle = how === 'sel' ? SC.link : '#d500f9'; ctx.lineWidth = w + (many ? 2 : 5); ctx.globalAlpha = how === 'sel' ? 0.75 : 0.6; ctx.stroke(); ctx.globalAlpha = 1;
          if (!many) { ctx.strokeStyle = st.linkColor(l); ctx.lineWidth = w; ctx.stroke(); }
        }
      }
      if (this.layerVis.nodes) {
        const r0 = Math.min(this.nodeSize, this.visCount > 50000 ? 3 : this.nodeSize);
        for (const [n, how] of nodes) {
          if (!ptIn(n.x, n.y)) continue;
          const [x, y] = this.toScreen(n.x, n.y); const r = st.nodeSize ? st.nodeSize(n, r0) : r0;
          ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 7);
          if (how === 'sel') { ctx.globalAlpha = 0.6; ctx.fillStyle = SC.node; ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = SC.node; ctx.stroke(); }
          else { ctx.fillStyle = 'rgba(213,0,249,.4)'; ctx.fill(); }
          ctx.beginPath(); ctx.arc(x, y, Math.max(2, r * 0.8), 0, 7); ctx.fillStyle = st.nodeColor(n); ctx.fill(); ctx.strokeStyle = '#263238'; ctx.lineWidth = 0.8; ctx.stroke();
        }
      }
      // selected map labels
      if (this.layerVis.labels) for (const lb of sel) if (lb.kind === 'LABEL') { const [x, y] = this.toScreen(lb.x, lb.y); const sz = Math.max(9, Math.min(28, parseFloat(lb.size) || 11)); ctx.font = sz + 'px Segoe UI'; ctx.fillStyle = '#ff6d00'; ctx.fillText(lb.text, x, y); }
      // vertex handles for the selected link while editing geometry
      if (this.app.editEnabled) for (const o of sel) if (o.kind === 'LINK') { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff6d00'; ctx.lineWidth = 1.5; for (const v of o.verts) { const [x, y] = this.toScreen(v[0], v[1]); ctx.fillRect(x - 3.5, y - 3.5, 7, 7); ctx.strokeRect(x - 3.5, y - 3.5, 7, 7); } }
      if (this.dragObj) { const o = this.dragObj; const [x, y] = this.toScreen(o.x, o.y); ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = SC.node; ctx.fill(); ctx.strokeStyle = '#263238'; ctx.stroke(); }
      // selected 2D cell
      if (this.app.mesh2d) { const sel = new Set(this.app.meshSelSet || []); if (this.app.meshSel >= 0 && this.app.mesh2d.cells[this.app.meshSel]) sel.add(this.app.mesh2d.cells[this.app.meshSel]);
        if (sel.size) { ctx.save(); ctx.strokeStyle = SC.sub; ctx.lineWidth = 2.5; for (const c of sel) { if (c.x + c.s < vb.x1 || c.x - c.s > vb.x2 || c.y + c.s < vb.y1 || c.y - c.s > vb.y2) continue; const [x, y] = this.toScreen(c.x - c.s / 2, c.y + c.s / 2); ctx.strokeRect(x, y, c.s * S, c.s * S); } ctx.restore(); } }
      if (this.app.mesh2d) AV.drawMeshLegend(this, ctx);
      if (this.app.partView && this.app.partView.P) AV.partOverlay(this, ctx);
      this.drawTemp();
      this.drawScaleBar();
      if (this.basemapAttr) { ctx.save(); ctx.font = '10px Segoe UI'; const tw = ctx.measureText(this.basemapAttr).width; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(this.w - tw - 10, this.hgt - 15, tw + 10, 15); ctx.fillStyle = '#455a64'; ctx.textBaseline = 'middle'; ctx.fillText(this.basemapAttr, this.w - tw - 5, this.hgt - 7.5); ctx.restore(); }
    }
    _label(t, x, y) { const ctx = this.ctx; ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3; ctx.strokeText(t, x, y); ctx.restore(); ctx.fillText(t, x, y); }
    _midpoint(pts) {
      let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      let half = L / 2;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (half <= d || i === pts.length - 1) { const t = d ? half / d : 0; return { x: pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), y: pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]), ang: Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]), len: L }; }
        half -= d;
      }
      return { x: pts[0][0], y: pts[0][1], ang: 0, len: 0 };
    }
    _arrow(mid, dir, color) {
      if (mid.len < 22) return;
      const ctx = this.ctx; const a = mid.ang + (dir < 0 ? Math.PI : 0);
      ctx.save(); ctx.translate(mid.x, mid.y); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath();
      ctx.fillStyle = color; ctx.fill(); ctx.restore();
    }
    _linkSymbol(sy, mid, color, dir) {
      const r = 6 * (sy.midSize || 1); if (mid.len < r * 3) return;
      const ctx = this.ctx; ctx.save(); ctx.translate(mid.x, mid.y); ctx.rotate(mid.ang + (dir < 0 ? Math.PI : 0));
      AV.drawMidSym(ctx, sy.mid || 'arrow', color, sy.midFill || '#fff', r); ctx.restore();
    }
    drawExt(L) {
      const ctx = this.ctx; const vb = this.visibleBox();
      if (L.raster) {
        const b = L.bbox; if (!L.canvas || b[2] < vb.x1 || b[0] > vb.x2 || b[3] < vb.y1 || b[1] > vb.y2) return;
        const [c0, c1, c2] = L.corners; const p0 = this.toScreen(c0[0], c0[1]), p1 = this.toScreen(c1[0], c1[1]), p2 = this.toScreen(c2[0], c2[1]);
        const W = L.canvas.width, H = L.canvas.height, d = this.dpr || 1;
        ctx.save(); ctx.globalAlpha = L.opacity === undefined ? 1 : L.opacity; ctx.imageSmoothingEnabled = (p1[0] - p0[0]) < W * 1.5;
        ctx.setTransform(d * (p1[0] - p0[0]) / W, d * (p1[1] - p0[1]) / W, d * (p2[0] - p0[0]) / H, d * (p2[1] - p0[1]) / H, d * p0[0], d * p0[1]);
        ctx.drawImage(L.canvas, 0, 0); ctx.restore(); return;
      }
      ctx.save(); const op = L.opacity === undefined ? 1 : L.opacity; ctx.globalAlpha = op;
      ctx.strokeStyle = L.stroke || '#90a4ae'; ctx.lineWidth = L.width || 1;
      const fo = L.fillOpacity === undefined ? (/^#/.test(L.fill || '') ? 0.25 : 1) : L.fillOpacity;
      const pts = new Path2D(), lines = new Path2D(), polys = new Path2D(); const pr = L.ptSize || 3;
      for (const f of L.features) {
        const b = f.bbox; if (b && (b[2] < vb.x1 || b[0] > vb.x2 || b[3] < vb.y1 || b[1] > vb.y2)) continue;
        if (f.type === 'point') { for (const p of f.coords) { const [x, y] = this.toScreen(p[0], p[1]); pts.moveTo(x + pr, y); pts.arc(x, y, pr, 0, 6.2832); } }
        else { const P = f.type === 'polygon' ? polys : lines; for (const part of f.coords) part.forEach((p, i) => { const [x, y] = this.toScreen(p[0], p[1]); i ? P.lineTo(x, y) : P.moveTo(x, y); }); }
      }
      ctx.globalAlpha = op * fo; ctx.fillStyle = L.fill || 'rgba(144,164,174,.15)'; ctx.fill(polys, 'evenodd'); ctx.globalAlpha = op;
      ctx.stroke(polys); ctx.stroke(lines); ctx.fillStyle = L.stroke || '#607d8b'; ctx.fill(pts);
      // features selected in the attribute table
      if (L.sel && L.sel.size) {
        const hp = new Path2D(), hl = new Path2D();
        for (const f of L.sel) { if (f.type === 'point') { for (const p of f.coords) { const [x, y] = this.toScreen(p[0], p[1]); hp.moveTo(x + pr + 2, y); hp.arc(x, y, pr + 2, 0, 6.2832); } } else for (const part of f.coords) part.forEach((p, i) => { const [x, y] = this.toScreen(p[0], p[1]); i ? hl.lineTo(x, y) : hl.moveTo(x, y); if (f.type === 'polygon' && i === part.length - 1) hl.closePath(); }); }
        ctx.globalAlpha = 1; ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = Math.max(3, (L.width || 1) + 2); ctx.lineJoin = 'round'; ctx.stroke(hl); ctx.fillStyle = '#00e5ff'; ctx.fill(hp); ctx.strokeStyle = '#006064'; ctx.lineWidth = 1; ctx.stroke(hp);
      }
      ctx.restore();
    }
    drawTemp() {
      const ctx = this.ctx, t = this.temp || {}; if (!this.temp && !this.splitCur) return;
      ctx.save();
      if (t.kind === 'box') {
        ctx.strokeStyle = '#1565c0'; ctx.setLineDash([5, 3]); ctx.fillStyle = 'rgba(21,101,192,.08)';
        const x = Math.min(t.x0, t.x1), y = Math.min(t.y0, t.y1); ctx.fillRect(x, y, Math.abs(t.x1 - t.x0), Math.abs(t.y1 - t.y0)); ctx.strokeRect(x, y, Math.abs(t.x1 - t.x0), Math.abs(t.y1 - t.y0));
      } else if (t.kind === 'link' || t.kind === 'poly' || t.kind === 'measure' || t.kind === 'line') {
        const pts = t.pts.map(p => this.toScreen(p[0], p[1])); if (t.cursor) pts.push(t.cursor);
        ctx.strokeStyle = t.kind === 'measure' ? '#d500f9' : '#ff6d00'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (t.kind === 'poly' && pts.length > 2) ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = '#ff6d00'; for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, 7); ctx.fill(); }
        if (t.kind === 'measure' && t.pts.length) {
          let L = 0; const all = t.pts.slice(); if (t.cursor) all.push(this.toWorld(t.cursor[0], t.cursor[1]));
          for (let i = 1; i < all.length; i++) L += Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]);
          const p = pts[pts.length - 1]; ctx.font = 'bold 12px Segoe UI'; ctx.fillStyle = '#4a148c'; this._label(AV.fmt(L, 2) + ' ' + this.app.mapUnitsLabel(), p[0] + 8, p[1] - 6);
        }
      }
      if (this.splitCur) { const c = this.splitCur; ctx.strokeStyle = '#263238'; ctx.lineWidth = 1.5; ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.beginPath(); ctx.moveTo(c[0], c[1] - 8); ctx.lineTo(c[0] + 8, c[1] + 6); ctx.lineTo(c[0] - 8, c[1] + 6); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      if (t.kind === 'ssplit') {
        const pts = t.pts.map(p => this.toScreen(p[0], p[1])); const cur = t.snap ? this.toScreen(t.snap.pt[0], t.snap.pt[1]) : t.cursor; const rub = cur || t.mouse;
        if (pts.length) { ctx.strokeStyle = '#e53935'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); pts.concat(rub ? [rub] : []).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#e53935'; for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, 7); ctx.fill(); } }
        if (cur) { ctx.strokeStyle = '#263238'; ctx.lineWidth = 1.5; ctx.fillStyle = 'rgba(255,255,255,.35)';
          // square: snapped to the boundary (filled) or inside the subcatchment
          if (t.snap) { ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; }
          ctx.fillRect(cur[0] - 7, cur[1] - 7, 14, 14); ctx.strokeRect(cur[0] - 7, cur[1] - 7, 14, 14); }
      }
      ctx.restore();
    }
    drawScaleBar() {
      const ctx = this.ctx; const target = 110 / this.scale; if (!isFinite(target) || target <= 0) return;
      const mag = Math.pow(10, Math.floor(Math.log10(target))); const step = [1, 2, 5, 10].map(s => s * mag).filter(s => s <= target).pop() || mag;
      const px = step * this.scale; const x = 14, y = this.hgt - 16;
      ctx.save(); ctx.strokeStyle = '#37474f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5); ctx.stroke();
      ctx.font = '11px Segoe UI'; ctx.fillStyle = '#37474f'; ctx.fillText(AV.fmt(step) + ' ' + this.app.mapUnitsLabel(), x + 4, y - 6); ctx.restore();
    }

    // ---------------------------------------------------------- interaction
    setHint(text) { const hint = AV.$('#mapHint'); if (text) { hint.textContent = text; hint.style.display = 'block'; } else hint.style.display = 'none'; }
    setMode(mode) {
      if (this.mode === 'pick' && mode !== 'pick' && this.onPickEnd) { const f = this.onPickEnd; this.onPickEnd = null; this.onPick = null; f(); }
      if (mode !== 'pick') { this.onPick = null; }
      this.mode = mode; this.temp = null;
      const hints = {
        'add-CONDUIT': 'Click the upstream node, optional vertices, then the downstream node. Esc to cancel.',
        'add-PUMP': 'Click the inlet node, then the outlet node.', 'add-ORIFICE': 'Click the inlet node, then the outlet node.',
        'add-WEIR': 'Click the inlet node, then the outlet node.', 'add-OUTLET': 'Click the inlet node, then the outlet node.',
        'add-SUBCATCH': 'Click polygon vertices; double-click (or Enter) to finish.', 'measure': 'Click points to measure distance; double-click to finish.',
        'zoomin': 'Click or drag a box to zoom in.', 'zoomout': 'Click to zoom out.', 'pick': this.pickHint || 'Click an object.',
        'add-LABEL': 'Click to place a text label.',
        'splitsub': 'Split subcatchment: click on its boundary (square cursor), add points inside, then click the boundary again to cut. Right-click / Esc cancels.',
      };
      const hint = AV.$('#mapHint');
      if (hints[mode]) { hint.textContent = hints[mode]; hint.style.display = 'block'; } else hint.style.display = 'none';
      this.canvas.style.cursor = mode === 'pan' ? 'grab' : mode === 'select' ? 'default' : mode === 'splitsub' ? 'default' : 'crosshair';
      this.redraw();
    }
    _bind() {
      const c = this.canvas;
      let drag = null;
      const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      c.addEventListener('wheel', (e) => { e.preventDefault(); const [sx, sy] = pos(e); this.interacting = true; this.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, sx, sy); }, { passive: false });
      // the context menu opens on the contextmenu event (after the button is released); opening it on mousedown let the
      // document-level mousedown handler close it again at once
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this._ctxSkip) { this._ctxSkip = false; return; } const [sx, sy] = pos(e); this.app.onMapContext(e, this.hitTest(sx, sy)); });
      c.addEventListener('mousedown', (e) => {
        e.preventDefault(); c.focus(); // no text selection on Shift+click
        const [sx, sy] = pos(e);
        if (e.button === 1 || (e.button === 0 && (this.mode === 'pan' || this.spaceDown))) { drag = { type: 'pan', sx, sy, cx: this.cx, cy: this.cy }; c.style.cursor = 'grabbing'; return; }
        if (e.button === 2) { this._ctxSkip = false;
          if (this.app.editEnabled) { const vh = this.vertexHit(sx, sy); if (vh) { this.app.feat.removeVertex(vh.link, vh.i); this._ctxSkip = true; return; } }
          if (this.temp && (this.temp.kind === 'link' || this.temp.kind === 'poly' || this.temp.kind === 'measure' || this.temp.kind === 'ssplit')) { if (this.temp.kind === 'ssplit') this.app.setTool('select'); else this.cancelTemp(); this._ctxSkip = true; return; }
          return;
        }
        if (e.button !== 0) return;
        const [wx, wy] = this.toWorld(sx, sy);
        this.lastClickWorld = [wx, wy];
        const mode = this.mode;
        if (mode === 'select' && this.app.editEnabled) {
          const vh = this.vertexHit(sx, sy);
          if (vh) {
            if (e.detail >= 2) return;
            drag = { type: 'vertex', link: vh.link, i: vh.i, old: vh.link.verts.map(v => v.slice()), moved: false, sx, sy }; return;
          }
          if (e.detail >= 2) { const l = [...this.app.selection].find(o => o.kind === 'LINK'); if (l && this.hitTest(sx, sy, ['LINK']) === l) { this.app.feat.insertVertex(l, wx, wy); return; } }
        }
        if (mode === 'select' && e.shiftKey && this.app.prefs.shiftPick) {
          const all = this.hitAll(sx, sy);
          if (all.length > 1) { this.app.pickOverlapping(all, e.ctrlKey); return; }
          if (all.length === 1) { this.app.select(all[0], e.ctrlKey); return; }
        }
        if (mode === 'select') {
          const hit = this.hitTest(sx, sy);
          // the 2D mesh is drawn above the subcatchments, so a click inside a cell picks the cell (hide Meshes to pick subcatchments)
          if ((!hit || (hit.kind === 'SUBCATCH' && this.meshAboveSubs())) && this.app.mesh2d && !e.ctrlKey && !e.shiftKey) { const k = AV.meshHit(this, wx, wy);
            if (k >= 0) { AV.meshSelect(this.app, [this.app.mesh2d.cells[k]], false); return; } }
          if (hit && this.app.selection.has(hit) && (hit.kind === 'NODE' || hit.kind === 'GAGE' || hit.kind === 'LABEL') && !e.ctrlKey && !e.shiftKey) {
            drag = { type: 'move', obj: hit, sx, sy, ox: hit.x, oy: hit.y, moved: false };
          } else if (hit) {
            this.app.select(hit, e.ctrlKey || e.shiftKey);
            if (hit.kind === 'NODE' || hit.kind === 'GAGE' || hit.kind === 'LABEL') drag = { type: 'move', obj: hit, sx, sy, ox: hit.x, oy: hit.y, moved: false, armed: false };
          } else drag = { type: 'box', sx, sy, add: e.ctrlKey || e.shiftKey };
        } else if (mode === 'zoomin') drag = { type: 'zoombox', sx, sy };
        else if (mode === 'zoomout') this.zoomBy(1 / 1.6, sx, sy);
        else if (mode.startsWith('add-')) {
          const ty = mode.slice(4);
          if (['JUNCTION', 'OUTFALL', 'STORAGE', 'DIVIDER'].includes(ty)) this.app.addNodeAt(ty, wx, wy);
          else if (ty === 'GAGE') this.app.addGageAt(wx, wy);
          else if (ty === 'LABEL') this.app.addLabelAt(wx, wy);
          else if (ty === 'SUBCATCH') {
            if (!this.temp) this.temp = { kind: 'poly', pts: [] };
            if (e.detail >= 2) { this.finishPoly(); return; }
            this.temp.pts.push([wx, wy]); this.redrawOverlay();
          } else { // links
            const hit = this.hitTest(sx, sy, ['NODE']);
            if (!this.temp) { if (hit) { this.temp = { kind: 'link', type: ty, from: hit, pts: [[hit.x, hit.y]] }; this.redrawOverlay(); } else AV.toast('Click on a node to start the link.'); }
            else if (hit && hit !== this.temp.from) { const verts = this.temp.pts.slice(1); this.app.addLink(ty, this.temp.from.id, hit.id, verts); this.temp = null; this.redraw(); }
            else if (!hit && ty === 'CONDUIT') { this.temp.pts.push([wx, wy]); this.redrawOverlay(); }
          }
        } else if (mode === 'splitsub') { this.app.feat.subSplitClick(sx, sy, wx, wy);
        } else if (mode === 'pick') {
          const hit = this.hitTest(sx, sy, this.pickKinds);
          if (this.onPick) this.onPick(hit, wx, wy, e);
        } else if (mode === 'draw-ext') {
          if (this.drawGeom === 'point') { this.app.feat.onDraw([[wx, wy]]); return; }
          if (!this.temp) this.temp = { kind: this.drawGeom === 'polygon' ? 'poly' : 'line', pts: [], ext: true };
          if (e.detail >= 2) { this.finishDraw(); return; }
          this.temp.pts.push([wx, wy]); this.redrawOverlay();
        } else if (mode === 'measure') {
          if (!this.temp) this.temp = { kind: 'measure', pts: [] };
          if (e.detail >= 2) { this.temp = null; this.setMode('select'); return; }
          this.temp.pts.push([wx, wy]); this.redrawOverlay();
        }
      });
      window.addEventListener('mousemove', (e) => {
        const [sx, sy] = pos(e);
        if (e.target === c) { const [wx, wy] = this.toWorld(sx, sy); this.app.onMapMouse(wx, wy); }
        if (drag) {
          if (drag.type === 'pan') { this.cx = drag.cx - (sx - drag.sx) / this.scale; this.cy = drag.cy + (sy - drag.sy) / this.scale; this.interacting = true; this._schedule(); }
          else if (drag.type === 'box' || drag.type === 'zoombox') { this.temp = { kind: 'box', x0: drag.sx, y0: drag.sy, x1: sx, y1: sy }; this.redrawOverlay(); }
          else if (drag.type === 'vertex') {
            if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 3) return;
            drag.moved = true; const [wx, wy] = this.toWorld(sx, sy); drag.link.verts[drag.i] = [wx, wy]; this.liveEdit();
          }
          else if (drag.type === 'move') {
            if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 4) return;
            if (!this.app.editEnabled) return;
            drag.moved = true;
            const [wx, wy] = this.toWorld(sx, sy); drag.obj.x = wx; drag.obj.y = wy;
            this.dragObj = drag.obj; this.liveEdit();
          }
          return;
        }
        if (e.target !== c) return;
        if (this.temp && (this.temp.kind === 'link' || this.temp.kind === 'poly' || this.temp.kind === 'measure' || this.temp.kind === 'line')) { this.temp.cursor = [sx, sy]; this.redrawOverlay(); }
        if (this.mode === 'splitsub' && this.temp && this.temp.kind === 'ssplit') { this.app.feat.subSplitMove(sx, sy); this.redrawOverlay(); }
        if (this.mode === 'pick' && this.pickSplit) { const hit = this.hitTest(sx, sy, ['LINK']); const on = !!hit && hit.type === 'CONDUIT'; const was = !!this.splitCur;
          this.splitCur = on ? [sx, sy] : null; c.style.cursor = on ? 'none' : 'default'; if (on || was) this.redrawOverlay(); }
        // hover tooltip
        if (this.mode === 'select' || this.mode === 'pick' || this.mode.startsWith('add-')) {
          const hit = this.hitTest(sx, sy);
          if ((!hit || (hit.kind === 'SUBCATCH' && this.meshAboveSubs())) && this.app.mesh2d && this.mode === 'select' && AV.meshHit(this, ...this.toWorld(sx, sy)) >= 0) { const [wx, wy] = this.toWorld(sx, sy); this.app.onHoverCell(AV.meshHit(this, wx, wy), e.clientX, e.clientY); }
          else this.app.onHover(hit, e.clientX, e.clientY);
        }
      });
      window.addEventListener('mouseup', (e) => {
        if (!drag) return;
        const [sx, sy] = pos(e);
        this.dragObj = null;
        if (drag.type === 'pan') { c.style.cursor = this.mode === 'pan' ? 'grab' : this.mode === 'select' ? 'default' : 'crosshair'; this.interacting = false; this._schedule(); }
        else if (drag.type === 'box') {
          this.temp = null;
          if (Math.hypot(sx - drag.sx, sy - drag.sy) < 4) { if (!drag.add) this.app.clearSelection();
            const k = this.app.mesh2d ? AV.meshHit(this, ...this.toWorld(sx, sy)) : -1; if (k >= 0) AV.meshSelect(this.app, [this.app.mesh2d.cells[k]], drag.add); else if (!drag.add && this.app.mesh2d) AV.meshClearSel(this.app); }
          else { const a = this.toWorld(Math.min(sx, drag.sx), Math.max(sy, drag.sy)), b = this.toWorld(Math.max(sx, drag.sx), Math.min(sy, drag.sy)); const objs = this.objectsInBox(a[0], a[1], b[0], b[1]);
            // a box with no network objects selects the 2D cells inside it
            const M = this.app.mesh2d; if (!objs.length && M && AV.meshStyle(this.app).visible) { const cells = M.cells.filter(c => c.x >= a[0] && c.x <= b[0] && c.y >= a[1] && c.y <= b[1]); if (cells.length) { AV.meshSelect(this.app, cells, drag.add); this.redrawOverlay(); drag = null; return; } }
            this.app.meshSel = -1; this.app.selectMany(objs, drag.add); }
          this.redrawOverlay();
        } else if (drag.type === 'zoombox') {
          this.temp = null;
          if (Math.hypot(sx - drag.sx, sy - drag.sy) < 6) this.zoomBy(1.6, sx, sy);
          else { const a = this.toWorld(Math.min(sx, drag.sx), Math.max(sy, drag.sy)), b = this.toWorld(Math.max(sx, drag.sx), Math.min(sy, drag.sy)); this.zoomToBox({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, 0); }
        } else if (drag.type === 'vertex' && drag.moved) {
          const l = drag.link, old = drag.old, nw = l.verts.map(v => v.slice());
          this.app.exec({ label: 'Move vertex', light: true, do: () => { l.verts = nw.map(v => v.slice()); }, undo: () => { l.verts = old.map(v => v.slice()); } });
        } else if (drag.type === 'move' && drag.moved) {
          this.app.objectMoved(drag.obj, drag.ox, drag.oy, drag.obj.x, drag.obj.y);
        }
        drag = null;
      });
      c.addEventListener('mouseleave', () => this.app.onHover(null));
      c.addEventListener('keydown', (e) => {
        if (e.key === ' ') { this.spaceDown = true; e.preventDefault(); }
        if (e.key === 'Escape' && this.mode === 'splitsub') { this.app.setTool('select'); return; }
        if (e.key === 'Escape') { if (this.temp) this.cancelTemp(); else if (this.mode !== 'select') this.app.setTool('select'); else { this.app.clearSelection(); if (this.highlight && this.highlight.size) { this.highlight = new Set(); this.redrawOverlay(); } } }
        if (e.key === 'Enter' && this.temp && this.temp.ext) this.finishDraw();
        else if (e.key === 'Enter' && this.temp && this.temp.kind === 'poly') this.finishPoly();
        if (e.key === 'Backspace' && this.temp && this.temp.pts && this.temp.pts.length > 1) { this.temp.pts.pop(); this.redrawOverlay(); }
      });
      c.addEventListener('keyup', (e) => { if (e.key === ' ') this.spaceDown = false; });
    }
    cancelTemp() { this.temp = null; this.redrawOverlay(); }
    vertexHit(sx, sy) {
      for (const o of this.app.selection) if (o.kind === 'LINK') for (let i = 0; i < o.verts.length; i++) { const [x, y] = this.toScreen(o.verts[i][0], o.verts[i][1]); if (Math.hypot(x - sx, y - sy) <= 6) return { link: o, i }; }
      return null;
    }
    finishDraw() {
      const t = this.temp; this.temp = null; if (!t) return;
      const pts = t.pts.filter((p, i) => i === 0 || Math.hypot(p[0] - t.pts[i - 1][0], p[1] - t.pts[i - 1][1]) * this.scale > 2);
      if (pts.length < (t.kind === 'poly' ? 3 : 2)) { AV.toast('Not enough vertices.'); this.redraw(); return; }
      this.app.feat.onDraw(pts); this.redraw();
    }
    finishPoly() {
      const t = this.temp; this.temp = null;
      if (!t || t.pts.length < 3) { AV.toast('A subcatchment needs at least 3 vertices.'); this.redraw(); return; }
      // remove duplicate last point from double click
      const pts = t.pts.filter((p, i) => i === 0 || Math.hypot(p[0] - t.pts[i - 1][0], p[1] - t.pts[i - 1][1]) * this.scale > 2);
      this.app.addSubcatch(pts); this.redraw();
    }
  }
  AV.MapView = MapView;
  AV.polyCentroid = (poly) => {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]; a += f; cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f; }
    if (Math.abs(a) < 1e-12) { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; }
    return [cx / (3 * a), cy / (3 * a)];
  };
  // union of polygons that share boundaries (e.g. adjacent subcatchments). Returns the outer ring, or null when
  // the polygons do not form one connected area.
  AV.unionPolygons = (polys) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of polys) for (const [x, y] of p) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    const tol = Math.max(x2 - x1, y2 - y1) * 1e-6 || 1e-9;
    const keyOf = (p) => Math.round(p[0] / tol) + ',' + Math.round(p[1] / tol);
    const signed = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; };
    const rings = polys.map(p => { let q = p.slice(); if (q.length > 1 && keyOf(q[0]) === keyOf(q[q.length - 1])) q.pop(); if (signed(q) < 0) q.reverse(); return q; });
    const allPts = []; for (const r of rings) for (const p of r) allPts.push(p);
    const pts = new Map(); for (const p of allPts) if (!pts.has(keyOf(p))) pts.set(keyOf(p), p);
    // split every edge at vertices of the other polygons lying on it (T-junctions)
    const edges = [];
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const L2 = dx * dx + dy * dy; if (!L2) continue;
      const mids = [];
      for (const p of pts.values()) { const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2; if (t <= 1e-9 || t >= 1 - 1e-9) continue; const px = a[0] + t * dx, py = a[1] + t * dy; if (Math.hypot(px - p[0], py - p[1]) <= tol * 2) mids.push([t, p]); }
      mids.sort((u, v) => u[0] - v[0]); let prev = a; for (const [, p] of mids) { edges.push([prev, p]); prev = p; } edges.push([prev, b]);
    }
    const cnt = new Map(); for (const [a, b] of edges) { const ka = keyOf(a), kb = keyOf(b); if (ka === kb) continue; const k = ka < kb ? ka + '|' + kb : kb + '|' + ka; cnt.set(k, (cnt.get(k) || 0) + 1); }
    const nextOf = new Map();
    for (const [a, b] of edges) { const ka = keyOf(a), kb = keyOf(b); if (ka === kb) continue; const k = ka < kb ? ka + '|' + kb : kb + '|' + ka; if (cnt.get(k) > 1) continue; if (!nextOf.has(ka)) nextOf.set(ka, []); nextOf.get(ka).push(b); }
    const loops = []; const used = new Set();
    for (const [ks, list] of nextOf) for (const first of list) {
      const ek = ks + '>' + keyOf(first); if (used.has(ek)) continue;
      const loop = [pts.get(ks)]; let cur = ks, nxt = first, guard = 0;
      while (guard++ < 100000) {
        used.add(cur + '>' + keyOf(nxt)); const kn = keyOf(nxt); if (kn === ks) break; loop.push(nxt);
        const cand = (nextOf.get(kn) || []).filter(p => !used.has(kn + '>' + keyOf(p))); if (!cand.length) break; cur = kn; nxt = cand[0];
      }
      if (loop.length >= 3) loops.push(loop);
    }
    if (!loops.length) return null;
    loops.sort((a, b) => Math.abs(signed(b)) - Math.abs(signed(a)));
    const outer = loops[0]; const total = rings.reduce((s, r) => s + Math.abs(signed(r)), 0);
    // a second loop that is not inside the outer ring means the polygons are not connected
    for (const l of loops.slice(1)) { const c = l[0]; if (signed(l) > 0 && !AV.pointInPoly(c[0], c[1], outer)) return null; }
    if (Math.abs(signed(outer)) < total * 0.98) return null;
    // drop collinear points
    const out = outer.filter((p, i) => { const a = outer[(i - 1 + outer.length) % outer.length], b = outer[(i + 1) % outer.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L > tol * 2; });
    return (out.length >= 3 ? out : outer).map(p => p.slice());
  };
  AV.polyArea = (poly) => { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]; return Math.abs(a / 2); };
  AV.distSeg = distSeg;
})(window.AV);
