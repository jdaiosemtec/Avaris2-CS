// OsemCM - application core
'use strict';
(function (AV) {
  const h = AV.h;

  class App {
    constructor() {
      this.model = null; this.filePath = null; this.dirty = false;
      this.selection = new Set();
      this.undoStack = []; this.redoStack = [];
      this.editEnabled = false;
      this.listeners = {};
      this.showSubOutlets = true;
      this.views = new Map(); // id -> {tab, el, onShow, onClose}
      this.activeView = null;
      this.results = null;
      this.settings = { recent: [] };
      this.prefs = { shiftPick: true, invertRain: true, askComment: false, histFreq: 'save', simplifyMap: true, selNode: '#ffd600', selLink: '#ff1744', selSub: '#00bcd4' };
      this.defaults = { junctionDepth: 10, conduitDiameter: 1.0, conduitRough: 0.013, conduitLength: 400, autoLength: true, subArea: 5, subWidth: 500, subImperv: 25, subSlope: 0.5 };
    }

    async init() {
      this.info = await window.host.info();
      this.settings = Object.assign({ recent: [] }, await window.host.getSettings());
      if (this.settings.defaults) Object.assign(this.defaults, this.settings.defaults);
      if (this.settings.prefs) Object.assign(this.prefs, this.settings.prefs);
      await this.loadLicence();
      this.buildLayout();
      this.theme = new AV.Theme(this);
      this.map = new AV.MapView(AV.$('#mapWrap'), this);
      this.panels = new AV.Panels(this);
      this.sim = new AV.Sim(this);
      this.tools = new AV.Tools(this);
      this.feat = new AV.Features(this);
      this.auth = new AV.Auth(this);
      this.hist = new AV.History(this); this.hist.mountPanel(AV.$('#logPane'));
      this.timeStep = new AV.TimeStepPane(this, AV.$('#tsPane'));
      this.symPane = new AV.SymPane(this, AV.$('#rp-sym')); this.symPane.render();
      this.catalog = new AV.Catalog(this, AV.$('#rp-catalog'));
      this.exporter = new AV.ExportPane(this, AV.$('#rp-export'));
      this.updateRightPanes();
      this.setTool('select');
      this.setModel(AV.newModel(), null);
      this.dirty = false; this.updateTitle();
      this.showWelcome(true);
      await this.auth.init();
      window.host.onRequestClose(async () => { if (await this.checkSave()) window.host.confirmClose(); });
      window.host.onOpenFile((p) => this.openFile(p));
      window.host.onProgress((p) => this.sim.onProgress(p));
      document.addEventListener('keydown', (e) => this.onKey(e));
      document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu') && !e.target.closest('.ctxmenu')) this.closeMenus(); });
      this.engineVersion = await window.host.engineVersion();
      // engine version is shown in Help → About only
    }

    // drag handle between Parameter View and Layer View (like Avaris): sets the Parameter View height, remembered in the preferences
    makeVSplitter() {
      const sp = h('div', { class: 'vsplitter', title: 'Drag to resize Parameter View / Layer View' }, h('span', null, '⋯'));
      const apply = (px) => { const tp = AV.$('#treePane'); if (!tp || !px) return; tp.style.flex = '0 0 ' + px + 'px'; };
      setTimeout(() => apply(this.prefs && this.prefs.treeH), 0);
      sp.addEventListener('mousedown', (e) => { e.preventDefault(); const tp = AV.$('#treePane'), lf = AV.$('#left'); const y0 = e.clientY, h0 = tp.getBoundingClientRect().height, max = lf.getBoundingClientRect().height - 120;
        document.body.style.cursor = 'row-resize';
        const mv = (ev) => { const px = Math.max(80, Math.min(max, h0 + ev.clientY - y0)); apply(px); this.prefs.treeH = Math.round(px); };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.style.cursor = ''; this.savePrefs(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); });
      sp.addEventListener('dblclick', () => { const tp = AV.$('#treePane'); tp.style.flex = ''; delete this.prefs.treeH; this.savePrefs(); });
      return sp;
    }
    // ---------------------------------------------------------------- layout
    buildLayout() {
      const app = AV.$('#app');
      const ribbon = h('div', { id: 'ribbon' });
      this.buildRibbon(ribbon);
      const left = h('div', { id: 'left' },
        h('div', { id: 'treePane' }, h('div', { class: 'ptitle' }, h('span', null, 'Parameter View'), h('span', { class: 'sub', id: 'modelCount' })), h('div', { class: 'pbody', id: 'tree' })),
        this.makeVSplitter(),
        h('div', { id: 'layerPane' }, h('div', { class: 'ptitle' }, h('span', null, 'Layer View'), h('span', { class: 'lpbtns' }, h('button', { class: 'btn small', title: 'Add a GIS layer (Catalog)', onclick: () => this.showRightTab('catalog') }, '+ Add Layer'),
          h('button', { class: 'btn small', title: 'Open the attribute table of a layer', onclick: (e) => this.attrTableMenu(e) }, 'Attribute Table'))), h('div', { class: 'pbody', id: 'layers' })));
      const center = h('div', { id: 'center' },
        h('div', { id: 'doctabs' }),
        h('div', { id: 'views' },
          h('div', { class: 'view', id: 'view-map' }, h('div', { id: 'mapWrap' }, h('div', { id: 'legend' }), h('div', { id: 'mapHint' }), h('div', { class: 'welcome', id: 'welcome' })),
            h('div', { id: 'playbar' }))));
      this.descBox = h('textarea', { id: 'projDesc', spellcheck: 'false', placeholder: 'Project title / notes ([TITLE] section)', onchange: () => { const old = this.model.title, nw = this.descBox.value.split('\n'); this.exec({ label: 'Edit description', light: true, do: () => this.model.title = nw, undo: () => { this.model.title = old; this.descBox.value = old.join('\n'); } }); } });
      const propsPane = h('div', { class: 'rpane', id: 'rp-props' }, h('div', { class: 'ptitle' }, h('span', null, 'Properties'), h('span', { class: 'sub', id: 'propSub' })), h('div', { class: 'pbody', id: 'props' }),
        h('div', { id: 'tsPane', style: { display: 'none' } }),
        h('div', { id: 'logPane' }),
        h('div', { id: 'descPane' }, h('div', { class: 'ptitle', style: { borderTop: '1px solid var(--border)' } }, h('span', null, 'Project Description')), this.descBox));
      const rtab = (t, l) => h('div', { class: 'rt' + (t === 'props' ? ' active' : ''), 'data-t': t, onclick: () => this.showRightTab(t) }, l);
      const right = h('div', { id: 'right' }, propsPane, h('div', { class: 'rpane', id: 'rp-catalog', style: { display: 'none' } }), h('div', { class: 'rpane', id: 'rp-sym', style: { display: 'none' } }), h('div', { class: 'rpane', id: 'rp-export', style: { display: 'none' } }),
        h('div', { id: 'rightTabs' }, rtab('props', 'Properties'), rtab('catalog', 'Catalog'), rtab('sym', 'Symbology'), rtab('export', 'Export')));
      const mk = (side) => { const s = h('div', { class: 'splitter' }); this.makeSplitter(s, side === 'L' ? left : right, side); return s; };
      const main = h('div', { id: 'main' }, left, mk('L'), center, mk('R'), right);
      const sb = h('div', { id: 'statusbar' },
        h('div', { class: 'sb' }, 'Flow Units: ', h('span', { id: 'sbUnits' }, 'CFS')),
        h('div', { class: 'sb' }, 'Offsets: ', h('span', { id: 'sbOffsets' }, 'DEPTH')),
        h('div', { class: 'sb' }, 'Map Units: ', h('select', { id: 'sbMapUnits', onchange: (e) => { const m = this.model, old = m.mapInfo.units, nw = e.target.value; const sync = () => { AV.$('#sbMapUnits').value = m.mapInfo.units; }; this.exec({ label: 'Map units ' + nw, light: true, do: () => { m.mapInfo.units = nw; sync(); }, undo: () => { m.mapInfo.units = old; sync(); } }); } }, ['None', 'Feet', 'Meters', 'Degrees'].map(u => h('option', { value: u }, u)))),
        h('div', { class: 'sb' }, 'Edit: ', h('span', { id: 'sbEdit' }, 'OFF')),
        h('div', { class: 'sb grow', id: 'sbMsg' }, 'Ready'),
        h('div', { class: 'sb', id: 'sbResults' }, 'No results'),
        h('div', { class: 'sb selstat', id: 'sbSelStat', style: { display: 'none' } }),
        h('div', { class: 'sb user', id: 'sbUser', onclick: (e) => this.auth.userMenu(e) }, ''),
        h('div', { class: 'sb mono', id: 'sbXY', style: { minWidth: '210px' } }, 'X: -  Y: -'));
      app.append(ribbon, main, sb);
      document.body.appendChild(h('div', { id: 'tooltip' }));
      this.addView('map', 'Map', AV.$('#view-map'), { closable: false });
      this.activateView('map');
    }
    makeSplitter(s, panel, side) {
      s.addEventListener('mousedown', (e) => {
        const x0 = e.clientX, w0 = panel.getBoundingClientRect().width;
        const mv = (ev) => { const d = side === 'L' ? ev.clientX - x0 : x0 - ev.clientX; panel.style.width = Math.max(160, Math.min(700, w0 + d)) + 'px'; };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      });
    }

    menuDefs() {
      const T = () => this.tools, S = () => this.sim;
      return [
        {
          label: 'Project', items: [
            { label: 'New', key: 'Ctrl+N', fn: () => this.newProject() },
            { label: 'Open...', key: 'Ctrl+O', fn: () => this.openDialog() },
            { label: 'Open Recent', sub: () => (this.settings.recent || []).map(p => ({ label: p, fn: () => this.openFile(p) })) },
            { label: 'Open Sample Model', fn: () => this.openSample() },
            { label: 'Save', key: 'Ctrl+S', fn: () => this.save() },
            { label: 'Save As...', fn: () => this.save(true) },
            '-',
            { label: 'Import', sub: [{ label: 'Shapefile / GeoJSON into Network...', fn: () => T().importNetwork() }, { label: 'Background Layer (Shapefile / GeoJSON)...', fn: () => T().loadLayer() }] },
            { label: 'Export', sub: [{ label: 'Network to Shapefiles...', fn: () => T().exportShapefiles() }, { label: 'Network to GeoJSON...', fn: () => T().exportGeoJSON() }, { label: 'Network Tables to CSV...', fn: () => T().exportCSVTables() }] },
            '-',
            { label: 'Object Defaults...', fn: () => this.sim.optionsDialog('Object Defaults') },
            { label: 'Exit', fn: () => window.close() },
          ]
        },
        {
          label: 'Edit', items: [
            { label: 'Undo', key: 'Ctrl+Z', fn: () => this.undo() }, { label: 'Redo', key: 'Ctrl+Y', fn: () => this.redo() }, '-',
            { label: 'Select All', key: 'Ctrl+A', fn: () => this.selectAll() }, { label: 'Clear Selection', key: 'Esc', fn: () => this.clearSelection() },
            { label: 'Invert Selection', fn: () => this.invertSelection() },
            { label: 'Find Object...', key: 'Ctrl+F', fn: () => T().find() },
            '-',
            { label: 'Delete Selected', key: 'Del', fn: () => this.deleteSelection() },
            { label: 'Reverse Selected Links', fn: () => T().reverseLinks() },
            { label: 'Batch Edit Selected...', fn: () => T().batchEdit() },
            { label: 'Toggle Edit Mode (move objects)', fn: () => this.toggleEdit() },
          ]
        },
        {
          label: 'View', items: [
            { label: 'Zoom to All', key: 'Home', fn: () => this.map.zoomAll() },
            { label: 'Zoom to Selection', fn: () => this.map.zoomToObjects([...this.selection]) },
            '-',
            { label: 'Node Labels', check: () => this.map.showNodeLabels, fn: () => { this.map.showNodeLabels = !this.map.showNodeLabels; this.map.redraw(); } },
            { label: 'Link Labels', check: () => this.map.showLinkLabels, fn: () => { this.map.showLinkLabels = !this.map.showLinkLabels; this.map.redraw(); } },
            { label: 'Flow Direction Arrows', check: () => this.map.showArrows, fn: () => { this.map.showArrows = !this.map.showArrows; this.map.redraw(); } },
            { label: 'Subcatchment Outlet Lines', check: () => this.showSubOutlets, fn: () => { this.showSubOutlets = !this.showSubOutlets; this.map.redraw(); } },
            '-',
            { label: 'Thematic Rendering...', fn: () => this.theme.dialog() },
            { label: 'Symbol Sizes...', fn: () => this.symbolDialog() },
            { label: 'Bookmarks', sub: () => [{ label: 'Create Bookmark...', fn: () => this.createBookmark() }].concat((this.settings.bookmarks || []).map(b => ({ label: b.name, fn: () => this.map.zoomToBox(b.box, 0) }))) },
            '-',
            { label: 'Attribute Table', sub: [['Junctions', 'JUNCTION'], ['Outfalls', 'OUTFALL'], ['Storage Units', 'STORAGE'], ['Dividers', 'DIVIDER'], ['Conduits', 'CONDUIT'], ['Pumps', 'PUMP'], ['Orifices', 'ORIFICE'], ['Weirs', 'WEIR'], ['Outlets', 'OUTLET'], ['Subcatchments', 'SUBCATCH'], ['Rain Gages', 'GAGE']].map(([l, t]) => ({ label: l, fn: () => AV.openTable(this, t) })) },
          ]
        },
        {
          label: 'Tools', items: [
            { label: 'Connectivity', sub: [{ label: 'Trace Upstream', fn: () => T().trace('up') }, { label: 'Trace Downstream', fn: () => T().trace('down') }, { label: 'Query Path (From - To Node)...', fn: () => T().queryPath() }, { label: 'Clear Trace', fn: () => T().clearTrace() }] },
            { label: 'Subcatchment', sub: [{ label: 'Batch Assign Outlet...', fn: () => T().batchAssignOutlet() }, { label: 'Recalculate Area...', fn: () => T().recalcArea() }] },
            { label: 'Conduit', sub: [{ label: 'Recalculate Length...', fn: () => T().recalcLength() }, { label: 'Derive Elevation (Design Inverts)...', fn: () => T().deriveElevation() }] },
            { label: 'Convergence', sub: [{ label: 'Convert Orifices to Equivalent Conduits...', fn: () => T().orificeToConduit() }, { label: 'Nonconvergence Diagnostics', fn: () => S().convergenceDiagnostics() }] },
            { label: 'Hyetograph (Design Storm)...', fn: () => AV.hyetographDialog(this) },
            { label: 'Spatial Reference', sub: [{ label: 'Convert Coordinates (Offset / Scale / Rotate)...', fn: () => T().transformCoords() }] },
            '-',
            { label: 'Validate Network...', fn: () => T().validate() },
            { label: 'Measure Distance', fn: () => this.setTool('measure') },
            { label: 'Model Summary', fn: () => T().summary() },
          ]
        },
        {
          label: 'Simulation', items: [
            { label: 'Simulation Options...', fn: () => S().optionsDialog() },
            { label: 'Run Simulation', key: 'F5', fn: () => S().run() },
            '-',
            { label: 'Create Meshes (2D)...', fn: () => AV.alert('2D surface mesh generation is not part of this build.\n\nThis version runs 1D drainage-network (SWMM-based) simulations with the Avaris engine modifications. Flooded volumes are reported per node (ponding / flooding).', 'Create Meshes') },
          ]
        },
        {
          label: 'Results', items: [
            { label: 'Status Report', fn: () => S().showReport() },
            { label: 'Time Series Plot...', fn: () => S().plotDialog() },
            { label: 'Profile Plot...', fn: () => S().profileDialog() },
            { label: 'Nonconvergence Diagnostics', fn: () => S().convergenceDiagnostics() },
            { label: 'Compare Hydrographs with Another Run...', fn: () => S().compareDialog() },
            '-',
            { label: 'Load Results File (.out)...', fn: () => S().loadOutDialog() },
            { label: 'Export', sub: [{ label: 'CSV by Time (all objects at a time step)...', fn: () => S().exportByTime() }, { label: 'CSV by Variable (time series)...', fn: () => S().exportByVariable() }, { label: 'CSV by Statistics (max/min/mean)...', fn: () => S().exportByStats() }, { label: 'Shapefile with Results...', fn: () => T().exportShapefiles(true) }] },
            { label: 'Clear Results', fn: () => S().clearResults() },
          ]
        },
        {
          label: 'Help', items: [
            { label: 'Quick Start', fn: () => this.quickStart() },
            { label: 'Avaris User Guide (online)', fn: () => window.host.openExternal('https://osemtec.com/avaris.html') },
            { label: 'Keyboard Shortcuts', fn: () => this.shortcuts() },
            { label: 'About', fn: () => this.about() },
          ]
        },
      ];
    }
    buildMenu(def) {
      const pop = h('div', { class: 'menu-pop' });
      const menu = h('div', { class: 'menu' }, def.label, pop);
      const fill = (container, items) => {
        container.innerHTML = '';
        for (const it of items) {
          if (it === '-') { container.appendChild(h('div', { class: 'msep' })); continue; }
          if (it.sub) {
            const sp = h('div', { class: 'menu-pop' });
            const el = h('div', { class: 'mi sub', onmouseenter: () => fill(sp, typeof it.sub === 'function' ? it.sub() : it.sub) }, h('span', null, it.label), sp);
            container.appendChild(el); continue;
          }
          const chk = it.check ? (it.check() ? '✓ ' : ' ') : '';
          container.appendChild(h('div', { class: 'mi', onclick: (e) => { e.stopPropagation(); this.closeMenus(); it.fn(); } }, h('span', null, chk + it.label), it.key ? h('span', { class: 'key' }, it.key) : null));
        }
        if (!items.length) container.appendChild(h('div', { class: 'mi disabled' }, '(none)'));
      };
      menu.addEventListener('mousedown', (e) => {
        if (e.target.closest('.menu-pop')) return;
        const open = menu.classList.contains('open'); this.closeMenus();
        if (!open) { fill(pop, def.items); menu.classList.add('open'); }
      });
      menu.addEventListener('mouseenter', () => { if (AV.$('.menu.open') && !menu.classList.contains('open')) { this.closeMenus(); fill(pop, def.items); menu.classList.add('open'); } });
      return menu;
    }
    closeMenus() { AV.$$('.menu.open').forEach(m => m.classList.remove('open')); AV.$$('.ctxmenu').forEach(m => m.remove()); }
    contextMenu(x, y, items) {
      this.closeMenus();
      const pop = h('div', { class: 'menu-pop' });
      for (const it of items) {
        if (it === '-') { pop.appendChild(h('div', { class: 'msep' })); continue; }
        pop.appendChild(h('div', { class: 'mi' + (it.disabled ? ' disabled' : ''), onclick: () => { if (it.disabled) return; this.closeMenus(); it.fn(); } }, h('span', null, it.label)));
      }
      const cm = h('div', { class: 'ctxmenu', style: { left: x + 'px', top: y + 'px' } }, pop);
      document.body.appendChild(cm);
      const r = cm.getBoundingClientRect();
      if (r.bottom > window.innerHeight) cm.style.top = Math.max(0, y - r.height) + 'px';
      if (r.right > window.innerWidth) cm.style.left = Math.max(0, x - r.width) + 'px';
    }

    buildToolbar(tb) {
      const B = (icon, title, fn, id) => { const b = h('button', { class: 'tb', title, onclick: fn, id }, AV.icon(icon)); tb.appendChild(b); return b; };
      const SEP = () => tb.appendChild(h('div', { class: 'tbsep' }));
      B('new', 'New project (Ctrl+N)', () => this.newProject()); B('open', 'Open (Ctrl+O)', () => this.openDialog()); B('save', 'Save (Ctrl+S)', () => this.save());
      SEP(); B('undo', 'Undo (Ctrl+Z)', () => this.undo()); B('redo', 'Redo (Ctrl+Y)', () => this.redo());
      SEP();
      this.toolButtons = {};
      const T = (mode, icon, title) => { this.toolButtons[mode] = B(icon, title, () => this.setTool(mode)); };
      T('select', 'select', 'Select / move (drag box to multi-select)'); T('pan', 'pan', 'Pan (or hold Space / middle mouse)');
      T('zoomin', 'zoomin', 'Zoom in (click or drag box)'); T('zoomout', 'zoomout', 'Zoom out');
      B('full', 'Zoom to all (Home)', () => this.map.zoomAll());
      SEP();
      T('add-GAGE', 'gage', 'Add rain gage'); T('add-SUBCATCH', 'subcatch', 'Add subcatchment');
      T('add-JUNCTION', 'junction', 'Add junction'); T('add-OUTFALL', 'outfall', 'Add outfall'); T('add-DIVIDER', 'divider', 'Add flow divider'); T('add-STORAGE', 'storage', 'Add storage unit');
      T('add-CONDUIT', 'conduit', 'Add conduit'); T('add-PUMP', 'pump', 'Add pump'); T('add-ORIFICE', 'orifice', 'Add orifice'); T('add-WEIR', 'weir', 'Add weir'); T('add-OUTLET', 'outlet', 'Add outlet');
      T('add-LABEL', 'label', 'Add map label');
      B('del', 'Delete selected (Del)', () => this.deleteSelection());
      SEP();
      B('up', 'Trace upstream from selected node/link', () => this.tools.trace('up')); B('down', 'Trace downstream from selected node/link', () => this.tools.trace('down'));
      B('path', 'Query path between two nodes', () => this.tools.queryPath());
      B('table', 'Attribute table', () => AV.openTable(this, this.defaultTableType()));
      B('theme', 'Thematic rendering', () => this.theme.dialog());
      B('find', 'Find object (Ctrl+F)', () => this.tools.find());
      SEP();
      const tt = (icon, label, title, fn, cls) => { const b = h('button', { class: 'tbtext' + (cls ? ' ' + cls : ''), title, onclick: fn }, AV.icon(icon), label); tb.appendChild(b); return b; };
      tt('options', 'Options', 'Simulation options', () => this.sim.optionsDialog());
      tt('run', 'Run', 'Run simulation (F5)', () => this.sim.run(), 'run');
      tt('report', 'Report', 'Status report', () => this.sim.showReport());
      tt('plot', 'Plot', 'Time series plot', () => this.sim.plotDialog());
      tt('profile', 'Profile', 'Long-section profile plot', () => this.sim.profileDialog());
      tt('play', 'Play', 'Animate results on the map', () => this.sim.togglePlaybar());
    }
    defaultTableType() {
      const s = [...this.selection][0];
      if (s) return s.kind === 'NODE' || s.kind === 'LINK' ? s.type : s.kind;
      return 'CONDUIT';
    }

    // ---------------------------------------------------------------- views (doc tabs)
    addView(id, title, el, opts = {}) {
      if (this.views.has(id)) { this.activateView(id); return this.views.get(id); }
      if (el.id !== 'view-map') {
        // each document view lives in its own container so its own display style never leaks
        const wrap = h('div', { class: 'view' });
        el.style.flex = '1'; el.style.minHeight = '0'; el.style.minWidth = '0';
        if (!el.style.display) { el.style.display = 'flex'; el.style.flexDirection = 'column'; }
        wrap.appendChild(el); AV.$('#views').appendChild(wrap); el = wrap;
      } else el.classList.add('view');
      const tab = h('div', { class: 'dtab', onclick: () => this.activateView(id) }, h('span', null, title));
      if (opts.closable !== false) tab.appendChild(h('button', { class: 'x', title: 'Close', onclick: (e) => { e.stopPropagation(); this.closeView(id); } }, '×'));
      AV.$('#doctabs').appendChild(tab);
      const v = { id, tab, el, onShow: opts.onShow, onClose: opts.onClose, setTitle: (t) => { tab.firstChild.textContent = t; } };
      this.views.set(id, v);
      this.activateView(id);
      return v;
    }
    activateView(id) {
      for (const [k, v] of this.views) { v.tab.classList.toggle('active', k === id); v.el.classList.toggle('active', k === id); }
      this.activeView = id;
      const v = this.views.get(id); if (v && v.onShow) v.onShow();
      if (id === 'map' && this.map) this.map.resize();
    }
    closeView(id) {
      const v = this.views.get(id); if (!v) return;
      if (v.onClose) v.onClose();
      v.tab.remove(); v.el.remove(); this.views.delete(id);
      if (this.activeView === id) this.activateView('map');
    }

    // ---------------------------------------------------------------- model / file
    setModel(m, path) {
      this.crs = null; this.crsWKT = null; this.crsName = '';
      this.model = m; this.filePath = path; this.selection.clear(); this.undoStack = []; this.redoStack = [];
      if (this.hist) this.hist.load(path);
      for (const id of [...this.views.keys()]) if (id !== 'map') this.closeView(id);
      if (this.sim) { this.sim.clearResults(true); this.sim.clearScenarios(); }
      if (this.tools) this.tools.clearTrace(true);
      this.map.grid = null; this.mesh2d = null; this.meshResults = null; this._meshRange = null;
      this.refreshAll();
      setTimeout(() => this.map.zoomAll(), 0);
    }
    on(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); return () => { this.listeners[ev] = this.listeners[ev].filter(f => f !== fn); }; }
    emit(ev, ...a) { for (const fn of (this.listeners[ev] || []).slice()) { try { fn(...a); } catch (e) { console.error(e); } } }
    async closeProject() {
      if (!await this.checkSave()) return;
      this.setModel(AV.newModel(), null); this.dirty = false; this.updateTitle(); this.showWelcome(true);
    }
    refreshAll() {
      if (this.descBox) this.descBox.value = (this.model.title || []).join('\n');
      this.panels.refreshTree(); this.panels.refreshLayers(); this.panels.showProps();
      AV.$('#sbUnits').textContent = this.model.flowUnits;
      AV.$('#sbOffsets').textContent = (this.model.options.LINK_OFFSETS || 'DEPTH').toUpperCase();
      const mu = (this.model.mapInfo.units || 'None'); const sel = AV.$('#sbMapUnits'); sel.value = ['None', 'Feet', 'Meters', 'Degrees'].find(u => u.toUpperCase() === mu.toUpperCase()) || 'None';
      this.theme.invalidate(); this.map.redraw();
    }
    mapUnitsLabel() { const u = (this.model && this.model.mapInfo.units || 'None').toUpperCase(); return u === 'FEET' ? 'ft' : u === 'METERS' ? 'm' : u === 'DEGREES' ? 'deg' : (this.model && this.model.isSI ? 'm' : 'ft'); }
    lengthUnits() { return this.model.isSI ? 'm' : 'ft'; }
    setDirty() { this.dirty = true; this.model.touch(); this.updateTitle(); this.refreshRibbon(); }
    updateTitle() {
      const name = this.filePath ? AV.basename(this.filePath) : 'Untitled';
      window.host.setTitle('OsemCM V2.0 ' + (AV.editionLabel(this) ? AV.editionLabel(this) + ' ' : '') + '-- ' + name + (this.dirty ? ' *' : ''));
      const rt = AV.$('#rtitle'); if (rt) rt.textContent = 'OsemCM V2.0 ' + (AV.editionLabel(this) ? AV.editionLabel(this) + ' ' : '') + '-- ' + name + (this.dirty ? ' *' : '');
      const m = this.model;
      AV.$('#modelCount').textContent = m ? `${m.nodes.size} nodes · ${m.links.size} links` : '';
    }
    async checkSave() {
      if (!this.dirty) return true;
      const r = await window.host.message({ type: 'question', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2, message: 'Save changes to ' + (this.filePath ? AV.basename(this.filePath) : 'Untitled') + '?' });
      if (r === 2) return false;
      if (r === 0) return await this.save();
      return true;
    }
    async newProject() {
      if (!await this.checkSave()) return;
      const m = AV.newModel();
      const r = await AV.formDialog('New Project', [
        { k: 'units', l: 'Flow Units', t: 'choice', o: ['CFS', 'GPM', 'MGD', 'CMS', 'LPS', 'MLD'], d: 'CFS' },
        { k: 'mapUnits', l: 'Map Units', t: 'choice', o: ['Feet', 'Meters', 'Degrees', 'None'], d: 'Feet' },
        { k: 'routing', l: 'Flow Routing', t: 'choice', o: ['DYNWAVE', 'KINWAVE', 'STEADY'], d: 'DYNWAVE' },
        { k: 'infil', l: 'Infiltration Model', t: 'choice', o: ['HORTON', 'MODIFIED_HORTON', 'GREEN_AMPT', 'MODIFIED_GREEN_AMPT', 'CURVE_NUMBER'], d: 'HORTON' },
      ], {}, { okLabel: 'Create' });
      if (!r) return;
      m.options.FLOW_UNITS = r.units; m.options.FLOW_ROUTING = r.routing; m.options.INFILTRATION = r.infil; m.mapInfo.units = r.mapUnits;
      if (['CMS', 'LPS', 'MLD'].includes(r.units)) { this.defaults.conduitLength = 100; this.defaults.junctionDepth = 3; this.defaults.conduitDiameter = 0.3; this.defaults.subWidth = 150; this.defaults.subArea = 2; }
      this.setModel(m, null); this.dirty = false; this.updateTitle(); this.showWelcome(false);
      AV.toast('New project created. Use the toolbar to add objects, or Project > Import.');
    }
    async openDialog() {
      if (!await this.checkSave()) return;
      const p = await window.host.openDialog({ title: 'Open model', filters: [{ name: 'Avaris / SWMM input', extensions: ['inp'] }, { name: 'All files', extensions: ['*'] }] });
      if (p) this.openFile(p, true);
    }
    async openSample(skipCheck) {
      try { const p = await window.host.prepareSample('Demo_Urban_Drainage.inp'); this.openFile(p, skipCheck); }
      catch (e) { this.openFile(AV.joinPath(this.info.samples, 'Demo_Urban_Drainage.inp'), skipCheck); }
    }
    async openFile(p, skipCheck) {
      if (!skipCheck && !await this.checkSave()) return;
      this.status('Opening ' + p + ' ...');
      try {
        const text = await window.host.readText(p);
        const t0 = performance.now();
        const m = AV.Model.parse(text);
        this.setModel(m, p); this.dirty = false; this.updateTitle(); this.showWelcome(false);
        this.addRecent(p);
        this.status(`Opened ${AV.basename(p)} (${m.nodes.size} nodes, ${m.links.size} links, ${m.subcatchments.size} subcatchments) in ${((performance.now() - t0) / 1000).toFixed(2)} s`);
        if (m.warnings && m.warnings.length) AV.alert('Some lines could not be read:\n\n' + m.warnings.slice(0, 30).join('\n'), 'Import warnings');
        // coordinate system from an Avaris DS project file (.ini / .sw [Reference])
        this.crsWKT = null;
        for (const ext of ['.ini', '.sw']) {
          const pp = p.replace(/\.inp$/i, ext);
          if (pp !== p && await window.host.exists(pp)) {
            // [Reference] keeps a list 1="WKT", 2="WKT" ... and current = 0-based index of the one in use
            const t = await window.host.readText(pp); const sec = /\[Reference\]([\s\S]*?)(?:\n\[|$)/.exec(t); const cur = sec && /^\s*current=(\d+)/m.exec(sec[1]);
            if (cur) { const get = (k) => { const mm = new RegExp('^' + k + '="(.+)"\\s*$', 'm').exec(sec[1]); const w = mm ? mm[1].replace(/\\"/g, '"') : null; return w && /^\s*(PROJCS|GEOGCS|PROJCRS|GEOGCRS|COMPD_CS)/i.test(w) ? w : null; };
              const w = get(+cur[1] + 1) || get(cur[1]); if (w) { this.crsWKT = w; break; } }
          }
        }
        if (!this.crsWKT) { const pp = p.replace(/\.inp$/i, '.prj'); if (pp !== p && await window.host.exists(pp)) { try { this.crsWKT = (await window.host.readText(pp)).trim(); } catch (e) { } } }
        this.setCRS(this.crsWKT);
        if (this.crsWKT && (m.mapInfo.units || 'None').toUpperCase() === 'NONE') {
          try { const P = AV.Proj.parse(this.crsWKT); m.mapInfo.units = P.type === 'geographic' ? 'Degrees' : (Math.abs(P.unit - 1) < 1e-6 ? 'Meters' : 'Feet'); this.refreshAll(); } catch (e) { }
        }
        // 2D flood module: settings from an Avaris DS project, mesh from <model>.mesh2d.json (rebuilt when missing)
        if (AV.has2D(this)) { await AV.importAvaris2D(this); await AV.loadMesh2D(this); }
        if (AV.has2D(this) && !this.mesh2d && !this._meshRemoved && AV.f2dEnabled(m) && AV.f2d(m).BOUNDARY && AV.f2d(m).DEM) await AV.createMeshes(this, true);
        if (this.mesh2d) { this.panels.refreshLayers(); this.map.redraw(); }
        // auto-load previous results if they exist next to the model (1D-2D results first)
        const fout = p.replace(/\.inp$/i, '.fout'), out = p.replace(/\.inp$/i, '.out');
        if (this.mesh2d && fout !== p && await window.host.exists(fout)) this.sim.offerExistingResults(fout, p.replace(/\.inp$/i, '.frpt'));
        else if (out !== p && await window.host.exists(out)) this.sim.offerExistingResults(out, p.replace(/\.inp$/i, '.rpt'));
      } catch (e) { AV.alert('Could not open file:\n' + e.message, 'Error'); this.status('Ready'); }
    }
    async save(as) {
      let p = this.filePath;
      if (as || !p) {
        p = await window.host.saveDialog({ title: 'Save model', defaultPath: p || 'model.inp', filters: [{ name: 'Avaris / SWMM input', extensions: ['inp'] }] });
        if (!p) return false;
      }
      if (!this.canModify()) return false;
      try {
        await window.host.writeText(p, this.model.toINP());
        const moved = this.filePath !== p; this.filePath = p;
        if (this.mesh2d && moved) { try { await window.host.writeText(AV.meshPath(this), JSON.stringify(this.mesh2d)); } catch (e) { } } this.dirty = false; this.updateTitle(); this.addRecent(p);
        if (this.hist) await this.hist.commit(p);
        this.status('Saved ' + p); return true;
      } catch (e) { AV.alert('Could not save:\n' + e.message, 'Error'); return false; }
    }
    addRecent(p) {
      const r = (this.settings.recent || []).filter(x => x !== p); r.unshift(p); this.settings.recent = r.slice(0, 10);
      window.host.setSettings(this.settings);
    }
    showWelcome(show) {
      const w = AV.$('#welcome'); w.innerHTML = '';
      if (!show) { w.style.display = 'none'; return; }
      w.style.display = 'flex';
      const recent = (this.settings.recent || []).slice(0, 5);
      w.appendChild(h('div', { class: 'card' },
        h('h2', null, 'OsemCM'),
        h('p', null, 'Urban drainage & sewer network modeling - opens Avaris DS and EPA SWMM .inp models (SWMM 5.2 engine with Avaris convergence upgrades).'),
        h('div', { class: 'btns' },
          h('button', { class: 'btn primary', onclick: () => this.openDialog() }, 'Open Model...'),
          h('button', { class: 'btn', onclick: () => this.newProject() }, 'New Project'),
          h('button', { class: 'btn', onclick: () => this.openSample(true) }, 'Open Sample')),
        recent.length ? h('div', { class: 'recent' }, h('div', { style: { color: 'var(--muted)', marginBottom: '4px' } }, 'Recent'), recent.map(p => h('a', { title: p, onclick: () => this.openFile(p) }, p))) : null));
    }
    status(msg) { AV.$('#sbMsg').textContent = msg; if (this.feat) this.feat.log(msg); }

    // ---------------------------------------------------------------- undo / redo
    canModify(quiet) { if (!this.auth || !this.auth.current || this.auth.canEdit) return true; if (!quiet) AV.toast('Your role (' + this.auth.roleLabel + ') cannot change the model. Ask an Administrator, or switch user from the status bar.', true); return false; }
    exec(cmd) { if (!this.canModify()) { this.panels.showProps(); return false; } cmd.do(); this.undoStack.push(cmd); if (this.undoStack.length > 1000) this.undoStack.shift(); this.redoStack = []; if (this.hist) this.hist.record(cmd, 'do'); this.afterEdit(cmd); return true; }
    undo() { if (!this.canModify()) return; const c = this.undoStack.pop(); if (!c) return; c.undo(); this.redoStack.push(c); if (this.hist) this.hist.record(c, 'undo'); this.afterEdit(c); this.status('Undo: ' + c.label); }
    redo() { if (!this.canModify()) return; const c = this.redoStack.pop(); if (!c) return; c.do(); this.undoStack.push(c); if (this.hist) this.hist.record(c, 'do'); this.afterEdit(c); this.status('Redo: ' + c.label); }
    afterEdit(cmd) {
      if (!cmd || !cmd.noGeom) this.model.geomVersion = (this.model.geomVersion || 0) + 1;
      this.setDirty();
      for (const o of [...this.selection]) if (!this.objExists(o)) this.selection.delete(o);
      this.updateSelStats();
      if (!cmd || !cmd.light) { this.panels.refreshTree(); AV.refreshTables(this); }
      // object counts in the Layer View change when objects are added / deleted / undone
      if (!cmd || !cmd.noGeom) { const k = this.model.nodes.size + '|' + this.model.links.size + '|' + this.model.subcatchments.size; if (k !== this._layerCountKey) { this._layerCountKey = k; this.panels.refreshLayers(); } }
      this.panels.showProps(); this.theme.invalidate();
      // property edits that the map does not show (no theme / label on that field) only need the overlay
      if (cmd && cmd.noGeom && cmd.changes && !cmd.changes.some(c => this.theme.usesField(c.key))) this.map.redrawOverlay(); else this.map.redraw();
    }
    objExists(o) {
      if (o.kind === 'LABEL') return this.model.labels.includes(o);
      const c = o.kind === 'NODE' ? this.model.nodes : o.kind === 'LINK' ? this.model.links : o.kind === 'SUBCATCH' ? this.model.subcatchments : this.model.gages;
      return c.get(o.id) === o;
    }
    // property change helper (undoable)
    setProps(objs, key, values) {
      const m = this.model;
      const olds = objs.map(o => AV.getField(m, o, key));
      const setv = (vals) => objs.forEach((o, i) => AV.setField(m, o, key, vals[i]));
      this.exec({ label: 'Edit ' + key, light: true, noGeom: true, do: () => setv(values), undo: () => setv(olds), changes: objs.map((o, i) => ({ o, key, old: olds[i], nw: values[i] })) });
    }

    // ---------------------------------------------------------------- selection
    select(o, add) {
      if (!add) this.selection.clear();
      if (add && this.selection.has(o)) this.selection.delete(o); else this.selection.add(o);
      this.onSelectionChanged();
    }
    selectMany(list, add) { if (!add) this.selection.clear(); for (const o of list) this.selection.add(o); this.onSelectionChanged(); }
    clearSelection() { if (!this.selection.size) return; this.selection.clear(); this.onSelectionChanged(); }
    selectAll() { this.selection.clear(); for (const c of [this.model.nodes, this.model.links, this.model.subcatchments, this.model.gages]) for (const o of c.values()) this.selection.add(o); this.onSelectionChanged(); }
    // Layer View "Attribute Table" button: open the table of the selected objects' layer, or choose a layer
    attrTableMenu(e) {
      const m = this.model; const r = e.currentTarget.getBoundingClientRect();
      const N = { JUNCTION: 'Junctions', OUTFALL: 'Outfalls', STORAGE: 'Storages', DIVIDER: 'Dividers', CONDUIT: 'Conduits', PUMP: 'Pumps', ORIFICE: 'Orifices', WEIR: 'Weirs', OUTLET: 'Outlets', SUBCATCH: 'Subcatchments' };
      const cnt = (t) => t === 'SUBCATCH' ? m.subcatchments.size : AV.NODE_TYPES.includes(t) ? [...m.nodes.values()].filter(n => n.type === t).length : [...m.links.values()].filter(l => l.type === t).length;
      const items = Object.keys(N).map(t => ({ label: N[t] + '  (' + cnt(t) + ')', fn: () => AV.openTable(this, t) }));
      if (this.mesh2d && AV.has2D(this)) items.push('-', { label: '2D Meshes  (' + this.mesh2d.cells.length + ')', fn: () => AV.meshTable(this) });
      this.contextMenu(r.left, r.bottom + 2, items);
    }
    invertSelection() {
      const key = (o) => o.kind === 'NODE' || o.kind === 'LINK' ? o.type : o.kind; const types = new Set([...this.selection].map(key));
      const vis = (o) => o.kind === 'GAGE' || AV.symOf(this, o.kind === 'SUBCATCH' ? 'SUBCATCH' : o.type).visible;
      const s = new Set(); for (const c of [this.model.nodes, this.model.links, this.model.subcatchments, this.model.gages]) for (const o of c.values()) if (!this.selection.has(o) && (types.size ? types.has(key(o)) : vis(o))) s.add(o);
      this.selection = s; this.onSelectionChanged(); this.status(s.size + ' object(s) selected (inverted within ' + (types.size ? [...types].join(', ').toLowerCase() : 'visible layers') + ')'); }
    // right-side panes: Description only when nothing is selected; Log / Time Step toggled from the ribbon
    updateRightPanes() {
      const none = this.selection.size === 0;
      const d = AV.$('#descPane'); if (d) d.style.display = none ? '' : 'none';
      const lp = AV.$('#logPane'); if (lp) lp.style.display = this.prefs.logPane === false ? 'none' : '';
      const tp = AV.$('#tsPane'); if (tp) tp.style.display = this.tsOpen ? '' : 'none';
    }
    toggleLogPane() { this.prefs.logPane = this.prefs.logPane === false; this.savePrefs(); this.updateRightPanes(); this.refreshRibbon(); }
    onSelectionChanged() { if (this.selection.size && this.rightTab === 'sym') this.showRightTab('props'); this.updateRightPanes(); this.emit('selection', [...this.selection]); this.panels.showProps(); this.map.redrawOverlay(); AV.syncTableSelection(this); const n = this.selection.size; this.status(n ? n + ' object(s) selected' : 'Ready'); this.updateSelStats(); }
    // status bar "Selection Statistics": total area of the selected subcatchments and total length of the selected links,
    // in a unit the user picks with the small button next to it
    updateSelStats() {
      const el = AV.$('#sbSelStat'); if (!el) return; const m = this.model; el.innerHTML = '';
      const subs = [], links = []; for (const o of this.selection) { if (o.kind === 'SUBCATCH') subs.push(o); else if (o.kind === 'LINK') links.push(o); }
      if (!subs.length && !links.length) { el.style.display = 'none'; return; }
      el.style.display = '';
      const si = m.isSI; const P = this.prefs || (this.prefs = {});
      const AU = { ac: 4046.8564224, ha: 10000, 'km²': 1e6, 'm²': 1, 'ft²': 0.09290304, 'mi²': 2589988.110336 }, LU = { m: 1, km: 1000, ft: 0.3048, mi: 1609.344 };
      if (!AU[P.selAreaUnit]) P.selAreaUnit = si ? 'ha' : 'ac'; if (!LU[P.selLenUnit]) P.selLenUnit = si ? 'm' : 'ft';
      const parts = [h('span', { class: 'sslbl' }, 'Selection Statistics')];
      const menu = (e, units, key) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.contextMenu(r.left, r.top - 4 - Object.keys(units).length * 26, Object.keys(units).map(u => ({ label: (u === P[key] ? '● ' : '   ') + u, fn: () => { P[key] = u; this.savePrefs && this.savePrefs(); this.updateSelStats(); } }))); };
      if (subs.length) { const m2 = subs.reduce((a, s) => a + (parseFloat(s.p.area) || 0), 0) * (si ? 10000 : 4046.8564224);
        parts.push(h('span', { class: 'ssval' }, h('b', null, String(subs.length)), ' Subcatchment' + (subs.length > 1 ? 's' : '') + ', ', h('b', null, AV.fmt(m2 / AU[P.selAreaUnit], 4)), ' ' + P.selAreaUnit),
          h('button', { class: 'ssbtn', title: 'Area unit', onclick: (e) => menu(e, AU, 'selAreaUnit') }, P.selAreaUnit)); }
      if (links.length) { let len = 0; for (const l of links) { const v = l.type === 'CONDUIT' ? parseFloat(l.p.length) : NaN; len += isFinite(v) ? v : (m.linkLengthGeom(l) || 0); } const m1 = len * (si ? 1 : 0.3048);
        parts.push(h('span', { class: 'ssval' }, h('b', null, String(links.length)), ' Link' + (links.length > 1 ? 's' : '') + ', ', h('b', null, AV.fmt(m1 / LU[P.selLenUnit], 4)), ' ' + P.selLenUnit),
          h('button', { class: 'ssbtn', title: 'Length unit', onclick: (e) => menu(e, LU, 'selLenUnit') }, P.selLenUnit)); }
      el.append(...parts);
    }

    // ---------------------------------------------------------------- tools / modes
    // Add: enter "add" state; then a click on a layer in the Layer View picks the object type, then click the map
    toggleAddMode(on) {
      this.addMode = on === undefined ? !this.addMode : !!on;
      if (this.addMode) { this.setTool('select', true); this.map.setHint('Add: click a layer in the Layer View (Junctions, Conduits, Subcatchments, Map Labels ...) to choose what to add, then click on the map.'); }
      else { this.addType = null; this.setTool('select'); this.map.setHint(null); }
      this.panels.refreshLayers(); this.refreshRibbon();
    }
    pickAddType(type) {
      if (!this.addMode) return false;
      this.addType = type; this.setTool('add-' + type, true);
      const nm = (AV.SYM_NAMES && AV.SYM_NAMES[type]) || (type === 'LABEL' ? 'Map Labels' : type);
      this.map.setHint('Adding ' + nm + ' - click on the map' + (AV.LINK_TYPES.includes(type) ? ' (start node, optional vertices, end node)' : type === 'SUBCATCH' ? ' (outline points, double-click to finish)' : '') + '. Pick another layer to switch, click Add again to stop.');
      this.panels.refreshLayers(); return true;
    }
    toggleComparison() { if (this.views.has('cmp')) this.closeView('cmp'); else this.compareScenarios(); this.refreshRibbon(); }
    setTool(mode, keepAdd) {
      if (!keepAdd && this.addMode && !/^add-/.test(mode)) { this.addMode = false; this.addType = null; if (this.map) this.map.setHint(null); if (this.panels) setTimeout(() => this.panels.refreshLayers(), 0); }
      for (const k in this.toolButtons) this.toolButtons[k].classList.toggle('active', k === mode);
      this.map.setMode(mode);
      if (this.activeView !== 'map') this.activateView('map');
    }
    toggleEdit() { this.editEnabled = !this.editEnabled; AV.$('#sbEdit').textContent = this.editEnabled ? 'ON' : 'OFF'; this.refreshRibbon(); this.map.redraw(); AV.toast('Edit mode ' + (this.editEnabled ? 'ON - drag nodes and link vertices; double-click a selected link to add a vertex, right-click a vertex to remove it' : 'OFF - objects are locked')); }

    onMapMouse(x, y) { AV.$('#sbXY').textContent = 'X: ' + x.toFixed(2) + '  Y: ' + y.toFixed(2); }
    onHover(hit, cx, cy) {
      const tt = AV.$('#tooltip');
      if (!hit || hit.kind === 'LABEL') { tt.style.display = 'none'; return; }
      let s = (hit.kind === 'NODE' || hit.kind === 'LINK' ? hit.type.charAt(0) + hit.type.slice(1).toLowerCase() : hit.kind === 'SUBCATCH' ? 'Subcatchment' : 'Rain Gage') + ' ' + hit.id;
      const tv = this.theme.tooltip(hit); if (tv) s += '\n' + tv;
      tt.textContent = s; tt.style.display = 'block'; tt.style.left = (cx + 14) + 'px'; tt.style.top = (cy + 12) + 'px';
    }
    onHoverCell(k, cx, cy) {
      const tt = AV.$('#tooltip'); if (k < 0) { tt.style.display = 'none'; return; }
      const c = this.mesh2d.cells[k]; const L = AV.meshSI(this) ? ' m' : ' ft'; let s = '2D Cell ' + c.id + '\nGround ' + AV.fmt(c.elev, 2) + L;
      if (this.meshResults) { const d = AV.cellValue(this, k, 'depth'), mx = AV.cellValue(this, k, 'maxdepth'); s += '\nDepth ' + (d === null || !isFinite(d) ? '-' : AV.fmt(d, 3) + L) + '\nMax. depth ' + (mx === null || !isFinite(mx) ? '-' : AV.fmt(mx, 3) + L); }
      tt.textContent = s; tt.style.display = 'block'; tt.style.left = (cx + 14) + 'px'; tt.style.top = (cy + 12) + 'px';
    }
    onMapContext(e, hit) {
      const items = [];
      if (hit && hit.kind !== 'LABEL') {
        if (!this.selection.has(hit)) this.select(hit);
        items.push({ label: 'Properties', fn: () => this.panels.showProps() });
        items.push({ label: 'Zoom To', fn: () => this.map.zoomToObjects([hit]) });
        const ns = this.selection.size;
        items.push('-', { label: 'Copy ' + (ns > 1 ? ns + ' Selected Objects' : 'Object') + '  (Ctrl+C)', fn: () => AV.copySelection(this) }, { label: 'Paste  (Ctrl+V)', fn: () => AV.pasteClip(this) },
          { label: 'Invert Selection', fn: () => this.invertSelection() }, { label: 'Zoom to Selection', fn: () => this.map.zoomToObjects([...this.selection]) });
        if (hit.kind === 'NODE' || hit.kind === 'LINK') {
          items.push('-', { label: 'Trace Upstream', fn: () => this.tools.trace('up') }, { label: 'Trace Downstream', fn: () => this.tools.trace('down') });
          if (hit.kind === 'NODE') items.push({ label: 'Path From This Node...', fn: () => this.tools.queryPath(hit.id) });
        }
        if (hit.kind === 'LINK') items.push({ label: 'Reverse Direction', fn: () => this.tools.reverseLinks([hit]) });
        if (hit.kind === 'LINK' && hit.type === 'ORIFICE') items.push({ label: 'Convert to Equivalent Conduit', fn: () => this.tools.orificeToConduit([hit]) });
        if (this.results) items.push('-', { label: 'Plot Results', fn: () => this.sim.quickPlot(hit) });
        if (this.results && (hit.kind === 'LINK' || hit.kind === 'NODE')) items.push({ label: 'Profile Through Selection', fn: () => this.sim.profileFromSelection() });
        items.push('-', { label: 'Delete', fn: () => this.deleteSelection() });
      } else if (hit && hit.kind === 'LABEL') {
        items.push({ label: 'Edit Label Text...', fn: async () => { const t = await AV.prompt('Map Label', 'Text', hit.text); if (t !== null) { const o = hit.text; this.exec({ label: 'Edit label', do: () => hit.text = t, undo: () => hit.text = o }); } } });
        items.push({ label: 'Delete Label', fn: () => { const i = this.model.labels.indexOf(hit); this.exec({ label: 'Delete label', do: () => this.model.labels.splice(this.model.labels.indexOf(hit), 1), undo: () => this.model.labels.splice(i, 0, hit) }); } });
      } else {
        items.push({ label: 'Refresh', fn: () => { this.map.grid = null; this.map.redraw(); } }, { label: 'Zoom to All', fn: () => this.map.zoomAll() }, '-',
          { label: 'Select All', fn: () => this.selectAll() }, { label: 'Invert Selection', fn: () => this.invertSelection() }, { label: 'Clear Selection', fn: () => this.clearSelection() }, '-',
          { label: 'Copy Selected Objects  (Ctrl+C)', fn: () => AV.copySelection(this), disabled: !this.selection.size }, { label: 'Paste  (Ctrl+V)', fn: () => AV.pasteClip(this) });
      }
      this.contextMenu(e.clientX, e.clientY, items);
    }

    // ---------------------------------------------------------------- add / delete / move
    prefixFor(type) { return { JUNCTION: 'J', OUTFALL: 'OF', STORAGE: 'SU', DIVIDER: 'DV', CONDUIT: 'C', PUMP: 'P', ORIFICE: 'OR', WEIR: 'W', OUTLET: 'OL', SUBCATCH: 'S', GAGE: 'RG' }[type]; }
    addNodeAt(type, x, y) {
      const m = this.model; const id = m.nextId(this.prefixFor(type));
      const n = { id, kind: 'NODE', type, p: AV.defaults(type), x, y, tag: '' };
      if (type === 'JUNCTION' || type === 'STORAGE' || type === 'DIVIDER') n.p.maxDepth = this.defaults.junctionDepth;
      // inherit an elevation from the nearest node (helps sketching)
      let best = null, bd = Infinity; for (const o of m.nodes.values()) { const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = o; } }
      if (best) n.p.elev = best.p.elev;
      this.exec({ label: 'Add ' + type.toLowerCase(), do: () => m.nodes.set(id, n), undo: () => m.nodes.delete(id), changes: [{ o: n, key: '_created', old: '', nw: '' }] });
      this.select(n);
    }
    addGageAt(x, y) {
      const m = this.model; const id = m.nextId('RG');
      const g = { id, kind: 'GAGE', p: AV.defaults('GAGE'), x, y, tag: '' };
      const ts = [...m.timeseries.keys()][0]; if (ts) g.p.series = ts;
      this.exec({ label: 'Add rain gage', do: () => m.gages.set(id, g), undo: () => m.gages.delete(id), changes: [{ o: g, key: '_created', old: '', nw: '' }] });
      this.select(g);
    }
    async addLabelAt(x, y) {
      const t = await AV.prompt('Map Label', 'Label text', ''); if (!t) return;
      const lb = { x, y, text: t, anchor: '', font: '', size: '', bold: '', italic: '' };
      this.exec({ label: 'Add label', do: () => this.model.labels.push(lb), undo: () => this.model.labels.splice(this.model.labels.indexOf(lb), 1) });
    }
    addLink(type, from, to, verts) {
      const m = this.model; const id = m.nextId(this.prefixFor(type));
      const l = { id, kind: 'LINK', type, from, to, p: AV.defaults(type), verts: verts || [], tag: '' };
      if (type === 'CONDUIT') {
        l.p.g1 = String(this.defaults.conduitDiameter); l.p.rough = this.defaults.conduitRough;
        const L = m.linkLengthGeom(l);
        l.p.length = (this.defaults.autoLength && (m.mapInfo.units || 'None').toUpperCase() !== 'NONE' && L > 0) ? +L.toFixed(2) : this.defaults.conduitLength;
      }
      this.exec({ label: 'Add ' + type.toLowerCase(), do: () => m.links.set(id, l), undo: () => m.links.delete(id), changes: [{ o: l, key: '_created', old: '', nw: '' }] });
      this.select(l);
    }
    addSubcatch(poly) {
      const m = this.model; const id = m.nextId('S');
      const s = { id, kind: 'SUBCATCH', p: AV.defaults('SUBCATCH'), poly, tag: '' };
      Object.assign(s.p, { area: this.defaults.subArea, width: this.defaults.subWidth, imperv: this.defaults.subImperv, slope: this.defaults.subSlope });
      const g = [...m.gages.keys()][0]; if (g) s.p.gage = g;
      // outlet = nearest node to centroid
      const c = AV.polyCentroid(poly); let best = null, bd = Infinity; for (const n of m.nodes.values()) { const d = Math.hypot(n.x - c[0], n.y - c[1]); if (d < bd) { bd = d; best = n; } }
      if (best) s.p.outlet = best.id;
      const a = this.tools.areaFromPoly(poly); if (a !== null) s.p.area = +a.toFixed(4);
      this.exec({ label: 'Add subcatchment', do: () => m.subcatchments.set(id, s), undo: () => m.subcatchments.delete(id), changes: [{ o: s, key: '_created', old: '', nw: '' }] });
      this.select(s);
    }
    objectMoved(o, ox, oy, nx, ny) {
      this.exec({ label: 'Move ' + (o.id || 'label'), light: true, do: () => { o.x = nx; o.y = ny; }, undo: () => { o.x = ox; o.y = oy; }, changes: o.kind === 'LABEL' ? null : [{ o, key: 'x', old: ox, nw: nx }, { o, key: 'y', old: oy, nw: ny }] });
    }
    async deleteSelection(objs) {
      const sel = objs || [...this.selection]; if (!sel.length) return;
      const m = this.model;
      const nodes = sel.filter(o => o.kind === 'NODE'); const nodeIds = new Set(nodes.map(n => n.id));
      const links = new Set(sel.filter(o => o.kind === 'LINK'));
      for (const l of m.links.values()) if (nodeIds.has(l.from) || nodeIds.has(l.to)) links.add(l);
      const subs = sel.filter(o => o.kind === 'SUBCATCH'), gages = sel.filter(o => o.kind === 'GAGE'), labels = sel.filter(o => o.kind === 'LABEL');
      const total = nodes.length + links.size + subs.length + gages.length + labels.length;
      // control rules that use a deleted object, directly or through a named VARIABLE / EXPRESSION, are deleted with it
      const gone = new Set([...nodes, ...links, ...subs, ...gages].map(o => o.id));
      const ctl = AV.controlsWithout ? AV.controlsWithout(m.raw.CONTROLS || [], gone) : null;
      const nRules = ctl ? ctl.rules.length : 0;
      let dropRules = nRules > 0 || !!(ctl && ctl.defs.length);
      if (nRules || (ctl && ctl.defs.length)) {
        // many objects can touch many rules: show counts, the names only on request (scrollable), and let the user decide
        const cnt = `${nodes.length} node(s), ${links.size} link(s), ${subs.length} subcatchment(s), ${gages.length} gage(s)` + (labels.length ? `, ${labels.length} label(s)` : '');
        const names = h('div', { class: 'delrules', style: { display: 'none' } }, ctl.rules.join(', ') + (ctl.defs.length ? '\n\nNamed variables / expressions: ' + ctl.defs.join(', ') : ''));
        const tog = h('a', { href: '#', onclick: (e) => { e.preventDefault(); const show = names.style.display === 'none'; names.style.display = show ? 'block' : 'none'; tog.textContent = show ? 'Hide names' : 'Show names'; } }, 'Show names');
        const cb = h('input', { type: 'checkbox', checked: true });
        const body = h('div', { style: { width: '460px', lineHeight: 1.5 } }, h('div', null, 'Delete ' + cnt + '?'),
          h('div', { style: { marginTop: '10px' } }, h('b', null, nRules + ' control rule' + (nRules > 1 ? 's' : '')), ' use' + (nRules > 1 ? '' : 's') + ' these objects' + (ctl.defs.length ? ' (directly or through ' + ctl.defs.length + ' named variable / expression' + (ctl.defs.length > 1 ? 's' : '') + ')' : '') + '. ', tog), names,
          h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '10px' } }, cb, 'Delete these control rules too (recommended - rules that name missing objects stop the simulation)'));
        const ok = await AV.modal({ title: 'Delete', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Delete', primary: true, value: true }] }).done;
        if (!ok) return; dropRules = cb.checked;
      } else if (total > 1 && !await AV.confirm(`Delete ${nodes.length} node(s), ${links.size} link(s), ${subs.length} subcatchment(s), ${gages.length} gage(s)` + (labels.length ? `, ${labels.length} label(s)` : '') + '?', 'Delete', 'Delete')) return;
      const ctlOld = m.raw.CONTROLS ? m.raw.CONTROLS.slice() : null, ctlNew = dropRules ? ctl.lines : null;
      const snap = (coll, items) => items.map(o => [o.id, o]);
      const N = snap(m.nodes, nodes), L = snap(m.links, [...links]), Sc = snap(m.subcatchments, subs), G = snap(m.gages, gages);
      const lbIdx = labels.map(l => [m.labels.indexOf(l), l]).sort((a, b) => a[0] - b[0]);
      this.exec({
        label: 'Delete ' + total + ' object(s)',
        do: () => { if (ctlNew) m.raw.CONTROLS = ctlNew.slice(); N.forEach(([id]) => m.nodes.delete(id)); L.forEach(([id]) => m.links.delete(id)); Sc.forEach(([id]) => m.subcatchments.delete(id)); G.forEach(([id]) => m.gages.delete(id)); for (const [, l] of lbIdx) m.labels.splice(m.labels.indexOf(l), 1); },
        undo: () => { if (ctlNew) { if (ctlOld) m.raw.CONTROLS = ctlOld.slice(); else delete m.raw.CONTROLS; } N.forEach(([id, o]) => m.nodes.set(id, o)); L.forEach(([id, o]) => m.links.set(id, o)); Sc.forEach(([id, o]) => m.subcatchments.set(id, o)); G.forEach(([id, o]) => m.gages.set(id, o)); for (const [i, l] of lbIdx) m.labels.splice(i, 0, l); },
        changes: [...N, ...L, ...Sc, ...G].map(([, o]) => ({ o, key: '_deleted', old: '', nw: '' })),
      });
      this.selection.clear(); this.onSelectionChanged();
      if (nRules && dropRules) { this.panels.refreshTree(); AV.toast(nRules + ' control rule(s) deleted with the objects' + (nRules <= 5 ? ': ' + ctl.rules.join(', ') : '') + '.', false, 6000); }
    }

    // "Select Selected Feature" dialog for objects that overlap at the clicked point
    async pickOverlapping(objs, add) {
      const typeName = (o) => o.kind === 'SUBCATCH' ? 'Subcatchment' : o.kind === 'GAGE' ? 'Rain Gage' : o.type.charAt(0) + o.type.slice(1).toLowerCase();
      const list = h('select', { size: Math.min(12, Math.max(6, objs.length)), class: 'pickList' }, objs.map((o, i) => h('option', { value: i }, typeName(o) + ' Name: ' + o.id)));
      list.value = String(Math.max(0, objs.findIndex(o => o.kind === 'NODE')));
      const prevHi = this.map.highlight;
      const flash = (i) => { if (objs[i]) { this.map.highlight = new Set([...prevHi, objs[i]]); this.map.redrawOverlay(); } };
      list.addEventListener('mouseover', (e) => { if (e.target.tagName === 'OPTION') flash(+e.target.value); });
      list.addEventListener('change', () => flash(+list.value)); flash(+list.value);
      let dlg;
      list.addEventListener('dblclick', () => dlg.el.querySelector('.btn.primary').click());
      dlg = AV.modal({ title: 'Select Selected Feature', body: h('div', { style: { width: '380px' } }, h('div', { style: { marginBottom: '6px', fontSize: '14px' } }, 'Intersected Features'), list),
        buttons: [{ label: 'OK', primary: true, onClick: () => list.value }, { label: 'Cancel', value: null }] });
      const r = await dlg.done; this.map.highlight = prevHi; this.map.redrawOverlay();
      if (r === null || r === undefined || r === '') return;
      this.select(objs[+r], add);
    }
    selColors() { return { node: this.prefs.selNode, link: this.prefs.selLink, sub: this.prefs.selSub }; }
    savePrefs() { this.settings.prefs = this.prefs; window.host.setSettings(this.settings); }
    // Default Settings (ribbon Project > Settings > Default)
    async defaultSettings() {
      const col = (k) => { const i = h('input', { type: 'color', value: this.prefs[k] }); return i; };
      const hf = h('select', null, [['sec', 'every second'], ['min', 'every minute'], ['min10', 'every 10 minutes'], ['save', 'when the model is saved (last value)']].map(([v, l]) => h('option', { value: v }, l))); hf.value = this.prefs.histFreq || 'save';
      const c4 = h('input', { type: 'checkbox', checked: this.prefs.simplifyMap !== false });
      const c1 = h('input', { type: 'checkbox', checked: !!this.prefs.shiftPick }), c2 = h('input', { type: 'checkbox', checked: !!this.prefs.invertRain }), c3 = h('input', { type: 'checkbox', checked: !!this.prefs.askComment });
      const cn = col('selNode'), cl = col('selLink'), cs = col('selSub');
      const row = (inp, txt) => h('label', { class: 'dsrow' }, inp, ' ' + txt);
      const crow = (inp, txt) => h('label', { class: 'dsrow' }, inp, ' ' + txt);
      const body = h('div', { class: 'dsbox' },
        row(c1, 'Hold the Shift key to select from overlapping objects'),
        row(c2, 'Inverted plot of the rainfall curve'),
        row(c3, 'Ask for a comment when saving changes (change history)'),
        h('label', { class: 'dsrow' }, 'Record change history ', hf),
        row(c4, 'Simplify the map when zoomed out (smaller nodes, no overlapping symbols, faster panning)'),
        h('div', { class: 'dshead' }, 'Selection colours'),
        h('div', { class: 'dscols' }, crow(cn, 'Nodes / gages'), crow(cl, 'Links'), crow(cs, 'Subcatchments')),
        h('div', { class: 'note' }, 'Default values for new nodes, conduits and subcatchments are set in Simulation > Options > Object Defaults.'));
      const r = await AV.modal({ title: 'Default Settings', body, buttons: [{ label: 'OK', primary: true, value: true }, { label: 'Cancel', value: null }] }).done;
      if (!r) return;
      Object.assign(this.prefs, { histFreq: hf.value, simplifyMap: c4.checked, shiftPick: c1.checked, invertRain: c2.checked, askComment: c3.checked, selNode: cn.value, selLink: cl.value, selSub: cs.value });
      this.savePrefs(); this.map.redraw();
      for (const c of AV.openCharts || []) { if (c.series.some(s => s.bars)) { c.invert = this.prefs.invertRain; c.draw(); } }
      for (const g of this.feat.graphs || []) g.render();
    }
    async editDefaults() {
      const r = await AV.formDialog('Project Defaults (new objects)', [
        { k: 'junctionDepth', l: 'Node max. depth', t: 'num' }, { k: 'conduitDiameter', l: 'Conduit diameter / geom1', t: 'num' },
        { k: 'conduitRough', l: 'Conduit roughness', t: 'num' }, { k: 'conduitLength', l: 'Conduit length (if not auto)', t: 'num' },
        { k: 'autoLength', l: 'Auto length from map', t: 'check' },
        { k: 'subArea', l: 'Subcatchment area (if no map units)', t: 'num' }, { k: 'subWidth', l: 'Subcatchment width', t: 'num' },
        { k: 'subImperv', l: 'Subcatchment % impervious', t: 'num' }, { k: 'subSlope', l: 'Subcatchment % slope', t: 'num' },
      ], this.defaults);
      if (!r) return; Object.assign(this.defaults, r); this.settings.defaults = this.defaults; window.host.setSettings(this.settings);
    }
    async symbolDialog() {
      const r = await AV.formDialog('Symbol Sizes', [{ k: 'nodeSize', l: 'Node size (px)', t: 'num' }, { k: 'linkWidth', l: 'Link width (px)', t: 'num' }], { nodeSize: this.map.nodeSize, linkWidth: this.map.linkWidth });
      if (!r) return; this.map.nodeSize = r.nodeSize; this.map.linkWidth = r.linkWidth; this.map.redraw();
    }
    async createBookmark() {
      const name = await AV.prompt('Create Bookmark', 'Name', 'View ' + ((this.settings.bookmarks || []).length + 1)); if (!name) return;
      (this.settings.bookmarks = this.settings.bookmarks || []).push({ name, box: this.map.visibleBox() }); window.host.setSettings(this.settings);
    }
    quickStart() {
      const sec = (t, items) => h('div', { style: { marginBottom: '12px' } }, h('div', { style: { fontWeight: 600, color: 'var(--accent3)', marginBottom: '4px' } }, t), h('ul', { style: { margin: 0, paddingLeft: '18px', lineHeight: 1.55 } }, items.map(i => h('li', null, i))));
      AV.modal({ title: 'Quick Start', width: 700, body: h('div', { style: { maxHeight: '64vh', overflow: 'auto' } },
        sec('1. Open or build a model', ['Project > Open loads any EPA SWMM 5.x / Avaris .inp file; unknown sections are kept unchanged on save.', 'Project > Import > Shapefile / GeoJSON into Network converts GIS points, lines and polygons into nodes, conduits and subcatchments with field mapping and endpoint snapping.', 'Toolbar add tools: click to place nodes; for conduits click the upstream node, optional bends, then the downstream node; for subcatchments click the outline and double-click to finish.', 'Set Map Units in the status bar so lengths and areas can be computed from the map.']),
        sec('2. Edit data', ['Select on the map (drag a box, Ctrl+click to add) and edit in the Properties panel.', 'View > Attribute Table: sort, Select by Attribute, field calculator and statistics (right-click a column header), Copy / Paste to and from Excel.', 'Edit > Batch Edit applies a value or expression (e.g. x*1.1) to every selected object.', 'Everything is undoable (Ctrl+Z / Ctrl+Y).']),
        sec('3. Tools', ['Connectivity: trace upstream / downstream, query the path between two nodes.', 'Subcatchment: batch assign outlets (lowest invert inside polygon), recalculate areas, assign rain gages.', 'Conduit: recalculate lengths; Derive Elevation designs inverts from rim levels with minimum cover and slope.', 'Hyetograph: Chicago, SCS Type II, triangular, uniform or custom design storms, added as a time series and rain gage.', 'Convergence: convert troublesome orifices to equivalent short conduits (10 ft, Ke 0.5, Kx 1.0).']),
        sec('4. Run', ['Simulation > Options: dates, time steps, dynamic-wave settings, and the Avaris engine settings (threads, under-relaxation, nonconvergence list length).', 'Run (F5) writes <model>.rpt and <model>.out next to the model file.']),
        sec('5. Results', ['The map is colored by max capacity (links) and max depth/full depth (nodes); change it in Thematic Rendering. Use Play to animate.', 'Plot: time series for any objects; Compare overlays a second run (dashed) to check before/after changes.', 'Profile: long section with ground, pipes, current and max HGL; select two nodes first.', 'Report and Nonconvergence Diagnostics read the status report; Results > Export writes CSV by time, variable or statistics, and shapefiles with results.'])),
        buttons: [{ label: 'Close', primary: true }] });
    }
    shortcuts() {
      AV.alert(['Ctrl+N  New project', 'Ctrl+O  Open', 'Ctrl+S  Save', 'Ctrl+Z / Ctrl+Y  Undo / Redo', 'Ctrl+A  Select all', 'Ctrl+F  Find object', 'Del  Delete selection', 'Esc  Cancel / select tool', 'F5  Run simulation', 'Home  Zoom to all',
        'Space + drag / middle mouse  Pan', 'Mouse wheel  Zoom', 'Ctrl+click  Add to selection', 'Shift+click  Choose from overlapping objects (Default Settings)', 'Drag a selected node  Move it (Edit mode ON)', 'Backspace  Remove last vertex while drawing', 'Enter / double-click  Finish polygon'].join('\n'), 'Keyboard Shortcuts');
    }
    about() {
      AV.alert('OsemCM V2.0 (' + this.info.version + ')' + (AV.LICENSING ? '\nEdition: ' + (this.license && this.license.valid ? AV.EDITIONS[this.license.edition] + ' — licensed to ' + this.license.licensee : 'OsemCM 1D (unregistered)') : '') + '\n\nEngine: ' + this.engineVersion + '\n\nComputational engine: EPA SWMM 5.2.4 (public domain) with Avaris modifications:\n'
        + '  - user-set dynamic-wave under-relaxation (UNDER_RELAXATION option)\n  - OpenMP parallel node-depth solution with per-node convergence flags\n'
        + '  - extended "Most Frequent Nonconverging Nodes" list (NONCONV_REPORT_COUNT)\n  - outfalls excluded from nonconvergence statistics\n\nCPU threads available: ' + this.info.cpus, 'About OsemCM');
    }
    onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(e.shiftKey); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openDialog(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); this.newProject(); return; }
      if (e.key === 'F5') { e.preventDefault(); this.sim.run(); return; }
      if (AV.$('.modal-back')) return;
      if (typing) return;
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
      else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); this.redo(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'a' && this.activeView === 'map') { e.preventDefault(); this.selectAll(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); this.tools.find(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'c' && this.selection.size) { e.preventDefault(); AV.copySelection(this); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'v') { e.preventDefault(); if (this.activeView !== 'map') this.activateView('map'); this.showWelcome && this.showWelcome(false); AV.pasteClip(this); }
      else if (e.key === 'Delete' && this.activeView === 'map') this.deleteSelection();
      else if (e.key === 'Escape' && this.map && this.map.mode === 'select' && !this.map.temp && e.target !== this.map.canvas) { if (this.selection.size) this.clearSelection(); if (this.map.highlight && this.map.highlight.size) { this.map.highlight = new Set(); this.map.redrawOverlay(); } }
      else if (e.key === 'Home') this.map.zoomAll();
    }
  }
  AV.App = App;

  window.addEventListener('DOMContentLoaded', () => { AV.app = new App(); AV.app.init().catch(e => { console.error(e); AV.alert('Startup error: ' + e.stack); }); });
})(window.AV);
