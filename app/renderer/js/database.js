// Database (left dock): the base model (.inp) and the simulation results made from it.
// Every run is named by the user and stored in <model folder>/<model>_Results/<run>.{inp|finp, rpt|frpt, out|fout, json};
// running again under the same name replaces that run, so result files only grow when the user keeps new runs.
'use strict';
(function (AV) {
  const h = AV.h;
  const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return 'Run_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()); };
  AV.resultsDir = (modelPath) => modelPath ? AV.joinPath(AV.dirname(modelPath), AV.basename(modelPath).replace(/\.inp$/i, '') + '_Results') : null;
  // runs of a model, newest first: [{ name, out, rpt, inp, is2D, meta, mtime }]
  AV.listRuns = async function (modelPath) {
    const dir = AV.resultsDir(modelPath); if (!dir || !await window.host.exists(dir)) return [];
    let files = []; try { files = await window.host.listDir(dir); } catch (e) { return []; }
    const runs = new Map(); const get = (n) => { let r = runs.get(n); if (!r) runs.set(n, r = { name: n, mtime: 0 }); return r; };
    for (const f of files) { if (f.dir) continue; const m = /^(.*)\.(out|fout|rpt|frpt|inp|finp|json)$/i.exec(f.name); if (!m) continue; const r = get(m[1]); const e = m[2].toLowerCase(); const p = AV.joinPath(dir, f.name);
      if (e === 'out' || e === 'fout') { r.out = p; r.is2D = e === 'fout'; r.mtime = Math.max(r.mtime, f.mtime); r.size = f.size; } else if (e === 'rpt' || e === 'frpt') r.rpt = p; else if (e === 'json') r.json = p; else r.inp = p; }
    const out = [...runs.values()].filter(r => r.out || r.json || r.rpt);
    for (const r of out) { if (r.json) { try { r.meta = JSON.parse(await window.host.readText(r.json)); } catch (e) { r.meta = null; } } r.mtime = r.mtime || (r.meta && Date.parse(r.meta.date)) || 0; }
    return out.sort((a, b) => b.mtime - a.mtime);
  };
  // Run dialog: the user names the simulation result (an existing name is replaced after confirmation)
  AV.askRunName = async function (app, title, opts = {}) {
    const runs = app.filePath ? await AV.listRuns(app.filePath) : [];
    const name = h('input', { type: 'text', value: app._lastRunName && !opts.fresh ? app._lastRunName : stamp(), style: { width: '100%' } });
    const desc = h('input', { type: 'text', value: '', placeholder: '(optional) e.g. 100-yr storm, pumps upgraded', style: { width: '100%' } });
    const list = h('div', { class: 'runpick' }, runs.length ? runs.slice(0, 12).map(r => h('div', { class: 'runpickrow', title: 'Use this name (the run is replaced)', onclick: () => { name.value = r.name; if (r.meta && r.meta.desc) desc.value = r.meta.desc; } }, h('b', null, r.name), ' ', h('span', null, r.meta ? new Date(r.meta.date).toLocaleString() + (r.meta.type ? ' · ' + r.meta.type : '') : ''))) : h('div', { class: 'dbempty' }, 'No simulation results yet.'));
    // run mode: whole model, or coupled parallel when the model has been partitioned (Tools > Partition Model)
    const ci = opts.coupled; let modeEl = null; const rWhole = h('input', { type: 'radio', name: 'runmode', checked: true }), rCpl = h('input', { type: 'radio', name: 'runmode' });
    if (ci) {
      const ok = !ci.stale && !ci.missing.length; if (ok && app._lastCoupled) { rCpl.checked = true; rWhole.checked = false; } if (!ok) rCpl.disabled = true;
      modeEl = h('div', { class: 'runmode' },
        h('label', null, rWhole, ' Whole model'),
        h('label', { style: { opacity: ok ? 1 : 0.55 } }, rCpl, ' Coupled parallel – ' + ci.parts.length + ' sub-models, ' + ci.def.couplings.length + ' cut points'),
        ci.stale ? h('div', { class: 'note', style: { color: 'var(--warn)' } }, 'The model changed after it was partitioned (' + ci.stale + ' change' + (ci.stale === 1 ? '' : 's') + '). Update the sub-models first: Tools ▸ Partition Model ▸ Regenerate.') : null,
        ci.missing.length ? h('div', { class: 'note', style: { color: 'var(--warn)' } }, 'Sub-model file(s) missing: ' + ci.missing.slice(0, 3).join(', ') + '. Generate the sub-models again (Tools ▸ Partition Model).') : null,
        ok && ci.edited.length ? h('div', { class: 'note', style: { color: 'var(--warn)' } }, ci.edited.length + ' sub-model file(s) were edited directly after they were generated (' + ci.edited.slice(0, 3).join(', ') + '); the coupled run uses them as they are.') : null,
        ok && ci.has2D ? h('div', { class: 'note' }, 'The coupled run computes the 1D network; 2D flooding is not coupled yet (use Whole model for 1D-2D).') : null);
    }
    const body = h('div', { style: { width: '480px', display: 'flex', flexDirection: 'column', gap: '8px' } },
      h('div', { class: 'form' }, h('label', null, 'Simulation name'), name, h('label', null, 'Description'), desc),
      modeEl ? h('div', null, h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Run'), modeEl) : null,
      app.filePath ? h('div', { class: 'note' }, 'Saved in ' + AV.resultsDir(app.filePath) + '. A new name keeps the earlier results; an existing name replaces them.') : h('div', { class: 'note', style: { color: 'var(--warn)' } }, 'The model is not saved: the results go to a temporary folder. Save the model to keep its results in the Database.'),
      runs.length ? h('div', null, h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Existing results (click to reuse a name)'), list) : null);
    const r = await AV.modal({ title: title || 'Run Simulation', body, buttons: [{ label: 'Cancel', value: null }, { label: opts.ok || 'Run', primary: true, onClick: async () => {
      const n = name.value.trim(); if (!n || !/^[\w\-. ()]+$/.test(n) || /^\.+$/.test(n)) { AV.toast('Use letters, digits, spaces, _ - . ( ) for the name.', true); return false; }
      if (runs.some(x => x.name.toLowerCase() === n.toLowerCase()) && !await AV.confirm('Results named "' + n + '" already exist. Replace them?', 'Run Simulation', 'Replace', 'Cancel')) return false;
      return { name: n, desc: desc.value.trim(), coupled: !!(ci && rCpl.checked && !rCpl.disabled) }; } }] }).done;
    if (r) { app._lastRunName = r.name; if (ci) app._lastCoupled = r.coupled; } return r;
  };
  AV.writeRunMeta = async function (dir, name, meta) { try { await window.host.writeText(AV.joinPath(dir, name + '.json'), JSON.stringify(meta, null, 1)); } catch (e) { } };

  class DatabasePane {
    constructor(app, host) { this.app = app; this.host = host; this.runs = []; }
    async render() {
      const app = this.app, H = this.host; if (!H) return; H.innerHTML = '';
      H.appendChild(h('div', { class: 'ptitle' }, h('span', null, 'Database'), h('span', { class: 'sub' }, app.filePath ? '' : 'model not saved')));
      const pane = h('div', { class: 'dbpane' }); H.appendChild(pane);
      const m = app.model; const fp = app.filePath; const loaded = app.results && app.results.rpt ? app.results.rpt.replace(/\.f?rpt$/i, '') : null;
      // base model
      pane.appendChild(h('div', { class: 'dbhead' }, 'Base Model'));
      const baseRow = h('div', { class: 'dbrow' + (!app.results ? ' cur' : ''), title: 'Double-click: work on the base model only (results closed), then Run to create new results' },
        h('div', { class: 'n' }, '📄 ' + (fp ? AV.basename(fp) : 'Untitled')), h('div', { class: 'm' }, fp ? AV.dirname(fp) : 'Save the model to keep its simulation results.'),
        h('div', { class: 'm' }, m.nodes.size + ' nodes · ' + m.links.size + ' links · ' + m.subcatchments.size + ' subcatchments · ' + m.flowUnits + (AV.f2dEnabled(m) ? ' · 1D-2D' : '')));
      baseRow.addEventListener('dblclick', async () => { if (app.results) { await app.sim.clearResults(); app.status('Base model only - the results were closed. Run to create new results.'); } this.render(); });
      baseRow.addEventListener('contextmenu', (e) => { e.preventDefault(); app.contextMenu(e.clientX, e.clientY, [{ label: 'Base Model Only (close results)', fn: async () => { await app.sim.clearResults(); this.render(); } }, { label: 'Run Simulation...', fn: () => app.sim.run() }, '-', { label: 'Open Another Model...', fn: () => app.openDialog() }, fp ? { label: 'Show in Explorer', fn: () => window.host.showItem(fp) } : null].filter(Boolean)); });
      pane.appendChild(baseRow);
      // runs
      this.runs = fp ? await AV.listRuns(fp) : [];
      pane.appendChild(h('div', { class: 'dbhead' }, 'Simulation Results', h('span', { class: 'sp' }), h('span', { style: { fontWeight: 400, color: 'var(--muted)' } }, String(this.runs.length)), h('button', { class: 'btn small', title: 'Refresh', onclick: () => this.render() }, '⟳')));
      if (!this.runs.length) pane.appendChild(h('div', { class: 'dbempty' }, fp ? 'No results yet. Click Run (Simulation tab, F5) and give the simulation a name.' : 'Save the model first.'));
      for (const r of this.runs) {
        const M = r.meta || {}; const isCur = loaded && r.rpt && loaded.toLowerCase() === r.rpt.replace(/\.f?rpt$/i, '').toLowerCase();
        const ok = M.code === undefined ? !!r.out : M.code === 0;
        const row = h('div', { class: 'dbrow' + (isCur ? ' cur' : ''), title: 'Double-click to open these results' },
          h('div', { class: 'n' }, (isCur ? '▶ ' : '') + r.name, h('span', { class: 'badge' + (r.is2D || M.type === '1D-2D' ? ' d2' : '') }, r.is2D || M.type === '1D-2D' ? '1D-2D' : '1D'), ok ? null : h('span', { class: 'badge f' }, 'failed')),
          M.desc ? h('div', { class: 'm', style: { color: '#37474f' } }, M.desc) : null,
          h('div', { class: 'm' }, (r.mtime ? new Date(r.mtime).toLocaleString() : '') + (M.seconds ? ' · ' + AV.fmt(M.seconds, 1) + ' s' : '') + (M.flowUnits ? ' · ' + M.flowUnits : '') + (r.size ? ' · ' + (r.size / 1048576).toFixed(1) + ' MB' : '')),
          M.massBal ? h('div', { class: 'm' }, 'Continuity: runoff ' + AV.fmt(M.massBal.runoff, 2) + ' %, routing ' + AV.fmt(M.massBal.flow, 2) + ' %' + (M.notConv !== undefined ? ' · not converging ' + M.notConv + ' %' : '')) : null);
        row.addEventListener('dblclick', () => this.open(r));
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); app.contextMenu(e.clientX, e.clientY, [
          { label: 'Open Results', fn: () => this.open(r) }, { label: 'Add to Comparison (Scenario)', fn: async () => { if (!r.out) return; await app.sim.loadScenario(r.out, r.rpt, r.name); AV.toast(r.name + ' added to the comparison.'); } },
          { label: 'View Report', fn: () => r.rpt && app.sim.showReport(r.rpt) }, '-', { label: 'Rename...', fn: () => this.rename(r) }, { label: 'Delete', fn: () => this.remove(r) }, { label: 'Show in Explorer', fn: () => window.host.showItem(r.out || r.rpt || r.json) }]); });
        pane.appendChild(row);
      }
    }
    async open(r) {
      const app = this.app; if (!r.out) { AV.toast('This run has no results file.', true); return; }
      if (r.is2D && !app.mesh2d) AV.toast('These are 1D-2D results; the 2D mesh of the model is not loaded.', true);
      await app.sim.loadResults(r.out, r.rpt, false); app.sim.lastRun = { out: r.out, rpt: r.rpt, inp: r.inp }; this.render();
    }
    files(r) { return [r.out, r.rpt, r.inp, r.json].filter(Boolean); }
    async releaseIfLoaded(r) { const app = this.app; const cur = app.results && app.results.rpt; if (cur && r.rpt && cur.toLowerCase() === r.rpt.toLowerCase()) await app.sim.clearResults(); }
    async remove(r) {
      if (!await AV.confirm('Delete the simulation results "' + r.name + '"?\n\n' + this.files(r).map(f => AV.basename(f)).join('\n'), 'Database', 'Delete')) return;
      await this.releaseIfLoaded(r); await window.host.rmRun(this.files(r)); AV.toast('Results "' + r.name + '" deleted.'); this.render();
    }
    async rename(r) {
      const n = await AV.prompt('Rename Results', 'New name', r.name); if (!n || n.trim() === r.name) return; const nn = n.trim();
      if (!/^[\w\-. ()]+$/.test(nn)) { AV.toast('Use letters, digits, spaces, _ - . ( ) for the name.', true); return; }
      if (this.runs.some(x => x.name.toLowerCase() === nn.toLowerCase())) { AV.toast('Results named "' + nn + '" already exist.', true); return; }
      await this.releaseIfLoaded(r);
      const pairs = this.files(r).map(f => [f, AV.joinPath(AV.dirname(f), nn + f.slice(AV.dirname(f).length + 1 + r.name.length))]);
      try { await window.host.renameRun(pairs); if (r.json) { const j = pairs.find(p => /\.json$/i.test(p[0])); try { const M = JSON.parse(await window.host.readText(j[1])); M.name = nn; await window.host.writeText(j[1], JSON.stringify(M, null, 1)); } catch (e) { } } }
      catch (e) { AV.alert('Could not rename: ' + e.message); }
      this.render();
    }
  }
  AV.DatabasePane = DatabasePane;
})(window.AV);
