// Schematic cross sections of the LID control types (shown in the LID Control Editor next to the type choice)
'use strict';
(function (AV) {
  const C = { water: '#90caf9', water2: '#64b5f6', soil: '#a1887f', soilDk: '#8d6e63', native: '#d7ccc8', gravel: '#cfd8dc', stone: '#90a4ae', plant: '#43a047', plantDk: '#2e7d32', pave: '#78909c', roof: '#b0bec5', line: '#455a64', pipe: '#eceff1', text: '#263238' };
  const T = (x, y, s, a) => `<text x="${x}" y="${y}" font-size="10.5" fill="${C.text}" font-family="Segoe UI,Arial" ${a === 'e' ? 'text-anchor="end"' : a === 'm' ? 'text-anchor="middle"' : ''}>${s}</text>`;
  const R = (x, y, w, hh, f, extra) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="${f}" stroke="${C.line}" stroke-width="0.8" ${extra || ''}/>`;
  const gravel = (x, y, w, hh) => { let s = R(x, y, w, hh, C.gravel); for (let i = 0; i < w * hh / 90; i++) { const px = x + 4 + ((i * 37) % (w - 8)), py = y + 4 + ((i * 53) % Math.max(1, hh - 8)); s += `<circle cx="${px}" cy="${py}" r="${2 + (i % 3)}" fill="${C.stone}"/>`; } return s; };
  const plants = (x1, x2, y, step) => { let s = ''; for (let x = x1; x <= x2; x += step || 18) s += `<path d="M${x} ${y} q-5 -12 -9 -14 M${x} ${y} q0 -14 1 -18 M${x} ${y} q5 -12 9 -14" stroke="${C.plant}" stroke-width="2" fill="none"/>`; return s; };
  const drain = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="7" fill="${C.pipe}" stroke="${C.line}" stroke-width="1.2"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="${C.water2}"/>`;
  const arrow = (x1, y1, x2, y2, col) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${col || C.water2}" stroke-width="2" marker-end="url(#ah)"/>`;
  const rain = (x1, x2, y) => { let s = ''; for (let x = x1; x <= x2; x += 22) s += `<path d="M${x} ${y} l-4 9" stroke="${C.water2}" stroke-width="1.6"/>`; return s; };
  const wrap = (body) => `<svg viewBox="0 0 320 175" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="${C.water2}"/></marker></defs>${body}</svg>`;
  const SK = {
    BC: () => wrap(rain(70, 230, 4) + R(10, 52, 300, 115, C.native) + `<path d="M40 40 L60 52 L260 52 L280 40" fill="none" stroke="${C.line}" stroke-width="1"/>` + R(60, 44, 200, 8, C.water, 'opacity="0.8"') + plants(75, 245, 52, 20) +
      R(60, 52, 200, 40, C.soil) + gravel(60, 92, 200, 50) + drain(160, 130) + T(305, 49, 'Surface', 'e') + T(305, 76, 'Soil', 'e') + T(305, 117, 'Storage', 'e') + T(175, 152, 'Drain') + T(14, 160, 'Native soil')),
    RG: () => wrap(rain(70, 230, 4) + R(10, 52, 300, 115, C.native) + `<path d="M40 40 L60 52 L260 52 L280 40" fill="none" stroke="${C.line}" stroke-width="1"/>` + R(60, 44, 200, 8, C.water, 'opacity="0.8"') + plants(75, 245, 52, 20) +
      R(60, 52, 200, 55, C.soil) + T(305, 49, 'Surface', 'e') + T(305, 84, 'Soil', 'e') + T(14, 160, 'Native soil (infiltration)') + arrow(160, 112, 160, 140)),
    GR: () => wrap(rain(60, 260, 4) + R(10, 128, 240, 22, C.roof) + T(130, 143, 'Roof deck', 'm') + R(20, 108, 220, 20, '#eceff1') + `<path d="M20 118 h220" stroke="${C.stone}" stroke-dasharray="5 4"/>` +
      R(20, 66, 220, 42, C.soil) + plants(35, 230, 66, 18) + T(305, 60, 'Surface', 'e') + T(305, 90, 'Soil', 'e') + T(305, 122, 'Drainage mat', 'e') + arrow(240, 118, 256, 118)),
    IT: () => wrap(rain(70, 230, 4) + R(10, 52, 300, 115, C.native) + arrow(20, 46, 58, 52) + gravel(70, 52, 180, 95) + drain(160, 132) + T(305, 49, 'Surface', 'e') + T(305, 100, 'Storage', 'e') + T(175, 156, 'Drain') + T(14, 160, 'Native soil')),
    PP: () => wrap(rain(70, 230, 4) + R(10, 52, 300, 115, C.native) + (() => { let s = ''; for (let x = 30; x < 230; x += 24) s += R(x, 40, 22, 14, C.pave); return s; })() + R(30, 54, 218, 18, '#bcaaa4') + gravel(30, 72, 218, 70) + drain(140, 128) +
      T(305, 50, 'Pavement', 'e') + T(305, 66, 'Soil', 'e') + T(305, 105, 'Storage', 'e') + T(155, 152, 'Drain') + T(14, 160, 'Native soil')),
    RB: () => wrap(rain(20, 140, 4) + `<path d="M10 40 L80 18 L150 40" fill="${C.roof}" stroke="${C.line}"/>` + R(20, 40, 120, 115, '#eceff1') + `<path d="M148 42 h20 v40" fill="none" stroke="${C.line}" stroke-width="4"/>` +
      `<rect x="150" y="82" width="70" height="78" rx="8" fill="#fff" stroke="${C.line}" stroke-width="1.2"/>` + R(150, 112, 70, 48, C.water, 'rx="6" opacity="0.85"') + `<path d="M220 150 h22" stroke="${C.line}" stroke-width="4"/>` + arrow(244, 150, 290, 150) +
      T(225, 100, 'Storage') + T(250, 142, 'Drain') + R(10, 160, 300, 10, C.native)),
    RD: () => wrap(rain(20, 140, 4) + `<path d="M10 40 L80 18 L150 40" fill="${C.roof}" stroke="${C.line}"/>` + R(20, 40, 120, 110, '#eceff1') + `<path d="M148 42 h20 v95 h14" fill="none" stroke="${C.line}" stroke-width="4"/>` + arrow(184, 142, 220, 146) +
      R(10, 150, 300, 20, C.native) + `<rect x="150" y="146" width="160" height="6" fill="${C.plant}"/>` + plants(195, 300, 150, 16) + T(238, 136, 'Pervious area') + T(56, 100, 'Roof') + T(172, 72, 'Downspout')),
    VS: () => wrap(rain(60, 260, 4) + `<path d="M10 40 L100 130 L220 130 L310 40 L310 170 L10 170 Z" fill="${C.native}" stroke="${C.line}"/>` + `<path d="M64 94 L100 130 L220 130 L256 94 Z" fill="${C.water}" opacity="0.85"/>` +
      `<path d="M10 40 L100 130 L220 130 L310 40" fill="none" stroke="${C.plantDk}" stroke-width="3"/>` + plants(30, 90, 60, 20).replace(/stroke-width="2"/g, 'stroke-width="1.5"') + plants(240, 300, 60, 20).replace(/stroke-width="2"/g, 'stroke-width="1.5"') +
      T(160, 116, 'Surface (swale)', 'm') + T(232, 150, 'side slope') + `<path d="M256 94 h40" stroke="${C.line}" stroke-dasharray="3 3"/>` + T(298, 90, 'Berm', 'e')),
  };
  AV.lidSketch = (type) => (SK[type] || SK.BC)();
})(window.AV);
