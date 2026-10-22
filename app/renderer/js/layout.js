// Print layout (Project ▸ Print ▸ Print Layout): the map with a title block, legend, scale bar and north arrow on a
// page, printed or saved as PDF / PNG (the main process renders the page in a hidden window).
//   Map extent: the current map view fitted into the map frame, or a fixed scale 1:N around the map centre.
//   Templates: title block along the bottom, or a side panel on the right.
'use strict';
(function (AV) {
  const h = AV.h;
  const PAGES = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], Letter: [279.4, 215.9], Legal: [355.6, 215.9], Tabloid: [431.8, 279.4], 'ANSI C': [558.8, 431.8], 'ANSI D': [863.6, 558.8] };
  const PX_PER_M = 96 / 0.0254;          // CSS pixels per metre of paper
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/\n/g, '<br>');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  // the map drawn into an off-screen canvas: W x H CSS pixels at dpr device pixels per CSS pixel
  AV.renderMapCanvas = function (app, W, H, dpr, cx, cy, scale) {
    const map = app.map; const keep = { w: map.w, hgt: map.hgt, dpr: map.dpr, cx: map.cx, cy: map.cy, scale: map.scale, ctx: map.ctx, ov: app.prefs.mapOverview };
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    map.w = W; map.hgt = H; map.dpr = dpr; map.cx = cx; map.cy = cy; map.scale = scale; map.ctx = cv.getContext('2d'); app.prefs.mapOverview = false;
    try { map.drawBase(); } finally { Object.assign(map, { w: keep.w, hgt: keep.hgt, dpr: keep.dpr, cx: keep.cx, cy: keep.cy, scale: keep.scale, ctx: keep.ctx }); app.prefs.mapOverview = keep.ov; map.grid = map.grid; }
    return cv;
  };

  class Layout {
    constructor(app) {
      this.app = app;
      this.S = Object.assign({ page: 'A3', orient: 'landscape', dpi: 200, tpl: 'bottom', extent: 'view', scaleN: 5000, title: '', subtitle: '', project: '', org: '', drawn: '', date: today(), sheet: '1', notes: '', legend: true, north: true, scalebar: true, frame: true, legendPos: 'tr', logo: '' }, app.prefs.layout || {});
      if (!this.S.title) this.S.title = app.filePath ? AV.basename(app.filePath).replace(/\.inp$/i, '') : 'Model';
    }
    unitsPerM() { const u = String((this.app.model.mapInfo || {}).units || '').toUpperCase(); return u === 'FEET' ? 0.3048 : u === 'METERS' ? 1 : null; }
    pageMM() { const p = PAGES[this.S.page] || PAGES.A3; return this.S.orient === 'portrait' ? [p[1], p[0]] : [p[0], p[1]]; }
    // boxes in mm: map frame, title block / side panel
    boxes() {
      const [W, H] = this.pageMM(); const M = W >= 500 ? 15 : 10; const big = W >= 500 ? 1.4 : 1;
      if (this.S.tpl === 'side') { const pw = Math.max(70, Math.min(110, W * 0.24)); return { W, H, M, big, map: [M, M, W - 2 * M - pw - 4, H - 2 * M], side: [W - M - pw, M, pw, H - 2 * M] }; }
      const tb = Math.max(30, Math.min(48, H * 0.13)); return { W, H, M, big, map: [M, M, W - 2 * M, H - 2 * M - tb - 3], block: [M, H - M - tb, W - 2 * M, tb] };
    }
    // map scale (CSS px per map unit) and centre for the map frame
    view() {
      const map = this.app.map, B = this.boxes(); const fw = B.map[2] / 25.4 * 96, fh = B.map[3] / 25.4 * 96; const upm = this.unitsPerM();
      if (this.S.extent === 'scale' && upm) { const scale = PX_PER_M * upm / Math.max(1, this.S.scaleN); return { cx: map.cx, cy: map.cy, scale, fw, fh, N: this.S.scaleN }; }
      const vb = map.visibleBox(); const scale = Math.min(fw / Math.max(1e-9, vb.x2 - vb.x1), fh / Math.max(1e-9, vb.y2 - vb.y1));
      return { cx: (vb.x1 + vb.x2) / 2, cy: (vb.y1 + vb.y2) / 2, scale, fw, fh, N: upm ? PX_PER_M * upm / scale : null };
    }
    async renderMap(dpi) {
      const V = this.view(); const dpr = dpi / 96; const app = this.app;
      let cv = AV.renderMapCanvas(app, V.fw, V.fh, dpr, V.cx, V.cy, V.scale);
      // basemap tiles of the print scale load in the background: draw again once they are there
      if (AV.basemapState && AV.basemapState(app).on) {
        for (let k = 0; k < 40; k++) { await new Promise(r => setTimeout(r, 250)); if (!(AV.basemapPending && AV.basemapPending())) break; }
        cv = AV.renderMapCanvas(app, V.fw, V.fh, dpr, V.cx, V.cy, V.scale); }
      return { url: cv.toDataURL('image/png'), V };
    }
    legendHTML() {
      const el = AV.$('#legend'); const theme = el && el.style.display !== 'none' && el.innerHTML.trim() ? el.innerHTML : '';
      const app = this.app, m = app.model, lv = app.map.layerVis || {}; const rows = [];
      const nodeRow = (t, l) => { const s = AV.symOf(app, t); return '<div class="lr"><span class="lsym" style="background:' + s.color + ';border:1px solid ' + s.stroke + ';border-radius:' + (s.shape === 'circle' ? '50%' : '1px') + ';width:9px;height:9px"></span>' + l + '</div>'; };
      const linkRow = (t, l) => { const s = AV.symOf(app, t); return '<div class="lr"><span class="lsym" style="background:' + s.color + ';height:' + Math.max(2, s.width) + 'px;width:22px"></span>' + l + '</div>'; };
      const types = (coll) => new Set([...coll.values()].map(o => o.type));
      if (lv.nodes !== false) { const T = types(m.nodes); for (const [t, l] of [['JUNCTION', 'Junction'], ['OUTFALL', 'Outfall'], ['STORAGE', 'Storage'], ['DIVIDER', 'Divider']]) if (T.has(t) && AV.symOf(app, t).visible) rows.push(nodeRow(t, l)); }
      if (lv.links !== false) { const T = types(m.links); for (const [t, l] of [['CONDUIT', 'Conduit'], ['PUMP', 'Pump'], ['ORIFICE', 'Orifice'], ['WEIR', 'Weir'], ['OUTLET', 'Outlet']]) if (T.has(t) && AV.symOf(app, t).visible) rows.push(linkRow(t, l)); }
      if (lv.subcatchments !== false && m.subcatchments.size && AV.symOf(app, 'SUBCATCH').visible) { const s = AV.symOf(app, 'SUBCATCH'); rows.push('<div class="lr"><span class="lsym" style="background:' + s.fill + ';border:1px solid ' + s.outline + ';width:16px;height:10px"></span>Subcatchment</div>'); }
      return '<div class="lt">Legend</div>' + rows.join('') + (theme ? '<div class="lsep"></div>' + theme : '');
    }
    scaleBarSVG(V, widthMM) {
      const upm = this.unitsPerM(); const unitsPerMM = 96 / 25.4 / V.scale;   // map units per mm of paper
      const target = widthMM * unitsPerMM * (upm || 1);                         // metres (or map units) across widthMM
      const us = upm === 0.3048; let len, lab, f;                                // f: map units per label unit
      if (us) { const ft = target / 0.3048; const nice = [1, 2, 5]; let p = Math.pow(10, Math.floor(Math.log10(ft))); len = ft; for (const k of [5, 2, 1]) if (k * p <= ft) { len = k * p; break; } void nice; lab = len >= 5280 ? AV.fmt(len / 5280, 2) + ' mi' : len + ' ft'; f = 1; }
      else { const mm = target; let p = Math.pow(10, Math.floor(Math.log10(mm))); len = mm; for (const k of [5, 2, 1]) if (k * p <= mm) { len = k * p; break; } lab = upm ? (len >= 1000 ? AV.fmt(len / 1000, 3) + ' km' : len + ' m') : len + ' units'; f = upm ? 1 / upm : 1; }
      const wmm = len * f / unitsPerMM; const segs = 4; let s = '';
      for (let i = 0; i < segs; i++) s += '<rect x="' + (i * wmm / segs).toFixed(2) + '" y="3" width="' + (wmm / segs).toFixed(2) + '" height="2" fill="' + (i % 2 ? '#fff' : '#222') + '" stroke="#222" stroke-width="0.25"/>';
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + (wmm + 14).toFixed(1) + 'mm" height="9mm" viewBox="-1 0 ' + (wmm + 14).toFixed(1) + ' 9">' + s +
        '<text x="0" y="8.4" font-size="2.6" font-family="Arial">0</text><text x="' + wmm.toFixed(2) + '" y="8.4" font-size="2.6" font-family="Arial" text-anchor="middle">' + esc(lab) + '</text></svg>';
    }
    northSVG(mm) { return '<svg xmlns="http://www.w3.org/2000/svg" width="' + mm + 'mm" height="' + (mm * 1.35) + 'mm" viewBox="0 0 20 27"><text x="10" y="6" font-size="6" font-family="Arial" font-weight="bold" text-anchor="middle">N</text><path d="M10 7 L16 26 L10 21.5 L4 26 Z" fill="#fff" stroke="#222" stroke-width="0.8" stroke-linejoin="round"/><path d="M10 7 L10 21.5 L4 26 Z" fill="#222"/></svg>'; }
    // the page as HTML (mm units); mapUrl = rendered map image
    pageHTML(mapUrl, V) {
      const S = this.S, B = this.boxes(); const k = B.big; const box = (b) => 'left:' + b[0] + 'mm;top:' + b[1] + 'mm;width:' + b[2] + 'mm;height:' + b[3] + 'mm';
      const scaleTxt = V.N ? '1 : ' + Math.round(V.N).toLocaleString('en-US') : '–';
      const lp = { tr: 'top:3mm;right:3mm', tl: 'top:3mm;left:3mm', br: 'bottom:3mm;right:3mm', bl: 'bottom:3mm;left:3mm' }[S.legendPos] || 'top:3mm;right:3mm';
      let html = '<div class="pg" style="width:' + B.W + 'mm;height:' + B.H + 'mm">';
      if (S.frame) html += '<div class="pgframe" style="left:' + (B.M - 3) + 'mm;top:' + (B.M - 3) + 'mm;width:' + (B.W - 2 * B.M + 6) + 'mm;height:' + (B.H - 2 * B.M + 6) + 'mm"></div>';
      html += '<div class="mapf" style="' + box(B.map) + '">' + (mapUrl ? '<img src="' + mapUrl + '" style="width:100%;height:100%;display:block">' : '') ;
      const inMapLegend = S.legend && S.tpl !== 'side'; if (inMapLegend) html += '<div class="leg" style="' + lp + ';font-size:' + (2.6 * k) + 'mm">' + this.legendHTML() + '</div>';
      if (S.tpl !== 'side') { html += '<div class="mtools" style="left:3mm;bottom:3mm">' + (S.north ? '<div>' + this.northSVG(10 * k) + '</div>' : '') + (S.scalebar ? '<div class="sbar">' + this.scaleBarSVG(V, Math.min(80, B.map[2] * 0.22)) + '</div>' : '') + '</div>'; }
      html += '</div>';
      const logo = S.logo ? '<img class="logo" src="' + S.logo + '">' : '';
      if (S.tpl === 'side') {
        html += '<div class="side" style="' + box(B.side) + ';font-size:' + (3 * k) + 'mm">' +
          '<div class="stitle">' + esc(S.title) + '</div>' + (S.subtitle ? '<div class="ssub">' + esc(S.subtitle) + '</div>' : '') +
          (S.legend ? '<div class="leg side-leg">' + this.legendHTML() + '</div>' : '') +
          '<div class="sgrow"></div>' + (S.notes ? '<div class="snotes"><b>Notes</b><br>' + esc(S.notes) + '</div>' : '') +
          '<div class="stools">' + (S.north ? this.northSVG(9 * k) : '') + (S.scalebar ? '<div class="sbar">' + this.scaleBarSVG(V, B.side[2] * 0.7) + '</div>' : '') + '</div>' +
          '<table class="tb"><tr><td colspan="2" class="tbo">' + logo + esc(S.org) + '</td></tr><tr><td>Project</td><td>' + esc(S.project) + '</td></tr><tr><td>Scale</td><td>' + scaleTxt + '</td></tr><tr><td>Drawn</td><td>' + esc(S.drawn) + '</td></tr><tr><td>Date</td><td>' + esc(S.date) + '</td></tr><tr><td>Sheet</td><td>' + esc(S.sheet) + '</td></tr></table></div>';
      } else {
        html += '<table class="tbb" style="' + box(B.block) + ';font-size:' + (2.8 * k) + 'mm"><tr>' +
          '<td class="c1" rowspan="3"><div class="stitle">' + esc(S.title) + '</div>' + (S.subtitle ? '<div class="ssub">' + esc(S.subtitle) + '</div>' : '') + (S.notes ? '<div class="snotes">' + esc(S.notes) + '</div>' : '') + '</td>' +
          '<td class="lab">Project</td><td>' + esc(S.project) + '</td><td class="c4" rowspan="3">' + logo + '<div class="org">' + esc(S.org) + '</div></td></tr>' +
          '<tr><td class="lab">Scale</td><td>' + scaleTxt + (S.page ? ' (' + S.page + ')' : '') + '</td></tr><tr><td class="lab">Drawn / Date / Sheet</td><td>' + esc(S.drawn) + ' · ' + esc(S.date) + ' · ' + esc(S.sheet) + '</td></tr></table>';
      }
      return html + '</div>';
    }
    css() {
      return '.pg{position:relative;background:#fff;font-family:Arial,"Segoe UI",sans-serif;color:#222;overflow:hidden}.pg *{box-sizing:border-box}' +
        '.pgframe{position:absolute;border:0.5mm solid #222}.mapf{position:absolute;border:0.35mm solid #222;overflow:hidden;background:#fff}' +
        '.leg{position:absolute;background:rgba(255,255,255,.92);border:0.25mm solid #555;padding:1.5mm 2mm;max-width:70mm;line-height:1.25}.leg .lt{font-weight:bold;margin:0.6mm 0}.leg .lr{display:flex;align-items:center;gap:1.5mm;margin:0.4mm 0}' +
        '.leg .lc,.leg .lsym{display:inline-block;flex:none;width:6mm;height:2mm;border-radius:0.4mm}.leg .lsep{border-top:0.2mm solid #bbb;margin:1mm 0}' +
        '.mtools{position:absolute;display:flex;align-items:flex-end;gap:4mm;background:rgba(255,255,255,.85);padding:1.5mm 2mm;border-radius:1mm}.sbar svg{display:block}' +
        '.side{position:absolute;border:0.35mm solid #222;padding:4mm;display:flex;flex-direction:column;gap:3mm}.side .leg{position:static;border:none;background:none;padding:0;max-width:none}.sgrow{flex:1}.stools{display:flex;align-items:flex-end;gap:4mm}' +
        '.stitle{font-weight:bold;font-size:1.7em;line-height:1.15}.ssub{font-size:1.1em;color:#444;margin-top:1mm}.snotes{font-size:0.9em;color:#333;margin-top:1.5mm;line-height:1.3}' +
        '.tb{width:100%;border-collapse:collapse;font-size:0.9em}.tb td{border:0.2mm solid #555;padding:1mm 1.5mm;vertical-align:top}.tb td:first-child{color:#555;width:28%}.tbo{font-weight:bold}' +
        '.tbb{position:absolute;border-collapse:collapse;border:0.35mm solid #222}.tbb td{border:0.2mm solid #555;padding:1.2mm 2mm;vertical-align:top}.tbb .c1{width:46%}.tbb .lab{color:#555;width:13%;white-space:nowrap}.tbb .c4{width:16%;text-align:center;vertical-align:middle}' +
        '.logo{max-width:100%;max-height:14mm;display:block;margin:0 auto 1mm}.org{font-weight:bold}';
    }
    docHTML(mapUrl, V) {
      const [W, H] = this.pageMM();
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:' + W + 'mm ' + H + 'mm;margin:0}html,body{margin:0;padding:0;background:#fff}' + this.css() + '</style></head><body>' + this.pageHTML(mapUrl, V) + '</body></html>';
    }
    // ---------------------------------------------------------------- view
    open() {
      const app = this.app;
      if (!this.el) { this.el = h('div', { class: 'lyview' }); app.addView('layout', 'Print Layout', this.el, { onClose: () => { this.el = null; }, onShow: () => this.preview() }); } else app.activateView('layout');
      this.build(); this.preview();
    }
    save() { this.app.prefs.layout = Object.assign({}, this.S, { logo: this.S.logo && this.S.logo.length < 400000 ? this.S.logo : '' }); this.app.savePrefs && this.app.savePrefs(); }
    build() {
      const E = this.el; E.innerHTML = ''; const S = this.S; const upd = () => { this.save(); this.preview(); };
      const sel = (k, opts, on) => { const e = h('select', { onchange: () => { S[k] = isNaN(+e.value) || k !== 'dpi' ? e.value : +e.value; if (on) on(); upd(); } }, opts.map(o => Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))); e.value = String(S[k]); return e; };
      const txt = (k, ph) => h('input', { type: 'text', value: S[k], placeholder: ph || '', onchange: (e) => { S[k] = e.target.value; upd(); } });
      const chk = (k, l) => h('label', { class: 'lychk' }, h('input', { type: 'checkbox', checked: !!S[k], onchange: (e) => { S[k] = e.target.checked; upd(); } }), ' ' + l);
      const upm = this.unitsPerM();
      const scaleIn = h('input', { type: 'number', min: 1, value: S.scaleN, style: { width: '90px' }, disabled: S.extent !== 'scale', onchange: (e) => { S.scaleN = Math.max(1, +e.target.value || 1000); upd(); } });
      this.scaleInfo = h('div', { class: 'hint' });
      const panel = h('div', { class: 'lypanel' },
        h('div', { class: 'lysec' }, 'Page'),
        h('div', { class: 'form' }, h('label', null, 'Size'), sel('page', Object.keys(PAGES)), h('label', null, 'Orientation'), sel('orient', [['landscape', 'Landscape'], ['portrait', 'Portrait']]), h('label', null, 'Template'), sel('tpl', [['bottom', 'Title block at the bottom'], ['side', 'Side panel on the right']]), h('label', null, 'Resolution'), sel('dpi', [['150', '150 dpi'], ['200', '200 dpi'], ['300', '300 dpi']])),
        h('div', { class: 'lysec' }, 'Map'),
        h('div', { class: 'form' }, h('label', null, 'Extent'), sel('extent', [['view', 'Current map view']].concat(upm ? [['scale', 'Fixed scale, map centre']] : []), () => { scaleIn.disabled = S.extent !== 'scale'; }), h('label', null, 'Scale 1 :'), scaleIn),
        this.scaleInfo,
        h('div', { style: { display: 'flex', gap: '6px', margin: '4px 0' } }, h('button', { class: 'btn small', title: 'Pan / zoom the map, then refresh the layout', onclick: () => this.preview() }, 'Refresh from Map'), h('button', { class: 'btn small', onclick: () => { this.app.activateView('map'); } }, 'Go to Map')),
        h('div', { class: 'lysec' }, 'Elements'),
        h('div', { class: 'lychks' }, chk('legend', 'Legend'), chk('north', 'North arrow'), chk('scalebar', 'Scale bar'), chk('frame', 'Page border')),
        h('div', { class: 'form' }, h('label', null, 'Legend at'), sel('legendPos', [['tr', 'top right'], ['tl', 'top left'], ['br', 'bottom right'], ['bl', 'bottom left']])),
        h('div', { class: 'lysec' }, 'Title block'),
        h('div', { class: 'form' }, h('label', null, 'Title'), txt('title'), h('label', null, 'Subtitle'), txt('subtitle'), h('label', null, 'Project'), txt('project'), h('label', null, 'Organisation'), txt('org'),
          h('label', null, 'Drawn by'), txt('drawn'), h('label', null, 'Date'), txt('date'), h('label', null, 'Sheet'), txt('sheet'),
          h('label', null, 'Logo'), h('span', { style: { display: 'flex', gap: '4px' } }, h('button', { class: 'btn small', onclick: async () => { const p = await window.host.openDialog({ filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'svg'] }] }); if (!p) return; try { S.logo = await window.host.readDataURL(p); upd(); } catch (e) { AV.alert('Logo not read: ' + e.message); } } }, 'Choose…'), S.logo ? h('button', { class: 'btn small', onclick: () => { S.logo = ''; this.build(); upd(); } }, 'Remove') : null)),
        h('label', { class: 'lylab' }, 'Notes'), h('textarea', { rows: 3, style: { width: '100%' }, onchange: (e) => { S.notes = e.target.value; upd(); } }, S.notes),
        h('div', { class: 'lybtns' }, h('button', { class: 'btn primary', onclick: () => this.output('pdf') }, 'Save PDF…'), h('button', { class: 'btn', onclick: () => this.output('png') }, 'Save PNG…'), h('button', { class: 'btn', onclick: () => this.output('print') }, 'Print…')));
      this.stage = h('div', { class: 'lystage' });
      E.appendChild(h('div', { class: 'lybody' }, panel, this.stage));
      if (!this._ro) { this._ro = new ResizeObserver(() => this.fit()); } this._ro.observe(this.stage);
    }
    async preview() {
      if (!this.el || !this.stage) return; const app = this.app; if (!app.model) return;
      const V = this.view(); this.scaleInfo.textContent = (V.N ? 'Map scale 1 : ' + Math.round(V.N).toLocaleString('en-US') : 'Map units unknown: no scale') + ' · map frame ' + Math.round(this.boxes().map[2]) + ' × ' + Math.round(this.boxes().map[3]) + ' mm';
      // preview at screen resolution (fast); output at the chosen dpi
      const cv = AV.renderMapCanvas(app, V.fw, V.fh, Math.min(1.5, window.devicePixelRatio || 1), V.cx, V.cy, V.scale);
      this.stage.innerHTML = '<style>' + this.css() + '</style><div class="lypaper">' + this.pageHTML(cv.toDataURL('image/png'), V) + '</div>';
      this.fit();
      // basemap tiles still loading: draw the preview again once they are there (a few times at most)
      clearTimeout(this._tt); if (AV.basemapPending && AV.basemapPending() && (this._tries = (this._tries || 0) + 1) <= 4) this._tt = setTimeout(() => this.preview(), 1500); else this._tries = 0;
    }
    fit() {
      const st = this.stage; if (!st) return; const pp = st.querySelector('.lypaper'); if (!pp) return; const pg = pp.firstElementChild; if (!pg) return;
      const [W, H] = this.pageMM(); const pw = W / 25.4 * 96, ph = H / 25.4 * 96; const k = Math.min((st.clientWidth - 40) / pw, (st.clientHeight - 40) / ph, 1.5);
      pp.style.width = pw * k + 'px'; pp.style.height = ph * k + 'px'; pg.style.transform = 'scale(' + k + ')'; pg.style.transformOrigin = '0 0';
    }
    async output(kind) {
      const app = this.app; const [W, H] = this.pageMM(); const base = (app.filePath ? AV.basename(app.filePath).replace(/\.inp$/i, '') : 'map') + '_' + this.S.page.replace(/\s+/g, '');
      let file = null;
      if (kind !== 'print') { file = await window.host.saveDialog({ defaultPath: (app.filePath ? AV.joinPath(AV.dirname(app.filePath), base) : base) + '.' + kind, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] }); if (!file) return; }
      const busy = AV.busy.start('Preparing the print layout'); app.status('Preparing the print layout (' + this.S.dpi + ' dpi) …');
      try {
        const dpi = kind === 'png' ? this.S.dpi : Math.max(150, this.S.dpi); const { url, V } = await this.renderMap(dpi);
        const html = this.docHTML(url, V);
        const r = await window.host.layoutOutput({ kind, html, widthMM: W, heightMM: H, file, dpi, landscape: false });
        if (r && r.error) throw new Error(r.error);
        if (kind !== 'print') { AV.toast((kind === 'pdf' ? 'PDF' : 'PNG') + ' saved: ' + file); app.status('Saved ' + file); }
        else app.status('Sent to the printer.');
      } catch (e) { AV.alert('The layout could not be ' + (kind === 'print' ? 'printed' : 'saved') + ': ' + e.message, 'Print Layout'); }
      finally { busy.done(); }
    }
  }
  AV.openLayout = function (app) { if (!app.model || !app.map) return; app.layout = app.layout && app.layout.app === app ? app.layout : new Layout(app); app.layout.open(); };
})(window.AV);
