// Hot start files for the sub-models of a coupled parallel run (2.9.8).
//
// A hot start file (SWMM5-HOTSTART4, written by SAVE HOTSTART) stores the state of every subcatchment, node and link
// in the order of the input file that wrote it, with the object counts in the header; the engine refuses a file whose
// counts differ from its own model (ERROR 333). The sub-models of a partitioned model have other objects, so the hot
// start of the whole model is split here: the order of the objects is read from the text of the model that wrote
// the file, every record is copied to the position of the same object in the sub-model, and objects the whole model
// did not have (boundary outfalls, 2D cells and links) start empty, links open. Version 5 files carry the names themselves.
'use strict';

const SEC = { SUBCATCHMENTS: 'sub', JUNCTIONS: 'node', OUTFALLS: 'node', DIVIDERS: 'node', STORAGE: 'node', CONDUITS: 'link', PUMPS: 'link', ORIFICES: 'link', WEIRS: 'link', OUTLETS: 'link' };
const tok = (l) => { const out = []; const re = /"([^"]*)"|(\S+)/g; let m; while ((m = re.exec(l))) out.push(m[1] !== undefined ? m[1] : m[2]); return out; };

// objects in engine order (the order of their lines in the file) and what decides the size of their records
function engineOrder(text) {
  const o = { sub: [], node: [], link: [], storage: new Set(), off: new Set(), gw: new Set(), snow: new Set(), nLand: 0, nPoll: 0 };
  let sec = '';
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l[0] === ';') continue;
    if (l[0] === '[') { sec = l.slice(1, l.indexOf(']')).toUpperCase(); continue; }
    const t = tok(l); if (!t.length) continue;
    const kind = SEC[sec];
    if (kind) { o[kind].push(t[0]); if (sec === 'STORAGE') o.storage.add(t[0]); if (sec === 'SUBCATCHMENTS' && t[8]) o.snow.add(t[0]); if (sec === 'PUMPS' && /^OFF$/i.test(t[4] || '')) o.off.add(t[0]); continue; }
    if (sec === 'GROUNDWATER') o.gw.add(t[0]); else if (sec === 'LANDUSES') o.nLand++; else if (sec === 'POLLUTANTS') o.nPoll++;
  }
  return o;
}
const recSub = (o, id) => { const p = o.nPoll; return 8 * (4 + 6 + (o.gw.has(id) ? 4 : 0) + (o.snow.has(id) ? 15 : 0) + (p > 0 ? 2 * p + o.nLand * (p * p + 1) : 0)); };
const recNode = (o, id) => 4 * (2 + (o.storage.has(id) ? 1 : 0) + o.nPoll);
const recLink = (o) => 4 * (3 + o.nPoll);

// header of a hot start file: { ver, counts: [nSub, nLand, nNode, nLink, nPoll, flowUnits], pos, names }
function readHeader(buf) {
  const st = buf.toString('latin1', 0, 15); let ver = 0;
  if (st === 'SWMM5-HOTSTART4') ver = 4; else if (st === 'SWMM5-HOTSTART5') ver = 5; else if (st === 'SWMM5-HOTSTART3') ver = 3;
  if (!ver) throw new Error('unsupported hot start file (' + JSON.stringify(st) + ')');
  let pos = 15; const c = []; for (let k = 0; k < 6; k++) { c.push(buf.readInt32LE(pos)); pos += 4; }
  let names = null;
  if (ver === 5) { names = { sub: [], node: [], link: [] }; for (const [kind, n] of [['sub', c[0]], ['node', c[2]], ['link', c[3]]]) for (let k = 0; k < n; k++) { const len = buf.readInt32LE(pos); pos += 4; names[kind].push(buf.toString('latin1', pos, pos + len)); pos += len; } }
  return { ver, counts: c, pos, names };
}

// masterTexts: texts of the whole model (1D, and 1D-2D when it has a mesh); the one whose object counts match the
// file is used. Returns { buf, used, missing: { sub, node, link } } or throws.
function split(hsBuf, masterTexts, subText) {
  const H = readHeader(hsBuf);
  let M = null;
  for (const t of masterTexts) { if (!t) continue; const o = engineOrder(t); if (H.names) { o.sub = H.names.sub; o.node = H.names.node; o.link = H.names.link; }
    if (o.sub.length === H.counts[0] && o.nLand === H.counts[1] && o.node.length === H.counts[2] && o.link.length === H.counts[3] && o.nPoll === H.counts[4]) { M = o; break; } }
  if (!M) throw new Error('the hot start file does not match the model (it was saved by a model with other objects: ' + H.counts.slice(0, 5).join('/') + ' subcatchments/land uses/nodes/links/pollutants)');
  // positions of the records of the whole model
  const at = { sub: new Map(), node: new Map(), link: new Map() }; let pos = H.pos;
  if (H.ver >= 3) for (const id of M.sub) { const n = recSub(M, id); at.sub.set(id, [pos, n]); pos += n; }
  for (const id of M.node) { const n = recNode(M, id); at.node.set(id, [pos, n]); pos += n; }
  for (const id of M.link) { const n = recLink(M); at.link.set(id, [pos, n]); pos += n; }
  if (pos > hsBuf.length) throw new Error('the hot start file is shorter than its model needs (' + hsBuf.length + ' < ' + pos + ' bytes)');
  const S = engineOrder(subText);
  if (S.nLand !== M.nLand || S.nPoll !== M.nPoll) throw new Error('the sub-model has other land uses / pollutants than the whole model');
  const parts = []; const missing = { sub: 0, node: 0, link: 0 };
  const head = Buffer.alloc(15 + 24); head.write('SWMM5-HOTSTART4', 0, 'latin1'); [S.sub.length, S.nLand, S.node.length, S.link.length, S.nPoll, H.counts[5]].forEach((v, k) => head.writeInt32LE(v, 15 + 4 * k)); parts.push(head);
  const put = (kind, id, size) => { const r = at[kind].get(id); if (r && r[1] === size) parts.push(hsBuf.subarray(r[0], r[0] + size)); else { parts.push(Buffer.alloc(size)); missing[kind]++; } };
  for (const id of S.sub) put('sub', id, recSub(S, id));
  for (const id of S.node) put('node', id, recNode(S, id));
  // a link the whole model did not have starts with setting 1 (open; 0 = closed would block it, link.c), a pump OFF with 0
  for (const id of S.link) { const r = at.link.get(id), size = recLink(S); if (r && r[1] === size) { parts.push(hsBuf.subarray(r[0], r[0] + size)); continue; }
    const b = Buffer.alloc(size); b.writeFloatLE(S.off.has(id) ? 0 : 1, 8); parts.push(b); missing.link++; }
  return { buf: Buffer.concat(parts), missing };
}

// [FILES] lines of a model text: [{ i (line index), use: 'USE' | 'SAVE', type, path }]
function filesLines(lines) {
  const out = []; let sec = '';
  lines.forEach((raw, i) => { const l = raw.trim(); if (!l || l[0] === ';') return; if (l[0] === '[') { sec = l.slice(1, l.indexOf(']')).toUpperCase(); return; }
    if (sec !== 'FILES') return; const t = tok(l); if (t.length >= 3) out.push({ i, use: t[0].toUpperCase(), type: t[1].toUpperCase(), path: t.slice(2).join(' ') }); });
  return out;
}

// Relative data-file paths of a model text made absolute against baseDir (2.9.10): a sub-model copied into the run's
// _parts folder (1D-2D sub-model, repaired or hot start copy) would otherwise look for "../rain.dat" next to the copy
// (ERROR 317 cannot open rainfall data file). Rain gage FILE, time series FILE, [FILES], [TEMPERATURE] FILE.
// Returns the number of paths changed; lines are changed in place.
function absPaths(lines, baseDir, path) {
  let sec = '', n = 0;
  const q = (p) => /\s/.test(p) ? '"' + p + '"' : p;
  const fix = (p) => { const u = p.replace(/^"|"$/g, ''); if (!u || path.isAbsolute(u) || /^[A-Za-z]:[\\/]/.test(u) || /^\\\\/.test(u)) return null; return path.resolve(baseDir, u); };
  lines.forEach((raw, i) => { const l = raw.trim(); if (!l || l[0] === ';') return; if (l[0] === '[') { sec = l.slice(1, l.indexOf(']')).toUpperCase(); return; }
    const t = tok(l); let k = -1, rest = false;
    if (sec === 'RAINGAGES' && /^FILE$/i.test(t[4] || '') && t[5]) k = 5;
    else if (sec === 'TIMESERIES' && /^FILE$/i.test(t[1] || '') && t[2]) { k = 2; rest = true; }
    else if (sec === 'FILES' && t.length >= 3) { k = 2; rest = true; }
    else if (sec === 'TEMPERATURE' && /^FILE$/i.test(t[0] || '') && t[1]) k = 1;
    if (k < 0) return;
    const orig = rest ? t.slice(k).join(' ') : t[k]; const a = fix(orig); if (!a) return;
    lines[i] = t.slice(0, k).map(q).join(' ') + ' ' + q(a) + (rest ? '' : (t.length > k + 1 ? ' ' + t.slice(k + 1).map(q).join(' ') : '')); n++; });
  return n;
}

module.exports = { engineOrder, readHeader, split, filesLines, absPaths };
