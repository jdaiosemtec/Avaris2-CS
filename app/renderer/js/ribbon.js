// Ribbon command bar (Avaris DS style): Project / Operation / Tools / Simulation / Help
'use strict';
(function (AV) {
  const h = AV.h;
  const IMG = (n) => 'icons/' + n + '.png';

  AV.App.prototype.ribbonDefs = function () {
    const T = () => this.tools, S = () => this.sim, F = () => this.feat;
    const recent = () => [{ label: 'Open Sample Model', fn: () => this.openSample() }, '-'].concat((this.settings.recent || []).map(p => ({ label: p, fn: () => this.openFile(p) })));
    return [
      {
        name: 'Project', groups: [
          { name: 'File', items: [
            { id: 'new', label: 'New', img: 'new', fn: () => this.newProject(), tip: 'New project (Ctrl+N)' },
            { id: 'open', label: 'Open', img: 'open', fn: () => this.openDialog(), tip: 'Open an Avaris / SWMM .inp model (Ctrl+O)' },
            { id: 'close', label: 'Close', img: 'close', fn: () => this.closeProject() }] },
          { name: 'Scenario', items: [{ id: 'scen', label: 'Scenarios', img: 'scenarios', fn: () => F().scenarios() }] },
          { name: 'Import', items: [{ id: 'import', label: 'Import', img: 'import', fn: () => this.showRightTab('catalog'), tip: 'Open the Catalog: browse and drag GIS data (SHP, GeoJSON, KML, CSV, DXF, GeoTIFF, GDB, .out results ...) onto the map' }] },
          { name: 'Export', items: [{ id: 'export', label: 'Export', img: 'export', fn: () => this.showRightTab('export'), tip: 'Export Wizard: network objects and results to Shapefile, File Geodatabase or CSV' }] },
          { name: 'User', items: [{ small: [{ id: 'usw', label: 'Switch User', svg: 'user', fn: () => this.auth.loginDialog(false) }, { id: 'umg', label: 'Manage Users', svg: 'user', fn: () => this.auth.manageUsers(), enabled: () => this.auth && this.auth.isAdmin }, { id: 'uhist', label: 'Change History', svg: 'history', fn: () => this.hist.openWindow() }] }] },
          { name: 'Settings', items: [{ id: 'default', label: 'Default', img: 'default', fn: () => this.defaultSettings(), tip: 'Default settings: overlapping-object selection, rainfall plot, selection colours' }] },
        ]
      },
      {
        name: 'Operation', groups: [
          { name: 'Navigate', items: [
            { id: 'pan', label: 'Pan', img: 'pan', mode: 'pan' },
            { id: 'zoomall', label: 'Zoom to All', img: 'zoomall', fn: () => this.map.zoomAll() },
            { small: [
              { id: 'zoomin', label: 'Zoom In', img: 'zoomin', mode: 'zoomin' },
              { id: 'zoomout', label: 'Zoom Out', img: 'zoomout', mode: 'zoomout' },
              { id: 'zoomsel', label: 'Zoom to Selection', img: 'zoomsel', fn: () => this.map.zoomToObjects([...this.selection]) }] },
            { id: 'bm', label: 'Bookmarks', img: 'bmcreate', caret: true, tip: 'Create or manage map bookmarks', menu: () => [{ label: 'Create Bookmark...', fn: () => this.createBookmark() }, { label: 'Manage Bookmarks...', fn: () => F().manageBookmarks() }] }] },
          { name: 'Selection', items: [
            { id: 'select', label: 'Select', img: 'select', mode: 'select' },
            { id: 'search', label: 'Search', img: 'search', fn: () => T().find() },
            { id: 'gm', label: 'Groups', img: 'grpmanage', fn: () => F().manageGroups(), tip: 'Manage Groups: create groups from the map selection, select / zoom to, add or remove members' }] },
          { name: 'Edit', items: [
            { id: 'add', label: 'Add', img: 'add', fn: () => this.toggleAddMode(), active: () => !!this.addMode, tip: 'Add objects: click Add, then click a layer in the Layer View (Junctions, Conduits, Subcatchments ...), then click on the map' },
            { id: 'remove', label: 'Remove', img: 'remove', fn: () => this.deleteSelection(), tip: 'Delete selected objects (Del)' },
            { small: [
              { id: 'edit', label: 'Edit Geometry', img: 'edit', fn: () => this.toggleEdit(), active: () => this.editEnabled, tip: 'Geometry edit mode: drag nodes and link vertices; double-click a link to add a vertex' },
              { id: 'split', label: 'Split', img: 'split', fn: () => F().splitMode(), tip: 'Split a conduit with a new junction, or cut the selected subcatchment in two' },
              { id: 'merge', label: 'Merge', img: 'merge', fn: () => F().merge(), tip: 'Merge adjacent subcatchments into one (select them, then Merge and choose the one to keep). With a junction selected: merge the two conduits meeting there.' }] },
            { small: [
              { id: 'assign', label: 'Assign Outlet', img: 'assign', fn: () => F().assignMode(), tip: 'Assign the runoff target: click a subcatchment (Ctrl+click for several), then the junction it drains to' },
              { id: 'convert', label: 'Convert Type', img: 'convert', fn: () => F().convertType(), tip: 'Convert selected objects to another type' },
              { id: 'reverse', label: 'Reverse', img: 'reverse', fn: () => T().reverseLinks(), tip: 'Reverse the direction of selected links' }] }] },
          { name: 'Display', launcher: () => this.theme.dialog(), items: [{ id: 'theme', label: 'Theme', img: 'theme', fn: () => this.theme.dialog(), tip: 'Layer theme editor' }] },
          { name: 'Change Log', items: [
            { id: 'window', label: 'Log Window', img: 'window', fn: () => this.toggleLogPane(), active: () => this.prefs.logPane !== false, tip: 'Show / hide the change log under the Properties panel' },
            { id: 'table', label: 'History', img: 'table', fn: () => this.hist.openWindow(), tip: 'Change history table: every recorded change with version, user, role, time, old / new value and description' }] },
        ]
      },
      {
        name: 'Tools', groups: [
          { name: 'Connectivity', items: [
            { id: 'up', label: 'Upstream Trace', img: 'upstream', fn: () => F().traceTool('up') },
            { id: 'down', label: 'Downstream Trace', img: 'downstream', fn: () => F().traceTool('down') },
            { small: [{ id: 'path', label: 'Path', img: 'path', fn: () => F().pathTool() }, { id: 'cleartrace', label: 'Clear Trace', svg: 'del', fn: () => T().clearTrace() }] }] },
          { name: 'Network Geometry', items: [
            { small: [
              { id: 'batch', label: 'Batch Assign Outlet', img: 'batchassign', fn: () => T().batchAssignOutlet() },
              { id: 'rcs', label: 'Recalc. Subcatch. Area', img: 'recalcsub', fn: () => T().recalcArea(), tip: 'Recalculate subcatchment areas from their polygons' },
              { id: 'rcc', label: 'Recalc. Conduit Length', img: 'recalcconduit', fn: () => T().recalcLength(), tip: 'Recalculate conduit lengths from their geometry' }] },
            { small: [
              { id: 'derive', label: 'Derive Elevations', img: 'derive', fn: () => T().deriveElevation() },
              { id: 'ori', label: 'Orifice to Conduit', svg: 'convert', fn: () => T().orificeToConduit() },
              { id: 'measure', label: 'Measure', svg: 'measure', mode: 'measure' }] }] },
          { name: 'Rainfall', items: [{ id: 'gen', label: 'Design Storm', img: 'hyetograph', fn: () => AV.hyetographDialog(this), tip: 'Design storm / hyetograph generator (Chicago, SCS, triangular, uniform, custom pattern)' }] },
          { name: 'Spatial Reference', items: [{ small: [{ id: 'rr', label: 'Reproject Raster', img: 'reprojraster', fn: () => F().reprojectRaster() }, { id: 'csr', label: 'Convert Coordinates', img: 'convertsr', fn: () => F().convertSR() }] }] },
          { name: 'Utilities', items: [
            { id: 'valid', label: 'Validate Model', svg: 'validate', fn: () => T().validate() },
            { id: 'conv', label: 'Unit Converter', img: 'converter', fn: () => F().unitConverter() }] },
        ]
      },
      {
        name: 'Simulation', groups: [
          { name: 'Setup', launcher: () => S().optionsDialog(), items: [
            { id: 'options', label: 'Options', img: 'options', fn: () => S().optionsDialog() },
            { id: 'meshes', label: 'Create Meshes', img: 'meshes', lic: '2D', badge: '1D-2D', fn: () => AV.createMeshes(this), tip: 'Create the 2D surface mesh from the boundary, DEM and lines set in Options → 2D Flood' }] },
          { name: 'Run', items: [{ id: 'run', label: 'Run', img: 'run', hero: true, fn: () => S().run(), tip: 'Run simulation (F5)' }] },
          { name: 'Results', items: [
            { id: 'play', label: 'Play', img: 'play', fn: () => S().togglePlaybar(), active: () => !!this.playMode, tip: 'Play mode: animate the results over time (click again to leave play mode)' },
            { id: 'profile', label: 'Profile', img: 'profile', fn: () => F().profileTool() },
            { id: 'plot', label: 'Plot', img: 'plot', fn: () => F().graphTool() },
            { id: 'comparison', label: 'Comparison', img: 'summary', fn: () => this.toggleComparison(), active: () => this.views && this.views.has('cmp'), tip: 'Open / close the Scenario Comparison window' },
            { small: [
              { id: 'report', label: 'Report', img: 'report', fn: () => S().showReport() },
              { id: 'conv2', label: 'Convergence', img: 'convergence', fn: () => S().convergenceDiagnostics(), tip: 'Nonconvergence diagnostics' }] }] },
        ]
      },
      {
        name: 'Help', groups: [
          { name: 'Help', items: [
            { id: 'about', label: 'About', img: 'about', fn: () => this.about() },
            { id: 'register', label: 'Register', img: 'register', fn: () => this.registerDialog() },
            { id: 'guide', label: 'User Guide', img: 'guide', fn: () => window.host.openExternal('https://osemtec.com/avaris.html') },
            { id: 'qs', label: 'Quick Start', svg: 'report', fn: () => this.quickStart() },
            { id: 'keys', label: 'Shortcuts', svg: 'options', fn: () => this.shortcuts() }] },
        ]
      },
    ];
  };

  AV.App.prototype.buildRibbon = function (host) {
    const defs = this.ribbonDefs();
    this.toolButtons = {}; this.ribbonButtons = [];
    const qat = h('div', { class: 'qat' },
      h('img', { src: 'icon.png', class: 'logo' }),
      h('span', { class: 'qsave' }, h('button', { class: 'qbtn', title: 'Save (Ctrl+S)', onclick: () => this.save() }, AV.icon('save')),
        h('button', { class: 'qbtn qcaret', title: 'Save / Save As', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); this.contextMenu(r.left - 24, r.bottom + 2, [{ label: 'Save            Ctrl+S', fn: () => this.save() }, { label: 'Save As...   Ctrl+Shift+S', fn: () => this.save(true) }]); } }, '▾')),
      ...[['undo', () => this.undo(), 'Undo (Ctrl+Z)'], ['redo', () => this.redo(), 'Redo (Ctrl+Y)']].map(([ic, fn, t]) => h('button', { class: 'qbtn', title: t, onclick: fn }, AV.icon(ic))));
    const tabs = h('div', { class: 'rtabs' }, qat);
    const panel = h('div', { class: 'rpanel' });
    host.append(tabs, panel);
    const pages = [];
    const mkBtn = (it, small) => {
      const icon = it.img ? h('img', { src: IMG(it.img), draggable: 'false' }) : h('span', { class: 'svgi' }, AV.icon(it.svg || 'select'));
      const b = h('button', { class: (small ? 'rsmall' : 'rbig') + (it.hero ? ' hero' : ''), title: typeof it.tip === 'function' ? '' : (it.tip || it.label) }, icon, h('span', { class: 'rl' }, it.label, it.caret ? h('span', { class: 'rcar' }, ' ▾') : null));
      if (it.badge && !small) b.appendChild(h('span', { class: 'rbadge' }, it.badge));
      if (it.lic) b.appendChild(h('span', { class: 'rlock', title: 'Requires an Avaris2 1D-2D licence' }, '🔒'));
      b.addEventListener('click', (e) => {
        if (it.lic === '2D' && !AV.has2D(this)) { AV.need2D(this, it.label); return; }
        if (it.menu) { const r = b.getBoundingClientRect(); this.contextMenu(r.left, r.bottom + 2, it.menu()); return; }
        if (it.mode) this.setTool(it.mode); else if (it.fn) it.fn(e);
        this.refreshRibbon();
      });
      if (it.mode) this.toolButtons[it.mode] = b;
      this.ribbonButtons.push({ b, it });
      return b;
    };
    defs.forEach((tab, ti) => {
      const page = h('div', { class: 'rpage', style: { display: ti === 1 ? 'flex' : 'none' } });
      for (const g of tab.groups) {
        const items = h('div', { class: 'ritems' });
        for (const it of g.items) {
          if (it.small) items.appendChild(h('div', { class: 'rstack' }, it.small.map(s => mkBtn(s, true))));
          else items.appendChild(mkBtn(it, false));
        }
        page.appendChild(h('div', { class: 'rgroup' }, items, h('div', { class: 'rgname' }, g.name, g.launcher ? h('span', { class: 'rlaunch', title: g.name + ' settings', onclick: (e) => { e.stopPropagation(); g.launcher(); } }) : null)));
      }
      pages.push(page); panel.appendChild(page);
      const t = h('div', { class: 'rtab' + (ti === 1 ? ' active' : ''), onclick: () => { AV.$$('.rtab', tabs).forEach(x => x.classList.remove('active')); t.classList.add('active'); pages.forEach((p, j) => p.style.display = j === ti ? 'flex' : 'none'); } }, tab.name);
      tabs.appendChild(t);
    });
    tabs.appendChild(h('div', { style: { flex: 1 } }));
    tabs.appendChild(h('div', { class: 'rtitle', id: 'rtitle' }, 'Avaris2'));
  };
  AV.App.prototype.refreshRibbon = function () {
    if (!this.ribbonButtons) return;
    for (const { b, it } of this.ribbonButtons) {
      if (it.enabled) b.classList.toggle('disabled', !it.enabled());
      if (it.lic) b.classList.toggle('locked', it.lic === '2D' && !AV.has2D(this));
      if (typeof it.tip === 'function') b.title = it.tip();
      if (it.active) b.classList.toggle('active', !!it.active());
    }
  };
})(window.AV);
