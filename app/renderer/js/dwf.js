// Dry weather (foul) flow generation (Tools ▸ Model Data ▸ Dry Weather Flow).
//   Loads: subcatchments (area × unit rate, or population density × per-capita flow) or a GIS point / polygon layer
//   (population, households or a flow per feature). Each load goes to a node: the outlet of the subcatchment (outlet
//   chains are followed), or for features the subcatchment that contains it, else the nearest junction / storage.
//   An infiltration allowance can be added. Diurnal patterns (hourly, optional weekend) from templates, editable.
//   Writes [DWF] FLOW rows and [PATTERNS] in one undoable step.
'use strict';
(function (AV) {
  const h = AV.h;
  const norm = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length || 1; return a.map(v => +(v / m).toFixed(3)); };
  const TEMPLATES = {
    Residential: { hr: [0.55, 0.45, 0.4, 0.38, 0.42, 0.6, 0.95, 1.35, 1.5, 1.4, 1.25, 1.15, 1.1, 1.05, 1.0, 0.98, 1.05, 1.2, 1.38, 1.42, 1.3, 1.12, 0.9, 0.7],
      we: [0.6, 0.5, 0.42, 0.38, 0.38, 0.42, 0.55, 0.8, 1.15, 1.4, 1.45, 1.4, 1.3, 1.2, 1.12, 1.08, 1.1, 1.2, 1.3, 1.32, 1.25, 1.1, 0.92, 0.75] },
    Commercial: { hr: [0.35, 0.3, 0.3, 0.3, 0.32, 0.4, 0.7, 1.2, 1.6, 1.7, 1.7, 1.65, 1.55, 1.6, 1.6, 1.55, 1.45, 1.25, 0.95, 0.75, 0.6, 0.5, 0.42, 0.38],
      we: [0.4, 0.35, 0.35, 0.35, 0.35, 0.4, 0.5, 0.7, 0.9, 1.1, 1.25, 1.3, 1.3, 1.25, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.42] },
    Industrial: { hr: [0.7, 0.7, 0.7, 0.7, 0.75, 0.85, 1.05, 1.2, 1.25, 1.25, 1.25, 1.2, 1.15, 1.2, 1.25, 1.25, 1.2, 1.1, 1.0, 0.9, 0.85, 0.8, 0.75, 0.72], we: null },
    Flat: { hr: Array(24).fill(1), we: null },
  };
  // litres per second -> model flow units
  const FROM_LPS = { CMS: 0.001, LPS: 1, MLD: 0.0864, CFS: 1 / 28.3168, GPM: 15.8503, MGD: 0.0228245 };

  // the node a subcatchment drains to (outlet chains through other subcatchments are followed)
  const outletNode = (m, s) => { let o = s, k = 0; while (o && k++ < 50) { const t = o.p.outlet; if (!t) return null; if (m.nodes.has(t)) return t; o = m.subcatchments.get(t); } return null; };
  const inPoly = (x, y, rings) => { let c = false; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

  AV.openDWF = async function (app) {
    const m = app.model; if (!m.nodes.size) { AV.alert('The model has no nodes.', 'Dry Weather Flow'); return; }
    const si = m.isSI, FU = m.flowUnits || (si ? 'CMS' : 'CFS');
    const P = Object.assign({ src: 'sub', basis: 'pop', rate: si ? 0.5 : 1500, dens: si ? 40 : 16, pcap: si ? 200 : 100, layer: '', field: '', meaning: 'pop', hh: 2.6, assign: 'sub', infil: 10, tpl: 'Residential', weekend: true, mode: 'replace', name: 'DWF', where: '' }, app.prefs.dwf || {});
    let pat = { hr: (TEMPLATES[P.tpl] || TEMPLATES.Residential).hr.slice(), we: ((TEMPLATES[P.tpl] || TEMPLATES.Residential).we || TEMPLATES.Residential.we).slice() };
    const U = si ? { area: 'ha', rate: 'L/s/ha', dens: 'persons/ha', pcap: 'L/person/day' } : { area: 'acre', rate: 'gal/day/acre', dens: 'persons/acre', pcap: 'gal/person/day' };
    const toLps = (x, kind) => si ? (kind === 'pcap' ? x / 86400 : x) : (kind === 'pcap' || kind === 'rate' ? x * 3.78541 / 86400 : x);   // pcap: L/d or gal/d -> L/s ; rate gal/d -> L/s
    const layers = app.map.extLayers.filter(L => L.features && L.features.some(f => f.type === 'point' || f.type === 'polygon'));
    const fieldsOf = (L) => { if (!L) return []; const s = new Set(); for (const f of L.features.slice(0, 200)) for (const k in (f.props || {})) { const v = f.props[k]; if (v !== '' && v !== null && isFinite(+v)) s.add(k); } return [...s]; };
    const sel = (opts, val, on) => { const e = h('select', { onchange: () => on(e.value) }, opts.map(([v, l]) => h('option', { value: v }, l))); e.value = val; return e; };
    const num = (k, w, st) => h('input', { type: 'number', min: 0, step: st || 'any', value: P[k], style: { width: (w || 70) + 'px' }, onchange: (e) => { P[k] = Math.max(0, +e.target.value || 0); refresh(); } });

    // ---------------------------------------------------------------- loads per node
    function compute() {
      const loads = new Map(); const add = (id, lps, pop) => { if (!id) return; const x = loads.get(id) || { q: 0, pop: 0, n: 0 }; x.q += lps; x.pop += pop || 0; x.n++; loads.set(id, x); };
      let lost = 0, nSrc = 0; let where = null; if (P.where.trim()) { try { where = AV.compileExpr(P.where, AV.exprFields(app, 'sub')); } catch (e) { where = null; } }
      if (P.src === 'sub') {
        for (const s of m.subcatchments.values()) { if (where && !where.fn(s)) continue; const a = +s.p.area || 0; if (!(a > 0)) continue; nSrc++;
          const nd = outletNode(m, s); let lps, pop = 0;
          if (P.basis === 'area') lps = a * toLps(P.rate, 'rate'); else { pop = a * P.dens; lps = pop * toLps(P.pcap, 'pcap'); }
          if (!nd) { lost += lps; continue; } add(nd, lps, pop); }
      } else {
        const L = layers.find(x => (x.name || x.path) === P.layer); if (!L) return { loads, lost: 0, nSrc: 0, err: 'Choose a point or polygon layer (add it in the Layer View first).' };
        const subs = [...m.subcatchments.values()].filter(s => s.poly && s.poly.length >= 3); const tg = [...m.nodes.values()].filter(n => n.type === 'JUNCTION' || n.type === 'STORAGE');
        for (const f of L.features) {
          let x, y; if (f.type === 'point') [x, y] = f.coords[0]; else if (f.type === 'polygon') { const r = f.coords[0] || []; x = r.reduce((a, p) => a + p[0], 0) / (r.length || 1); y = r.reduce((a, p) => a + p[1], 0) / (r.length || 1); } else continue;
          const v = +((f.props || {})[P.field]); if (!isFinite(v) || v <= 0) continue; nSrc++;
          let pop = 0, lps; if (P.meaning === 'pop') { pop = v; lps = v * toLps(P.pcap, 'pcap'); } else if (P.meaning === 'hh') { pop = v * P.hh; lps = pop * toLps(P.pcap, 'pcap'); } else lps = si ? v : v * 3.78541 / 86400;   // flow: L/s or gal/day
          let nd = null;
          if (P.assign === 'sub') { const s = subs.find(s => { const b = s._bb; if (b && (x < b[0] || x > b[2] || y < b[1] || y > b[3])) return false; return inPoly(x, y, [s.poly]); }); if (s) nd = outletNode(m, s); }
          if (!nd) { let bd = Infinity; for (const n of tg) { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; nd = n.id; } } }
          add(nd, lps, pop);
        }
      }
      if (P.infil > 0) for (const x of loads.values()) x.q *= 1 + P.infil / 100;
      return { loads, lost, nSrc };
    }
    // ---------------------------------------------------------------- dialog
    const body = h('div', { class: 'dwfdlg' }); const prev = h('div'); let res = null;
    const patGrid = h('div');
    function renderPat() {
      patGrid.innerHTML = '';
      const row = (arr, lab) => h('div', { class: 'dwfpat' }, h('span', { class: 'pl' }, lab), arr.map((v, i) => h('input', { type: 'number', step: 0.01, min: 0, value: v, title: String(i).padStart(2, '0') + ':00', onchange: (e) => { arr[i] = Math.max(0, +e.target.value || 0); drawPat(); } })));
      patGrid.appendChild(h('div', { class: 'dwfpat hdr' }, h('span', { class: 'pl' }, ''), [...Array(24)].map((_, i) => h('span', null, String(i)))));
      patGrid.appendChild(row(pat.hr, 'Weekday')); if (P.weekend) patGrid.appendChild(row(pat.we, 'Weekend'));
      patGrid.appendChild(cv); drawPat();
    }
    const cv = h('canvas', { width: 860, height: 90, style: { width: '860px', height: '90px', marginTop: '4px' } });
    function drawPat() {
      const c = cv.getContext('2d'); c.clearRect(0, 0, 860, 90); const all = pat.hr.concat(P.weekend ? pat.we : []); const mx = Math.max(2, ...all) * 1.05;
      c.strokeStyle = '#cfd8dc'; c.beginPath(); c.moveTo(40, 85 - 80 / mx); c.lineTo(852, 85 - 80 / mx); c.stroke(); c.fillStyle = '#90a4ae'; c.font = '10px Segoe UI'; c.fillText('1.0', 14, 89 - 80 / mx);
      const line = (a, col) => { c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); a.forEach((v, i) => { const x = 58 + i * 33.5 + 16, y = 85 - v / mx * 80; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); };
      line(norm(pat.hr), '#1e88e5'); if (P.weekend) line(norm(pat.we), '#fb8c00');
    }
    const refresh = AV.debounce(() => { res = compute(); renderPrev(); }, 150);
    function renderPrev() {
      prev.innerHTML = ''; if (res.err) { prev.appendChild(h('div', { class: 'note', style: { color: 'var(--warn)' } }, res.err)); return; }
      const k = FROM_LPS[FU] || 1; const tot = [...res.loads.values()].reduce((a, x) => a + x.q, 0); const pop = [...res.loads.values()].reduce((a, x) => a + x.pop, 0);
      const ex = new Set((m.raw.DWF || []).filter(r => r.trim() && r.trim()[0] !== ';').map(r => AV.tokenize(r)).filter(t => /^FLOW$/i.test(t[1] || '')).map(t => t[0]));
      const kept = P.mode === 'missing' ? [...res.loads.keys()].filter(id => ex.has(id)).length : 0;
      prev.appendChild(h('div', { class: 'pchips' }, [[String(res.nSrc), P.src === 'sub' ? 'subcatchments' : 'features'], [String(res.loads.size), 'nodes with DWF'], [pop ? Math.round(pop).toLocaleString() : '–', 'population'], [AV.fmt(tot * k, 4), 'average ' + FU], [AV.fmt(tot * 86.4, 1), 'm³/day' + (si ? '' : ' (' + AV.fmt(tot * 86.4 * 264.172 / 1e6, 3) + ' MGD)')]]
        .map(([v, l]) => h('div', { class: 'pchip' }, h('b', null, v), h('span', null, l)))));
      if (res.lost > 0) prev.appendChild(h('div', { class: 'note', style: { color: 'var(--warn)' } }, AV.fmt(res.lost * k, 4) + ' ' + FU + ' not assigned: subcatchments without an outlet node.'));
      if (kept) prev.appendChild(h('div', { class: 'note' }, kept + ' node(s) already have a dry weather flow and keep it ("only nodes without DWF").'));
      const top = [...res.loads].sort((a, b) => b[1].q - a[1].q).slice(0, 150);
      prev.appendChild(h('div', { class: 'ptwrap', style: { maxHeight: '160px' } }, h('table', { class: 'ptbl' }, h('tr', null, h('th', null, 'Node'), h('th', null, 'Average (' + FU + ')'), h('th', null, 'Population'), h('th', null, 'Sources'), h('th', null, 'Existing DWF')),
        top.map(([id, x]) => h('tr', { class: 'p', ondblclick: () => { const n = m.nodes.get(id); if (n) { app.selectMany([n]); app.map.zoomToObjects([n]); } } }, h('td', null, id), h('td', { class: 'num' }, AV.fmt(x.q * k, 5)), h('td', { class: 'num' }, x.pop ? Math.round(x.pop) : ''), h('td', { class: 'num' }, String(x.n)), h('td', null, ex.has(id) ? 'yes' : ''))))));
    }
    function renderBody() {
      body.innerHTML = '';
      const srcSel = sel([['sub', 'Subcatchments'], ['layer', 'GIS layer (points / polygons)']], P.src, (v) => { P.src = v; renderBody(); refresh(); });
      const rows = [h('label', null, 'Loads from'), srcSel];
      if (P.src === 'sub') {
        rows.push(h('label', null, 'Basis'), h('span', { class: 'dwfrow' }, sel([['pop', 'Population density × per-capita flow'], ['area', 'Area × unit flow']], P.basis, (v) => { P.basis = v; renderBody(); refresh(); })));
        if (P.basis === 'area') rows.push(h('label', null, 'Unit flow'), h('span', { class: 'dwfrow' }, num('rate'), ' ' + U.rate));
        else rows.push(h('label', null, 'Density'), h('span', { class: 'dwfrow' }, num('dens'), ' ' + U.dens, h('span', { style: { width: '14px' } }), num('pcap'), ' ' + U.pcap));
        const wh = h('input', { type: 'text', value: P.where, placeholder: "(all)  e.g.  tag = 'RES'  or  imperv > 30", style: { width: '320px' }, onchange: (e) => { P.where = e.target.value; refresh(); } });
        rows.push(h('label', null, 'Only subcatchments'), wh);
      } else {
        const lsel = sel([['', layers.length ? '— choose a layer —' : '(no point / polygon layer loaded)']].concat(layers.map(L => [L.name || L.path, L.name || AV.basename(L.path || '')])), P.layer, (v) => { P.layer = v; P.field = fieldsOf(layers.find(x => (x.name || x.path) === v))[0] || ''; renderBody(); refresh(); });
        const L = layers.find(x => (x.name || x.path) === P.layer); const fl = fieldsOf(L);
        rows.push(h('label', null, 'Layer'), lsel, h('label', null, 'Attribute'), h('span', { class: 'dwfrow' }, sel(fl.length ? fl.map(f => [f, f]) : [['', '(no numeric attribute)']], P.field, (v) => { P.field = v; refresh(); }), ' is ',
          sel([['pop', 'population'], ['hh', 'households'], ['flow', 'flow (' + (si ? 'L/s' : 'gal/day') + ')']], P.meaning, (v) => { P.meaning = v; renderBody(); refresh(); })));
        if (P.meaning !== 'flow') rows.push(h('label', null, 'Per-capita flow'), h('span', { class: 'dwfrow' }, num('pcap'), ' ' + U.pcap, P.meaning === 'hh' ? [h('span', { style: { width: '14px' } }), num('hh', 60, 0.1), ' persons / household'] : null));
        rows.push(h('label', null, 'Node'), sel([['sub', 'outlet of the subcatchment that contains the feature, else nearest junction'], ['near', 'nearest junction / storage']], P.assign, (v) => { P.assign = v; refresh(); }));
      }
      rows.push(h('label', null, 'Infiltration'), h('span', { class: 'dwfrow' }, '+', num('infil', 60), ' % of the foul flow (base infiltration)'));
      rows.push(h('label', null, 'Existing DWF'), sel([['replace', 'replace the FLOW dry weather flow of the nodes that get a load'], ['add', 'add to the existing baseline'], ['missing', 'only nodes without a dry weather flow'], ['all', 'remove all FLOW dry weather flows first']], P.mode, (v) => { P.mode = v; refresh(); }));
      body.appendChild(h('div', { class: 'form dwfform' }, rows));
      const tplSel = sel(Object.keys(TEMPLATES).map(k => [k, k]).concat([['Custom', 'Custom']]), P.tpl, (v) => { P.tpl = v; if (TEMPLATES[v]) { pat.hr = TEMPLATES[v].hr.slice(); pat.we = (TEMPLATES[v].we || TEMPLATES[v].hr).slice(); } renderPat(); });
      const pname = h('input', { type: 'text', value: P.name, style: { width: '120px' }, onchange: (e) => { P.name = e.target.value.replace(/\s+/g, '_') || 'DWF'; } });
      body.appendChild(h('div', { class: 'psec2' }, 'Diurnal pattern (multipliers; normalised to an average of 1 when written)'));
      body.appendChild(h('div', { class: 'dwfrow' }, 'Template ', tplSel, h('label', { style: { marginLeft: '12px' } }, h('input', { type: 'checkbox', checked: P.weekend, onchange: (e) => { P.weekend = e.target.checked; renderPat(); } }), ' weekend pattern'), h('span', { style: { marginLeft: '12px' } }, 'Pattern name '), pname, h('span', { class: 'hint' }, '  → patterns <name>_HR' + (P.weekend ? ', <name>_WE' : ''))));
      body.appendChild(patGrid); renderPat();
      body.appendChild(h('div', { class: 'psec2' }, 'Result')); body.appendChild(prev);
    }
    renderBody(); res = compute(); renderPrev();
    const r = await AV.modal({ title: 'Dry Weather Flow', width: 940, body, buttons: [{ label: 'Cancel', value: null }, { label: 'Apply', primary: true, onClick: () => { res = compute(); if (res.err) { AV.toast(res.err, true); return false; } if (!res.loads.size) { AV.toast('No load to assign.', true); return false; } return true; } }] }).done;
    if (!r) return;
    app.prefs.dwf = P; app.savePrefs && app.savePrefs();
    // ---------------------------------------------------------------- write [DWF] and [PATTERNS]
    const k = FROM_LPS[FU] || 1; const nmH = P.name + '_HR', nmW = P.name + '_WE';
    const isData = (r) => r.trim() && r.trim()[0] !== ';';
    const old = (m.raw.DWF || []).slice(); const byNode = new Map(); const keep = [];
    for (const r of old) { if (!isData(r)) { keep.push(r); continue; } const t = AV.tokenize(r); if (/^FLOW$/i.test(t[1] || '')) byNode.set(t[0], { r, t }); else keep.push(r); }
    const q = (s) => /\s/.test(s) ? '"' + s + '"' : s; const pats = [q(nmH)].concat(P.weekend ? [q(nmW)] : []);
    const fmtQ = (v) => +v.toPrecision(5);
    const outRows = new Map();
    if (P.mode !== 'all') for (const [id, x] of byNode) outRows.set(id, x.r);
    let n = 0;
    for (const [id, x] of res.loads) {
      const ex = byNode.get(id); const q0 = x.q * k;
      if (P.mode === 'missing' && ex) continue;
      const base = P.mode === 'add' && ex ? (+ex.t[2] || 0) + q0 : q0;
      outRows.set(id, [id.padEnd(16), 'FLOW'.padEnd(10), String(fmtQ(base)).padEnd(12)].join(' ') + ' ' + pats.join(' ')); n++;
    }
    const dwf = keep.concat([...outRows.values()]);
    const patRows = (m.raw.PATTERNS || []).filter(r => { if (!isData(r)) return true; const t = AV.tokenize(r); return t[0] !== nmH && t[0] !== nmW; });
    const prow = (name, type, a) => { const v = norm(a); return [q(name) + ' ' + type + ' ' + v.slice(0, 12).join(' '), q(name) + ' ' + ' '.repeat(type.length) + ' ' + v.slice(12).join(' ')]; };
    patRows.push(';Generated by Avaris2 CS Dry Weather Flow (' + P.tpl + ')', ...prow(nmH, 'HOURLY', pat.hr)); if (P.weekend) patRows.push(...prow(nmW, 'WEEKEND', pat.we));
    AV.setSections(app, 'Dry weather flow: ' + n + ' node(s)', { DWF: dwf, PATTERNS: patRows });
    app.refreshAll && app.refreshAll();
    AV.toast('Dry weather flow written for ' + n + ' node(s); patterns ' + nmH + (P.weekend ? ', ' + nmW : '') + '. Undo with Ctrl+Z.');
  };
})(window.AV);
