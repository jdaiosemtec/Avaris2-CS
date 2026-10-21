// Avaris2 CS - Electron main process
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const OutReader = require('./outreader');
// large models (hundreds of MB of .inp): let the renderer use up to 4 GB of JS heap (the default follows the RAM size, often
// 2 GB, and a model near that limit spends most of its time in garbage collection)
try { app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096'); } catch (e) { }
try { app.commandLine.appendSwitch('enable-precise-memory-info'); } catch (e) { }
// settings, users and change history stay in the folder used before the rename to Avaris2 CS (shared with OsemCM V1.0)
try { app.setPath('userData', path.join(app.getPath('appData'), 'OsemCM')); } catch (e) { }

let win = null;
let forceClose = false;
let engineProc = null; // last started engine (single run)
const engineProcs = new Map(); // job id -> engine process (several scenarios run at the same time)
const outFiles = new Map();   // handle -> OutReader
let outHandleSeq = 1;

function enginePath() {
  const exe = process.platform === 'win32' ? 'avaris_engine.exe' : 'avaris_engine';
  const sub = process.platform === 'win32' ? 'win' : 'linux';
  const candidates = [
    path.join(process.resourcesPath || '', 'engine', exe),
    path.join(__dirname, 'engine', sub, exe),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return candidates[candidates.length - 1];
}

function samplesDir() {
  const c = [path.join(process.resourcesPath || '', 'samples'), path.join(__dirname, 'samples')];
  for (const d of c) if (d && fs.existsSync(d)) return d;
  return c[1];
}

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { return { recent: [] }; }
}
function saveSettings(s) {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); } catch (e) {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1000, minHeight: 640,
    title: 'Avaris2 CS',
    backgroundColor: '#1e2329',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (!forceClose) { e.preventDefault(); win.webContents.send('app:request-close'); }
  });
  win.on('closed', () => { win = null; });
  const fileArg = process.argv.slice(1).find(a => /\.inp$/i.test(a));
  if (fileArg) win.webContents.once('did-finish-load', () => win.webContents.send('app:open-file', path.resolve(fileArg)));
}

// basemap tiles: avtile://t/<source>/<z>/<x>/<y>.png?u=<tile url>, served from <userData>/tiles when cached (refreshed after
// 30 days when online), otherwise downloaded once and saved; a cached tile is used when the download fails (offline)
try { protocol.registerSchemesAsPrivileged([{ scheme: 'avtile', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]); } catch (e) { }
function tileHandler() {
  protocol.handle('avtile', async (req) => {
    const u = new URL(req.url); const parts = u.pathname.split('/').filter(Boolean); const web = u.searchParams.get('u') || '';
    const ok = parts.length === 4 && parts.every(p => /^[\w.-]+$/.test(p)) && /^https:\/\//.test(web);
    if (!ok) return new Response('bad tile', { status: 400 });
    const file = path.join(app.getPath('userData'), 'tiles', ...parts);
    let st = null; try { st = fs.statSync(file); } catch (e) { }
    const fresh = st && (Date.now() - st.mtimeMs < 30 * 86400e3);
    const send = (buf) => new Response(buf, { headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' } });
    if (fresh) return send(fs.readFileSync(file));
    try {
      const r = await net.fetch(web, { headers: { 'User-Agent': 'Avaris2CS/' + app.getVersion() + ' (osemtec.com)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); } catch (e) { }
      return send(buf);
    } catch (e) { if (st) return send(fs.readFileSync(file)); return new Response('offline', { status: 504 }); }
  });
}
app.whenReady().then(() => { try { tileHandler(); } catch (e) { } createWindow(); });
app.on('window-all-closed', () => {
  for (const p of engineProcs.values()) try { p.kill(); } catch (e) {}
  app.quit();
});

// ---------------------------------------------------------------- dialogs / files
ipcMain.handle('dlg:open', async (e, opts) => {
  const r = await dialog.showOpenDialog(win, { properties: [opts.folder ? 'openDirectory' : 'openFile'].concat(opts.multi ? ['multiSelections'] : []).concat(opts.folder ? ['createDirectory'] : []), filters: opts.filters || [], title: opts.title, defaultPath: opts.defaultPath });
  if (r.canceled) return null;
  return opts.multi ? r.filePaths : r.filePaths[0];
});
ipcMain.handle('dlg:save', async (e, opts) => {
  const r = await dialog.showSaveDialog(win, { filters: opts.filters || [], title: opts.title, defaultPath: opts.defaultPath });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('dlg:message', async (e, opts) => {
  const r = await dialog.showMessageBox(win, opts);
  return r.response;
});
// text files: decode as UTF-8 when valid (Chinese IDs/titles), otherwise byte-preserving latin1
const fileEnc = new Map();
function decodeText(buf) {
  try { const t = new TextDecoder('utf-8', { fatal: true }).decode(buf); return { text: t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t, enc: 'utf8' }; }
  catch (e) { return { text: buf.toString('latin1'), enc: 'latin1' }; }
}
ipcMain.handle('fs:readText', async (e, p) => { const r = decodeText(await fs.promises.readFile(p)); fileEnc.set(path.resolve(p), r.enc); return r.text; });
ipcMain.handle('fs:encoding', async (e, p) => fileEnc.get(path.resolve(p)) || 'utf8');
ipcMain.handle('fs:writeText', async (e, p, text, enc) => {
  enc = enc || fileEnc.get(path.resolve(p)) || (/[^\x00-\xff]/.test(text) ? 'utf8' : 'latin1');
  if (enc === 'latin1' && /[^\x00-\xff]/.test(text)) enc = 'utf8';
  await fs.promises.writeFile(p, text, enc); fileEnc.set(path.resolve(p), enc); return true;
});
ipcMain.handle('fs:readBinary', async (e, p) => { const b = await fs.promises.readFile(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
ipcMain.handle('fs:writeBinary', async (e, p, data) => { await fs.promises.writeFile(p, Buffer.from(data)); return true; });
ipcMain.handle('fs:exists', async (e, p) => fs.existsSync(p));
ipcMain.handle('app:info', async () => ({
  version: app.getVersion(), platform: process.platform, samples: samplesDir(),
  engine: enginePath(), cpus: os.cpus().length, docs: app.getPath('documents'), temp: os.tmpdir(),
  osUser: (() => { try { return os.userInfo().username; } catch (e) { return ''; } })(), host: os.hostname(),
}));
// user accounts (login / roles) - stored per computer in the app data folder
const usersFile = () => path.join(app.getPath('userData'), 'users.json');
ipcMain.handle('app:users:get', async () => { try { return JSON.parse(fs.readFileSync(usersFile(), 'utf8')); } catch (e) { return null; } });
ipcMain.handle('app:hash', async (e, pw, salt) => { const c = require('crypto'); if (!salt) salt = c.randomBytes(16).toString('hex'); return { salt, hash: c.pbkdf2Sync(String(pw), salt, 120000, 32, 'sha256').toString('hex') }; });
ipcMain.handle('app:users:set', async (e, u) => { fs.mkdirSync(path.dirname(usersFile()), { recursive: true }); fs.writeFileSync(usersFile(), JSON.stringify(u, null, 2)); return true; });
// ---------------------------------------------------------------- licence (offline Ed25519-signed, bound to the computer)
// key = AV2L-<base64url JSON>.<base64url Ed25519 signature>
//   JSON {v:2, ed:'1D'|'2D', term:'30d'|'1y'|'<n>y', user (osemtec.com account), name, company, email, iss, exp 'YYYY-MM-DD',
//         ser, mc (machine code), hw:{g, v, m:[...]}}
// The computer is identified by three hashed parts: Windows MachineGuid (g), system volume serial (v) and the physical
// network adapters (m). A licence stays valid while at least 2 of the 3 still match (new dock / VPN adapter, Wi-Fi vs LAN).
const crypto = require('crypto');
const LIC_PUB = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAY6AEfM7kFpdG4rajIfIEUwJA7Iw7nGIgUovmv9x++2g=\n-----END PUBLIC KEY-----\n';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hpart = (tag, val) => crypto.createHash('sha256').update('avaris2|' + tag + '|' + String(val).trim().toLowerCase()).digest('hex').slice(0, 16);
let machineCache = null;
function machineInfo() {
  if (machineCache) return machineCache;
  const { execFileSync } = require('child_process'); const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 }); } catch (e) { return ''; } };
  let guid = '', vol = '';
  if (process.platform === 'win32') {
    const r = run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']); const m = /MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i.exec(r); guid = m ? m[1] : '';
    const sys = (process.env.SystemDrive || 'C:'); const v = run('cmd', ['/c', 'vol', sys]); const mv = /([0-9A-F]{4}-[0-9A-F]{4})\s*$/im.exec(v); vol = mv ? mv[1] : '';
  } else {
    try { guid = fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch (e) { guid = ''; }
    vol = os.hostname();
  }
  const VIRT = /virtual|vmware|vbox|virtualbox|hyper-v|vethernet|docker|wsl|loopback|bluetooth|tap|tun|vpn|miniport|npcap|zerotier|tailscale|wireguard|clash|utun|veth|br-|virbr/i;
  const macs = new Set();
  for (const [name, list] of Object.entries(os.networkInterfaces())) { if (VIRT.test(name)) continue; for (const a of list || []) { if (a.internal || !a.mac || /^(00:){5}00$/.test(a.mac)) continue; const first = parseInt(a.mac.slice(0, 2), 16); if (first & 2) continue; macs.add(a.mac.toLowerCase()); } }
  const hw = { g: guid ? hpart('g', guid) : '', v: vol ? hpart('v', vol) : '', m: [...macs].sort().map(x => hpart('m', x)).slice(0, 6) };
  const digest = crypto.createHash('sha256').update([hw.g, hw.v, hw.m[0] || ''].join('|')).digest();
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code = ''; for (let i = 0; i < 16; i++) code += A[digest[i] % 32];
  machineCache = { code: 'AV2-' + code.match(/.{4}/g).join('-'), hw, host: os.hostname(), os: os.type() + ' ' + os.release() };
  return machineCache;
}
function hwMatches(lic, cur) { let n = 0; if (lic.g && lic.g === cur.g) n++; if (lic.v && lic.v === cur.v) n++; if ((lic.m || []).some(x => cur.m.includes(x))) n++; return n; }
// last date the program ran, so a clock set back cannot extend a licence
const licStateFile = () => path.join(app.getPath('userData'), 'licstate.json');
function clockCheck() {
  let st = {}; try { st = JSON.parse(fs.readFileSync(licStateFile(), 'utf8')); } catch (e) { }
  const now = Date.now(); const last = +st.last || 0; const back = last && now < last - 2 * 86400e3;
  if (!back && now > last) { try { fs.mkdirSync(path.dirname(licStateFile()), { recursive: true }); fs.writeFileSync(licStateFile(), JSON.stringify({ last: now })); } catch (e) { } }
  return { back, last };
}
function verifyLicence(raw) {
  const out = { valid: false, edition: null, licensee: '', user: '', company: '', expiry: '', serial: '', issued: '', term: '', daysLeft: null, error: '', machine: machineInfo().code };
  const key = String(raw || '').replace(/\s+/g, ''); if (!key) { out.error = 'No licence.'; return out; }
  const m = /^AV2L-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key); if (!m) { out.error = 'This is not an Avaris2 CS licence key.'; return out; }
  const payload = unb64u(m[1]); let ok = false;
  try { ok = crypto.verify(null, payload, crypto.createPublicKey(LIC_PUB), unb64u(m[2])); } catch (e) { ok = false; }
  if (!ok) { out.error = 'The licence key is not valid (signature check failed).'; return out; }
  let L; try { L = JSON.parse(payload.toString('utf8')); } catch (e) { out.error = 'The licence key is damaged.'; return out; }
  if (L.v !== 2 || !['1D', '2D'].includes(L.ed)) { out.error = 'Unsupported licence version.'; return out; }
  Object.assign(out, { edition: L.ed, licensee: L.name || '', user: L.user || '', company: L.company || '', expiry: L.exp || '', serial: L.ser || '', issued: L.iss || '', term: L.term || '', licMachine: L.mc || '' });
  if (hwMatches(L.hw || {}, machineInfo().hw) < 2) { out.error = 'This licence was issued for another computer (' + (L.mc || '?') + '). This computer: ' + machineInfo().code + '.'; out.wrongMachine = true; return out; }
  const ck = clockCheck(); if (ck.back) { out.error = 'The computer clock is set earlier than the last time Avaris2 CS was used. Correct the date and time, then restart.'; out.clock = true; return out; }
  if (out.expiry) { const end = new Date(out.expiry + 'T23:59:59'); out.daysLeft = Math.floor((end - Date.now()) / 86400e3); if (end < new Date()) { out.error = 'The licence expired on ' + out.expiry + '.'; out.expired = true; return out; } }
  out.valid = true; return out;
}
ipcMain.handle('license:verify', async (e, key) => verifyLicence(key));
ipcMain.handle('license:machine', async () => machineInfo());
// ---- direct licence request (optional). Licences are issued with tools/licence-manager (OSEMTEC only), never here.
// With a Web3Forms access key (web3forms.com, registered to info@osemtec.com) the request is posted straight to OSEMTEC;
// without one the Register dialog offers web-mail / e-mail program / copy / save only.
const LIC_FORM_KEY = '';
ipcMain.handle('license:canSubmit', async () => !!LIC_FORM_KEY);
ipcMain.handle('license:submit', async (e, q) => {
  if (!LIC_FORM_KEY) throw new Error('direct sending is not set up');
  const r = await net.fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ access_key: LIC_FORM_KEY, subject: q.subject, from_name: 'Avaris2 CS - ' + q.user, email: q.email, replyto: q.email, message: q.body }) });
  let j = {}; try { j = await r.json(); } catch (err) { }
  if (!r.ok || j.success === false) throw new Error(j.message || ('HTTP ' + r.status));
  return true;
});
ipcMain.handle('app:settings:get', async () => loadSettings());
// ---- file browsing for the Catalog pane
ipcMain.handle('fs:list', async (e, dir) => {
  const out = [];
  for (const d of await fs.promises.readdir(dir, { withFileTypes: true })) {
    let size = 0, mtime = 0, isDir = d.isDirectory();
    try { const st = await fs.promises.stat(path.join(dir, d.name)); size = st.size; mtime = st.mtimeMs; isDir = st.isDirectory(); } catch (err) { }
    out.push({ name: d.name, dir: isDir, size, mtime });
  }
  return out;
});
ipcMain.handle('fs:drives', async () => {
  if (process.platform !== 'win32') return ['/'];
  const out = []; for (let c = 65; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; try { await fs.promises.access(d); out.push(d); } catch (err) { } } return out;
});
ipcMain.handle('app:paths', async () => {
  const g = (k) => { try { return app.getPath(k); } catch (err) { return null; } };
  return { home: g('home'), documents: g('documents'), desktop: g('desktop'), downloads: g('downloads'), userData: g('userData') };
});
// minimal zip reader (KMZ, zipped shapefiles): returns [{name, data(ArrayBuffer)}]
ipcMain.handle('zip:read', async (e, p) => {
  const zlib = require('zlib'); const b = await fs.promises.readFile(p);
  let eo = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error('Not a zip file');
  const n = b.readUInt16LE(eo + 10); let cd = b.readUInt32LE(eo + 16); const out = [];
  for (let k = 0; k < n; k++) {
    const method = b.readUInt16LE(cd + 10), csize = b.readUInt32LE(cd + 20), nl = b.readUInt16LE(cd + 28), xl = b.readUInt16LE(cd + 30), cl = b.readUInt16LE(cd + 32), lo = b.readUInt32LE(cd + 42);
    const name = b.slice(cd + 46, cd + 46 + nl).toString('utf8'); cd += 46 + nl + xl + cl;
    const lnl = b.readUInt16LE(lo + 26), lxl = b.readUInt16LE(lo + 28); const raw = b.slice(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + csize);
    if (name.endsWith('/')) continue;
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    out.push({ name, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
  }
  return out;
});
// ---- bundled GDAL vector tools (ogrinfo / ogr2ogr, static build) for File Geodatabase read and write
function gdalDir() {
  const c = [path.join(process.resourcesPath || '', 'gdal'), path.join(__dirname, 'gdal', process.platform === 'win32' ? 'win' : 'linux'), process.env.OSEM_GDAL_DIR || ''];
  for (const d of c) if (d && fs.existsSync(path.join(d, process.platform === 'win32' ? 'ogr2ogr.exe' : 'ogr2ogr'))) return d;
  return null;
}
ipcMain.handle('gdal:available', async () => !!gdalDir());
ipcMain.handle('gdal:run', async (e, tool, args) => {
  const d = gdalDir(); if (!d) throw new Error('The GDAL tools are not installed with this copy of Avaris2 CS.');
  if (!['ogrinfo', 'ogr2ogr'].includes(tool)) throw new Error('bad tool');
  const exe = path.join(d, tool + (process.platform === 'win32' ? '.exe' : ''));
  const env = Object.assign({}, process.env, { PROJ_DATA: path.join(d, 'proj'), PROJ_LIB: path.join(d, 'proj'), GDAL_DATA: path.join(d, 'gdal-data'), PROJ_NETWORK: 'OFF', CPL_LOG: '' });
  return await new Promise((resolve) => {
    const p = spawn(exe, args, { env, windowsHide: true }); const out = [], err = [];
    p.stdout.on('data', (b) => out.push(b)); p.stderr.on('data', (b) => err.push(b));
    p.on('error', (x) => resolve({ code: -1, stdout: '', stderr: String(x.message || x) }));
    p.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
  });
});
ipcMain.handle('app:tempDir', async () => { const d = path.join(os.tmpdir(), 'osemcm-' + process.pid + '-' + Date.now()); await fs.promises.mkdir(d, { recursive: true }); return d; });
ipcMain.handle('fs:rm', async (e, p) => { if (!/osemcm-/.test(p) && !/\.gdb[\\/]?$/i.test(p)) throw new Error('refused'); await fs.promises.rm(p, { recursive: true, force: true }); return true; });
ipcMain.handle('fs:mkdir', async (e, p) => { await fs.promises.mkdir(p, { recursive: true }); return true; });
// copy a bundled sample into Documents\Avaris\Samples so it can be run and saved
ipcMain.handle('app:prepareSample', async (e, name) => {
  const dst = path.join(app.getPath('documents'), 'Avaris2 CS', 'Samples');
  fs.mkdirSync(dst, { recursive: true });
  const target = path.join(dst, name);
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(samplesDir(), name), target);
  return target;
});
ipcMain.handle('app:settings:set', async (e, s) => { saveSettings(s); return true; });
ipcMain.handle('app:openExternal', async (e, url) => { await shell.openExternal(url); return true; });
// third-party notices text for Help > About (installed file, or the repository copy plus the GDAL / PROJ licences in development)
ipcMain.handle('app:noticesText', async () => {
  const inst = path.join(path.dirname(process.execPath), 'THIRD-PARTY-NOTICES.txt');
  try { if (fs.existsSync(inst)) return fs.readFileSync(inst, 'utf8'); } catch (e) { }
  try {
    const rd = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
    return rd(path.join(__dirname, '..', 'installer', 'THIRD-PARTY-NOTICES.txt')) + '\n\nGDAL LICENCE\n============\n\n' + rd(path.join(__dirname, 'gdal', 'win', 'GDAL-LICENSE.txt')) + '\n\nPROJ LICENCE\n============\n\n' + rd(path.join(__dirname, 'gdal', 'win', 'PROJ-LICENSE.txt'));
  } catch (e) { return ''; }
});
ipcMain.handle('app:showItem', async (e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.on('app:close-confirmed', () => { forceClose = true; if (win) win.close(); });
ipcMain.on('app:set-title', (e, t) => { if (win) win.setTitle(t); });

// ---------------------------------------------------------------- engine
ipcMain.handle('engine:version', async () => new Promise((resolve) => {
  try {
    const p = spawn(enginePath(), ['-v']);
    let s = ''; p.stdout.on('data', d => s += d); p.on('close', () => resolve('Avaris hydraulic engine, build ' + ((/(\d+\.\d+\.\d+)/.exec(s) || [])[1] || '') + '-A2')); p.on('error', err => resolve('Engine not found: ' + err.message));
  } catch (err) { resolve('Engine not found'); }
}));

ipcMain.handle('engine:run', async (e, job) => {
  // job: { inpText, dir, base, detail }
  let dir = job.dir && fs.existsSync(job.dir) ? job.dir : path.join(os.tmpdir(), 'avaris');
  // fall back to a temp folder when the model folder is not writable (e.g. Program Files)
  try { const probe = path.join(dir, '.avaris_write_test'); fs.writeFileSync(probe, ''); fs.unlinkSync(probe); }
  catch (err) { dir = path.join(os.tmpdir(), 'avaris'); }
  fs.mkdirSync(dir, { recursive: true });
  const base = (job.base || 'model').replace(/[^\w\-. ]/g, '_');
  // 2D runs use the Avaris DS file names: <model>.finp / .frpt / .fout. Named runs (results folder of the model)
  // keep the engine input as <run>.inp next to <run>.rpt / <run>.out.
  const f2 = !!job.flood2d; const jobId = job.id || 'main';
  const inp = path.join(dir, base + (f2 ? '.finp' : job.named ? '.inp' : '.run.inp'));
  const rpt = path.join(dir, base + (f2 ? '.frpt' : '.rpt'));
  const out = path.join(dir, base + (f2 ? '.fout' : '.out'));
  // release any open handle on the old output file (Windows file locking)
  for (const [h, r] of outFiles) if (path.resolve(r.file) === path.resolve(out)) { r.close(); outFiles.delete(h); }
  fs.writeFileSync(inp, job.inpText, job.encoding === 'latin1' && !/[^\x00-\xff]/.test(job.inpText) ? 'latin1' : 'utf8');
  return new Promise((resolve) => {
    let buf = '', result = { code: -1, errors: [], rpt, out, inp, massBal: null, seconds: 0, canceled: false };
    try {
      engineProc = spawn(enginePath(), [inp, rpt, out].concat(job.detail ? [] : ['-nodetail']), { cwd: dir, windowsHide: true }); engineProcs.set(jobId, engineProc);
    } catch (err) {
      result.errors.push('Unable to start engine: ' + err.message); resolve(result); return;
    }
    const handleLine = (line) => {
      if (line.startsWith('PROGRESS ')) { if (win) win.webContents.send('engine:progress', parseFloat(line.slice(9)), jobId); }
      else if (line.startsWith('ERROR ')) result.errors.push(line.slice(6));
      else if (line.startsWith('DONE ')) {
        const t = line.split(/\s+/);
        result.code = parseInt(t[1]);
        result.massBal = { runoff: parseFloat(t[2]), flow: parseFloat(t[3]), quality: parseFloat(t[4]) };
        result.seconds = parseFloat(t[5]);
      }
    };
    const proc = engineProc;
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i; while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    });
    proc.on('error', (err) => { result.errors.push('Engine error: ' + err.message); });
    proc.on('close', (code, signal) => {
      if (buf.trim()) handleLine(buf.trim());
      // the report starts directly with the analysis (no engine banner)
      try { const t = fs.readFileSync(rpt, 'latin1'); const t2 = t.replace(/^\s*OSEMCM HYDRAULIC ENGINE[^\n]*\n[^\n]*EPA SWMM[^\n]*\n\s*-{10,}\s*\n/, ''); if (t2 !== t) fs.writeFileSync(rpt, t2, 'latin1'); } catch (e) { }
      if (signal) result.canceled = true;
      if (result.code === -1 && !signal) result.code = code;
      if (engineProcs.get(jobId) === proc) engineProcs.delete(jobId); if (engineProc === proc) engineProc = null;
      resolve(result);
    });
  });
});
ipcMain.handle('engine:cancel', async (e, id) => { let n = 0; for (const [k, p] of engineProcs) if (!id || k === id) { try { p.kill(); n++; } catch (err) { } } return n > 0; });
// processor information for the thread recommendation (physical cores from Windows when available)
ipcMain.handle('sys:cpu', async () => {
  const logical = os.cpus().length; let physical = null;
  if (process.platform === 'win32') physical = await new Promise((resolve) => { try { const p = spawn('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum'], { windowsHide: true }); let s = ''; const t = setTimeout(() => { try { p.kill(); } catch (e) { } resolve(null); }, 6000); p.stdout.on('data', d => s += d); p.on('close', () => { clearTimeout(t); const n = parseInt(s.trim()); resolve(n > 0 ? n : null); }); p.on('error', () => { clearTimeout(t); resolve(null); }); } catch (e) { resolve(null); } });
  return { logical, physical, model: (os.cpus()[0] || {}).model || '', memGB: Math.round(os.totalmem() / 1073741824) };
});
// simulation results of a model live in <model>_Results; only files there may be deleted / renamed from the Database panel
const inResults = (p) => /_Results[\\/][^\\/]+$/i.test(p);
ipcMain.handle('fs:rmRun', async (e, files) => { for (const f of files) if (inResults(f)) { try { await fs.promises.unlink(f); } catch (err) { } } return true; });
ipcMain.handle('fs:renameRun', async (e, pairs) => { for (const [a, b] of pairs) { if (!inResults(a) || !inResults(b)) throw new Error('refused'); if (fs.existsSync(a)) await fs.promises.rename(a, b); } return true; });

// ---------------------------------------------------------------- binary results
ipcMain.handle('out:open', async (e, file) => {
  const r = new OutReader(file);
  const h = outHandleSeq++;
  outFiles.set(h, r);
  return Object.assign({ handle: h }, r.meta());
});
ipcMain.handle('out:close', async (e, h) => { const r = outFiles.get(h); if (r) { r.close(); outFiles.delete(h); } return true; });
ipcMain.handle('out:series', async (e, h, type, index, v) => outFiles.get(h).series(type, index, v));
ipcMain.handle('out:snapshot', async (e, h, period, type, v) => outFiles.get(h).snapshot(period, type, v));
ipcMain.handle('out:stats', async (e, h, type, v) => outFiles.get(h).stats(type, v));
ipcMain.handle('out:snapshotAll', async (e, h, period, type) => outFiles.get(h).snapshotAll(period, type));
ipcMain.handle('out:statsAll', async (e, h) => outFiles.get(h).statsAll());
ipcMain.handle('out:pondStats', async (e, h, idx, thr) => outFiles.get(h).pondStats(idx, thr));
