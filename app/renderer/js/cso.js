// CSO statistics (Simulation ▸ Results ▸ CSO Statistics): spill events of the overflow points of the loaded results.
//   Overflow points: outfalls (total inflow) and / or weirs, orifices, outlets (link flow), optionally only the
//   selected objects or those whose name / tag contains a text.
//   A spill is a reported time step with flow above the threshold. Spills closer than the separation time belong to
//   one event. The 12/24 h counting (as used by the Environment Agency, UK) is given as well: the first spill opens a
//   12 h block counted as one spill, every following 24 h block with a spill counts once more, a 24 h block without a
//   spill ends the sequence.
'use strict';
(function (AV) {
  const h = AV.h;
  // flow units -> volume per second in m3 (SI) or ft3 (US)
  const QF = { CFS: 1, GPM: 0.133681 / 60, MGD: 1e6 * 0.133681 / 86400, CMS: 1, LPS: 0.001, MLD: 1000 / 86400 };
  const DEF_THR = { CFS: 0.035, GPM: 15, MGD: 0.02, CMS: 0.001, LPS: 1, MLD: 0.1 };

  AV.csoEvents = function (y, dt, thr, sepH) {
    const ev = []; let cur = null, gap = 0; const sepN = Math.max(1, Math.round(sepH * 3600 / dt));
    for (let i = 0; i < y.length; i++) {
      const q = y[i];
      if (q > thr) {
        if (!cur) cur = { i0: i, i1: i, vol: 0, peak: 0, ipk: i, n: 0 };
        cur.i1 = i; cur.vol += q * dt; cur.n++; if (q > cur.peak) { cur.peak = q; cur.ipk = i; } gap = 0;
      } else if (cur) { gap++; if (gap >= sepN) { ev.push(cur); cur = null; gap = 0; } }
    }
    if (cur) ev.push(cur);
    return ev;
  };
  AV.cso1224 = function (y, dt, thr) {
    let n = 0, bs = null, L = 0; const H12 = 12 * 3600, H24 = 24 * 3600;
    for (let i = 0; i < y.length; i++) {
      if (!(y[i] > thr)) continue; const t = i * dt;
      if (bs !== null && t < bs + L) continue;
      if (bs !== null && t < bs + L + H24) { bs = bs + L; L = H24; n++; continue; }
      bs = t; L = H12; n++;
    }
    return n;
  };

  class CsoView {
    constructor(app) { this.app = app; const fu = this.fu(); this.S = Object.assign({ outfalls: true, weirs: true, orifices: false, outlets: false, onlySel: false, match: '', thr: DEF_THR[fu] || 0.001, sep: 12 }, app.prefs.cso || {}); }
    fu() { const R = this.app.results; return R ? AV.FLOW_UNIT_NAMES[R.meta.flowUnits] || 'CMS' : (this.app.model.flowUnits || 'CMS'); }
    open() {
      const app = this.app; if (!app.results) { AV.alert('Load or run results first (Simulation ▸ Run, or Database ▸ Open Results).', 'CSO Statistics'); return; }
      if (!this.el) { this.el = h('div', { class: 'csoview csov' }); app.addView('cso', 'CSO Statistics', this.el, { onClose: () => { this.el = null; this.showMap(false); } }); }
      else app.activateView('cso');
      this.render(); if (!this.rows || this.R !== app.results) this.compute();
    }
    objects() {
      const m = this.app.model, S = this.S; const out = []; const sel = this.app.selection; const mt = S.match.trim().toLowerCase();
      const ok = (o) => (!S.onlySel || sel.has(o)) && (!mt || String(o.id).toLowerCase().includes(mt) || String(o.tag || '').toLowerCase().includes(mt) || String(o.desc || '').toLowerCase().includes(mt));
      if (S.outfalls) for (const n of m.nodes.values()) if (n.type === 'OUTFALL' && ok(n)) out.push(n);
      for (const l of m.links.values()) if (((S.weirs && l.type === 'WEIR') || (S.orifices && l.type === 'ORIFICE') || (S.outlets && l.type === 'OUTLET')) && ok(l)) out.push(l);
      return out;
    }
    async compute() {
      const app = this.app, R = app.results; if (!R) return; this.R = R; app.prefs.cso = this.S; app.savePrefs && app.savePrefs();
      const objs = this.objects(); const dt = R.meta.reportStep; const fu = this.fu(); const si = R.meta.flowUnits >= 3; const k = QF[fu] || 1;
      const busy = AV.busy.start('Computing CSO statistics'); const rows = [];
      try {
        for (let i = 0; i < objs.length; i++) {
          const o = objs[i]; const t = o.kind === 'NODE' ? 'node' : 'link'; const ix = R.idx[t].get(o.id); if (ix === undefined) continue;
          const y = await window.host.outSeries(R.handle, t, ix, t === 'node' ? 4 : 0);
          const ev = AV.csoEvents(y, dt, this.S.thr, this.S.sep); const n1224 = AV.cso1224(y, dt, this.S.thr);
          const vol = (v) => si ? v * k : v * k * 7.48052 / 1e6;   // m3, or million gallons
          const E = ev.map(e => ({ start: R.meta.startDate + (e.i0 + 1) * dt / 86400, end: R.meta.startDate + (e.i1 + 1) * dt / 86400, dur: (e.i1 - e.i0 + 1) * dt / 3600, spillH: e.n * dt / 3600, vol: vol(e.vol), peak: e.peak, tpk: R.meta.startDate + (e.ipk + 1) * dt / 86400 }));
          rows.push({ o, type: o.kind === 'NODE' ? 'Outfall' : o.type.charAt(0) + o.type.slice(1).toLowerCase(), events: E.length, n1224, vol: E.reduce((a, e) => a + e.vol, 0), hours: E.reduce((a, e) => a + e.spillH, 0), peak: E.reduce((a, e) => Math.max(a, e.peak), 0), longest: E.reduce((a, e) => Math.max(a, e.dur), 0), first: E.length ? E[0].start : null, E });
          if (i % 20 === 19) { busy.set(i / objs.length); await new Promise(r => setTimeout(r, 0)); }
        }
      } finally { busy.done(); }
      rows.sort((a, b) => b.vol - a.vol); this.rows = rows; this.sel = rows.find(r => r.events) || rows[0] || null;
      this.render(); if (this.mapOn) this.showMap(true);
      app.status('CSO statistics: ' + rows.filter(r => r.events).length + ' of ' + rows.length + ' overflow points spill.');
    }
    units() { const R = this.app.results; const si = R && R.meta.flowUnits >= 3; return { V: si ? 'm³' : 'MG', Q: this.fu() }; }
    render() {
      const E = this.el; if (!E) return; E.innerHTML = ''; const S = this.S; const U = this.units();
      const cb = (k, l) => h('label', null, h('input', { type: 'checkbox', checked: !!S[k], onchange: (e) => { S[k] = e.target.checked; } }), ' ' + l);
      const num = (k, w, st) => h('input', { type: 'number', value: S[k], step: st || 'any', min: 0, style: { width: w + 'px' }, onchange: (e) => { S[k] = Math.max(0, +e.target.value || 0); } });
      const match = h('input', { type: 'text', value: S.match, placeholder: 'name / tag contains', style: { width: '130px' }, onchange: (e) => { S.match = e.target.value; } });
      E.appendChild(h('div', { class: 'cmpbar' }, h('b', null, 'Overflow points'), cb('outfalls', 'Outfalls'), cb('weirs', 'Weirs'), cb('orifices', 'Orifices'), cb('outlets', 'Outlets'), cb('onlySel', 'Selected only'), match,
        h('span', { class: 'cmpsep' }), h('label', null, 'Spill above ', num('thr', 70), ' ' + U.Q), h('label', null, 'Separation ', num('sep', 50, 1), ' h'),
        h('button', { class: 'btn small primary', onclick: () => this.compute() }, 'Compute'), h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn small' + (this.mapOn ? ' primary' : ''), title: 'Circles on the map: size = spill volume, number = events', onclick: () => this.showMap(!this.mapOn) }, this.mapOn ? 'Hide on Map' : 'Show on Map'),
        h('button', { class: 'btn small', onclick: () => this.exportCSV(false) }, 'Export Summary'), h('button', { class: 'btn small', onclick: () => this.exportCSV(true) }, 'Export Events')));
      if (!this.rows) { E.appendChild(h('div', { class: 'hint', style: { padding: '12px' } }, 'Computing …')); return; }
      const rows = this.rows; const sp = rows.filter(r => r.events);
      const R = this.app.results; const days = R.meta.nPeriods * R.meta.reportStep / 86400;
      E.appendChild(h('div', { class: 'cmpkpis' }, [['Overflow points', String(rows.length)], ['Spilling', String(sp.length)], ['Spill events', String(sp.reduce((a, r) => a + r.events, 0))], ['Spills (12/24 h)', String(sp.reduce((a, r) => a + r.n1224, 0))], ['Spill volume (' + U.V + ')', (() => { const v = sp.reduce((a, r) => a + r.vol, 0); return v >= 100 ? Math.round(v).toLocaleString('en-US') : AV.fmt(v, 4); })()], ['Simulated period', days >= 2 ? AV.fmt(days, 1) + ' days' : AV.fmt(days * 24, 1) + ' h']]
        .map(([l, v]) => h('div', { class: 'cmpkpi neutral' }, h('div', { class: 'kl' }, l), h('div', { class: 'kv' }, h('span', { class: 'kc' }, v))))));
      const f = (v, d) => v === null || v === undefined ? '–' : d === 4 && Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : AV.fmt(v, d === undefined ? 3 : d);
      const dtf = (d) => d === null ? '–' : AV.fmtDateTime(d).slice(0, 16);
      const tb = h('table', { class: 'ptbl csotbl' }, h('tr', null, ['Overflow point', 'Type', 'Events', 'Spills 12/24 h', 'Volume (' + U.V + ')', 'Spill hours', 'Longest event (h)', 'Peak (' + U.Q + ')', 'First spill'].map(t => h('th', null, t))),
        rows.map(r => { const tr = h('tr', { class: (this.sel === r ? 'sel' : '') + (r.events ? '' : ' dim'), onclick: () => { this.sel = r; this.app.selectMany([r.o]); this.render(); }, ondblclick: () => { this.app.activateView('map'); this.app.map.zoomToObjects([r.o]); } },
          h('td', null, r.o.id), h('td', null, r.type), h('td', { class: 'num' }, String(r.events)), h('td', { class: 'num' }, String(r.n1224)), h('td', { class: 'num' }, f(r.vol, 4)), h('td', { class: 'num' }, f(r.hours, 2)), h('td', { class: 'num' }, f(r.longest, 2)), h('td', { class: 'num' }, f(r.peak)), h('td', null, dtf(r.first))); return tr; }));
      const evs = this.sel ? this.sel.E : [];
      const te = h('table', { class: 'ptbl csotbl' }, h('tr', null, ['#', 'Start', 'End', 'Duration (h)', 'Spilling (h)', 'Volume (' + U.V + ')', 'Peak (' + U.Q + ')', 'Time of peak'].map(t => h('th', null, t))),
        evs.map((e, i) => h('tr', null, h('td', { class: 'num' }, String(i + 1)), h('td', null, dtf(e.start)), h('td', null, dtf(e.end)), h('td', { class: 'num' }, f(e.dur, 2)), h('td', { class: 'num' }, f(e.spillH, 2)), h('td', { class: 'num' }, f(e.vol, 4)), h('td', { class: 'num' }, f(e.peak)), h('td', null, dtf(e.tpk)))));
      E.appendChild(h('div', { class: 'csobody' },
        h('div', { class: 'csopane' }, h('div', { class: 'psec2' }, 'Overflow points (click: events below, double-click: zoom)'), h('div', { class: 'ptwrap' }, tb)),
        h('div', { class: 'csopane' }, h('div', { class: 'psec2' }, this.sel ? 'Events of ' + this.sel.o.id + ' (' + evs.length + ')' : 'Events'), h('div', { class: 'ptwrap' }, evs.length ? te : h('div', { class: 'hint', style: { padding: '8px' } }, 'No spill.')),
          h('div', { class: 'hint', style: { padding: '6px 2px' } }, 'An event ends after ' + S.sep + ' h without spill. Resolution: the report time step (' + AV.fmt(R.meta.reportStep / 60, 1) + ' min). Spills 12/24 h: the first spill opens a 12 h block, every following 24 h block with a spill counts once more.'))));
    }
    showMap(on) {
      this.mapOn = on; AV.mapOverlays = (AV.mapOverlays || []).filter(f => f !== this._ov);
      if (on && this.rows) { this._ov = (map, ctx) => this.overlay(map, ctx); AV.mapOverlays.push(this._ov); }
      this.app.map.redrawOverlay(); if (this.el) this.render();
    }
    overlay(map, ctx) {
      const rows = (this.rows || []).filter(r => r.events); if (!rows.length) return; const m = this.app.model;
      const vmax = Math.max(...rows.map(r => r.vol)) || 1; const nmax = Math.max(...rows.map(r => r.events)) || 1;
      ctx.font = '600 11px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const r of rows) {
        let x, y; if (r.o.kind === 'NODE') { x = r.o.x; y = r.o.y; } else { const a = m.nodes.get(r.o.from), b = m.nodes.get(r.o.to); if (!a || !b) continue; x = (a.x + b.x) / 2; y = (a.y + b.y) / 2; }
        const [X, Y] = map.toScreen(x, y); const rad = 7 + 18 * Math.sqrt(r.vol / vmax); const t = r.events / nmax;
        ctx.beginPath(); ctx.arc(X, Y, rad, 0, 7); ctx.fillStyle = 'rgba(' + Math.round(255) + ',' + Math.round(160 - 140 * t) + ',' + Math.round(40 - 30 * t) + ',0.55)'; ctx.fill();
        ctx.lineWidth = r === this.sel ? 3 : 1.5; ctx.strokeStyle = r === this.sel ? '#0d47a1' : '#b71c1c'; ctx.stroke();
        ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.strokeText(String(r.events), X, Y); ctx.fillStyle = '#111'; ctx.fillText(String(r.events), X, Y);
      }
    }
    async exportCSV(events) {
      if (!this.rows) return; const U = this.units(); const q = (s) => /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s); const L = [];
      const dtf = (d) => d === null ? '' : AV.fmtDateTime(d).slice(0, 16);
      if (!events) { L.push(['Overflow point', 'Type', 'Events', 'Spills 12/24 h', 'Volume (' + U.V + ')', 'Spill hours', 'Longest event (h)', 'Peak (' + U.Q + ')', 'First spill'].join(','));
        for (const r of this.rows) L.push([q(r.o.id), r.type, r.events, r.n1224, r.vol.toPrecision(6), r.hours.toFixed(3), r.longest.toFixed(3), r.peak.toPrecision(5), dtf(r.first)].join(',')); }
      else { L.push(['Overflow point', 'Event', 'Start', 'End', 'Duration (h)', 'Spilling (h)', 'Volume (' + U.V + ')', 'Peak (' + U.Q + ')', 'Time of peak'].join(','));
        for (const r of this.rows) r.E.forEach((e, i) => L.push([q(r.o.id), i + 1, dtf(e.start), dtf(e.end), e.dur.toFixed(3), e.spillH.toFixed(3), e.vol.toPrecision(6), e.peak.toPrecision(5), dtf(e.tpk)].join(','))); }
      await AV.downloadText(L.join('\r\n') + '\r\n', (this.app.filePath ? AV.basename(this.app.filePath).replace(/\.inp$/i, '') : 'model') + (events ? '_cso_events.csv' : '_cso_summary.csv'), [{ name: 'CSV', extensions: ['csv'] }]);
    }
  }
  AV.openCSO = function (app) { app.cso = app.cso || new CsoView(app); app.cso.open(); };
})(window.AV);
