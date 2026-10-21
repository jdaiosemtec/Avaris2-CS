// Simulation options, engine run, results (report, plots, profiles, playback, exports)
'use strict';
(function (AV) {
  const h = AV.h;
  const VARS = {
    subcatch: ['Rainfall', 'Snow Depth', 'Evaporation', 'Infiltration', 'Runoff', 'GW Flow', 'GW Elevation', 'Soil Moisture'],
    node: ['Depth', 'Head (HGL)', 'Volume', 'Lateral Inflow', 'Total Inflow', 'Flooding'],
    link: ['Flow', 'Depth', 'Velocity', 'Volume', 'Capacity'],
    system: ['Temperature', 'Rainfall', 'Snow Depth', 'Infiltration', 'Runoff', 'DW Inflow', 'GW Inflow', 'RDII Inflow', 'Direct Inflow', 'Total Lateral Inflow', 'Flooding', 'Outflow', 'Storage Volume', 'Evaporation', 'PET'],
  };
  AV.RESULT_VARS = VARS;
  const kindToType = (k) => k === 'NODE' ? 'node' : k === 'LINK' ? 'link' : k === 'SUBCATCH' ? 'subcatch' : null;

  class Results {
    constructor(sim, meta, rpt) {
      this.sim = sim; this.meta = meta; this.handle = meta.handle; this.rpt = rpt; this.period = 0; this.snap = {}; this.nonconv = null;
      this.idx = {}; for (const t of ['subcatch', 'node', 'link']) { const m = new Map(); meta.ids[t].forEach((id, i) => m.set(id, i)); this.idx[t] = m; }
      this.varNames = {
        subcatch: VARS.subcatch.concat(meta.ids.pollut.map(p => 'Washoff ' + p)), node: VARS.node.concat(meta.ids.pollut.map(p => p + ' conc.')),
        link: VARS.link.concat(meta.ids.pollut.map(p => p + ' conc.')), system: VARS.system,
      };
      this.times = new Float64Array(meta.nPeriods); for (let i = 0; i < meta.nPeriods; i++) this.times[i] = (i + 1) * meta.reportStep / 3600;
    }
    async load() { this.stats = await window.host.outStatsAll(this.handle); await this.setPeriod(this.period); }
    async setPeriod(p) {
      this.period = Math.max(0, Math.min(this.meta.nPeriods - 1, p));
      const [s, n, l, sy] = await Promise.all(['subcatch', 'node', 'link', 'system'].map(t => window.host.outSnapshotAll(this.handle, this.period, t)));
      this.snap = { subcatch: s, node: n, link: l, system: sy };
    }
    // results index of an object; an object whose type changed since the run (e.g. a conduit converted to a pump)
    // has no results until the model is run again, so it is drawn with its own symbology instead of stale values
    index(o) { const t = kindToType(o.kind); if (!t) return null; const i = this.idx[t].get(o.id); if (i === undefined) return null;
      const LT = ['CONDUIT', 'PUMP', 'ORIFICE', 'WEIR', 'OUTLET'], NT = ['JUNCTION', 'OUTFALL', 'STORAGE', 'DIVIDER'];
      if (t === 'link' && this.meta.linkType && this.meta.linkType[i] !== undefined && LT[this.meta.linkType[i]] && LT[this.meta.linkType[i]] !== o.type) return null;
      if (t === 'node' && this.meta.nodeType && this.meta.nodeType[i] !== undefined && NT[this.meta.nodeType[i]] && NT[this.meta.nodeType[i]] !== o.type) return null;
      return { t, i }; }
    valueOf(o, v, isMax, abs) {
      const r = this.index(o); if (!r) return null; const nv = this.meta.nVars[r.t]; if (v >= nv) return null;
      if (isMax) { const st = this.stats[r.t]; return abs ? st.absmax[r.i * nv + v] : st.max[r.i * nv + v]; }
      const a = this.snap[r.t]; return a ? a[r.i * nv + v] : null;
    }
    timeLabel(p) { return AV.fmtDateTime(this.meta.startDate + (p + 1) * this.meta.reportStep / 86400); }
    // ---- conduit surcharge (1 = pressurised): conduit full and the water level at both ends above the pipe crown there
    _surGeom() {
      const m = this.sim.app.model; if (this._sg && this._sgModel === m && this._sgVer === m.geomVersion) return this._sg;
      const elevOff = /ELEVATION/i.test(m.options.LINK_OFFSETS || ''); const g = new Map();
      for (const l of m.links.values()) {
        if (l.type !== 'CONDUIT') continue; const a = m.nodes.get(l.from), b = m.nodes.get(l.to); const li = this.idx.link.get(l.id); if (!a || !b || li === undefined) continue;
        const ai = this.idx.node.get(a.id), bi = this.idx.node.get(b.id); if (ai === undefined || bi === undefined) continue;
        const yf = parseFloat(l.p.g1); if (!(yf > 0)) continue;
        const z1 = (elevOff ? +l.p.inOff : +a.p.elev + (+l.p.inOff || 0)) + yf, z2 = (elevOff ? +l.p.outOff : +b.p.elev + (+l.p.outOff || 0)) + yf;
        g.set(l.id, { li, ai, bi, z1, z2 });
      }
      this._sg = g; this._sgModel = m; this._sgVer = m.geomVersion; return g;
    }
    _surTest(G, ns, ls) { const nvn = this.meta.nVars.node, nvl = this.meta.nVars.link; return ls[G.li * nvl + 4] >= 0.999 && ns[G.ai * nvn + 1] > G.z1 && ns[G.bi * nvn + 1] > G.z2 ? 1 : 0; }
    surchargeNow(o) { if (!o || o.kind !== 'LINK') return null; const G = this._surGeom().get(o.id); if (!G || !this.snap.node || !this.snap.link) return null; return this._surTest(G, this.snap.node, this.snap.link); }
    surchargeStat(o, which) { if (!this.sur || !o) return null; const k = this.sur.get(o.id); return k ? (which === 'h' ? k.h : k.ever) : null; }
    async computeSurcharge(onDone) {
      if (this.sur) { if (onDone) onDone(); return this.sur; }
      if (this._surP) { await this._surP; if (onDone) onDone(); return this.sur; }
      this._surP = (async () => {
        const G = this._surGeom(); const acc = new Map(); for (const [id] of G) acc.set(id, { ever: 0, h: 0 });
        const dt = this.meta.reportStep / 3600, n = this.meta.nPeriods; const app = this.sim.app;
        for (let p = 0; p < n; p++) {
          if (p % 20 === 0) app.status('Computing conduit surcharge … ' + Math.round(100 * p / n) + ' %');
          const [ns, ls] = await Promise.all([window.host.outSnapshotAll(this.handle, p, 'node'), window.host.outSnapshotAll(this.handle, p, 'link')]);
          for (const [id, g] of G) if (this._surTest(g, ns, ls)) { const a = acc.get(id); a.ever = 1; a.h += dt; }
        }
        this.sur = acc; app.status('Conduit surcharge computed.');
      })();
      await this._surP; if (onDone) onDone(); return this.sur;
    }
    unitsFor(t, v) {
      const fu = AV.FLOW_UNIT_NAMES[this.meta.flowUnits] || 'CFS'; const si = this.meta.flowUnits >= 3;
      const L = si ? 'm' : 'ft', V = si ? 'm3' : 'ft3', R = si ? 'mm/hr' : 'in/hr', D = si ? 'mm' : 'in';
      if (t === 'node') return [L, L, V, fu, fu, fu][v] || 'conc';
      if (t === 'link') return [fu, L, L + '/s', V, 'fraction'][v] || 'conc';
      if (t === 'subcatch') return [R, D, R, R, fu, fu, L, 'fraction'][v] || 'mass';
      return ['deg', R, D, R, fu, fu, fu, fu, fu, fu, fu, fu, V, R, R][v] || '';
    }
  }
  AV.FLOW_UNIT_NAMES = ['CFS', 'GPM', 'MGD', 'CMS', 'LPS', 'MLD'];
  // recommended engine threads: by the size of the dynamic-wave problem (links incl. 2D surface links), at most
  // logical processors - 1, and never more than the engine accepts (4 links per thread)
  AV.recommendThreads = function (app, cpu) {
    const m = app.model; const mesh = AV.f2dEnabled(m) && app.mesh2d ? app.mesh2d : null;
    const links = m.links.size + (mesh ? mesh.links.length + mesh.couplings.length + mesh.outfalls.length : 0), nodes = m.nodes.size + (mesh ? mesh.cells.length + mesh.outfalls.length : 0);
    const max = Math.max(1, (cpu.logical || 1) - 1);
    let rec = links < 1000 ? 1 : links < 3000 ? 2 : links < 10000 ? 4 : links < 30000 ? 6 : 8;
    rec = Math.max(1, Math.min(rec, max, cpu.physical || max, Math.floor(links / 4) || 1));
    const text = m.nodes.size + ' nodes, ' + m.links.size + ' links' + (mesh ? ' + 2D: ' + mesh.cells.length + ' cells, ' + (mesh.links.length + mesh.couplings.length) + ' surface links' : '') + ' (' + nodes + ' nodes / ' + links + ' links in total)';
    return { max, rec, text, links, nodes };
  };

  // "Time Step" pane (right side): drag the slider / step buttons to see the selected object's results at each reporting time
  class TimeStepPane {
    constructor(app, host) {
      this.app = app; this.host = host;
      this.slider = h('input', { type: 'range', min: 0, max: 0, value: 0, oninput: (e) => app.sim.setPeriod(+e.target.value) });
      const B = (t, title, fn) => h('button', { class: 'tsb', title, onclick: fn }, t);
      const R = () => app.results;
      this.timeEl = h('div', { class: 'tstime' }, '-');
      this.table = h('div', { class: 'tsbody' });
      host.append(h('div', { class: 'ptitle' }, h('span', null, 'Time Step'), h('button', { class: 'btn small', title: 'Close', onclick: () => this.toggle(false) }, '×')),
        h('div', { class: 'tsctl' }, this.slider,
          h('div', { class: 'tsrow' }, B('«', 'First time step', () => R() && app.sim.setPeriod(0)), B('‹', 'Previous time step', () => R() && app.sim.setPeriod(R().period - 1)), this.timeEl,
            B('›', 'Next time step', () => R() && app.sim.setPeriod(R().period + 1)), B('»', 'Last time step', () => R() && app.sim.setPeriod(R().meta.nPeriods - 1)))),
        this.table);
      app.on('selection', () => this.refresh()); app.on('cellselect', () => this.refresh());
    }
    toggle(force) {
      const app = this.app; app.tsOpen = force === undefined ? !app.tsOpen : force;
      if (app.tsOpen && app.sim.playing) app.sim.stop();
      app.updateRightPanes(); app.refreshRibbon(); this.refresh();
    }
    refresh() {
      if (!this.app.tsOpen) return;
      const R = this.app.results, T = this.table; T.innerHTML = '';
      if (!R) { this.slider.disabled = true; this.timeEl.textContent = '-'; T.appendChild(h('div', { class: 'empty' }, 'Run a simulation (or load a results file) first.')); return; }
      this.slider.disabled = false; this.slider.max = R.meta.nPeriods - 1; this.slider.value = R.period; this.timeEl.textContent = R.timeLabel(R.period);
      let sel = [...this.app.selection].filter(o => R.index(o)).slice(0, 6);
      // a selected 2D cell (nothing else selected): its depth, water level, inflow ... at this time step
      if (!sel.length && this.app.mesh2d && this.app.meshSel >= 0 && this.app.mesh2d.cells[this.app.meshSel]) { const c = AV.cellNode(this.app, this.app.meshSel); if (R.index(c)) sel = [c]; }
      if (!sel.length) { T.appendChild(h('div', { class: 'empty' }, 'An object (or a 2D cell) must be selected to show results.')); return; }
      const r0 = R.index(sel[0]); const objs = sel.filter(o => R.index(o).t === r0.t);
      const nv = R.meta.nVars[r0.t]; const names = R.varNames[r0.t];
      const t = h('table', { class: 'histtbl tstbl' });
      t.appendChild(h('tr', null, [h('th', null, 'Variable')].concat(objs.map(o => h('th', null, objs.length > 1 ? o.id : o.mesh ? '2D Cell ' + o.id : 'Value')))));
      for (let v = 0; v < Math.min(nv, names.length); v++) {
        t.appendChild(h('tr', null, [h('td', null, names[v] + ' (' + R.unitsFor(r0.t, v) + ')')].concat(objs.map(o => { const r = R.index(o); return h('td', { class: 'num' }, AV.fmt(R.snap[r.t][r.i * nv + v])); }))));
      }
      T.appendChild(t);
    }
  }
  AV.TimeStepPane = TimeStepPane;

  class Sim {
    constructor(app) { this.app = app; this.playing = false; this.profileViews = []; this.scen = []; }
    get model() { return this.app.model; }

    // =============================================================== scenarios (other .inp files run alongside the current one)
    async clearScenarios() { for (const s of this.scen) { try { await window.host.outClose(s.handle); } catch (e) { } } this.scen = []; }
    async loadScenario(out, rpt, name) {
      const old = this.scen.find(s => s.name === name); if (old) { try { await window.host.outClose(old.handle); } catch (e) { } this.scen = this.scen.filter(s => s !== old); }
      const meta = await window.host.outOpen(out); const R = new Results(this, meta, rpt); R.scenName = name; R.outFile = out;
      R.stats = await window.host.outStatsAll(R.handle); try { R.reportText = await window.host.readText(rpt); } catch (e) { R.reportText = ''; }
      this.scen.push(R); return R;
    }
    // sources for comparison graphs: current results first, then loaded scenarios
    sources() { const out = []; const cur = this.app.filePath ? AV.basename(this.app.filePath).replace(/\.inp$/i, '') : 'Current'; if (this.results) out.push({ name: cur, res: this.results, current: true }); for (const s of this.scen) if (s.scenName !== cur || !this.results) out.push({ name: s.scenName, res: s }); if (this.compare) out.push({ name: 'Compare (' + AV.basename(this.compare.meta.file || 'run') + ')', res: this.compare }); return out; }

    // =============================================================== options
    // Simulation Options. The '2D Flood' tab belongs to the 2D module (AV.has2D); only2D opens that tab alone
    async optionsDialog(startTab, only2D) {
      if (only2D && !AV.has2D(this.app)) { AV.need2D(this.app, '2D Options'); return; }
      const o = this.model.options; const g = (k, d) => (o[k] !== undefined ? o[k] : d);
      const v = {
        FLOW_UNITS: g('FLOW_UNITS', 'CFS'), INFILTRATION: g('INFILTRATION', 'HORTON'), FLOW_ROUTING: g('FLOW_ROUTING', 'KINWAVE'), LINK_OFFSETS: g('LINK_OFFSETS', 'DEPTH'),
        MIN_SLOPE: g('MIN_SLOPE', '0'), ALLOW_PONDING: g('ALLOW_PONDING', 'NO'), SKIP_STEADY_STATE: g('SKIP_STEADY_STATE', 'NO'),
        IGNORE_RAINFALL: g('IGNORE_RAINFALL', 'NO'), IGNORE_SNOWMELT: g('IGNORE_SNOWMELT', 'NO'), IGNORE_GROUNDWATER: g('IGNORE_GROUNDWATER', 'NO'), IGNORE_RDII: g('IGNORE_RDII', 'NO'), IGNORE_ROUTING: g('IGNORE_ROUTING', 'NO'), IGNORE_QUALITY: g('IGNORE_QUALITY', 'NO'),
        START_DATE: g('START_DATE', '01/01/2026'), START_TIME: g('START_TIME', '00:00:00'), REPORT_START_DATE: g('REPORT_START_DATE', g('START_DATE', '01/01/2026')), REPORT_START_TIME: g('REPORT_START_TIME', g('START_TIME', '00:00:00')),
        END_DATE: g('END_DATE', g('START_DATE', '01/01/2026')), END_TIME: g('END_TIME', '06:00:00'), SWEEP_START: g('SWEEP_START', '01/01'), SWEEP_END: g('SWEEP_END', '12/31'), DRY_DAYS: g('DRY_DAYS', '0'),
        REPORT_STEP: g('REPORT_STEP', '00:15:00'), WET_STEP: g('WET_STEP', '00:05:00'), DRY_STEP: g('DRY_STEP', '01:00:00'), ROUTING_STEP: g('ROUTING_STEP', '0:00:20'), RULE_STEP: g('RULE_STEP', '00:00:00'),
        INERTIAL_DAMPING: g('INERTIAL_DAMPING', 'PARTIAL'), NORMAL_FLOW_LIMITED: g('NORMAL_FLOW_LIMITED', 'BOTH'), FORCE_MAIN_EQUATION: g('FORCE_MAIN_EQUATION', 'H-W'), SURCHARGE_METHOD: g('SURCHARGE_METHOD', 'EXTRAN'),
        VARIABLE_STEP: g('VARIABLE_STEP', '0.75'), LENGTHENING_STEP: g('LENGTHENING_STEP', '0'), MIN_SURFAREA: g('MIN_SURFAREA', '12.566'), MAX_TRIALS: g('MAX_TRIALS', '8'), HEAD_TOLERANCE: g('HEAD_TOLERANCE', '0.005'),
        SYS_FLOW_TOL: g('SYS_FLOW_TOL', '5'), LAT_FLOW_TOL: g('LAT_FLOW_TOL', '5'), MINIMUM_STEP: g('MINIMUM_STEP', '0.5'), THREADS: g('THREADS', '1'),
        UNDER_RELAXATION: g('UNDER_RELAXATION', '0.5'), NONCONV_REPORT_COUNT: g('NONCONV_REPORT_COUNT', '100'), detail: !!this.detailReport,
      };
      const D = this.app.defaults; for (const k in D) v['def_' + k] = D[k];
      const F2 = AV.f2d(this.model); for (const k of AV.F2D_KEYS) v['f2d_' + k] = F2[k]; v.f2d_ENABLED = AV.f2dEnabled(this.model); v.f2d_TAGALL = false; if (!/^(MODEL|CONVERT)$/i.test(v.f2d_UNITS)) v.f2d_UNITS = 'MODEL';
      const YN = ['NO', 'YES'];
      const tabs = {
        General: [
          { k: 'FLOW_UNITS', l: 'Flow Units', t: 'choice', o: AV.FLOW_UNIT_NAMES }, { k: 'FLOW_ROUTING', l: 'Routing Model', t: 'choice', o: ['DYNWAVE', 'KINWAVE', 'STEADY'] },
          { k: 'INFILTRATION', l: 'Infiltration Model', t: 'choice', o: ['HORTON', 'MODIFIED_HORTON', 'GREEN_AMPT', 'MODIFIED_GREEN_AMPT', 'CURVE_NUMBER'] },
          { k: 'LINK_OFFSETS', l: 'Link Offsets', t: 'choice', o: ['DEPTH', 'ELEVATION'] }, { k: 'MIN_SLOPE', l: 'Minimum Conduit Slope (%)', t: 'text' },
          { k: 'ALLOW_PONDING', l: 'Allow Ponding', t: 'choice', o: YN }, { k: 'SKIP_STEADY_STATE', l: 'Skip Steady State', t: 'choice', o: YN },
          { t: 'h', l: 'Process models' },
          { k: 'IGNORE_RAINFALL', l: 'Ignore Rainfall/Runoff', t: 'choice', o: YN }, { k: 'IGNORE_SNOWMELT', l: 'Ignore Snowmelt', t: 'choice', o: YN }, { k: 'IGNORE_GROUNDWATER', l: 'Ignore Groundwater', t: 'choice', o: YN },
          { k: 'IGNORE_RDII', l: 'Ignore RDII', t: 'choice', o: YN }, { k: 'IGNORE_ROUTING', l: 'Ignore Flow Routing', t: 'choice', o: YN }, { k: 'IGNORE_QUALITY', l: 'Ignore Water Quality', t: 'choice', o: YN }],
        Dates: [
          { k: 'START_DATE', l: 'Start Analysis Date', t: 'text' }, { k: 'START_TIME', l: 'Start Analysis Time', t: 'text' }, { k: 'REPORT_START_DATE', l: 'Start Reporting Date', t: 'text' },
          { k: 'REPORT_START_TIME', l: 'Start Reporting Time', t: 'text' }, { k: 'END_DATE', l: 'End Analysis Date', t: 'text' }, { k: 'END_TIME', l: 'End Analysis Time', t: 'text' },
          { k: 'SWEEP_START', l: 'Street Sweeping Start (MM/DD)', t: 'text' }, { k: 'SWEEP_END', l: 'Street Sweeping End (MM/DD)', t: 'text' }, { k: 'DRY_DAYS', l: 'Antecedent Dry Days', t: 'text' },
          { t: 'note', l: 'Dates as MM/DD/YYYY, times as HH:MM:SS.' }],
        'Time Steps': [
          { k: 'REPORT_STEP', l: 'Reporting Step (H:M:S)', t: 'text' }, { k: 'WET_STEP', l: 'Runoff Wet Step', t: 'text' }, { k: 'DRY_STEP', l: 'Runoff Dry Step', t: 'text' },
          { k: 'ROUTING_STEP', l: 'Routing Step (H:M:S or sec)', t: 'text' }, { k: 'RULE_STEP', l: 'Control Rule Step', t: 'text' },
          { k: 'SYS_FLOW_TOL', l: 'Steady State System Flow Tol. (%)', t: 'text' }, { k: 'LAT_FLOW_TOL', l: 'Steady State Lateral Flow Tol. (%)', t: 'text' }],
        'Dynamic Wave': [
          { k: 'INERTIAL_DAMPING', l: 'Inertial Terms', t: 'choice', o: ['PARTIAL', 'FULL', 'NONE'] }, { k: 'NORMAL_FLOW_LIMITED', l: 'Normal Flow Criterion', t: 'choice', o: ['BOTH', 'SLOPE', 'FROUDE'] },
          { k: 'FORCE_MAIN_EQUATION', l: 'Force Main Equation', t: 'choice', o: ['H-W', 'D-W'] }, { k: 'SURCHARGE_METHOD', l: 'Surcharge Method', t: 'choice', o: ['EXTRAN', 'SLOT'] },
          { k: 'VARIABLE_STEP', l: 'Variable Step Safety Factor (0 = off)', t: 'text' }, { k: 'MINIMUM_STEP', l: 'Minimum Variable Step (sec)', t: 'text' },
          { k: 'LENGTHENING_STEP', l: 'Conduit Lengthening Step (sec)', t: 'text' }, { k: 'MIN_SURFAREA', l: 'Minimum Nodal Surface Area', t: 'text' },
          { k: 'MAX_TRIALS', l: 'Maximum Trials per Step', t: 'text' }, { k: 'HEAD_TOLERANCE', l: 'Head Convergence Tolerance', t: 'text' }],
        'Avaris Engine': [
          { k: 'THREADS', l: 'Number of Threads (0 = all cores)', t: 'threads', note: 'Conduit flows and node depths are solved in parallel (OpenMP); results are identical for any number of threads. The engine uses 1 thread when the model has fewer than 4 links per thread.' },
          { k: 'UNDER_RELAXATION', l: 'Under-Relaxation Factor (0.1 - 1.0)', t: 'text', note: 'Weight given to the new iterate in the dynamic-wave Picard iterations (the standard value is 0.5). Lower values damp oscillation at hard-to-converge nodes; higher values converge faster on well-behaved networks.' },
          { k: 'NONCONV_REPORT_COUNT', l: 'Nonconverging Nodes Listed in Report', t: 'text', note: 'Length of the "Most Frequent Nonconverging Nodes" list (the standard report lists 5; max 500).' },
          { k: 'detail', l: 'Write time-series tables to report file', t: 'check', note: 'Off by default: results are read from the binary output file, which keeps the report file small for large models.' }],
        'Object Defaults': [
          { t: 'h', l: 'Nodes' }, { k: 'def_junctionDepth', l: 'Node max. depth', t: 'text' },
          { t: 'h', l: 'Conduits' }, { k: 'def_conduitDiameter', l: 'Conduit diameter / geom1', t: 'text' }, { k: 'def_conduitRough', l: 'Conduit roughness', t: 'text' },
          { k: 'def_conduitLength', l: 'Conduit length (if not auto)', t: 'text' }, { k: 'def_autoLength', l: 'Auto length from map', t: 'check' },
          { t: 'h', l: 'Subcatchments' }, { k: 'def_subArea', l: 'Area (if no map units)', t: 'text' }, { k: 'def_subWidth', l: 'Width', t: 'text' },
          { k: 'def_subImperv', l: '% Impervious', t: 'text' }, { k: 'def_subSlope', l: '% Slope', t: 'text' },
          { t: 'note', l: 'Applied to objects you add from now on; saved with your Avaris2 CS settings, not in the .inp file.' }],
        '2D Flood': [
          { k: 'f2d_ENABLED', l: 'Enable 1D-2D flood simulation', t: 'check' },
          { k: 'f2d_TAGALL', l: 'Tag all nodes "Link2D"', t: 'check', note: 'Writes the tag Link2D on every junction, storage unit and divider, so that all manholes are coupled to the 2D surface (only nodes tagged Link2D are coupled when any node has that tag). Rebuild the mesh afterwards.' },
          { t: 'h', l: 'Input layers' },
          { k: 'f2d_BOUNDARY', l: '2D Boundary (polygon)', t: 'file', ext: ['shp', 'geojson', 'json', 'kml'], note: 'Polygon(s) of the area to flood. Attribute "length" = cell size (map units), "roughness" = Manning n of the ground surface.' },
          { k: 'f2d_DEM', l: 'Digital Elevation Model', t: 'file', ext: ['tif', 'tiff', 'asc'], note: 'GeoTIFF or ASCII grid in the map coordinate system; cell elevations are read at the cell centres.' },
          { k: 'f2d_WATERFRONT', l: 'Water Front (line)', t: 'file', ext: ['shp', 'geojson', 'json', 'kml'], note: 'Optional. Lines where surface water leaves the model (river bank, coast); attribute "elev" = outlet elevation.' },
          { k: 'f2d_CUTOFF', l: 'Cut-off Lines', t: 'file', ext: ['shp', 'geojson', 'json', 'kml'], note: 'Optional. Walls / embankments: no surface flow across them.' },
          { k: 'f2d_EXCLUSION', l: 'Exclusion Polygons', t: 'file', ext: ['shp', 'geojson', 'json', 'kml'], note: 'Optional. Buildings and other areas without cells.' },
          { t: 'h', l: 'Mesh and run' },
          { k: 'f2d_CELL_SIZE', l: 'Cell Size (blank = boundary "length")', t: 'text' }, { k: 'f2d_ROUGHNESS', l: 'Surface Roughness (blank = boundary "roughness")', t: 'text' },
          { k: 'f2d_UNITS', l: 'Mesh Units', t: 'choice', o: ['MODEL', 'CONVERT'], note: 'MODEL (as Avaris DS): cell size and DEM / water-front elevations are used as they are, read in the model units. CONVERT: they are converted from the map units to the model units when the mesh is built (e.g. map and DEM in metres, model in US units: 100 m cells become 328 ft, DEM elevations in m become ft). Rebuild the mesh after changing. To run in other flow units, change the Flow Units in the status bar.' },
          { k: 'f2d_ROUTING_STEP', l: '2D Routing Step (sec, blank = model)', t: 'text' }, { k: 'f2d_FLOOD_DEPTH', l: 'Flood Depth Threshold', t: 'text', note: 'Cells deeper than this count as flooded for Time Ponded / Time to Recede.' },
          { t: 'note', l: 'After changing the layers or the cell size, use Create Meshes (Simulation ribbon, or right-click the 2D Meshes layer). The 1D-2D run writes <model>.finp / .frpt / .fout; the model file itself is not changed.' }],
      };
      if (only2D) { for (const k of Object.keys(tabs)) if (k !== '2D Flood') delete tabs[k]; } else if (!AV.has2D(this.app)) delete tabs['2D Flood'];
      const body = h('div', { style: { width: only2D ? '600px' : '560px', overflowX: 'hidden' } }); const tb = h('div', { class: 'tabs2' }); body.appendChild(tb);
      const inputs = {}; const pages = [];
      const t0 = Math.max(0, Object.keys(tabs).indexOf(startTab));
      Object.keys(tabs).forEach((name, ti) => {
        const form = h('div', { class: 'form', style: { display: ti !== t0 ? 'none' : 'grid' } });
        for (const f of tabs[name]) {
          if (f.t === 'h') { form.appendChild(h('h4', null, f.l)); continue; }
          if (f.t === 'note') { form.appendChild(h('div', { class: 'note' }, f.l)); continue; }
          let inp;
          if (f.t === 'choice') { inp = h('select', null, f.o.map(x => h('option', { value: x }, x))); inp.value = String(v[f.k]).toUpperCase(); }
          else if (f.t === 'check') inp = h('input', { type: 'checkbox', checked: !!v[f.k] });
          else if (f.t === 'threads') { const ti = h('input', { type: 'text', value: v[f.k], style: { width: '70px' } }); inputs[f.k] = ti; const info = h('div', { class: 'note thrinfo' });
            const detect = async () => { info.textContent = 'Scanning the system...'; const c = await window.host.cpuInfo(); const R = AV.recommendThreads(this.app, c);
              info.innerHTML = ''; info.append(h('div', null, h('b', null, 'This computer: '), (c.model ? c.model + ' - ' : '') + (c.physical ? c.physical + ' cores, ' : '') + c.logical + ' logical processors' + (c.memGB ? ', ' + c.memGB + ' GB RAM' : '')),
                h('div', null, h('b', null, 'Maximum recommended: '), String(R.max) + ' threads (logical processors - 1, one is left for Avaris2 CS and Windows)'),
                h('div', null, h('b', null, 'For this model: '), R.text + ' → ', h('b', null, R.rec + (R.rec > 1 ? ' threads' : ' thread')), ' ', h('button', { class: 'btn small', onclick: () => { ti.value = R.rec; } }, 'Use ' + R.rec)),
                h('div', null, 'Enter the number you want to use; scenarios running at the same time always use 1 thread each.')); };
            form.appendChild(h('label', null, f.l)); form.appendChild(h('div', { class: 'fpick', style: { maxWidth: 'none' } }, ti, h('button', { class: 'btn small', onclick: detect, title: 'Scan the processors of this computer and recommend a number of threads' }, 'Detect && Recommend')));
            form.appendChild(info); if (f.note) form.appendChild(h('div', { class: 'note' }, f.note)); continue; }
          else if (f.t === 'file') { const ti = h('input', { type: 'text', value: v[f.k] || '', style: { width: '190px' }, placeholder: '(none)' }); ti.title = v[f.k] || '';
            const app = this.app; inputs[f.k] = ti;
            form.appendChild(h('label', null, f.l)); form.appendChild(h('div', { class: 'fpick' }, ti,
              h('button', { class: 'btn small', title: 'Browse', onclick: async () => { const p = await window.host.openDialog({ title: f.l, filters: [{ name: f.l, extensions: f.ext }] }); if (p) ti.value = AV.f2dRelative(app, p); } }, '...'),
              h('button', { class: 'btn small', title: 'Clear', onclick: () => { ti.value = ''; } }, '✕')));
            if (f.note) form.appendChild(h('div', { class: 'note' }, f.note)); continue; }
          else inp = h('input', { type: 'text', value: v[f.k], style: { width: '160px' } });
          inputs[f.k] = inp; form.appendChild(h('label', null, f.l)); form.appendChild(inp);
          if (f.note) form.appendChild(h('div', { class: 'note' }, f.note));
        }
        pages.push(form); body.appendChild(form);
        tb.appendChild(h('div', { class: 't2' + (ti !== t0 ? '' : ' active'), onclick: (e) => { AV.$$('.t2', tb).forEach(t => t.classList.remove('active')); e.target.classList.add('active'); pages.forEach((p, j) => p.style.display = j === ti ? 'grid' : 'none'); } }, name));
      });
      const r = await AV.modal({ title: only2D ? '2D Options' : 'Simulation Options', body, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => { const out = {}; for (const k in inputs) out[k] = inputs[k].type === 'checkbox' ? inputs[k].checked : inputs[k].value.trim(); return out; } }] }).done;
      if (!r) return;
      // object defaults (app settings, not part of the model)
      const nd = {}; for (const k of Object.keys(r)) if (k.startsWith('def_')) { const key = k.slice(4), val = r[k]; delete r[k]; if (typeof val === 'boolean') nd[key] = val; else { const x = parseFloat(val); if (!isFinite(x)) { AV.alert('Object default "' + key + '" must be a number.'); return; } nd[key] = x; } }
      Object.assign(this.app.defaults, nd); this.app.settings.defaults = this.app.defaults; window.host.setSettings(this.app.settings);
      // 2D flood settings (stored in the model as ;;@OSEM2D lines)
      // "Tag all nodes Link2D" (one-off action, undoable)
      if (r.f2d_TAGALL) { const m = this.model; const objs = [...m.nodes.values()].filter(n => n.type !== 'OUTFALL' && String(n.tag || '') !== 'Link2D'); const old = objs.map(n => n.tag || '');
        if (objs.length) { this.app.exec({ label: 'Tag ' + objs.length + ' nodes Link2D', do: () => objs.forEach(n => { n.tag = 'Link2D'; }), undo: () => objs.forEach((n, i) => { n.tag = old[i]; }), changes: objs.map((n, i) => ({ o: n, key: 'tag', old: old[i], nw: 'Link2D' })) });
          AV.toast(objs.length + ' node(s) tagged Link2D. Rebuild the 2D mesh to couple them.', false, 6000); if (this.app.mesh2d) setTimeout(async () => { if (await AV.confirm('Nodes were tagged Link2D. Rebuild the 2D mesh now so that they are coupled to the surface?', 'Create Meshes', 'Rebuild', 'Later')) AV.createMeshes(this.app); }, 60); }
        else AV.toast('All nodes already have the tag Link2D.'); }
      delete r.f2d_TAGALL;
      if (Object.keys(r).some(k => k.startsWith('f2d_'))) { const n2 = {}; for (const k of Object.keys(r)) if (k.startsWith('f2d_')) { n2[k.slice(4)] = r[k]; delete r[k]; }
        n2.ENABLED = n2.ENABLED ? 'YES' : 'NO';
        for (const k of ['ROUTING_STEP', 'FLOOD_DEPTH', 'CELL_SIZE', 'ROUGHNESS']) if (n2[k] !== '' && !(parseFloat(n2[k]) >= 0)) { AV.alert('2D Flood: "' + k.replace('_', ' ').toLowerCase() + '" must be a number.'); return; }
        const m = this.model; const old2 = m.osem2d ? Object.assign({}, m.osem2d) : null; const nw2 = {}; for (const k of AV.F2D_KEYS) if (n2[k] !== '' && n2[k] !== undefined) nw2[k] = String(n2[k]);
        if (JSON.stringify(AV.f2d(m)) !== JSON.stringify(AV.f2d({ osem2d: nw2 }))) {
          const ch = AV.F2D_KEYS.filter(k => AV.f2d(m)[k] !== AV.f2d({ osem2d: nw2 })[k]).map(k => ({ o: { kind: 'OPTIONS', id: 'Options', type: '' }, key: '2D ' + k, old: AV.f2d(m)[k], nw: AV.f2d({ osem2d: nw2 })[k] }));
          this.app.exec({ label: '2D flood settings', do: () => { m.osem2d = Object.assign({}, nw2); }, undo: () => { m.osem2d = old2 ? Object.assign({}, old2) : undefined; }, changes: ch });
          this.app.panels.refreshLayers();
          const geo = ['BOUNDARY', 'DEM', 'WATERFRONT', 'CUTOFF', 'EXCLUSION', 'CELL_SIZE', 'ROUGHNESS'].some(k => ch.some(c => c.key === '2D ' + k));
          if (AV.f2dEnabled(m) && geo && nw2.BOUNDARY && nw2.DEM) setTimeout(async () => { if (await AV.confirm((this.app.mesh2d ? 'The 2D input layers changed. Rebuild the mesh now?' : 'Create the 2D mesh now?'), 'Create Meshes', 'Create Meshes', 'Later')) AV.createMeshes(this.app); }, 50);
        } }
      if (only2D) return;
      // validation
      const ur = parseFloat(r.UNDER_RELAXATION); if (!(ur >= 0.1 && ur <= 1)) { AV.alert('Under-relaxation factor must be between 0.1 and 1.0.'); return; }
      for (const k of ['START_DATE', 'END_DATE', 'REPORT_START_DATE']) if (AV.parseSwmmDate(r[k]) === null) { AV.alert('Invalid date for ' + k + ': ' + r[k]); return; }
      this.detailReport = r.detail; delete r.detail;
      // flow units: changed through the units switch (asks whether the values are converted)
      const newFU = r.FLOW_UNITS; delete r.FLOW_UNITS; if (newFU && newFU !== this.model.flowUnits) setTimeout(() => AV.changeFlowUnits(this.app, newFU), 50);
      const old = Object.assign({}, this.model.options); const nw = Object.assign({}, this.model.options);
      for (const k in r) {
        if (k === 'UNDER_RELAXATION' && +r[k] === 0.5 && old[k] === undefined) continue;
        if (k === 'NONCONV_REPORT_COUNT' && +r[k] === 100 && old[k] === undefined) continue;
        if (k.startsWith('IGNORE_') && r[k] === 'NO' && old[k] === undefined) continue;
        if (k === 'SURCHARGE_METHOD' && r[k] === 'EXTRAN' && old[k] === undefined) continue;
        nw[k] = r[k];
      }
      if (JSON.stringify(old) === JSON.stringify(nw)) return;
      const ch = Object.keys(nw).filter(k => String(nw[k]) !== String(old[k])).map(k => ({ o: { kind: 'OPTIONS', id: 'Options', type: '' }, key: k, old: old[k], nw: nw[k] }));
      this.app.exec({ label: 'Simulation options', do: () => this.model.options = Object.assign({}, nw), undo: () => this.model.options = Object.assign({}, old), changes: ch });
      this.app.refreshAll();
    }

    // =============================================================== run
    async run() {
      const m = this.model, app = this.app;
      if (!m.nodes.size) { AV.alert('The model has no nodes to simulate.'); return; }
      const v = AV.validateQuick(m);
      if (v.length) { if (!await AV.confirm('Possible problems found:\n\n' + v.slice(0, 15).join('\n') + (v.length > 15 ? '\n... (' + v.length + ' total)' : '') + '\n\nRun anyway?', 'Run Simulation', 'Run')) return; }
      // every run is named; its files go to <model>_Results (Database panel)
      const rn = await AV.askRunName(app); if (!rn) return;
      const dir = app.filePath ? AV.resultsDir(app.filePath) : AV.joinPath(app.info.temp, 'osemcm-runs');
      try { await window.host.mkdir(dir); } catch (e) { }
      const base = rn.name;
      if (this.results) await this.clearResults(true);
      const bar = h('div'); const pct = h('div', { style: { marginTop: '6px', color: 'var(--muted)' } }, 'Starting engine...');
      const t0 = Date.now();
      this.runDlg = AV.modal({ title: 'Running Simulation - ' + base, width: 440, body: h('div', null, h('div', { style: { marginBottom: '8px' } }, 'Avaris engine: ' + (m.options.FLOW_ROUTING || 'KINWAVE') + ' routing, ' + m.nodes.size + ' nodes, ' + m.links.size + ' links'), h('div', { class: 'progress' }, bar), pct), buttons: [{ label: 'Stop', danger: true, onClick: () => { window.host.cancelEngine('main'); return false; } }], enterSubmits: false });
      this.progEls = { bar, pct, t0 };
      app.status('Running simulation...');
      const encoding = app.filePath ? await window.host.encoding(app.filePath) : 'utf8';
      // 2D flood module: the mesh cells / surface links / couplings are added to a copy of the model (<model>.finp)
      let inpText = m.toINP({ reportAll: true }); let flood2d = false;
      if (AV.f2dEnabled(m) && !AV.has2D(app)) AV.toast('This model has 2D flood settings, but your licence is Avaris2 CS 1D: running the 1D model only.', false, 6000);
      if (AV.f2dEnabled(m) && AV.has2D(app)) {
        if (!app.mesh2d || !app.mesh2d.cells.length) { this.runDlg.close(); this.runDlg = null;
          const a = await AV.modal({ title: 'Run Simulation', body: h('div', { style: { maxWidth: '480px', lineHeight: 1.5 } }, '2D flooding is enabled but no mesh has been created for this model yet.'), buttons: [{ label: 'Cancel', value: null }, { label: 'Run 1D only', value: '1d' }, { label: 'Create Meshes', primary: true, value: 'mesh' }] }).done;
          if (a === 'mesh') { await AV.createMeshes(app); if (app.mesh2d && app.mesh2d.cells.length) return this.run(); return; }
          if (a !== '1d') return;
          this.runDlg = AV.modal({ title: 'Running Simulation - ' + base, width: 440, body: h('div', null, h('div', { class: 'progress' }, bar), pct), buttons: [{ label: 'Stop', danger: true, onClick: () => { window.host.cancelEngine(); return false; } }], enterSubmits: false });
        } else { inpText = AV.mesh2DToINP(m.toINP({ reportAll: true, runSI: AV.f2dRun(m).si }), app.mesh2d, m); flood2d = true; pct.textContent = 'Starting engine (1D-2D: ' + app.mesh2d.cells.length.toLocaleString() + ' surface cells)...'; }
      }
      const res = await window.host.runEngine({ inpText, dir, base, detail: !!this.detailReport, encoding, flood2d, named: true, id: 'main' });
      this.runDlg.close(); this.runDlg = null;
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (res.canceled) { app.status('Simulation stopped by user.'); AV.toast('Simulation stopped.'); return; }
      this.lastRun = res;
      let rptText = ''; try { rptText = await window.host.readText(res.rpt); } catch (e) { }
      const warnings = (rptText.match(/WARNING \d+[^\n]*/g) || []);
      { const ts0 = this.parseTimeStepSummary(rptText); await AV.writeRunMeta(AV.dirname(res.out), base, { name: base, desc: rn.desc, date: new Date().toISOString(), model: app.filePath ? AV.basename(app.filePath) : 'Untitled', type: flood2d ? '1D-2D' : '1D', flowUnits: m.flowUnits,
        code: res.code !== 0 || res.errors.length ? (res.code || 1) : 0, seconds: +secs, massBal: res.massBal, warnings: warnings.length, notConv: ts0['% of Steps Not Converging'] !== undefined ? +ts0['% of Steps Not Converging'] : undefined }); }
      if (app.db) app.db.render();
      if (res.code !== 0 || res.errors.length) {
        const errs = (rptText.match(/ERROR \d+[^\n]*/g) || res.errors).slice(0, 40);
        app.status('Simulation failed.');
        await AV.modal({ title: 'Run Status - Errors', width: 640, body: h('div', null, h('div', { style: { color: 'var(--danger)', fontWeight: 600, marginBottom: '8px' } }, 'The run was not successful.'), h('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap', maxHeight: '50vh', overflow: 'auto' } }, errs.join('\n') || 'Engine exit code ' + res.code)), buttons: [{ label: 'View Report', onClick: () => this.showReport(res.rpt) }, { label: 'Close', primary: true }] }).done;
        return;
      }
      await this.loadResults(res.out, res.rpt, true);
      const mb = res.massBal || {};
      const ts = this.parseTimeStepSummary(rptText);
      const kv = h('div', { class: 'kv' }, ['Run time', secs + ' s', 'Runoff continuity error', AV.fmt(mb.runoff, 2) + ' %', 'Flow routing continuity error', AV.fmt(mb.flow, 2) + ' %',
        'Warnings', String(warnings.length)].map(t => h('div', null, t)));
      if (ts['% of Steps Not Converging'] !== undefined) kv.append(h('div', null, '% of steps not converging'), h('div', null, ts['% of Steps Not Converging']));
      if (ts['Average Iterations per Step'] !== undefined) kv.append(h('div', null, 'Average iterations per step'), h('div', null, ts['Average Iterations per Step']));
      if (this.results && this.results.nonconv && this.results.nonconv.size) { const top = [...this.results.nonconv.entries()][0]; kv.append(h('div', null, 'Worst nonconverging node'), h('div', null, top[0] + ' (' + top[1].toFixed(2) + '%)')); }
      const good = Math.abs(mb.flow || 0) < 5 && Math.abs(mb.runoff || 0) < 5;
      app.status('Simulation complete in ' + secs + ' s.');
      const r = await AV.modal({ title: 'Run Status', width: 460, body: h('div', null, h('div', { style: { color: good ? 'var(--ok)' : 'var(--warn)', fontWeight: 600, marginBottom: '10px' } }, good ? 'Run was successful.' : 'Run completed - continuity errors are high, check the report.'), kv, warnings.length ? h('div', { style: { marginTop: '10px', maxHeight: '140px', overflow: 'auto', fontSize: '11.5px', color: 'var(--warn)' } }, warnings.slice(0, 20).map(w => h('div', null, w))) : null),
        buttons: [{ label: 'Convergence Diagnostics', value: 'conv' }, { label: 'View Report', value: 'rpt' }, { label: 'OK', primary: true, value: 'ok' }] }).done;
      if (r === 'rpt') this.showReport(); else if (r === 'conv') this.convergenceDiagnostics();
    }
    onProgress(p, id) {
      if (id && id !== 'main') { if (this.scenProgress) this.scenProgress(id, p); return; }
      if (!this.progEls) return;
      this.progEls.bar.style.width = Math.min(100, p) + '%';
      const el = (Date.now() - this.progEls.t0) / 1000; const eta = p > 1 ? el * (100 - p) / p : 0;
      this.progEls.pct.textContent = p.toFixed(1) + ' %   elapsed ' + el.toFixed(0) + ' s' + (p > 1 ? '   remaining ~' + eta.toFixed(0) + ' s' : '');
    }
    parseTimeStepSummary(t) {
      const out = {}; const i = t.indexOf('Routing Time Step Summary'); if (i < 0) return out;
      for (const line of t.slice(i, i + 1500).split('\n')) { const m = /^\s*(.+?)\s*:\s*([-\d.]+)/.exec(line); if (m) out[m[1].trim()] = m[2]; }
      return out;
    }
    parseNonconv(t) {
      const map = new Map(); const i = t.indexOf('Most Frequent Nonconverging Nodes'); if (i < 0) return map;
      const lines = t.slice(i).split('\n').slice(2);
      for (const line of lines) { const m = /^\s*Node\s+(\S+)\s+\(([\d.]+)%\)/.exec(line); if (m) map.set(m[1], parseFloat(m[2])); else if (line.trim() && !line.includes('Convergence obtained')) { if (map.size || line.includes('***')) break; } }
      return map;
    }
    async offerExistingResults(out, rpt, name) {
      if (await AV.confirm((name ? 'The latest simulation results of this model are "' + name + '".\n(All results are listed in the Database panel.)' : 'Results from a previous run were found next to this model:\n' + out) + '\n\nLoad them?', 'Load Results', 'Load', 'No')) this.loadResults(out, rpt, false);
    }
    async loadOutDialog() {
      const p = await window.host.openDialog({ title: 'Load results', filters: [{ name: 'Binary output', extensions: ['out', 'fout'] }] });
      if (p) this.loadResults(p, p.replace(/\.out$/i, '.rpt').replace(/\.fout$/i, '.frpt'), false);
    }
    async loadResults(out, rpt, fresh) {
      if (/\.fout$/i.test(out) && !AV.has2D(this.app)) { AV.need2D(this.app, '1D-2D results (.fout)'); return; }
      try {
        if (this.results) await this.clearResults(true);
        let _t = performance.now(); const meta = await window.host.outOpen(out); AV.perf.rec('Results: open file', performance.now() - _t);
        const R = new Results(this, meta, rpt);
        this.app.status('Reading results...');
        _t = performance.now(); await R.load(); AV.perf.rec('Results: statistics pass (whole file)', performance.now() - _t);
        this.results = this.app.results = R; await AV.computeMeshResults(this.app); this.app._meshRange = null;
        try { const t = await window.host.readText(rpt); R.nonconv = this.parseNonconv(t); R.reportText = t; } catch (e) { R.nonconv = new Map(); }
        // unmatched IDs check
        const missing = [...this.model.nodes.keys()].filter(id => !R.idx.node.has(id)).length;
        this.results = this.app.results = R;
        if (this.app.timeStep) setTimeout(() => this.app.timeStep.refresh(), 0);
        AV.$('#sbResults').textContent = 'Results: ' + meta.nPeriods + ' steps @ ' + AV.secToHms(meta.reportStep);
        const th = this.app.theme;
        // default themes: statistics (shown outside play mode) and dynamic results (shown while playing)
        const hasF = (L, re) => th.layers[L].subs.some(t => re.test(t.field || ''));
        if (!hasF('link', /^m:/)) th.layers.link.subs.push(th.newSub('link', 'm:4', 'Max. capacity'));
        if (!hasF('node', /^m:/)) th.layers.node.subs.push(th.newSub('node', 'm:full', 'Max. depth / max depth'));
        if (!hasF('link', /^r:/)) th.layers.link.subs.push(th.newSub('link', 'r:4', 'Capacity'));
        if (!hasF('node', /^r:/)) th.layers.node.subs.push(th.newSub('node', 'r:full', 'Depth / max depth'));
        th.refreshAutoRanges();
        // start at time of peak system total inflow
        const st = R.stats.system; const tPeak = st.tmax[9] || 0;
        await this.setPeriod(tPeak);
        this.buildPlaybar(); this.togglePlaybar(true);
        this.app.panels.showProps(); this.app.map.redraw();
        if (this.app.db) this.app.db.render();
        this.app.status('Results loaded' + (missing ? ' (' + missing + ' model nodes not found in results file)' : ''));
      } catch (e) { AV.alert('Could not load results:\n' + e.message, 'Results'); }
    }
    async clearResults(silent) {
      this.stop();
      if (this.results) { try { await window.host.outClose(this.results.handle); } catch (e) { } }
      this.results = this.app.results = null; this.app.meshResults = null; this.app.playMode = false;
      if (this.app.timeStep) this.app.timeStep.refresh();
      if (this.compare) { try { await window.host.outClose(this.compare.handle); } catch (e) { } this.compare = null; }
      const pb = AV.$('#playbar'); if (pb) { pb.classList.remove('show'); pb.innerHTML = ''; }
      AV.$('#sbResults') && (AV.$('#sbResults').textContent = 'No results');
      this.app.theme.invalidate();
      if (!silent) { this.app.panels.showProps(); this.app.map.redraw(); }
      if (this.app.db && this.app.leftTab === 'database') this.app.db.render();
    }

    // =============================================================== playback
    buildPlaybar() {
      const R = this.results, pb = AV.$('#playbar'); pb.innerHTML = '';
      this.slider = h('input', { type: 'range', min: 0, max: R.meta.nPeriods - 1, value: R.period, oninput: (e) => this.setPeriod(+e.target.value) });
      this.timeEl = h('span', { class: 'time' }, R.timeLabel(R.period));
      this.playBtn = h('button', { class: 'tb', title: 'Play / pause', onclick: () => this.playing ? this.stop() : this.play() }, AV.icon('play'));
      this.speed = h('select', { title: 'Playback speed' }, [['400', 'Slow'], ['150', 'Normal'], ['50', 'Fast'], ['10', 'Very fast']].map(([v, l]) => h('option', { value: v }, l))); this.speed.value = '150';
      pb.append(this.playBtn, h('button', { class: 'tb', title: 'Step back', onclick: () => this.setPeriod(R.period - 1) }, '◀'), h('button', { class: 'tb', title: 'Step forward', onclick: () => this.setPeriod(R.period + 1) }, '▶'),
        this.slider, this.timeEl, this.speed,
        h('button', { class: 'btn small', onclick: () => this.app.theme.dialog() }, 'Theme...'),
        h('button', { class: 'btn small', title: 'Jump to a peak time (choose which peak)', onclick: (e) => this.peakMenu(e) }, 'Peak ▾'),
        h('button', { class: 'btn small quitbtn', title: 'Quit the simulation results: stop playback, close the time bar and unload the results (the result files stay on disk)', onclick: () => this.quitResults() }, '✕ Quit'));
    }
    // Quit = leave play mode: playback stops, the time bar closes, dynamic-result themes and the "Results at" cards are
    // hidden. The results stay loaded (statistic themes, Statistic Results, graphs and profiles keep working).
    async quitResults() { this.setPlayMode(false); this.app.status('Play mode closed (results remain loaded).'); }
    setPlayMode(on) {
      const app = this.app; if (!on) this.stop();
      app.playMode = !!on && !!this.results;
      { const P = app.prefs.mesh2d || (app.prefs.mesh2d = {}); if (app.playMode && !AV.MESH_DYNAMIC[P.playField]) P.playField = AV.MESH_DYNAMIC[P.lastPlay] ? P.lastPlay : 'depth'; app._meshRange = null; }
      const pb = AV.$('#playbar'); if (pb) pb.classList.toggle('show', app.playMode);
      app.theme.invalidate(); app.map.redraw(); app.panels.showProps(); app.refreshRibbon && app.refreshRibbon();
      if (app.meshSel >= 0 && app.mesh2d && !app.selection.size) AV.showCellInfo(app, app.meshSel, true);
      if (app.symPane && app.symPane.target && app.symPane.target.mesh) app.symPane.render();
      app.activateView('map'); app.map.resize();
    }
    // "Peak" button: let the user choose which peak to jump to
    peakMenu(e) {
      const R = this.results; if (!R) return;
      const st = R.stats.system, sv = R.meta.nVars.system;
      const sys = (v) => (st && st.tmax && v < sv) ? st.tmax[v] : null;
      const lab = (p) => p === null || p === undefined ? '' : '   (' + R.timeLabel(p) + ')';
      const items = [];
      const add = (label, p) => { if (p !== null && p !== undefined) items.push({ label: label + lab(p), fn: () => this.setPeriod(p) }); };
      add('Peak rainfall', sys(1)); add('Peak runoff', sys(4)); add('Peak total lateral inflow', sys(9)); add('Peak flooding', sys(10)); add('Peak system outflow', sys(11)); add('Peak storage volume', sys(12));
      const sel = [...this.app.selection].filter(o => R.index(o)).slice(0, 5);
      if (sel.length) items.push('-');
      for (const o of sel) {
        const r = R.index(o); const nv = R.meta.nVars[r.t]; const tm = (v) => R.stats[r.t].tmax[r.i * nv + v];
        if (r.t === 'node') { add(o.id + ': max depth', tm(0)); add(o.id + ': max total inflow', tm(4)); if (R.stats.node.max[r.i * nv + 5] > 0) add(o.id + ': max flooding', tm(5)); }
        else if (r.t === 'link') { add(o.id + ': max flow', tm(0)); add(o.id + ': max capacity', tm(4)); }
        else if (r.t === 'subcatch') { add(o.id + ': max rainfall', tm(0)); add(o.id + ': max runoff', tm(4)); }
      }
      if (!sel.length) items.push('-', { label: 'Select an object to jump to its own peaks', disabled: true, fn: () => {} });
      const b = e.currentTarget.getBoundingClientRect(); this.app.contextMenu(b.left, b.top - 8 - items.length * 26, items);
    }
    // results file of the last run (or next to the model): Play reloads it after Quit instead of asking for a new run
    async lastResultsFile() {
      const ex = (f) => f ? window.host.exists(f) : false; const lr = this.lastRun;
      if (lr && lr.out && await ex(lr.out)) return { out: lr.out, rpt: lr.rpt };
      const fp = this.app.filePath; if (!fp) return null;
      const runs = await AV.listRuns(fp); const ok = runs.find(r => r.out && (!r.is2D || (this.app.mesh2d && AV.has2D(this.app)))); if (ok) return { out: ok.out, rpt: ok.rpt };
      const two = this.app.mesh2d && AV.has2D(this.app) ? [[fp.replace(/\.inp$/i, '.fout'), fp.replace(/\.inp$/i, '.frpt')]] : [];
      for (const [o, r] of two.concat([[fp.replace(/\.inp$/i, '.out'), fp.replace(/\.inp$/i, '.rpt')]])) if (o !== fp && await ex(o)) return { out: o, rpt: r };
      return null;
    }
    async togglePlaybar(force) {
      if (!this.results) { const f = await this.lastResultsFile(); if (f) { await this.loadResults(f.out, f.rpt, false); if (force === undefined && this.results) this.play(); return; }
        AV.toast('Run a simulation (or load a results file) first.'); return; }
      // Play: enter play mode and start; a second click leaves play mode (same as Quit)
      const show = force === undefined ? !this.app.playMode : force;
      this.setPlayMode(show); if (show && !this.playing && force === undefined) this.play();
    }
    async setPeriod(p) {
      const R = this.results; if (!R) return;
      if (this._busy) { this._pending = p; return; }
      this._busy = true;
      const _t = performance.now(); try { await R.setPeriod(p); } finally { this._busy = false; AV.perf.rec('Results: read one time step', performance.now() - _t); }
      if (this.slider) { this.slider.value = R.period; this.timeEl.textContent = R.timeLabel(R.period); }
      this.app._meshRange = null; this.app.map.redraw(); this.updatePropsResults(); if (this.app.timeStep) this.app.timeStep.refresh();
      for (const pv of this.profileViews) pv.draw();
      for (const c of AV.openCharts || []) { c.markerX = c.dateMode ? R.meta.startDate + (R.period + 1) * R.meta.reportStep / 86400 : R.times[R.period]; c.draw(); }
      if (this._pending !== undefined) { const q = this._pending; this._pending = undefined; if (q !== R.period) this.setPeriod(q); }
    }
    updatePropsResults() { const el = AV.$('#rescard-live'); if (el && this._liveObj) this.fillLive(el, this._liveObj);
      const a = this.app; if (a.mesh2d && a.meshSel >= 0 && !a.selection.size && AV.$('#props .pt') && /^2D Cell /.test(AV.$('#props .pt').textContent)) AV.showCellInfo(a, a.meshSel, true); }
    playIcons() { const ic = this.playing ? 'pause' : 'play'; this.playBtn && this.playBtn.replaceChildren(AV.icon(ic)); for (const b of [...(this.playBtns || [])]) { if (b.isConnected) b._seen = true; else if (b._seen) { this.playBtns.delete(b); continue; } b.replaceChildren(AV.icon(ic), h('span', null, this.playing ? ' Pause' : ' Play')); } }
    // a Play/Pause button for plot / graph windows (animates the time marker together with the map)
    makePlayButton() { const b = h('button', { class: 'btn small playbtn', title: 'Play / pause the results animation', onclick: () => { if (!this.results) { AV.toast('No results loaded.'); return; } this.playing ? this.stop() : this.play(); } }); (this.playBtns = this.playBtns || new Set()).add(b); this.playIcons(); return b; }
    play() {
      if (!this.results) return; this.playing = true; this.playIcons();
      const tick = async () => {
        if (!this.playing || !this.results) return;
        let p = this.results.period + 1; if (p >= this.results.meta.nPeriods) p = 0;
        await this.setPeriod(p);
        this._timer = setTimeout(tick, +(this.speed ? this.speed.value : 150));
      };
      tick();
    }
    stop() { this.playing = false; clearTimeout(this._timer); this.playIcons(); }

    // =============================================================== properties results card
    resultsCard(el, o) {
      const R = this.results; const r = R.index(o);
      if (!this.app.playMode) { if (r) el.appendChild(h('div', { style: { padding: '8px 10px 10px', display: 'flex', gap: '6px' } }, h('button', { class: 'btn', onclick: () => this.app.feat.graphTool([o]) }, 'Graph'), (o.kind === 'NODE' || o.kind === 'LINK') ? h('button', { class: 'btn', onclick: () => this.app.feat.profileTool() }, 'Long Section') : null)); return; }
      if (!r) { el.appendChild(h('div', { class: 'rescard' }, h('div', { class: 'rh' }, 'Results'), h('div', { class: 'empty' }, 'No results for this object.'))); return; }
      const card = h('div', { class: 'rescard', id: 'rescard-live' }); this._liveObj = o;
      this.fillLive(card, o); el.appendChild(card);
      const nv = R.meta.nVars[r.t]; const st = R.stats[r.t];
      const maxT = h('table'); const names = R.varNames[r.t];
      for (let v = 0; v < Math.min(nv, names.length); v++) {
        const k = r.i * nv + v; const isFlow = r.t === 'link' && v === 0;
        const val = isFlow ? st.absmax[k] : st.max[k];
        maxT.appendChild(h('tr', null, h('td', null, 'Max ' + names[v] + ' (' + R.unitsFor(r.t, v) + ')'), h('td', { style: { whiteSpace: 'nowrap' } }, AV.fmt(val), val ? h('span', { style: { color: 'var(--muted)', fontSize: '10.5px' } }, ' @' + AV.fmt(R.times[st.tmax[k]], 2) + 'h') : null)));
      }
      if (o.kind === 'LINK' && o.type === 'CONDUIT') {
        const td1 = h('td', null, '…'), td2 = h('td', null, '…');
        maxT.append(h('tr', null, h('td', { title: 'Surcharge = 1 when the conduit is full and the water level at both ends is above the pipe crown there' }, 'Max Surcharge (0/1)'), td1), h('tr', null, h('td', null, 'Surcharged Duration (hr)'), td2));
        R.computeSurcharge(() => { const a = R.surchargeStat(o, 'ever'), b = R.surchargeStat(o, 'h'); td1.textContent = a === null ? '-' : String(a); td2.textContent = b === null ? '-' : AV.fmt(b, 2); });
      }
      if (o.kind === 'NODE' && R.nonconv && R.nonconv.has(o.id)) maxT.appendChild(h('tr', null, h('td', { style: { color: 'var(--danger)' } }, 'Nonconverging steps'), h('td', { style: { color: 'var(--danger)' } }, R.nonconv.get(o.id).toFixed(2) + ' %')));
      el.appendChild(h('div', { class: 'rescard' }, h('div', { class: 'rh' }, 'Simulation Maxima'), maxT));
      el.appendChild(h('div', { style: { padding: '0 10px 10px', display: 'flex', gap: '6px' } }, h('button', { class: 'btn', onclick: () => this.app.feat.graphTool([o]) }, 'Graph'), (o.kind === 'NODE' || o.kind === 'LINK') ? h('button', { class: 'btn', onclick: () => this.app.feat.profileTool() }, 'Long Section') : null));
    }
    fillLive(card, o) {
      const R = this.results; const r = R.index(o); if (!r) return; card.innerHTML = '';
      const nv = R.meta.nVars[r.t]; const names = R.varNames[r.t]; const t = h('table');
      for (let v = 0; v < Math.min(nv, names.length); v++) t.appendChild(h('tr', null, h('td', null, names[v] + ' (' + R.unitsFor(r.t, v) + ')'), h('td', null, AV.fmt(R.snap[r.t][r.i * nv + v]))));
      if (o.kind === 'LINK' && o.type === 'CONDUIT') { const sv = R.surchargeNow(o); t.appendChild(h('tr', { class: sv ? 'surch' : '' }, h('td', { title: 'Surcharge = 1 when the conduit is full and the water level at both ends is above the pipe crown there' }, 'Surcharge (0/1)'), h('td', null, sv === null ? '-' : String(sv)))); }
      card.append(h('div', { class: 'rh' }, 'Results at ' + R.timeLabel(R.period)), t);
    }

    // =============================================================== report
    async showReport(path) {
      const rp = path || (this.results && this.results.rpt) || (this.lastRun && this.lastRun.rpt) || (this.app.filePath ? this.app.filePath.replace(/\.inp$/i, '.rpt') : null);
      if (!rp || !await window.host.exists(rp)) { AV.alert('No report file found. Run the simulation first.'); return; }
      const text = (await window.host.readText(rp)).replace(/^\s*OSEMCM HYDRAULIC ENGINE[^\n]*\n[^\n]*EPA SWMM[^\n]*\n\s*-{10,}\s*\n/, '');
      return AV.openReport(this.app, rp, text);
    }

    // =============================================================== nonconvergence diagnostics
    async convergenceDiagnostics() {
      const R = this.results;
      let text = R && R.reportText; if (!text) { const rp = (this.lastRun && this.lastRun.rpt) || (this.app.filePath ? this.app.filePath.replace(/\.inp$/i, '.rpt') : null); if (rp && await window.host.exists(rp)) text = await window.host.readText(rp); }
      if (!text) { AV.alert('Run a dynamic-wave simulation first.'); return; }
      const nc = this.parseNonconv(text); const ts = this.parseTimeStepSummary(text);
      const m = this.model; const adj = m.adjacency();
      // orifices touching the nonconverging nodes (the Avaris convergence fix converts these to short conduits)
      const orifices = new Map();
      for (const id of nc.keys()) for (const l of (adj.out.get(id) || []).concat(adj.inn.get(id) || [])) if (l.type === 'ORIFICE') orifices.set(l.id, l);
      const tbl = h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Node'), h('th', null, 'Type'), h('th', null, '% Steps Not Converged'), h('th', null, 'Adjacent orifices'))));
      const tb = h('tbody'); tbl.appendChild(tb);
      let i = 0;
      for (const [id, pct] of nc) {
        const n = m.nodes.get(id); const ors = (adj.out.get(id) || []).concat(adj.inn.get(id) || []).filter(l => l.type === 'ORIFICE').map(l => l.id);
        tb.appendChild(h('tr', { style: { cursor: 'pointer' }, onclick: () => { if (n) { this.app.select(n); this.app.activateView('map'); this.app.map.zoomToObjects([n]); } } },
          h('td', { class: 'num' }, String(++i)), h('td', null, id), h('td', null, n ? n.type : '(not in model)'), h('td', { class: 'num' }, pct.toFixed(2)), h('td', null, ors.join(', '))));
      }
      const kv = h('div', { class: 'kv', style: { margin: '8px 10px' } }); for (const k in ts) kv.append(h('div', null, k), h('div', null, ts[k]));
      const view = h('div', null,
        h('div', { class: 'grid-tools' },
          h('b', null, 'Nonconvergence Diagnostics'), h('span', { class: 'badge' }, nc.size + ' nodes listed'),
          h('button', { class: 'btn small', onclick: () => { this.app.theme.setAttr('node', 'nc'); this.app.activateView('map'); } }, 'Color Map by Nonconvergence'),
          h('button', { class: 'btn small', onclick: () => { const ns = [...nc.keys()].map(id => m.nodes.get(id)).filter(Boolean); this.app.selectMany(ns); this.app.activateView('map'); this.app.map.zoomToObjects(ns); } }, 'Select All Listed'),
          orifices.size ? h('button', { class: 'btn small primary', onclick: () => this.app.tools.orificeToConduit([...orifices.values()]) }, 'Convert ' + orifices.size + ' Adjacent Orifice(s) to Conduits...') : null),
        h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, h('div', { class: 'grid-scroll' }, tbl),
          h('div', { style: { width: '320px', borderLeft: '1px solid var(--border)', overflow: 'auto' } }, h('div', { class: 'ptitle' }, 'Routing Time Step Summary'), kv,
            h('div', { class: 'note', style: { padding: '8px 10px', color: 'var(--muted)', lineHeight: 1.5, fontSize: '11.5px' } },
              '"% of Steps Not Converging" counts a routing step as nonconverged when any single node fails to reach the head tolerance within the maximum trials. ',
              'The per-node percentages show where the problem is concentrated. Orifices are a frequent cause; converting them to short equivalent conduits ',
              '(10 ft, entry loss 0.5, exit loss 1.0, same shape and offset) usually removes the oscillation while keeping the hydrographs close. ',
              'Re-run and compare hydrographs (Results > Compare) to confirm.'))));
      this.app.closeView('conv'); this.app.addView('conv', 'Convergence', view);
    }

    // =============================================================== plots
    async plotDialog(preset) {
      if (!this.results) { AV.alert('Run a simulation (or load a results file) first.'); return; }
      const R = this.results; const sel = [...this.app.selection];
      const first = preset || sel[0];
      let kind = first ? (first.kind === 'GAGE' ? 'system' : kindToType(first.kind) || 'node') : 'node';
      const kindSel = h('select', null, [['node', 'Node'], ['link', 'Link'], ['subcatch', 'Subcatchment'], ['system', 'System']].map(([v, l]) => h('option', { value: v }, l))); kindSel.value = kind;
      const varSel = h('select'); const fillVars = () => { varSel.innerHTML = ''; R.varNames[kindSel.value].slice(0, R.meta.nVars[kindSel.value]).forEach((n, i) => varSel.appendChild(h('option', { value: i }, n))); };
      fillVars();
      const ids = h('textarea', { rows: 6, style: { width: '100%', fontFamily: 'var(--mono)' } }, sel.filter(o => kindToType(o.kind) === kind).map(o => o.id).slice(0, 12).join('\n'));
      kindSel.addEventListener('change', () => { fillVars(); ids.value = sel.filter(o => kindToType(o.kind) === kindSel.value).map(o => o.id).slice(0, 12).join('\n'); });
      const xMode = h('select', null, [['h', 'Elapsed hours'], ['d', 'Date / time']].map(([v, l]) => h('option', { value: v }, l)));
      const comp = h('input', { type: 'checkbox', checked: !!this.compare, disabled: !this.compare });
      const body = h('div', { class: 'form', style: { width: '460px' } }, h('label', null, 'Object type'), kindSel, h('label', null, 'Variable'), varSel, h('label', null, 'Time axis'), xMode,
        h('label', { class: 'full' }, 'Object IDs (one per line; selected objects are pre-filled)'), ids,
        h('label', null, 'Overlay comparison run'), comp, h('div', { class: 'note' }, this.compare ? 'Comparison file: ' + this.compare.meta.file : 'Use Results > Compare Hydrographs to load a second results file.'));
      const r = await AV.modal({ title: 'Time Series Plot', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Plot', primary: true, onClick: () => ({ t: kindSel.value, v: +varSel.value, ids: ids.value.split(/[\s,]+/).filter(Boolean), x: xMode.value, comp: comp.checked }) }] }).done;
      if (!r) return;
      if (r.t !== 'system' && !r.ids.length) { AV.toast('Enter at least one object ID.', true); return; }
      this.openPlot(r.t, r.v, r.t === 'system' ? ['System'] : r.ids, r.x, r.comp);
    }
    quickPlot(o) {
      if (this.app.feat) { this.app.feat.graphTool([o]); return; }
      const t = kindToType(o.kind); if (!t) return;
      this.openPlot(t, t === 'node' ? 0 : t === 'link' ? 0 : 4, [o.id], 'h', !!this.compare);
    }
    async openPlot(t, v, ids, xmode, withCompare) {
      const R = this.results; const series = [];
      const xs = (meta) => { const a = new Float64Array(meta.nPeriods); for (let i = 0; i < meta.nPeriods; i++) a[i] = xmode === 'd' ? meta.startDate + (i + 1) * meta.reportStep / 86400 : (i + 1) * meta.reportStep / 3600; return a; };
      const add = async (res, label, dash) => {
        for (const id of ids) {
          const i = t === 'system' ? 0 : res.idx[t].get(id);
          if (i === undefined) { if (!dash) AV.toast('"' + id + '" not found in results.', true); continue; }
          const y = await window.host.outSeries(res.handle, t, i, v);
          series.push({ name: (t === 'system' ? 'System' : id) + (label ? ' ' + label : ''), x: xs(res.meta), y, dash });
        }
      };
      await add(R, withCompare && this.compare ? '(current)' : '', null);
      if (withCompare && this.compare) await add(this.compare, '(compare)', [6, 4]);
      if (withCompare && this.compare) series.forEach((s, i) => s.color = AV.SERIES_COLORS[(s.dash ? i - ids.length : i) % AV.SERIES_COLORS.length]);
      if (!series.length) return;
      const id = 'plot' + (this._plotSeq = (this._plotSeq || 0) + 1);
      const tools = h('div', { class: 'chart-tools' });
      const wrap = h('div', null, tools);
      const chart = new AV.Chart(wrap, {});
      const vname = R.varNames[t][v];
      const isRain = (t === 'subcatch' && v === 0) || (t === 'system' && v === 1);
      if (isRain && series.length <= 4) series.forEach(s => { if (!s.dash) s.bars = true; });
      chart.setSeries(series, { invert: isRain && this.app.prefs.invertRain, yLabel: vname + ' (' + R.unitsFor(t, v) + ')', xLabel: xmode === 'd' ? 'Date / Time' : 'Elapsed Time (hours)', title: ({ node: 'Node ', link: 'Link ', subcatch: 'Subcatchment ', system: '' })[t] + vname, xFmt: xmode === 'd' ? (x) => AV.fmtDateTime(x).slice(0, 16) : null });
      chart.dateMode = xmode === 'd'; chart.markerX = chart.dateMode ? R.meta.startDate + (R.period + 1) * R.meta.reportStep / 86400 : R.times[R.period];
      tools.append(this.makePlayButton());
      tools.append(h('button', { class: 'btn small', onclick: () => AV.downloadText(chart.toCSV(), vname.replace(/\W+/g, '_') + '.csv') }, 'Export CSV'),
        h('button', { class: 'btn small', onclick: async () => { const p = await window.host.saveDialog({ defaultPath: 'plot.png', filters: [{ name: 'PNG', extensions: ['png'] }] }); if (p) { const b = atob(chart.toPNG().split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); await window.host.writeBinary(p, a); AV.toast('Saved ' + p); } } }, 'Save PNG'),
        h('button', { class: 'btn small', onclick: () => { this.plotDialog(); } }, 'New Plot...'),
        h('span', { style: { color: 'var(--muted)', marginLeft: '8px' } }, 'Drag to zoom, double-click to reset.'));
      AV.openCharts = AV.openCharts || []; AV.openCharts.push(chart);
      this.app.addView(id, 'Plot: ' + (ids.length === 1 ? ids[0] : ids.length + ' objects') + ' ' + vname, wrap, { onClose: () => { AV.openCharts = AV.openCharts.filter(c => c !== chart); } });
      setTimeout(() => chart.resize(), 20);
    }
    async compareDialog() {
      if (!this.results) { AV.alert('Load or run the current model results first, then choose the run to compare against.'); return; }
      const p = await window.host.openDialog({ title: 'Results file to compare against (e.g. the run before a modification)', filters: [{ name: 'Binary output', extensions: ['out'] }] });
      if (!p) return;
      if (await this.loadCompare(p)) { AV.toast('Comparison run loaded. New plots will overlay it (dashed lines).'); this.plotDialog(); }
    }
    async loadCompare(p) {
      try {
        if (this.compare) await window.host.outClose(this.compare.handle);
        const meta = await window.host.outOpen(p);
        const idx = {}; for (const t of ['subcatch', 'node', 'link']) { const m = new Map(); meta.ids[t].forEach((id, i) => m.set(id, i)); idx[t] = m; }
        this.compare = { meta, handle: meta.handle, idx };
        return true;
      } catch (e) { AV.alert('Could not open file: ' + e.message); return false; }
    }

    // =============================================================== profile
    profileFromSelection() { if (this.app.feat) { this.app.feat.profileTool(); return; } return this.profileFromSelectionOld(); }
    profileFromSelectionOld() {
      const sel = [...this.app.selection];
      const nodes = sel.filter(o => o.kind === 'NODE'), links = sel.filter(o => o.kind === 'LINK');
      if (nodes.length >= 2) return this.openProfile(nodes[0].id, nodes[nodes.length - 1].id);
      if (links.length) {
        // order links into a chain
        const ids = new Set(links.map(l => l.id));
        let start = links.find(l => !links.some(k => k.to === l.from)) || links[0];
        const chain = [start]; let cur = start;
        while (true) { const nx = links.find(l => l.from === cur.to && ids.has(l.id) && !chain.includes(l)); if (!nx) break; chain.push(nx); cur = nx; }
        return this.openProfile(chain[0].from, chain[chain.length - 1].to);
      }
      this.profileDialog();
    }
    async profileDialog() { if (this.app.feat) { this.app.feat.profileTool(); return; } return this.profileDialogOld(); }
    async profileDialogOld() {
      const sel = [...this.app.selection].filter(o => o.kind === 'NODE');
      const r = await AV.formDialog('Profile Plot', [{ k: 'from', l: 'Start node (upstream)', t: 'text' }, { k: 'to', l: 'End node (downstream)', t: 'text' },
      { t: 'note', l: 'The path follows link directions downstream; if none exists, any connected path is used. Tip: select two nodes on the map first.' }], { from: sel[0] ? sel[0].id : '', to: sel[1] ? sel[1].id : '' });
      if (!r) return; this.openProfile(r.from.trim(), r.to.trim());
    }
    openProfile(from, to) {
      const m = this.model;
      if (!m.nodes.has(from) || !m.nodes.has(to)) { AV.alert('Start or end node not found.'); return; }
      const path = AV.findPath(m, from, to, true) || AV.findPath(m, from, to, false);
      if (!path) { AV.alert('No connected path between ' + from + ' and ' + to + '.'); return; }
      const view = new AV.ProfileView(this.app, path);
      this.profileViews.push(view);
      this.app.addView('profile' + (this._profSeq = (this._profSeq || 0) + 1), 'Profile: ' + from + ' → ' + to, view.el, { onClose: () => { this.profileViews = this.profileViews.filter(v => v !== view); } });
      setTimeout(() => view.resize(), 20);
    }

    // =============================================================== exports
    needResults() { if (!this.results) { AV.alert('Run a simulation (or load a results file) first.'); return false; } return true; }
    async exportByTime() {
      if (!this.needResults()) return; const R = this.results;
      const r = await AV.formDialog('Export CSV by Time', [{ k: 't', l: 'Object type', t: 'choice', o: [['node', 'Nodes'], ['link', 'Links'], ['subcatch', 'Subcatchments']] }, { k: 'p', l: 'Time step index (1-' + R.meta.nPeriods + ')', t: 'num' }], { t: 'link', p: R.period + 1 });
      if (!r) return;
      const p = Math.max(0, Math.min(R.meta.nPeriods - 1, r.p - 1)); const a = await window.host.outSnapshotAll(R.handle, p, r.t);
      const nv = R.meta.nVars[r.t]; const names = R.varNames[r.t].slice(0, nv);
      const rows = [['ID'].concat(names.map((n, v) => n + ' (' + R.unitsFor(r.t, v) + ')')).map(AV.csvCell).join(',')];
      R.meta.ids[r.t].forEach((id, i) => rows.push([id].concat(Array.from(a.subarray(i * nv, i * nv + nv))).map(AV.csvCell).join(',')));
      AV.downloadText('# ' + R.timeLabel(p) + '\n' + rows.join('\n'), r.t + '_at_step_' + (p + 1) + '.csv');
    }
    async exportByVariable() {
      if (!this.needResults()) return; const R = this.results;
      const r = await AV.formDialog('Export CSV by Variable', [{ k: 't', l: 'Object type', t: 'choice', o: [['node', 'Nodes'], ['link', 'Links'], ['subcatch', 'Subcatchments'], ['system', 'System']] },
      { k: 'v', l: 'Variable index (0 = Depth/Flow/Rainfall ...)', t: 'num' }, { k: 'which', l: 'Objects', t: 'choice', o: [['sel', 'Selected objects'], ['all', 'All objects (may be large)']] },
      { t: 'note', l: 'Nodes: 0 Depth, 1 Head, 2 Volume, 3 Lateral Inflow, 4 Total Inflow, 5 Flooding.  Links: 0 Flow, 1 Depth, 2 Velocity, 3 Volume, 4 Capacity.  Subcatchments: 0 Rainfall, 3 Infiltration, 4 Runoff.' }], { t: 'link', v: 0, which: 'sel' });
      if (!r) return;
      let ids = r.t === 'system' ? ['System'] : r.which === 'all' ? R.meta.ids[r.t] : [...this.app.selection].filter(o => kindToType(o.kind) === r.t).map(o => o.id);
      if (!ids.length) { AV.alert('No objects of that type are selected.'); return; }
      if (ids.length > 2000 && !await AV.confirm('Export ' + ids.length + ' time series? This may take a while.')) return;
      const cols = [];
      for (const id of ids) { const i = r.t === 'system' ? 0 : R.idx[r.t].get(id); if (i === undefined) continue; cols.push([id, await window.host.outSeries(R.handle, r.t, i, r.v)]); }
      const rows = [['DateTime', 'Hours'].concat(cols.map(c => c[0])).map(AV.csvCell).join(',')];
      for (let p = 0; p < R.meta.nPeriods; p++) rows.push([R.timeLabel(p), R.times[p].toFixed(4)].concat(cols.map(c => c[1][p])).map(AV.csvCell).join(','));
      AV.downloadText(rows.join('\n'), r.t + '_' + (R.varNames[r.t][r.v] || 'var').replace(/\W+/g, '_') + '.csv');
    }
    async exportByStats() {
      if (!this.needResults()) return; const R = this.results;
      const r = await AV.formDialog('Export CSV by Statistics', [{ k: 't', l: 'Object type', t: 'choice', o: [['node', 'Nodes'], ['link', 'Links'], ['subcatch', 'Subcatchments']] }], { t: 'node' });
      if (!r) return;
      const nv = R.meta.nVars[r.t]; const names = R.varNames[r.t].slice(0, nv); const st = R.stats[r.t];
      const hdr = ['ID']; names.forEach((n, v) => hdr.push('Max ' + n, 'Min ' + n, 'Mean ' + n, 'Hours at |Max| ' + n));
      if (r.t === 'node') hdr.push('Nonconverging %');
      const rows = [hdr.map(AV.csvCell).join(',')];
      R.meta.ids[r.t].forEach((id, i) => {
        const row = [id];
        for (let v = 0; v < nv; v++) { const k = i * nv + v; row.push(st.max[k], st.min[k], st.mean[k], R.times[st.tmax[k]].toFixed(3)); }
        if (r.t === 'node') row.push(R.nonconv && R.nonconv.has(id) ? R.nonconv.get(id) : 0);
        rows.push(row.map(AV.csvCell).join(','));
      });
      AV.downloadText(rows.join('\n'), r.t + '_statistics.csv');
    }
  }
  AV.Sim = Sim;

  // =================================================================== path finding
  AV.findPath = function (m, from, to, directed) {
    const adj = new Map();
    for (const l of m.links.values()) {
      if (!adj.has(l.from)) adj.set(l.from, []); adj.get(l.from).push([l.to, l, 1]);
      if (!directed) { if (!adj.has(l.to)) adj.set(l.to, []); adj.get(l.to).push([l.from, l, -1]); }
    }
    // Dijkstra by conduit length
    const dist = new Map([[from, 0]]), prev = new Map(); const done = new Set();
    const heap = [[0, from]];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (; ;) { const a = 2 * i + 1, b = a + 1; let s = i; if (a < heap.length && heap[a][0] < heap[s][0]) s = a; if (b < heap.length && heap[b][0] < heap[s][0]) s = b; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return top; };
    while (heap.length) {
      const [d, u] = pop(); if (done.has(u)) continue; done.add(u); if (u === to) break;
      for (const [v, l, dir] of adj.get(u) || []) {
        const w = Math.max(+l.p.length || m.linkLengthGeom(l) || 1, 0.01);
        if (!dist.has(v) || d + w < dist.get(v)) { dist.set(v, d + w); prev.set(v, [u, l, dir]); push([d + w, v]); }
      }
    }
    if (!dist.has(to)) return null;
    const nodes = [to], links = []; let cur = to;
    while (cur !== from) { const [u, l, dir] = prev.get(cur); links.unshift({ link: l, dir }); nodes.unshift(u); cur = u; }
    return { nodes, links };
  };

  // =================================================================== quick validation before a run
  AV.validateQuick = function (m) {
    const out = [];
    for (const l of m.links.values()) {
      if (!m.nodes.has(l.from)) out.push('Link ' + l.id + ': inlet node "' + l.from + '" not found');
      if (!m.nodes.has(l.to)) out.push('Link ' + l.id + ': outlet node "' + l.to + '" not found');
      if (l.type === 'CONDUIT' && !(+l.p.length > 0)) out.push('Conduit ' + l.id + ': length must be > 0');
      if (l.type === 'CONDUIT' && !(parseFloat(l.p.g1) > 0) && !['IRREGULAR', 'STREET', 'DUMMY'].includes(l.p.shape)) out.push('Conduit ' + l.id + ': cross-section depth must be > 0');
      if (l.type === 'PUMP' && l.p.curve !== '*' && !m.curves.has(l.p.curve)) out.push('Pump ' + l.id + ': curve "' + l.p.curve + '" not defined');
    }
    for (const s of m.subcatchments.values()) {
      if (s.p.gage && !m.gages.has(s.p.gage) && s.p.gage !== '*') out.push('Subcatchment ' + s.id + ': rain gage "' + s.p.gage + '" not found');
      if (s.p.outlet && !m.nodes.has(s.p.outlet) && !m.subcatchments.has(s.p.outlet)) out.push('Subcatchment ' + s.id + ': outlet "' + s.p.outlet + '" not found');
      if (!s.p.outlet) out.push('Subcatchment ' + s.id + ': no outlet assigned');
    }
    for (const g of m.gages.values()) if (g.p.source === 'TIMESERIES' && !m.timeseries.has(g.p.series)) out.push('Rain gage ' + g.id + ': time series "' + g.p.series + '" not found');
    const deg = new Map(); for (const l of m.links.values()) { deg.set(l.from, (deg.get(l.from) || 0) + 1); deg.set(l.to, (deg.get(l.to) || 0) + 1); }
    for (const o of m.nodes.values()) {
      if (o.type === 'OUTFALL' && (deg.get(o.id) || 0) > 1) out.push('Outfall ' + o.id + ' has more than one connecting link');
    }
    if (![...m.nodes.values()].some(n => n.type === 'OUTFALL') && m.links.size) out.push('The network has no outfall');
    return out;
  };
})(window.AV);
