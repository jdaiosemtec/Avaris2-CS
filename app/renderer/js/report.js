// Report viewer: the engine status report (.rpt) as a navigable document instead of plain text.
// Pages: Overview (KPI cards, water balance, time steps, options, top lists), Continuity, Warnings, Insights
// (duration statistics of every theme / Insight flag that uses dur / run / win), each summary table (sortable,
// filterable, click to locate, CSV) and the original text. The .rpt file itself is never changed.
'use strict';
(function (AV) {
  const h = AV.h;
  const num = (s) => { const v = parseFloat(String(s).replace(/,/g, '')); return isFinite(v) ? v : null; };
  const fmt = (v, d) => v === null || v === undefined ? '–' : AV.fmt(v, d === undefined ? 3 : d);

  // ---------------------------------------------------------------- parsing
  function parse(text) {
    const L = text.split(/\r?\n/); const heads = [];
    for (let i = 1; i < L.length - 1; i++) {
      if (!/^\s*\*{5,}/.test(L[i - 1]) || !/^\s*\*{5,}/.test(L[i + 1]) || !L[i].trim() || /^\s*\*/.test(L[i])) continue;
      if (/^\s*\*{5,}\s*$/.test(L[i - 1])) heads.push({ i, t: L[i].trim() });
      else { const m = /^\s*(.+?Continuity)\b/.exec(L[i]); if (m) heads.push({ i, t: m[1].trim() }); }   // continuity tables carry their column units on the title lines
    }
    const block = (title) => { const k = heads.findIndex(x => x.t === title); if (k < 0) return []; const end = k + 1 < heads.length ? heads[k + 1].i - 1 : L.length; return L.slice(heads[k].i + 2, end); };
    const kv = (lines) => { const out = []; for (const l of lines) { const m = /^\s*(.+?)\s*\.{3,}\s*(.*)$/.exec(l); if (m) out.push([m[1], m[2].trim().split(/\s{2,}|\s+(?=-?\d)/).filter(Boolean)]); } return out; };
    const colon = (lines) => { const out = {}; for (const l of lines) { const m = /^\s*(.+?)\s*:\s*(.+)$/.exec(l); if (m) out[m[1].trim()] = m[2].trim(); } return out; };
    const list = (title) => block(title).map(l => /^\s*(Node|Link|Subcatchment)\s+(\S+)\s+\(([-\d.]+)%?\)/.exec(l)).filter(Boolean).map(m => ({ kind: m[1], id: m[2], v: parseFloat(m[3]) }));
    const warn = L.filter(l => /^\s*(WARNING|ERROR)\s+\d+/.test(l)).map(l => l.trim());
    const opts = []; for (const l of block('Analysis Options')) { const m = /^\s*(.+?)\s*\.{3,}\s*(.+)$/.exec(l); if (m) opts.push([m[1], m[2].trim()]); }
    // continuity blocks (the header block holds the units)
    const cont = []; for (const hd of heads) if (/Continuity$/.test(hd.t) && !/^Highest/.test(hd.t)) { const b = L.slice(hd.i - 1, hd.i + 2); const units = (b[1] || '').replace(hd.t, '').trim().split(/\s{2,}/).filter(Boolean); const cols = ((L[hd.i - 1] || '').replace(/\*/g, '').trim()).split(/\s{2,}/).filter(Boolean); cont.push({ title: hd.t, cols, units, rows: kv(block(hd.t)) }); }
    const ts = colon(block('Routing Time Step Summary')); const freq = []; for (const l of block('Routing Time Step Summary')) { const m = /^\s*([\d.]+)\s*-\s*([\d.]+)\s*sec\s*:\s*([\d.]+)\s*%/.exec(l); if (m) freq.push({ a: +m[1], b: +m[2], p: +m[3] }); }
    const g = (re) => { const m = re.exec(text); return m ? m[1].trim() : null; };
    return { L, heads, block, opts, cont, ts, freq, warn, tables: AV.parseReportTables(text),
      nonconv: list('Most Frequent Nonconverging Nodes'), instab: list('Highest Flow Instability Indexes'), critical: list('Time-Step Critical Elements'), contErr: list('Highest Continuity Errors'),
      begun: g(/Analysis begun on:\s*(.+)/), ended: g(/Analysis ended on:\s*(.+)/), elapsed: g(/Total elapsed time:\s*(.+)/) };
  }
  const contVal = (P, title, label, col) => { const c = P.cont.find(x => x.title === title); if (!c) return null; const r = c.rows.find(r => r[0].startsWith(label)); return r ? num(r[1][col || 0]) : null; };

  // ---------------------------------------------------------------- view
  AV.openReport = async function (app, rp, text) {
    const P = parse(text); const m = app.model;
    const find = (id) => m.nodes.get(id) || m.links.get(id) || m.subcatchments.get(id);
    const locate = (id) => { const o = find(id); if (!o) { AV.toast(id + ' is not in the current model.', true); return; } app.select(o); app.activateView('map'); app.map.zoomToObjects([o]); };
    const nav = h('div', { class: 'rpnav' }); const page = h('div', { class: 'rppage' });
    const pages = []; let curKey = null;
    const addNav = (key, label, badge, cls, render, group) => { pages.push({ key, label, render }); const it = h('div', { class: 'rpni' + (cls ? ' ' + cls : ''), 'data-k': key, onclick: () => show(key) }, h('span', null, label), badge !== undefined && badge !== null ? h('span', { class: 'rpbadge' + (cls === 'bad' ? ' bad' : '') }, String(badge)) : null); if (group) group.appendChild(it); else nav.appendChild(it); };
    const show = (key) => { const pg = pages.find(p => p.key === key); if (!pg) return; curKey = key; AV.$$('.rpni', nav).forEach(e => e.classList.toggle('on', e.dataset.k === key)); page.innerHTML = ''; page.scrollTop = 0; pg.render(page); };
    const sec = (title, ...kids) => h('div', { class: 'rpsec' }, h('div', { class: 'rpsh' }, title), ...kids);
    const idCell = (id) => h('a', { class: 'rplink', title: 'Locate on the map', onclick: (e) => { e.stopPropagation(); locate(id); } }, id);

    // ------------------------------ overview
    const runoffErr = contVal(P, 'Runoff Quantity Continuity', 'Continuity Error'), flowErr = contVal(P, 'Flow Routing Continuity', 'Continuity Error');
    const floodLoss = contVal(P, 'Flow Routing Continuity', 'Flooding Loss'), extOut = contVal(P, 'Flow Routing Continuity', 'External Outflow'), precip = contVal(P, 'Runoff Quantity Continuity', 'Total Precipitation', 1);
    const fl = P.tables['Node Flooding Summary'], ns = P.tables['Node Surcharge Summary'], cs = P.tables['Conduit Surcharge Summary'];
    const ncPct = num(P.ts['% of Steps Not Converging']); const unitsV = (P.cont.find(c => c.title === 'Flow Routing Continuity') || {}).units || [];
    const card = (label, value, sub, level) => h('div', { class: 'rpcard ' + (level || '') }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 's' }, sub) : null);
    const lv = (x, warn, bad) => x === null ? '' : Math.abs(x) >= bad ? 'bad' : Math.abs(x) >= warn ? 'warn' : 'ok';
    const overview = (el) => {
      el.append(h('div', { class: 'rptitle' }, h('div', null, h('b', null, AV.basename(rp)), h('span', null, '  ' + (P.begun ? P.begun : ''))), h('div', { class: 'rpmeta' }, (P.elapsed ? 'Run time ' + P.elapsed : '') + (P.warn.length ? '  ·  ' + P.warn.length + ' warnings' : ''))));
      el.appendChild(h('div', { class: 'rpcards' },
        card('Runoff continuity error', runoffErr === null ? '–' : runoffErr.toFixed(3) + ' %', null, lv(runoffErr, 2, 5)),
        card('Flow routing continuity error', flowErr === null ? '–' : flowErr.toFixed(3) + ' %', null, lv(flowErr, 2, 5)),
        card('Flooded nodes', fl ? String(fl.rows.length) : '0', floodLoss !== null ? 'Flooding loss ' + fmt(floodLoss) + ' ' + (unitsV[0] || '') : null, fl && fl.rows.length ? 'warn' : 'ok'),
        card('Surcharged nodes', ns ? String(ns.rows.length) : '0', cs ? cs.rows.length + ' surcharged conduits' : null, ns && ns.rows.length ? 'warn' : 'ok'),
        card('Steps not converging', ncPct === null ? '–' : ncPct.toFixed(2) + ' %', P.ts['Average Time Step'] ? 'Average step ' + P.ts['Average Time Step'] : null, lv(ncPct, 5, 20)),
        card('Total precipitation', precip === null ? '–' : fmt(precip, 2) + ' ' + ((P.cont.find(c => c.title === 'Runoff Quantity Continuity') || {}).units || [])[1], extOut !== null ? 'External outflow ' + fmt(extOut) + ' ' + (unitsV[0] || '') : null, '')));
      // water balance (flow routing)
      const fr = P.cont.find(c => c.title === 'Flow Routing Continuity');
      if (fr) {
        const g = (k) => { const r = fr.rows.find(r => r[0].startsWith(k)); return r ? Math.max(0, num(r[1][0]) || 0) : 0; };
        const IN = [['Dry weather inflow', g('Dry Weather Inflow'), '#8d6e63'], ['Wet weather inflow', g('Wet Weather Inflow'), '#42a5f5'], ['Groundwater', g('Groundwater Inflow'), '#26a69a'], ['RDII', g('RDII Inflow'), '#ab47bc'], ['External inflow', g('External Inflow'), '#5c6bc0'], ['Initial storage', g('Initial Stored Volume'), '#b0bec5']];
        const OUT = [['External outflow', g('External Outflow'), '#1e88e5'], ['Flooding loss', g('Flooding Loss'), '#e53935'], ['Evaporation', g('Evaporation Loss'), '#ffb300'], ['Exfiltration', g('Exfiltration Loss'), '#795548'], ['Final storage', g('Final Stored Volume'), '#90a4ae']];
        const tot = Math.max(IN.reduce((s, x) => s + x[1], 0), OUT.reduce((s, x) => s + x[1], 0), 1e-9);
        const bar = (label, parts) => h('div', { class: 'wbrow' }, h('div', { class: 'wbl' }, label), h('div', { class: 'wbbar' }, parts.filter(p => p[1] > 0).map(p => h('div', { class: 'wbseg', title: p[0] + ': ' + fmt(p[1]) + ' ' + (fr.units[0] || ''), style: { width: (100 * p[1] / tot) + '%', background: p[2] } }, 100 * p[1] / tot > 9 ? p[0] : ''))));
        const legend = h('div', { class: 'wblegend' }, IN.concat(OUT).filter(p => p[1] > 0).map(p => h('span', null, h('i', { style: { background: p[2] } }), p[0] + ' ' + fmt(p[1]))));
        el.appendChild(sec('Flow routing water balance (' + (fr.units[0] || '') + ')' + (flowErr !== null ? ' — continuity error ' + flowErr.toFixed(3) + ' %' : ''), bar('In', IN), bar('Out', OUT), legend));
      }
      const two = h('div', { class: 'rptwo' }); el.appendChild(two);
      if (P.freq.length) {
        const mx = Math.max(...P.freq.map(f => f.p), 1);
        two.appendChild(sec('Routing time steps', h('div', { class: 'tsbars' }, P.freq.map(f => h('div', { class: 'tsb' }, h('div', { class: 'tsv', style: { height: Math.max(2, 90 * f.p / mx) + 'px' }, title: f.p + ' %' }), h('div', { class: 'tsn' }, f.p.toFixed(1) + '%'), h('div', { class: 'tsl' }, f.b + '–' + f.a + ' s')))),
          h('table', { class: 'rpkv' }, ['Minimum Time Step', 'Average Time Step', 'Maximum Time Step', 'Average Iterations per Step', '% of Steps Not Converging'].filter(k => P.ts[k]).map(k => h('tr', null, h('td', null, k), h('td', null, P.ts[k]))))));
      }
      if (P.opts.length) two.appendChild(sec('Analysis options', h('table', { class: 'rpkv' }, P.opts.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v))))));
      const top = (title, rows, cols, map) => rows.length ? sec(title, h('table', { class: 'rptop' }, h('tr', null, cols.map(c => h('th', null, c))), rows.slice(0, 8).map(r => h('tr', { onclick: () => locate(r[0]) }, map(r).map((v, i) => h('td', { class: i ? 'n' : '' }, i ? v : idCell(v))))))) : null;
      const three = h('div', { class: 'rpthree' }); el.appendChild(three);
      if (fl) { const ci = fl.cols.indexOf('Total Flood Volume'), hi = fl.cols.indexOf('Hours Flooded'); const r = fl.rows.slice().sort((a, b) => (num(b[ci]) || 0) - (num(a[ci]) || 0)); const t = top('Most flooding (volume)', r, ['Node', 'Hours', 'Volume'], x => [x[0], x[hi], x[ci]]); if (t) three.appendChild(t); }
      const lf = P.tables['Link Flow Summary']; if (lf) { const ci = lf.cols.indexOf('Max/Full Flow'); const r = lf.rows.filter(x => num(x[ci]) !== null).sort((a, b) => num(b[ci]) - num(a[ci])); const t = top('Highest max / full flow', r, ['Link', 'Type', 'Max/Full'], x => [x[0], x[1], x[ci]]); if (t) three.appendChild(t); }
      if (P.nonconv.length) { const t = top('Most frequent nonconverging nodes', P.nonconv.map(x => [x.id, x.v]), ['Node', '% steps'], x => [x[0], x[1].toFixed(2)]); if (t) three.appendChild(t); }
    };
    addNav('ov', 'Overview', null, '', overview);
    // ------------------------------ continuity
    addNav('cont', 'Continuity', P.cont.length, '', (el) => {
      for (const c of P.cont) {
        const ncol = Math.max(1, ...c.rows.map(r => r[1].length));
        const hdr = c.units.length ? c.units : c.cols; const cols = hdr.length >= ncol ? hdr.slice(-ncol) : hdr;
        const t = h('table', { class: 'rpcont' }, h('tr', null, h('th', null, ''), Array.from({ length: ncol }, (_, i) => h('th', null, (c.title.includes('Quality') ? (c.cols[i + 1] || c.cols[i] || '') + ' ' : '') + (cols[i] || '')))),
          c.rows.map(r => h('tr', { class: /Continuity Error/.test(r[0]) ? 'err' : '' }, h('td', null, r[0]), r[1].map(v => h('td', { class: 'n' }, v)))));
        el.appendChild(sec(c.title, t));
      }
    });
    // ------------------------------ warnings
    const byCode = new Map(); for (const w of P.warn) { const mm = /^(WARNING|ERROR)\s+(\d+):\s*(.*?)(?:\s+for\s+(\w+)\s+(\S+))?$/.exec(w); const code = mm ? mm[1] + ' ' + mm[2] : w; const g = byCode.get(code) || { code, text: mm ? mm[3] : w, items: [] }; g.items.push(mm && mm[5] ? mm[5] : null); byCode.set(code, g); }
    addNav('warn', 'Warnings', P.warn.length, P.warn.some(w => /^ERROR/.test(w)) ? 'bad' : '', (el) => {
      if (!P.warn.length) { el.appendChild(h('div', { class: 'rpempty' }, 'No warnings.')); return; }
      for (const g of byCode.values()) el.appendChild(sec(g.code + ' — ' + g.text + ' (' + g.items.length + ')', h('div', { class: 'rpchips' }, g.items.filter(Boolean).map(id => h('span', { class: 'rpchip', onclick: () => locate(id), title: 'Locate on the map' }, id)))));
    });
    // ------------------------------ insights (duration statistics of themes / flags)
    addNav('ins', 'Insights', null, 'ins', (el) => renderInsights(app, el, locate, idCell));
    // ------------------------------ convergence
    if (P.nonconv.length || P.instab.length || P.critical.length || P.contErr.length) addNav('conv', 'Convergence', P.nonconv.length || null, '', (el) => {
      const lst = (title, arr, unit) => arr.length ? sec(title, h('table', { class: 'rptop' }, h('tr', null, h('th', null, 'Object'), h('th', null, unit)), arr.map(x => h('tr', { onclick: () => locate(x.id) }, h('td', null, x.kind + ' ', idCell(x.id)), h('td', { class: 'n' }, String(x.v)))))) : null;
      el.append(...[lst('Most frequent nonconverging nodes', P.nonconv, '% of steps'), lst('Highest flow instability indexes', P.instab, 'Index'), lst('Time-step critical elements', P.critical, '% of time'), lst('Highest continuity errors', P.contErr, '%')].filter(Boolean),
        h('div', { style: { padding: '6px 2px' } }, h('button', { class: 'btn small', onclick: () => app.sim.convergenceDiagnostics() }, 'Open Convergence Diagnostics…')));
    });
    // ------------------------------ tables
    const tg = h('div', { class: 'rpgroup' }, h('div', { class: 'rpgh' }, 'Result tables')); nav.appendChild(tg);
    for (const [title, T] of Object.entries(P.tables)) addNav('t:' + title, title.replace(/ Summary$/, ''), T.rows.length, '', (el) => tableView(el, title, T, locate), tg);
    nav.appendChild(h('div', { class: 'rpgroup' }));
    addNav('txt', 'Full text', null, '', (el) => textView(el, text, rp));

    const head = h('div', { class: 'grid-tools' }, h('b', null, 'Report'), h('span', { style: { color: 'var(--muted)' } }, rp), h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn small', onclick: () => window.host.showItem(rp) }, 'Show in Folder'));
    const view = h('div', { class: 'rpview' }, head, h('div', { class: 'rpbody' }, nav, page));
    app.closeView('report'); app.addView('report', 'Report', view); show('ov');
    return { show };
  };

  // sortable / filterable result table
  function tableView(el, title, T, locate) {
    let sortK = -1, sortD = -1; const filter = h('input', { type: 'text', placeholder: 'Filter (ID or text)…', style: { width: '200px' } });
    const holder = h('div', { class: 'rptablew' }); const info = h('span', { class: 'rpmeta' });
    const render = () => {
      const q = filter.value.trim().toLowerCase(); let rows = q ? T.rows.filter(r => r.some(c => String(c).toLowerCase().includes(q))) : T.rows.slice();
      if (sortK >= 0) rows.sort((a, b) => { const x = num(a[sortK]), y = num(b[sortK]); return (x !== null && y !== null ? x - y : String(a[sortK]).localeCompare(String(b[sortK]), undefined, { numeric: true })) * sortD; });
      info.textContent = rows.length + ' of ' + T.rows.length + ' rows' + (rows.length > 5000 ? ' (first 5000 shown)' : '');
      const tb = h('tbody'); for (const r of rows.slice(0, 5000)) tb.appendChild(h('tr', { onclick: () => locate(r[0]) }, r.map((c, i) => h('td', { class: i && num(c) !== null && !/:/.test(c) ? 'num' : '' }, c))));
      holder.innerHTML = ''; holder.appendChild(h('table', { class: 'grid' }, h('thead', null, h('tr', null, T.cols.slice(0, Math.max(T.cols.length, 1)).map((c, i) => h('th', { onclick: () => { if (sortK === i) sortD *= -1; else { sortK = i; sortD = -1; } render(); } }, c + (sortK === i ? (sortD > 0 ? ' ▲' : ' ▼') : ''))))), tb));
    };
    filter.addEventListener('input', render);
    el.append(h('div', { class: 'rpth' }, h('b', null, title), filter, info, h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn small', onclick: () => AV.downloadText([T.cols.map(AV.csvCell).join(',')].concat(T.rows.map(r => r.map(AV.csvCell).join(','))).join('\n'), title.replace(/\W+/g, '_') + '.csv') }, 'Export CSV')),
      h('div', { class: 'rpnote' }, 'Click a row to locate the object on the map; click a column header to sort.'), holder);
    render();
  }
  // original text with search
  function textView(el, text, rp) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const pre = h('pre', { class: 'rptext' }); pre.innerHTML = text.split('\n').map(l => /WARNING \d+/.test(l) ? '<span class="warn">' + esc(l) + '</span>' : /ERROR \d+/.test(l) ? '<span class="err">' + esc(l) + '</span>' : esc(l)).join('\n');
    const find = h('input', { type: 'text', placeholder: 'Find (Enter = next)', style: { width: '240px' } }); let last = -1;
    find.addEventListener('keydown', (e) => { if (e.key !== 'Enter' || !find.value) return; const q = find.value.toLowerCase(), T = text.toLowerCase(); let i = T.indexOf(q, last + 1); if (i < 0) i = T.indexOf(q); if (i < 0) { AV.toast('Not found'); return; } last = i; const line = text.slice(0, i).split('\n').length - 1; pre.scrollTop = Math.max(0, line * 17 - 60); });
    el.append(h('div', { class: 'rpth' }, h('b', null, 'Full text'), find), pre);
  }

  // ---------------------------------------------------------------- insights
  // every theme (Insight flag or own theme) whose expression uses dur / run / win gets, per object: worst level (peak)
  // and its time, and for each dur / run / win in it the whole-run statistic (total / longest uninterrupted / most in
  // any window). Themes without these functions are not listed.
  const STAT = { dur: ['totdur', 'Total time (min)'], run: ['maxrun', 'Longest uninterrupted (min)'], win: ['maxwin', 'Most in any {W}-min window (min)'] };
  async function renderInsights(app, el, locate, idCell) {
    const R = app.results; const th = app.theme;
    if (!R) { el.appendChild(h('div', { class: 'rpempty' }, 'Load or run results first: the statistics are computed from the results file.')); return; }
    const flags = [];
    for (const layer of ['node', 'link', 'sub']) for (const t of th.layers[layer].subs) {
      if (!t.field || !t.field.startsWith('x:')) continue; const src = t.field.slice(2);
      if (!AV.exprIsDynamic(src)) continue;   // "worst over run" variants repeat a dynamic flag
      const c = th.compiled(layer, src); if (!c) continue;
      const stats = []; const seen = new Set();
      for (const n of c.temporals) { if (!STAT[n.fn] || seen.has(n.key)) continue; seen.add(n.key); const cond = n.key.slice(n.fn.length + 1, -1).replace(/,\s*[\d.]+\s*$/, n.fn === 'win' ? '' : '$&');
        const [sf, label] = STAT[n.fn]; const ex = sf + '(' + (n.fn === 'win' ? n.key.slice(4, -1) : cond) + ')'; stats.push({ fn: n.fn, label: label.replace('{W}', n.W || 60), cond, ex }); }
      if (!stats.length) continue;
      flags.push({ layer, t, src, stats });
    }
    if (!flags.length) {
      el.appendChild(h('div', { class: 'rpempty' }, h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'No theme uses the time functions dur, run or win.'),
        h('div', null, 'Load the Insight Flags theme file (Theme → Load… → Add), or write your own theme expression with dur(condition), run(condition) or win(condition, minutes). Their duration statistics then appear here.')));
      return;
    }
    const status = h('div', { class: 'rpnote' }, 'Computing statistics from ' + R.meta.nPeriods + ' time steps…'); el.appendChild(status);
    const fields = { node: AV.exprFields(app, 'node'), link: AV.exprFields(app, 'link'), sub: AV.exprFields(app, 'sub') };
    const jobs = flags.map(F => { const P = AV.compileExpr('peak(' + F.src + ')', fields[F.layer]); const S = F.stats.map(s => Object.assign({}, s, { c: AV.compileExpr(s.ex, fields[F.layer]) })); return Object.assign(F, { P, S }); });
    const all = []; for (const J of jobs) { all.push(...J.P.temporals); for (const s of J.S) all.push(...s.c.temporals); }
    await AV.Temporal.ensure(all);
    status.remove();
    const levelName = (t, v) => { const r = (t.ranges || []).find(r => String(r.v) === String(v)); return r ? (r.label || String(r.v)) : (v === null ? '–' : AV.fmt(v, 3)); };
    const levelColor = (t, v) => { const r = (t.ranges || []).find(r => String(r.v) === String(v)); return r ? r.color : '#eceff1'; };
    const kpi = h('div', { class: 'rpcards' }); el.appendChild(kpi);
    for (const J of jobs) {
      const objs = [...app.theme.objects(J.layer)].filter(o => !J.t.where || th.passWhere(J.layer, J.t, o));
      const rows = []; const peakNode = J.P.temporals[J.P.temporals.length - 1];
      for (const o of objs) {
        const lvl = J.P.fn(o); const vals = J.S.map(s => s.c.fn(o));
        if (!(lvl > 0) && !vals.some(v => v > 0)) continue;
        const pp = AV.Temporal.peakPeriod(peakNode, o);
        rows.push({ o, lvl, t: lvl > 0 && pp !== null ? R.timeLabel(pp) : '', vals });
      }
      rows.sort((a, b) => (b.lvl || 0) - (a.lvl || 0) || (b.vals[0] || 0) - (a.vals[0] || 0));
      const counts = new Map(); for (const r of rows) if (r.lvl > 0) counts.set(r.lvl, (counts.get(r.lvl) || 0) + 1);
      const chips = h('div', { class: 'rpchips' }, [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([v, n]) => h('span', { class: 'lvchip', style: { background: levelColor(J.t, v) } }, levelName(J.t, v) + ': ' + n)), rows.length ? null : h('span', { class: 'rpmeta' }, 'No object flagged.'));
      kpi.appendChild(h('div', { class: 'rpcard ' + (counts.size ? 'warn' : 'ok') }, h('div', { class: 'k' }, J.t.name.replace(/^⚑\s*/, '')), h('div', { class: 'v' }, String(rows.filter(r => r.lvl > 0).length)), h('div', { class: 's' }, 'objects flagged')));
      const tb = h('tbody');
      for (const r of rows.slice(0, 3000)) tb.appendChild(h('tr', { onclick: () => locate(r.o.id) }, h('td', null, idCell(r.o.id)), h('td', null, r.o.type || ''),
        h('td', null, h('span', { class: 'lvchip', style: { background: levelColor(J.t, r.lvl) } }, levelName(J.t, r.lvl))), h('td', null, r.t), r.vals.map(v => h('td', { class: 'num' }, v === null ? '–' : AV.fmt(v, 1)))));
      const csv = () => AV.downloadText([['ID', 'Type', 'Worst level', 'Time of worst'].concat(J.S.map(s => s.label + ' [' + s.cond + ']')).map(AV.csvCell).join(',')].concat(rows.map(r => [r.o.id, r.o.type, levelName(J.t, r.lvl), r.t].concat(r.vals.map(v => v === null ? '' : v)).map(AV.csvCell).join(','))).join('\n'), J.t.name.replace(/[^\w]+/g, '_').replace(/^_+/, '') + '.csv');
      el.appendChild(h('div', { class: 'rpsec' }, h('div', { class: 'rpsh' }, h('span', null, J.t.name), h('span', { style: { flex: 1 } }), h('button', { class: 'btn small', onclick: csv }, 'Export CSV')),
        J.t.desc ? h('div', { class: 'rpnote' }, J.t.desc) : null, h('div', { class: 'rpnote mono' }, ({ node: 'Nodes', link: 'Links', sub: 'Subcatchments' })[J.layer] + (J.t.where ? ' where ' + J.t.where : '') + ' · ' + J.src), chips,
        rows.length ? h('div', { class: 'rptablew small' }, h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'ID'), h('th', null, 'Type'), h('th', null, 'Worst level'), h('th', null, 'Time of worst'), J.S.map(s => h('th', { title: s.fn + '(' + s.cond + ')' }, s.label)))), tb)) : null,
        rows.length > 3000 ? h('div', { class: 'rpnote' }, 'First 3000 of ' + rows.length + ' shown; Export CSV has all.') : null));
    }
    el.insertBefore(h('div', { class: 'rpnote' }, 'Duration statistics of the themes that use dur / run / win (accuracy = report time step, ' + (R.meta.reportStep / 60) + ' min). Worst level = highest theme value during the run.'), el.firstChild);
  }
})(window.AV);
