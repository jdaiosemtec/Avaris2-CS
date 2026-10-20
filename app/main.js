// OsemCM - Electron main process
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const OutReader = require('./outreader');

let win = null;
let forceClose = false;
let engineProc = null;
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
    title: 'OsemCM',
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (engineProc) try { engineProc.kill(); } catch (e) {}
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
// ---------------------------------------------------------------- licence (offline Ed25519-signed keys)
// key = OSEMCM-<base64url payload>.<base64url signature>, payload = ver|edition(1D|2D)|licensee|expiry|serial|issued
const LIC_PUB = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAY6AEfM7kFpdG4rajIfIEUwJA7Iw7nGIgUovmv9x++2g=\n-----END PUBLIC KEY-----\n';
function verifyLicence(raw) {
  const out = { valid: false, edition: null, licensee: '', expiry: '', serial: '', issued: '', error: '' };
  const key = String(raw || '').replace(/\s+/g, ''); if (!key) { out.error = 'No licence key.'; return out; }
  const m = /^OSEMCM-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key); if (!m) { out.error = 'This is not an OsemCM licence key.'; return out; }
  const dec = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  let ok = false; const payload = dec(m[1]);
  try { ok = require('crypto').verify(null, payload, require('crypto').createPublicKey(LIC_PUB), dec(m[2])); } catch (e) { ok = false; }
  if (!ok) { out.error = 'The licence key is not valid (signature check failed).'; return out; }
  const f = payload.toString('utf8').split('|'); if (f[0] !== '1' || !['1D', '2D'].includes(f[1])) { out.error = 'Unsupported licence key version.'; return out; }
  Object.assign(out, { edition: f[1], licensee: f[2] || '', expiry: f[3] || '', serial: f[4] || '', issued: f[5] || '' });
  if (out.expiry && new Date(out.expiry + 'T23:59:59') < new Date()) { out.error = 'The licence expired on ' + out.expiry + '.'; return out; }
  out.valid = true; return out;
}
ipcMain.handle('license:verify', async (e, key) => verifyLicence(key));
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
  const d = gdalDir(); if (!d) throw new Error('The GDAL tools are not installed with this copy of OsemCM.');
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
  const dst = path.join(app.getPath('documents'), 'OsemCM', 'Samples');
  fs.mkdirSync(dst, { recursive: true });
  const target = path.join(dst, name);
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(samplesDir(), name), target);
  return target;
});
ipcMain.handle('app:settings:set', async (e, s) => { saveSettings(s); return true; });
ipcMain.handle('app:openExternal', async (e, url) => { await shell.openExternal(url); return true; });
ipcMain.handle('app:showItem', async (e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.on('app:close-confirmed', () => { forceClose = true; if (win) win.close(); });
ipcMain.on('app:set-title', (e, t) => { if (win) win.setTitle(t); });

// ---------------------------------------------------------------- engine
ipcMain.handle('engine:version', async () => new Promise((resolve) => {
  try {
    const p = spawn(enginePath(), ['-v']);
    let s = ''; p.stdout.on('data', d => s += d); p.on('close', () => resolve(s.trim())); p.on('error', err => resolve('Engine not found: ' + err.message));
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
  // 2D runs use the Avaris DS file names: <model>.finp / .frpt / .fout
  const f2 = !!job.flood2d;
  const inp = path.join(dir, base + (f2 ? '.finp' : '.run.inp'));
  const rpt = path.join(dir, base + (f2 ? '.frpt' : '.rpt'));
  const out = path.join(dir, base + (f2 ? '.fout' : '.out'));
  // release any open handle on the old output file (Windows file locking)
  for (const [h, r] of outFiles) if (path.resolve(r.file) === path.resolve(out)) { r.close(); outFiles.delete(h); }
  fs.writeFileSync(inp, job.inpText, job.encoding === 'latin1' && !/[^\x00-\xff]/.test(job.inpText) ? 'latin1' : 'utf8');
  return new Promise((resolve) => {
    let buf = '', result = { code: -1, errors: [], rpt, out, inp, massBal: null, seconds: 0, canceled: false };
    try {
      engineProc = spawn(enginePath(), [inp, rpt, out].concat(job.detail ? [] : ['-nodetail']), { cwd: dir, windowsHide: true });
    } catch (err) {
      result.errors.push('Unable to start engine: ' + err.message); resolve(result); return;
    }
    const handleLine = (line) => {
      if (line.startsWith('PROGRESS ')) { if (win) win.webContents.send('engine:progress', parseFloat(line.slice(9))); }
      else if (line.startsWith('ERROR ')) result.errors.push(line.slice(6));
      else if (line.startsWith('DONE ')) {
        const t = line.split(/\s+/);
        result.code = parseInt(t[1]);
        result.massBal = { runoff: parseFloat(t[2]), flow: parseFloat(t[3]), quality: parseFloat(t[4]) };
        result.seconds = parseFloat(t[5]);
      }
    };
    engineProc.stdout.on('data', (d) => {
      buf += d.toString();
      let i; while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    });
    engineProc.on('error', (err) => { result.errors.push('Engine error: ' + err.message); });
    engineProc.on('close', (code, signal) => {
      if (buf.trim()) handleLine(buf.trim());
      if (signal) result.canceled = true;
      if (result.code === -1 && !signal) result.code = code;
      engineProc = null;
      resolve(result);
    });
  });
});
ipcMain.handle('engine:cancel', async () => { if (engineProc) { engineProc.kill(); return true; } return false; });

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
