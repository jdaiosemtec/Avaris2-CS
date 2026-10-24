// Copy the selected objects (with their inflows, RDII, groundwater, LID usage ... and the curves / time series /
// patterns they use) and paste them into this or another model. The clipboard lives in memory and in
// localStorage, so it survives opening another model and is shared by Avaris2 CS windows.
'use strict';
(function (AV) {
  const KEY = 'osemcm.clipboard.v1';
  const tok = (l) => AV.tokenize(l);
  const isData = (l) => { const t = String(l).trim(); return t && t[0] !== ';'; };
  const fmtLine = (t) => t.map(x => /\s/.test(x) || x === '' ? '"' + x + '"' : String(x)).map((x, j) => j === t.length - 1 ? x : (x + ' ').padEnd(j === 0 ? 17 : 11)).join('');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // raw sections whose rows belong to an object: [section, id column, kind]
  const OWN = [['INFLOWS', 0, 'NODE'], ['DWF', 0, 'NODE'], ['RDII', 0, 'NODE'], ['TREATMENT', 0, 'NODE'],
    ['GROUNDWATER', 0, 'SUBCATCH'], ['GWF', 0, 'SUBCATCH'], ['LID_USAGE', 0, 'SUBCATCH'], ['COVERAGES', 0, 'SUBCATCH'], ['LOADINGS', 0, 'SUBCATCH'], ['ADJUSTMENTS', 1, 'SUBCATCH']];
  const plain = (o) => { const c = { id: o.id, kind: o.kind, type: o.type, p: clone(o.p), tag: o.tag || '' }; if (o.desc) c.desc = o.desc;
    if (o.kind === 'NODE' || o.kind === 'GAGE') { c.x = o.x; c.y = o.y; } if (o.kind === 'LINK') { c.from = o.from; c.to = o.to; c.verts = clone(o.verts || []); } if (o.kind === 'SUBCATCH') c.poly = clone(o.poly || []); return c; };

  // the clipboard is also written to a file in the user data folder so it reaches other Avaris2 CS windows / processes
  const clipFile = async () => { try { const P = await window.host.paths(); const d = P.userData || P.home; return d ? d.replace(/[\\/]+$/, '') + '/osemcm-clipboard.json' : null; } catch (e) { return null; } };
  AV.hasClip = () => { if (AV._clip) return true; try { return !!localStorage.getItem(KEY); } catch (e) { return false; } };
  const getClip = async () => { if (AV._clip) return AV._clip; try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { /* fall through */ }
    try { const f = await clipFile(); if (f && await window.host.exists(f)) return JSON.parse(await window.host.readText(f)); } catch (e) { /* none */ } return null; };

  AV.copySelection = function (app) {
    const m = app.model; const sel = [...app.selection].filter(o => o.kind !== 'LABEL'); if (!sel.length) { AV.toast('Nothing is selected.', true); return; }
    const ids = { NODE: new Set(), LINK: new Set(), SUBCATCH: new Set(), GAGE: new Set() }; sel.forEach(o => ids[o.kind] && ids[o.kind].add(o.id));
    const raw = {};
    for (const [sec, col, kind] of OWN) { const rows = (m.raw[sec] || []).filter(l => isData(l) && ids[kind].has(tok(l)[col])); if (rows.length) raw[sec] = rows; }
    // referenced curves, time series and patterns
    const refs = new Set(); const add = (v) => { if (v && v !== '*') refs.add(String(v)); };
    for (const o of sel) { const p = o.p || {};
      if (o.kind === 'LINK') { add(p.curve); add(p.coeffCurve); if (/^TABULAR/.test(p.otype || '')) add(p.c1); if (p.shape === 'CUSTOM') add(p.g2); }
      if (o.kind === 'NODE') { if (p.shape === 'TABULAR') add(p.sp1); if (p.otype === 'TIDAL' || p.otype === 'TIMESERIES') add(p.stage); if (p.dtype === 'TABULAR') add(String(p.dparam || '').split(/\s+/)[0]); }
      if (o.kind === 'GAGE' && p.source !== 'FILE') add(p.series); }
    for (const l of raw.INFLOWS || []) { const t = tok(l); add(t[2]); add(t[7]); }
    for (const l of raw.DWF || []) tok(l).slice(3).forEach(add);
    for (const l of raw.ADJUSTMENTS || []) add(tok(l)[2]);
    const curves = {}, series = {}, patterns = [];
    for (const r of refs) { if (m.curves.has(r)) curves[r] = clone(m.curves.get(r)); if (m.timeseries.has(r)) series[r] = clone(m.timeseries.get(r)); }
    for (const l of m.raw.PATTERNS || []) if (isData(l) && refs.has(tok(l)[0])) patterns.push(l);
    const clip = { ver: 1, si: m.isSI, flowUnits: m.flowUnits, objs: sel.map(plain), raw, curves, series, patterns };
    AV._clip = clip; const js = JSON.stringify(clip); try { localStorage.setItem(KEY, js); } catch (e) { /* too large for storage: memory + file copy */ }
    clipFile().then(f => f && window.host.writeText(f, js)).catch(() => {});
    const n = (k) => sel.filter(o => o.kind === k).length;
    AV.toast('Copied ' + [[n('NODE'), 'node'], [n('LINK'), 'link'], [n('SUBCATCH'), 'subcatchment'], [n('GAGE'), 'rain gage']].filter(x => x[0]).map(x => x[0] + ' ' + x[1] + (x[0] > 1 ? 's' : '')).join(', ') + '. Paste with Ctrl+V or right-click → Paste (also in another model).');
  };

  AV.pasteClip = async function (app) {
    const clip = await getClip(); if (!clip || !clip.objs || !clip.objs.length) { AV.toast('The clipboard is empty.', true); return; }
    const m = app.model;
    if (!!clip.si !== !!m.isSI && !await AV.confirm('The copied objects come from a model in ' + (clip.si ? 'SI' : 'US') + ' units (' + clip.flowUnits + ') but this model uses ' + m.flowUnits + '.\nValues are pasted unchanged (no unit conversion). Continue?', 'Paste', 'Paste')) return;
    const used = new Set(); const fresh = (id) => { if (!m.idExists(id) && !used.has(id)) { used.add(id); return id; } let i = 1; while (m.idExists(id + '_' + i) || used.has(id + '_' + i)) i++; used.add(id + '_' + i); return id + '_' + i; };
    const R = { NODE: {}, LINK: {}, SUBCATCH: {}, GAGE: {} };
    for (const c of clip.objs) R[c.kind][c.id] = fresh(c.id);
    const nodeId = (id) => R.NODE[id] || (m.nodes.has(id) ? id : null);
    const objs = []; let skipped = 0, badOutlet = 0;
    for (const c0 of clip.objs) { const c = clone(c0); c.id = R[c.kind][c0.id];
      if (c.kind === 'LINK') { const a = nodeId(c.from), b = nodeId(c.to); if (!a || !b) { skipped++; continue; } c.from = a; c.to = b; }
      if (c.kind === 'SUBCATCH') { const o = c.p.outlet; c.p.outlet = R.NODE[o] || R.SUBCATCH[o] || o; if (c.p.outlet && !m.nodes.has(c.p.outlet) && !m.subcatchments.has(c.p.outlet) && !R.NODE[o] && !R.SUBCATCH[o]) badOutlet++;
        if (c.p.gage && R.GAGE[c.p.gage]) c.p.gage = R.GAGE[c.p.gage]; else if (c.p.gage && !m.gages.has(c.p.gage)) c.p.gage = [...m.gages.keys()][0] || c.p.gage; }
      if (c.kind === 'NODE' && c.type === 'DIVIDER' && R.LINK[c.p.divLink]) c.p.divLink = R.LINK[c.p.divLink];
      if (c.kind === 'GAGE' && !c.p) c.p = AV.defaults('GAGE');
      objs.push(c); }
    if (!objs.length) { AV.toast('Nothing could be pasted: the copied links need their end nodes.', true); return; }
    // object rows of the data sections, with ids renamed
    const secs = {};
    for (const sec in clip.raw) { const col = (OWN.find(x => x[0] === sec) || [])[1] || 0; const kind = (OWN.find(x => x[0] === sec) || [])[2];
      const rows = clip.raw[sec].map(l => { const t = tok(l); const nid = R[kind][t[col]]; if (!nid || !objs.some(o => o.id === nid)) return null; t[col] = nid;
        if (sec === 'TREATMENT' || sec === 'GWF') return fmtLine(t.slice(0, 2)) + '  ' + t.slice(2).join(' ');
        if (sec === 'GROUNDWATER' && t[2]) t[2] = nodeId(t[2]) || t[2]; if (sec === 'LID_USAGE' && t[9] && t[9] !== '*') t[9] = R.NODE[t[9]] || R.SUBCATCH[t[9]] || t[9];
        return fmtLine(t); }).filter(Boolean);
      if (rows.length) secs[sec] = (m.raw[sec] || []).concat(rows); }
    const pats = (clip.patterns || []).filter(l => !(m.raw.PATTERNS || []).some(x => isData(x) && tok(x)[0] === tok(l)[0]));
    if (pats.length) secs.PATTERNS = (m.raw.PATTERNS || []).concat(pats);
    const newCurves = Object.keys(clip.curves || {}).filter(k => !m.curves.has(k)), newSeries = Object.keys(clip.series || {}).filter(k => !m.timeseries.has(k));
    const coll = (o) => o.kind === 'NODE' ? m.nodes : o.kind === 'LINK' ? m.links : o.kind === 'SUBCATCH' ? m.subcatchments : m.gages;
    const old = {}; for (const s in secs) old[s] = m.raw[s] ? m.raw[s].slice() : null;
    const setRaw = (src) => { for (const s in src) { if (src[s] === null) delete m.raw[s]; else { m.raw[s] = src[s].slice(); if (!m.rawOrder.includes(s)) m.rawOrder.push(s); } } };
    // nodes before links before subcatchments keeps the INP order sensible
    const order = { GAGE: 0, NODE: 1, LINK: 2, SUBCATCH: 3 }; objs.sort((a, b) => order[a.kind] - order[b.kind]);
    app.exec({ label: 'Paste ' + objs.length + ' object(s)',
      do: () => { for (const o of objs) coll(o).set(o.id, o); for (const k of newCurves) m.curves.set(k, clone(clip.curves[k])); for (const k of newSeries) m.timeseries.set(k, clone(clip.series[k])); setRaw(secs); },
      undo: () => { for (const o of objs) coll(o).delete(o.id); for (const k of newCurves) m.curves.delete(k); for (const k of newSeries) m.timeseries.delete(k); setRaw(old); },
      changes: objs.map(o => ({ o, key: '_created', old: '', nw: '' })) });
    app.panels.refreshTree(); app.panels.refreshLayers && app.panels.refreshLayers();
    app.selectMany(objs);
    const renamed = objs.filter(o => clip.objs.some(c => c.kind === o.kind && c.id !== o.id && R[c.kind][c.id] === o.id)).length;
    const msg = ['Pasted ' + objs.length + ' object(s).'];
    if (renamed) msg.push(renamed + ' renamed (_1, _2 …) because the IDs already exist.');
    if (skipped) msg.push(skipped + ' link(s) skipped: their end nodes were not copied and do not exist here.');
    if (badOutlet) msg.push(badOutlet + ' subcatchment outlet(s) do not exist in this model; set them before running.');
    if (newCurves.length || newSeries.length || pats.length) msg.push('Added ' + [newCurves.length && newCurves.length + ' curve(s)', newSeries.length && newSeries.length + ' time series', pats.length && 'patterns'].filter(Boolean).join(', ') + '.');
    AV.toast(msg.join(' '), !!(skipped || badOutlet), 7000);
    if (!objs.some(o => app.map.visibleBox && (() => { const vb = app.map.visibleBox(); const x = o.x !== undefined ? o.x : null; return x !== null && x >= vb.x1 && x <= vb.x2 && o.y >= vb.y1 && o.y <= vb.y2; })())) app.map.zoomToObjects(objs);
  };
})(window.AV);
