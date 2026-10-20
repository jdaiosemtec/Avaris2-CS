// Online basemaps (XYZ web-mercator tiles) drawn under the network in the model's coordinate system,
// and the model coordinate system itself (app.crs).
'use strict';
(function (AV) {
  const h = AV.h;
  AV.BASEMAPS = {
    otm: { name: 'OpenTopoMap (topographic)', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', sub: ['a', 'b', 'c'], max: 17, attr: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)' },
    osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attr: '© OpenStreetMap contributors' },
  };
  AV.basemapState = (app) => { const b = (app.prefs.basemap = app.prefs.basemap || {}); if (b.on === undefined) b.on = true; if (!b.src || !AV.BASEMAPS[b.src]) b.src = 'otm'; if (b.opacity === undefined) b.opacity = 1; return b; };

  // ---------------------------------------------------------------- model coordinate system
  AV.App.prototype.setCRS = function (wkt, name) {
    this.crsWKT = wkt || null; this.crs = null; this.crsName = name || '';
    if (wkt) { try { this.crs = AV.Proj.parse(wkt); if (!this.crsName) { const m = /^(PROJCS|GEOGCS)\["([^"]+)"/.exec(wkt); this.crsName = m ? m[2].replace(/_/g, ' ') : 'custom'; } } catch (e) { this.crs = null; } }
    else if (this.model && /^deg/i.test(this.model.mapInfo.units || '')) { this.crs = AV.Proj.parse(AV.Proj.presetWKT('GEO')); this.crsName = 'WGS 84 (geographic)'; }
    if (this.map) { this.map.tileKey = null; this.map.redraw(); }
    if (this.panels) this.panels.refreshLayers();
  };
  AV.chooseCRS = async function (app) {
    const presets = [['', '(keep current / none)'], ['GEO', 'WGS 84 geographic (degrees)'], ['WEBM', 'WGS 84 Web Mercator']].concat(Array.from({ length: 60 }, (_, i) => ['UTM' + (i + 1), 'WGS 84 / UTM zone ' + (i + 1) + 'N']));
    const wkt = h('textarea', { rows: 5, style: { width: '100%', font: '11px var(--mono)' } }, app.crsWKT || '');
    const pre = h('select', { onchange: () => { if (pre.value) wkt.value = AV.Proj.presetWKT(pre.value); } }, presets.map(([v, l]) => h('option', { value: v }, l)));
    const load = h('button', { class: 'btn small', onclick: async () => { const p = await window.host.openDialog({ filters: [{ name: 'Projection', extensions: ['prj', 'sw', 'ini', 'wkt', 'txt'] }] }); if (!p) return; let t = await window.host.readText(p); if (/\.(sw|ini)$/i.test(p)) { const cur = /current=(\d+)/.exec(t); const mm = new RegExp('^' + (cur ? cur[1] : '1') + '="(.+)"\\s*$', 'm').exec(t); if (mm) t = mm[1].replace(/\\"/g, '"'); } wkt.value = t.trim(); } }, 'Load .prj / .sw...');
    const r = await AV.modal({ title: 'Map Coordinate System', width: 560, body: h('div', null, h('div', { class: 'form' }, h('label', null, 'Preset'), pre), h('div', { style: { margin: '8px 0 4px', fontWeight: 600 } }, 'Well-known text (WKT)'), wkt, h('div', { style: { marginTop: '6px' } }, load),
      h('div', { class: 'note' }, 'The coordinate system of the model coordinates. It places the basemap and reprojects imported GIS layers; the model coordinates themselves are not changed (use Tools ▸ Spatial Reference ▸ Convert for that). It is saved next to the model as <model>.prj.')),
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => { const t = wkt.value.trim(); if (t) { try { AV.Proj.parse(t); } catch (e) { AV.toast('Unsupported coordinate system: ' + e.message, true); return false; } } return { wkt: t }; } }] }).done;
    if (!r) return;
    app.setCRS(r.wkt || null);
    if (r.wkt && app.filePath) { try { await window.host.writeText(app.filePath.replace(/\.inp$/i, '.prj'), r.wkt); } catch (e) { } }
    if (r.wkt && app.crs && (app.model.mapInfo.units || 'None').toUpperCase() === 'NONE') { app.model.mapInfo.units = app.crs.type === 'geographic' ? 'Degrees' : (Math.abs(app.crs.unit - 1) < 1e-6 ? 'Meters' : 'Feet'); app.refreshAll(); }
  };

  // ---------------------------------------------------------------- tiles
  const lon2x = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); };
  const x2lon = (x, z) => x / Math.pow(2, z) * 360 - 180;
  const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  const cache = new Map(); // url -> {img, ok, t}
  const MAXC = 600;
  function tile(url, onload) {
    let e = cache.get(url);
    if (e) { e.t = performance.now(); return e; }
    e = { img: new Image(), ok: false, err: false, t: performance.now() };
    e.img.crossOrigin = 'anonymous'; e.img.referrerPolicy = 'no-referrer-when-downgrade';
    e.img.onload = () => { e.ok = true; onload(); };
    e.img.onerror = () => { e.err = true; };
    e.img.src = url; cache.set(url, e);
    if (cache.size > MAXC) { const old = [...cache.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, cache.size - MAXC); for (const [k] of old) cache.delete(k); }
    return e;
  }
  AV.MapView.prototype.drawBasemap = function () {
    const app = this.app, bm = AV.basemapState(app); if (!bm.on || !app.crs) return;
    const S = app.crs, src = AV.BASEMAPS[bm.src]; const ctx = this.ctx;
    const geo = (sx, sy) => { const w = this.toWorld(sx, sy); try { return AV.Proj.toGeo(S, w[0], w[1]); } catch (e) { return null; } };
    const scr = (lon, lat) => { const w = AV.Proj.fromGeo(S, lon, lat); return this.toScreen(w[0], w[1]); };
    const pts = []; for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) { const g = geo(this.w * fx, this.hgt * fy); if (g && isFinite(g[0]) && isFinite(g[1])) pts.push(g); }
    if (pts.length < 4) return;
    let lo1 = Math.min(...pts.map(p => p[0])), lo2 = Math.max(...pts.map(p => p[0])), la1 = Math.min(...pts.map(p => p[1])), la2 = Math.max(...pts.map(p => p[1]));
    la1 = Math.max(-85, la1); la2 = Math.min(85, la2); lo1 = Math.max(-180, lo1); lo2 = Math.min(180, lo2); if (!(lo2 > lo1 && la2 > la1)) return;
    // zoom: one tile pixel ~ one screen pixel
    const g0 = geo(this.w / 2, this.hgt / 2), g1 = geo(this.w / 2 + 100, this.hgt / 2); if (!g0 || !g1) return;
    const dxTile0 = Math.hypot(lon2x(g1[0], 0) - lon2x(g0[0], 0), lat2y(g1[1], 0) - lat2y(g0[1], 0)) * 256 / 100; // tile px at z0 per screen px
    let z = Math.round(Math.log2(1 / Math.max(dxTile0, 1e-12)) + Math.log2(this.dpr || 1) * 0.5); z = Math.max(0, Math.min(src.max, z));
    const n = Math.pow(2, z);
    let x1 = Math.floor(lon2x(lo1, z)), x2 = Math.floor(lon2x(lo2, z)), y1 = Math.floor(lat2y(la2, z)), y2 = Math.floor(lat2y(la1, z));
    x1 = Math.max(0, x1); y1 = Math.max(0, y1); x2 = Math.min(n - 1, x2); y2 = Math.min(n - 1, y2);
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > 150) return;
    const url = (z, x, y) => src.url.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', src.sub ? src.sub[(x + y) % src.sub.length] : '');
    const redraw = () => { this.redraw(); };
    ctx.save(); ctx.globalAlpha = bm.opacity; ctx.imageSmoothingQuality = 'high';
    const d = this.dpr || 1;
    const place = (img, sx0, sy0, sw, tx, ty, tz) => {
      // affine from tile corners (projection is near-linear over one tile)
      const p0 = scr(x2lon(tx, tz), y2lat(ty, tz)), p1 = scr(x2lon(tx + 1, tz), y2lat(ty, tz)), p2 = scr(x2lon(tx, tz), y2lat(ty + 1, tz));
      const k = 1 / sw; ctx.setTransform(d * (p1[0] - p0[0]) * k, d * (p1[1] - p0[1]) * k, d * (p2[0] - p0[0]) * k, d * (p2[1] - p0[1]) * k, d * p0[0], d * p0[1]);
      ctx.drawImage(img, sx0, sy0, sw, sw, 0, 0, sw + 0.6, sw + 0.6);
    };
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) {
      const e = tile(url(z, x, y), redraw);
      if (e.ok) { place(e.img, 0, 0, 256, x, y, z); continue; }
      // while loading: stretch an already loaded parent tile
      for (let up = 1; up <= 4 && z - up >= 0; up++) {
        const f = Math.pow(2, up), px = Math.floor(x / f), py = Math.floor(y / f); const pe = cache.get(url(z - up, px, py));
        if (pe && pe.ok) { const sw = 256 / f; place(pe.img, (x - px * f) * sw, (y - py * f) * sw, sw, x, y, z); break; }
      }
    }
    ctx.restore();
    this.basemapAttr = src.attr;
  };
})(window.AV);
