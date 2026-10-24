// Observed data reader for calibration (main process): reads flow-survey / rain-gauge files of any size and
// recognises their layout automatically.
//   Text (CSV, TXT, DAT, TSV; any delimiter) and Excel (.xlsx, every sheet).
//   Layouts:  wide   - date/time column(s) + one column per monitor (or per monitor and variable)
//             single - one file per monitor (monitor ID from the column header or the file name)
//             long   - one row per (monitor, time, value)
//             gage   - SWMM rain-gauge format: STA YYYY MM DD HH mm value
//   Times are SWMM / Excel date numbers (days since 30/12/1899, local time, no time zone).
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');

const UNIT_RE = /\(([^)]*)\)|\[([^\]]*)\]/;
const UNITS = {
  Flow: ['l/s', 'lps', 'm3/s', 'm³/s', 'cms', 'cumecs', 'mld', 'ml/d', 'm3/h', 'm³/h', 'cfs', 'ft3/s', 'mgd', 'gpm'],
  Velocity: ['m/s', 'ft/s', 'fps', 'mm/s', 'cm/s'],
  Rainfall: ['mm/h', 'mm/hr', 'in/h', 'in/hr', 'mm/5min', 'mm/15min'],
  Depth: ['mm', 'cm', 'm', 'ft', 'in'],
};
const KEYWORDS = [['Rainfall', /\b(rain|rainfall|precip\w*|intensity|rg)\b|^rain|rain$/i], ['Velocity', /\b(vel\w*|speed|v)\b/i], ['Depth', /\b(depth|level|lvl|stage|wl|d|h)\b/i], ['Flow', /\b(flow|discharge|q|rate)\b/i]];
const isNum = (s) => s !== '' && s !== null && s !== undefined && isFinite(+s);
const days = (y, mo, d, sec) => (Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86400000 + sec / 86400;

// ---- one date/time field -> parts {a, b, y, sec, iso} or {sec} (time only) or null
const RE_ISO = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;
const RE_XY = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(AM|PM)?)?$/i;
const RE_T = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(AM|PM)?$/i;
const hms = (H, M, S, ap) => { let h = +H; if (ap) { ap = ap.toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0; } return h * 3600 + (+M) * 60 + (+(S || 0)); };
function dateParts(s) {
  s = String(s).trim().replace(/^"|"$/g, ''); let m;
  if ((m = RE_ISO.exec(s))) return { iso: 1, y: +m[1], a: +m[2], b: +m[3], sec: m[4] ? hms(m[4], m[5], m[6]) : 0, hasT: !!m[4] };
  if ((m = RE_XY.exec(s))) { let y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900; return { y, a: +m[1], b: +m[2], sec: m[4] ? hms(m[4], m[5], m[6], m[7]) : 0, hasT: !!m[4] }; }
  if ((m = RE_T.exec(s))) return { timeOnly: 1, sec: hms(m[1], m[2], m[3], m[4]) };
  return null;
}
const isDateHeader = (s) => /date|time|timestamp|datetime|日期|时间/i.test(String(s));

// ---- header text -> {id, var, unit}
function headerInfo(hdr, knownIds) {
  let s = String(hdr || '').trim(); let unit = '';
  const um = UNIT_RE.exec(s); if (um) { unit = (um[1] || um[2] || '').trim(); s = s.replace(UNIT_RE, ' '); }
  let tok = s.split(/[\s_\-.,:;]+/).filter(Boolean);
  if (!unit) { const i = tok.findIndex(t => Object.values(UNITS).some(a => a.includes(t.toLowerCase())) && t.length > 1); if (i > 0) { unit = tok[i]; tok.splice(i, 1); } }
  let v = ''; const ul = unit.toLowerCase();
  for (const [k, re] of KEYWORDS) if (tok.some(t => re.test(t))) { v = k; tok = tok.filter(t => !re.test(t)); break; }
  if (!v && ul) for (const k of ['Rainfall', 'Velocity', 'Flow', 'Depth']) if (UNITS[k].includes(ul)) { v = k; break; }
  let id = '';
  if (knownIds && knownIds.length) { const up = String(hdr).toUpperCase(); id = knownIds.filter(k => new RegExp('(^|[^A-Z0-9])' + k.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Z0-9])').test(up)).sort((x, y) => y.length - x.length)[0] || ''; }
  if (!id) id = tok.join('_');
  return { id, var: v, unit };
}
const fileId = (file, knownIds) => { const st = path.basename(file).replace(/\.[^.]+$/, ''); const h = headerInfo(st, knownIds); return h; };

// ---- row sources
async function* textRows(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}
function splitter(sample) {
  const lines = sample.filter(l => l.trim() && !/^\s*[;#]/.test(l)).slice(0, 40);
  for (const d of [',', '\t', ';', '|']) { const c = lines.map(l => l.split(d).length); if (c.length && c[c.length - 1] > 1 && c.filter(x => x === c[c.length - 1]).length >= c.length * 0.8) return { d, f: (l) => splitCSV(l, d) }; }
  return { d: ' ', f: (l) => l.trim().split(/\s+/) };
}
function splitCSV(l, d) { if (l.indexOf('"') < 0) return l.split(d).map(x => x.trim()); const o = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === d && !q) { o.push(cur.trim()); cur = ''; } else cur += c; } o.push(cur.trim()); return o; }

// minimal .xlsx reader: every sheet -> rows of cell values (numbers stay numbers)
function unzip(buf) {
  let eo = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error('Not a valid .xlsx file'); const n = buf.readUInt16LE(eo + 10); let cd = buf.readUInt32LE(eo + 16); const out = {};
  for (let k = 0; k < n; k++) { const method = buf.readUInt16LE(cd + 10), cs = buf.readUInt32LE(cd + 20), nl = buf.readUInt16LE(cd + 28), xl = buf.readUInt16LE(cd + 30), cl = buf.readUInt16LE(cd + 32), lo = buf.readUInt32LE(cd + 42);
    const name = buf.slice(cd + 46, cd + 46 + nl).toString('utf8'); cd += 46 + nl + xl + cl; const lnl = buf.readUInt16LE(lo + 26), lxl = buf.readUInt16LE(lo + 28); const raw = buf.slice(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + cs);
    out[name] = () => (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8'); }
  return out;
}
const xmlText = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function xlsxSheets(file) {
  const z = unzip(fs.readFileSync(file)); const ss = [];
  if (z['xl/sharedStrings.xml']) { const x = z['xl/sharedStrings.xml'](); const re = /<si>([\s\S]*?)<\/si>/g; let m; while ((m = re.exec(x))) ss.push(xmlText((m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''))); }
  const wb = z['xl/workbook.xml'] ? z['xl/workbook.xml']() : ''; const rels = z['xl/_rels/workbook.xml.rels'] ? z['xl/_rels/workbook.xml.rels']() : '';
  const sheets = []; const re = /<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g; let m;
  while ((m = re.exec(wb))) { const rm = new RegExp('Id="' + m[2] + '"[^>]*Target="([^"]*)"').exec(rels) || new RegExp('Target="([^"]*)"[^>]*Id="' + m[2] + '"').exec(rels); if (rm) sheets.push({ name: xmlText(m[1]), file: 'xl/' + rm[1].replace(/^\/?xl\//, '') }); }
  if (!sheets.length) Object.keys(z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).forEach((k, i) => sheets.push({ name: 'Sheet' + (i + 1), file: k }));
  const col = (r) => { let c = 0; for (const ch of r) { if (ch >= 'A' && ch <= 'Z') c = c * 26 + ch.charCodeAt(0) - 64; else break; } return c - 1; };
  return sheets.filter(s => z[s.file]).map(s => ({ name: s.name, rows: () => { const x = z[s.file](); const rows = []; const rre = /<row\b[^>]*>([\s\S]*?)<\/row>/g; let r;
    while ((r = rre.exec(x))) { const row = []; const cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let c;
      while ((c = cre.exec(r[1]))) { const at = c[1]; const ref = /r="([A-Z]+)\d+"/.exec(at); const t = (/t="(\w+)"/.exec(at) || [])[1]; const body = c[2] || ''; const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        let val = ''; if (t === 's') val = ss[+v] || ''; else if (t === 'inlineStr') val = xmlText((body.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || ''); else if (t === 'str' || t === 'b' || t === 'e') val = v === undefined ? '' : xmlText(v); else val = v === undefined ? '' : +v;
        row[ref ? col(ref[1]) : row.length] = val; }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = ''; rows.push(row); }
    return rows; } }));
}

// ---- growable typed arrays
class Grow { constructor(T) { this.T = T; this.a = new T(4096); this.n = 0; } push(v) { if (this.n === this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; } done() { return this.a.slice(0, this.n); } }

// ---- detect the layout from the first rows (arrays of cells)
function detect(sample, file, opts) {
  const known = opts.knownIds || [];
  const rows = sample.filter(r => r.some(c => String(c).trim() !== '') && !/^\s*[;#]/.test(String(r[0])));
  // SWMM gauge format: STA YYYY MM DD HH mm value
  const g = rows.slice(-10); if (g.length && g.every(r => r.length >= 7 && /^\d{4}$/.test(r[1]) && +r[2] >= 1 && +r[2] <= 12 && +r[3] >= 1 && +r[3] <= 31 && isNum(r[4]) && isNum(r[5]) && isNum(r[6])))
    return { layout: 'gage', head: 0, timeCols: [1, 2, 3, 4, 5], valCols: [{ c: 6, id: '', var: 'Rainfall', unit: '' }], idCol: 0, dateFmt: 'STA YYYY MM DD HH mm' };
  // header rows: leading rows that are not data (a data row has a date in one of the first 3 cells, or an Excel date number)
  const isDateCell = (c, hdrIsDate) => (typeof c === 'number' ? (hdrIsDate && c > 1000 && c < 80000) : !!dateParts(c));
  let head = 0; while (head < rows.length - 1 && !rows[head].slice(0, 3).some(c => isDateCell(c, true) && (typeof c !== 'number' || head > 0))) head++;
  // header rows: the names row is the one with most text cells; a following row of units only is the units row
  const H = rows.slice(0, head).map(r => r.map(x => String(x).trim()));
  const isUnitCell = (x) => !x || Object.values(UNITS).some(u => u.includes(x.toLowerCase().replace(/^[(\[]|[)\]]$/g, '')));
  let hi0 = -1; H.forEach((r, i) => { if (hi0 < 0 || r.filter(Boolean).length > H[hi0].filter(Boolean).length) hi0 = i; });
  let unitsRow = null; if (hi0 >= 0 && H[hi0 + 1] && H[hi0 + 1].some(Boolean) && H[hi0 + 1].every(isUnitCell)) unitsRow = H[hi0 + 1];
  else if (hi0 > 0 && H[hi0 - 1].some(Boolean) && H[hi0 - 1].every(isUnitCell)) unitsRow = H[hi0 - 1];
  const hdr = hi0 >= 0 ? H[hi0] : []; const preamble = H.filter((r, i) => i !== hi0 && r !== unitsRow).map(r => r.join(' ')).join(' ');
  const data = rows.slice(head, head + 200); if (!data.length) throw new Error('No data rows found.');
  let nc = 0; for (const r of data) if (r.length > nc) nc = r.length;
  // time columns: cells that parse as date / time / Excel date
  const timeCols = []; let dateFmt = '';
  for (let c = 0; c < Math.min(nc, 4); c++) { const vals = data.map(r => r[c]).filter(x => x !== '' && x !== undefined);
    if (!vals.length) continue;
    if (vals.every(x => typeof x === 'number') && (isDateHeader(hdr[c]) || (c === 0 && vals.every(x => x > 20000 && x < 80000)))) { timeCols.push(c); dateFmt = dateFmt || 'Excel date'; continue; }
    if (vals.every(x => typeof x === 'number' && x >= 0 && x < 1) && isDateHeader(hdr[c]) && timeCols.length) { timeCols.push(c); continue; }
    const p = vals.map(x => typeof x === 'string' ? dateParts(x) : null); if (p.every(Boolean)) { timeCols.push(c); continue; }
    if (timeCols.length) break; }
  if (!timeCols.length) throw new Error('No date / time column found (looked at the first 4 columns).');
  // ID column (long table): a text column, not time, with repeating non-numeric values
  let idCol = -1; for (let c = 0; c < nc; c++) { if (timeCols.includes(c)) continue; const vals = data.map(r => r[c]); if (vals.every(x => x !== '' && x !== undefined && !isNum(x)) && new Set(vals).size < vals.length) { idCol = c; break; } }
  const valCols = [];
  for (let c = 0; c < nc; c++) { if (timeCols.includes(c) || c === idCol) continue; const vals = data.map(r => r[c]); const nn = vals.filter(x => isNum(x)).length; if (nn < vals.length * 0.3) continue;
    const hc = hdr[c] || ''; const hi = headerInfo(hc + (unitsRow && unitsRow[c] && !hc.includes(unitsRow[c]) ? ' (' + unitsRow[c].replace(/^[(\[]|[)\]]$/g, '') + ')' : ''), known);
    valCols.push({ c, id: hi.id, var: hi.var, unit: hi.unit, header: hdr[c] || '' }); }
  if (!valCols.length) throw new Error('No value column found.');
  let layout = idCol >= 0 ? 'long' : valCols.length > 1 ? 'wide' : 'single';
  let fi = fileId(file, known); if (preamble && known.length) { const pi = headerInfo(preamble, known); if (known.includes(pi.id) && !known.includes(fi.id)) fi = Object.assign({}, fi, { id: pi.id }); }
  // columns without a monitor ID: from the file name (one file per monitor) or "file:column"
  const ids = new Set(valCols.map(v => v.id).filter(Boolean));
  if (layout !== 'long') {
    const generic = valCols.every(v => !v.id || /^(value|val|data|reading|col\d*)$/i.test(v.id));
    if (generic || (fi.id && known.includes(fi.id) && !valCols.some(v => known.includes(v.id)))) { if (layout === 'wide') layout = 'single'; valCols.forEach(v => { v.id = fi.id || 'M1'; if (!v.var) v.var = fi.var; if (!v.unit) v.unit = fi.unit; }); }
    else valCols.forEach((v, i) => { if (!v.id) v.id = (fi.id || 'M') + '_' + (i + 1); });
    if (ids.size === 1 && layout === 'wide' && valCols.every(v => v.var) && new Set(valCols.map(v => v.var)).size === valCols.length) layout = 'single';
  }
  return { layout, head, hdr, timeCols, valCols, idCol, dateFmt };
}

// ---- read one file (or each sheet of a workbook)
async function readObserved(file, opts = {}) {
  const ext = path.extname(file).toLowerCase(); const out = [];
  if (ext === '.xlsx' || ext === '.xlsm') { for (const sh of xlsxSheets(file)) { const rows = sh.rows(); if (rows.length < 2) continue;
      try { out.push(await readRows(file + ' [' + sh.name + ']', (async function* () { for (const r of rows) yield r; })(), opts, null, file)); } catch (e) { out.push({ file: file + ' [' + sh.name + ']', error: e.message }); } }
    if (!out.length) throw new Error('The workbook has no sheet with data.'); return out; }
  if (ext === '.xls') throw new Error('Old Excel .xls files are not supported - save the file as .xlsx or .csv.');
  // text: first 200 lines decide the delimiter
  const sample = []; for await (const l of textRows(file)) { sample.push(l); if (sample.length >= 200) break; }
  const sp = splitter(sample);
  const rows = (async function* () { for await (const l of textRows(file)) { if (!l.trim() || /^\s*[;#]/.test(l)) continue; yield sp.f(l); } })();
  out.push(await readRows(file, rows, opts, sp.d, file)); return out;
}

async function readRows(label, rowsIt, opts, delim, realFile) {
  const sample = []; const buf = [];
  for (let k = 0; k < 260; k++) { const n = await rowsIt.next(); if (n.done) break; buf.push(n.value); }
  for (const x of buf) sample.push(x);
  const D = detect(sample, realFile, opts);
  const nT = D.timeCols.length; const isGage = D.layout === 'gage';
  // per-row time parts are kept until the day/month order is known
  const A = new Grow(Int16Array), B = new Grow(Int16Array), Y = new Grow(Int16Array), S = new Grow(Float64Array), X = new Grow(Float64Array);
  let maxA = 0, maxB = 0, chA = 0, chB = 0, iso = false, excel = false; let lastDate = null; let bad = 0, rowsN = 0;
  const per = new Map(); // key -> {t:Grow(rowIndex), v:Grow}
  const keyOf = (id, vc) => id + '\u0001' + vc.c;
  const valColsById = D.valCols;
  const push = (r) => {
    if (r.length < 2) return; let a = 0, b = 0, y = 0, sec = 0, ex = NaN;
    if (isGage) { y = +r[1]; a = +r[2]; b = +r[3]; sec = (+r[4]) * 3600 + (+r[5]) * 60; iso = true; }
    else { for (let k = 0; k < nT; k++) { const c = r[D.timeCols[k]];
        if (typeof c === 'number') { if (c >= 1) { ex = Math.floor(c); sec = (c - ex) * 86400; } else sec = (isNaN(ex) && !lastDate ? 0 : sec) + c * 86400; excel = true; continue; }
        const p = dateParts(c); if (!p) { bad++; return; }
        if (p.timeOnly) sec = p.sec; else { a = p.a; b = p.b; y = p.y; if (p.hasT || k === nT - 1) sec = p.sec; if (p.iso) iso = true; } } }
    if (isNaN(ex) && !y) { bad++; return; }
    if (A.n) { if (a !== A.a[A.n - 1]) chA++; if (b !== B.a[B.n - 1]) chB++; }
    const row = A.n; A.push(a); B.push(b); Y.push(y); S.push(sec); X.push(ex); if (a > maxA) maxA = a; if (b > maxB) maxB = b; rowsN++;
    if (D.layout === 'long' || isGage) { const id = String(r[D.idCol]).trim(); const vc = valColsById[0]; const k = keyOf(id, vc); let e = per.get(k); if (!e) per.set(k, e = { id, vc, rows: new Grow(Int32Array), v: new Grow(Float32Array) }); e.rows.push(row); const x = r[vc.c]; e.v.push(isNum(x) ? +x : NaN); }
    else for (const vc of valColsById) { const k = keyOf(vc.id, vc); let e = per.get(k); if (!e) per.set(k, e = { id: vc.id, vc, rows: null, v: new Grow(Float32Array) }); const x = r[vc.c]; e.v.push(isNum(x) ? +x : NaN); }
  };
  for (const r of sample.slice(D.head)) push(r);
  for (;;) { const n = await rowsIt.next(); if (n.done) break; push(n.value); }
  if (!rowsN) throw new Error('No rows with a valid date / time.');
  // day / month order
  let order = 'MDY'; if (iso || isGage) order = 'YMD'; else if (maxA > 12 && maxB <= 12) order = 'DMY'; else if (maxB > 12 && maxA <= 12) order = 'MDY'; else if (chA !== chB) order = chA > chB ? 'DMY' : 'MDY'; else order = opts.preferDMY ? 'DMY' : 'MDY';
  if (opts.order && !iso && !isGage) order = opts.order;
  const a = A.done(), b = B.done(), y = Y.done(), s = S.done(), x = X.done();
  const t = new Float64Array(a.length);
  for (let i = 0; i < t.length; i++) t[i] = !isNaN(x[i]) ? x[i] + s[i] / 86400 : order === 'DMY' ? days(y[i], b[i], a[i], s[i]) : days(y[i], a[i], b[i], s[i]);
  const ambiguous = !iso && !isGage && !excel && maxA <= 12 && maxB <= 12 && chA === chB;
  const fmt = D.dateFmt || (isGage ? 'STA YYYY MM DD HH mm' : iso ? 'yyyy-MM-dd HH:mm' : order === 'DMY' ? 'dd/MM/yyyy HH:mm' : 'MM/dd/yyyy HH:mm');
  // series
  const series = [];
  for (const e of per.values()) {
    let tt; if (e.rows) { const r = e.rows.done(); tt = new Float64Array(r.length); for (let i = 0; i < r.length; i++) tt[i] = t[r[i]]; } else tt = t;
    const v = e.v.done();
    // sort by time if needed
    let sorted = true; for (let i = 1; i < tt.length; i++) if (tt[i] < tt[i - 1]) { sorted = false; break; }
    let T = tt, V = v; if (!sorted) { const ix = Array.from(tt.keys()).sort((p, q) => tt[p] - tt[q]); T = Float64Array.from(ix, i => tt[i]); V = Float32Array.from(ix, i => v[i]); }
    const hi = e.rows ? headerInfo(e.id, opts.knownIds) : null;
    series.push({ id: e.rows ? (hi.id || e.id) : e.id, var: e.vc.var || (hi && hi.var) || '', unit: e.vc.unit || '', header: e.vc.header || '', t: T, v: V, step: medianStep(T) });
  }
  return { file: label, layout: D.layout, dateFmt: fmt, order, ambiguous, rows: rowsN, badRows: bad, delimiter: delim, series };
}
function medianStep(t) { const n = Math.min(t.length - 1, 2000); if (n < 1) return 0; const d = []; for (let i = 1; i <= n; i++) d.push(Math.round((t[i] - t[i - 1]) * 86400)); d.sort((p, q) => p - q); return d[n >> 1]; }

// a small table (mapping file): rows of cells from a CSV / TXT or the first sheet of an .xlsx
async function readTable(file) {
  if (/\.xlsx?m?$/i.test(file)) { const sh = xlsxSheets(file)[0]; return sh ? sh.rows().map(r => r.map(String)) : []; }
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/); const sp = splitter(lines); return lines.filter(l => l.trim()).map(sp.f);
}
module.exports = { readTable, readObserved, headerInfo, dateParts, detect };
