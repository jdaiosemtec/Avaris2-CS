// Performance diagnostics: timings of the expensive operations (open, draw, index, results, panels) collected while
// working, shown in Help ▸ Diagnostics with the model size and memory, to find what is slow on a large model.
'use strict';
(function (AV) {
  const h = AV.h;
  const S = new Map();
  AV.perf = {
    rec(name, ms, note) { if (!isFinite(ms)) return; let e = S.get(name); if (!e) S.set(name, e = { n: 0, sum: 0, max: 0, last: 0, note: '' }); e.n++; e.sum += ms; e.last = ms; e.max = Math.max(e.max, ms); if (note) e.note = note; },
    clear() { S.clear(); },
    rows() { return [...S.entries()].map(([k, e]) => ({ name: k, last: e.last, avg: e.sum / e.n, max: e.max, n: e.n, note: e.note })); },
  };
  AV.perfDialog = function (app) {
    const m = app.model, R = app.results; const mem = performance.memory;
    const info = [
      ['Model', app.filePath ? AV.basename(app.filePath) : '(unsaved)'],
      ['Objects', m.nodes.size + ' nodes, ' + m.links.size + ' links, ' + m.subcatchments.size + ' subcatchments' + (app.mesh2d ? ', ' + app.mesh2d.cells.length + ' 2D cells' : '')],
      ['Vertices / polygon points', [...m.links.values()].reduce((s, l) => s + (l.verts ? l.verts.length : 0), 0) + ' / ' + [...m.subcatchments.values()].reduce((s, c) => s + (c.poly ? c.poly.length : 0), 0)],
      ['Results', R ? R.meta.nPeriods + ' time steps, ' + R.meta.ids.node.length + ' nodes, ' + R.meta.ids.link.length + ' links' : 'none'],
      ['Memory (JS heap)', mem ? (mem.usedJSHeapSize / 1048576).toFixed(0) + ' MB used of ' + (mem.jsHeapSizeLimit / 1048576).toFixed(0) + ' MB limit' : '-'],
      ['Screen', window.innerWidth + ' x ' + window.innerHeight + ' @ ' + (window.devicePixelRatio || 1) + 'x'],
      ['Version', (app.info && app.info.version) || ''],
    ];
    const rows = AV.perf.rows();
    const f = (v) => v >= 1000 ? (v / 1000).toFixed(2) + ' s' : Math.round(v) + ' ms';
    const text = () => info.map(r => r.join(': ')).join('\n') + '\n\n' + ['Operation', 'Last', 'Average', 'Max', 'Count', 'Note'].join('\t') + '\n' + rows.map(r => [r.name, f(r.last), f(r.avg), f(r.max), r.n, r.note].join('\t')).join('\n');
    const body = h('div', { style: { minWidth: '620px' } },
      h('table', { class: 'rpkv', style: { marginBottom: '10px' } }, info.map(([k, v]) => h('tr', null, h('td', null, k), h('td', { style: { textAlign: 'left' } }, String(v))))),
      rows.length ? h('table', { class: 'grid', style: { width: '100%' } }, h('thead', null, h('tr', null, ['Operation', 'Last', 'Average', 'Max', 'Count', 'Note'].map(c => h('th', null, c)))),
        h('tbody', null, rows.map(r => h('tr', null, h('td', null, r.name), h('td', { class: 'num', style: { color: r.last > 1000 ? '#c62828' : r.last > 250 ? '#b26a00' : '' } }, f(r.last)), h('td', { class: 'num' }, f(r.avg)), h('td', { class: 'num' }, f(r.max)), h('td', { class: 'num' }, String(r.n)), h('td', null, r.note))))) : h('div', { class: 'note' }, 'No timings yet: open a model, pan / zoom, load results and play a few steps, then open this again.'),
      h('div', { class: 'note', style: { marginTop: '8px' } }, 'Timings are collected while you work (this session only). Copy and send them to compare models or versions.'));
    AV.modal({ title: 'Diagnostics - Performance', body, buttons: [{ label: 'Reset', onClick: () => { AV.perf.clear(); AV.toast('Timings cleared.'); return true; } }, { label: 'Copy', onClick: () => { navigator.clipboard.writeText(text()); AV.toast('Copied to the clipboard.'); return false; } }, { label: 'Close', primary: true }] });
  };
})(window.AV);
