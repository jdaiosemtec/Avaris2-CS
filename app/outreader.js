// SWMM 5.x / Avaris binary output (.out) reader - random access, low memory.
'use strict';
const fs = require('fs');

const MAGIC = 516114522;
const TYPES = ['subcatch', 'node', 'link', 'system'];

class OutReader {
  constructor(file) {
    this.file = file;
    this.fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(this.fd).size;
    if (size < 64) throw new Error('Output file is empty or incomplete.');
    const head = this._read(0, 28);
    const magic1 = head.readInt32LE(0);
    if (magic1 !== MAGIC) throw new Error('Not a valid SWMM/Avaris binary output file.');
    this.version = head.readInt32LE(4);
    this.flowUnits = head.readInt32LE(8);
    this.nSub = head.readInt32LE(12);
    this.nNode = head.readInt32LE(16);
    this.nLink = head.readInt32LE(20);
    this.nPoll = head.readInt32LE(24);
    const tail = this._read(size - 24, 24);
    this.idPos = tail.readInt32LE(0);
    this.inputPos = tail.readInt32LE(4);
    this.outputPos = tail.readInt32LE(8);
    this.nPeriods = tail.readInt32LE(12);
    this.errorCode = tail.readInt32LE(16);
    if (tail.readInt32LE(20) !== MAGIC) throw new Error('Output file is incomplete (run may have failed).');

    // --- IDs
    const idBuf = this._read(this.idPos, this.inputPos - this.idPos);
    let p = 0;
    const readIds = (n) => {
      const a = new Array(n);
      for (let i = 0; i < n; i++) { const len = idBuf.readInt32LE(p); p += 4; a[i] = idBuf.toString('latin1', p, p + len); p += len; }
      return a;
    };
    this.ids = { subcatch: readIds(this.nSub), node: readIds(this.nNode), link: readIds(this.nLink), pollut: readIds(this.nPoll) };
    this.pollUnits = [];
    for (let i = 0; i < this.nPoll; i++) { this.pollUnits.push(idBuf.readInt32LE(p)); p += 4; }

    // --- input properties & variable codes
    // subcatch: 1 prop (area); nodes: 3 (type, invert, max depth); links: 5 (type, off1, off2, max depth, length)
    let q = this.inputPos;
    const ib = this._read(q, Math.min(size - q, 1 << 20));
    let o = 0;
    const nSubProps = ib.readInt32LE(o); o += 4 * (1 + nSubProps);
    this.subArea = new Float32Array(this.nSub);
    // read the input properties with a fresh positioned read (could exceed 1MB for large models)
    let pos = this.inputPos + o;
    const sb = this._read(pos, 4 * nSubProps * this.nSub);
    for (let i = 0; i < this.nSub; i++) this.subArea[i] = sb.readFloatLE(4 * i * nSubProps);
    pos += 4 * nSubProps * this.nSub;
    const nNodeProps = this._read(pos, 4).readInt32LE(0); pos += 4 * (1 + nNodeProps);
    const nb = this._read(pos, 4 * nNodeProps * this.nNode);
    this.nodeType = new Int8Array(this.nNode); this.nodeInvert = new Float32Array(this.nNode); this.nodeMaxDepth = new Float32Array(this.nNode);
    for (let i = 0; i < this.nNode; i++) {
      this.nodeType[i] = nb.readFloatLE(4 * (i * nNodeProps)); this.nodeInvert[i] = nb.readFloatLE(4 * (i * nNodeProps + 1)); this.nodeMaxDepth[i] = nb.readFloatLE(4 * (i * nNodeProps + 2));
    }
    pos += 4 * nNodeProps * this.nNode;
    const nLinkProps = this._read(pos, 4).readInt32LE(0); pos += 4 * (1 + nLinkProps);
    const lb = this._read(pos, 4 * nLinkProps * this.nLink);
    this.linkType = new Int8Array(this.nLink); this.linkOff1 = new Float32Array(this.nLink); this.linkOff2 = new Float32Array(this.nLink);
    this.linkMaxDepth = new Float32Array(this.nLink); this.linkLength = new Float32Array(this.nLink);
    for (let i = 0; i < this.nLink; i++) {
      const b = 4 * i * nLinkProps;
      this.linkType[i] = lb.readFloatLE(b); this.linkOff1[i] = lb.readFloatLE(b + 4); this.linkOff2[i] = lb.readFloatLE(b + 8);
      this.linkMaxDepth[i] = lb.readFloatLE(b + 12); this.linkLength[i] = lb.readFloatLE(b + 16);
    }
    pos += 4 * nLinkProps * this.nLink;
    const readCodes = () => { const n = this._read(pos, 4).readInt32LE(0); pos += 4 * (1 + n); return n; };
    this.nSubVars = readCodes(); this.nNodeVars = readCodes(); this.nLinkVars = readCodes(); this.nSysVars = readCodes();
    const db = this._read(pos, 12);
    this.startDate = db.readDoubleLE(0);       // days since 12/30/1899
    this.reportStep = db.readInt32LE(8);       // seconds
    this.bytesPerPeriod = 8 + 4 * (this.nSub * this.nSubVars + this.nNode * this.nNodeVars + this.nLink * this.nLinkVars + this.nSysVars);
    this._statsCache = {};
  }

  _read(pos, len) {
    const b = Buffer.allocUnsafe(len);
    let got = 0;
    while (got < len) { const n = fs.readSync(this.fd, b, got, len - got, pos + got); if (n <= 0) break; got += n; }
    return b;
  }
  close() { try { fs.closeSync(this.fd); } catch (e) {} }

  _layout(type) {
    switch (type) {
      case 'subcatch': return { off: 8, n: this.nSub, nv: this.nSubVars };
      case 'node': return { off: 8 + 4 * this.nSub * this.nSubVars, n: this.nNode, nv: this.nNodeVars };
      case 'link': return { off: 8 + 4 * (this.nSub * this.nSubVars + this.nNode * this.nNodeVars), n: this.nLink, nv: this.nLinkVars };
      case 'system': return { off: 8 + 4 * (this.nSub * this.nSubVars + this.nNode * this.nNodeVars + this.nLink * this.nLinkVars), n: 1, nv: this.nSysVars };
    }
    throw new Error('bad type ' + type);
  }

  meta() {
    return {
      file: this.file, version: this.version, flowUnits: this.flowUnits, nPeriods: this.nPeriods,
      startDate: this.startDate, reportStep: this.reportStep, errorCode: this.errorCode,
      ids: this.ids, pollUnits: this.pollUnits,
      nVars: { subcatch: this.nSubVars, node: this.nNodeVars, link: this.nLinkVars, system: this.nSysVars },
      nodeInvert: this.nodeInvert, nodeMaxDepth: this.nodeMaxDepth, nodeType: this.nodeType,
      linkOff1: this.linkOff1, linkOff2: this.linkOff2, linkMaxDepth: this.linkMaxDepth, linkLength: this.linkLength, linkType: this.linkType,
    };
  }

  // time series of one variable for one object
  series(type, index, v) {
    const L = this._layout(type);
    const out = new Float32Array(this.nPeriods);
    const rel = L.off + 4 * (index * L.nv + v);
    // read in blocks of periods to limit syscalls
    const per = this.bytesPerPeriod;
    const blockPeriods = Math.max(1, Math.floor((8 << 20) / per));
    if (blockPeriods >= 4) {
      for (let p0 = 0; p0 < this.nPeriods; p0 += blockPeriods) {
        const np = Math.min(blockPeriods, this.nPeriods - p0);
        const b = this._read(this.outputPos + p0 * per, np * per);
        for (let k = 0; k < np; k++) out[p0 + k] = b.readFloatLE(k * per + rel);
      }
    } else {
      const b4 = Buffer.allocUnsafe(4);
      for (let p = 0; p < this.nPeriods; p++) { fs.readSync(this.fd, b4, 0, 4, this.outputPos + p * per + rel); out[p] = b4.readFloatLE(0); }
    }
    return out;
  }

  // values of one variable for all objects of a type at one period
  snapshot(period, type, v) {
    const L = this._layout(type);
    period = Math.max(0, Math.min(this.nPeriods - 1, period));
    const b = this._read(this.outputPos + period * this.bytesPerPeriod + L.off, 4 * L.n * L.nv);
    const out = new Float32Array(L.n);
    for (let i = 0; i < L.n; i++) out[i] = b.readFloatLE(4 * (i * L.nv + v));
    return out;
  }


  // selected variables of a type for a block of periods: Float32Array(np * vars.length * n), [period][var][object]
  // (time functions and surcharge read only what they need instead of whole snapshots)
  columns(p0, np, type, vars) {
    const L = this._layout(type); p0 = Math.max(0, p0); np = Math.max(0, Math.min(np, this.nPeriods - p0));
    const per = this.bytesPerPeriod; const out = new Float32Array(np * vars.length * L.n); if (!np || !L.n) return out;
    let b = this._read(this.outputPos + p0 * per, np * per); if (b.byteOffset % 4) b = Buffer.from(b);
    const f = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
    for (let q = 0; q < np; q++) { const base = (q * per + L.off) / 4;
      for (let k = 0; k < vars.length; k++) { const v = vars[k]; const o = (q * vars.length + k) * L.n; for (let i = 0; i < L.n; i++) out[o + i] = f[base + i * L.nv + v]; } }
    return out;
  }

  // all variables of a type at one period: Float32Array(n * nv), object-major
  snapshotAll(period, type) {
    const L = this._layout(type);
    period = Math.max(0, Math.min(this.nPeriods - 1, period));
    const b = this._read(this.outputPos + period * this.bytesPerPeriod + L.off, 4 * L.n * L.nv);
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }

  // one pass over the file: max, min, mean, |max| period for every object & variable of every type
  statsAll() {
    if (this._all) return this._all;
    const per = this.bytesPerPeriod;
    const res = {};
    const types = ['subcatch', 'node', 'link', 'system'];
    for (const t of types) {
      const L = this._layout(t); const N = L.n * L.nv;
      res[t] = { nv: L.nv, max: new Float32Array(N).fill(-Infinity), min: new Float32Array(N).fill(Infinity), mean: new Float32Array(N), tmax: new Int32Array(N), absmax: new Float32Array(N), _sum: new Float64Array(N), _off: L.off };
    }
    const blockPeriods = Math.max(1, Math.floor((32 << 20) / per));
    for (let p0 = 0; p0 < this.nPeriods; p0 += blockPeriods) {
      const np = Math.min(blockPeriods, this.nPeriods - p0);
      let b = this._read(this.outputPos + p0 * per, np * per);
      if (b.byteOffset % 4) b = Buffer.from(b);
      const f = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
      for (let k = 0; k < np; k++) {
        const base = (k * per) / 4;       // per is a multiple of 4
        for (const t of types) {
          const r = res[t]; const o = base + r._off / 4; const N = r.max.length;
          const mx = r.max, mn = r.min, sm = r._sum, am = r.absmax, tm = r.tmax;
          for (let i = 0; i < N; i++) {
            const x = f[o + i];
            if (x > mx[i]) mx[i] = x;
            if (x < mn[i]) mn[i] = x;
            sm[i] += x;
            const ax = x < 0 ? -x : x;
            if (ax > am[i]) { am[i] = ax; tm[i] = p0 + k; }
          }
        }
      }
    }
    for (const t of types) { const r = res[t]; for (let i = 0; i < r.mean.length; i++) r.mean[i] = this.nPeriods ? r._sum[i] / this.nPeriods : 0; delete r._sum; delete r._off; }
    this._all = res;
    return res;
  }

  // 2D flood statistics for a set of nodes (depth variable 0): hours above thr, hours from the peak until the depth
  // falls back to thr (to the end of the run when it never does)
  pondStats(idx, thr) {
    const L = this._layout('node'); const per = this.bytesPerPeriod; const n = idx.length; const dt = this.reportStep / 3600;
    const tpond = new Float32Array(n), trecede = new Float32Array(n), pk = new Float32Array(n).fill(-Infinity), tpk = new Int32Array(n), tdry = new Int32Array(n).fill(-1);
    const blockPeriods = Math.max(1, Math.floor((32 << 20) / per));
    for (let p0 = 0; p0 < this.nPeriods; p0 += blockPeriods) {
      const np = Math.min(blockPeriods, this.nPeriods - p0);
      let b = this._read(this.outputPos + p0 * per, np * per); if (b.byteOffset % 4) b = Buffer.from(b);
      const f = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
      for (let k = 0; k < np; k++) { const o = (k * per + L.off) / 4; const p = p0 + k;
        for (let j = 0; j < n; j++) { const d = f[o + idx[j] * L.nv];
          if (d > thr) tpond[j] += dt;
          if (d > pk[j]) { pk[j] = d; tpk[j] = p; tdry[j] = -1; } else if (tdry[j] < 0 && d <= thr && pk[j] > thr) tdry[j] = p; } }
    }
    for (let j = 0; j < n; j++) trecede[j] = pk[j] > thr ? ((tdry[j] < 0 ? this.nPeriods - 1 : tdry[j]) - tpk[j]) * dt : 0;
    return { tpond, trecede };
  }

  // max / min / mean / time-of-max for every object of a type, for one variable
  stats(type, v) {
    const key = type + ':' + v;
    if (this._statsCache[key]) return this._statsCache[key];
    const L = this._layout(type);
    const per = this.bytesPerPeriod;
    const max = new Float32Array(L.n).fill(-Infinity), min = new Float32Array(L.n).fill(Infinity);
    const sum = new Float64Array(L.n), tmax = new Int32Array(L.n), absmax = new Float32Array(L.n);
    const blockPeriods = Math.max(1, Math.floor((32 << 20) / per));
    for (let p0 = 0; p0 < this.nPeriods; p0 += blockPeriods) {
      const np = Math.min(blockPeriods, this.nPeriods - p0);
      const b = this._read(this.outputPos + p0 * per, np * per);
      for (let k = 0; k < np; k++) {
        const base = k * per + L.off + 4 * v;
        for (let i = 0; i < L.n; i++) {
          const x = b.readFloatLE(base + 4 * i * L.nv);
          if (x > max[i]) { max[i] = x; }
          if (x < min[i]) min[i] = x;
          const ax = Math.abs(x);
          if (ax > absmax[i]) { absmax[i] = ax; tmax[i] = p0 + k; }
          sum[i] += x;
        }
      }
    }
    const mean = new Float32Array(L.n);
    for (let i = 0; i < L.n; i++) mean[i] = this.nPeriods ? sum[i] / this.nPeriods : 0;
    const r = { max, min, mean, absmax, tmax };
    this._statsCache[key] = r;
    return r;
  }
}
module.exports = OutReader;
