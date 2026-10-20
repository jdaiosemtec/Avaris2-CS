// Catalog pane (right dock, like ArcGIS Pro): browse folders, double-click or drag data onto the map to add it.
'use strict';
(function (AV) {
  const h = AV.h;
  const SIDE = ['dbf', 'shx', 'prj', 'cpg', 'sbn', 'sbx', 'qix', 'fix', 'xml', 'tfw', 'tifw', 'pgw', 'jgw', 'wld', 'aux', 'ovr', 'atx', 'mxs'];
  const ICON = { vector: '◇', raster: '▦', unsupported: '⊘', folder: '📁', gdb: '🗄', model: '≋', results: '◷' };
  class Catalog {
    constructor(app, host) { this.app = app; this.host = host; this.dir = null; this.built = false; this.sel = null; this.gdbs = new Map(); }
    async show() {
      if (!this.built) await this.build();
      if (!this.dir) await this.go(this.app.filePath ? AV.dirname(this.app.filePath) : (this.paths.documents || this.paths.home));
    }
    async build() {
      this.built = true; const app = this.app;
      this.paths = await window.host.paths(); this.drives = await window.host.drives();
      this.pathIn = h('input', { type: 'text', class: 'catpath', onkeydown: (e) => { if (e.key === 'Enter') this.go(this.pathIn.value.trim()); } });
      this.filter = h('input', { type: 'text', placeholder: 'Search this folder', class: 'catsearch', oninput: () => this.render() });
      this.onlyData = h('input', { type: 'checkbox', checked: true, onchange: () => this.render() });
      this.list = h('div', { class: 'catlist' });
      const fav = h('select', { class: 'catfav', onchange: () => { if (fav.value) this.go(fav.value); fav.value = ''; } });
      const favs = [['', 'Go to…']].concat(this.app.filePath ? [[AV.dirname(this.app.filePath), 'Model folder']] : []).concat([['home', 'Home'], ['desktop', 'Desktop'], ['documents', 'Documents'], ['downloads', 'Downloads']].filter(([k]) => this.paths[k]).map(([k, l]) => [this.paths[k], l]))
        .concat((app.settings.catalogRecent || []).map(p => [p, p])).concat(this.drives.map(d => [d, 'Drive ' + d]));
      for (const [v, l] of favs) fav.appendChild(h('option', { value: v }, l));
      this.host.append(h('div', { class: 'ptitle' }, h('span', null, 'Catalog')),
        h('div', { class: 'catbar' }, h('button', { class: 'btn small', title: 'Up one folder', onclick: () => this.up() }, '↑'), h('button', { class: 'btn small', title: 'Refresh', onclick: () => this.go(this.dir) }, '⟳'), fav,
          h('button', { class: 'btn small', title: 'Choose files to add', onclick: () => this.browse() }, 'Add Data…'), h('button', { class: 'btn small', title: 'New drawing layer', onclick: () => this.app.feat.newLayer() }, 'New Layer')),
        h('div', { class: 'catbar' }, this.pathIn), h('div', { class: 'catbar' }, this.filter, h('label', { title: 'Show only folders and files OsemCM can add' }, this.onlyData, ' GIS data only')),
        this.list);
      // drop files from Windows Explorer anywhere on the catalog or the map
      const dropT = [this.list, AV.$('#mapWrap')];
      for (const t of dropT) {
        t.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; t.classList.add('dropping'); });
        t.addEventListener('dragleave', () => t.classList.remove('dropping'));
        t.addEventListener('drop', (e) => {
          e.preventDefault(); t.classList.remove('dropping');
          let paths = []; const own = e.dataTransfer.getData('text/osemcm-path'); if (own) paths = own.split('\n');
          else for (const f of e.dataTransfer.files) { const p = window.host.pathForFile(f); if (p) paths.push(p); }
          const inp = paths.filter(p => /\.inp$/i.test(p)); if (inp.length && t !== this.list) { this.app.openFile(inp[0]); return; }
          paths = paths.filter(p => AV.dataKind(p) || AV.GDB.isGdbLayerPath(p)); if (paths.length) AV.addData(this.app, paths);
        });
      }
    }
    async browse() { const ps = await window.host.openDialog({ title: 'Add Data', multi: true, filters: [{ name: 'GIS data', extensions: AV.DATA_EXT.vector.concat(AV.DATA_EXT.raster) }, { name: 'All files', extensions: ['*'] }] }); if (ps) AV.addData(this.app, ps); }
    up() { if (!this.dir) return; let p = AV.dirname(this.dir.replace(/[\\/]+$/, '')); if (/^[A-Za-z]:$/.test(p)) p += '\\'; if (!p && this.dir.startsWith('/')) p = '/'; if (p && p !== this.dir) this.go(p); }
    async go(dir) {
      if (!dir) return;
      try { this.items = await window.host.listDir(dir); } catch (e) { AV.toast('Cannot open ' + dir + ': ' + e.message, true); return; }
      this.dir = dir; this.pathIn.value = dir; this.sel = null;
      const r = (this.app.settings.catalogRecent || []).filter(x => x !== dir); r.unshift(dir); this.app.settings.catalogRecent = r.slice(0, 8);
      this.render();
    }
    async loadGdb(full) {
      let g = this.gdbs.get(full); if (!g) { g = { open: false, layers: null, checked: new Set(), err: null }; this.gdbs.set(full, g); }
      if (g.layers || g.loading) return g;
      g.loading = true; this.render();
      try {
        if (!await AV.GDB.available()) throw new Error('The GDAL tools are missing from this installation.');
        g.layers = await AV.GDB.listLayers(full); g.err = null;
      } catch (e) { g.err = e.message; }
      g.loading = false; this.render(); return g;
    }
    async toggleGdb(full) {
      const g = this.gdbs.get(full); if (g && g.open) { g.open = false; this.render(); return; }
      const gg = await this.loadGdb(full); gg.open = true; this.render();
    }
    renderGdb(full, g, L) {
      const box = h('div', { class: 'catgdb' }); L.appendChild(box);
      if (g.loading) { box.appendChild(h('div', { class: 'catsub muted' }, 'Reading geodatabase…')); return; }
      if (g.err) { box.appendChild(h('div', { class: 'catsub err' }, g.err)); return; }
      const fcs = g.layers.filter(x => x.kind !== 'table'), tabs = g.layers.filter(x => x.kind === 'table');
      if (!fcs.length) { box.appendChild(h('div', { class: 'catsub muted' }, 'No feature classes.')); return; }
      const GI = { point: '•', line: '╱', polygon: '▱', other: '◇' };
      let lastDs = null;
      for (const fc of fcs) {
        if (fc.dataset && fc.dataset !== lastDs) { lastDs = fc.dataset; box.appendChild(h('div', { class: 'catsub ds' }, '🗀 ' + fc.dataset.replace(/^\\/, ''))); }
        const lp = full + '|' + fc.name;
        const cb = h('input', { type: 'checkbox', checked: g.checked.has(fc.name), onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? g.checked.add(fc.name) : g.checked.delete(fc.name); upd(); } });
        const r = h('div', { class: 'catitem catfc k-vector' + (fc.dataset ? ' inds' : ''), draggable: true, title: fc.name + '\n' + fc.geom + ' · ' + fc.count + ' features' + (fc.wkt ? '\n' + (/^\w+\["([^"]+)"/.exec(fc.wkt) || [, ''])[1] : ''),
          onclick: () => { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }, ondblclick: (e) => { e.stopPropagation(); AV.addData(this.app, [lp]); },
          oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); this.app.contextMenu(e.clientX, e.clientY, [{ label: 'Add to Map', fn: () => AV.addData(this.app, [lp]) }, { label: 'Import into Network...', fn: () => this.app.tools.importNetwork(lp) }]); } },
          cb, h('span', { class: 'ci g-' + fc.kind }, GI[fc.kind] || '◇'), h('span', { class: 'cn' }, fc.name), h('span', { class: 'cs' }, String(fc.count)));
        r.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/osemcm-path', lp); e.dataTransfer.effectAllowed = 'copy'; });
        box.appendChild(r);
      }
      if (tabs.length) box.appendChild(h('div', { class: 'catsub muted' }, tabs.length + ' table(s) without geometry not shown'));
      const addB = h('button', { class: 'btn small primary', onclick: () => { const ls = fcs.filter(x => g.checked.has(x.name)).map(x => full + '|' + x.name); if (ls.length) AV.addData(this.app, ls); } });
      const upd = () => { addB.textContent = 'Add Selected (' + g.checked.size + ')'; addB.disabled = !g.checked.size; };
      upd();
      box.appendChild(h('div', { class: 'catgbar' }, h('button', { class: 'btn small', onclick: () => { fcs.forEach(x => g.checked.add(x.name)); this.render(); } }, 'Select All'), h('button', { class: 'btn small', onclick: () => { g.checked.clear(); this.render(); } }, 'Clear'), addB));
    }
    render() {
      const L = this.list; L.innerHTML = ''; if (!this.items) return;
      const q = this.filter.value.trim().toLowerCase(); const only = this.onlyData.checked;
      const rows = [];
      for (const it of this.items) {
        if (it.name.startsWith('.') || it.name.startsWith('$')) continue;
        const low = it.name.toLowerCase(); let kind;
        if (it.dir) kind = /\.gdb$/i.test(low) ? 'gdb' : 'folder';
        else { const e = (/\.([^.]+)$/.exec(low) || [])[1] || ''; if (SIDE.includes(e) || /\.aux\.xml$|\.shp\.xml$/.test(low)) continue; kind = /\.inp$/.test(low) ? 'model' : /\.f?out$/.test(low) ? 'results' : AV.dataKind(low); if (only && !kind) continue; }
        if (q && !low.includes(q)) continue;
        rows.push({ it, kind: kind || 'other' });
      }
      rows.sort((a, b) => (b.it.dir - a.it.dir) || a.it.name.localeCompare(b.it.name, undefined, { numeric: true }));
      if (!rows.length) { L.appendChild(h('div', { class: 'empty' }, 'No folders or GIS files here.')); return; }
      for (const { it, kind } of rows) {
        const full = AV.joinPath(this.dir, it.name);
        const g = kind === 'gdb' ? this.gdbs.get(full) : null;
        const el = h('div', { class: 'catitem k-' + kind, draggable: !it.dir && kind !== 'unsupported', title: full + (kind === 'unsupported' ? '\n(not supported - export to Shapefile / GeoJSON / GeoTIFF)' : ''),
          onclick: () => { AV.$$('.catitem.sel', L).forEach(x => x.classList.remove('sel')); el.classList.add('sel'); this.sel = full; },
          ondblclick: () => { if (kind === 'gdb') this.toggleGdb(full); else if (it.dir) this.go(full); else if (kind === 'model') this.app.openFile(full); else if (kind === 'results') this.app.sim.loadResults(full, full.replace(/\.out$/i, '.rpt').replace(/\.fout$/i, '.frpt'), false); else AV.addData(this.app, [full]); },
          oncontextmenu: (e) => { e.preventDefault(); this.app.contextMenu(e.clientX, e.clientY, [kind === 'gdb' ? { label: g && g.open ? 'Collapse' : 'Expand Feature Classes', fn: () => this.toggleGdb(full) } : it.dir ? { label: 'Open Folder', fn: () => this.go(full) } : kind === 'model' ? { label: 'Open Model', fn: () => this.app.openFile(full) } : kind === 'results' ? { label: 'Load Results', fn: () => this.app.sim.loadResults(full, full.replace(/\.out$/i, '.rpt').replace(/\.fout$/i, '.frpt'), false) } : { label: 'Add to Map', fn: () => AV.addData(this.app, [full]) }, kind === 'vector' && /\.(shp|geojson|json)$/i.test(full) ? { label: 'Import into Network...', fn: () => this.app.tools.importNetwork(full) } : null, kind === 'gdb' ? { label: 'Add All Feature Classes', fn: async () => { await this.loadGdb(full); const gg = this.gdbs.get(full); if (gg.layers) AV.addData(this.app, gg.layers.filter(x => x.kind !== 'table').map(x => full + '|' + x.name)); } } : null, { label: 'Show in Explorer', fn: () => window.host.showItem(full) }, { label: 'Copy Path', fn: () => navigator.clipboard.writeText(full) }].filter(Boolean)); } },
          kind === 'gdb' ? h('span', { class: 'ctw', onclick: (e) => { e.stopPropagation(); this.toggleGdb(full); } }, g && g.open ? '▾' : '▸') : null,
          h('span', { class: 'ci' }, ICON[kind] || '·'), h('span', { class: 'cn' }, it.name), it.dir ? null : h('span', { class: 'cs' }, AV.fmtBytes ? AV.fmtBytes(it.size) : (it.size / 1024).toFixed(0) + ' KB'));
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/osemcm-path', full); e.dataTransfer.effectAllowed = 'copy'; });
        L.appendChild(el);
        if (g && g.open) this.renderGdb(full, g, L);
      }
    }
  }
  AV.Catalog = Catalog;
  AV.fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
})(window.AV);
