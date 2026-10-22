// Coupled parallel run: merge the results of the sub-models into one .out / .rpt with the objects of the master
// model (Avaris2 CS front end and the web digital twin read one file, as for a normal run).
'use strict';
const fs = require('fs');
const OutReader = require('./outreader');

const MAGIC = 516114522;
// system variables: averaged over the subcatchment area / taken from the first sub-model / summed
const SYS_AREA = new Set([1, 2, 3]);      // rainfall, snow depth, infiltration losses
const SYS_FIRST = new Set([0, 13, 14]);   // air temperature, evaporation, PET
const SYS_OUTFLOW = 11;

function rawLayout(r) {
  // positions of the property blocks and of the variable codes (same as OutReader, kept raw)
  let pos = r.inputPos;
  const int = (p) => r._read(p, 4).readInt32LE(0);
  const L = {};
  L.nSubProps = int(pos); L.subCodes = r._read(pos, 4 * (1 + L.nSubProps)); pos += 4 * (1 + L.nSubProps); L.subPos = pos; pos += 4 * L.nSubProps * r.nSub;
  L.nNodeProps = int(pos); L.nodeCodes = r._read(pos, 4 * (1 + L.nNodeProps)); pos += 4 * (1 + L.nNodeProps); L.nodePos = pos; pos += 4 * L.nNodeProps * r.nNode;
  L.nLinkProps = int(pos); L.linkCodes = r._read(pos, 4 * (1 + L.nLinkProps)); pos += 4 * (1 + L.nLinkProps); L.linkPos = pos; pos += 4 * L.nLinkProps * r.nLink;
  L.varPos = pos;
  return L;
}

function mergeOut(job) {
  const P = job.parts.map(p => new OutReader(p.out));
  try {
    const R0 = P[0];
    const idx = P.map(r => ({ subcatch: new Map(r.ids.subcatch.map((id, i) => [id, i])), node: new Map(r.ids.node.map((id, i) => [id, i])), link: new Map(r.ids.link.map((id, i) => [id, i])) }));
    const bnd = P.map(() => new Set());                      // coupling outfalls of each sub-model
    for (const c of job.couplings) bnd[c.up].add(c.outfall);
    const rev = new Set(job.couplings.filter(c => c.reversed).map(c => c.link));
    // where each master object comes from
    const find = (type, id) => {
      if (type === 'node' && job.nodeOwner && job.nodeOwner[id] !== undefined) { const p = job.nodeOwner[id]; const i = idx[p] && idx[p].node.get(id); if (i !== undefined && !bnd[p].has(id)) return [p, i]; }
      for (let p = 0; p < P.length; p++) { const i = idx[p][type].get(id); if (i !== undefined && !(type === 'node' && bnd[p].has(id))) return [p, i]; }
      return null;
    };
    const src = {}, ids = {};
    for (const t of ['subcatch', 'node', 'link']) { src[t] = []; ids[t] = []; for (const id of job.order[t] || []) { const f = find(t, id); if (f) { src[t].push(f); ids[t].push(id); } } }
    const L = P.map(rawLayout);
    const nPer = Math.min(...P.map(r => r.nPeriods));
    const nSV = R0.nSubVars, nNV = R0.nNodeVars, nLV = R0.nLinkVars, nYV = R0.nSysVars;
    for (const r of P) if (r.nSubVars !== nSV || r.nNodeVars !== nNV || r.nLinkVars !== nLV || r.nSysVars !== nYV || r.flowUnits !== R0.flowUnits) throw new Error('The sub-models do not have the same results variables (regenerate the sub-models).');
    const subArea = P.map(r => r.subArea.reduce((a, b) => a + b, 0)); const totArea = subArea.reduce((a, b) => a + b, 0);

    const fd = fs.openSync(job.out, 'w'); let off = 0;
    const W = (b) => { fs.writeSync(fd, b, 0, b.length, off); off += b.length; };
    const i32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeInt32LE(x, 4 * i)); return b; };
    // --- opening record
    W(i32(MAGIC, R0.version, R0.flowUnits, ids.subcatch.length, ids.node.length, ids.link.length, R0.nPoll));
    const idPos = off;
    for (const t of ['subcatch', 'node', 'link']) for (const id of ids[t]) { const s = Buffer.from(id, 'latin1'); W(i32(s.length)); W(s); }
    for (const id of R0.ids.pollut) { const s = Buffer.from(id, 'latin1'); W(i32(s.length)); W(s); }
    W(i32(...R0.pollUnits));
    // --- object properties
    const inputPos = off;
    const props = (t, codes, n, posKey) => { W(codes); const out = Buffer.alloc(4 * n * src[t].length);
      src[t].forEach(([p, i], k) => { const b = P[p]._read(L[p][posKey] + 4 * n * i, 4 * n); b.copy(out, 4 * n * k);
        if (t === 'link' && rev.has(ids.link[k]) && n >= 3) { const o1 = out.readFloatLE(4 * n * k + 4), o2 = out.readFloatLE(4 * n * k + 8); out.writeFloatLE(o2, 4 * n * k + 4); out.writeFloatLE(o1, 4 * n * k + 8); } });
      W(out); };
    props('subcatch', L[0].subCodes, L[0].nSubProps, 'subPos');
    props('node', L[0].nodeCodes, L[0].nNodeProps, 'nodePos');
    props('link', L[0].linkCodes, L[0].nLinkProps, 'linkPos');
    // --- variable codes, start date, report step (identical in all sub-models)
    W(R0._read(L[0].varPos, R0.outputPos - L[0].varPos));
    const outputPos = off;
    // --- results, period by period (read in blocks)
    const cplLinks = job.couplings.map(c => { const i = idx[c.up].link.get(c.link); return i === undefined ? null : [c.up, i]; });
    const per = 8 + 4 * (ids.subcatch.length * nSV + ids.node.length * nNV + ids.link.length * nLV + nYV);
    const blk = Math.max(1, Math.floor((48 << 20) / Math.max(...P.map(r => r.bytesPerPeriod), per)));
    const lay = P.map(r => ({ sub: r._layout('subcatch').off, node: r._layout('node').off, link: r._layout('link').off, sys: r._layout('system').off, per: r.bytesPerPeriod }));
    for (let p0 = 0; p0 < nPer; p0 += blk) {
      const np = Math.min(blk, nPer - p0);
      const B = P.map((r, k) => r._read(r.outputPos + p0 * lay[k].per, np * lay[k].per));
      const out = Buffer.alloc(np * per);
      for (let q = 0; q < np; q++) {
        let o = q * per;
        B[0].copy(out, o, q * lay[0].per, q * lay[0].per + 8); o += 8;
        const copyObj = (t, nv, key) => { for (let k = 0; k < src[t].length; k++) { const [p, i] = src[t][k]; const s = q * lay[p].per + lay[p][key] + 4 * nv * i; B[p].copy(out, o, s, s + 4 * nv);
          if (t === 'link' && rev.has(ids.link[k])) { out.writeFloatLE(-out.readFloatLE(o), o); if (nv > 2) out.writeFloatLE(-out.readFloatLE(o + 8), o + 8); }
          o += 4 * nv; } };
        copyObj('subcatch', nSV, 'sub'); copyObj('node', nNV, 'node'); copyObj('link', nLV, 'link');
        // system: sums, area averages, first sub-model; outflow without the flows through the cuts
        for (let v = 0; v < nYV; v++) {
          let x = 0;
          if (SYS_FIRST.has(v)) x = B[0].readFloatLE(q * lay[0].per + lay[0].sys + 4 * v);
          else if (SYS_AREA.has(v)) { for (let p = 0; p < P.length; p++) x += B[p].readFloatLE(q * lay[p].per + lay[p].sys + 4 * v) * (totArea > 0 ? subArea[p] / totArea : 1 / P.length); }
          else for (let p = 0; p < P.length; p++) x += B[p].readFloatLE(q * lay[p].per + lay[p].sys + 4 * v);
          if (v === SYS_OUTFLOW) for (const c of cplLinks) if (c) x -= B[c[0]].readFloatLE(q * lay[c[0]].per + lay[c[0]].link + 4 * nLV * c[1]);
          out.writeFloatLE(x, o); o += 4;
        }
      }
      W(out);
    }
    // --- closing record
    W(i32(idPos, inputPos, outputPos, nPer, Math.max(...P.map(r => r.errorCode || 0)), MAGIC));
    fs.closeSync(fd);
    return { periods: nPer, nodes: ids.node.length, links: ids.link.length, subcatchments: ids.subcatch.length };
  } finally { for (const r of P) r.close(); }
}

// ------------------------------------------------------------------ report
function splitBlocks(text) {
  // header lines, then blocks that start with   ****** / Title / ******
  const lines = text.replace(/\r/g, '').split('\n'); const blocks = []; let cur = { title: '', lines: [] }; const head = cur;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+\*{5,}/.test(lines[i]) && i + 2 < lines.length && /^\s+\*{5,}/.test(lines[i + 2]) && lines[i + 1].trim()) {
      cur = { title: lines[i + 1].trim().split(/\s{2,}/)[0], lines: [lines[i], lines[i + 1], lines[i + 2]] }; blocks.push(cur); i += 2; continue;
    }
    cur.lines.push(lines[i]);
  }
  return { head: head.lines, blocks };
}
const num = (s) => { const v = parseFloat(s); return isFinite(v) ? v : 0; };

function mergeContinuity(blocks, cplVol, routing) {
  // rows "  Label .....   v1   v2"
  const B0 = blocks[0]; const rows = []; const re = /^(\s+[A-Za-z][^.]*?\.{2,})\s+(.*)$/;
  for (const line of B0.lines) { const m = re.exec(line); if (m) rows.push({ label: m[1], key: m[1].replace(/\.+$/, '').trim(), vals: m[2].trim().split(/\s+/).map(num), n: m[2].trim().split(/\s+/).length }); }
  for (const r of rows) r.vals = r.vals.map(() => 0);
  let area = 0, hasDepth = false;
  for (const b of blocks) for (const line of b.lines) { const m = re.exec(line); if (!m) continue; const key = m[1].replace(/\.+$/, '').trim(); const r = rows.find(x => x.key === key); if (!r) continue;
    const v = m[2].trim().split(/\s+/).map(num); v.forEach((x, i) => { if (i < r.vals.length) r.vals[i] += x; });
    if (!routing && /Precipitation/.test(key) && v[1] > 0) { area += v[0] / v[1]; hasDepth = true; } }
  if (!routing && hasDepth && area > 0) for (const r of rows) if (r.vals.length > 1 && !/Error/.test(r.key)) r.vals[1] = r.vals[0] / area;
  if (routing && cplVol) for (const r of rows) { const v = r.key === 'External Inflow' ? cplVol.in : r.key === 'External Outflow' ? cplVol.out : null; if (v) r.vals = r.vals.map((x, i) => Math.max(0, x - v[i])); }
  // continuity error
  let inp = 0, out = 0;
  for (const r of rows) { if (/Error/.test(r.key)) continue; const x = r.vals[0];
    if (routing ? /Inflow|Initial Stored|Initial/.test(r.key) && !/Outflow/.test(r.key) : /Precipitation|Initial/.test(r.key)) inp += x; else out += x; }
  const err = inp > 0 ? 100 * (inp - out) / inp : 0;
  const res = B0.lines.slice(0, 3);
  for (const line of B0.lines.slice(3)) { const m = re.exec(line); if (!m) { if (!/^\s+Continuity Error/.test(line)) res.push(line); continue; }
    const r = rows.find(x => x.key === m[1].replace(/\.+$/, '').trim());
    if (/Error/.test(r.key)) res.push(m[1] + err.toFixed(3).padStart(14));
    else res.push(m[1] + r.vals.map(x => x.toFixed(3).padStart(14)).join('')); }
  return { lines: res, err };
}

function mergeReport(job, cplVolFt3) {
  const R = job.parts.map(p => { try { return splitBlocks(fs.readFileSync(p.rpt, 'latin1')); } catch (e) { return { head: [], blocks: [] }; } });
  const bnd = job.parts.map(() => new Set()); for (const c of job.couplings) bnd[c.up].add(c.outfall);
  const order = new Map(); for (const t of ['node', 'link', 'subcatch']) (job.order[t] || []).forEach((id, i) => { if (!order.has(id)) order.set(id, i); });
  const titles = []; for (const r of R) for (const b of r.blocks) if (!titles.includes(b.title)) titles.push(b.title);
  const us = job.usUnits;
  // coupled volume in the report units: [hectare-m | acre-ft, 10^6 ltr | 10^6 gal]
  const conv = (v) => us ? [v / 43560, v * 7.48052 / 1e6] : [v * 0.0283168 / 1e4, v * 28.3168 / 1e6];
  const cplVol = { in: conv(cplVolFt3[0] || 0), out: conv(cplVolFt3[1] !== undefined ? cplVolFt3[1] : cplVolFt3[0] || 0) };
  const out = [];
  // header: engine banner of the first sub-model, title of the master model
  const h0 = R[0].head; let k = 0; while (k < h0.length && !/^\s*$/.test(h0[k])) out.push(h0[k++]);
  out.push('');
  for (const t of job.title || []) out.push('  ' + t);
  out.push('  Coupled parallel run: ' + job.parts.length + ' sub-models, ' + job.couplings.length + ' cut points (results merged into the objects of the master model)');
  const warn = new Set(); for (const r of R) for (const l of r.head) if (/WARNING|ERROR/.test(l)) warn.add(l);
  if (warn.size) { out.push(''); for (const w of warn) out.push(w); }
  out.push('');
  let errs = { runoff: 0, flow: 0 };
  for (const title of titles) {
    const bl = R.map(r => r.blocks.find(b => b.title === title)).filter(Boolean);
    if (/Continuity/.test(title)) { const routing = !/Runoff/.test(title); const m = mergeContinuity(bl, /Flow Routing/.test(title) ? cplVol : null, routing); out.push(...m.lines);
      if (/Runoff Quantity/.test(title)) errs.runoff = m.err; if (/Flow Routing/.test(title)) errs.flow = m.err; continue; }
    if (/Analysis Options|Element Count|Routing Time Step Summary|Pollutant Summary|Landuse Summary|Raingage Summary/.test(title)) { out.push(...bl[0].lines); continue; }
    // lists "  Node J_1 (1.23%)"
    if (bl[0].lines.slice(3).some(l => /^\s+(Node|Link|Subcatchment)\s+\S+\s+\(/.test(l))) {
      const rows = []; R.forEach((r, p) => { const b = r.blocks.find(x => x.title === title); if (!b) return; for (const l of b.lines.slice(3)) { const m = /^\s+(Node|Link|Subcatchment)\s+(\S+)\s+\(([-\d.]+)/.exec(l); if (m && !bnd[p].has(m[2])) rows.push([num(m[3]), l]); } });
      rows.sort((a, b) => b[0] - a[0]); out.push(...bl[0].lines.slice(0, 3), ...rows.slice(0, 50).map(r => r[1]), '', ''); continue;
    }
    // object tables: header up to the last dashed line, then one row per object
    const tb = bl.map(b => { let n = 0; for (let i = 3; i < Math.min(b.lines.length, 20); i++) if (/^\s+-{10,}/.test(b.lines[i]) && ++n === 2) return i; return -1; });
    const first = tb.findIndex(d => d >= 0);
    if (first < 0) { out.push(...bl[0].lines); continue; }
    const rows = [];
    bl.forEach((b, j) => { const d = tb[j]; if (d < 0) return; const p = R.findIndex(r => r.blocks.includes(b));
      for (let i = d + 1; i < b.lines.length; i++) { const l = b.lines[i]; if (!l.trim()) break; if (/^\s+-{10,}/.test(l)) continue; const id = l.trim().split(/\s+/)[0];
        if (id === 'System' || bnd[p].has(id)) continue; rows.push([order.has(id) ? order.get(id) : 1e9, l]); } });
    rows.sort((a, b) => a[0] - b[0]);
    out.push(...bl[first].lines.slice(0, tb[first] + 1), ...rows.map(r => r[1]), '', '');
  }
  if (job.timing) out.push('', '  Analysis begun / ended: see the sub-model reports in ' + job.partsDir, '  Total elapsed time (coupled run): ' + job.timing);
  fs.writeFileSync(job.rpt, out.join('\n'), 'latin1');
  return errs;
}

module.exports = function mergeCoupled(job) {
  const t0 = Date.now();
  const o = mergeOut(job);
  const errs = mergeReport(job, [].concat(job.cplVolFt3 || 0));
  return Object.assign(o, { massBal: { runoff: errs.runoff, flow: errs.flow, quality: 0 }, mergeSeconds: (Date.now() - t0) / 1000 });
};
module.exports.splitBlocks = splitBlocks;
