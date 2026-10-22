// Flags (Insight flags): one rule per line in the Flag panel, its numbers editable inline in the algorithm text.
// One flag per layer (nodes / links / subcatchments) can be shown at a time; while any flag is shown all ordinary themes
// are suspended (restored when the panel is closed or no flag is selected). A flag draws as a theme whose value is the
// level 0 Normal / 1 Warning / 2 High / 3 Critical; ▶ = level at the current time step (play mode), Σ = worst over the run.
// Parameters follow the model unit system (status bar Flow Units). Settings: <model>.flags.json.
'use strict';
(function (AV) {
  const h = AV.h;
  const LV = { 0: ['Normal', '#cfd8dc'], 1: ['Warning', '#fbc02d'], 2: ['High', '#fb8c00'], 3: ['Critical', '#e53935'] };
  const LAYER = { node: 'Nodes', link: 'Links', sub: 'Subcatchments' };
  const CONV = { ft: ['m', 0.3048], 'ft/s': ['m/s', 0.3048], in: ['mm', 25.4] };
  const sysOf = (app) => ['CMS', 'LPS', 'MLD'].includes(String(app.model && app.model.flowUnits || 'CFS').toUpperCase()) ? 'SI' : 'US';
  const unitOf = (f, k, sys) => { const u = f.P[k][1]; return sys === 'SI' && CONV[u] ? CONV[u][0] : u; };

  // ---------------------------------------------------------------- built-in flags (only model + results)
  // P: key -> [US default, US unit, SI default]; expr(p, u): level expression with the parameter values (model units)
  // cond: level -> condition ($name = parameter; $eps = "no flow" threshold, $tol = level tolerance, both in model units).
  // The highest level whose condition is true is shown. Every built-in flag can be edited in the program (Edit…); the
  // edits are kept in the program settings (all models) and can be reset to these defaults.
  AV.FLAG_DEFS = [
    { id: 'flood', name: 'Flooding at node / rim exceedance', layer: 'node', mode: 'play', levels: [2, 3], where: "type <> 'OUTFALL'",
      desc: 'HGL exceeds rim elevation for any model time step; report peak depth above rim and total duration.',
      alg: 'HGL > Rim; Critical if > {above} above rim or > {dur} duration', P: { above: [0.5, 'ft', 0.15], dur: [15, 'min', 15] },
      when: { 2: 'HGL ≥ rim (flooding)', 3: 'flooding and (HGL − rim > {above} or flooded > {dur} in total)' },
      cond: { 2: 'rptFlooding > 0 or rptHgl >= rimElev - $tol',
        3: '(rptFlooding > 0 or rptHgl >= rimElev - $tol) and (dur(rptFlooding > 0 or rptHgl >= rimElev - $tol) > $dur or rptHgl - rimElev > $above)' } },
    { id: 'surch', name: 'Surcharge duration', layer: 'node', mode: 'play', levels: [1, 2], where: "type <> 'OUTFALL'",
      desc: 'Node water level above the crown of the highest connected pipe; cumulative surcharged time.',
      alg: 'HGL > pipe crown for > {w} in total; High if > {h}', P: { w: [10, 'min', 10], h: [60, 'min', 60] },
      when: { 1: 'surcharged > {w} in total', 2: 'surcharged > {h} in total' },
      cond: { 1: 'dur(rptHgl > crownElev) > $w', 2: 'dur(rptHgl > crownElev) > $h' } },
    { id: 'fb', name: 'Freeboard compression', layer: 'node', mode: 'play', levels: [1, 2], where: "type = 'JUNCTION'",
      desc: 'HGL approaches the rim but does not flood; the margin to the rim falls below the threshold.',
      alg: 'Rim − HGL < {w} Warning; < {h} High (not flooding)', P: { w: [2, 'ft', 0.6], h: [1, 'ft', 0.3] },
      when: { 1: 'rim − HGL < {w}', 2: 'rim − HGL < {h}' },
      cond: { 1: 'not (rptFlooding > 0 or rptHgl >= rimElev - $tol) and rimElev - rptHgl < $w', 2: 'not (rptFlooding > 0 or rptHgl >= rimElev - $tol) and rimElev - rptHgl < $h' } },
    { id: 'stor', name: 'Storage nearing capacity', layer: 'node', mode: 'worst', levels: [1, 2, 3], where: "type = 'STORAGE'",
      desc: 'Basin or storage unit volume exceeds a percentage of its full volume during the simulation.',
      alg: 'Volume > {w} of full Warning; > {h} High; overflow Critical', P: { w: [80, '%', 80], h: [95, '%', 95] },
      when: { 1: 'volume > {w} of full', 2: 'volume > {h} of full', 3: 'storage overflowing' },
      cond: { 1: 'rptVolume / maxVolume > $w / 100', 2: 'rptVolume / maxVolume > $h / 100', 3: 'rptFlooding > 0' } },
    { id: 'cap', name: 'Conduit capacity exceedance', layer: 'link', mode: 'play', levels: [1, 2], where: "type = 'CONDUIT'",
      desc: 'Flow divided by the full-pipe (Manning) capacity exceeds the threshold.',
      alg: 'Q / Qfull > {w} Warning; > {h} High', P: { w: [90, '%', 90], h: [100, '%', 100] },
      when: { 1: 'Q / Qfull > {w}', 2: 'Q / Qfull > {h}' },
      cond: { 1: 'abs(rptFlow) / fullFlow > $w / 100', 2: 'abs(rptFlow) / fullFlow > $h / 100' } },
    { id: 'dd', name: 'Depth exceedance (d / D)', layer: 'link', mode: 'play', levels: [1], where: "type = 'CONDUIT'",
      desc: 'Water depth divided by the pipe diameter exceeds the threshold.', alg: 'Depth / D > {w} Warning', P: { w: [0.9, '', 0.9] },
      when: { 1: 'depth / D > {w}' }, cond: { 1: 'rptCapacity > $w' } },
    { id: 'lowv', name: 'Low velocity / sedimentation risk', layer: 'link', mode: 'play', levels: [1, 2], where: "type = 'CONDUIT'",
      desc: 'Velocity stays below the self-cleansing target in dry weather or after a storm (add the sewer type to Where if needed).',
      alg: 'No rain and velocity < {v} Warning; continuously ≥ {t} High', P: { v: [2, 'ft/s', 0.6], t: [60, 'min', 60] },
      when: { 1: 'no rain, flowing, velocity < {v}', 2: 'the above without a break for {t}' },
      cond: { 1: 'sysRain = 0 and abs(rptFlow) > $eps and abs(rptVel) < $v', 2: 'run(sysRain = 0 and abs(rptFlow) > $eps and abs(rptVel) < $v) >= $t' } },
    { id: 'highv', name: 'High velocity / scour risk', layer: 'link', mode: 'worst', levels: [1], where: "type = 'CONDUIT'",
      desc: 'Velocity exceeds the allowable limit for the pipe material or an erodible channel.', alg: 'Velocity > {v} Warning', P: { v: [10, 'ft/s', 3] },
      when: { 1: 'velocity > {v}' }, cond: { 1: 'abs(rptVel) > $v' } },
    { id: 'rev', name: 'Reverse flow event', layer: 'link', mode: 'worst', levels: [1, 2], where: "type = 'CONDUIT'",
      desc: 'Flow runs against the link direction (negative flow) for a share of the time the link carries flow. Only flows larger than a share of the pipe\'s own peak flow count, as flow and as reverse flow: small values around zero are numerical noise. Links that carry flow for less than the minimum time are not evaluated. High = the pipe flows backwards nearly all the time: its direction is probably drawn the wrong way round (not an oscillating flow).',
      alg: 'Flow above {r} of the peak for ≥ {n}: reverse ≥ {w} of that time Warning; ≥ {h} High (flows backwards – direction probably drawn reversed)', P: { r: [2, '%', 2], n: [60, 'min', 60], w: [5, '%', 5], h: [95, '%', 95] },
      when: { 1: 'flow above {r} of the peak for ≥ {n} and reverse flow for ≥ {w} of that time', 2: 'reverse flow for ≥ {h} of the time with flow: the pipe flows backwards (direction probably drawn reversed)' },
      // dur() rises during the run, so ▶ shows the share reached so far and Σ (peak) the share over the whole run
      cond: { 1: 'totdur(abs(rptFlow) > max($eps, $r / 100 * rptMaxFlow)) >= $n and 100 * dur(rptFlow < -max($eps, $r / 100 * rptMaxFlow)) / totdur(abs(rptFlow) > max($eps, $r / 100 * rptMaxFlow)) >= $w',
        2: 'totdur(abs(rptFlow) > max($eps, $r / 100 * rptMaxFlow)) >= $n and 100 * dur(rptFlow < -max($eps, $r / 100 * rptMaxFlow)) / totdur(abs(rptFlow) > max($eps, $r / 100 * rptMaxFlow)) >= $h' } },
    { id: 'dry', name: 'Dry-weather high depth', layer: 'link', mode: 'play', levels: [1], where: "type = 'CONDUIT'",
      desc: 'Depth ratio above the threshold while there is no rainfall.', alg: 'No rain and d / D > {r} for ≥ {t} Warning', P: { r: [0.5, '', 0.5], t: [30, 'min', 30] },
      when: { 1: 'no rain and d / D > {r} for {t}' }, cond: { 1: 'run(sysRain = 0 and rptCapacity > $r) >= $t' } },
    { id: 'tail', name: 'Tailwater sensitivity', layer: 'link', mode: 'worst', levels: [1, 2], where: "ds_type = 'OUTFALL'",
      desc: 'The boundary water level rises toward the crown of the outfall pipe, reducing its discharge capacity.',
      alg: 'Outfall level within {d} of pipe crown Warning; above crown High', P: { d: [1, 'ft', 0.3] },
      when: { 1: 'crown − outfall level < {d}', 2: 'outfall level above the crown' },
      cond: { 1: 'dsInvert + diam - ds_rptHgl < $d', 2: 'dsInvert + diam - ds_rptHgl < 0' } },
    { id: 'slow', name: 'Slow-draining subcatchment', layer: 'sub', mode: 'worst', levels: [1], where: '',
      desc: 'Runoff continues long after the rainfall on the subcatchment has ended.', alg: 'Runoff continues > {t} after rain stops Warning', P: { t: [120, 'min', 120] },
      when: { 1: 'runoff > 0 for {t} after the rain stopped' }, cond: { 1: 'run(rptRainfall = 0 and rptRunoff > $eps) > $t' } },
  ];
  AV.FLAG_DEFS.forEach(f => Object.freeze(f));

  // ---------------------------------------------------------------- state
  class Flags {
    constructor(app) { this.app = app; this.reset(); }
    reset() { this.S = { vals: {}, sys: {}, col: {}, mode: {}, custom: [], active: { node: null, link: null, sub: null } }; this.open = !!this.open; this.ver = (this.ver || 0) + 1; this._subs = {}; }
    edits() { const P = this.app.prefs || {}; return P.flagEdits || (P.flagEdits = {}); }
    defs() { const E = this.edits(); return AV.FLAG_DEFS.map(f => E[f.id] ? Object.assign({}, f, E[f.id], { edited: true }) : f).concat(this.S.custom); }
    builtin(id) { return AV.FLAG_DEFS.find(f => f.id === id); }
    def(id) { return this.defs().find(f => f.id === id); }
    sys() { return sysOf(this.app); }
    // parameter value in the current unit system (stored values are converted when the flow units change system)
    val(f, k) {
      const sys = this.sys(); const v = (this.S.vals[f.id] || {})[k];
      if (v === undefined || v === null) return f.custom ? f.P[k][0] : (sys === 'SI' ? f.P[k][2] : f.P[k][0]);
      const s0 = (this.S.sys[f.id] || {})[k] || sys; const c = CONV[f.P[k][1]];
      if (s0 === sys || f.custom || !c) return v;
      return +(s0 === 'US' ? v * c[1] : v / c[1]).toPrecision(6);
    }
    unit(f, k) { return f.custom ? f.P[k][1] : unitOf(f, k, this.sys()); }
    setVal(f, k, v) { (this.S.vals[f.id] = this.S.vals[f.id] || {})[k] = v; (this.S.sys[f.id] = this.S.sys[f.id] || {})[k] = this.sys(); this.changed(); }
    isChanged(f, k) { const v = (this.S.vals[f.id] || {})[k]; return v !== undefined && v !== null; }
    mode(f) { return this.S.mode[f.id] || f.mode; }
    color(f, l) { const c = this.S.col[f.id]; if (c && c[l] !== undefined) return c[l]; return l === 0 ? LV[0][1] : LV[l][1]; }
    params(f) { const o = {}; for (const k in f.P) o[k] = this.val(f, k); return o; }
    text(f, s) { return String(s || '').replace(/\{(\w+)\}/g, (m, k) => f.P[k] ? this.val(f, k) + (this.unit(f, k) ? (this.unit(f, k) === '%' ? '%' : ' ' + this.unit(f, k)) : '') : m); }
    consts() { const SI = this.sys() === 'SI'; return { tol: SI ? 0.003 : 0.01, eps: SI ? 0.0001 : 0.001 }; }
    expr(f) {
      const p = Object.assign(this.consts(), this.params(f));
      const sub = (c) => String(c || '').replace(/\$(\w+)/g, (m, k) => p[k] !== undefined ? String(p[k]) : m);
      let e = '0'; for (const l of [1, 2, 3]) if (f.cond && f.cond[l]) e = `iif(${sub(f.cond[l])}, ${l}, ${e})`;
      return e;
    }
    on() { return this.open && ['node', 'link', 'sub'].some(k => this.S.active[k]); }
    // the theme item that draws the selected flag of a layer
    sub(layer) {
      const id = this.S.active[layer]; if (!id) return null; const f = this.def(id); if (!f) return null;
      const key = id + '|' + this.ver + '|' + JSON.stringify(this.edits()[id] || '') + '|' + this.sys() + '|' + this.mode(f); const c = this._subs[layer]; if (c && c.key === key) return c.t;
      const worst = this.mode(f) === 'worst'; const ex = this.expr(f);
      const sz = { node: [null, 6, 8, 10], link: [null, 2.5, 3.5, 5], sub: [null, 1, 1, 1] }[layer];
      const ranges = [0].concat(f.levels).map(l => { const col = this.color(f, l); return { v: String(l), label: LV[l][0], color: col, size: l === 0 ? null : sz[l], show: true }; });
      const t = { name: '⚑ ' + f.name, field: 'x:' + (worst ? 'peak(' + ex + ')' : ex), kind: 'individual', abs: false, nulls: false, enabled: true, legend: true, useColor: true, useSize: layer !== 'sub',
        method: 'linear', ranges, nullRow: { color: null, size: null, show: true }, where: f.where || '', flag: f.id, desc: f.desc };
      this._subs[layer] = { key, t }; return t;
    }
    changed() { this.ver++; this._subs = {}; const app = this.app; if (app.theme) { app.theme.invalidate(); } app.map.redraw(); this.save(); if (this.render) this.render(); }
    path() { return this.app.filePath ? this.app.filePath.replace(/\.inp$/i, '.flags.json') : null; }
    save() { clearTimeout(this._st); this._st = setTimeout(async () => { const p = this.path(); if (!p) return; try { await window.host.writeText(p, JSON.stringify(this.toJSON(), null, 1)); } catch (e) { } }, 400); }
    toJSON() { const S = this.S; return { avarisFlags: 1, vals: S.vals, sys: S.sys, col: S.col, mode: S.mode, active: S.active, custom: S.custom.map(f => ({ id: f.id, name: f.name, layer: f.layer, mode: f.mode, desc: f.desc, alg: f.alg, P: f.P, cond: f.cond, where: f.where || '', levels: f.levels, when: f.when })) }; }
    fromJSON(j, merge) {
      if (!j || !j.avarisFlags) throw new Error('Not an Avaris2 CS flags file');
      const S = this.S; const cust = (j.custom || []).map(f => Object.assign({ custom: true }, f));
      if (merge) { const ids = new Set(cust.map(f => f.id)); S.custom = S.custom.filter(f => !ids.has(f.id)).concat(cust); for (const k of ['vals', 'sys', 'col', 'mode']) Object.assign(S[k], j[k] || {}); }
      else { this.S = { vals: j.vals || {}, sys: j.sys || {}, col: j.col || {}, mode: j.mode || {}, custom: cust, active: Object.assign({ node: null, link: null, sub: null }, j.active || {}) }; }
      this.ver++; this._subs = {};
    }
    async load() { this.reset(); const p = this.path(); if (!p) return; try { if (await window.host.exists(p)) this.fromJSON(JSON.parse(await window.host.readText(p))); } catch (e) { AV.toast('Flags file not read: ' + e.message, true); } }
  }
  AV.Flags = Flags;

  // ---------------------------------------------------------------- panel
  AV.openFlags = function (app) {
    const F = app.flags; if (!F) return;
    const P = AV.floatPanel({ id: 'flags', title: 'Flags', minimize: true, onMinimize: (m) => { P.setTitle(m ? minTitle() : 'Flags'); }, w: 470, h: Math.min(760, window.innerHeight - 160), body: h('div', { class: 'flp' }), onClose: () => { F.open = false; F.render = null; app.theme.invalidate(); app.map.redraw(); app.refreshRibbon && app.refreshRibbon(); } });
    // minimized title: the flags shown on the map
    const minTitle = () => { const n = ['node', 'link', 'sub'].map(k => F.S.active[k] && F.def(F.S.active[k])).filter(Boolean).map(f => f.name); return 'Flags' + (n.length ? ' — ' + n.join(', ') : ''); };
    F.open = true; app.theme.invalidate(); app.map.redraw(); app.refreshRibbon && app.refreshRibbon();
    const root = P.el ? AV.$('.flp', P.el) : AV.$('.flp');
    const render = F.render = () => {
      if (P.minimized) P.setTitle(minTitle());
      // keep the list scrolled where it was (re-rendered after every change)
      const old = AV.$('.fllist', root); const st = old ? old.scrollTop : 0;
      root.innerHTML = '';
      const sys = F.sys();
      root.appendChild(h('div', { class: 'fltb' },
        h('button', { class: 'btn small primary', onclick: () => newFlag(app) }, '+ New flag'),
        h('button', { class: 'btn small', onclick: () => importFlags(app) }, 'Import…'), h('button', { class: 'btn small', onclick: () => exportFlags(app) }, 'Export…'),
        h('span', { style: { flex: 1 } }), h('span', { class: 'flunit', title: 'Follows the Flow Units in the status bar' }, 'Units: ' + (sys === 'SI' ? 'm' : 'ft') + ' (' + app.model.flowUnits + ')')));
      const list = h('div', { class: 'fllist' }); root.appendChild(list);
      for (const layer of ['node', 'link', 'sub']) {
        const defs = F.defs().filter(f => f.layer === layer); if (!defs.length) continue;
        const name = 'fl_' + layer;
        list.appendChild(h('div', { class: 'flgrp' }, h('span', null, LAYER[layer]), h('label', { class: 'flnone' }, h('input', { type: 'radio', name, checked: !F.S.active[layer], onchange: () => { F.S.active[layer] = null; F.changed(); } }), ' None')));
        for (const f of defs) {
          const on = F.S.active[layer] === f.id;
          const alg = h('div', { class: 'flalg' });
          String(f.alg).split(/(\{\w+\})/).forEach(part => {
            const m = /^\{(\w+)\}$/.exec(part);
            if (!m || !f.P[m[1]]) { alg.appendChild(document.createTextNode(part)); return; }
            const k = m[1]; const inp = h('input', { value: String(F.val(f, k)), title: 'Default ' + (f.custom ? f.P[k][0] : (sys === 'SI' ? f.P[k][2] : f.P[k][0])) });
            const commit = () => { const v = parseFloat(inp.value); if (!isFinite(v)) { inp.value = String(F.val(f, k)); return; } if (v !== F.val(f, k)) F.setVal(f, k, v); };
            inp.addEventListener('change', commit); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
            alg.appendChild(h('span', { class: 'flpin' + (F.isChanged(f, k) ? ' changed' : '') }, inp, F.unit(f, k) ? h('span', null, F.unit(f, k)) : null));
          });
          const sw = h('div', { class: 'flsw', title: 'Colours…', onclick: () => colours(app, f) }, [0].concat(f.levels).map(l => { const c = F.color(f, l); return h('span', { style: { background: c || 'repeating-linear-gradient(45deg,#fff 0 3px,#e0e0e0 3px 6px)' } }); }));
          const md = F.mode(f);
          const seg = h('span', { class: 'flseg' }, [['play', '▶', 'Play: level at the current time step (shown in play mode)'], ['worst', 'Σ', 'Worst level over the run (shown outside play mode)']].map(([k, l, tip]) => h('button', { class: md === k ? 'on' : '', title: tip, onclick: () => { F.S.mode[f.id] = k; F.changed(); } }, l)));
          list.appendChild(h('div', { class: 'flrow' + (on ? ' on' : '') },
            h('input', { type: 'radio', name, checked: on, onchange: () => { F.S.active[layer] = f.id; F.changed(); } }), sw,
            h('div', { class: 'flnm' }, f.name, f.custom ? h('span', { class: 'fllay' }, 'custom') : f.edited ? h('span', { class: 'fllay' }, 'edited') : null), seg, alg,
            f.custom ? h('div', { class: 'flact' }, h('a', { onclick: () => conditions(app, f, false) }, 'Edit…'), h('a', { onclick: async () => { if (!await AV.confirm('Delete the flag "' + f.name + '"?', 'Flags', 'Delete')) return; F.S.custom = F.S.custom.filter(x => x !== f); if (F.S.active[layer] === f.id) F.S.active[layer] = null; F.changed(); } }, 'Delete'))
              : h('div', { class: 'flact' }, h('a', { onclick: () => conditions(app, f, false) }, 'Edit…'), f.edited ? h('a', { onclick: async () => { if (!await AV.confirm('Restore the original definition of "' + F.builtin(f.id).name + '"?', 'Flags', 'Reset')) return; delete F.edits()[f.id]; app.savePrefs(); delete F.S.vals[f.id]; delete F.S.sys[f.id]; F.changed(); } }, 'Reset') : null)));
        }
      }
      list.scrollTop = st; requestAnimationFrame(() => { list.scrollTop = st; });
      root.appendChild(h('div', { class: 'flfoot' }, h('span', null, '▶ level at the current time step (play mode)'), h('span', null, 'Σ worst level over the run'), h('span', null, 'While a flag is shown, the other themes are hidden.')));
    };
    render();
    return P;
  };

  // colours: one colour per level; the ranges come from the algorithm text (read only)
  async function colours(app, f) {
    const F = app.flags; const rows = [0].concat(f.levels);
    const inputs = {}; const nofill = h('input', { type: 'checkbox', checked: F.color(f, 0) === null });
    const body = h('div', { style: { width: '500px' } },
      h('div', { class: 'fldesc' }, h('b', null, f.name), h('div', null, f.desc || '')),
      h('table', { class: 'fllv' }, h('tr', null, h('th', null, 'Level'), h('th', null, 'Colour'), h('th', null, 'Shown when (from the algorithm)')),
        rows.map(l => { const c = F.color(f, l); const inp = inputs[l] = h('input', { type: 'color', value: c || '#cfd8dc', disabled: l === 0 && c === null });
          return h('tr', null, h('td', null, h('b', null, LV[l][0])), h('td', null, inp, l === 0 ? h('label', { class: 'flnf' }, nofill, ' No fill') : null), h('td', { class: 'flro' }, l === 0 ? 'none of the conditions' + (c === null ? ' (drawn with the layer symbol)' : '') : F.text(f, (f.when || {})[l] || ''))); })),
      h('div', { class: 'note', style: { marginTop: '8px' } }, 'Only the colours can be changed here; the ranges follow the algorithm text in the Flag panel.'));
    nofill.addEventListener('change', () => { inputs[0].disabled = nofill.checked; });
    const r = await AV.modal({ title: 'Flag colours – ' + f.name, body, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: true }] }).done;
    if (!r) return; const c = F.S.col[f.id] = F.S.col[f.id] || {};
    for (const l of rows) c[l] = l === 0 && nofill.checked ? null : inputs[l].value;
    F.changed();
  }

  // ---------------------------------------------------------------- new / edit custom flags
  async function newFlag(app) {
    const name = h('input', { type: 'text', value: '' }), layer = h('select', null, Object.entries(LAYER).map(([k, v]) => h('option', { value: k }, v)));
    const mode = h('select', null, [['play', '▶ Play (current time step)'], ['worst', 'Σ Worst over the run']].map(([k, v]) => h('option', { value: k }, v)));
    const desc = h('textarea', { rows: 2, placeholder: 'e.g. Pump is on while its inlet node is nearly empty; report how long it runs dry.' });
    const alg = h('textarea', { rows: 2, placeholder: 'e.g. Pump ON and inlet depth < {depth}; High if > {minutes} continuous' });
    const body = h('div', { style: { width: '520px' } }, h('div', { class: 'flstep' }, 'Step 1 of 2 · Description'),
      h('div', { class: 'form' }, h('label', null, 'Flag name'), name, h('label', null, 'Applies to'), layer, h('label', null, 'Display'), mode, h('label', null, 'Short description'), desc, h('label', null, 'Algorithm text'), alg),
      h('div', { class: 'note', style: { marginTop: '8px' } }, 'Write the numbers users may change as {name} without the unit; each becomes an editable box in the panel and is used as $name in the conditions (step 2).'));
    const r = await AV.modal({ title: 'New Flag', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Next: conditions…', primary: true, onClick: () => { if (!name.value.trim()) { AV.toast('Enter a flag name.', true); return false; } return true; } }] }).done;
    if (!r) return;
    const keys = [...new Set([...alg.value.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
    const f = { id: 'u' + Date.now().toString(36), custom: true, name: name.value.trim(), layer: layer.value, mode: mode.value, desc: desc.value.trim(), alg: alg.value.trim() || name.value.trim(),
      P: Object.fromEntries(keys.map(k => [k, [0, /min|dur|time|t$/i.test(k) ? 'min' : '', 0]])), cond: { 1: '', 2: '', 3: '' }, where: '', levels: [1], when: {} };
    await conditions(app, f, true);
  }
  // flag editor: name / description / algorithm text, one condition per level (Critical first), parameters with defaults
  // and units, fields to insert. Built-in flags: the edits go to the program settings (all models); Reset restores them.
  async function conditions(app, f, isNew) {
    const F = app.flags; const fields = AV.exprFields(app, f.layer); const bi = !f.custom;
    const lv = {}; let last = null;
    const err = h('div', { class: 'note', style: { color: 'var(--danger)', minHeight: '16px' } });
    const lvBox = h('div', null, [3, 2, 1].map(l => { const i = lv[l] = h('textarea', { rows: 2, spellcheck: 'false', value: (f.cond || {})[l] || '', placeholder: '(not used)', class: 'mono', style: { width: '100%', resize: 'vertical' }, onfocus: () => { last = i; } }); return h('div', { class: 'fllvr' }, h('span', { class: 'flsq', style: { background: LV[l][1] } }), h('b', null, LV[l][0]), i); }));
    last = lv[1];
    const where = h('input', { type: 'text', value: f.where || '', class: 'mono', placeholder: "(all objects)  e.g.  type = 'PUMP'", onfocus: () => { last = where; } });
    const name = h('input', { type: 'text', value: f.name }), desc = h('textarea', { rows: 2, value: f.desc || '' }), alg = h('textarea', { rows: 2, value: f.alg || '' });
    // parameters follow the {name} placeholders of the algorithm text; built-in flags keep a US and an SI default
    const prm = h('tbody'); let pin = {}; const P0 = Object.assign({}, f.P);
    const keysOf = () => [...new Set([...alg.value.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
    const fillP = () => { const old = {}; for (const k in pin) old[k] = pin[k].map(i => i.value); pin = {}; prm.innerHTML = '';
      const ks = keysOf(); if (!ks.length) prm.appendChild(h('tr', null, h('td', { colspan: 4, style: { color: 'var(--muted)' } }, 'No {parameters} in the algorithm text.')));
      for (const k of ks) { const d = old[k] || (P0[k] ? [String(P0[k][0]), P0[k][1] || '', String(P0[k][2] !== undefined ? P0[k][2] : P0[k][0])] : ['0', /min|dur|time|t$/i.test(k) ? 'min' : '', '0']);
        const c = pin[k] = [h('input', { value: d[0] }), h('input', { value: d[1] }), h('input', { value: d[2] })];
        prm.appendChild(h('tr', null, h('td', { class: 'mono' }, '$' + k), h('td', null, c[0]), h('td', null, c[1]), bi ? h('td', null, c[2]) : null)); } };
    alg.addEventListener('input', () => { fillP(); fill(); }); fillP();
    const ins = (s) => { const i = last || lv[1]; const a = i.selectionStart ?? i.value.length; i.value = i.value.slice(0, a) + s + i.value.slice(i.selectionEnd ?? a); i.focus(); };
    const filter = h('input', { type: 'text', placeholder: 'Filter…' });
    const flist = h('div', { class: 'flfields' });
    const fill = () => { flist.innerHTML = ''; const q = filter.value.toLowerCase();
      const groups = [['Time functions (minutes)', ['dur( )', 'run( )', 'win( , 60)', 'totdur( )', 'maxrun( )', 'iif( , , )', 'and', 'or', 'not', 'abs( )']], ['Parameters', keysOf().map(k => '$' + k).concat(['$eps', '$tol'])]].concat(['Results', 'Computed', 'Properties', 'General', 'US Node', 'DS Node', 'Outlet Node'].map(g => [g, fields.filter(x => x.g === g).map(x => x.n)]));
      for (const [g, a] of groups) { const b = a.filter(x => !q || x.toLowerCase().includes(q)); if (!b.length) continue; flist.appendChild(h('div', { class: 'g' }, g)); for (const x of b.slice(0, 200)) flist.appendChild(h('div', { onclick: () => ins(x.replace(/\( \)$/, '(').replace(/\( , 60\)$/, '(') + (/\($/.test(x) ? '' : ' ')) }, x)); } };
    filter.addEventListener('input', fill); fill();
    // conditions as text ("High: …", "Warning: …", "Where: …"), to send by e-mail or paste from one
    const pasteAll = async () => { const ta = h('textarea', { rows: 8, spellcheck: 'false', class: 'mono', style: { width: '100%' }, placeholder: 'Critical: …\nHigh: …\nWarning: …\nWhere: …' });
      const t = await AV.modal({ title: 'Paste Conditions', body: h('div', { style: { width: '620px' } }, ta, h('div', { class: 'note' }, 'One line per level: Critical:, High:, Warning: and optionally Where:. Levels that are not listed are left empty.')), buttons: [{ label: 'Cancel', value: null }, { label: 'Apply', primary: true, onClick: () => ta.value }] }).done;
      if (!t) return; const got = {}; let cur = null;
      for (const line of t.split(/\r?\n/)) { const m = /^\s*(Critical|High|Warning|Where)\s*:\s*(.*)$/i.exec(line); if (m) { cur = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(); got[cur] = m[2].trim(); } else if (cur && line.trim()) got[cur] += ' ' + line.trim(); }
      if (!Object.keys(got).length) { AV.toast('No "High:" / "Warning:" lines found.', true); return; }
      for (const l of [1, 2, 3]) lv[l].value = got[LV[l][0]] || ''; if (got.Where !== undefined) where.value = got.Where; err.textContent = ''; };
    const copyAll = () => { const t = [3, 2, 1].filter(l => lv[l].value.trim()).map(l => LV[l][0] + ': ' + lv[l].value.trim()).concat(where.value.trim() ? ['Where: ' + where.value.trim()] : []).join('\n'); navigator.clipboard.writeText(t).then(() => AV.toast('Conditions copied.')); };
    const body = h('div', { style: { width: '820px', display: 'grid', gridTemplateColumns: '1fr 240px', gap: '12px' } },
      h('div', null, isNew ? h('div', { class: 'flstep' }, 'Step 2 of 2 · Conditions') : h('div', { class: 'form', style: { marginBottom: '8px' } }, h('label', null, 'Flag name'), name, h('label', null, 'Description'), desc, h('label', null, 'Algorithm text'), alg),
        h('div', { style: { fontWeight: 600, margin: '2px 0 6px' } }, 'Level conditions - checked from Critical down; the first true one sets the level'), lvBox,
        h('div', { class: 'fllvr' }, h('span'), h('b', null, 'Where'), where),
        h('div', { style: { fontWeight: 600, margin: '10px 0 4px' } }, 'Parameters'), h('table', { class: 'flprm' }, h('tr', null, h('th', null, 'Name'), h('th', null, bi ? 'Default (US)' : 'Default'), h('th', null, bi ? 'Unit (US)' : 'Unit'), bi ? h('th', null, 'Default (SI)') : null), prm),
        h('div', { class: 'note', style: { marginTop: '6px' } }, 'Write the numbers users may change as {name} in the algorithm text and use them as $name in the conditions. $eps (no-flow threshold) and $tol (level tolerance) are set by the program. Current-step results (rpt…), properties and the time functions (minutes) can be combined with and / or / not.' + (bi ? ' Units ft, ft/s and in are converted to m, m/s and mm for SI models.' : '')),
        bi ? h('div', { class: 'note' }, 'Changes to a built-in flag apply to all models on this computer; Reset in the Flag panel restores the original.') : null, err),
      h('div', null, h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Fields and functions (click to insert)'), filter, flist));
    const r = await AV.modal({ title: (isNew ? 'Flag Conditions – ' : 'Edit Flag – ') + f.name, body, enterSubmits: false, buttons: [{ label: 'Paste Conditions…', onClick: () => { pasteAll(); return false; } }, !isNew ? { label: 'Copy Conditions', onClick: () => { copyAll(); return false; } } : null, { label: 'Cancel', value: null }, { label: isNew ? 'Add flag' : 'OK', primary: true, onClick: () => {
      if (!isNew && !name.value.trim()) { err.textContent = 'Enter a flag name.'; return false; }
      const g = { cond: { 1: lv[1].value.trim(), 2: lv[2].value.trim(), 3: lv[3].value.trim() }, P: {} };
      for (const k in pin) { const v = parseFloat(pin[k][0].value) || 0, si = parseFloat(pin[k][2].value); g.P[k] = [v, pin[k][1].value.trim(), bi && isFinite(si) ? si : v]; }
      if (!g.cond[1] && !g.cond[2] && !g.cond[3]) { err.textContent = 'Enter at least one condition.'; return false; }
      const p = Object.assign(F.consts(), Object.fromEntries(Object.keys(g.P).map(k => [k, g.P[k][0]])));
      for (const l of [1, 2, 3]) if (g.cond[l]) { const ex = g.cond[l].replace(/\$(\w+)/g, (m, k) => p[k] !== undefined ? String(p[k]) : m); if (/\$\w+/.test(ex)) { err.textContent = LV[l][0] + ': unknown parameter ' + /\$\w+/.exec(ex)[0] + ' (add {' + /\$(\w+)/.exec(ex)[1] + '} to the algorithm text)'; return false; } try { AV.compileExpr(ex, fields); } catch (e) { err.textContent = LV[l][0] + ': ' + e.message; return false; } }
      if (where.value.trim()) { try { AV.compileExpr(where.value.trim(), fields); } catch (e) { err.textContent = 'Where: ' + e.message; return false; } }
      return g; } }].filter(Boolean) }).done;
    if (!r) return;
    const levels = [1, 2, 3].filter(l => r.cond[l]); const B = bi ? F.builtin(f.id) : null;
    const when = {}; for (const l of levels) when[l] = B && B.cond[l] === r.cond[l] && B.when[l] ? B.when[l] : r.cond[l].replace(/\$(\w+)/g, '{$1}');
    const upd = { cond: r.cond, P: r.P, where: where.value.trim(), levels, when };
    if (!isNew) Object.assign(upd, { name: name.value.trim(), desc: desc.value.trim(), alg: alg.value.trim() || name.value.trim() });
    if (bi) { F.edits()[f.id] = upd; app.savePrefs(); delete F.S.vals[f.id]; delete F.S.sys[f.id]; }
    else { Object.assign(f, upd); if (isNew) { F.S.custom.push(f); F.S.active[f.layer] = f.id; } else delete F.S.vals[f.id]; }
    F.changed();
  }
  async function exportFlags(app) { await AV.downloadText(JSON.stringify(Object.assign(app.flags.toJSON(), { edits: app.flags.edits() }), null, 1), (app.filePath ? AV.basename(app.filePath).replace(/\.inp$/i, '') : 'model') + '.flags.json', [{ name: 'Avaris2 CS flags', extensions: ['json'] }]); }
  async function importFlags(app) {
    const p = await window.host.openDialog({ filters: [{ name: 'Avaris2 CS flags', extensions: ['json'] }] }); if (!p) return;
    try { const j = JSON.parse(await window.host.readText(p)); app.flags.fromJSON(j, true); const n = Object.keys(j.edits || {}).filter(k => app.flags.builtin(k)).length; if (n) { for (const k in j.edits) if (app.flags.builtin(k)) { app.flags.edits()[k] = j.edits[k]; delete app.flags.S.vals[k]; } app.savePrefs(); } app.flags.changed(); AV.toast('Flags imported' + (n ? ' (' + n + ' built-in flag' + (n > 1 ? 's' : '') + ' updated)' : '') + '.'); } catch (e) { AV.alert(e.message); }
  }

  // flags with time functions for the Report (Insights page): theme-like items with the current parameters
  AV.flagsForReport = function (app) {
    const F = app.flags; if (!F) return [];
    return F.defs().map(f => { const ex = F.expr(f); return /\b(dur|run|win)\s*\(/.test(ex) ? { layer: f.layer, src: ex, t: { name: '⚑ ' + f.name, desc: f.desc + ' - ' + F.text(f, f.alg), where: f.where || '', ranges: [0].concat(f.levels).map(l => ({ v: String(l), label: LV[l][0], color: F.color(f, l) || '#eceff1' })) }, active: F.S.active[f.layer] === f.id } : null; }).filter(Boolean);
  };
})(window.AV);
