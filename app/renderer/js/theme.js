// Layer themes modelled on the InfoWorks ICM Layer Theme Editor:
// per layer an ordered list of sub-themes (first match wins for each draw attribute) over a base theme,
// Continuous (ranged) or Individual (by value) themes, colour + symbol size / line width per range,
// auto-ranging (linear / quantile / log / exponential), absolute values, nulls, legend control, labels.
'use strict';
(function (AV) {
  const h = AV.h;
  const BASE = {
    node: { JUNCTION: '#1e88e5', OUTFALL: '#2e7d32', STORAGE: '#8e24aa', DIVIDER: '#ef6c00' },
    link: { CONDUIT: '#546e7a', PUMP: '#d32f2f', ORIFICE: '#6d4c41', WEIR: '#00897b', OUTLET: '#5e35b1' },
    sub: '#66bb6a',
  };
  const CAT = ['#1e88e5', '#e53935', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#6d4c41', '#c0ca33', '#d81b60', '#3949ab', '#00897b', '#757575'];
  const LAYER_NAME = { node: 'Nodes', link: 'Links', sub: 'Subcatchments' };
  const CATEGORICAL = new Set(['type', 'tag', 'shape', 'gage', 'outlet', 'group']);

  const EMPTY_STYLE = Object.freeze({ color: null, size: null, hide: false }); const STY = Symbol('style');
  class Theme {
    constructor(app) {
      this.app = app;
      this.layers = { node: { subs: [], labels: { on: false, fields: ['id'] } }, link: { subs: [], labels: { on: false, fields: ['id'] } }, sub: { subs: [], labels: { on: false, fields: ['id'] } } };
      this.flowDir = (l) => { const R = this.app.results; if (!R) return 1; const v = R.valueOf(l, 0, false); if (v === null) return 1; return Math.abs(v) < 1e-6 ? 0 : Math.sign(v); };
      this.nodeColor = (n) => this.style('node', n).color || AV.symOf(this.app, n.type).color;
      this.linkColor = (l) => this.style('link', l).color || AV.symOf(this.app, l.type).color;
      this.subColor = (s) => this.style('sub', s).color || AV.symOf(this.app, 'SUBCATCH').fill;
      this.nodeSize = (n, base) => { const s = this.style('node', n).size; return s ? s : base; };
      this.linkWidth = (l) => { const s = this.style('link', l).size; return s ? s : AV.symOf(this.app, l.type).width; };
      this.isHidden = (layer, o) => this.style(layer, o).hide;
    }
    // ---------- compatibility shim for older callers (single "quick" theme per layer)
    get cfg() {
      const self = this; const mk = (layer) => ({
        get attr() { const t = self.layers[layer].subs.find(s => self.active(s)); return t ? t.field : 'none'; },
        set attr(v) { self.setAttr(layer, v); },
      });
      return { node: mk('node'), link: mk('link'), sub: mk('sub') };
    }
    // custom clauses (Clause Editor): compiled once per layer / text; results fields re-read live values
    compiled(layer, src) {
      const k = layer + '|' + (this.app.results ? this.app.results.handle : '') + '|' + src; this._cc = this._cc || new Map();
      if (this._ccModel !== this.app.model) { this._cc.clear(); this._ccModel = this.app.model; }
      if (!this._cc.has(k)) { try { this._cc.set(k, AV.compileExpr(src, AV.exprFields(this.app, layer))); } catch (e) { this._cc.set(k, null); } }
      return this._cc.get(k);
    }
    // dynamic-result themes (r: fields) are shown in play mode only, all other themes outside play mode only
    isDynamic(t) { const f = t.field || ''; if (f.startsWith('r:')) return true; if (f.startsWith('x:')) return AV.exprIsDynamic(f.slice(2)); return false; }
    active(t) { return !!t.enabled && (!!this.app.playMode === this.isDynamic(t)); }
    passWhere(layer, t, o) { if (!t.where) return true; const c = this.compiled(layer, t.where); return c ? !!c.fn(o) : true; }
    fieldName(layer, f) { if (f && f.startsWith('x:')) { const ef = AV.exprFields(this.app, layer).find(x => x.n === f.slice(2)); return ef ? ef.l : 'ƒ ' + f.slice(2); } const a = (AV.THEME_ATTRS[layer] || []).find(x => x[0] === f); return a ? a[1] : f; }
    raw(layer, o, field) {
      const R = this.app.results;
      if (!field || field === 'none') return null;
      if (field.startsWith('cmp:')) return this.app.cmp ? this.app.cmp.mapValue(o) : null;
      if (field.startsWith('x:')) { const c = this.compiled(layer, field.slice(2)); if (!c) return null; const v = c.fn(o); return typeof v === 'boolean' ? (v ? 'true' : 'false') : v; }
      if (field === 'type') return o.type || o.kind;
      if (field === 'tag') return o.tag || null;
      if (field === 'group') { const g = this.app.feat && this.app.feat.groupsOf(o); return g && g.length ? g.join(',') : null; }
      if (field === 'nc') return R && R.nonconv ? (R.nonconv.get(o.id) || 0) : null;
      if (field.startsWith('r:') || field.startsWith('m:')) {
        if (!R) return null;
        const isMax = field[0] === 'm'; const key = field.slice(2);
        if (key === 'full') { const d = R.valueOf(o, 0, isMax); const md = +o.p.maxDepth; return d === null || !(md > 0) ? null : d / md; }
        if (key === 'sur' || key === 'surh') {
          if (!isMax) return key === 'sur' ? R.surchargeNow(o) : null;
          if (!R.sur) { R.computeSurcharge(() => { this.invalidate(); this.refreshAutoRanges && this.refreshAutoRanges(); this.app.map.redraw(); }); return null; }
          return R.surchargeStat(o, key === 'sur' ? 'ever' : 'h');
        }
        return R.valueOf(o, +key, isMax, layer === 'link' && isMax && +key === 0);
      }
      const p = o.p;
      switch (field) {
        case 'rim': return +p.elev + (+p.maxDepth || 0);
        case 'diam': { const v = parseFloat(p.g1); return isFinite(v) ? v : null; }
        case 'slope': return o.type === 'CONDUIT' ? AV.conduitSlope(this.app.model, o) : null;
        case 'shape': case 'gage': case 'outlet': return p[field] || null;
        default: { const v = parseFloat(p[field]); return isFinite(v) ? v : null; }
      }
    }
    value(layer, o, t) {
      let v = this.raw(layer, o, t.field);
      if (typeof v === 'number' && t.abs) v = Math.abs(v);
      return v;
    }
    rowFor(t, v) {
      if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return t.nulls ? t.nullRow : null;
      if (t.kind === 'individual') { const s = String(v); return t.ranges.find(r => String(r.v) === s) || null; }
      for (const r of t.ranges) if (v <= r.v) return r;
      return t.ranges[t.ranges.length - 1] || null;
    }
    // the themes that draw a layer: the layer's own list, or - while Flags are shown - only the selected flag of that layer
    // (all other themes are suspended until the Flag panel is closed or no flag is selected)
    subsOf(layer) { const F = this.app.flags; if (F && F.on()) { const s = F.sub(layer); return s ? [s] : []; } return this.layers[layer].subs; }
    // while the map draws, each object's style is computed once per frame (colour, size and visibility all read it)
    // and a layer without any active theme returns at once
    style(layer, o) {
      if (this.app.themeHidden) return EMPTY_STYLE;
      const fr = AV._drawing ? AV.frameId : 0;
      if (fr) {
        const c = o[STY]; if (c && c.f === fr && c.l === layer) return c.s;
        if (this._actF !== fr) { this._actF = fr; this._act = {}; for (const k of ['node', 'link', 'sub']) this._act[k] = this.subsOf(k).some(t => t.ranges && t.ranges.length && this.active(t)); }
        if (!this._act[layer]) return EMPTY_STYLE;
        const s = this._style(layer, o); o[STY] = { f: fr, l: layer, s }; return s;
      }
      return this._style(layer, o);
    }
    _style(layer, o) {
      const out = { color: null, size: null, hide: false };
      for (const t of this.subsOf(layer)) {
        if (!this.active(t) || !t.ranges.length) continue;
        if (t.where && !this.passWhere(layer, t, o)) continue;
        const r = this.rowFor(t, this.value(layer, o, t));
        if (!r) continue;
        if (r.show === false) { out.hide = true; break; }
        if (t.useColor && !out.color) out.color = r.color;
        if (t.useSize && !out.size) out.size = r.size;
        if (out.color && out.size) break;
      }
      return out;
    }
    objects(layer) { const m = this.app.model; return layer === 'node' ? m.nodes.values() : layer === 'link' ? m.links.values() : m.subcatchments.values(); }
    // values used for auto-ranging: results use the simulation maxima so colours stay stable while animating
    rangeValues(layer, t) {
      const field = t.field === 'r:sur' ? 'm:sur' : t.field.startsWith('r:') ? 'm:' + t.field.slice(2) : t.field;
      const vals = [];
      for (const o of this.objects(layer)) { if (t.where && !this.passWhere(layer, t, o)) continue; let v = this.raw(layer, o, field); if (typeof v === 'number' && (t.abs || (layer === 'link' && t.field === 'r:0'))) v = Math.abs(v); if (v !== null && v !== undefined) vals.push(v); }
      return vals;
    }
    autoRange(layer, t, n) {
      n = n || t.n || 5; t.n = n;
      let isCat = CATEGORICAL.has(t.field);
      const vals = this.rangeValues(layer, t);
      if (t.field.startsWith('x:')) isCat = vals.length > 0 && vals.filter(v => typeof v !== 'number').length > vals.length / 2;
      t.kind = isCat ? 'individual' : (t.field.startsWith('x:') ? 'continuous' : (t.kind || 'continuous'));
      let keys;
      if (t.kind === 'individual') {
        keys = [...new Set(vals.map(String))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 60);
        const cols = keys.map((_, i) => CAT[i % CAT.length]);
        t.ranges = keys.map((k, i) => ({ v: k, color: cols[i], size: this.defSize(layer), show: true }));
      } else {
        const num = vals.filter(v => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b);
        let mn = num.length ? num[0] : 0, mx = num.length ? num[num.length - 1] : 1; if (mx <= mn) mx = mn + 1;
        let br;
        if (/:4$|:full$/.test(t.field) && n === 5 && t.method !== 'quantile') br = [0.25, 0.5, 0.75, 0.99, Math.max(mx, 1.5)];
        else if (t.method === 'quantile') { br = []; for (let i = 1; i <= n; i++) br.push(num.length ? num[Math.min(num.length - 1, Math.ceil(i * num.length / n) - 1)] : i); }
        else if (t.method === 'log' && mn > 0) { br = []; for (let i = 1; i <= n; i++) br.push(mn * Math.pow(mx / mn, i / n)); }
        else if (t.method === 'exponential') { br = []; for (let i = 1; i <= n; i++) br.push(mn + (mx - mn) * Math.pow(i / n, 2)); }
        else { br = []; for (let i = 1; i <= n; i++) br.push(mn + (mx - mn) * i / n); }
        br = [...new Set(br.map(v => +(+v).toPrecision(4)))];
        const cols = AV.rampColors(t.ramp || 'Blue-Red', br.length, t.invert);
        const s0 = layer === 'link' ? 1.5 : 3, s1 = layer === 'link' ? 7 : 11;
        t.ranges = br.map((v, i) => ({ v, color: cols[i], size: +(s0 + (s1 - s0) * (br.length > 1 ? i / (br.length - 1) : 0)).toFixed(1), show: true }));
      }
      t.nullRow = { color: '#b0bec5', size: this.defSize(layer), show: true };
      return t;
    }
    defSize(layer) { return layer === 'link' ? 2 : 5; }
    newSub(layer, field, name) {
      const t = { name: name || this.fieldName(layer, field), field, kind: CATEGORICAL.has(field) ? 'individual' : 'continuous', abs: field === 'r:0' && layer === 'link', nulls: false, enabled: true, legend: true, useColor: true, useSize: false, method: 'linear', ramp: layer === 'sub' ? 'Green-Red' : 'Blue-Red', invert: false, n: 5, ranges: [] };
      return this.autoRange(layer, t);
    }
    setAttr(layer, field) {
      const L = this.layers[layer];
      L.subs = L.subs.filter(t => t.name !== 'Quick theme');
      if (field && field !== 'none') { const t = this.newSub(layer, field, 'Quick theme'); L.subs.unshift(t); }
      this.invalidate(); this.app.map.redraw();
    }
    removeResultThemes() {
      for (const k in this.layers) this.layers[k].subs = this.layers[k].subs.filter(t => !/^(r:|m:|nc$)/.test(t.field));
      this.invalidate();
    }
    refreshAutoRanges() { for (const k in this.layers) for (const t of this.layers[k].subs) if (t.auto !== false && /^(r:|m:|nc$)/.test(t.field)) this.autoRange(k, t); this.invalidate(); }
    invalidate() { this.updateLegend(); }
    // does the map styling (themes or labels) read this property? used to skip map re-renders after edits
    usesField(key) {
      for (const k in this.layers) {
        const L = this.layers[k];
        const DEP = { rim: ['elev', 'maxDepth'], diam: ['g1'], slope: ['inOff', 'outOff', 'length', 'elev'], 'm:full': ['maxDepth'], 'r:full': ['maxDepth'] };
        for (const t of L.subs || []) if (t.enabled !== false && (t.field === key || (DEP[t.field] || []).includes(key))) return true;
        if (L.labels && L.labels.on && (L.labels.fields || []).includes(key)) return true;
      }
      return false;
    }
    // ---------- labels
    labelsOn(layer) { return this.layers[layer].labels.on; }
    labelText(layer, o) {
      const L = this.layers[layer].labels; const parts = [];
      for (const f of L.fields) { if (f === 'id') parts.push(o.id); else { const v = this.raw(layer, o, f); if (v !== null && v !== undefined) parts.push(typeof v === 'number' ? AV.fmt(v, L.dp === undefined ? undefined : L.dp) : String(v)); } }
      return parts.join(' | ');
    }
    label() { return ''; }
    tooltip(o) {
      const layer = o.kind === 'NODE' ? 'node' : o.kind === 'LINK' ? 'link' : o.kind === 'SUBCATCH' ? 'sub' : null; if (!layer) return '';
      return this.layers[layer].subs.filter(t => this.active(t)).slice(0, 4).map(t => { const v = this.value(layer, o, t); return this.fieldName(layer, t.field) + ': ' + (typeof v === 'number' ? AV.fmt(v) : v === null ? 'n/a' : v); }).join('\n');
    }
    updateLegend() {
      const el = AV.$('#legend'); if (!el) return; el.innerHTML = ''; let any = false;
      if (this.app.themeHidden) { el.style.display = 'none'; return; }
      for (const layer of ['node', 'link', 'sub']) for (const t of this.subsOf(layer)) {
        if (t.flag && !this.active(t)) { any = true; el.appendChild(h('div', { class: 'lt', style: { color: 'var(--muted)', fontWeight: 400 } }, LAYER_NAME[layer] + ': ' + t.name + (this.app.playMode ? ' - Σ shown outside play mode' : ' - ▶ shown while playing'))); continue; }
        if (!this.active(t) || !t.legend || !t.ranges.length) continue; any = true;
        el.appendChild(h('div', { class: 'lt' }, LAYER_NAME[layer] + ': ' + t.name));
        t.ranges.slice(0, 14).forEach((r, i) => {
          const txt = r.label ? r.label : t.kind === 'individual' ? String(r.v) : (i === 0 ? '≤ ' + AV.fmt(+r.v) : AV.fmt(+t.ranges[i - 1].v) + ' – ' + AV.fmt(+r.v));
          const sw = r.color === null ? h('span', { class: 'lc', title: 'no fill (base symbol)', style: { background: 'transparent', border: '1px dashed #90a4ae', height: '8px' } }) : layer === 'node' && t.useSize ? h('span', { class: 'lc', style: { width: '14px', height: Math.max(4, r.size * 1.4) + 'px', borderRadius: '50%', background: t.useColor ? r.color : '#1e88e5' } })
            : h('span', { class: 'lc', style: { background: t.useColor ? r.color : '#546e7a', height: t.useSize ? Math.max(2, r.size) + 'px' : '8px' } });
          el.appendChild(h('div', { class: 'lr', style: { opacity: r.show === false ? .4 : 1 } }, sw, txt));
        });
      }
      el.style.display = any ? 'block' : 'none';
    }
    // ---------- persistence
    toJSON() { return JSON.stringify({ osemcmTheme: 1, layers: this.layers }, null, 1); }
    // mode 'add': the file's themes go on top of the current list (same name = replaced), labels kept; otherwise replace all
    fromJSON(txt, mode) {
      const j = JSON.parse(txt); if (!j.layers) throw new Error('Not an Avaris2 CS theme file'); let n = 0;
      for (const k of ['node', 'link', 'sub']) { const L = j.layers[k]; if (!L) continue;
        if (mode === 'add') { const subs = (L.subs || []).map(s => Object.assign({}, s)); n += subs.length; const names = new Set(subs.map(s => s.name)); this.layers[k].subs = subs.concat(this.layers[k].subs.filter(s => !names.has(s.name))); }
        else { this.layers[k] = L; n += (L.subs || []).length; } }
      this.invalidate(); this.app.map.redraw(); return n;
    }
    async loadFile(after, path) {
      const p = path || await window.host.openDialog({ filters: [{ name: 'Avaris2 CS theme', extensions: ['json'] }] }); if (!p) return;
      let txt; try { txt = await window.host.readText(p); const j = JSON.parse(txt); if (!j.layers) throw new Error('Not an Avaris2 CS theme file'); } catch (e) { AV.alert(e.message); return; }
      const has = ['node', 'link', 'sub'].some(k => this.layers[k].subs.length);
      const mode = !has ? 'replace' : await AV.modal({ title: 'Load Themes', width: 460, body: h('div', { style: { lineHeight: 1.55 } }, h('div', null, 'Load ' + AV.basename(p) + '.'),
        h('div', null, h('b', null, 'Add'), ': put the loaded themes on top of your current themes (a theme with the same name is updated).'), h('div', null, h('b', null, 'Replace'), ': remove your current themes first.')),
        buttons: [{ label: 'Cancel', value: null }, { label: 'Replace', value: 'replace' }, { label: 'Add', primary: true, value: 'add' }] }).done;
      if (!mode) return;
      try { const n = this.fromJSON(txt, mode); AV.toast(n + ' theme' + (n === 1 ? '' : 's') + ' loaded' + (mode === 'add' ? ' (added on top)' : '') + '.'); } catch (e) { AV.alert(e.message); }
      if (after) after();
    }

    // ================================================================ Layer Theme Editor dialog
    async dialog(focusLayer) {
      const self = this;
      const snapshot = JSON.stringify(this.layers);
      let layer = focusLayer || 'link'; let cur = 0;
      const body = h('div');
      const ltabs = h('div', { class: 'tabs2' }); body.appendChild(ltabs);
      const te = h('div', { class: 'te' }); body.appendChild(te);
      const left = h('div', { class: 'te-left' }), right = h('div', { class: 'te-right' });
      te.append(left, right);
      const B = (label, title, fn) => h('button', { class: 'btn small', title, onclick: fn }, label);
      const subs = () => this.layers[layer].subs;
      const renderTabs = () => {
        ltabs.innerHTML = '';
        for (const [k, n] of [['node', 'Nodes'], ['link', 'Links'], ['sub', 'Subcatchments'], ['labels', 'Labels']])
          ltabs.appendChild(h('div', { class: 't2' + (k === layer ? ' active' : ''), onclick: () => { layer = k; cur = 0; render(); } }, n));
      };
      const renderList = () => {
        left.innerHTML = '';
        left.appendChild(h('div', { class: 'te-tb' },
          B('Add', 'Add a sub theme', () => { subs().unshift(this.newSub(layer, layer === 'link' && this.app.results ? 'm:4' : layer === 'node' && this.app.results ? 'm:full' : 'type', 'New theme')); cur = 0; render(); }),
          B('Delete', 'Delete the selected sub theme', () => { if (subs()[cur]) { subs().splice(cur, 1); cur = Math.max(0, cur - 1); render(); } }),
          B('↑', 'Move up (higher precedence)', () => { if (cur > 0) { const a = subs(); [a[cur - 1], a[cur]] = [a[cur], a[cur - 1]]; cur--; render(); } }),
          B('↓', 'Move down', () => { const a = subs(); if (cur < a.length - 1) { [a[cur + 1], a[cur]] = [a[cur], a[cur + 1]]; cur++; render(); } }),
          B('Duplicate', 'Duplicate', () => { const t = subs()[cur]; if (t) { const c = JSON.parse(JSON.stringify(t)); c.name += ' (copy)'; subs().splice(cur, 0, c); render(); } })));
        const list = h('div', { class: 'te-list' });
        subs().forEach((t, i) => list.appendChild(h('div', { class: 'te-item' + (i === cur ? ' sel' : '') + (t.enabled ? '' : ' off'), onclick: () => { cur = i; render(); } }, h('input', { type: 'checkbox', class: 'te-on', title: 'Render this theme on the map', checked: !!t.enabled, onclick: (e) => e.stopPropagation(), onchange: (e) => { t.enabled = e.target.checked; cur = i; render(); } }), h('span', { class: 'pal', style: { background: 'linear-gradient(90deg,' + (t.ranges.length ? t.ranges.map(r => r.color).join(',') : '#ccc,#ccc') + ')' } }), h('span', null, t.name + (this.isDynamic(t) ? '  ▶' : '')), h('span', { style: { flex: 0 } }))));
        list.appendChild(h('div', { class: 'te-item', style: { cursor: 'default', color: 'var(--muted)' } }, h('span', { class: 'pal', style: { background: '#b0bec5' } }), 'Base Theme (object type colours)'));
        left.appendChild(list);
        left.appendChild(h('div', { class: 'note', style: { padding: '6px 8px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4 } }, 'Themes are applied top-down: the first enabled theme that sets colour (or size/width) for an object wins. The Base Theme is always last. Themes marked ▶ (dynamic results at the current time step) are shown only in play mode; the other themes only outside play mode.'));
      };
      const renderEditor = () => {
        right.innerHTML = '';
        const t = subs()[cur];
        if (!t) { right.appendChild(h('div', { class: 'empty' }, 'No sub themes for this layer. Click Add to create one.')); return; }
        const fields = AV.THEME_ATTRS[layer].filter(f => f[0] !== 'none').concat(layer !== 'sub' ? [['group', 'Group', 'S']] : []);
        const fSel = h('select', { onchange: async () => { if (fSel.value === '__expr') { const r = await AV.clauseEditor(this.app, { mode: 'value', kind: layer, kindFixed: true, clause: t.field.startsWith('x:') ? t.field.slice(2) : '', title: 'Custom theme value - ' + LAYER_NAME[layer] }); if (!r) { fSel.value = t.field; return; } fSel.value = 'x:' + r.clause; if (fSel.value !== 'x:' + r.clause) fSel.appendChild(h('option', { value: 'x:' + r.clause }, 'ƒ ' + r.clause)); fSel.value = 'x:' + r.clause; } t.field = fSel.value; if (t.name === 'New theme' || t.name.startsWith(this.fieldName(layer, t.oldField || ''))) t.name = this.fieldName(layer, t.field); t.oldField = t.field; t.kind = CATEGORICAL.has(t.field) ? 'individual' : 'continuous'; this.autoRange(layer, t); render(); } }, [['S', 'Static properties'], ['T', 'Statistic results (whole run)'], ['D', 'Dynamic results (current time step)']].map(([g, gl]) => h('optgroup', { label: gl }, fields.filter(f => (f[2] || 'S') === g).map(([v, l]) => h('option', { value: v }, l)))).concat(layer === 'link' ? (() => { const ef = AV.exprFields(this.app, 'link').filter(f => f.vt && f.vt !== 'self' && !/: (Name|Tag|Object type)/.test(f.l)); return ['us', 'ds'].map(vt => h('optgroup', { label: vt === 'us' ? 'US Node' : 'DS Node' }, ef.filter(f => f.vt === vt).map(f => h('option', { value: 'x:' + f.n }, f.l)))); })() : [])
          .concat([h('optgroup', { label: 'Custom' }, (t.field.startsWith('x:') && !/^x:(us|ds)_/.test(t.field) ? [h('option', { value: t.field }, 'ƒ ' + t.field.slice(2))] : []).concat([h('option', { value: '__expr' }, 'Custom expression…')]))]));
        fSel.value = t.field; t.oldField = t.field;
        const name = h('input', { type: 'text', value: t.name, onchange: () => { t.name = name.value; renderList(); } });
        const kind = h('select', { onchange: () => { t.kind = kind.value; this.autoRange(layer, t); render(); } }, [['continuous', 'Continuous (ranges)'], ['individual', 'Individual (values)']].map(([v, l]) => h('option', { value: v }, l))); kind.value = t.kind;
        const meth = h('select', { onchange: () => { t.method = meth.value; this.autoRange(layer, t); render(); } }, [['linear', 'Linear'], ['quantile', 'Quantile (equal count)'], ['log', 'Log'], ['exponential', 'Exponential']].map(([v, l]) => h('option', { value: v }, l))); meth.value = t.method || 'linear';
        const nIn = h('input', { type: 'number', min: 2, max: 20, value: t.n || 5, style: { width: '60px' }, onchange: () => { this.autoRange(layer, t, Math.max(2, Math.min(20, +nIn.value || 5))); render(); } });
        const ramp = AV.rampPicker(t.ramp || 'Blue-Red', t.invert, (v) => { t.ramp = v; const c = AV.rampColors(t.ramp, t.ranges.length, t.invert); t.ranges.forEach((r, i) => r.color = c[i]); render(); });
        const chk = (key, label) => h('label', { style: { whiteSpace: 'nowrap' } }, h('input', { type: 'checkbox', checked: !!t[key], onchange: (e) => { t[key] = e.target.checked; if (key === 'abs' || key === 'invert') this.autoRange(layer, t); render(); } }), ' ' + label);
        right.appendChild(h('div', { class: 'form', style: { gridTemplateColumns: 'max-content 1fr max-content 1fr' } },
          h('label', null, 'Name'), name, h('label', null, 'Variable'), fSel,
          h('label', null, 'Range type'), kind, h('label', null, 'AutoScale'), meth,
          h('label', null, 'Ranges'), h('span', null, nIn, ' ', B('Auto-Theme', 'Recalculate ranges from the data', () => { this.autoRange(layer, t, Math.max(2, Math.min(20, +nIn.value || 5))); render(); })), h('label', null, 'Colour ramp'), ramp));
        const whereTxt = h('input', { type: 'text', value: t.where || '', placeholder: '(all objects)  e.g.  type = \'CONDUIT\' and diam >= 1', style: { flex: 1 }, onchange: () => { t.where = whereTxt.value.trim(); if (t.where && !this.compiled(layer, t.where)) { AV.toast('The Where clause is not valid.', true); } this.autoRange(layer, t); render(); } });
        right.appendChild(h('div', { class: 'te-where' }, h('label', null, 'Where'), whereTxt,
          B('Edit…', 'Only objects matching this clause are rendered by this theme', async () => { const r = await AV.clauseEditor(this.app, { mode: 'filter', kind: layer, kindFixed: true, clause: t.where || '', title: 'Theme filter - ' + LAYER_NAME[layer] }); if (!r) return; t.where = r.clause; this.autoRange(layer, t); render(); }),
          t.field.startsWith('x:') ? B('Edit expression…', 'Change the custom value expression', async () => { const r = await AV.clauseEditor(this.app, { mode: 'value', kind: layer, kindFixed: true, clause: t.field.slice(2), title: 'Custom theme value - ' + LAYER_NAME[layer] }); if (!r) return; t.field = 'x:' + r.clause; t.name = 'ƒ ' + r.clause; this.autoRange(layer, t); render(); }) : null));
        right.appendChild(h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } }, chk('useColor', layer === 'link' ? 'Line colour' : layer === 'node' ? 'Symbol colour' : 'Fill colour'),
          layer !== 'sub' ? chk('useSize', layer === 'link' ? 'Line width' : 'Symbol size (circles)') : null, chk('abs', 'Absolute values'), chk('nulls', 'Theme nulls'), chk('invert', 'Invert ramp'), chk('legend', 'Show in key'), chk('enabled', 'Enabled')));
        // ranges grid
        const tb = h('tbody');
        const grid = h('div', { class: 'te-grid' }, h('table', null, h('thead', null, h('tr', null, h('th', null, t.kind === 'individual' ? 'Value' : 'Value (≤)'), h('th', null, 'Colour'), layer !== 'sub' ? h('th', null, layer === 'link' ? 'Width (px)' : 'Size (px)') : null, h('th', null, 'Visible'), h('th', null, ''))), tb));
        t.ranges.forEach((r, i) => {
          const v = h('input', { type: t.kind === 'individual' ? 'text' : 'number', step: 'any', value: r.v, onchange: () => { r.v = t.kind === 'individual' ? v.value : parseFloat(v.value); if (t.kind !== 'individual') t.ranges.sort((a, b) => a.v - b.v); render(); } });
          const c = h('input', { type: 'color', value: r.color, oninput: () => { r.color = c.value; preview(); } });
          const sz = h('input', { type: 'number', step: '0.5', min: 0.5, value: r.size, style: { width: '64px' }, onchange: () => { r.size = parseFloat(sz.value) || 1; preview(); } });
          tb.appendChild(h('tr', null, h('td', null, v), h('td', null, c), layer !== 'sub' ? h('td', null, sz) : null,
            h('td', null, h('input', { type: 'checkbox', checked: r.show !== false, onchange: (e) => { r.show = e.target.checked; preview(); } })),
            h('td', null, h('button', { class: 'btn small', title: 'Remove range', onclick: () => { t.ranges.splice(i, 1); render(); } }, '−'))));
        });
        tb.appendChild(h('tr', null, h('td', { colspan: 5 }, B('+ Add range', '', () => { const last = t.ranges[t.ranges.length - 1]; t.ranges.push({ v: t.kind === 'individual' ? 'value' : (last ? +last.v * 1.5 || 1 : 1), color: '#9e9e9e', size: last ? last.size : this.defSize(layer), show: true }); render(); }))));
        right.appendChild(grid);
        const pv = h('div', { class: 'te-preview' });
        const preview = () => {
          pv.innerHTML = '';
          const vals = this.rangeValues(layer, t); const counts = t.ranges.map(() => 0); let nulls = 0;
          for (const v of vals) { const r = this.rowFor(t, v); const k = t.ranges.indexOf(r); if (k >= 0) counts[k]++; else nulls++; }
          pv.appendChild(h('b', { style: { fontSize: '12px' } }, 'Draw style preview: '));
          t.ranges.forEach((r, i) => pv.appendChild(h('span', null, h('span', { style: { display: 'inline-block', width: layer === 'node' && t.useSize ? r.size * 2 + 'px' : '22px', height: layer === 'node' && t.useSize ? r.size * 2 + 'px' : (layer === 'link' && t.useSize ? Math.max(2, r.size) + 'px' : '10px'), borderRadius: layer === 'node' ? '50%' : '2px', background: r.color, opacity: r.show === false ? .3 : 1 } }), String(counts[i]))));
          if (nulls) pv.appendChild(h('span', null, '#NULL ' + nulls));
          this.updateLegend(); this.app.map.redraw();
        };
        right.appendChild(pv); preview();
        if (/^(r:|m:)/.test(t.field) && !this.app.results) right.appendChild(h('div', { class: 'note', style: { color: 'var(--warn)' } }, 'This is a results field: it will display after a simulation is run or a results file is loaded.'));
      };
      const renderLabels = () => {
        te.style.display = 'block'; left.style.display = 'none'; right.innerHTML = ''; right.style.display = 'block';
        for (const [k, n] of [['node', 'Nodes'], ['link', 'Links'], ['sub', 'Subcatchments']]) {
          const L = this.layers[k].labels;
          const fields = [['id', 'ID']].concat(AV.THEME_ATTRS[k].filter(f => f[0] !== 'none'));
          const sel = h('select', { multiple: true, size: 6, style: { width: '320px' }, onchange: () => { L.fields = [...sel.selectedOptions].map(o => o.value); this.app.map.redraw(); } }, fields.map(([v, l]) => h('option', { value: v, selected: L.fields.includes(v) }, l)));
          right.appendChild(h('div', { class: 'form', style: { marginBottom: '14px' } }, h('h4', null, n + ' labels'),
            h('label', null, 'Show labels'), h('input', { type: 'checkbox', checked: L.on, onchange: (e) => { L.on = e.target.checked; this.app.map.redraw(); } }),
            h('label', null, 'Variables (Ctrl+click for several)'), sel,
            h('label', null, 'Decimal places'), h('input', { type: 'number', min: 0, max: 6, value: L.dp === undefined ? '' : L.dp, placeholder: 'auto', style: { width: '70px' }, onchange: (e) => { L.dp = e.target.value === '' ? undefined : +e.target.value; this.app.map.redraw(); } })));
        }
        right.appendChild(h('div', { class: 'note' }, 'Labels are drawn when fewer than about 4000 objects of the layer are on screen; zoom in to see them on large networks.'));
      };
      const render = () => {
        renderTabs();
        if (layer === 'labels') { renderLabels(); return; }
        te.style.display = 'flex'; left.style.display = 'flex'; right.style.display = 'flex';
        renderList(); renderEditor();
        this.updateLegend(); this.app.map.redraw();
      };
      render();
      const r = await AV.modal({
        title: 'Layer Theme Editor', body, width: 940, enterSubmits: false, buttons: [
          { label: 'Load...', onClick: async () => { await this.loadFile(() => render()); return false; } },
          { label: 'Save...', onClick: async () => { await AV.downloadText(this.toJSON(), 'theme.json', [{ name: 'Avaris2 CS theme', extensions: ['json'] }]); return false; } },
          { label: 'Cancel', value: 'cancel' }, { label: 'Apply', onClick: () => { render(); return false; } }, { label: 'OK', primary: true, value: 'ok' }]
      }).done;
      if (r !== 'ok') { this.layers = JSON.parse(snapshot); }
      this.invalidate(); this.app.map.redraw();
      if (this.app.settings) { this.app.settings.lastTheme = this.toJSON(); window.host.setSettings(this.app.settings); }
    }
  }
  AV.Theme = Theme;
})(window.AV);
