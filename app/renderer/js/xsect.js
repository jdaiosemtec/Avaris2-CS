// Cross Section Editor (like the Avaris DS editor): pick the shape from a picture gallery, then enter its dimensions.
'use strict';
(function (AV) {
  const h = AV.h;
  // shape -> [label, [geom1..4 parameter specs]]; spec = [label, unitKind | 'curve' | 'transect' | 'street' | '']
  const SHAPES = {
    ARCH: ['Arch', [['Maximum Height', 'L'], ['Bottom Width', 'L']]],
    BASKETHANDLE: ['Baskethandle', [['Maximum Height', 'L']]],
    CATENARY: ['Catenary', [['Maximum Height', 'L']]],
    CIRCULAR: ['Circular', [['Maximum Height', 'L']]],
    RECT_CLOSED: ['Closed Rectangular', [['Maximum Height', 'L'], ['Bottom Width', 'L']]],
    CUSTOM: ['Custom', [['Maximum Height', 'L'], ['Shape Curve', 'curve']]],
    DUMMY: ['Dummy', []],
    EGG: ['Egg', [['Maximum Height', 'L']]],
    FILLED_CIRCULAR: ['Filled Circular', [['Maximum Height', 'L'], ['Filled Depth', 'L']]],
    FORCE_MAIN: ['Force Main', [['Maximum Height', 'L'], ['Roughness (C-factor or D-W ε)', '']]],
    GOTHIC: ['Gothic', [['Maximum Height', 'L']]],
    HORIZ_ELLIPSE: ['Horizontal Elliptical', [['Maximum Height', 'L'], ['Maximum Width', 'L']]],
    HORSESHOE: ['Horseshoe', [['Maximum Height', 'L']]],
    IRREGULAR: ['Irregular', [['Transect', 'transect']]],
    MODBASKETHANDLE: ['Modified Baskethandle', [['Maximum Height', 'L'], ['Bottom Width', 'L'], ['Top Radius', 'L']]],
    PARABOLIC: ['Parabolic', [['Maximum Height', 'L'], ['Top Width', 'L']]],
    POWER: ['Power', [['Maximum Height', 'L'], ['Top Width', 'L'], ['Exponent', '']]],
    RECT_OPEN: ['Rectangular', [['Maximum Height', 'L'], ['Bottom Width', 'L'], ['Sides in friction (0, 1, 2)', '']]],
    RECT_ROUND: ['Rectangular Round', [['Maximum Height', 'L'], ['Top Width', 'L'], ['Bottom Radius', 'L']]],
    RECT_TRIANGULAR: ['Rectangular Triangular', [['Maximum Height', 'L'], ['Top Width', 'L'], ['Triangle Height', 'L']]],
    SEMICIRCULAR: ['Semi-Circular', [['Maximum Height', 'L']]],
    SEMIELLIPTICAL: ['Semi-Elliptical', [['Maximum Height', 'L']]],
    TRAPEZOIDAL: ['Trapezoidal', [['Maximum Height', 'L'], ['Bottom Width', 'L'], ['Left Side Slope (run/rise)', ''], ['Right Side Slope (run/rise)', '']]],
    TRIANGULAR: ['Triangular', [['Maximum Height', 'L'], ['Top Width', 'L']]],
    VERT_ELLIPSE: ['Vertical Elliptical', [['Maximum Height', 'L'], ['Maximum Width', 'L']]],
    STREET: ['Street', [['Street Section', 'street']]],
  };
  AV.XS_INFO = SHAPES;

  // outline of each shape in a unit box (x 0..1 left→right, y 0 = top .. 1 = bottom); open = no top line
  function outline(sh) {
    const P = [], arc = (cx, cy, rx, ry, a0, a1, n = 24) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; P.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } };
    let open = false;
    switch (sh) {
      case 'CIRCULAR': case 'FORCE_MAIN': case 'FILLED_CIRCULAR': case 'CUSTOM': arc(0.5, 0.5, 0.5, 0.5, 0, 2 * Math.PI, 48); break;
      case 'RECT_CLOSED': P.push([0, 0], [1, 0], [1, 1], [0, 1]); break;
      case 'RECT_OPEN': open = true; P.push([0, 0], [0, 1], [1, 1], [1, 0]); break;
      case 'TRAPEZOIDAL': open = true; P.push([0, 0], [0.28, 1], [0.72, 1], [1, 0]); break;
      case 'TRIANGULAR': open = true; P.push([0.05, 0], [0.5, 1], [0.95, 0]); break;
      case 'PARABOLIC': open = true; for (let i = 0; i <= 24; i++) { const x = i / 24; P.push([0.05 + 0.9 * x, 1 - Math.pow(2 * x - 1, 2)]); } break;
      case 'POWER': open = true; for (let i = 0; i <= 24; i++) { const x = i / 24; P.push([0.1 + 0.8 * x, 1 - Math.pow(Math.abs(2 * x - 1), 0.6)]); } break;
      case 'HORIZ_ELLIPSE': arc(0.5, 0.5, 0.5, 0.33, 0, 2 * Math.PI, 48); break;
      case 'VERT_ELLIPSE': arc(0.5, 0.5, 0.33, 0.5, 0, 2 * Math.PI, 48); break;
      case 'ARCH': P.push([0.02, 1], [0.98, 1], [0.98, 0.45]); arc(0.5, 0.45, 0.48, 0.45, 0, -Math.PI); break;
      case 'RECT_TRIANGULAR': P.push([0.1, 0], [0.9, 0], [0.9, 0.6], [0.5, 1], [0.1, 0.6]); break;
      case 'RECT_ROUND': P.push([0.1, 0], [0.9, 0]); arc(0.5, 0.6, 0.4, 0.4, 0, Math.PI); break;
      case 'MODBASKETHANDLE': P.push([0.1, 1], [0.9, 1], [0.9, 0.4]); arc(0.5, 0.4, 0.4, 0.4, 0, -Math.PI); break;
      case 'BASKETHANDLE': arc(0.5, 0.42, 0.42, 0.42, Math.PI, 2 * Math.PI); P.push([0.92, 0.6]); arc(0.5, 0.6, 0.42, 0.4, 0, Math.PI); break;
      case 'EGG': arc(0.5, 0.35, 0.42, 0.35, Math.PI, 2 * Math.PI); arc(0.5, 0.35, 0.42, 0.65, 0, Math.PI); break;
      case 'HORSESHOE': arc(0.5, 0.5, 0.48, 0.5, Math.PI, 2 * Math.PI); P.push([0.98, 0.55], [0.9, 1], [0.1, 1], [0.02, 0.55]); break;
      case 'GOTHIC': P.push([0.5, 0]); arc(0.0, 0.55, 0.95, 0.55, -0.62, 0, 12); arc(0.5, 0.55, 0.45, 0.45, 0, Math.PI, 24); arc(1.0, 0.55, 0.95, 0.55, Math.PI, Math.PI + 0.62, 12); break;
      case 'CATENARY': P.push([0.08, 0.15], [0.92, 0.15]); arc(0.5, 0.35, 0.42, 0.65, 0, Math.PI); P.push([0.08, 0.15]); break;
      case 'SEMIELLIPTICAL': P.push([0.05, 0.05], [0.95, 0.05]); arc(0.5, 0.05, 0.45, 0.95, 0, Math.PI); break;
      case 'SEMICIRCULAR': P.push([0.02, 0.1], [0.98, 0.1]); arc(0.5, 0.1, 0.48, 0.9, 0, Math.PI); break;
      case 'IRREGULAR': open = true; P.push([0, 0], [0.12, 0.35], [0.3, 0.45], [0.4, 0.85], [0.5, 1], [0.62, 0.8], [0.72, 0.42], [0.9, 0.3], [1, 0]); break;
      case 'STREET': open = true; P.push([0, 0.3], [0.08, 0.55], [0.1, 0.85], [0.5, 0.75], [0.9, 0.85], [0.92, 0.55], [1, 0.3]); break;
      default: return null;
    }
    return { P, open };
  }
  AV.drawXS = function (c, sh, sel) {
    const g = c.getContext('2d'); const W = c.width, H = c.height; g.clearRect(0, 0, W, H);
    if (sh === 'DUMMY') { g.fillStyle = '#263238'; g.font = '28px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N/A', W / 2, H / 2); return; }
    const o = outline(sh); if (!o) return;
    const pad = 6, bw = W - 2 * pad, bh = H - 2 * pad; const X = (p) => pad + p[0] * bw, Y = (p) => pad + p[1] * bh;
    const path = () => { g.beginPath(); o.P.forEach((p, i) => i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))); if (!o.open) g.closePath(); };
    const wl = sh === 'FORCE_MAIN' ? 0 : 0.28; // water surface (fraction from top)
    g.save(); path(); if (o.open) g.closePath(); g.clip();
    g.fillStyle = sh === 'FORCE_MAIN' ? '#3d8fd1' : '#55a3dd'; g.fillRect(0, pad + wl * bh, W, H);
    if (sh === 'FILLED_CIRCULAR') { g.fillStyle = '#7b4a1e'; g.fillRect(0, pad + 0.78 * bh, W, H); }
    if (sh === 'CUSTOM') { g.strokeStyle = 'rgba(40,90,40,.6)'; g.lineWidth = 1; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(pad + i * bw / 6, pad); g.lineTo(pad + i * bw / 6, H - pad); g.moveTo(pad, pad + i * bh / 6); g.lineTo(W - pad, pad + i * bh / 6); g.stroke(); } }
    g.restore();
    path(); g.strokeStyle = '#1b2a33'; g.lineWidth = 1.6; g.stroke();
    if (sh !== 'FORCE_MAIN') { const y = pad + wl * bh; g.strokeStyle = '#1b2a33'; g.lineWidth = 1; g.beginPath(); g.moveTo(W * 0.5 - 4, y - 6); g.lineTo(W * 0.5 + 4, y - 6); g.lineTo(W * 0.5, y - 1); g.closePath(); g.fillStyle = '#1b2a33'; g.fill(); }
  };

  // edit the cross section of one or more links. Returns nothing; applies one undoable change.
  AV.crossSectionEditor = async function (app, objs) {
    const m = app.model; const o0 = objs[0]; const p0 = o0.p;
    const allowed = (AV.SCHEMA[o0.type].find(f => f.k === 'shape') || {}).o || Object.keys(SHAPES);
    let shape = allowed.includes(p0.shape) ? p0.shape : allowed[0];
    const vals = { g1: p0.g1, g2: p0.g2, g3: p0.g3, g4: p0.g4 };
    const unit = AV.unitText(m, 'L');
    const params = h('div', { class: 'xsparams' });
    const tiles = new Map();
    const order = Object.keys(SHAPES).filter(k => allowed.includes(k)).sort((a, b) => SHAPES[a][0].localeCompare(SHAPES[b][0]));
    const gallery = h('div', { class: 'xsgal' }, order.map(k => { const c = h('canvas', { width: 104, height: 80 }); AV.drawXS(c, k); const t = h('div', { class: 'xstile' + (k === shape ? ' sel' : ''), onclick: () => { shape = k; tiles.forEach((el, kk) => el.classList.toggle('sel', kk === k)); renderParams(); } }, c, h('div', { class: 'xsname' }, SHAPES[k][0])); tiles.set(k, t); return t; }));
    const listOf = (kind) => kind === 'curve' ? [...m.curves.keys()] : kind === 'transect' ? (m.raw.TRANSECTS || []).map(l => AV.tokenize(l)).filter(t => t[0] && t[0].toUpperCase() === 'X1').map(t => t[1]) : kind === 'street' ? (m.raw.STREETS || []).map(l => AV.tokenize(l)[0]).filter(Boolean) : [];
    function renderParams() {
      params.innerHTML = '';
      params.appendChild(h('div', { class: 'xsh' }, 'Parameters'));
      const spec = SHAPES[shape][1];
      if (!spec.length) params.appendChild(h('div', { class: 'xsnote' }, 'A dummy link has no cross section (used for pumps, ideal connections).'));
      spec.forEach(([lab, kind], i) => {
        const k = 'g' + (i + 1);
        if (k === 'g2' && shape === 'CUSTOM' && vals[k] && !isNaN(+vals[k])) vals[k] = '';
        let inp;
        if (kind === 'curve' || kind === 'transect' || kind === 'street') {
          const names = listOf(kind); if (vals[k] && !names.includes(vals[k])) names.unshift(vals[k]);
          inp = h('select', { onchange: () => { vals[k] = inp.value; } }, [h('option', { value: '' }, '(choose)')].concat(names.map(n => h('option', { value: n }, n)))); inp.value = vals[k] || '';
        } else inp = h('input', { type: 'text', value: vals[k] === undefined || vals[k] === null ? '' : String(vals[k]), oninput: () => { vals[k] = inp.value.trim(); } });
        params.append(h('div', { class: 'xslab' }, lab + (kind === 'L' ? ' (' + unit + ')' : '')), inp);
      });
      if (o0.type === 'CONDUIT' && shape !== 'DUMMY') params.appendChild(h('div', { class: 'xsnote' }, 'Barrels and culvert code are edited in the property grid.'));
    }
    renderParams();
    const body = h('div', { class: 'xsed' }, gallery, params);
    const dlg = AV.modal({ title: 'Cross Section Editor', width: 900, body, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => {
      const spec = SHAPES[shape][1];
      for (let i = 0; i < spec.length; i++) { const k = 'g' + (i + 1), kind = spec[i][1], v = vals[k];
        if (kind === 'L' || kind === '') { const x = parseFloat(v); if (i === 0 ? !(x > 0) : (v !== '' && v !== undefined && !(x >= 0))) { AV.toast(spec[i][0] + (i === 0 ? ' must be a positive number.' : ' must be a number ≥ 0.'), true); return false; } }
        else if (!v) { AV.toast('Choose the ' + spec[i][0].toLowerCase() + '.', true); return false; } }
      return true; } }] });
    const ok = await dlg.done; if (!ok) return;
    const spec = SHAPES[shape][1];
    const nw = { shape }; for (let i = 0; i < 4; i++) { const k = 'g' + (i + 1); nw[k] = i < spec.length ? (spec[i][1] === 'L' || spec[i][1] === '' ? (vals[k] === '' || vals[k] === undefined ? '0' : String(+vals[k])) : vals[k]) : (shape === 'CUSTOM' || shape === 'IRREGULAR' || shape === 'STREET' ? '' : '0'); }
    const changes = []; const olds = objs.map(o => ({ shape: o.p.shape, g1: o.p.g1, g2: o.p.g2, g3: o.p.g3, g4: o.p.g4 }));
    objs.forEach((o, i) => { for (const k in nw) if (String(olds[i][k]) !== String(nw[k])) changes.push({ o, key: k, old: olds[i][k], nw: nw[k] }); });
    if (!changes.length) return;
    app.exec({ label: 'Edit cross section', light: true, noGeom: true, changes, do: () => objs.forEach(o => Object.assign(o.p, nw)), undo: () => objs.forEach((o, i) => Object.assign(o.p, olds[i])) });
  };
})(window.AV);
