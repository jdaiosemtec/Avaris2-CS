// Editing of imported vector layers (2.9.4), as in Avaris DS: right-click a layer → Start Editing; then the normal
// tools work on its features: Select (click, box; Ctrl adds), the Properties panel edits the attributes of the
// selected features (one or many) and adds fields, Remove / Del deletes, Add → click the layer in the Layer View →
// draw new features, Edit Geometry drags vertices (double-click an edge adds one, right-click removes one).
// Every change is one undo step. Save Edits writes the shapefile back (only the .dbf when no geometry changed; the
// geometry in the layer's own coordinate system); other formats are saved as a new shapefile.
'use strict';
(function (AV) {
  const h = AV.h;
  const E = {}; AV.extEdit = E;
  E.layer = (app) => app.editLayer && app.map.extLayers.includes(app.editLayer) ? app.editLayer : null;
  E.sel = (L) => L.sel || (L.sel = new Set());
  const pip = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) ins = !ins; } return ins; };
  const segD = (px, py, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const L2 = dx * dx + dy * dy; let t = L2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy); };
  const fbox = (f) => { const b = [Infinity, Infinity, -Infinity, -Infinity]; const pts = f.type === 'point' ? f.coords : f.coords.flat(); for (const p of pts) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; } return b; };
  const layerBox = (L) => { let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const f of L.features) { const q = f.bbox; if (q[0] < b[0]) b[0] = q[0]; if (q[1] < b[1]) b[1] = q[1]; if (q[2] > b[2]) b[2] = q[2]; if (q[3] > b[3]) b[3] = q[3]; } return isFinite(b[0]) ? b : [0, 0, 1, 1]; };
  // spatial bucket index of the features (rebuilt after geometry changes)
  function index(L) {
    if (L._ix) return L._ix; const b = L.bbox; const B = Math.max((b[2] - b[0]), (b[3] - b[1])) / 256 || 1; const ix = new Map();
    L.features.forEach((f, k) => { const q = f.bbox || (f.bbox = fbox(f)); for (let i = Math.floor(q[0] / B); i <= Math.floor(q[2] / B); i++) for (let j = Math.floor(q[1] / B); j <= Math.floor(q[3] / B); j++) { const key = i * 1e7 + j; let a = ix.get(key); if (!a) ix.set(key, a = []); a.push(k); } });
    return (L._ix = { B, ix });
  }
  // feature of the layer under a map point (the smallest polygon containing it, else the nearest line / point within 6 px)
  E.hit = function (map, L, wx, wy) {
    const tol = 6 / map.scale; const { B, ix } = index(L); let best = null, bestA = Infinity, bestD = Infinity; const seen = new Set();
    for (let i = Math.floor((wx - tol) / B); i <= Math.floor((wx + tol) / B); i++) for (let j = Math.floor((wy - tol) / B); j <= Math.floor((wy + tol) / B); j++) { const a = ix.get(i * 1e7 + j); if (!a) continue;
      for (const k of a) { if (seen.has(k)) continue; seen.add(k); const f = L.features[k]; const q = f.bbox; if (!f || wx < q[0] - tol || wx > q[2] + tol || wy < q[1] - tol || wy > q[3] + tol) continue;
        if (f.type === 'polygon') { let n = 0; for (const r of f.coords) if (pip(wx, wy, r)) n++; if (n % 2 === 1) { const A = (q[2] - q[0]) * (q[3] - q[1]); if (A < bestA) { bestA = A; best = f; } } }
        else if (f.type === 'line') { for (const p of f.coords) for (let s = 1; s < p.length; s++) { const d = segD(wx, wy, p[s - 1], p[s]); if (d <= tol && d < bestD && bestA === Infinity) { bestD = d; best = f; } } }
        else { for (const p of f.coords) { const d = Math.hypot(wx - p[0], wy - p[1]); if (d <= tol && d < bestD && bestA === Infinity) { bestD = d; best = f; } } } } }
    return best;
  };
  E.inBox = (L, x1, y1, x2, y2) => L.features.filter(f => { const q = f.bbox; const cx = (q[0] + q[2]) / 2, cy = (q[1] + q[3]) / 2; return cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2; });
  E.select = function (app, L, feats, add) {
    const S = E.sel(L); if (!add) S.clear(); for (const f of feats) { if (add && S.has(f) && feats.length === 1) S.delete(f); else S.add(f); }
    if (app.selection.size) app.selection.clear(); if (app.meshSelSet && app.meshSelSet.size) AV.meshClearSel(app);
    app.onSelectionChanged(); app.map.redraw(); if (app.showRightTab) app.showRightTab('props');
    app.status(S.size ? S.size + ' feature(s) of ' + L.name + ' selected' : 'Ready'); AV.syncTableSelection && AV.syncTableSelection(app);
  };
  E.clear = function (app) { const L = E.layer(app); if (L && L.sel && L.sel.size) { L.sel.clear(); app.map.redraw(); } };
  // after a change: dirty flags, bbox, index, Layer View, map
  function touched(app, L, geom) { L.dirty = true; if (geom) { L.geomDirty = true; for (const f of L.features) if (!f.bbox) f.bbox = fbox(f); L.bbox = layerBox(L); L._ix = null; } app.panels.refreshLayers(); app.map.redraw(); app.panels.showProps(); }
  E.touched = touched;
  // field names of the layer in order
  E.fields = (L) => { const F = L.fields && L.fields.length ? L.fields.slice() : []; for (const f of L.features.slice(0, 2000)) for (const k of Object.keys(f.props || {})) if (!F.includes(k)) F.push(k); return F; };

  // ---------------------------------------------------------------- start / stop / save
  E.start = async function (app, L) {
    if (L.raster || !L.features) return; const cur = E.layer(app); if (cur === L) return; if (cur && !await E.stop(app)) return;
    app.editLayer = L; L.editing = true; E.sel(L);
    if (L.geomDirty === undefined) { L.dirty = false; L.geomDirty = false; }
    app.panels.refreshLayers(); app.map.redraw();
    AV.toast('Editing ' + L.name + ': Select, the Properties panel, Remove, Add (then click the layer in the Layer View) and Edit Geometry now work on its features. Save Edits / Stop Editing in its menu.', false, 9000);
  };
  // -> false when cancelled
  E.stop = async function (app) {
    const L = E.layer(app); if (!L) { app.editLayer = null; return true; }
    if (L.dirty) { const v = await AV.modal({ title: 'Stop Editing', body: h('div', null, 'Save the edits of ' + L.name + '?'), buttons: [{ label: 'Cancel', value: null }, { label: "Don't Save", value: 'no' }, { label: 'Save', primary: true, value: 'yes' }] }).done;
      if (!v) return false; if (v === 'yes') { if (!await E.save(app, L)) return false; } else await E.reload(app, L); }
    L.editing = false; if (L.sel) L.sel.clear(); app.editLayer = null; app.panels.refreshLayers(); app.map.redraw(); app.panels.showProps(); return true;
  };
  // discard edits: read the layer again from its file
  E.reload = async function (app, L) {
    if (!L.path) return; try { const N = await AV.loadDataFile(app, L.path); L.features = N.features; L.fields = N.fields; L.bbox = N.bbox; L._ix = null; L.dirty = false; L.geomDirty = false; if (L.sel) L.sel.clear(); }
    catch (e) { AV.toast('Could not read ' + L.name + ' again: ' + e.message, true); }
  };
  const isShp = (p) => /\.shp$/i.test(p || '');
  // -> true when saved
  E.save = async function (app, L) {
    let path = L.path, asNew = !isShp(path);
    if (asNew) { const p = await window.host.saveDialog({ title: 'Save edits of ' + L.name + ' as shapefile', defaultPath: String(L.name).replace(/\.\w+$/, '').replace(/[|\\/:*?"<>]/g, '_') + '.shp', filters: [{ name: 'Shapefile', extensions: ['shp'] }] }); if (!p) return false; path = p; }
    const keys = E.fields(L); const rows = L.features.map(f => Object.assign({}, f.props)); const fields = AV.SHP.fieldsFor(rows, keys);
    const rowsOut = rows.map(r => { const o = {}; for (const F of fields) o[F.name] = r[F.key]; return o; }); const fOut = fields.map(F => ({ name: F.name, type: F.type, len: F.len, dc: F.dc }));
    const base = path.replace(/\.shp$/i, '');
    try {
      if (!asNew && !L.geomDirty) { await window.host.writeBinary(base + '.dbf', new Uint8Array(AV.SHP.writeDBF(fOut, rowsOut))); }
      else {
        // back into the layer's own coordinates when it was reprojected for the map (same file); a new file is written in the map coordinates
        const inv = !asNew && L.srcWKT && L.reprojected && app.crs ? (() => { const src = AV.Proj.parse(L.srcWKT), dst = app.crs; return (p) => { const g = AV.Proj.toGeo(dst, p[0], p[1]); return AV.Proj.fromGeo(src, g[0], g[1]); }; })() : null;
        const feats = L.features.map((f, i) => ({ coords: inv ? (f.type === 'point' ? f.coords.map(inv) : f.coords.map(part => part.map(inv))) : f.coords, props: rowsOut[i] }));
        const w = AV.SHP.write(L.kind, feats, fOut);
        await window.host.writeBinary(base + '.shp', new Uint8Array(w.shp)); await window.host.writeBinary(base + '.shx', new Uint8Array(w.shx)); await window.host.writeBinary(base + '.dbf', new Uint8Array(w.dbf));
        if (asNew && app.crsWKT) await window.host.writeText(base + '.prj', app.crsWKT);
      }
    } catch (e) { AV.alert('Could not save ' + L.name + ':\n\n' + e.message, 'Save Edits'); return false; }
    L.fields = fields.map(F => F.name); for (const f of L.features) { const o = {}; for (const F of fields) o[F.name] = f.props[F.key]; f.props = o; }
    if (asNew) { L.path = base + '.shp'; L.name = AV.basename(L.path); L.srcWKT = app.crsWKT || null; L.reprojected = false; }
    L.dirty = false; L.geomDirty = false; app.panels.refreshLayers(); AV.toast('Saved ' + L.features.length.toLocaleString() + ' features to ' + base + '.shp' + (fields.some(F => F.name !== F.key) ? ' (field names longer than 10 characters were shortened)' : ''));
    return true;
  };
  // before an action that reads layer files (Create Meshes): offer to save the edited layer when its file is used
  E.checkSaved = async function (app, paths) {
    const L = E.layer(app); if (!L || !L.dirty || !L.path) return true;
    const used = paths.filter(Boolean).map(p => AV.f2dResolve(app, String(p).replace(/^"|"$/g, ''))).some(p => p === L.path);
    if (!used) return true;
    const v = await AV.modal({ title: 'Unsaved Edits', body: h('div', null, L.name + ' has edits that are not saved; Create Meshes reads the file. Save them first?'), buttons: [{ label: 'Cancel', value: null }, { label: 'Use the File as Saved', value: 'no' }, { label: 'Save Edits', primary: true, value: 'yes' }] }).done;
    if (!v) return false; if (v === 'yes') return await E.save(app, L); return true;
  };

  // ---------------------------------------------------------------- edits (undoable)
  E.setAttr = function (app, L, feats, key, val) {
    const old = feats.map(f => f.props[key]); const isNew = !E.fields(L).includes(key);
    app.exec({ label: 'Edit ' + L.name + ' (' + key + ')', do: () => { feats.forEach(f => { f.props[key] = val; }); if (isNew && L.fields && !L.fields.includes(key)) L.fields.push(key); touched(app, L); },
      undo: () => { feats.forEach((f, i) => { if (old[i] === undefined) delete f.props[key]; else f.props[key] = old[i]; }); touched(app, L); } });
  };
  E.addField = async function (app, L) {
    const r = await AV.formDialog('Add Field - ' + L.name, [{ k: 'name', l: 'Name', t: 'text' }, { k: 'type', l: 'Type', t: 'choice', o: [['C', 'Text'], ['N', 'Number']] }, { k: 'val', l: 'Value for all features', t: 'text' },
      { t: 'note', l: 'Shapefile field names have at most 10 characters. For 2D exclusion polygons use type (VOID / RAISED / POROUS), height, porosity.' }], { name: '', type: 'C', val: '' });
    if (!r) return; const name = String(r.name || '').trim(); if (!/^[A-Za-z_][\w]{0,9}$/.test(name)) { AV.alert('Use a name of 1–10 letters, digits or _ that starts with a letter.', 'Add Field'); return; }
    if (E.fields(L).some(k => k.toLowerCase() === name.toLowerCase())) { AV.alert('The layer already has a field ' + name + '.', 'Add Field'); return; }
    let v = r.val === undefined ? '' : String(r.val).trim(); if (r.type === 'N') { v = v === '' ? null : parseFloat(v); if (v !== null && !isFinite(v)) { AV.alert('The value must be a number.', 'Add Field'); return; } }
    const feats = L.features.slice(); app.exec({ label: 'Add field ' + name + ' to ' + L.name, do: () => { feats.forEach(f => { f.props[name] = v === null ? '' : v; }); L.fields = E.fields(L); if (!L.fields.includes(name)) L.fields.push(name); touched(app, L); },
      undo: () => { feats.forEach(f => { delete f.props[name]; }); L.fields = (L.fields || []).filter(k => k !== name); touched(app, L); } });
  };
  E.deleteField = function (app, L, name) {
    const feats = L.features.slice(); const old = feats.map(f => f.props[name]); const pos = (L.fields || []).indexOf(name);
    app.exec({ label: 'Delete field ' + name + ' of ' + L.name, do: () => { feats.forEach(f => { delete f.props[name]; }); L.fields = E.fields(L).filter(k => k !== name); touched(app, L); },
      undo: () => { feats.forEach((f, i) => { if (old[i] !== undefined) f.props[name] = old[i]; }); L.fields = E.fields(L); if (!L.fields.includes(name)) L.fields.splice(Math.max(0, pos), 0, name); touched(app, L); } });
  };
  E.deleteSelected = function (app) {
    const L = E.layer(app); if (!L || !L.sel || !L.sel.size) return false; const del = new Set(L.sel); const idx = []; L.features.forEach((f, i) => { if (del.has(f)) idx.push(i); }); const fs = idx.map(i => L.features[i]);
    app.exec({ label: 'Delete ' + fs.length + ' feature(s) of ' + L.name, do: () => { L.features = L.features.filter(f => !del.has(f)); L.sel.clear(); touched(app, L, true); },
      undo: () => { idx.forEach((i, k) => L.features.splice(i, 0, fs[k])); touched(app, L, true); } });
    return true;
  };
  E.addFeature = function (app, L, f) {
    for (const k of E.fields(L)) if (!(k in f.props)) f.props[k] = ''; f.bbox = fbox(f);
    app.exec({ label: 'Add feature to ' + L.name, do: () => { L.features.push(f); touched(app, L, true); }, undo: () => { const i = L.features.indexOf(f); if (i >= 0) L.features.splice(i, 1); if (L.sel) L.sel.delete(f); touched(app, L, true); } });
  };
  // ---- vertices of the selected features (Edit Geometry)
  E.vertexHit = function (map, sx, sy) {
    const app = map.app, L = E.layer(app); if (!L || !app.editEnabled || !L.sel || !L.sel.size || L.sel.size > 50) return null;
    for (const f of L.sel) { if (f.type === 'point') continue; for (let p = 0; p < f.coords.length; p++) { const part = f.coords[p]; for (let i = 0; i < part.length; i++) { const [x, y] = map.toScreen(part[i][0], part[i][1]); if (Math.hypot(x - sx, y - sy) <= 6) return { f, p, i }; } } }
    return null;
  };
  const closedRing = (f, p) => { const r = f.coords[p]; return f.type === 'polygon' && r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]; };
  E.moveVertex = function (f, p, i, x, y) { const r = f.coords[p]; r[i] = [x, y]; if (closedRing(f, p) || (f.type === 'polygon' && f._closed)) { if (i === 0) r[r.length - 1] = [x, y]; else if (i === r.length - 1) r[0] = [x, y]; } };
  E.geomEdit = function (app, L, f, label, oldC) { const nw = JSON.parse(JSON.stringify(f.coords)); const old = oldC;
    app.exec({ label: label + ' (' + L.name + ')', light: true, do: () => { f.coords = JSON.parse(JSON.stringify(nw)); f.bbox = fbox(f); touched(app, L, true); }, undo: () => { f.coords = JSON.parse(JSON.stringify(old)); f.bbox = fbox(f); touched(app, L, true); } }); };
  E.removeVertex = function (app, vh) { const L = E.layer(app); const f = vh.f; const r = f.coords[vh.p]; const closed = closedRing(f, vh.p); const min = f.type === 'polygon' ? 4 : 2;
    if (r.length <= min) { AV.toast('A ' + (f.type === 'polygon' ? 'polygon needs 3' : 'line needs 2') + ' vertices.', true); return; }
    const old = JSON.parse(JSON.stringify(f.coords)); if (closed && (vh.i === 0 || vh.i === r.length - 1)) { r.splice(r.length - 1, 1); r.splice(0, 1); r.push(r[0].slice()); } else r.splice(vh.i, 1); E.geomEdit(app, L, f, 'Remove vertex', old); };
  E.insertVertex = function (map, wx, wy) {
    const app = map.app, L = E.layer(app); if (!L || !app.editEnabled || !L.sel) return false; const tol = 6 / map.scale;
    for (const f of L.sel) { if (f.type === 'point') continue; for (const part of f.coords) for (let s = 1; s < part.length; s++) if (segD(wx, wy, part[s - 1], part[s]) <= tol) { const old = JSON.parse(JSON.stringify(f.coords)); part.splice(s, 0, [wx, wy]); E.geomEdit(app, L, f, 'Add vertex', old); return true; } }
    return false;
  };

  // ---------------------------------------------------------------- Properties panel for the selected features
  E.props = function (app, el) {
    const L = E.layer(app); if (!L || !L.sel || !L.sel.size) return false; const S = [...L.sel]; const F = E.fields(L);
    el.appendChild(h('div', { class: 'phead' }, h('div', { class: 'pt' }, S.length === 1 ? L.name + ' – FID ' + (L.features.indexOf(S[0]) + 1) : S.length + ' features of ' + L.name), h('div', { class: 'ps' }, (S.length === 1 ? S[0].type : 'edit a value to set it for all selected') + ' · editing')));
    const tb = h('table', { class: 'pgrid' }, h('tr', { class: 'pg0' }, h('td', { colspan: 2 }, 'Attributes')));
    for (const k of F) { const vals = new Set(S.map(f => f.props[k] === undefined || f.props[k] === null ? '' : String(f.props[k]))); const same = vals.size === 1 ? [...vals][0] : null;
      const num = S.every(f => f.props[k] === '' || f.props[k] === undefined || f.props[k] === null || typeof f.props[k] === 'number');
      const inp = h('input', { type: 'text', value: same === null ? '' : same, placeholder: same === null ? '(mixed)' : '', onchange: () => { let v = inp.value.trim(); if (num && v !== '' && isFinite(+v)) v = +v; E.setAttr(app, L, S, k, v); } });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      tb.appendChild(h('tr', null, h('td', { class: 'k' }, k), h('td', { class: 'v' }, inp))); }
    el.appendChild(tb);
    el.appendChild(h('div', { style: { padding: '8px 10px', display: 'flex', gap: '6px', flexWrap: 'wrap' } }, h('button', { class: 'btn small', onclick: () => E.addField(app, L) }, '+ Add Field...'),
      h('button', { class: 'btn small', onclick: () => AV.openTable(app, AV.extTableId(L)) }, 'Attribute Table'), h('button', { class: 'btn small', onclick: () => { app.map.zoomToBox((() => { let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const f of S) { const q = f.bbox; b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; } return { x1: b[0], y1: b[1], x2: b[2], y2: b[3] }; })()); } }, 'Zoom To')));
    return true;
  };
  // handles of the vertices of the selected features while Edit Geometry is on
  AV.mapOverlays = AV.mapOverlays || [];
  AV.mapOverlays.push((map, ctx) => { const app = map.app, L = E.layer(app); if (!L || !app.editEnabled || !L.sel || !L.sel.size || L.sel.size > 50) return;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff6d00'; ctx.lineWidth = 1.5;
    for (const f of L.sel) { if (f.type === 'point') continue; for (const part of f.coords) part.forEach((p, i) => { if (f.type === 'polygon' && i === part.length - 1 && part.length > 1 && p[0] === part[0][0] && p[1] === part[0][1]) return; const [x, y] = map.toScreen(p[0], p[1]); ctx.fillRect(x - 3.5, y - 3.5, 7, 7); ctx.strokeRect(x - 3.5, y - 3.5, 7, 7); }); } });
})(window.AV);
