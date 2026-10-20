// Lightweight canvas time-series chart: multi-series, hover read-out, drag zoom
'use strict';
(function (AV) {
  const h = AV.h;
  const COLORS = ['#1565c0', '#d84315', '#2e7d32', '#6a1b9a', '#00838f', '#f9a825', '#ad1457', '#4e342e', '#283593', '#558b2f'];
  AV.SERIES_COLORS = COLORS;
  // user styles per series name (colour, width, line type, markers, hidden) - click a legend entry to edit
  const DASHES = { solid: [], dash: [8, 4], dot: [2, 3], dashdot: [8, 3, 2, 3], long: [14, 5] };
  let STY = {}; try { STY = JSON.parse(localStorage.getItem('osemcm.seriesStyle') || '{}'); } catch (e) { }
  const saveSty = () => { try { localStorage.setItem('osemcm.seriesStyle', JSON.stringify(STY)); } catch (e) { } };
  const skey = (ch, s) => (ch.title || ch.yLabel || '') + '|' + s.name;
  const styled = (s, ch) => { const u = STY[skey(ch, s)]; if (!u) return s; const o = Object.assign({}, s); if (u.color) o.color = u.color; if (u.width) o.width = u.width; if (u.dash) o.dash = DASHES[u.dash] || null; if (u.marker) o.marker = u.marker; o.hidden = !!u.hidden; return o; };

  class Chart {
    constructor(container, opts = {}) {
      this.box = h('div', { class: 'chartbox' });
      this.canvas = h('canvas'); this.box.appendChild(this.canvas);
      container.appendChild(this.box);
      this.ctx = this.canvas.getContext('2d');
      this.series = []; this.opts = opts; this.xr = null; this.hoverX = null;
      this.title = opts.title || ''; this.yLabel = opts.yLabel || ''; this.xLabel = opts.xLabel || 'Elapsed Time (hours)';
      this.markerX = null; this.peers = [];
      new ResizeObserver(() => this.resize()).observe(this.box);
      this._bind();
    }
    setSeries(series, opts = {}) {
      this.raw = series.map((s, i) => Object.assign({ color: COLORS[i % COLORS.length] }, s));
      this.series = this.raw.map(x => styled(x, this));
      Object.assign(this, opts); this.xr = null; this.draw();
    }
    resize() {
      const r = this.box.getBoundingClientRect(); this.dpr = window.devicePixelRatio || 1;
      this.w = Math.max(50, r.width); this.hh = Math.max(50, r.height);
      this.canvas.width = this.w * this.dpr; this.canvas.height = this.hh * this.dpr; this.draw();
    }
    extent() {
      let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
      for (const s of this.series) if (!s.hidden) for (let i = 0; i < s.y.length; i++) {
        const x = s.x[i], y = s.y[i]; if (!isFinite(y)) continue;
        if (this.xr && (x < this.xr[0] || x > this.xr[1])) continue;
        if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      }
      if (this.xr) { x1 = this.xr[0]; x2 = this.xr[1]; }
      if (x1 === Infinity) return null;
      if (y1 === y2) { y1 -= 1; y2 += 1; }
      if (y1 > 0 && (y1 < (y2 - y1) * 0.6 || this.series.some(s => s.bars))) y1 = 0;
      const pad = (y2 - y1) * 0.06; return { x1, x2, y1: y1 - (y1 === 0 ? 0 : pad), y2: y2 + pad };
    }
    ticks(a, b, n) {
      const span = b - a; if (!(span > 0)) return [a];
      const raw = span / n; const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
      const out = []; for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(+v.toPrecision(12)); return out;
    }
    draw() {
      if (!this.w) return;
      const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.w, this.hh);
      const L = 68, R = 18, T = this.title ? 34 : 16, B = 46 + Math.ceil(this.series.length / 3) * 16;
      this.plot = { L, R, T, B, W: this.w - L - R, H: this.hh - T - B };
      const e = this.extent(); this.e = e;
      ctx.font = '12px Segoe UI, Arial'; ctx.fillStyle = '#263238';
      if (this.title) { ctx.font = 'bold 13px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(this.title, this.w / 2, 20); ctx.font = '12px Segoe UI'; }
      if (!e) { ctx.textAlign = 'center'; ctx.fillStyle = '#90a4ae'; ctx.fillText('No data', this.w / 2, this.hh / 2); return; }
      const P = this.plot;
      const inv = !!this.invert;
      const sx = (x) => P.L + (x - e.x1) / (e.x2 - e.x1 || 1) * P.W, sy = (y) => inv ? P.T + (y - e.y1) / (e.y2 - e.y1) * P.H : P.T + P.H - (y - e.y1) / (e.y2 - e.y1) * P.H;
      this.sx = sx; this.sy = sy;
      // grid
      ctx.strokeStyle = '#eceff1'; ctx.lineWidth = 1; ctx.fillStyle = '#546e7a'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const t of this.ticks(e.y1, e.y2, 6)) { const y = Math.round(sy(t)) + .5; ctx.beginPath(); ctx.moveTo(P.L, y); ctx.lineTo(P.L + P.W, y); ctx.stroke(); ctx.fillText(AV.fmt(t), P.L - 6, y); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const t of this.ticks(e.x1, e.x2, Math.max(3, Math.floor(P.W / 90)))) { const x = Math.round(sx(t)) + .5; ctx.beginPath(); ctx.moveTo(x, P.T); ctx.lineTo(x, P.T + P.H); ctx.stroke(); ctx.fillText(this.xFmt ? this.xFmt(t) : AV.fmt(t), x, P.T + P.H + 5); }
      ctx.strokeStyle = '#90a4ae'; ctx.strokeRect(P.L + .5, P.T + .5, P.W, P.H);
      // labels
      ctx.fillStyle = '#37474f'; ctx.fillText(this.xLabel, P.L + P.W / 2, P.T + P.H + 22);
      ctx.save(); ctx.translate(14, P.T + P.H / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(this.yLabel, 0, 0); ctx.restore();
      // series
      ctx.save(); ctx.beginPath(); ctx.rect(P.L, P.T, P.W, P.H); ctx.clip();
      for (const s of this.series) {
        if (s.hidden) continue;
        if (s.bars) {
          // bar (hyetograph) style: vertical bars from zero, width = sample spacing
          const n = s.y.length; const dx = n > 1 ? Math.abs(sx(s.x[1]) - sx(s.x[0])) : 4; const bw = Math.max(1, dx * 0.8);
          ctx.fillStyle = s.color; const y0 = sy(Math.max(e.y1, 0));
          for (let i = 0; i < n; i++) { const y = s.y[i]; if (!isFinite(y) || y === 0) continue; const X = sx(s.x[i]), Y = sy(y); ctx.fillRect(X - bw, Math.min(y0, Y), bw, Math.abs(Y - y0)); }
          continue;
        }
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.8; ctx.setLineDash(s.dash || []);
        ctx.beginPath(); let started = false;
        const n = s.y.length; const step = Math.max(1, Math.floor(n / (P.W * 2)));
        for (let i = 0; i < n; i += step) {
          const y = s.y[i]; if (!isFinite(y)) { started = false; continue; }
          const X = sx(s.x[i]), Y = sy(y);
          if (s.steps && started) ctx.lineTo(X, ctx._lastY === undefined ? Y : ctx._lastY);
          started ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); started = true; ctx._lastY = Y;
        }
        ctx._lastY = undefined; ctx.stroke();
        if (s.marker && s.marker !== 'none') { ctx.setLineDash([]); ctx.fillStyle = s.color; const ms = Math.max(2.5, (s.width || 1.8) + 1); const mstep = Math.max(1, Math.ceil(n / Math.max(1, P.W / 14))); for (let i = 0; i < n; i += mstep) { const y = s.y[i]; if (!isFinite(y)) continue; const X = sx(s.x[i]), Y = sy(y); ctx.beginPath(); if (s.marker === 'square') ctx.rect(X - ms, Y - ms, 2 * ms, 2 * ms); else if (s.marker === 'triangle') { ctx.moveTo(X, Y - ms * 1.2); ctx.lineTo(X + ms, Y + ms * 0.8); ctx.lineTo(X - ms, Y + ms * 0.8); ctx.closePath(); } else ctx.arc(X, Y, ms, 0, 7); ctx.fill(); } }
      }
      ctx.setLineDash([]);
      if (this.markerX !== null && this.markerX >= e.x1 && this.markerX <= e.x2) { ctx.strokeStyle = '#ff6d00'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx(this.markerX), P.T); ctx.lineTo(sx(this.markerX), P.T + P.H); ctx.stroke(); }
      if (this.zoomDrag) { ctx.fillStyle = 'rgba(21,101,192,.12)'; const a = Math.min(this.zoomDrag[0], this.zoomDrag[1]), b = Math.max(this.zoomDrag[0], this.zoomDrag[1]); ctx.fillRect(a, P.T, b - a, P.H); }
      ctx.restore();
      // legend
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '12px Segoe UI';
      const colW = Math.max(160, P.W / 3);
      this._leg = [];
      this.series.forEach((s, i) => {
        const x = P.L + (i % 3) * colW, y = P.T + P.H + 40 + Math.floor(i / 3) * 16;
        ctx.globalAlpha = s.hidden ? 0.35 : 1;
        if (s.bars) { ctx.fillStyle = s.color; ctx.fillRect(x, y - 5, 22, 10); } else { ctx.strokeStyle = s.color; ctx.lineWidth = Math.min(4, (s.width || 1.8) + 0.7); ctx.setLineDash(s.dash || []); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 22, y); ctx.stroke(); ctx.setLineDash([]); if (s.marker && s.marker !== 'none') { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x + 11, y, 3, 0, 7); ctx.fill(); } }
        ctx.fillStyle = '#263238'; ctx.fillText(s.name, x + 28, y); ctx.globalAlpha = 1;
        this._leg.push({ x, y: y - 8, w: Math.min(colW - 6, 32 + ctx.measureText(s.name).width), h: 16, i });
      });
      // hover readout
      if (this.hoverX !== null) {
        const xv = e.x1 + (this.hoverX - P.L) / P.W * (e.x2 - e.x1);
        ctx.strokeStyle = '#78909c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(this.hoverX, P.T); ctx.lineTo(this.hoverX, P.T + P.H); ctx.stroke();
        const lines = [this.xFmt ? this.xFmt(xv) : AV.fmt(xv)];
        for (const s of this.series) { if (s.hidden) continue; const i = this._nearest(s.x, xv); if (i >= 0) { lines.push(s.name + ': ' + AV.fmt(s.y[i])); ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(sx(s.x[i]), sy(s.y[i]), 3.5, 0, 7); ctx.fill(); } }
        ctx.font = '11.5px Segoe UI'; const wbox = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14; let bx = this.hoverX + 10; if (bx + wbox > P.L + P.W) bx = this.hoverX - wbox - 10;
        ctx.fillStyle = 'rgba(38,50,56,.9)'; ctx.fillRect(bx, P.T + 6, wbox, lines.length * 16 + 6);
        ctx.fillStyle = '#fff'; lines.forEach((l, i) => ctx.fillText(l, bx + 7, P.T + 15 + i * 16));
      }
    }
    _nearest(xs, x) { let lo = 0, hi = xs.length - 1; if (hi < 0) return -1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m; else hi = m; } return Math.abs(xs[lo] - x) < Math.abs(xs[hi] - x) ? lo : hi; }
    _bind() {
      const c = this.canvas; const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      c.addEventListener('mousemove', (e) => {
        const [x, y] = pos(e); const P = this.plot; if (!P) return;
        if (this.zoomDrag) { this.zoomDrag[1] = Math.max(P.L, Math.min(P.L + P.W, x)); }
        this.hoverX = (x >= P.L && x <= P.L + P.W) ? x : null; this.draw();
        for (const p of this.peers) { p.hoverX = this.hoverX; p.draw(); }
      });
      c.addEventListener('mouseleave', () => { this.hoverX = null; this.draw(); for (const p of this.peers) { p.hoverX = null; p.draw(); } });
      const legAt = (x, y) => (this._leg || []).find(l => x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h);
      c.addEventListener('mousemove', (e) => { const [x, y] = pos(e); c.style.cursor = legAt(x, y) ? 'pointer' : ''; });
      c.addEventListener('mousedown', (e) => { const [x, y] = pos(e); const lg = legAt(x, y); if (lg) { e.preventDefault(); this.styleEditor(this.series[lg.i], e.clientX, e.clientY); return; } const P = this.plot; if (P && x >= P.L && x <= P.L + P.W && y >= P.T && y <= P.T + P.H) this.zoomDrag = [x, x]; });
      c.addEventListener('mouseup', () => {
        if (!this.zoomDrag || !this.e) { this.zoomDrag = null; return; }
        const [a, b] = this.zoomDrag; this.zoomDrag = null; const P = this.plot, e = this.e;
        if (Math.abs(b - a) > 8) { const x1 = e.x1 + (Math.min(a, b) - P.L) / P.W * (e.x2 - e.x1), x2 = e.x1 + (Math.max(a, b) - P.L) / P.W * (e.x2 - e.x1); this.xr = [x1, x2]; for (const p of this.peers) { p.xr = [x1, x2]; p.draw(); } }
        this.draw();
      });
      c.addEventListener('dblclick', () => { this.xr = null; this.draw(); for (const p of this.peers) { p.xr = null; p.draw(); } });
    }
    // small popup to change one series' colour, width, line type, markers and visibility
    styleEditor(sr, cx, cy) {
      document.querySelectorAll('.serstyle').forEach(e => e.remove());
      const name = sr.name, key = skey(this, sr); const u = Object.assign({}, STY[key] || {});
      const apply = () => { STY[key] = u; saveSty(); for (const ch of new Set([this].concat(AV.openCharts || []))) if (ch.raw) { ch.series = ch.raw.map(x => styled(x, ch)); ch.draw(); } };
      const toHex = AV.toHex || ((c) => c);
      const col = h('input', { type: 'color', value: toHex(u.color || sr.color), oninput: () => { u.color = col.value; apply(); } });
      const wid = h('input', { type: 'number', min: 0.5, max: 8, step: 0.5, value: u.width || sr.width || 1.8, style: { width: '56px' }, oninput: () => { u.width = Math.max(0.5, +wid.value || 1.8); apply(); } });
      const curDash = u.dash || (Object.keys(DASHES).find(k => JSON.stringify(DASHES[k]) === JSON.stringify(sr.dash || [])) || 'solid');
      const dash = h('select', { onchange: () => { u.dash = dash.value; apply(); } }, [['solid', '──── Solid'], ['dash', '‒ ‒ ‒ Dashed'], ['dot', '····· Dotted'], ['dashdot', '‒·‒· Dash-dot'], ['long', '—  — Long dash']].map(([v, l]) => h('option', { value: v }, l))); dash.value = curDash;
      const mk = h('select', { onchange: () => { u.marker = mk.value; apply(); } }, [['none', 'None'], ['circle', '● Circle'], ['square', '■ Square'], ['triangle', '▲ Triangle']].map(([v, l]) => h('option', { value: v }, l))); mk.value = u.marker || 'none';
      const vis = h('input', { type: 'checkbox', checked: !u.hidden, onchange: () => { u.hidden = !vis.checked; apply(); } });
      const box = h('div', { class: 'serstyle', style: { left: Math.min(cx, window.innerWidth - 250) + 'px', top: Math.min(cy, window.innerHeight - 230) + 'px' } },
        h('div', { class: 'ssh' }, h('span', null, name), h('button', { class: 'x', onclick: () => box.remove() }, '×')),
        h('div', { class: 'ssg' }, h('label', null, 'Colour'), col, h('label', null, 'Width'), wid, h('label', null, 'Line'), dash, h('label', null, 'Markers'), mk, h('label', null, 'Visible'), vis),
        h('div', { class: 'ssb' }, h('button', { class: 'btn small', onclick: () => { delete STY[key]; saveSty(); for (const ch of new Set([this].concat(AV.openCharts || []))) if (ch.raw) { ch.series = ch.raw.map(x => styled(x, ch)); ch.draw(); } box.remove(); } }, 'Reset'), h('button', { class: 'btn small primary', onclick: () => box.remove() }, 'Close')));
      document.body.appendChild(box);
      setTimeout(() => { const off = (e) => { if (!box.contains(e.target)) { box.remove(); document.removeEventListener('mousedown', off, true); } }; document.addEventListener('mousedown', off, true); }, 0);
    }
    toCSV() {
      if (!this.series.length) return '';
      const s0 = this.series[0];
      const rows = [['Time'].concat(this.series.map(s => s.name)).map(AV.csvCell).join(',')];
      for (let i = 0; i < s0.x.length; i++) rows.push([this.xFmt ? this.xFmt(s0.x[i]) : s0.x[i]].concat(this.series.map(s => s.y[i] === undefined ? '' : s.y[i])).map(AV.csvCell).join(','));
      return rows.join('\n');
    }
    toPNG() { return this.canvas.toDataURL('image/png'); }
  }
  AV.Chart = Chart;
})(window.AV);
