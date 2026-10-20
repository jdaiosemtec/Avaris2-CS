// Esri File Geodatabase (.gdb) read / write through the bundled GDAL vector tools (OpenFileGDB driver):
// list feature classes, add chosen feature classes as map layers, and write feature classes into a new or existing .gdb.
'use strict';
(function (AV) {
  const GDB = { _cache: {} };
  const fail = (r, what) => { const msg = (r.stderr || '').split(/\r?\n/).filter(x => x.trim() && !/^Warning 1: (organizePolygons|Several drivers)/.test(x)).slice(0, 6).join('\n'); throw new Error(what + (msg ? ':\n' + msg : ' (exit code ' + r.code + ')')); };
  GDB.available = async () => { try { return await window.host.gdalAvailable(); } catch (e) { return false; } };
  GDB.isGdbLayerPath = (p) => /\.gdb[\\/]?\|/i.test(p);
  GDB.splitPath = (p) => { const i = p.lastIndexOf('|'); return { gdb: p.slice(0, i), layer: p.slice(i + 1) }; };
  const geomKind = (t) => { t = String(t || '').toLowerCase(); return /point/.test(t) ? 'point' : /line|curve/.test(t) && !/polygon|surface/.test(t) ? 'line' : /polygon|surface/.test(t) ? 'polygon' : t === 'none' || !t ? 'table' : 'other'; };
  // -> [{name, geom, kind, count, wkt, fields:[{name,type}], dataset}]
  GDB.listLayers = async function (gdb) {
    const r = await window.host.gdal('ogrinfo', ['-json', '-so', '-al', '-nomd', '-ro', '-wkt_format', 'WKT1', gdb]);
    if (r.code !== 0) fail(r, 'Could not open ' + gdb);
    let j; try { j = JSON.parse(r.stdout); } catch (e) { throw new Error('Unexpected ogrinfo output: ' + r.stdout.slice(0, 200)); }
    return (GDB._cache[gdb] = (j.layers || []).map(L => {
      const g = (L.geometryFields || [])[0] || {}; const cs = g.coordinateSystem || {};
      return { name: L.name, geom: g.type || 'None', kind: geomKind(g.type), count: L.featureCount, wkt: cs.wkt || null, fields: (L.fields || []).map(f => ({ name: f.name, type: f.type })), dataset: (L.metadata && L.metadata[''] && L.metadata['']['FEATURE_DATASET']) || '' };
    }));
  };
  // read one feature class into an external map layer object (not yet reprojected; loadDataFile does that)
  GDB.readLayer = async function (gdb, layer, wkt) {
    if (wkt === undefined) { const ls = GDB._cache[gdb] || await GDB.listLayers(gdb); const d = ls.find(x => x.name === layer); wkt = d ? d.wkt : null; }
    const tmp = await window.host.tempDir(); const out = AV.joinPath(tmp, 'layer.geojson');
    try {
      const r = await window.host.gdal('ogr2ogr', ['-f', 'GeoJSON', '-dim', 'XY', '-nlt', 'CONVERT_TO_LINEAR', '-lco', 'RFC7946=NO', '-lco', 'WRITE_BBOX=NO', out, gdb, layer]);
      if (r.code !== 0) fail(r, 'Could not read ' + layer);
      const L = AV.SHP.readGeoJSON(await window.host.readText(out)); L.prjWKT = wkt || null; return L;
    } finally { window.host.rm(tmp).catch(() => { }); }
  };
  // write feature classes: layers [{name, kind:'point'|'line'|'polygon', feats:[{coords, props}], fields:[{key,name,type:'N'|'C'}]}]
  GDB.write = async function (gdb, layers, wkt, onProgress) {
    const tmp = await window.host.tempDir(); const done = [];
    try {
      let prj = null; if (wkt) { prj = AV.joinPath(tmp, 'srs.prj'); await window.host.writeText(prj, wkt); }
      let exists = await window.host.exists(gdb);
      for (const [i, L] of layers.entries()) {
        if (onProgress) onProgress(i, L.name);
        const gj = { type: 'FeatureCollection', features: L.feats.map(f => ({ type: 'Feature', geometry: L.kind === 'point' ? { type: 'Point', coordinates: f.coords[0] } : L.kind === 'line' ? { type: 'MultiLineString', coordinates: f.coords } : { type: 'MultiPolygon', coordinates: [f.coords] }, properties: Object.fromEntries(L.fields.map(fd => [fd.name, f.props[fd.key] === '' || f.props[fd.key] === undefined ? null : fd.type === 'N' ? +f.props[fd.key] : String(f.props[fd.key])])) })) };
        const src = AV.joinPath(tmp, 'l' + i + '.geojson'); await window.host.writeText(src, JSON.stringify(gj));
        const args = ['-f', 'OpenFileGDB'].concat(exists ? ['-update', '-overwrite'] : []).concat(['-nln', L.name, '-nlt', L.kind === 'point' ? 'POINT' : L.kind === 'line' ? 'MULTILINESTRING' : 'MULTIPOLYGON'])
          .concat(prj ? ['-a_srs', prj] : []).concat(L.alias ? ['-lco', 'LAYER_ALIAS=' + L.alias] : []).concat([gdb, src]);
        const r = await window.host.gdal('ogr2ogr', args);
        if (r.code !== 0) fail(r, 'Could not write ' + L.name);
        exists = true; done.push(L.name);
      }
    } finally { window.host.rm(tmp).catch(() => { }); }
    return done;
  };
  // valid File GDB field / table name
  GDB.cleanName = (s, used) => { let n = String(s).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'F'; if (!/^[A-Za-z]/.test(n)) n = 'F_' + n; n = n.slice(0, 60); let k = n, i = 2; while (used && used.has(k.toLowerCase())) k = n.slice(0, 56) + '_' + i++; if (used) used.add(k.toLowerCase()); return k; };
  AV.GDB = GDB;
})(window.AV);
