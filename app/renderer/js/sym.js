// Layer symbology (per object type, like the Avaris DS / ArcGIS Pro layer list), the Layer View tree,
// the right-hand dock tabs (Properties / Catalog / Symbology) and the Symbology pane.
'use strict';
(function (AV) {
  const h = AV.h;
  const NODE_T = ['JUNCTION', 'OUTFALL', 'STORAGE', 'DIVIDER'], LINK_T = ['CONDUIT', 'PUMP', 'ORIFICE', 'WEIR', 'OUTLET'];
  const NAMES = { JUNCTION: 'Junctions', OUTFALL: 'Outfalls', STORAGE: 'Storages', DIVIDER: 'Dividers', CONDUIT: 'Conduits', PUMP: 'Pumps', ORIFICE: 'Orifices', WEIR: 'Weirs', OUTLET: 'Outlets', SUBCATCH: 'Subcatchments' };
  AV.SYM_NAMES = NAMES;
  const DEF = {
    JUNCTION: { shape: 'circle', color: '#ffeb3b', stroke: '#37474f', size: 5, opacity: 1, visible: true },
    OUTFALL: { shape: 'triangle-down', color: '#f28b82', stroke: '#b71c1c', size: 7, opacity: 1, visible: true },
    STORAGE: { shape: 'square', color: '#b3e5fc', stroke: '#01579b', size: 6, opacity: 1, visible: true },
    DIVIDER: { shape: 'diamond', color: '#9fa8da', stroke: '#283593', size: 6, opacity: 1, visible: true },
    CONDUIT: { mid: 'arrow', midSize: 1, midFill: '#ffffff', color: '#3f6fd1', width: 2, style: 'solid', arrows: true, opacity: 1, visible: true },
    PUMP: { mid: 'pump', midSize: 1, midFill: '#ffffff', color: '#ec6f8f', width: 2.5, style: 'solid', arrows: true, opacity: 1, visible: true },
    ORIFICE: { mid: 'orifice', midSize: 1, midFill: '#ffffff', color: '#4a4fa8', width: 2.5, style: 'solid', arrows: true, opacity: 1, visible: true },
    WEIR: { mid: 'weir', midSize: 1, midFill: '#ffffff', color: '#c68a12', width: 2.5, style: 'solid', arrows: true, opacity: 1, visible: true },
    OUTLET: { mid: 'outlet', midSize: 1, midFill: '#ffffff', color: '#9fa0c8', width: 2.5, style: 'solid', arrows: true, opacity: 1, visible: true },
    SUBCATCH: { fill: '#d4ecd4', outline: '#5aa05a', width: 1, opacity: 0.85, visible: true },
  };
  AV.SYM_DEF = DEF;
  AV.NODE_SHAPES = ['circle', 'square', 'triangle', 'triangle-down', 'diamond', 'pentagon', 'hexagon', 'star', 'cross'];
  AV.symOf = function (app, type) {
    const p = (app.prefs.sym = app.prefs.sym || {});
    if (!p[type]) p[type] = {};
    const d = DEF[type] || DEF.JUNCTION;
    for (const k in d) if (p[type][k] === undefined) p[type][k] = d[k];
    return p[type];
  };
  // draw a node symbol into a path / context (r = nominal radius)
  AV.nodeShape = function (g, shape, x, y, r) {
    switch (shape) {
      case 'square': g.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8); break;
      case 'triangle': g.moveTo(x, y - r * 1.15); g.lineTo(x + r * 1.1, y + r * 0.8); g.lineTo(x - r * 1.1, y + r * 0.8); g.closePath(); break;
      case 'triangle-down': g.moveTo(x - r * 1.1, y - r * 0.8); g.lineTo(x + r * 1.1, y - r * 0.8); g.lineTo(x, y + r * 1.15); g.closePath(); break;
      case 'diamond': g.moveTo(x, y - r * 1.25); g.lineTo(x + r * 1.1, y); g.lineTo(x, y + r * 1.25); g.lineTo(x - r * 1.1, y); g.closePath(); break;
      case 'pentagon': case 'hexagon': { const n = shape === 'pentagon' ? 5 : 6; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n; const px = x + r * Math.cos(a), py = y + r * Math.sin(a); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); break; }
      case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.5 : r * 1.2; const px = x + rr * Math.cos(a), py = y + rr * Math.sin(a); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); break;
      case 'cross': { const t = r * 0.38; g.moveTo(x - t, y - r); g.lineTo(x + t, y - r); g.lineTo(x + t, y - t); g.lineTo(x + r, y - t); g.lineTo(x + r, y + t); g.lineTo(x + t, y + t); g.lineTo(x + t, y + r); g.lineTo(x - t, y + r); g.lineTo(x - t, y + t); g.lineTo(x - r, y + t); g.lineTo(x - r, y - t); g.lineTo(x - t, y - t); g.closePath(); break; }
      default: g.moveTo(x + r * 0.85, y); g.arc(x, y, r * 0.85, 0, 6.2832);
    }
  };
  // ---- link mid-point symbols: drawn centred on the link's midpoint, x axis along the link (downstream = +x).
  // r = nominal half size in px. fill = symbol background, color = line colour.
  const MID_COMMON = [['none', 'None'], ['arrow', 'Arrow'], ['chevron', 'Chevron'], ['circle', 'Circle'], ['square', 'Square'], ['diamond', 'Diamond']];
  AV.MID_STYLES = {
    CONDUIT: [['arrow', 'Arrow'], ['arrow-open', 'Open arrow'], ['chevron', 'Chevron'], ['double-chevron', 'Double chevron'], ['arrow-circle', 'Arrow in circle'], ['dot', 'Dot'], ['tick', 'Cross tick'], ['none', 'None']],
    PUMP: [['pump', 'Pump (circle + triangle)'], ['pump-impeller', 'Impeller'], ['pump-casing', 'Centrifugal casing'], ['pump-letter', 'Circle "P"'], ['pump-double', 'Double arrow in circle'], ['pump-screw', 'Screw pump']],
    ORIFICE: [['orifice', 'Box with line'], ['orifice-plate', 'Orifice plate'], ['orifice-hole', 'Box with hole'], ['orifice-gate', 'Sluice gate'], ['orifice-letter', 'Circle "O"']],
    WEIR: [['weir', 'Box with crest line'], ['weir-v', 'V-notch'], ['weir-rect', 'Rectangular notch'], ['weir-crest', 'Broad crest'], ['weir-step', 'Sharp crest step'], ['weir-letter', 'Circle "W"']],
    OUTLET: [['outlet', 'Triangle'], ['outlet-xbox', 'Box with X'], ['outlet-valve', 'Valve (bow tie)'], ['outlet-flap', 'Flap gate'], ['outlet-gate', 'Gate'], ['outlet-letter', 'Circle "U"']],
  };
  for (const t in AV.MID_STYLES) for (const c of MID_COMMON) if (!AV.MID_STYLES[t].some(x => x[0] === c[0])) AV.MID_STYLES[t].push(c);
  AV.drawMidSym = function (g, key, color, fill, r) {
    r = r || 6; const k = r / 6; g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    g.fillStyle = fill; g.strokeStyle = color; g.lineWidth = Math.max(1, 1.5 * k);
    const B = () => g.beginPath(), FS = () => { g.fill(); g.stroke(); }, S = () => g.stroke(), Fc = () => { g.fillStyle = color; g.fill(); g.fillStyle = fill; };
    const circ = (rr) => { B(); g.arc(0, 0, rr, 0, 6.2832); };
    const letter = (t) => { circ(r); FS(); g.fillStyle = color; g.font = 'bold ' + Math.round(r * 1.25) + 'px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; { const m = g.getTransform(); g.rotate(-Math.atan2(m.b, m.a)); } g.fillText(t, 0, r * 0.06); };
    switch (key) {
      case 'none': break;
      case 'arrow': case 'outlet': B(); g.moveTo(r, 0); g.lineTo(-r * 0.8, -r * 0.8); g.lineTo(-r * 0.8, r * 0.8); g.closePath(); if (key === 'arrow') Fc(); else FS(); break;
      case 'arrow-open': B(); g.moveTo(r, 0); g.lineTo(-r * 0.8, -r * 0.8); g.lineTo(-r * 0.8, r * 0.8); g.closePath(); FS(); break;
      case 'chevron': B(); g.moveTo(-r * 0.5, -r * 0.8); g.lineTo(r * 0.5, 0); g.lineTo(-r * 0.5, r * 0.8); g.lineWidth *= 1.4; S(); break;
      case 'double-chevron': B(); g.moveTo(-r * 0.9, -r * 0.7); g.lineTo(0, 0); g.lineTo(-r * 0.9, r * 0.7); g.moveTo(0, -r * 0.7); g.lineTo(r * 0.9, 0); g.lineTo(0, r * 0.7); g.lineWidth *= 1.3; S(); break;
      case 'arrow-circle': circ(r); FS(); B(); g.moveTo(r * 0.6, 0); g.lineTo(-r * 0.4, -r * 0.5); g.lineTo(-r * 0.4, r * 0.5); g.closePath(); Fc(); break;
      case 'dot': circ(r * 0.55); Fc(); break;
      case 'tick': B(); g.moveTo(0, -r); g.lineTo(0, r); g.lineWidth *= 1.4; S(); break;
      case 'circle': circ(r * 0.85); FS(); break;
      case 'square': B(); g.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6); FS(); break;
      case 'diamond': B(); g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0); g.closePath(); FS(); break;
      // pumps
      case 'pump': circ(r); FS(); B(); g.moveTo(-r * 0.35, -r * 0.5); g.lineTo(r * 0.55, 0); g.lineTo(-r * 0.35, r * 0.5); g.closePath(); Fc(); break;
      case 'pump-impeller': circ(r); FS(); B(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.moveTo(0, 0); g.quadraticCurveTo(Math.cos(a + 0.7) * r * 0.6, Math.sin(a + 0.7) * r * 0.6, Math.cos(a + 1.2) * r * 0.8, Math.sin(a + 1.2) * r * 0.8); } S(); circ(r * 0.18); Fc(); break;
      case 'pump-casing': B(); g.rect(0, -r, r * 1.2, r * 0.55); FS(); circ(r); FS(); circ(r * 0.3); Fc(); break;
      case 'pump-letter': letter('P'); break;
      case 'pump-double': circ(r); FS(); B(); g.moveTo(-r * 0.7, -r * 0.45); g.lineTo(0, 0); g.lineTo(-r * 0.7, r * 0.45); g.closePath(); g.moveTo(0, -r * 0.45); g.lineTo(r * 0.7, 0); g.lineTo(0, r * 0.45); g.closePath(); Fc(); break;
      case 'pump-screw': B(); g.rect(-r * 1.2, -r * 0.6, r * 2.4, r * 1.2); FS(); B(); for (let i = -2; i <= 2; i++) { g.moveTo(i * r * 0.45 - r * 0.2, -r * 0.6); g.lineTo(i * r * 0.45 + r * 0.2, r * 0.6); } S(); break;
      // orifices
      case 'orifice': B(); g.rect(-r * 0.85, -r * 0.7, r * 1.7, r * 1.4); FS(); B(); g.moveTo(0, -r * 0.7); g.lineTo(0, r * 0.7); S(); break;
      case 'orifice-plate': B(); g.rect(-r * 0.25, -r * 1.1, r * 0.5, r * 0.75); g.rect(-r * 0.25, r * 0.35, r * 0.5, r * 0.75); g.fillStyle = color; g.fill(); g.stroke(); break;
      case 'orifice-hole': B(); g.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7); FS(); circ(r * 0.4); S(); break;
      case 'orifice-gate': B(); g.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7); FS(); B(); g.rect(-r * 0.3, -r * 0.85, r * 0.6, r * 1.05); Fc(); g.stroke(); break;
      case 'orifice-letter': letter('O'); break;
      // weirs
      case 'weir': B(); g.rect(-r, -r * 0.7, r * 2, r * 1.4); FS(); B(); g.moveTo(-r, 0); g.lineTo(r, 0); S(); break;
      case 'weir-v': B(); g.moveTo(-r, -r * 0.8); g.lineTo(0, r * 0.25); g.lineTo(r, -r * 0.8); g.lineTo(r, r * 0.8); g.lineTo(-r, r * 0.8); g.closePath(); FS(); break;
      case 'weir-rect': B(); g.moveTo(-r, -r * 0.8); g.lineTo(-r * 0.4, -r * 0.8); g.lineTo(-r * 0.4, 0); g.lineTo(r * 0.4, 0); g.lineTo(r * 0.4, -r * 0.8); g.lineTo(r, -r * 0.8); g.lineTo(r, r * 0.8); g.lineTo(-r, r * 0.8); g.closePath(); FS(); break;
      case 'weir-crest': B(); g.moveTo(-r * 1.1, r * 0.7); g.lineTo(-r * 0.5, -r * 0.5); g.lineTo(r * 0.5, -r * 0.5); g.lineTo(r * 1.1, r * 0.7); g.closePath(); FS(); break;
      case 'weir-step': B(); g.moveTo(-r, r * 0.7); g.lineTo(-r, -r * 0.6); g.lineTo(0, -r * 0.6); g.lineTo(0, 0); g.lineTo(r, 0); g.lineTo(r, r * 0.7); g.closePath(); FS(); break;
      case 'weir-letter': letter('W'); break;
      // outlets
      case 'outlet-xbox': B(); g.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6); FS(); B(); g.moveTo(-r * 0.8, -r * 0.8); g.lineTo(r * 0.8, r * 0.8); g.moveTo(r * 0.8, -r * 0.8); g.lineTo(-r * 0.8, r * 0.8); S(); break;
      case 'outlet-valve': B(); g.moveTo(-r, -r * 0.7); g.lineTo(r, r * 0.7); g.lineTo(r, -r * 0.7); g.lineTo(-r, r * 0.7); g.closePath(); FS(); B(); g.moveTo(0, 0); g.lineTo(0, -r); g.moveTo(-r * 0.4, -r); g.lineTo(r * 0.4, -r); S(); break;
      case 'outlet-flap': B(); g.moveTo(-r * 0.2, -r); g.lineTo(-r * 0.2, r); g.lineWidth *= 1.3; S(); B(); g.moveTo(-r * 0.2, -r); g.lineTo(r * 0.7, r * 0.6); g.lineTo(r * 0.3, r * 0.85); g.closePath(); FS(); break;
      case 'outlet-gate': B(); g.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6); FS(); B(); g.moveTo(0, -r * 1.25); g.lineTo(0, r * 0.25); g.lineWidth *= 1.6; S(); break;
      case 'outlet-letter': letter('U'); break;
      default: circ(r * 0.8); FS();
    }
    g.restore();
  };
  AV.midDefault = (type) => (AV.MID_STYLES[type] || AV.MID_STYLES.CONDUIT)[0][0];
  AV.lineDash = (style, w) => style === 'dash' ? [6 + w, 3 + w / 2] : style === 'dot' ? [1.5, 2 + w] : style === 'dashdot' ? [8, 3, 1.5, 3] : [];

  // small legend icon (canvas) for a layer
  AV.symIcon = function (app, type, ext) {
    const c = h('canvas', { class: 'symicon', width: 56, height: 32 }); const g = c.getContext('2d'); g.scale(2, 2);
    if (ext) {
      g.globalAlpha = ext.opacity === undefined ? 1 : ext.opacity;
      if (ext.raster) { const gr = g.createLinearGradient(2, 0, 26, 0); gr.addColorStop(0, '#2e7d32'); gr.addColorStop(0.5, '#fdd835'); gr.addColorStop(1, '#8d6e63'); g.fillStyle = gr; g.fillRect(3, 3, 22, 10); }
      else if (ext.kind === 'point') { g.fillStyle = ext.stroke; g.beginPath(); g.arc(14, 8, ext.ptSize || 3, 0, 7); g.fill(); }
      else if (ext.kind === 'polygon') { g.fillStyle = ext.fill; g.strokeStyle = ext.stroke; g.fillRect(4, 3, 20, 10); g.strokeRect(4.5, 3.5, 20, 10); }
      else { g.strokeStyle = ext.stroke; g.lineWidth = ext.width || 1; g.beginPath(); g.moveTo(3, 8); g.lineTo(25, 8); g.stroke(); }
      return c;
    }
    const s = AV.symOf(app, type); g.globalAlpha = s.opacity;
    if (NODE_T.includes(type)) { g.beginPath(); AV.nodeShape(g, s.shape, 14, 8, Math.min(6.5, s.size)); g.fillStyle = s.color; g.fill(); g.strokeStyle = s.stroke; g.lineWidth = 1; g.stroke(); }
    else if (type === 'SUBCATCH') { g.fillStyle = s.fill; g.fillRect(4, 2, 20, 12); g.strokeStyle = s.outline; g.lineWidth = s.width; g.strokeRect(4.5, 2.5, 20, 12); }
    else {
      g.strokeStyle = s.color; g.lineWidth = Math.min(4, s.width); g.setLineDash(AV.lineDash(s.style, 1)); g.beginPath(); g.moveTo(2, 8); g.lineTo(26, 8); g.stroke(); g.setLineDash([]);
      if (type !== 'CONDUIT' || s.arrows) { g.translate(14, 8); AV.drawMidSym(g, s.mid, s.color, s.midFill, 4.6); }
    }
    return c;
  };

  // ================================================================== right dock tabs
  AV.App.prototype.showRightTab = function (name) {
    this.rightTab = name;
    for (const t of ['props', 'catalog', 'sym', 'export']) { const p = AV.$('#rp-' + t); if (p) p.style.display = t === name ? 'flex' : 'none'; }
    AV.$$('#rightTabs .rt').forEach(e => e.classList.toggle('active', e.dataset.t === name));
    if (name === 'catalog' && this.catalog) this.catalog.show();
    if (name === 'export' && this.exporter) this.exporter.show();
  };

  // ================================================================== Layer View tree
  AV.Panels.prototype.refreshLayers = function () {
    const app = this.app, map = app.map, m = app.model; const el = AV.$('#layers'); if (!el) return; el.innerHTML = '';
    const open = (this.layerOpen = this.layerOpen || { net: true, nodes: true, links: true, ext: true, base: true });
    if (app.addMode) { open.net = open.nodes = open.links = true; }
    const counts = {}; if (m) { for (const n of m.nodes.values()) counts[n.type] = (counts[n.type] || 0) + 1; for (const l of m.links.values()) counts[l.type] = (counts[l.type] || 0) + 1; counts.SUBCATCH = m.subcatchments.size; }
    const tw = (key) => h('span', { class: 'ltw', onclick: (e) => { e.stopPropagation(); open[key] = !open[key]; this.refreshLayers(); } }, open[key] ? '▾' : '▸');
    const sp = () => h('span', { class: 'ltw' });
    const symBtn = (type, ext) => { const ic = AV.symIcon(app, type, ext); ic.title = 'Symbology'; ic.addEventListener('click', (e) => { e.stopPropagation(); app.symPane.open(ext ? { ext } : { type }); }); return ic; };
    const row = (depth, parts, opts = {}) => {
      const r = h('div', { class: 'lrow' + (opts.cls ? ' ' + opts.cls : '') + (opts.add && app.addMode ? ' addable' + (app.addType === opts.add ? ' adding' : '') : ''), style: { paddingLeft: (4 + depth * 14) + 'px' }, title: opts.add && app.addMode ? 'Click to add ' + (NAMES[opts.add] || 'labels') + ' on the map' : (opts.title || '') }, parts);
      if (opts.add) r.addEventListener('click', (e) => { if (app.addMode && e.target.tagName !== 'INPUT') app.pickAddType(opts.add); });
      if (opts.menu) r.addEventListener('contextmenu', (e) => { e.preventDefault(); app.contextMenu(e.clientX, e.clientY, opts.menu()); });
      if (opts.dbl) r.addEventListener('dblclick', opts.dbl);
      if (opts.drag) {
        r.draggable = true; r.classList.add('ldrag'); r.dataset.drag = opts.drag; r.title = (r.title ? r.title + '\n' : '') + 'Drag up or down to change the drawing order';
        r.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/osem-layer', opts.drag); e.dataTransfer.effectAllowed = 'move'; this._dragLayer = opts.drag; });
        r.addEventListener('dragover', (e) => { if (!this._dragLayer || this._dragLayer === opts.drag) return; e.preventDefault(); const b = r.getBoundingClientRect(); const after = e.clientY > b.top + b.height / 2; r.classList.toggle('dropafter', after); r.classList.toggle('dropbefore', !after); });
        r.addEventListener('dragleave', () => r.classList.remove('dropafter', 'dropbefore'));
        r.addEventListener('drop', (e) => { e.preventDefault(); r.classList.remove('dropafter', 'dropbefore'); const src = this._dragLayer; this._dragLayer = null; if (!src || src === opts.drag) return;
          const b = r.getBoundingClientRect(); const after = e.clientY > b.top + b.height / 2; const o = map.netOrder().filter(k => k !== src); o.splice(o.indexOf(opts.drag) + (after ? 1 : 0), 0, src);
          app.prefs.netOrder = o; app.savePrefs(); map.redraw(); this.refreshLayers(); });
        r.addEventListener('dragend', () => { this._dragLayer = null; });
      }
      el.appendChild(r); return r;
    };
    const chk = (val, fn) => h('input', { type: 'checkbox', checked: !!val, onclick: (e) => e.stopPropagation(), onchange: (e) => { fn(e.target.checked); map.redraw(); this.refreshLayers(); } });
    const objsOf = (type) => type === 'SUBCATCH' ? [...m.subcatchments.values()] : type === 'NODES' ? [...m.nodes.values()] : type === 'LINKS' ? [...m.links.values()] : NODE_T.includes(type) ? [...m.nodes.values()].filter(n => n.type === type) : [...m.links.values()].filter(l => l.type === type);
    // zoom to the selected objects of a layer (all selected objects for groups and background layers)
    const zoomSel = (type) => { const sel = [...app.selection]; const inLayer = type ? sel.filter(o => type === 'NODES' ? o.kind === 'NODE' : type === 'LINKS' ? o.kind === 'LINK' : type === 'SUBCATCH' ? o.kind === 'SUBCATCH' : o.type === type) : sel;
      if (!inLayer.length) { AV.toast(type ? 'No objects of this layer are selected.' : 'Nothing is selected.', true); return; } map.zoomToObjects(inLayer); };
    const ZS = (type) => ({ label: 'Zoom to Selection', fn: () => zoomSel(type) });
    const zoomTo = (type) => { const objs = objsOf(type); if (!objs.length) { AV.toast('This layer has no objects.', true); return; } map.zoomToObjects(objs); };
    const typeMenu = (type) => () => [{ label: 'Zoom to Layer', fn: () => zoomTo(type) }, ZS(type), '-', { label: 'Symbology...', fn: () => app.symPane.open({ type }) }, { label: 'Theme...', fn: () => app.theme.dialog(type === 'SUBCATCH' ? 'sub' : NODE_T.includes(type) ? 'node' : 'link') },
      { label: 'Attribute Table', fn: () => AV.openTable(app, type) }, { label: 'Select All ' + NAMES[type], fn: () => app.selectMany([...(type === 'SUBCATCH' ? m.subcatchments.values() : NODE_T.includes(type) ? [...m.nodes.values()].filter(n => n.type === type) : [...m.links.values()].filter(l => l.type === type))]) }];
    // ---- network
    row(0, [tw('net'), h('b', null, 'Network')], { cls: 'lgrp', menu: () => [{ label: 'Zoom to Layer', fn: () => map.zoomAll() }, ZS(null)] });
    if (open.net) {
      // first-level network layers in drawing order (top first); drag a row up or down to change it
      const NET = { nodes: () => {
      row(1, [tw('nodes'), chk(map.layerVis.nodes, v => map.layerVis.nodes = v), h('span', { class: 'lname' }, 'Nodes')], { drag: 'nodes', menu: () => [{ label: 'Zoom to Layer', fn: () => zoomTo('NODES') }, ZS('NODES')] });
      if (open.nodes) for (const t of NODE_T) { const s = AV.symOf(app, t); row(2, [sp(), chk(s.visible, v => { s.visible = v; app.savePrefs(); }), symBtn(t), h('span', { class: 'lname' }, NAMES[t]), h('span', { class: 'lcnt' }, String(counts[t] || 0))], { menu: typeMenu(t), dbl: () => app.symPane.open({ type: t }), add: t }); }
      }, links: () => {
      row(1, [tw('links'), chk(map.layerVis.links, v => map.layerVis.links = v), h('span', { class: 'lname' }, 'Links')], { drag: 'links', menu: () => [{ label: 'Zoom to Layer', fn: () => zoomTo('LINKS') }, ZS('LINKS')] });
      if (open.links) for (const t of LINK_T) { const s = AV.symOf(app, t); row(2, [sp(), chk(s.visible, v => { s.visible = v; app.savePrefs(); }), symBtn(t), h('span', { class: 'lname' }, NAMES[t]), h('span', { class: 'lcnt' }, String(counts[t] || 0))], { menu: typeMenu(t), dbl: () => app.symPane.open({ type: t }), add: t }); }
      }, subcatchments: () => {
      { const s = AV.symOf(app, 'SUBCATCH'); row(1, [sp(), chk(map.layerVis.subcatchments && s.visible, v => { map.layerVis.subcatchments = v; s.visible = v; app.savePrefs(); }), symBtn('SUBCATCH'), h('span', { class: 'lname' }, 'Subcatchments'), h('span', { class: 'lcnt' }, String(counts.SUBCATCH || 0))], { drag: 'subcatchments', menu: typeMenu('SUBCATCH'), dbl: () => app.symPane.open({ type: 'SUBCATCH' }), add: 'SUBCATCH' }); }
      }, mesh: () => {
      // 2D flood surface (2D module): drawn in the network order like nodes / links / subcatchments
      const mesh = app.mesh2d; const S = AV.meshStyle(app);
      const meshBox = () => { const c = mesh.cells; let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const q of c) { x1 = Math.min(x1, q.x - q.s / 2); y1 = Math.min(y1, q.y - q.s / 2); x2 = Math.max(x2, q.x + q.s / 2); y2 = Math.max(y2, q.y + q.s / 2); } return { x1, y1, x2, y2 }; };
      if (!mesh) { row(1, [sp(), h('span', { class: 'lwarn', onclick: () => AV.createMeshes(app) }, '2D Meshes: not created — click to Create Meshes')], { drag: 'mesh', menu: () => [{ label: 'Create Meshes', fn: () => AV.createMeshes(app) }, { label: '2D Flood Settings...', fn: () => app.sim.optionsDialog('2D Flood') }] }); return; }
      const ic = h('canvas', { class: 'symicon', width: 56, height: 32, title: 'Symbology' }); { const g = ic.getContext('2d'); g.scale(2, 2); const C = S.breaks ? [S.colors[0], S.colors[Math.floor(S.colors.length / 2)], S.colors[S.colors.length - 1]] : ['#2e7d32', '#fff176', '#bc8c5c']; for (let i = 0; i < 3; i++) { g.fillStyle = C[i]; g.fillRect(4 + i * 7, 3, 6, 10); } g.strokeStyle = '#78909c'; g.strokeRect(4.5, 3.5, 20, 10); }
      ic.addEventListener('click', (e) => { e.stopPropagation(); app.symPane.open({ mesh: true }); });
      row(1, [sp(), chk(S.visible, v => { app.prefs.mesh2d.visible = v; app.savePrefs(); }), ic, h('span', { class: 'lname', title: '2D flood surface, coloured by ' + AV.MESH_FIELDS[S.field] }, '2D Meshes'), h('span', { class: 'lcnt' }, String(mesh.cells.length))], {
        drag: 'mesh', dbl: () => app.symPane.open({ mesh: true }),
        menu: () => [{ label: 'Zoom to Layer', fn: () => map.zoomToBox(meshBox()) }, '-', { label: 'Attribute Table', fn: () => AV.meshTable(app) }, { label: 'Symbology...', fn: () => app.symPane.open({ mesh: true }) }, { label: '2D Flood Settings...', fn: () => app.sim.optionsDialog('2D Flood') },
          { label: 'Export as Shapefile...', fn: () => AV.exportMeshShapefile(app) }, '-', { label: 'Rebuild Meshes', fn: () => AV.createMeshes(app) },
          { label: 'Remove Meshes', fn: async () => { if (!await AV.confirm('Remove the 2D mesh of this model? The next run is then 1D only until the mesh is created again.', 'Remove Meshes', 'Remove')) return; app.mesh2d = null; app.meshResults = null; app.meshSel = -1; const mp = AV.meshPath(app); if (mp) { try { await window.host.writeText(mp, 'null'); } catch (e) { } } this.refreshLayers(); map.redraw(); } }] });
      } };
      const show2D = m && AV.has2D(app) && (app.mesh2d || AV.f2dEnabled(m));
      for (const k of map.netOrder()) if (k !== 'mesh' || show2D) NET[k]();
      row(1, [sp(), chk(map.layerVis.labels, v => map.layerVis.labels = v), h('span', { class: 'symicon txt' }, 'Aa'), h('span', { class: 'lname' }, 'Map Labels')], { add: 'LABEL', menu: () => [{ label: 'Zoom to Layer', fn: () => map.zoomAll() }, ZS('LABEL')] });
    }
    // ---- external layers
    if (map.extLayers.length) {
      row(0, [tw('ext'), h('b', null, 'Layers'), h('span', { class: 'lcnt' }, String(map.extLayers.length))], { cls: 'lgrp' });
      if (open.ext) map.extLayers.forEach((L, i) => {
        row(1, [sp(), chk(L.visible, v => L.visible = v), symBtn(null, L), h('span', { class: 'lname', title: L.path }, L.name), h('span', { class: 'lcnt' }, L.raster ? (L.w + '×' + L.h) : String(L.features.length))], {
          dbl: () => map.zoomToBox({ x1: L.bbox[0], y1: L.bbox[1], x2: L.bbox[2], y2: L.bbox[3] }),
          menu: () => [{ label: 'Zoom to Layer', fn: () => map.zoomToBox({ x1: L.bbox[0], y1: L.bbox[1], x2: L.bbox[2], y2: L.bbox[3] }) }, ZS(null), { label: 'Symbology...', fn: () => app.symPane.open({ ext: L }) },
            L.editable ? { label: 'Draw Features', fn: () => app.feat.startDraw(L) } : null, L.editable ? { label: 'Export as Shapefile...', fn: () => app.feat.exportLayer(L) } : null,
            !L.raster && L.features.length ? { label: 'Import into Network...', fn: () => app.tools.importNetwork(L.path) } : null,
            '-', { label: 'Move Up', fn: () => { if (i > 0) { map.extLayers.splice(i, 1); map.extLayers.splice(i - 1, 0, L); this.refreshLayers(); map.redraw(); } } },
            { label: 'Move Down', fn: () => { if (i < map.extLayers.length - 1) { map.extLayers.splice(i, 1); map.extLayers.splice(i + 1, 0, L); this.refreshLayers(); map.redraw(); } } },
            { label: 'Remove', fn: () => { map.extLayers.splice(i, 1); this.refreshLayers(); map.redraw(); } }].filter(Boolean),
        });
      });
    }
    // ---- basemap
    const bm = AV.basemapState(app);
    row(0, [tw('base'), h('b', null, 'Basemap')], { cls: 'lgrp' });
    if (open.base) {
      const src = AV.BASEMAPS[bm.src] || AV.BASEMAPS.otm;
      const r = row(1, [sp(), chk(bm.on, v => { bm.on = v; app.savePrefs(); }), h('span', { class: 'symicon bm', onclick: (e) => { e.stopPropagation(); app.symPane.open({ basemap: true }); }, title: 'Basemap settings' }), h('span', { class: 'lname' }, src.name)],
        { dbl: () => app.symPane.open({ basemap: true }), menu: () => Object.keys(AV.BASEMAPS).map(k => ({ label: (k === bm.src ? '● ' : '   ') + AV.BASEMAPS[k].name, fn: () => { bm.src = k; bm.on = true; app.savePrefs(); map.redraw(); this.refreshLayers(); } })).concat(['-', { label: 'Coordinate System...', fn: () => AV.chooseCRS(app) }]) });
      if (!app.crs) row(2, [h('span', { class: 'lwarn', onclick: () => AV.chooseCRS(app) }, '⚠ No coordinate system — click to set one')]);
    }
  };

  // ================================================================== Symbology pane
  class SymPane {
    constructor(app, host) { this.app = app; this.host = host; this.target = null; }
    open(t) { this.target = t; this.render(); this.app.showRightTab('sym'); }
    changed() { const a = this.app; clearTimeout(this._t); this._t = setTimeout(() => a.savePrefs(), 400); a.map.redraw(); a.panels.refreshLayers(); a.theme.updateLegend && a.theme.updateLegend(); this.drawPreview && this.drawPreview(); }
    render() {
      const app = this.app, H = this.host; H.innerHTML = '';
      const t = this.target;
      const title = t ? (t.type ? NAMES[t.type] : t.ext ? t.ext.name : t.mesh ? '2D Meshes' : 'Basemap') : '';
      H.appendChild(h('div', { class: 'ptitle' }, h('span', null, 'Symbology' + (title ? ' - ' + title : ''))));
      const body = h('div', { class: 'symbody' }); H.appendChild(body);
      if (!t) return;
      const form = h('div', { class: 'symform' }); body.appendChild(form);
      const sec = (txt) => form.appendChild(h('div', { class: 'symsec' }, txt));
      const rowE = (label, el) => form.appendChild(h('div', { class: 'symrow' }, h('label', null, label), el));
      const colour = (obj, k) => h('input', { type: 'color', value: AV.toHex(obj[k]), oninput: (e) => { obj[k] = e.target.value; this.changed(); } });
      const num = (obj, k, min, max, step) => { const r = h('input', { type: 'range', min, max, step, value: obj[k] }); const n = h('input', { type: 'number', min, max, step, value: obj[k], style: { width: '64px' } }); r.oninput = () => { obj[k] = +r.value; n.value = r.value; this.changed(); }; n.onchange = () => { obj[k] = Math.max(min, Math.min(max, +n.value || min)); r.value = obj[k]; this.changed(); }; return h('span', { class: 'symnum' }, r, n); };
      const opac = (obj, k) => { const r = h('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round((1 - obj[k]) * 100) }); const lab = h('span', { class: 'symv' }, Math.round((1 - obj[k]) * 100) + ' %'); r.oninput = () => { obj[k] = 1 - r.value / 100; lab.textContent = r.value + ' %'; this.changed(); }; return h('span', { class: 'symnum' }, r, lab); };
      const sel = (obj, k, opts) => { const s = h('select', { onchange: () => { obj[k] = s.value; this.changed(); } }, opts.map(([v, l]) => h('option', { value: v }, l))); s.value = obj[k]; return s; };
      const check = (obj, k, l) => h('label', { class: 'symchk' }, h('input', { type: 'checkbox', checked: !!obj[k], onchange: (e) => { obj[k] = e.target.checked; this.changed(); } }), ' ' + l);
      const pv = h('canvas', { class: 'sympv', width: 520, height: 160 });
      this.drawPreview = () => this.preview(pv);
      if (t.type) {
        const s = AV.symOf(app, t.type);
        if (NODE_T.includes(t.type)) {
          sec('Appearance');
          const shapes = h('div', { class: 'symshapes' }, AV.NODE_SHAPES.map(sh => { const c = h('canvas', { width: 52, height: 52, class: 'symshape' + (s.shape === sh ? ' sel' : ''), title: sh }); const g = c.getContext('2d'); g.scale(2, 2); g.beginPath(); AV.nodeShape(g, sh, 13, 13, 8); g.fillStyle = s.color; g.fill(); g.strokeStyle = s.stroke; g.stroke(); c.onclick = () => { s.shape = sh; this.changed(); this.render(); }; return c; }));
          rowE('Shape', shapes); rowE('Fill colour', colour(s, 'color')); rowE('Outline colour', colour(s, 'stroke')); rowE('Size (px)', num(s, 'size', 1, 20, 0.5)); rowE('Transparency', opac(s, 'opacity'));
        } else if (t.type === 'SUBCATCH') {
          sec('Appearance'); rowE('Fill colour', colour(s, 'fill')); rowE('Outline colour', colour(s, 'outline')); rowE('Outline width', num(s, 'width', 0, 6, 0.5)); rowE('Transparency', opac(s, 'opacity'));
        } else {
          sec('Appearance'); rowE('Colour', colour(s, 'color')); rowE('Line width', num(s, 'width', 0.5, 10, 0.5)); rowE('Line style', sel(s, 'style', [['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted'], ['dashdot', 'Dash-dot']]));
          rowE('Transparency', opac(s, 'opacity'));
          sec(t.type === 'CONDUIT' ? 'Flow direction symbol' : 'Middle symbol');
          rowE('', check(s, 'arrows', t.type === 'CONDUIT' ? 'Show flow direction symbol' : 'Show symbol at link middle'));
          const mids = h('div', { class: 'symshapes mids' }, AV.MID_STYLES[t.type].map(([k, l]) => { const c = h('canvas', { width: 64, height: 52, class: 'symshape' + (s.mid === k ? ' sel' : ''), title: l }); const g = c.getContext('2d'); g.scale(2, 2); g.strokeStyle = s.color; g.lineWidth = 1.5; g.beginPath(); g.moveTo(1, 13); g.lineTo(31, 13); g.stroke(); g.translate(16, 13); AV.drawMidSym(g, k, s.color, s.midFill, 7); c.onclick = () => { s.mid = k; s.arrows = k !== 'none'; this.changed(); this.render(); }; return c; }));
          rowE('Style', mids); rowE('', h('span', { class: 'symv' }, (AV.MID_STYLES[t.type].find(x => x[0] === s.mid) || ['', ''])[1]));
          rowE('Symbol size', num(s, 'midSize', 0.5, 3, 0.1)); rowE('Symbol fill', colour(s, 'midFill'));
        }
        rowE('', check(s, 'visible', 'Visible'));
        form.appendChild(h('div', { class: 'symbtns' }, h('button', { class: 'btn small', onclick: () => { app.prefs.sym[t.type] = Object.assign({}, DEF[t.type]); this.changed(); this.render(); } }, 'Reset to Default'),
          h('button', { class: 'btn small', onclick: () => AV.openTable(app, t.type) }, 'Attribute Table'), h('button', { class: 'btn small', onclick: () => app.theme.dialog(t.type === 'SUBCATCH' ? 'sub' : NODE_T.includes(t.type) ? 'node' : 'link') }, 'Theme...')));
      } else if (t.ext) {
        const L = t.ext;
        if (L.raster) {
          sec('Raster'); rowE('Transparency', opac(L, 'opacity')); if (L.stats) rowE('Colour ramp', AV.rampPicker(L.ramp || 'Terrain', false, (v) => { L.ramp = v; AV.renderRaster(L); this.changed(); }));
          rowE('Draw', sel(L, 'order', [['below', 'Below network'], ['above', 'Above network']]));
          if (L.stats) rowE('Values', h('span', { class: 'symv' }, AV.fmt(L.stats.min) + ' … ' + AV.fmt(L.stats.max)));
        } else {
          sec('Appearance');
          if (L.kind === 'point') { rowE('Colour', colour(L, 'stroke')); rowE('Size (px)', num(L, 'ptSize', 1, 15, 0.5)); }
          else { rowE('Line colour', colour(L, 'stroke')); rowE('Line width', num(L, 'width', 0.5, 10, 0.5)); }
          if (L.kind === 'polygon') { if (!/^#/.test(L.fill)) L.fill = AV.toHex(L.fill); rowE('Fill colour', colour(L, 'fill')); if (L.fillOpacity === undefined) L.fillOpacity = 0.25; rowE('Fill transparency', opac(L, 'fillOpacity')); }
          rowE('Layer transparency', opac(L, 'opacity')); rowE('Draw', sel(L, 'order', [['below', 'Below network'], ['above', 'Above network']]));
        }
        rowE('', check(L, 'visible', 'Visible'));
      } else if (t.mesh) {
        // 2D mesh flood map: variable, ranges with colours (theme style), ramp, transparency, outlines
        const P = app.prefs.mesh2d || (app.prefs.mesh2d = {}); if (P.outline === undefined) P.outline = true; if (P.visible === undefined) P.visible = true; if (P.opacity === undefined) P.opacity = 0.8;
        const S = AV.meshStyle(app); const F = S.field; const cont = !!AV.MESH_CONTINUOUS[F];
        const redraw = () => { app._meshRange = null; this.changed(); };
        sec('Display');
        const fSel = h('select', { onchange: () => { P.field = fSel.value; redraw(); this.render(); } }, [['Dynamic results (current time step)', ['depth', 'wse']], ['Statistic results (whole run)', ['maxdepth', 'tpond', 'trecede']], ['Static properties', ['elev']]].map(([g, ks]) => h('optgroup', { label: g }, ks.map(k => h('option', { value: k }, AV.MESH_FIELDS[k]))))); fSel.value = F;
        rowE('Variable', fSel);
        rowE('Transparency', opac(P, 'opacity')); rowE('', check(P, 'outline', 'Cell outlines')); rowE('', check(P, 'visible', 'Visible'));
        sec(cont ? 'Colour ramp (continuous)' : 'Ranges');
        const setRamp = (v) => { P.ramp = P.ramp || {}; P.ramp[F] = v; if (!cont) { const cls = (P.classes && P.classes[F]) || S.breaks.map(b => ({ v: b })); const c = AV.rampColors(v, cls.length, !!(P.invert && P.invert[F])); P.classes = P.classes || {}; P.classes[F] = cls.map((x, i) => ({ v: x.v, color: c[i] })); } redraw(); this.render(); };
        const ramp = AV.rampPicker(S.ramp, S.invert, setRamp);
        const inv = h('label', { class: 'symchk' }, h('input', { type: 'checkbox', checked: S.invert, onchange: (e) => { P.invert = P.invert || {}; P.invert[F] = e.target.checked; setRamp(S.ramp); } }), ' Invert ramp');
        rowE('Colour ramp', h('span', { class: 'symnum' }, ramp, inv));
        if (!cont) {
          const cls = () => { P.classes = P.classes || {}; if (!P.classes[F]) P.classes[F] = S.breaks.map((b, i) => ({ v: b, color: S.colors[i] })); return P.classes[F]; };
          const nIn = h('input', { type: 'number', min: 2, max: 12, value: S.breaks.length, style: { width: '56px' } });
          const auto = () => { const n = Math.max(2, Math.min(12, +nIn.value || 5)); let br;
            if (app.meshResults || F === 'elev') { const [a, b] = AV.meshRange(app, F); const lo = Math.max(a, 0) || 0, hi = b; if (isFinite(hi) && hi > lo) { const d0 = AV.meshDefaultBreaks(app, F)[0]; const st = (hi - Math.max(lo, d0)) / n; br = [...Array(n).keys()].map(i => +((Math.max(lo, d0)) + i * st).toPrecision(3)); } }
            if (!br) { const d = AV.meshDefaultBreaks(app, F); br = [...Array(n).keys()].map(i => i < d.length ? d[i] : +(d[d.length - 1] * Math.pow(2, i - d.length + 1)).toPrecision(3)); }
            const c = AV.rampColors(S.ramp, n, !!(P.invert && P.invert[F])); P.classes = P.classes || {}; P.classes[F] = br.map((v, i) => ({ v, color: c[i] })); redraw(); this.render(); };
          rowE('Ranges', h('span', { class: 'symnum' }, nIn, h('button', { class: 'btn small', title: 'Equal intervals from the first break to the largest value of the current results', onclick: auto }, 'Auto-Theme'),
            h('button', { class: 'btn small', title: 'Default classes', onclick: () => { if (P.classes) delete P.classes[F]; redraw(); this.render(); } }, 'Reset')));
          const tb = h('tbody'); const C = cls();
          C.forEach((r, i) => {
            const v = h('input', { type: 'number', step: 'any', value: r.v, style: { width: '80px' }, onchange: () => { const x = parseFloat(v.value); if (!isFinite(x)) { v.value = r.v; return; } r.v = x; C.sort((a, b) => a.v - b.v); redraw(); this.render(); } });
            const c = h('input', { type: 'color', value: AV.toHex(r.color), oninput: () => { r.color = c.value; redraw(); } });
            tb.appendChild(h('tr', null, h('td', null, '≥'), h('td', null, v), h('td', { class: 'symv' }, i < C.length - 1 ? '– ' + AV.fmt(C[i + 1].v) : 'and above'), h('td', null, c),
              h('td', null, C.length > 2 ? h('button', { class: 'btn small', title: 'Remove range', onclick: () => { C.splice(i, 1); redraw(); this.render(); } }, '−') : null)));
          });
          tb.appendChild(h('tr', null, h('td', { colspan: 5 }, h('button', { class: 'btn small', onclick: () => { const last = C[C.length - 1]; C.push({ v: +(last.v * 1.5 || 1).toPrecision(3), color: last.color }); redraw(); this.render(); } }, '+ Add range'))));
          form.appendChild(h('div', { class: 'symranges' }, h('table', null, tb)));
          form.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, 'Cells below the first value are left uncoloured (dry). ' + (F === 'tpond' ? 'Time Ponded counts the hours the depth is above the Flood Depth Threshold (Simulation Options → 2D Flood).' : F === 'depth' ? 'Depth follows the current time step: use Play to animate the flooding.' : '')));
        } else form.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, 'The ramp is stretched between the smallest and the largest value' + (F === 'wse' ? ' of the current time step.' : '.')));
        if (!app.meshResults && F !== 'elev') form.appendChild(h('div', { class: 'note', style: { color: 'var(--warn)' } }, 'This is a results field: it is shown after a 1D-2D run or when a .fout results file is loaded.'));
        return;
      } else if (t.basemap) {
        const bm = AV.basemapState(app);
        sec('Basemap'); rowE('Source', sel(bm, 'src', Object.keys(AV.BASEMAPS).map(k => [k, AV.BASEMAPS[k].name]))); rowE('Transparency', opac(bm, 'opacity')); rowE('', check(bm, 'on', 'Show basemap'));
        rowE('Coordinate system', h('span', null, h('span', { class: 'symv' }, app.crs ? (app.crsName || 'defined') : 'not set'), ' ', h('button', { class: 'btn small', onclick: () => AV.chooseCRS(app) }, 'Set...')));
        return;
      }
      sec('Preview'); form.appendChild(pv); this.drawPreview();
    }
    preview(c) {
      const app = this.app, t = this.target, g = c.getContext('2d'); g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, 260, 80); g.fillStyle = '#f7f9fa'; g.fillRect(0, 0, 260, 80);
      if (t.type) {
        const s = AV.symOf(app, t.type); g.globalAlpha = s.opacity;
        if (NODE_T.includes(t.type)) { for (const [x, y] of [[60, 40], [130, 40], [200, 40]]) { g.beginPath(); AV.nodeShape(g, s.shape, x, y, s.size); g.fillStyle = s.color; g.fill(); g.strokeStyle = s.stroke; g.lineWidth = 0.8; g.stroke(); } }
        else if (t.type === 'SUBCATCH') { g.beginPath(); g.moveTo(40, 15); g.lineTo(150, 10); g.lineTo(220, 40); g.lineTo(170, 70); g.lineTo(50, 65); g.closePath(); g.fillStyle = s.fill; g.fill(); g.strokeStyle = s.outline; g.lineWidth = s.width; if (s.width) g.stroke(); }
        else { g.strokeStyle = s.color; g.lineWidth = s.width; g.setLineDash(AV.lineDash(s.style, s.width)); g.beginPath(); g.moveTo(30, 55); g.lineTo(130, 25); g.lineTo(230, 50); g.stroke(); g.setLineDash([]); if (s.arrows) for (const [x, y, a] of [[80, 40, Math.atan2(-30, 100)], [180, 37.5, Math.atan2(25, 100)]]) { g.save(); g.translate(x, y); g.rotate(a); AV.drawMidSym(g, s.mid, s.color, s.midFill, 6 * (s.midSize || 1)); g.restore(); } }
      } else if (t.ext) {
        const L = t.ext; g.globalAlpha = L.opacity === undefined ? 1 : L.opacity;
        if (L.raster) { if (L.canvas) g.drawImage(L.canvas, 0, 0, L.canvas.width, L.canvas.height, 10, 5, 240, 70); }
        else if (L.kind === 'point') { g.fillStyle = L.stroke; for (const x of [60, 130, 200]) { g.beginPath(); g.arc(x, 40, L.ptSize || 3, 0, 7); g.fill(); } }
        else { g.beginPath(); g.moveTo(40, 15); g.lineTo(150, 10); g.lineTo(220, 40); g.lineTo(170, 70); g.lineTo(50, 65); if (L.kind === 'polygon') { g.closePath(); g.globalAlpha *= (L.fillOpacity === undefined ? 0.25 : L.fillOpacity); g.fillStyle = L.fill; g.fill(); g.globalAlpha = L.opacity === undefined ? 1 : L.opacity; } g.strokeStyle = L.stroke; g.lineWidth = L.width || 1; g.stroke(); }
      }
      g.globalAlpha = 1;
    }
  }
  AV.SymPane = SymPane;
  AV.toHex = (c) => { c = String(c || '#888888'); if (/^#[0-9a-f]{6}$/i.test(c)) return c; if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join(''); const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); if (m) return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join(''); return '#888888'; };
})(window.AV);
