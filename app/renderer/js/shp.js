// ESRI Shapefile (.shp/.shx/.dbf) and GeoJSON reading & writing
'use strict';
(function (AV) {
  const SHP = {};

  // ---------------------------------------------------------------- DBF
  SHP.readDBF = function (buf) {
    if (!buf) return null;
    const dv = new DataView(buf); const n = dv.getUint32(4, true); const hlen = dv.getUint16(8, true); const rlen = dv.getUint16(10, true);
    const fields = []; let off = 32;
    const dec = new TextDecoder('latin1');
    while (off < hlen - 1 && new Uint8Array(buf, off, 1)[0] !== 0x0d) {
      const name = dec.decode(new Uint8Array(buf, off, 11)).replace(/\0.*$/, '').trim();
      const type = String.fromCharCode(dv.getUint8(off + 11)); const len = dv.getUint8(off + 16); const dc = dv.getUint8(off + 17);
      fields.push({ name, type, len, dc }); off += 32;
    }
    const rows = [];
    for (let i = 0; i < n; i++) {
      let p = hlen + i * rlen; if (p + rlen > buf.byteLength) break;
      const deleted = dv.getUint8(p) === 0x2a; p += 1; const row = {};
      for (const f of fields) {
        let s = dec.decode(new Uint8Array(buf, p, f.len)).trim(); p += f.len;
        if (f.type === 'N' || f.type === 'F') { const x = parseFloat(s); row[f.name] = isFinite(x) ? x : null; }
        else if (f.type === 'L') row[f.name] = /^[YyTt]/.test(s);
        else row[f.name] = s;
      }
      if (!deleted) rows.push(row); else rows.push(null);
    }
    return { fields, rows };
  };
  SHP.writeDBF = function (fields, rows) {
    // fields: [{name, type:'C'|'N', len, dc}]
    const hlen = 32 + fields.length * 32 + 1; const rlen = 1 + fields.reduce((a, f) => a + f.len, 0);
    const buf = new ArrayBuffer(hlen + rlen * rows.length + 1); const dv = new DataView(buf); const u8 = new Uint8Array(buf);
    const d = new Date(); dv.setUint8(0, 3); dv.setUint8(1, d.getFullYear() - 1900); dv.setUint8(2, d.getMonth() + 1); dv.setUint8(3, d.getDate());
    dv.setUint32(4, rows.length, true); dv.setUint16(8, hlen, true); dv.setUint16(10, rlen, true);
    fields.forEach((f, i) => {
      const o = 32 + i * 32; const nm = f.name.slice(0, 10);
      for (let k = 0; k < nm.length; k++) u8[o + k] = nm.charCodeAt(k) & 0xff;
      u8[o + 11] = f.type.charCodeAt(0); u8[o + 16] = f.len; u8[o + 17] = f.dc || 0;
    });
    u8[hlen - 1] = 0x0d;
    rows.forEach((r, i) => {
      let p = hlen + i * rlen; u8[p++] = 0x20;
      for (const f of fields) {
        let v = r[f.key !== undefined ? f.key : f.name]; let s;
        if (f.type === 'N') { s = (v === null || v === undefined || !isFinite(v)) ? '' : (+v).toFixed(f.dc || 0); if (s.length > f.len) s = (+v).toExponential(Math.max(0, f.len - 7)); s = s.padStart(f.len).slice(-f.len); }
        else { s = (v === null || v === undefined ? '' : String(v)).slice(0, f.len).padEnd(f.len); }
        for (let k = 0; k < f.len; k++) u8[p + k] = (s.charCodeAt(k) || 32) & 0xff;
        p += f.len;
      }
    });
    u8[buf.byteLength - 1] = 0x1a;
    return buf;
  };

  // ---------------------------------------------------------------- SHP
  SHP.readSHP = function (buf, dbf) {
    const dv = new DataView(buf); const stype = dv.getInt32(32, true);
    const kind = [1, 11, 21].includes(stype) ? 'point' : [8, 18, 28].includes(stype) ? 'point' : [3, 13, 23].includes(stype) ? 'line' : [5, 15, 25].includes(stype) ? 'polygon' : 'unknown';
    const feats = []; let off = 100; let rec = 0;
    while (off + 8 <= buf.byteLength) {
      const clen = dv.getInt32(off + 4, false) * 2; const st = dv.getInt32(off + 8, true); const p = off + 8;
      let coords = [], bbox = null;
      if (st === 1 || st === 11 || st === 21) { const x = dv.getFloat64(p + 4, true), y = dv.getFloat64(p + 12, true); coords = [[x, y]]; bbox = [x, y, x, y]; }
      else if (st === 8 || st === 18 || st === 28) { const np = dv.getInt32(p + 36, true); bbox = [dv.getFloat64(p + 4, true), dv.getFloat64(p + 12, true), dv.getFloat64(p + 20, true), dv.getFloat64(p + 28, true)]; for (let i = 0; i < np; i++) coords.push([dv.getFloat64(p + 40 + i * 16, true), dv.getFloat64(p + 48 + i * 16, true)]); }
      else if (st !== 0) {
        bbox = [dv.getFloat64(p + 4, true), dv.getFloat64(p + 12, true), dv.getFloat64(p + 20, true), dv.getFloat64(p + 28, true)];
        const nparts = dv.getInt32(p + 36, true), npts = dv.getInt32(p + 40, true);
        const parts = []; for (let i = 0; i < nparts; i++) parts.push(dv.getInt32(p + 44 + i * 4, true));
        const pb = p + 44 + nparts * 4;
        for (let i = 0; i < nparts; i++) {
          const a = parts[i], b = i + 1 < nparts ? parts[i + 1] : npts; const part = [];
          for (let k = a; k < b; k++) part.push([dv.getFloat64(pb + k * 16, true), dv.getFloat64(pb + k * 16 + 8, true)]);
          coords.push(part);
        }
      }
      const props = dbf && dbf.rows[rec] ? dbf.rows[rec] : {};
      if (st !== 0 && (!dbf || dbf.rows[rec] !== null)) feats.push({ type: kind, coords, bbox, props });
      off += 8 + clen; rec++;
    }
    return SHP.finish(kind, feats, dbf ? dbf.fields.map(f => f.name) : []);
  };
  SHP.finish = function (kind, feats, fields) {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of feats) if (f.bbox) { b[0] = Math.min(b[0], f.bbox[0]); b[1] = Math.min(b[1], f.bbox[1]); b[2] = Math.max(b[2], f.bbox[2]); b[3] = Math.max(b[3], f.bbox[3]); }
    return { kind, features: feats, bbox: b[0] === Infinity ? [0, 0, 1, 1] : b, fields };
  };
  SHP.readGeoJSON = function (text) {
    const gj = typeof text === 'string' ? JSON.parse(text) : text; const feats = []; let kind = 'unknown'; const fields = new Set();
    const list = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ geometry: gj, properties: {} }];
    const bb = (pts) => { let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of pts) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); } return b; };
    for (const f of list) {
      const g = f.geometry; if (!g) continue; const props = f.properties || {}; Object.keys(props).forEach(k => fields.add(k));
      const add = (type, coords, flat) => { kind = kind === 'unknown' ? type : kind; feats.push({ type, coords, bbox: bb(flat), props }); };
      switch (g.type) {
        case 'Point': add('point', [g.coordinates], [g.coordinates]); break;
        case 'MultiPoint': add('point', g.coordinates, g.coordinates); break;
        case 'LineString': add('line', [g.coordinates], g.coordinates); break;
        case 'MultiLineString': add('line', g.coordinates, g.coordinates.flat()); break;
        case 'Polygon': add('polygon', g.coordinates, g.coordinates.flat()); break;
        case 'MultiPolygon': add('polygon', g.coordinates.flat(), g.coordinates.flat(2)); break;
      }
    }
    return SHP.finish(kind, feats, [...fields]);
  };
  SHP.load = async function (path) {
    if (/\.(geo)?json$/i.test(path)) return SHP.readGeoJSON(await window.host.readText(path));
    const shp = await window.host.readBinary(path);
    let dbf = null; const dp = path.replace(/\.shp$/i, '.dbf');
    if (await window.host.exists(dp)) dbf = SHP.readDBF(await window.host.readBinary(dp));
    else if (await window.host.exists(path.replace(/\.shp$/i, '.DBF'))) dbf = SHP.readDBF(await window.host.readBinary(path.replace(/\.shp$/i, '.DBF')));
    const r = SHP.readSHP(shp, dbf);
    const prj = path.replace(/\.shp$/i, '.prj'); if (await window.host.exists(prj)) r.prj = await window.host.readText(prj);
    return r;
  };

  // write: kind 'point'|'line'|'polygon', feats [{coords, props}], fields [{name,type,len,dc}]
  SHP.write = function (kind, feats, fields) {
    const stype = kind === 'point' ? 1 : kind === 'line' ? 3 : 5;
    const recs = feats.map(f => {
      if (kind === 'point') { const b = new ArrayBuffer(20); const d = new DataView(b); d.setInt32(0, 1, true); d.setFloat64(4, f.coords[0][0], true); d.setFloat64(12, f.coords[0][1], true); return { b, bbox: [f.coords[0][0], f.coords[0][1], f.coords[0][0], f.coords[0][1]] }; }
      const parts = f.coords; const npts = parts.reduce((a, p) => a + p.length, 0);
      const b = new ArrayBuffer(44 + 4 * parts.length + 16 * npts); const d = new DataView(b);
      let bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of parts) for (const q of p) { bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]); }
      d.setInt32(0, stype, true); bb.forEach((v, i) => d.setFloat64(4 + i * 8, v, true)); d.setInt32(36, parts.length, true); d.setInt32(40, npts, true);
      let k = 0; parts.forEach((p, i) => { d.setInt32(44 + i * 4, k, true); k += p.length; });
      let o = 44 + 4 * parts.length; for (const p of parts) for (const q of p) { d.setFloat64(o, q[0], true); d.setFloat64(o + 8, q[1], true); o += 16; }
      return { b, bbox: bb };
    });
    let bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const r of recs) { bb[0] = Math.min(bb[0], r.bbox[0]); bb[1] = Math.min(bb[1], r.bbox[1]); bb[2] = Math.max(bb[2], r.bbox[2]); bb[3] = Math.max(bb[3], r.bbox[3]); }
    if (!recs.length) bb = [0, 0, 0, 0];
    const shpLen = 100 + recs.reduce((a, r) => a + 8 + r.b.byteLength, 0); const shxLen = 100 + 8 * recs.length;
    const shp = new ArrayBuffer(shpLen), shx = new ArrayBuffer(shxLen); const ds = new DataView(shp), dx = new DataView(shx);
    const header = (d, len) => { d.setInt32(0, 9994, false); d.setInt32(24, len / 2, false); d.setInt32(28, 1000, true); d.setInt32(32, stype, true); bb.forEach((v, i) => d.setFloat64(36 + i * 8, v, true)); };
    header(ds, shpLen); header(dx, shxLen);
    let off = 100; recs.forEach((r, i) => {
      ds.setInt32(off, i + 1, false); ds.setInt32(off + 4, r.b.byteLength / 2, false); new Uint8Array(shp, off + 8, r.b.byteLength).set(new Uint8Array(r.b));
      dx.setInt32(100 + i * 8, off / 2, false); dx.setInt32(104 + i * 8, r.b.byteLength / 2, false); off += 8 + r.b.byteLength;
    });
    return { shp, shx, dbf: SHP.writeDBF(fields, feats.map(f => f.props)) };
  };
  SHP.fieldsFor = function (rows, keys) {
    return keys.map(k => {
      const vals = rows.map(r => r[k]).filter(v => v !== null && v !== undefined && v !== '');
      const numeric = vals.length && vals.every(v => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)));
      if (numeric) { rows.forEach(r => { if (r[k] !== null && r[k] !== undefined && r[k] !== '') r[k] = +r[k]; }); return { name: k.slice(0, 10), type: 'N', len: 19, dc: 6, key: k }; }
      let len = 4; for (const v of vals) len = Math.max(len, String(v).length); len = Math.min(254, len);
      return { name: k.slice(0, 10), type: 'C', len, key: k };
    });
  };
  AV.SHP = SHP;
})(window.AV);
