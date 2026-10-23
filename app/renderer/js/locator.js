// Map corner tools: "eye" (show / hide all theme and 2D-mesh result colouring) and the Locator overview map
// (whole model in miniature, red box = current view; click or drag in it to move the map there).
'use strict';
(function (AV) {
  const h = AV.h;
  const EYE_ON = '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2.2"/>';
  const EYE_OFF = EYE_ON + '<path d="M2.5 13.5l11-11"/>';
  const LOC = '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><rect x="6" y="6" width="5" height="4" fill="currentColor" fill-opacity=".25"/>';
  const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.innerHTML = d; return s; };

  class MapCorner {
    constructor(app, wrap) {
      this.app = app; const P = app.prefs || {};
      this.eyeBtn = h('button', { class: 'mcbtn', title: 'Hide / show theme colouring (T)', onclick: () => this.toggleEye() });
      this.locBtn = h('button', { class: 'mcbtn', title: 'Show / hide the Locator (overview map)', onclick: () => this.toggleLocator() }, svg(LOC));
      this.canvas = h('canvas', { class: 'loccv' });
      this.box = h('div', { class: 'locator' }, h('div', { class: 'loch' }, h('span', null, 'Locator'), h('button', { title: 'Close', onclick: () => this.toggleLocator(false) }, '×')), this.canvas);
      this.el = h('div', { class: 'mapcorner' }, h('div', { class: 'mcbar' }, this.eyeBtn, this.locBtn), this.box);
      wrap.appendChild(this.el);
      this.showLoc = P.locator !== false; this.box.style.display = this.showLoc ? '' : 'none'; this.locBtn.classList.toggle('on', this.showLoc);
      this.renderEye();
      let drag = false;
      const go = (e) => { const r = this.canvas.getBoundingClientRect(); const T = this.tf; if (!T) return; const wx = T.x1 + (e.clientX - r.left - T.ox) / T.s, wy = T.y2 - (e.clientY - r.top - T.oy) / T.s;
        const map = this.app.map; map.cx = wx; map.cy = wy; map.interacting = true; map._schedule(); clearTimeout(this._st); this._st = setTimeout(() => { map.interacting = false; map.redraw(); }, 150); };
      this.canvas.addEventListener('mousedown', (e) => { drag = true; go(e); e.preventDefault(); });
      window.addEventListener('mousemove', (e) => { if (drag) go(e); });
      window.addEventListener('mouseup', () => { drag = false; });
      this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.app.map.zoomBy(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
      document.addEventListener('keydown', (e) => { if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.altKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) && !document.querySelector('.modal-back')) this.toggleEye(); });
    }
    renderEye() { const hid = !!this.app.themeHidden; this.eyeBtn.innerHTML = ''; this.eyeBtn.appendChild(svg(hid ? EYE_OFF : EYE_ON)); this.eyeBtn.classList.toggle('off', hid); this.eyeBtn.title = this.app.partView && this.app.partView.P ? (hid ? 'Show' : 'Hide') + ' the cut points, not-cut pipes and ponding areas of the partition (T)' : (hid ? 'Show' : 'Hide') + ' theme colouring (T)'; }
    toggleEye(v) {
      const app = this.app; app.themeHidden = v === undefined ? !app.themeHidden : !!v; this.renderEye();
      if (app.theme) app.theme.updateLegend(); app.map.redraw();
      if (app.partView && app.partView.P) { app.status(app.themeHidden ? 'Partition markings hidden (cut points, not-cut pipes, ponding areas). Click the eye or press T to show them.' : 'Partition markings shown.'); return; }
      app.status(app.themeHidden ? 'Theme colouring hidden (objects drawn with their base symbols). Click the eye or press T to show it again.' : 'Theme colouring shown.');
    }
    toggleLocator(v) {
      this.showLoc = v === undefined ? !this.showLoc : !!v; this.box.style.display = this.showLoc ? '' : 'none'; this.locBtn.classList.toggle('on', this.showLoc);
      if (this.app.prefs) { this.app.prefs.locator = this.showLoc; this.app.savePrefs && this.app.savePrefs(); }
      if (this.showLoc) this.update(true);
    }
    // overview bitmap of the whole model, rebuilt only when the geometry changes
    _overview(W, H, dpr) {
      const m = this.app.model; if (!m) return null; const key = W + 'x' + H + '@' + dpr + '|' + (m.geomVersion || 0) + '|' + m.nodes.size + '|' + m.links.size + '|' + (this.app.mesh2d ? this.app.mesh2d.cells.length : 0);
      if (this._ov && this._ovKey === key && this._ovModel === m) return this._ov;
      const b = m.bounds(false); if (!b) return null;
      const pad = 6, bw = Math.max(b.x2 - b.x1, 1e-6), bh = Math.max(b.y2 - b.y1, 1e-6); const s = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
      const ox = (W - bw * s) / 2, oy = (H - bh * s) / 2; const tf = { x1: b.x1, y2: b.y2, s, ox, oy };
      const cv = document.createElement('canvas'); cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr);
      const X = (x) => ox + (x - b.x1) * s, Y = (y) => oy + (b.y2 - y) * s;
      if (this.app.mesh2d && this.app.mesh2d.boundary) { /* mesh boundary is drawn through the subcatchments below */ }
      c.fillStyle = 'rgba(102,187,106,.18)'; c.strokeStyle = 'rgba(76,140,80,.45)'; c.lineWidth = 0.5;
      let ns = 0; for (const sc of m.subcatchments.values()) { if (!sc.poly || sc.poly.length < 3 || ns++ > 20000) continue; c.beginPath(); sc.poly.forEach(([x, y], i) => i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))); c.closePath(); c.fill(); }
      c.strokeStyle = '#455a64'; c.lineWidth = 0.8; c.beginPath();
      for (const l of m.links.values()) { const a = m.nodes.get(l.from), z = m.nodes.get(l.to); const P = a && z ? [[a.x, a.y]].concat(l.verts || []).concat([[z.x, z.y]]) : null; if (!P) continue; P.forEach(([x, y], i) => i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))); }
      c.stroke();
      if (!m.links.size) { c.fillStyle = '#455a64'; for (const n of m.nodes.values()) c.fillRect(X(n.x) - 1, Y(n.y) - 1, 2, 2); }
      this._ov = { cv, tf }; this._ovKey = key; this._ovModel = m; return this._ov;
    }
    update(force) {
      if (!this.showLoc) return; const app = this.app, map = app.map; if (!map || !app.model) return;
      const r = this.canvas.getBoundingClientRect(); const W = Math.round(r.width) || 200, H = Math.round(r.height) || 140; const dpr = window.devicePixelRatio || 1;
      if (this.canvas.width !== W * dpr || this.canvas.height !== H * dpr) { this.canvas.width = W * dpr; this.canvas.height = H * dpr; }
      const c = this.canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
      // large models: reuse the map's overview bitmap instead of drawing every link again
      let ov = null; const MO = map._ov;
      if (MO && !MO.partial && MO.model === app.model && map._objCount && map._objCount() >= 60000) {
        const B = MO.box, bw = B.x2 - B.x1, bh = B.y2 - B.y1, s = Math.min((W - 8) / bw, (H - 8) / bh), ox = (W - bw * s) / 2, oy = (H - bh * s) / 2;
        if (!this._ovc || this._ovcSrc !== MO.canvas || this._ovcGen !== MO.gen || this._ovcW !== W) { const cv = document.createElement('canvas'); cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(MO.canvas, ox * dpr, oy * dpr, bw * s * dpr, bh * s * dpr); this._ovc = { cv, tf: { x1: B.x1, y2: B.y2, s, ox, oy } }; this._ovcSrc = MO.canvas; this._ovcGen = MO.gen; this._ovcW = W; }
        ov = this._ovc;
      } else if (map._objCount && map._objCount() >= 60000) ov = this._ovc || null;   // wait for the map overview (no second full drawing)
      else ov = this._overview(W, H, dpr); if (!ov) { this.tf = null; c.fillStyle = '#90a4ae'; c.font = '11px Segoe UI'; c.fillText(app.model && app.model.nodes.size ? 'Preparing overview…' : 'No model', 8, 18); return; }
      c.drawImage(ov.cv, 0, 0, W, H); const T = ov.tf; this.tf = T;
      const vb = map.visibleBox(); let x1 = T.ox + (vb.x1 - T.x1) * T.s, x2 = T.ox + (vb.x2 - T.x1) * T.s, y1 = T.oy + (T.y2 - vb.y2) * T.s, y2 = T.oy + (T.y2 - vb.y1) * T.s;
      // a very small view still gets a visible marker
      if (x2 - x1 < 6) { const cx = (x1 + x2) / 2; x1 = cx - 3; x2 = cx + 3; } if (y2 - y1 < 6) { const cy = (y1 + y2) / 2; y1 = cy - 3; y2 = cy + 3; }
      c.fillStyle = 'rgba(229,57,53,.12)'; c.fillRect(x1, y1, x2 - x1, y2 - y1); c.strokeStyle = '#e53935'; c.lineWidth = 1.6; c.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
  }
  AV.MapCorner = MapCorner;
})(window.AV);
