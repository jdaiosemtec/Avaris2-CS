// GIS data readers for Add Data / Catalog: Shapefile (and zipped), GeoJSON, KML/KMZ, GPX, CSV/TXT with X/Y,
// DXF, GeoTIFF (+ world-file images), ESRI ASCII grid. Layers are reprojected into the model coordinate system.
'use strict';
(function (AV) {
  AV.RAMPS.Terrain = ['#1a6e3a', '#4caf50', '#a5d6a7', '#fff59d', '#e6c27a', '#b08968', '#8d6e63', '#d7ccc8', '#ffffff'];
  AV.RAMPS['Grey (raster)'] = ['#000000', '#ffffff'];
  const VEC = ['shp', 'geojson', 'json', 'kml', 'kmz', 'gpx', 'csv', 'txt', 'dxf', 'zip'], RAS = ['tif', 'tiff', 'png', 'jpg', 'jpeg', 'bmp', 'gif', 'asc'];
  const NOT = { gpkg: 'GeoPackages (.gpkg)', mdb: 'Personal geodatabases (.mdb)', sqlite: 'SQLite databases', dwg: 'AutoCAD DWG drawings (save as DXF)', ecw: 'ECW rasters', sid: 'MrSID rasters', jp2: 'JPEG 2000 rasters', nc: 'NetCDF files', las: 'LAS point clouds', laz: 'LAZ point clouds', lyrx: 'ArcGIS layer files', mxd: 'ArcMap documents', aprx: 'ArcGIS Pro projects' };
  AV.DATA_EXT = { vector: VEC, raster: RAS, unsupported: Object.keys(NOT) };
  AV.dataKind = (name) => { const e = (/\.([^.\\/]+)$/.exec(name) || [])[1]; const x = e ? e.toLowerCase() : ''; return VEC.includes(x) ? 'vector' : RAS.includes(x) ? 'raster' : NOT[x] ? 'unsupported' : null; };
  const ext = (p) => ((/\.([^.\\/]+)$/.exec(p) || [])[1] || '').toLowerCase();
  const swapExt = (p, e) => p.replace(/\.[^.\\/]+$/, '.' + e);
  const bbOf = (pts) => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of pts) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; } return b; };
  const GEO = () => AV.Proj.presetWKT('GEO');
  const xmlText = (el, tag) => { const e = el.getElementsByTagName(tag)[0]; return e ? e.textContent.trim() : ''; };
  const exists = (p) => window.host.exists(p);

  // ---------------------------------------------------------------- vectors
  async function readShapefile(path) { const L = await AV.SHP.load(path); L.prjWKT = L.prj || null; return L; }
  function readKML(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml'); const feats = [];
    const crd = (s) => s.trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(p => p.length >= 2 && isFinite(p[0]) && isFinite(p[1])).map(p => [p[0], p[1]]);
    for (const pm of doc.getElementsByTagName('Placemark')) {
      const props = { name: xmlText(pm, 'name'), description: xmlText(pm, 'description').slice(0, 250) };
      for (const d of pm.getElementsByTagName('Data')) props[d.getAttribute('name')] = xmlText(d, 'value');
      for (const d of pm.getElementsByTagName('SimpleData')) props[d.getAttribute('name')] = d.textContent.trim();
      for (const g of pm.getElementsByTagName('Point')) { const c = crd(xmlText(g, 'coordinates')); if (c.length) feats.push({ type: 'point', coords: c, bbox: bbOf(c), props }); }
      for (const g of pm.getElementsByTagName('LineString')) { const c = crd(xmlText(g, 'coordinates')); if (c.length > 1) feats.push({ type: 'line', coords: [c], bbox: bbOf(c), props }); }
      for (const g of pm.getElementsByTagName('Polygon')) { const rings = [...g.getElementsByTagName('LinearRing')].map(r => crd(xmlText(r, 'coordinates'))).filter(r => r.length > 2); if (rings.length) feats.push({ type: 'polygon', coords: rings, bbox: bbOf(rings.flat()), props }); }
    }
    return finish(feats, GEO());
  }
  function readGPX(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml'); const feats = [];
    const pt = (e) => [+e.getAttribute('lon'), +e.getAttribute('lat')];
    for (const w of doc.getElementsByTagName('wpt')) { const c = [pt(w)]; feats.push({ type: 'point', coords: c, bbox: bbOf(c), props: { name: xmlText(w, 'name'), ele: xmlText(w, 'ele') } }); }
    for (const r of doc.getElementsByTagName('rte')) { const c = [...r.getElementsByTagName('rtept')].map(pt); if (c.length > 1) feats.push({ type: 'line', coords: [c], bbox: bbOf(c), props: { name: xmlText(r, 'name') } }); }
    for (const t of doc.getElementsByTagName('trk')) for (const sg of t.getElementsByTagName('trkseg')) { const c = [...sg.getElementsByTagName('trkpt')].map(pt); if (c.length > 1) feats.push({ type: 'line', coords: [c], bbox: bbOf(c), props: { name: xmlText(t, 'name') } }); }
    return finish(feats, GEO());
  }
  function readCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()); if (lines.length < 2) throw new Error('No rows.');
    const delim = [',', ';', '\t', '|'].map(d => [d, lines[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === delim && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
    const head = split(lines[0]); const lc = head.map(x => x.toLowerCase().replace(/[^a-z_]/g, ''));
    const find = (names) => { for (const n of names) { const i = lc.indexOf(n); if (i >= 0) return i; } for (const n of names) { const i = lc.findIndex(x => x.includes(n)); if (i >= 0) return i; } return -1; };
    let xi = find(['x', 'pointx', 'easting', 'east', 'lon', 'long', 'longitude', 'lng', 'xcoord']), yi = find(['y', 'pointy', 'northing', 'north', 'lat', 'latitude', 'ycoord']);
    if (xi < 0 || yi < 0) throw new Error('No X/Y (or longitude/latitude) columns found. Columns: ' + head.join(', '));
    const feats = [];
    for (const l of lines.slice(1)) { const c = split(l); const x = parseFloat(c[xi]), y = parseFloat(c[yi]); if (!isFinite(x) || !isFinite(y)) continue; const props = {}; head.forEach((k, i) => props[k] = c[i]); feats.push({ type: 'point', coords: [[x, y]], bbox: [x, y, x, y], props }); }
    const geo = /lon|lat|lng/.test(lc[xi] + lc[yi]) || feats.every(f => Math.abs(f.coords[0][0]) <= 180 && Math.abs(f.coords[0][1]) <= 90);
    return finish(feats, geo ? GEO() : null, head);
  }
  function readDXF(text) {
    const L = text.split(/\r?\n/); const pairs = []; for (let i = 0; i + 1 < L.length; i += 2) pairs.push([+L[i].trim(), L[i + 1].trim()]);
    let i = pairs.findIndex((p, k) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[k - 1] && pairs[k - 1][1] === 'SECTION'); if (i < 0) throw new Error('No ENTITIES section.');
    const feats = []; i++;
    while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
      const type = pairs[i][1]; const g = []; i++;
      while (i < pairs.length && pairs[i][0] !== 0) { g.push(pairs[i]); i++; }
      const val = (c) => { const p = g.find(x => x[0] === c); return p ? p[1] : null; }; const layer = val(8) || '0';
      if (type === 'LINE') { const c = [[+val(10), +val(20)], [+val(11), +val(21)]]; feats.push({ type: 'line', coords: [c], bbox: bbOf(c), props: { layer, entity: 'LINE' } }); }
      else if (type === 'POINT') { const c = [[+val(10), +val(20)]]; feats.push({ type: 'point', coords: c, bbox: bbOf(c), props: { layer, entity: 'POINT' } }); }
      else if (type === 'CIRCLE') { const cx = +val(10), cy = +val(20), r = +val(40); const c = Array.from({ length: 37 }, (_, k) => [cx + r * Math.cos(k * Math.PI / 18), cy + r * Math.sin(k * Math.PI / 18)]); feats.push({ type: 'line', coords: [c], bbox: bbOf(c), props: { layer, entity: 'CIRCLE' } }); }
      else if (type === 'LWPOLYLINE') { const xs = g.filter(x => x[0] === 10).map(x => +x[1]), ys = g.filter(x => x[0] === 20).map(x => +x[1]); const c = xs.map((x, k) => [x, ys[k]]); if ((+val(70) & 1) && c.length > 2) c.push(c[0]); if (c.length > 1) feats.push({ type: 'line', coords: [c], bbox: bbOf(c), props: { layer, entity: 'LWPOLYLINE' } }); }
      else if (type === 'POLYLINE') {
        const closed = +val(70) & 1; const c = [];
        while (i < pairs.length && pairs[i][1] === 'VERTEX') { const vg = []; i++; while (i < pairs.length && pairs[i][0] !== 0) { vg.push(pairs[i]); i++; } const vx = vg.find(x => x[0] === 10), vy = vg.find(x => x[0] === 20); if (vx && vy) c.push([+vx[1], +vy[1]]); }
        if (i < pairs.length && pairs[i][1] === 'SEQEND') { i++; while (i < pairs.length && pairs[i][0] !== 0) i++; }
        if (closed && c.length > 2) c.push(c[0]); if (c.length > 1) feats.push({ type: 'line', coords: [c], bbox: bbOf(c), props: { layer, entity: 'POLYLINE' } });
      }
    }
    return finish(feats.filter(f => f.coords.flat().every(p => isFinite(p[0]) && isFinite(p[1]))), null);
  }
  function finish(feats, prjWKT, fields) {
    const kinds = new Set(feats.map(f => f.type)); const kind = kinds.size === 1 ? [...kinds][0] : kinds.has('polygon') ? 'polygon' : kinds.has('line') ? 'line' : 'point';
    const fl = fields || [...new Set(feats.flatMap(f => Object.keys(f.props || {})))];
    const L = AV.SHP.finish(kind, feats, fl); L.prjWKT = prjWKT; return L;
  }

  // ---------------------------------------------------------------- TIFF / GeoTIFF
  const TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };
  function parseTIFF(buf) {
    const dv = new DataView(buf); const le = dv.getUint16(0) === 0x4949; const big = dv.getUint16(2, le) === 43;
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le), u64 = (o) => Number(dv.getBigUint64(o, le));
    const rd = (t, o) => { switch (t) { case 1: case 7: return dv.getUint8(o); case 6: return dv.getInt8(o); case 3: return u16(o); case 8: return dv.getInt16(o, le); case 4: return u32(o); case 9: return dv.getInt32(o, le); case 5: return u32(o) / u32(o + 4); case 10: return dv.getInt32(o, le) / dv.getInt32(o + 4, le); case 11: return dv.getFloat32(o, le); case 12: return dv.getFloat64(o, le); case 16: case 18: return u64(o); case 17: return Number(dv.getBigInt64(o, le)); default: return 0; } };
    const ifds = []; let off = big ? u64(8) : u32(4); let guard = 0;
    while (off && guard++ < 50) {
      const n = big ? u64(off) : u16(off); const tags = {}; let p = off + (big ? 8 : 2);
      for (let k = 0; k < n; k++, p += big ? 20 : 12) {
        const tag = u16(p), type = u16(p + 2), cnt = big ? u64(p + 4) : u32(p + 4); const sz = (TSIZE[type] || 1) * cnt;
        const vo = sz <= (big ? 8 : 4) ? p + (big ? 12 : 8) : (big ? u64(p + 12) : u32(p + 8));
        if (type === 2) tags[tag] = new TextDecoder('latin1').decode(new Uint8Array(buf, vo, cnt)).replace(/\0+$/, '');
        else { const a = new Array(cnt); for (let i = 0; i < cnt; i++) a[i] = rd(type, vo + i * TSIZE[type]); tags[tag] = a; }
      }
      ifds.push(tags); off = big ? u64(p) : u32(p);
    }
    return { le, ifds };
  }
  function lzw(src) {
    const out = []; let dict = [], bits = 9, pos = 0, prev = null; const total = src.length * 8;
    const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push([i]); dict.push(null, null); bits = 9; };
    const next = () => { if (pos + bits > total) return 257; let v = 0; for (let i = 0; i < bits; i++) { const b = pos + i; v = (v << 1) | ((src[b >> 3] >> (7 - (b & 7))) & 1); } pos += bits; return v; };
    reset();
    for (;;) {
      const code = next(); if (code === 257) break;
      if (code === 256) { reset(); prev = null; continue; }
      let entry; if (code < dict.length && dict[code]) entry = dict[code]; else if (prev) entry = prev.concat([prev[0]]); else break;
      for (const b of entry) out.push(b);
      if (prev) dict.push(prev.concat([entry[0]]));
      prev = entry;
      if (dict.length + 1 >= (1 << bits) && bits < 12) bits++;
    }
    return new Uint8Array(out);
  }
  function packbits(src) { const out = []; let i = 0; while (i < src.length) { const n = (src[i] << 24) >> 24; i++; if (n >= 0) { for (let k = 0; k <= n; k++) out.push(src[i++]); } else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n; k++) out.push(v); } } return new Uint8Array(out); }
  async function inflate(src) { const ds = new DecompressionStream('deflate'); const r = new Response(new Blob([src]).stream().pipeThrough(ds)); return new Uint8Array(await r.arrayBuffer()); }
  async function readTIFF(buf, path, maxD) {
    const { le, ifds } = parseTIFF(buf); const t0 = ifds[0];
    const W0 = t0[256][0], H0 = t0[257][0];
    // pick an overview (reduced IFD) no larger than needed
    const MAXD = maxD || 3000; let tg = t0;
    for (const t of ifds) { if (!t[256] || !t[257] || (t[254] && (t[254][0] & 4))) continue; const w = t[256][0]; if (w >= Math.min(W0, MAXD) && w < tg[256][0]) tg = t; }
    const w = tg[256][0], h = tg[257][0], spp = (tg[277] || [1])[0], bps = (tg[258] || [8])[0], comp = (tg[259] || [1])[0], photo = (tg[262] || [1])[0], fmt = (tg[339] || [1])[0], pred = (tg[317] || [1])[0], planar = (tg[284] || [1])[0];
    if (planar !== 1 && spp > 1) throw new Error('Band-separate (planar) TIFFs are not supported.');
    if (![1, 5, 7, 8, 32946, 32773].includes(comp)) throw new Error('TIFF compression ' + comp + (comp === 6 ? ' (old-style JPEG)' : comp === 34887 ? ' (LERC)' : comp === 50000 ? ' (ZSTD)' : comp === 34712 ? ' (JPEG 2000)' : '') + ' is not supported; save it uncompressed, LZW, Deflate or JPEG.');
    if (comp === 7 && bps !== 8) throw new Error('Only 8-bit JPEG-compressed TIFFs are supported.');
    // JPEG (7): each tile / strip is a JPEG stream; shared quantisation / Huffman tables live in JPEGTables (347).
    // Decoded by the browser's JPEG decoder (handles YCbCr and chroma subsampling).
    const jtab = comp === 7 && tg[347] ? Uint8Array.from(tg[347]) : null;
    let jcv = null;
    const jpeg = async (src) => {
      let data = src;
      if (jtab && jtab.length > 4) { data = new Uint8Array(jtab.length - 2 + src.length - 2); data.set(jtab.subarray(0, jtab.length - 2), 0); data.set(src.subarray(2), jtab.length - 2); }
      const bmp = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
      if (!jcv || jcv.width !== bmp.width || jcv.height !== bmp.height) jcv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = jcv.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, bmp.width, bmp.height); g.drawImage(bmp, 0, 0); bmp.close && bmp.close();
      const px = g.getImageData(0, 0, jcv.width, jcv.height).data; const n = jcv.width * jcv.height; const o = new Uint8Array(n * spp);
      for (let i = 0; i < n; i++) for (let k = 0; k < spp; k++) o[i * spp + k] = k < 3 ? px[i * 4 + (spp < 3 ? 0 : k)] : px[i * 4 + 3];
      return o;
    };
    const step = Math.max(1, Math.ceil(Math.max(w, h) / MAXD)); const ow = Math.ceil(w / step), oh = Math.ceil(h / step);
    const out = new Float32Array(ow * oh * spp).fill(NaN);
    const Bps = bps / 8; const dv = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const readSample = (d, o) => bps === 8 ? (fmt === 2 ? d.getInt8(o) : d.getUint8(o)) : bps === 16 ? (fmt === 2 ? d.getInt16(o, le) : d.getUint16(o, le)) : bps === 32 ? (fmt === 3 ? d.getFloat32(o, le) : fmt === 2 ? d.getInt32(o, le) : d.getUint32(o, le)) : bps === 64 ? d.getFloat64(o, le) : 0;
    const decode = async (off, cnt) => { let u = new Uint8Array(buf, off, cnt); if (comp === 7) return await jpeg(u); if (comp === 5) u = lzw(u); else if (comp === 8 || comp === 32946) u = await inflate(u); else if (comp === 32773) u = packbits(u); return u; };
    const unpredict = (u, cw, rows) => {
      if (pred === 2) { const d = dv(u); for (let r = 0; r < rows; r++) for (let c = 1; c < cw; c++) for (let s = 0; s < spp; s++) { const o = ((r * cw + c) * spp + s) * Bps, p = o - spp * Bps; if (Bps === 1) u[o] = (u[o] + u[p]) & 255; else if (Bps === 2) d.setUint16(o, (d.getUint16(o, le) + d.getUint16(p, le)) & 65535, le); else d.setUint32(o, (d.getUint32(o, le) + d.getUint32(p, le)) >>> 0, le); } }
      else if (pred === 3) { const rowB = cw * spp * Bps; const tmp = new Uint8Array(rowB); for (let r = 0; r < rows; r++) { const base = r * rowB; for (let k = 1; k < rowB; k++) u[base + k] = (u[base + k] + u[base + k - 1]) & 255; const n = cw * spp; for (let k = 0; k < n; k++) for (let b = 0; b < Bps; b++) tmp[k * Bps + (le ? Bps - 1 - b : b)] = u[base + b * n + k]; u.set(tmp, base); } }
      return u;
    };
    const put = (u, cw, x0, y0, rows) => { const d = dv(u); for (let r = 0; r < rows; r++) { const y = y0 + r; if (y >= h || y % step) continue; const oy = y / step; for (let c = 0; c < cw; c++) { const x = x0 + c; if (x >= w || x % step) continue; const ox = x / step; for (let s = 0; s < spp; s++) { const o = ((r * cw + c) * spp + s) * Bps; if (o + Bps <= u.length) out[(oy * ow + ox) * spp + s] = readSample(d, o); } } } };
    if (tg[322]) { // tiled
      const tw = tg[322][0], th = tg[323][0], offs = tg[324], cnts = tg[325]; const across = Math.ceil(w / tw);
      for (let k = 0; k < offs.length; k++) { const tx = (k % across) * tw, ty = Math.floor(k / across) * th; if (!cnts[k]) continue; let u = await decode(offs[k], cnts[k]); u = unpredict(u, tw, th); put(u, tw, tx, ty, th); }
    } else {
      const rps = (tg[278] || [h])[0], offs = tg[273], cnts = tg[279] || [buf.byteLength - tg[273][0]];
      for (let k = 0; k < offs.length; k++) { const y0 = k * rps; const rows = Math.min(rps, h - y0); if (step > 1 && !Array.from({ length: rows }, (_, r) => (y0 + r) % step === 0).some(Boolean)) continue; let u = await decode(offs[k], cnts[k]); u = unpredict(u, w, rows); put(u, w, 0, y0, rows); }
    }
    // georeferencing (from the full-resolution IFD)
    const scale = W0 / w; let corners = null, epsg = null;
    if (t0[34264]) { const M = t0[34264]; const f = (i, j) => [M[0] * i + M[1] * j + M[3], M[4] * i + M[5] * j + M[7]]; corners = [f(0, 0), f(W0, 0), f(0, H0)]; }
    else if (t0[33922] && t0[33550]) { const T = t0[33922], Sx = t0[33550][0], Sy = t0[33550][1]; const X0 = T[3] - T[0] * Sx, Y0 = T[4] + T[1] * Sy; corners = [[X0, Y0], [X0 + W0 * Sx, Y0], [X0, Y0 - H0 * Sy]]; }
    let userCRS = false;
    if (t0[34735]) {
      // GeoKeys: 1024 model type (1 projected, 2 geographic), 3072 projected CRS, 2048 geographic CRS; 32767 = user-defined
      const g = t0[34735]; const K = {}; for (let i = 4; i + 3 < g.length; i += 4) if (g[i + 1] === 0) K[g[i]] = g[i + 3];
      const model = K[1024] || (K[3072] ? 1 : K[2048] ? 2 : 0); const ok = (v) => v > 1000 && v < 32767;
      if (model === 1) { if (ok(K[3072])) epsg = K[3072]; else userCRS = true; }   // projected: never fall back to the datum's geographic code
      else if (model === 2) { if (ok(K[2048])) epsg = K[2048]; else userCRS = true; }
    }
    if (!corners) corners = await worldFile(path, W0, H0, ['tfw', 'tifw', 'wld']);
    const nod = t0[42113] ? parseFloat(t0[42113]) : null;
    let cmap = null; if (photo === 3 && tg[320]) cmap = tg[320];
    return { raster: true, w: ow, h: oh, fullW: W0, fullH: H0, spp, bps, photo: comp === 7 && spp >= 3 ? 2 : photo, cmap, data: out, nodata: isFinite(nod) ? nod : null, corners, epsg, userCRS, peWKT: (typeof t0[34737] === 'string' && /ESRI PE String = /.test(t0[34737])) ? t0[34737].split('ESRI PE String = ')[1].split('|')[0].trim() : null, step: step * scale };
  }
  async function worldFile(path, W, H, exts) {
    for (const e of exts) { const p = swapExt(path, e); if (await exists(p)) { const v = (await window.host.readText(p)).trim().split(/\s+/).map(Number); if (v.length >= 6 && v.every(isFinite)) { const [A, D, B, E, C, F] = v; const f = (i, j) => [A * (i - 0.5) + B * (j - 0.5) + C, D * (i - 0.5) + E * (j - 0.5) + F]; return [f(0, 0), f(W, 0), f(0, H)]; } } }
    return null;
  }
  async function readImage(path) {
    const buf = await window.host.readBinary(path); const bmp = await createImageBitmap(new Blob([buf]));
    const e = ext(path); const wf = { png: ['pgw', 'pngw', 'wld'], jpg: ['jgw', 'jpgw', 'wld'], jpeg: ['jgw', 'jpegw', 'wld'], gif: ['gfw', 'gifw', 'wld'], bmp: ['bpw', 'bmpw', 'wld'] }[e] || ['wld'];
    const corners = await worldFile(path, bmp.width, bmp.height, wf);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
    return { raster: true, image: true, w: bmp.width, h: bmp.height, canvas: c, corners };
  }
  async function readASC(path) {
    const t = await window.host.readText(path); const tok = t.split(/\s+/).filter(Boolean); const hd = {}; let i = 0;
    while (i < tok.length && /^[a-z_]+$/i.test(tok[i])) { hd[tok[i].toLowerCase()] = +tok[i + 1]; i += 2; }
    const nc = hd.ncols, nr = hd.nrows, cs = hd.cellsize; const x0 = hd.xllcorner !== undefined ? hd.xllcorner : hd.xllcenter - cs / 2, y0 = hd.yllcorner !== undefined ? hd.yllcorner : hd.yllcenter - cs / 2;
    const step = Math.max(1, Math.ceil(Math.max(nc, nr) / 3000)); const ow = Math.ceil(nc / step), oh = Math.ceil(nr / step); const data = new Float32Array(ow * oh);
    for (let r = 0; r < nr; r += step) for (let c = 0; c < nc; c += step) data[(r / step) * ow + c / step] = +tok[i + r * nc + c];
    const top = y0 + nr * cs;
    return { raster: true, w: ow, h: oh, spp: 1, bps: 32, photo: 1, data, nodata: hd.nodata_value !== undefined ? hd.nodata_value : null, corners: [[x0, top], [x0 + nc * cs, top], [x0, y0]] };
  }
  // colour a decoded raster into L.canvas
  AV.renderRaster = function (L) {
    if (L.image) return;
    const { w, h, spp, data, nodata } = L; const c = L.canvas || document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); const img = g.createImageData(w, h); const px = img.data;
    // no-data: the GDAL_NODATA text (e.g. -3.402823e+38) rarely equals the stored float32 bit-for-bit, so compare with a
    // relative tolerance; values beyond ±1e30 are always treated as no-data (ArcGIS float rasters use -FLT_MAX)
    const nd = nodata, ndTol = nd === null ? 0 : Math.max(1e-6, Math.abs(nd) * 1e-6);
    const bad = (v) => !isFinite(v) || Math.abs(v) > 1e30 || (nd !== null && Math.abs(v - nd) <= ndTol);
    if (spp >= 3 && L.photo === 2) {
      const mx = L.bps === 8 ? 255 : L.bps === 16 ? 65535 : 1;
      for (let i = 0; i < w * h; i++) { const r = data[i * spp], gg = data[i * spp + 1], b = data[i * spp + 2]; if (bad(r)) continue; px[i * 4] = r / mx * 255; px[i * 4 + 1] = gg / mx * 255; px[i * 4 + 2] = b / mx * 255; px[i * 4 + 3] = spp >= 4 ? data[i * spp + 3] / mx * 255 : 255; }
    } else if (L.cmap) {
      const n = L.cmap.length / 3;
      for (let i = 0; i < w * h; i++) { const v = data[i * spp]; if (bad(v)) continue; px[i * 4] = L.cmap[v] >> 8; px[i * 4 + 1] = L.cmap[n + v] >> 8; px[i * 4 + 2] = L.cmap[2 * n + v] >> 8; px[i * 4 + 3] = 255; }
    } else {
      if (!L.stats) { let mn = Infinity, mx = -Infinity; for (let i = 0; i < w * h; i++) { const v = data[i * spp]; if (bad(v)) continue; if (v < mn) mn = v; if (v > mx) mx = v; } L.stats = { min: mn, max: mx }; }
      const cols = AV.rampColors(L.ramp || (L.bps === 8 && L.photo !== 2 ? 'Grey (raster)' : 'Terrain'), 256).map(c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
      const mn = L.stats.min, span = (L.stats.max - mn) || 1;
      for (let i = 0; i < w * h; i++) { const v = data[i * spp]; if (bad(v)) continue; const k = Math.max(0, Math.min(255, Math.round((v - mn) / span * 255))); const cc = cols[k]; px[i * 4] = cc[0]; px[i * 4 + 1] = cc[1]; px[i * 4 + 2] = cc[2]; px[i * 4 + 3] = 255; }
    }
    g.putImageData(img, 0, 0); L.canvas = c;
  };
  const epsgWKT = (e) => {
    if (!e) return null; if (e === 4326 || e === 4269 || e === 4258) return AV.Proj.presetWKT('GEO'); if (e === 3857 || e === 900913 || e === 102100) return AV.Proj.presetWKT('WEBM');
    let z = null, south = false; if (e > 32600 && e <= 32660) z = e - 32600; else if (e > 32700 && e <= 32760) { z = e - 32700; south = true; } else if (e > 26900 && e <= 26923) z = e - 26900; else if (e > 25800 && e <= 25860) z = e - 25800;
    if (!z) return null; let w = AV.Proj.presetWKT('UTM' + z); if (south) w = w.replace(/PARAMETER\["False_Northing",\s*0(\.0*)?\]/, 'PARAMETER["False_Northing",10000000]').replace('N"', 'S"'); return w;
  };

  // ---------------------------------------------------------------- reprojection into the model CRS
  function transformer(app, srcWKT) {
    const dst = app.crs; if (!dst || !srcWKT) return null; let src; try { src = AV.Proj.parse(srcWKT); } catch (e) { return null; }
    const same = src.type === dst.type && ['a', 'lon0', 'lat0', 'k0', 'x0', 'y0', 'unit'].every(k => Math.abs((src[k] || 0) - (dst[k] || 0)) < 1e-9);
    if (same) return null;
    return (p) => { const g = AV.Proj.toGeo(src, p[0], p[1]); return AV.Proj.fromGeo(dst, g[0], g[1]); };
  }
  // Like Avaris DS: when the layer's own coordinates already lie on the model but the reprojected ones do not
  // (mislabelled / custom coordinate systems, e.g. a "calculated" UTM zone), draw it without reprojection.
  const RAW_NOTE = 'Drawn in its own coordinates: they already match the model (its coordinate system label differs from the map\'s).';
  const cornersBox = (c) => { const c3 = [c[1][0] + c[2][0] - c[0][0], c[1][1] + c[2][1] - c[0][1]]; return bbOf([c[0], c[1], c[2], c3]); };
  function keepRaw(app, rawB, newB) {
    const mb = app.model && app.model.nodes.size ? app.model.bounds(false) : null; if (!mb) return false;
    const pad = Math.max(mb.x2 - mb.x1, mb.y2 - mb.y1) * 0.5;
    const ov = (b) => !(b[2] < mb.x1 - pad || b[0] > mb.x2 + pad || b[3] < mb.y1 - pad || b[1] > mb.y2 + pad);
    return ov(rawB) && !ov(newB);
  }
  function reproject(L, tf) {
    for (const f of L.features) { if (f.type === 'point') f.coords = f.coords.map(tf); else f.coords = f.coords.map(part => part.map(tf)); f.bbox = bbOf(f.type === 'point' ? f.coords : f.coords.flat()); }
    let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const f of L.features) { b[0] = Math.min(b[0], f.bbox[0]); b[1] = Math.min(b[1], f.bbox[1]); b[2] = Math.max(b[2], f.bbox[2]); b[3] = Math.max(b[3], f.bbox[3]); } if (L.features.length) L.bbox = b;
  }

  // ---------------------------------------------------------------- entry point
  // full-resolution GeoTIFF / ASCII grid (no overview, no decimation) for sampling elevations (2D mesh)
  AV.readRasterFull = async function (path) {
    const e = ext(path); let L;
    if (e === 'tif' || e === 'tiff') L = await readTIFF(await window.host.readBinary(path), path, 12000);
    else if (e === 'asc') L = await readASC(path);
    else throw new Error('The DEM must be a GeoTIFF (.tif) or ASCII grid (.asc).');
    if (!L.corners) throw new Error('The DEM has no georeferencing (no GeoTIFF tags and no world file).');
    return L;
  };
  // opts.box: [x1, y1, x2, y2] in the map coordinates: a large geodatabase feature class is read only inside it
  AV.loadDataFile = async function (app, path, opts) {
    if (AV.GDB.isGdbLayerPath(path)) {
      const { gdb, layer } = AV.GDB.splitPath(path); const gopts = opts || {}; opts = gopts;
      // very large feature classes (e.g. all buildings of a state): offer to read only the model area
      try { const ls = AV.GDB._cache[gdb] || await AV.GDB.listLayers(gdb); const d = ls.find(x => x.name === layer); const b = app.model && app.model.bounds(false);
        if (opts && opts.box && d && d.count > 20000) { opts.spat = opts.box; if (app.crsWKT) opts.spatWKT = app.crsWKT; }
        else if (d && d.count > 100000 && b && b.x2 > b.x1) { const mx = Math.max(b.x2 - b.x1, b.y2 - b.y1) * 0.15;
          const v = await AV.modal({ title: 'Add Data', body: AV.h('div', { style: { maxWidth: '520px', lineHeight: 1.5, whiteSpace: 'pre-wrap' } }, layer + ' has ' + d.count.toLocaleString() + ' features. Reading all of them takes long and makes the map slow.\n\nRead only the features in the model area (with a margin of 15 %)?'), buttons: [{ label: 'Cancel', value: null }, { label: 'All ' + d.count.toLocaleString(), value: 'all' }, { label: 'Model Area Only', primary: true, value: 'area' }] }).done;
          if (!v) throw new Error('cancelled'); if (v === 'area') { opts.spat = [b.x1 - mx, b.y1 - mx, b.x2 + mx, b.y2 + mx]; if (app.crsWKT) opts.spatWKT = app.crsWKT; } } }
      catch (e) { if (e.message === 'cancelled') throw new Error('Cancelled.'); }
      const L = await AV.GDB.readLayer(gdb, layer, undefined, opts);
      return finishVector(app, Object.assign(L, { name: layer, path, gdb, visible: true, opacity: 1 }));
    }
    const e = ext(path); const name = AV.basename(path);
    if (NOT[e]) throw new Error(NOT[e] + ' cannot be read by Avaris2 CS yet. Export the data to Shapefile, GeoJSON, KML, CSV or GeoTIFF and add that file instead.');
    let L;
    if (e === 'shp') L = await readShapefile(path);
    else if (e === 'geojson' || e === 'json') { L = AV.SHP.readGeoJSON(await window.host.readText(path)); const sample = L.features.slice(0, 50).flatMap(f => f.type === 'point' ? f.coords : f.coords.flat()); L.prjWKT = sample.length && sample.every(p => Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90) ? GEO() : null; }
    else if (e === 'kml') L = readKML(await window.host.readText(path));
    else if (e === 'kmz' || e === 'zip') {
      const files = await window.host.readZip(path);
      const kml = files.find(f => /\.kml$/i.test(f.name)), shp = files.find(f => /\.shp$/i.test(f.name));
      if (kml) L = readKML(new TextDecoder().decode(kml.data));
      else if (shp) { const base = shp.name.replace(/\.shp$/i, ''); const get = (x) => files.find(f => f.name.toLowerCase() === (base + '.' + x).toLowerCase()); const dbf = get('dbf'); L = AV.SHP.readSHP(shp.data, dbf ? AV.SHP.readDBF(dbf.data) : null); const prj = get('prj'); L.prjWKT = prj ? new TextDecoder().decode(prj.data) : null; }
      else throw new Error('The archive contains no .kml or .shp file.');
    }
    else if (e === 'gpx') L = readGPX(await window.host.readText(path));
    else if (e === 'csv' || e === 'txt') L = readCSV(await window.host.readText(path));
    else if (e === 'dxf') L = readDXF(await window.host.readText(path));
    else if (e === 'tif' || e === 'tiff') {
      L = await readTIFF(await window.host.readBinary(path), path); L.prjWKT = epsgWKT(L.epsg);
      if (!L.prjWKT && L.peWKT) { try { AV.Proj.parse(L.peWKT); L.prjWKT = L.peWKT; } catch (er) { } }
      // ArcGIS / GDAL keep the full coordinate system in <raster>.aux.xml when the GeoTIFF keys cannot hold it
      if (!L.prjWKT && await exists(path + '.aux.xml')) { const m = /<SRS[^>]*>([\s\S]*?)<\/SRS>/.exec(await window.host.readText(path + '.aux.xml')); if (m) { const w = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim(); try { AV.Proj.parse(w); L.prjWKT = w; } catch (er) { } } }
    }
    else if (['png', 'jpg', 'jpeg', 'bmp', 'gif'].includes(e)) L = await readImage(path);
    else if (e === 'asc') L = await readASC(path);
    else throw new Error('Unsupported file type: .' + e);
    // sidecar .prj wins when present
    if (!L.prjWKT && !/^(kml|kmz|gpx)$/.test(e)) { const pp = swapExt(path, 'prj'); if (await exists(pp)) L.prjWKT = (await window.host.readText(pp)).trim(); }
    Object.assign(L, { name, path, visible: true, opacity: 1 });
    if (L.raster) {
      if (!L.corners) throw new Error('The raster has no georeferencing (no GeoTIFF tags and no world file).');
      const tf = transformer(app, L.prjWKT);
      if (tf) { let c2 = null; try { c2 = L.corners.map(tf); } catch (er) { } if (c2 && c2.flat().every(isFinite) && !keepRaw(app, cornersBox(L.corners), cornersBox(c2))) { L.corners = c2; L.crsNote = 'Reprojected from its own coordinate system into the map coordinate system.'; } else L.crsNote = RAW_NOTE; }
      else if (L.prjWKT || L.epsg) L.crsNote = app.crs ? 'Same coordinate system as the map.' : 'Map coordinate system not set: drawn as is.'; else L.crsNote = 'No coordinate system in the file: assumed to match the map.';
      const [c0, c1, c2] = L.corners; const c3 = [c1[0] + c2[0] - c0[0], c1[1] + c2[1] - c0[1]]; L.bbox = bbOf([c0, c1, c2, c3]);
      if (!L.image) AV.renderRaster(L); L.order = 'below'; L.kind = 'raster'; L.features = [];
    } else finishVector(app, L);
    return L;
  };
  function finishVector(app, L) {
    if (!L.features.length) throw new Error('The layer has no features that could be read.');
    let tf = transformer(app, L.prjWKT); L.srcWKT = L.prjWKT || null;
    if (tf) { try { const b = L.bbox || bbOf(L.features.flatMap(f => f.type === 'point' ? f.coords : f.coords.flat())); const c = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(tf); if (!c.flat().every(isFinite) || keepRaw(app, b, bbOf(c))) { tf = null; L.crsNote = RAW_NOTE; } } catch (er) { tf = null; L.crsNote = RAW_NOTE; } }
    if (tf) { reproject(L, tf); L.reprojected = true; L.crsNote = 'Reprojected into the map coordinate system.'; }
    else if (L.prjWKT && !app.crs) { L.crsNote = 'Map coordinate system not set: drawn in the layer\'s own coordinates.'; if (!app.model.nodes.size) app.setCRS(L.prjWKT); }
    const pal = ['#e65100', '#6a1b9a', '#00838f', '#ad1457', '#2e7d32', '#4e342e'];
    Object.assign(L, { stroke: pal[app.map.extLayers.length % pal.length], fill: '#90a4ae', fillOpacity: 0.25, width: 1.2, ptSize: 3, order: 'above' });
    return L;
  }
  AV.addData = async function (app, paths) {
    let added = 0, last = null;
    for (const p of paths) {
      try { app.status('Reading ' + p + ' ...'); const L = await AV.loadDataFile(app, p); app.map.extLayers.unshift(L); added++; last = L; app.status('Added ' + L.name + (L.raster ? ' (' + L.w + '×' + L.h + ')' : ' (' + L.features.length + ' features)')); }
      catch (e) { AV.alert('Could not add ' + p + ':\n\n' + e.message, 'Add Data'); }
    }
    if (!added) return;
    app.panels.refreshLayers();
    const mb = app.model && app.model.bounds(false);
    if (!mb || !app.model.nodes.size) app.map.zoomToBox({ x1: last.bbox[0], y1: last.bbox[1], x2: last.bbox[2], y2: last.bbox[3] });
    else { const b = last.bbox; const ov = !(b[2] < mb.x1 || b[0] > mb.x2 || b[3] < mb.y1 || b[1] > mb.y2); if (!ov) AV.toast(last.name + ' does not overlap the model area - right-click it in the Layer View and choose Zoom to Layer.', true, 6000); app.map.redraw(); }
  };
})(window.AV);
