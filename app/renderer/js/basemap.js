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
  // where the model lies with a coordinate system: centre of the model in lon / lat and whether that is a real place
  AV.crsCheck = function (app, S) {
    const m = app.model; const b = m && m.bounds ? m.bounds(false) : null; if (!S || !b) return null;
    const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2; let g = null; try { g = AV.Proj.toGeo(S, cx, cy); } catch (e) { }
    const ok = !!g && isFinite(g[0]) && isFinite(g[1]) && Math.abs(g[1]) <= 85 && Math.abs(g[0]) <= 180;
    // a model a few km wide must not span more than a few degrees either (catches feet / metres mix-ups)
    let span = null; try { const a = AV.Proj.toGeo(S, b.x1, b.y1), z = AV.Proj.toGeo(S, b.x2, b.y2); span = Math.max(Math.abs(z[0] - a[0]), Math.abs(z[1] - a[1])); } catch (e) { }
    const fmtLL = (g) => Math.abs(g[1]).toFixed(5) + '°' + (g[1] >= 0 ? 'N' : 'S') + ', ' + Math.abs(g[0]).toFixed(5) + '°' + (g[0] >= 0 ? 'E' : 'W');
    // projected systems are only valid near their own origin (state plane / UTM zones are a few degrees wide)
    let far = false; if (ok && S.type !== 'geographic' && S.type !== 'merc' && isFinite(S.lon0)) { const dl = Math.abs(((g[0] - S.lon0 * 180 / Math.PI) + 540) % 360 - 180), dp = Math.abs(g[1] - (S.lat0 || 0) * 180 / Math.PI); far = dl > 25 || (S.type !== 'tm' && dp > 25); }
    const base = 'Model centre (' + AV.fmt(cx, 1) + ', ' + AV.fmt(cy, 1) + ')';
    return { ok: ok && !(span > 20) && !far, lon: g ? g[0] : NaN, lat: g ? g[1] : NaN, cx, cy, span,
      text: !ok ? base + ' is not a valid place in this coordinate system' : base + ' = ' + fmtLL(g) + (far ? ' - far outside the area of this coordinate system (origin ' + (S.lat0 * 180 / Math.PI).toFixed(2) + '°, ' + (S.lon0 * 180 / Math.PI).toFixed(2) + '°)' : '') };
  };
  AV.App.prototype.setCRS = function (wkt, name, onOpen) {
    this.crsWKT = wkt || null; this.crs = null; this.crsName = name || ''; this.crsError = null;
    if (wkt) { try { this.crs = AV.Proj.parse(wkt); if (!this.crsName) { const m = /^\s*(PROJCS|GEOGCS|PROJCRS|GEOGCRS|PROJECTEDCRS|GEODCRS)\s*\[\s*"([^"]+)"/i.exec(wkt); this.crsName = m ? m[2].replace(/_/g, ' ') : 'custom'; } } catch (e) { this.crs = null; this.crsError = e.message; } }
    if (wkt && this.crsError) AV.toast('Coordinate system' + (this.crsSource ? ' in ' + this.crsSource : '') + ' not used: ' + this.crsError + '. The basemap is off until a supported coordinate system is set (Layer View ▸ Basemap ▸ Coordinate System).', true, 10000);
    else if (wkt && this.crs && this.model) { const c = AV.crsCheck(this, this.crs); if (c && !c.ok) AV.toast((this.crsSource ? this.crsSource + ': ' : '') + c.text + (c.span > 20 ? ' (the model spans ' + c.span.toFixed(0) + '°)' : '') + '. Check that the coordinate system and its units (feet / metres) match the model coordinates.', true, 12000); }
    else if (this.model && /^deg/i.test(this.model.mapInfo.units || '')) { this.crs = AV.Proj.parse(AV.Proj.presetWKT('GEO')); this.crsName = 'WGS 84 (geographic)'; }
    if (this.map) { this.map.tileKey = null; this.map.redraw(); }
    if (this.panels) this.panels.refreshLayers();
  };
  AV.chooseCRS = async function (app) {
    const EXTRA = {
      MIS_FT: 'PROJCS["NAD_1983_StatePlane_Michigan_South_FIPS_2113_Feet_Intl",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",13123359.58005249],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-84.36666666666667],PARAMETER["Standard_Parallel_1",42.1],PARAMETER["Standard_Parallel_2",43.66666666666666],PARAMETER["Scale_Factor",1.0000382],PARAMETER["Latitude_Of_Origin",41.5],UNIT["Foot",0.3048]]',
      MIS_M: 'PROJCS["NAD_1983_StatePlane_Michigan_South_FIPS_2113",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",4000000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-84.36666666666667],PARAMETER["Standard_Parallel_1",42.1],PARAMETER["Standard_Parallel_2",43.66666666666666],PARAMETER["Scale_Factor",1.0000382],PARAMETER["Latitude_Of_Origin",41.5],UNIT["Meter",1.0]]',
      MI_GEOREF: 'PROJCS["NAD_1983_Michigan_GeoRef_Meters",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Hotine_Oblique_Mercator_Azimuth_Natural_Origin"],PARAMETER["False_Easting",2546731.496],PARAMETER["False_Northing",-4354009.816],PARAMETER["Scale_Factor",0.9996],PARAMETER["Azimuth",337.25556],PARAMETER["Longitude_Of_Center",-86.0],PARAMETER["Latitude_Of_Center",45.30916666666666],UNIT["Meter",1.0]]',
    };
    const presets = [['', '(keep current / none)'], ['GEO', 'WGS 84 geographic (degrees)'], ['WEBM', 'WGS 84 Web Mercator'], ['MIS_FT', 'NAD83 / Michigan South (ft) - EPSG 2253'], ['MIS_M', 'NAD83 / Michigan South (m) - EPSG 26990'], ['MI_GEOREF', 'NAD83 / Michigan GeoRef (m) - EPSG 3078']].concat(Array.from({ length: 60 }, (_, i) => ['UTM' + (i + 1), 'WGS 84 / UTM zone ' + (i + 1) + 'N']));
    const wkt = h('textarea', { rows: 5, style: { width: '100%', font: '11px var(--mono)' } }, app.crsWKT || '');
    const chk = h('div', { class: 'note', style: { marginTop: '6px', fontWeight: 600 } });
    const check = () => { const t = wkt.value.trim(); if (!t) { chk.textContent = 'No coordinate system: no basemap.'; chk.style.color = 'var(--muted)'; return; }
      try { const S = AV.Proj.parse(t); const c = AV.crsCheck(app, S); chk.textContent = c ? (c.ok ? '✓ ' : '✗ ') + c.text + (c.ok ? '' : ' - check the coordinate system and its units (feet / metres)') : '✓ ' + (S.type || ''); chk.style.color = c && !c.ok ? 'var(--danger)' : '#2e7d32';
        if (c && isFinite(c.lat) && isFinite(c.lon) && Math.abs(c.lat) < 85) chk.appendChild(h('a', { class: 'rplink', style: { marginLeft: '8px', fontWeight: 400 }, onclick: () => window.host.openExternal('https://www.openstreetmap.org/?mlat=' + c.lat.toFixed(5) + '&mlon=' + c.lon.toFixed(5) + '#map=14/' + c.lat.toFixed(5) + '/' + c.lon.toFixed(5)) }, 'show on OpenStreetMap ↗')); }
      catch (e) { chk.textContent = '✗ Not supported: ' + e.message; chk.style.color = 'var(--danger)'; } };
    wkt.addEventListener('input', check);
    const pre = h('select', { onchange: () => { if (pre.value) { wkt.value = EXTRA[pre.value] || AV.Proj.presetWKT(pre.value); check(); } } }, presets.map(([v, l]) => h('option', { value: v }, l)));
    const load = h('button', { class: 'btn small', onclick: async () => { const p = await window.host.openDialog({ filters: [{ name: 'Projection', extensions: ['prj', 'sw', 'ini', 'wkt', 'txt'] }] }); if (!p) return; let t = await window.host.readText(p); if (/\.(sw|ini)$/i.test(p)) { const cur = /current=(\d+)/.exec(t); const mm = new RegExp('^' + (cur ? cur[1] : '1') + '="(.+)"\\s*$', 'm').exec(t); if (mm) t = mm[1].replace(/\\"/g, '"'); } wkt.value = t.trim(); check(); } }, 'Load .prj / .sw...'); setTimeout(check, 0);
    const r = await AV.modal({ title: 'Map Coordinate System', width: 560, body: h('div', null, h('div', { class: 'form' }, h('label', null, 'Preset'), pre), h('div', { style: { margin: '8px 0 4px', fontWeight: 600 } }, 'Well-known text (WKT)'), wkt, h('div', { style: { marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center' } }, load, app.crsSource ? h('span', { class: 'note' }, 'Current: ' + app.crsSource) : null), chk,
      h('div', { class: 'note' }, 'The coordinate system of the model coordinates. It places the basemap and reprojects imported GIS layers; the model coordinates themselves are not changed (use Tools ▸ Spatial Reference ▸ Convert for that). It is saved next to the model as <model>.prj.')),
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => { const t = wkt.value.trim(); if (t) { try { AV.Proj.parse(t); } catch (e) { AV.toast('Unsupported coordinate system: ' + e.message, true); return false; } } return { wkt: t }; } }] }).done;
    if (!r) return;
    app.setCRS(r.wkt || null);
    if (r.wkt && app.filePath) { try { const pp = app.filePath.replace(/\.inp$/i, '.prj'); await window.host.writeText(pp, r.wkt); app.crsSource = AV.basename(pp); } catch (e) { } }
    if (r.wkt && app.crs && (app.model.mapInfo.units || 'None').toUpperCase() === 'NONE') { app.model.mapInfo.units = app.crs.type === 'geographic' ? 'Degrees' : (Math.abs(app.crs.unit - 1) < 1e-6 ? 'Meters' : 'Feet'); app.refreshAll(); }
  };

  // ---------------------------------------------------------------- tiles
  const lon2x = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); };
  const x2lon = (x, z) => x / Math.pow(2, z) * 360 - 180;
  const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  const cache = new Map(); // url -> {img, ok, t}
  const MAXC = 600;
  AV.basemapPending = () => { let n = 0; for (const e of cache.values()) if (!e.ok && !e.err) n++; return n; };
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
  // download the basemap tiles of the model area (plus a margin) into the tile cache, for offline use
  AV.downloadTiles = async function (app) {
    const bm = AV.basemapState(app), src = AV.BASEMAPS[bm.src], S = app.crs;
    if (!S || !app.model) { AV.alert('Set the map coordinate system first.'); return; }
    if (!(window.host && window.host.tileCache)) { AV.alert('The tile cache is not available.'); return; }
    const b = app.model.bounds(false); if (!b) { AV.alert('The model has no objects.'); return; }
    const mx = (b.x2 - b.x1) * 0.15, my = (b.y2 - b.y1) * 0.15; const ll = [];
    for (const x of [b.x1 - mx, (b.x1 + b.x2) / 2, b.x2 + mx]) for (const y of [b.y1 - my, (b.y1 + b.y2) / 2, b.y2 + my]) { try { const g = AV.Proj.toGeo(S, x, y); if (isFinite(g[0]) && isFinite(g[1])) ll.push(g); } catch (e) { } }
    if (ll.length < 4) { AV.alert('Could not convert the model area to longitude / latitude.'); return; }
    const lo1 = Math.min(...ll.map(p => p[0])), lo2 = Math.max(...ll.map(p => p[0])), la1 = Math.min(...ll.map(p => p[1])), la2 = Math.max(...ll.map(p => p[1]));
    const list = (zmax) => { const out = []; for (let z = 8; z <= zmax; z++) { const n = Math.pow(2, z); const x1 = Math.max(0, Math.floor(lon2x(lo1, z))), x2 = Math.min(n - 1, Math.floor(lon2x(lo2, z))), y1 = Math.max(0, Math.floor(lat2y(la2, z))), y2 = Math.min(n - 1, Math.floor(lat2y(la1, z)));
      for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) out.push([z, x, y]); } return out; };
    const zs = []; for (let z = 12; z <= src.max; z++) zs.push([String(z), 'up to zoom ' + z + ' (' + list(z).length.toLocaleString() + ' tiles)']);
    const r = await AV.formDialog('Download Basemap for Offline Use', [{ k: 'z', l: 'Detail', t: 'choice', o: zs, d: String(Math.min(16, src.max)) },
      { t: 'note', l: src.name + ' tiles covering the model area are saved on this computer, so the basemap also works without internet. Please download only what you need: the tile servers are run by volunteers.' }], { z: String(Math.min(16, src.max)) });
    if (!r) return;
    const tiles = list(+r.z); if (tiles.length > 20000) { AV.alert('Too many tiles (' + tiles.length + '). Choose a lower detail level.'); return; }
    const web = (z, x, y) => src.url.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', src.sub ? src.sub[(x + y) % src.sub.length] : '');
    let done = 0, fail = 0, stop = false; const bar = h('div'); const txt = h('div', { style: { marginTop: '6px', color: 'var(--muted)' } }, '0 / ' + tiles.length);
    const dlg = AV.modal({ title: 'Downloading basemap tiles', width: 420, body: h('div', null, h('div', { class: 'progress' }, bar), txt), buttons: [{ label: 'Stop', danger: true, onClick: () => { stop = true; return false; } }], onClose: () => { stop = true; } });
    let i = 0; const worker = async () => { while (!stop && i < tiles.length) { const [z, x, y] = tiles[i++];
      try { const res = await fetch('avtile://t/' + bm.src + '/' + z + '/' + x + '/' + y + '.png?u=' + encodeURIComponent(web(z, x, y))); if (!res.ok) fail++; } catch (e) { fail++; }
      done++; if (done % 10 === 0 || done === tiles.length) { bar.style.width = (100 * done / tiles.length).toFixed(1) + '%'; txt.textContent = done + ' / ' + tiles.length + (fail ? ' (' + fail + ' failed)' : ''); } } };
    await Promise.all([worker(), worker(), worker()]);
    const stopped = stop; dlg.close(); app.map.redraw();
    AV.toast((stopped ? 'Stopped: ' : 'Basemap downloaded: ') + (done - fail) + ' tiles saved' + (fail ? ', ' + fail + ' failed (offline?)' : '') + '.', !!fail);
  };
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
    // tile range; on very large / high-dpi screens use a coarser zoom rather than drawing no basemap at all
    let n, x1, x2, y1, y2;
    for (;;) { n = Math.pow(2, z);
      x1 = Math.max(0, Math.floor(lon2x(lo1, z))); x2 = Math.min(n - 1, Math.floor(lon2x(lo2, z))); y1 = Math.max(0, Math.floor(lat2y(la2, z))); y2 = Math.min(n - 1, Math.floor(lat2y(la1, z)));
      if ((x2 - x1 + 1) * (y2 - y1 + 1) <= 150 || z <= 0) break; z--; }
    // tiles go through the avtile:// protocol of the main process, which keeps a disk cache (offline use, fewer downloads)
    const web = (z, x, y) => src.url.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', src.sub ? src.sub[(x + y) % src.sub.length] : '');
    const url = (z, x, y) => window.host && window.host.tileCache ? 'avtile://t/' + bm.src + '/' + z + '/' + x + '/' + y + '.png?u=' + encodeURIComponent(web(z, x, y)) : web(z, x, y);
    const redraw = () => { this.redrawBackground(); };   // a loaded tile only changes the background, not the network
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
    // every tile of the view failed: say so on the map instead of showing an empty background
    let nT = 0, nErr = 0, nOk = 0; for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) { const e = cache.get(url(z, x, y)); nT++; if (e && e.err) nErr++; if (e && e.ok) nOk++; }
    this.basemapFailed = nT > 0 && nErr === nT;
    // shown as a small note over the map (a DOM element, so the network does not cover it)
    if (!this._bmNote) { this._bmNote = document.createElement('div'); this._bmNote.className = 'bmnote'; this.wrap.appendChild(this._bmNote); }
    this._bmNote.style.display = this.basemapFailed ? 'block' : 'none';
    if (this.basemapFailed) { this._bmNote.innerHTML = ''; const b = document.createElement('b'); b.textContent = 'Basemap: ' + src.name + ' tiles could not be loaded'; this._bmNote.append(b, document.createElement('br'), 'No internet connection, or the tile server is blocked on this network. Try another source in Symbology ▸ Basemap.');
      if (!this._bmRetry) { this._bmRetry = setTimeout(() => { this._bmRetry = null; for (const [k, e] of cache) if (e.err) cache.delete(k); this.redrawBackground(); }, 30000); } }
  };
})(window.AV);
