// Shared UI helpers: DOM builder, dialogs, formatting, colors, dates
'use strict';
window.AV = window.AV || {};
(function (AV) {
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    return el;
  };
  AV.h = h;
  AV.$ = (s, r) => (r || document).querySelector(s);
  AV.$$ = (s, r) => [...(r || document).querySelectorAll(s)];

  const ICONS = {
    new: 'M5 2h9l5 5v15H5z M14 2v5h5', open: 'M3 6h6l2 2h10v11H3z', save: 'M4 3h13l3 3v15H4z M7 3v6h9V3 M7 21v-7h10v7',
    undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 010 12h-3', redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 000 12h3',
    select: 'M5 3l13 8-6 1.5L9 19z', pan: 'M12 2v20 M2 12h20 M12 2l-3 3 M12 2l3 3 M12 22l-3-3 M12 22l3-3 M2 12l3-3 M2 12l3 3 M22 12l-3-3 M22 12l-3 3',
    zoomin: 'M10 4a6 6 0 110 12 6 6 0 010-12z M15 15l6 6 M7 10h6 M10 7v6', zoomout: 'M10 4a6 6 0 110 12 6 6 0 010-12z M15 15l6 6 M7 10h6',
    full: 'M3 9V3h6 M21 9V3h-6 M3 15v6h6 M21 15v6h-6', junction: 'M12 7a5 5 0 110 10 5 5 0 010-10z',
    outfall: 'M5 6l7 12 7-12z', storage: 'M4 6h16v12H4z M4 10h16', divider: 'M12 4l8 8-8 8-8-8z',
    conduit: 'M3 19L21 5 M3 19a2 2 0 100 .1 M21 5a2 2 0 100 .1', pump: 'M12 5a7 7 0 110 14 7 7 0 010-14z M9 9l6 3-6 3z',
    orifice: 'M4 12h16 M9 7h6v10H9z', weir: 'M3 18h18 M7 18V9h10v9', outlet: 'M4 12h10 M14 7l6 5-6 5z',
    subcatch: 'M4 5l9-2 7 6-3 11-11-2z', gage: 'M7 15a5 5 0 1110 0 M12 3v4 M6 21l2-3 M12 21v-3 M18 21l-2-3', label: 'M5 5h14 M12 5v14',
    del: 'M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13', vertex: 'M4 20L10 8l10 4 M10 8a1.6 1.6 0 100 .1',
    up: 'M12 20V5 M6 11l6-6 6 6', down: 'M12 4v15 M6 13l6 6 6-6', path: 'M5 19c4 0 4-14 8-14s4 14 8 14 M5 19a1.5 1.5 0 100 .1',
    table: 'M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14', options: 'M12 8a4 4 0 110 8 4 4 0 010-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
    run: 'M7 4l13 8-13 8z', report: 'M6 2h9l4 4v16H6z M9 10h7 M9 14h7 M9 18h4', plot: 'M3 20h18 M3 20V4 M6 16l4-6 4 3 6-8',
    profile: 'M2 18h20 M3 14l6-3 6 2 6-5 M3 14v4 M9 11v7 M15 13v5 M21 8v10', play: 'M7 4l13 8-13 8z', pause: 'M7 4h3v16H7z M14 4h3v16h-3z',
    theme: 'M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-1-2 0-3 3 0 4 0 3-1 3-4a9 9 0 00-9-9z M7.5 11a1 1 0 100 .1 M10 7a1 1 0 100 .1 M15 7.5a1 1 0 100 .1',
    layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5', find: 'M10 4a6 6 0 110 12 6 6 0 010-12z M15 15l6 6', validate: 'M5 12l5 5 9-10',
    stop: 'M6 6h12v12H6z', rain: 'M8 13a4 4 0 01.5-8 5 5 0 019.5 2 3 3 0 01-1 6z M8 17l-1 3 M12 17l-1 3 M16 17l-1 3',
    user: 'M12 4a4 4 0 110 8 4 4 0 010-8z M4 21c0-4 4-6 8-6s8 2 8 6', history: 'M4 12a8 8 0 108-8 8 8 0 00-6 2.7 M4 4v4h4 M12 8v4l3 2',
    convert: 'M4 8h13l-3-3 M20 16H7l3 3', partition: 'M3 4h8v7H3z M13 4h8v7h-8z M3 13h8v7H3z M13 13h8v7h-8z', regen: 'M20 8a8.5 8.5 0 1 0 1 7 M21 3v5h-5', measure: 'M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2',
  };
  AV.icon = (name) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name] || ICONS.select); svg.appendChild(p);
    return svg;
  };

  // ---------------------------------------------------------- dialogs
  AV.modal = function (opts) {
    const back = h('div', { class: 'modal-back' });
    const body = h('div', { class: 'mb' }, opts.body);
    const foot = h('div', { class: 'mf' });
    const box = h('div', { class: 'modal', style: { width: opts.width ? opts.width + 'px' : undefined } },
      h('div', { class: 'mh' }, h('span', null, opts.title || ''), h('button', { class: 'x', onclick: () => close(null) }, '×')), body, foot);
    back.appendChild(box);
    let resolveFn; const done = new Promise(r => resolveFn = r);
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolveFn(v); if (opts.onClose) opts.onClose(v); };
    for (const b of (opts.buttons || [{ label: 'OK', primary: true }])) {
      foot.appendChild(h('button', {
        class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: async () => {
          if (b.onClick) { const r = await b.onClick(); if (r === false) return; close(r === undefined ? b.value : r); } else close(b.value);
        }
      }, b.label));
    }
    if (opts.noFooter) foot.remove();
    const onKey = (e) => {
      const all = document.querySelectorAll('.modal-back'); if (all.length && all[all.length - 1] !== back) return; // only the top dialog reacts
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && opts.enterSubmits !== false && e.target.tagName !== 'TEXTAREA') { const pb = foot.querySelector('.btn.primary'); if (pb) { e.preventDefault(); pb.click(); } }
    };
    document.addEventListener('keydown', onKey, true);
    // dragging
    const head = box.querySelector('.mh');
    head.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = box.getBoundingClientRect(); const ox = e.clientX - r.left, oy = e.clientY - r.top;
      box.style.position = 'fixed';
      const mv = (ev) => { box.style.left = (ev.clientX - ox) + 'px'; box.style.top = (ev.clientY - oy) + 'px'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    document.body.appendChild(back);
    setTimeout(() => { const f = body.querySelector('input,select,textarea'); if (f && opts.autofocus !== false) f.focus(); }, 30);
    return { el: box, body, close, done };
  };
  AV.alert = (msg, title) => AV.modal({ title: title || 'Avaris2 CS', body: h('div', { style: { whiteSpace: 'pre-wrap', maxWidth: '560px', lineHeight: 1.5 } }, msg), buttons: [{ label: 'OK', primary: true, value: true }] }).done;
  AV.confirm = (msg, title, yes = 'OK', no = 'Cancel') => AV.modal({ title: title || 'Confirm', body: h('div', { style: { whiteSpace: 'pre-wrap', maxWidth: '520px', lineHeight: 1.5 } }, msg), buttons: [{ label: no, value: false }, { label: yes, primary: true, value: true }] }).done.then(v => !!v);
  AV.prompt = (title, label, value) => {
    const inp = h('input', { type: 'text', value: value || '', style: { width: '320px' } });
    return AV.modal({ title, body: h('div', { class: 'form' }, h('label', null, label), inp), buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => inp.value }] }).done;
  };
  AV.toast = (msg, err, ms) => {
    const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg); document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || (err ? 5000 : 2600));
  };

  // generic form dialog: fields [{k,l,t:'num'|'text'|'choice'|'check'|'textarea'|'h'|'note', o, d, w}]
  AV.formDialog = function (title, fields, values, opts = {}) {
    const vals = Object.assign({}, values || {});
    const inputs = {};
    const form = h('div', { class: 'form' });
    for (const f of fields) {
      if (f.t === 'h') { form.appendChild(h('h4', null, f.l)); continue; }
      if (f.t === 'note') { form.appendChild(h('div', { class: 'note' }, f.l)); continue; }
      const v = vals[f.k] !== undefined ? vals[f.k] : f.d;
      let inp;
      if (f.t === 'choice') { inp = h('select', null, (f.o || []).map(o => Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))); inp.value = v === undefined ? '' : v; }
      else if (f.t === 'check') inp = h('input', { type: 'checkbox', checked: !!v });
      else if (f.t === 'textarea') inp = h('textarea', { rows: f.rows || 6, style: { width: '100%', fontFamily: 'var(--mono)' } }, v || '');
      else inp = h('input', { type: f.t === 'num' ? 'number' : 'text', step: 'any', value: v === undefined ? '' : v, style: { width: (f.w || 180) + 'px' } });
      inputs[f.k] = inp;
      if (f.t === 'textarea') { form.appendChild(h('label', { class: 'full' }, f.l)); inp.classList.add('full'); form.appendChild(inp); }
      else { form.appendChild(h('label', null, f.l)); form.appendChild(inp); }
      if (f.note) form.appendChild(h('div', { class: 'note' }, f.note));
    }
    if (opts.extra) form.appendChild(opts.extra);
    const read = () => {
      const out = Object.assign({}, vals);
      for (const f of fields) {
        const inp = inputs[f.k]; if (!inp) continue;
        if (f.t === 'check') out[f.k] = inp.checked;
        else if (f.t === 'num') { const x = parseFloat(inp.value); out[f.k] = isFinite(x) ? x : (f.d !== undefined ? f.d : 0); }
        else out[f.k] = inp.value;
      }
      return out;
    };
    return AV.modal({
      title, width: opts.width, body: form,
      buttons: [{ label: 'Cancel', value: null }, { label: opts.okLabel || 'OK', primary: true, onClick: () => { const r = read(); if (opts.validate) { const e = opts.validate(r); if (e) { AV.toast(e, true); return false; } } return r; } }]
    }).done;
  };

  // ---------------------------------------------------------- formatting
  AV.fmt = (v, d) => {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v !== 'number') { const x = parseFloat(v); if (!isFinite(x) || String(x) !== String(v).trim()) return String(v); v = x; }
    if (!isFinite(v)) return '';
    if (d === undefined) { const a = Math.abs(v); d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : 4; }
    return v.toFixed(d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  };
  // ---------------------------------------------------------- dates (SWMM: days since 12/30/1899)
  const EPOCH = Date.UTC(1899, 11, 30);
  AV.swmmToDate = (d) => new Date(EPOCH + Math.round(d * 86400000));
  AV.fmtDateTime = (d) => {
    const t = d instanceof Date ? d : AV.swmmToDate(d);
    const p = (n) => String(n).padStart(2, '0');
    return p(t.getUTCMonth() + 1) + '/' + p(t.getUTCDate()) + '/' + t.getUTCFullYear() + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds());
  };
  AV.parseSwmmDate = (ds, ts) => {
    const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec((ds || '').trim());
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    const t = (ts || '0:00').split(':').map(Number);
    return (Date.UTC(y, +m[1] - 1, +m[2], t[0] || 0, t[1] || 0, t[2] || 0) - EPOCH) / 86400000;
  };
  AV.hmsToSec = (s) => { const t = String(s || '0').split(':').map(Number); if (t.length === 1) return (t[0] || 0) * 3600; return (t[0] || 0) * 3600 + (t[1] || 0) * 60 + (t[2] || 0); };
  AV.secToHms = (s) => { s = Math.round(s); const p = (n) => String(n).padStart(2, '0'); return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s % 3600 / 60)) + ':' + p(s % 60); };

  // ---------------------------------------------------------- color ramps
  AV.RAMPS = {
    'Blue-Red': ['#2c7bb6', '#00a6ca', '#00ccbc', '#90eb9d', '#ffff8c', '#f9d057', '#f29e2e', '#e76818', '#d7191c'],
    'Viridis': ['#440154', '#472c7a', '#3b518b', '#2c718e', '#21908d', '#27ad81', '#5cc863', '#aadc32', '#fde725'],
    'Green-Red': ['#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027'],
    'Blues': ['#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
    'Spectral': ['#5e4fa2', '#3288bd', '#66c2a5', '#abdda4', '#e6f598', '#fee08b', '#fdae61', '#f46d43', '#d53e4f', '#9e0142'],
    'Plasma': ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
    'Inferno': ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'],
    'Magma': ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#feca8d', '#fcfdbf'],
    'Cividis': ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838'],
    'Turbo': ['#30123b', '#4662d7', '#36aaf9', '#1ae4b6', '#72fe5e', '#c8ef34', '#faba39', '#f66b19', '#ca2a04', '#7a0403'],
    'Rainbow': ['#6e40aa', '#4c6edb', '#23abd8', '#1ddfa3', '#52f667', '#aff05b', '#e2b72f', '#ff7847', '#fe4b83', '#be3caf'],
    'Red-Yellow-Green': ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
    'Red-Blue': ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061'],
    'Cool-Warm': ['#3b4cc0', '#6788ee', '#9abbff', '#c9d7f0', '#edd1c2', '#f7a889', '#e26952', '#b40426'],
    'Pink-Green': ['#8e0152', '#c51b7d', '#de77ae', '#f1b6da', '#fde0ef', '#e6f5d0', '#b8e186', '#7fbc41', '#4d9221', '#276419'],
    'Brown-Teal': ['#543005', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30'],
    'Yellow-Orange-Red': ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
    'Yellow-Green-Blue': ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494', '#081d58'],
    'Greens': ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
    'Reds': ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'],
    'Oranges': ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704'],
    'Purples': ['#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d'],
    'Greys': ['#ffffff', '#f0f0f0', '#d9d9d9', '#bdbdbd', '#969696', '#737373', '#525252', '#252525', '#000000'],
    'Blue-Cyan-Yellow-Red': ['#0000ff', '#00a0ff', '#00ffff', '#80ff80', '#ffff00', '#ff8000', '#ff0000'],
  };
  // gradient picker: a dropdown that shows the colour ramps themselves instead of their names
  AV.rampPicker = function (value, invert, onChange) {
    const grad = (name) => 'linear-gradient(90deg,' + AV.RAMPS[name].join(',') + ')';
    let cur = AV.RAMPS[value] ? value : 'Blue-Red';
    const sw = AV.h('span', { class: 'rp-sw' }); const btn = AV.h('div', { class: 'rp-btn', title: cur, tabindex: 0 }, sw, AV.h('span', { class: 'rp-caret' }, '▾'));
    const show = () => { sw.style.background = grad(cur); sw.style.transform = invert ? 'scaleX(-1)' : ''; btn.title = cur; };
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); const old = document.querySelector('.rp-pop'); if (old) { old.remove(); return; }
      const r = btn.getBoundingClientRect();
      const pop = AV.h('div', { class: 'rp-pop', style: { left: r.left + 'px', top: (r.bottom + 2) + 'px', width: Math.max(220, r.width) + 'px' } },
        Object.keys(AV.RAMPS).map(n => AV.h('div', { class: 'rp-item' + (n === cur ? ' sel' : ''), title: n, onclick: () => { cur = n; show(); pop.remove(); onChange(n); } }, AV.h('span', { class: 'rp-sw', style: { background: grad(n) } }))));
      document.body.appendChild(pop);
      const pr = pop.getBoundingClientRect(); if (pr.bottom > window.innerHeight - 4) pop.style.top = Math.max(4, r.top - pr.height - 2) + 'px';
      setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }), 0);
    });
    show(); btn.setInvert = (v) => { invert = v; show(); };
    return btn;
  };
  const hex2rgb = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  AV.rampColors = (name, n, invert) => {
    const r = (AV.RAMPS[name] || AV.RAMPS['Blue-Red']).map(hex2rgb);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1); const x = t * (r.length - 1); const k = Math.min(r.length - 2, Math.floor(x)); const f = x - k;
      const c = [0, 1, 2].map(j => Math.round(r[k][j] + (r[k + 1][j] - r[k][j]) * f));
      out.push('#' + c.map(v => v.toString(16).padStart(2, '0')).join(''));
    }
    return invert ? out.reverse() : out;
  };
  AV.niceBreaks = (min, max, n) => {
    if (!isFinite(min) || !isFinite(max)) return [];
    if (max <= min) max = min + 1;
    const raw = (max - min) / n; const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw) || raw;
    const out = []; let v = Math.ceil(min / step) * step;
    while (out.length < n - 1 && v < max) { if (v > min) out.push(+v.toPrecision(12)); v += step; }
    return out;
  };
  AV.quantileBreaks = (vals, n) => {
    const a = vals.filter(isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return [];
    const out = []; for (let i = 1; i < n; i++) out.push(a[Math.min(a.length - 1, Math.floor(i * a.length / n))]);
    return [...new Set(out)];
  };

  AV.downloadText = async (text, defName, filters) => {
    const p = await window.host.saveDialog({ defaultPath: defName, filters: filters || [{ name: 'CSV', extensions: ['csv'] }] });
    if (!p) return null;
    await window.host.writeText(p, text);
    AV.toast('Saved ' + p);
    return p;
  };
  AV.csvCell = (v) => { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  AV.basename = (p) => String(p || '').split(/[\\/]/).pop();
  AV.dirname = (p) => { const s = String(p || ''); const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')); return i >= 0 ? s.slice(0, i) : ''; };
  AV.joinPath = (d, f) => d ? (d.replace(/[\\/]+$/, '') + (d.includes('\\') ? '\\' : '/') + f) : f;
  AV.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
})(window.AV);
