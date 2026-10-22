// VibeMTA launcher - fő folyamat
//   Kliens: a saját VibeMTA kliens (MTA fork) a GitHub legfrissebb kiadásából, alapból C:\VibeMTA\Kliens mappába.
//   AppData (%APPDATA%\VibeMTA): settings.json, themes\*.json (saját téma is tehető ide), launcher.log
//   Szerver állapot: ASE UDP lekérdezés (port + 123). Indítás: "Multi Theft Auto.exe" mtasa://host:port
const { app, BrowserWindow, ipcMain, shell, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const { spawn, execFile } = require('child_process');
const os = require('os');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const BUILTIN_THEMES = JSON.parse(fs.readFileSync(path.join(__dirname, 'themes.json'), 'utf8'));
const MTA_EXE = 'Multi Theft Auto.exe';
// szerverek: bal oldalt a fő szerver, jobb oldalt a localhost (config.json "servers")
const SERVERS = (Array.isArray(CONFIG.servers) && CONFIG.servers.length ? CONFIG.servers : [{ id: 'main', label: CONFIG.serverName, host: CONFIG.host, port: CONFIG.port }])
  .map((s, i) => ({ id: String(s.id || 'srv' + i), label: String(s.label || s.host), host: String(s.host), port: parseInt(s.port, 10) || 22003, password: s.password ? String(s.password) : '' }));
// mtasa:// cím; ha a szervernek jelszava van: mtasa://:jelszó@host:port (a becenév a kliens beállításából jön)
const serverUri = (s) => `mtasa://${s.password ? ':' + s.password + '@' : ''}${s.host}:${s.port}`;
const serverById = (id) => SERVERS.find((s) => s.id === id) || SERVERS[0];

let win;
let download = null; // { req, file, cancelled }

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// ---------------------------------------------------------------- AppData: beállítások, témák, napló
const DATA_DIR = path.join(app.getPath('appData'), 'VibeMTA');
const THEME_DIR = path.join(DATA_DIR, 'themes');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LOG_FILE = path.join(DATA_DIR, 'launcher.log');
app.setPath('userData', path.join(DATA_DIR, 'cache'));

function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }

function log(...a) {
  try {
    ensureDir(DATA_DIR);
    const line = `[${new Date().toISOString()}] ${a.map(String).join(' ')}\n`;
    fs.appendFileSync(LOG_FILE, line);
    const st = fs.statSync(LOG_FILE);
    if (st.size > 512 * 1024) fs.writeFileSync(LOG_FILE, fs.readFileSync(LOG_FILE, 'utf8').slice(-128 * 1024));
  } catch (e) {}
}

const DEFAULT_SETTINGS = {
  clientDir: CONFIG.defaultClientDir,
  theme: 'vibe',
  closeOnPlay: true,
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

let settings = Object.assign({}, DEFAULT_SETTINGS, readJson(SETTINGS_FILE, {}));
function saveSettings() { try { writeJsonAtomic(SETTINGS_FILE, settings); } catch (e) { log('settings save', e.message); } }

// a beépített témák kikerülnek az AppData témák mappájába (a felhasználó szerkesztheti / újat tehet mellé)
function syncThemes() {
  ensureDir(THEME_DIR);
  for (const t of BUILTIN_THEMES) {
    const f = path.join(THEME_DIR, t.id + '.json');
    if (!fs.existsSync(f)) { try { writeJsonAtomic(f, t); } catch (e) {} }
  }
}

const THEME_KEYS = ['accent', 'accent2', 'bg', 'panel', 'text', 'muted', 'glow1', 'glow2'];
function loadThemes() {
  syncThemes();
  const out = [];
  let files = [];
  try { files = fs.readdirSync(THEME_DIR).filter((f) => f.toLowerCase().endsWith('.json')); } catch (e) {}
  for (const f of files) {
    const t = readJson(path.join(THEME_DIR, f), null);
    if (!t || typeof t !== 'object') continue;
    const id = path.basename(f, '.json');
    const theme = { id, name: String(t.name || id).slice(0, 40) };
    let ok = true;
    for (const k of THEME_KEYS) {
      const v = String(t[k] || '');
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) { ok = false; break; }
      theme[k] = v;
    }
    if (ok) out.push(theme);
  }
  const order = BUILTIN_THEMES.map((t) => t.id);
  out.sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
  });
  return out.length ? out : BUILTIN_THEMES;
}

// ---------------------------------------------------------------- ablak
function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 620, resizable: false, maximizable: false, fullscreenable: false, frame: false,
    backgroundColor: '#0e0c12', show: false, title: CONFIG.serverName,
    icon: path.join(__dirname, 'logo_crop.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => { log('indul', app.getVersion()); createWindow(); });
app.on('window-all-closed', () => { if (download) cancelDownload(); app.quit(); });

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

// ---------------------------------------------------------------- kliens (saját VibeMTA kliens, a GitHub release-ből)
const VERSION_FILE = 'vibemta-kliens.json';
function clientDir() { return path.join(settings.clientDir, 'Kliens'); }

function installedInfo() {
  const dir = clientDir();
  const exe = path.join(dir, MTA_EXE);
  if (!fs.existsSync(exe)) return null;
  const v = readJson(path.join(dir, VERSION_FILE), {});
  return { dir, exe, tag: v.tag || null };
}

// a legfrissebb kiadás a GitHubon: { tag, url, size }
function latestRelease() {
  return new Promise((resolve) => {
    let body = '', settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const req = net.request({ url: CONFIG.releaseApi, redirect: 'follow' });
      req.setHeader('Accept', 'application/vnd.github+json');
      req.setHeader('User-Agent', 'VibeMTA-Launcher');
      req.on('response', (res) => {
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            const asset = (j.assets || []).find((a) => a.name === CONFIG.clientAsset);
            done(asset ? { tag: j.tag_name, url: asset.browser_download_url, size: asset.size } : null);
          } catch (e) { done(null); }
        });
      });
      req.on('error', () => done(null));
      setTimeout(() => done(null), 8000);
      req.end();
    } catch (e) { done(null); }
  });
}

let lastRelease = null;
async function findClient() {
  const inst = installedInfo();
  lastRelease = await latestRelease();
  const update = !!(inst && lastRelease && inst.tag && lastRelease.tag !== inst.tag);
  if (!inst) return { installed: false, online: !!lastRelease };
  return { installed: true, own: true, dir: inst.dir, exe: inst.exe, tag: inst.tag, update, latest: lastRelease && lastRelease.tag };
}

// ---------------------------------------------------------------- letöltés + kicsomagolás
function cancelDownload() {
  if (!download) return;
  download.cancelled = true;
  try { download.req.abort(); } catch (e) {}
}

function downloadFile(url, dest, expectedSize, onProgress) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const part = dest + '.part';
    const out = fs.createWriteStream(part);
    const req = net.request({ url, redirect: 'follow' });
    req.setHeader('User-Agent', 'VibeMTA-Launcher');
    download = { req, cancelled: false };
    let total = expectedSize || 0, got = 0, lastT = Date.now(), lastGot = 0, speed = 0;
    const fail = (e) => { out.destroy(); try { fs.unlinkSync(part); } catch (x) {} reject(download && download.cancelled ? new Error('cancelled') : e); };
    req.on('response', (res) => {
      if (res.statusCode !== 200) return fail(new Error('HTTP ' + res.statusCode));
      total = parseInt(res.headers['content-length'], 10) || total;
      res.on('data', (chunk) => {
        out.write(chunk);
        got += chunk.length;
        const now = Date.now();
        if (now - lastT >= 250) {
          const inst = (got - lastGot) / ((now - lastT) / 1000);
          speed = speed ? speed * 0.7 + inst * 0.3 : inst;
          lastT = now; lastGot = got;
          onProgress({ got, total, speed });
        }
      });
      res.on('end', () => {
        out.end(() => {
          if (download && download.cancelled) { try { fs.unlinkSync(part); } catch (e) {} return reject(new Error('cancelled')); }
          if (total && got !== total) { try { fs.unlinkSync(part); } catch (e) {} return reject(new Error('hiányos letöltés')); }
          try { if (fs.existsSync(dest)) fs.unlinkSync(dest); fs.renameSync(part, dest); } catch (e) { return reject(e); }
          onProgress({ got, total: total || got, speed });
          resolve(dest);
        });
      });
      res.on('error', fail);
    });
    req.on('error', fail);
    req.on('abort', () => fail(new Error('cancelled')));
    req.end();
  });
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }

async function installClient() {
  const base = settings.clientDir;
  try { ensureDir(base); fs.accessSync(base, fs.constants.W_OK); }
  catch (e) { return { ok: false, error: 'dir', detail: base }; }

  const rel = lastRelease || (await latestRelease());
  if (!rel) return { ok: false, error: 'norelease' };

  const zip = path.join(base, 'letoltes', CONFIG.clientAsset);
  send('progress', { phase: 'download', got: 0, total: rel.size || 0, speed: 0 });
  try {
    log('letöltés', rel.tag, rel.url);
    await downloadFile(rel.url, zip, rel.size, (p) => {
      send('progress', Object.assign({ phase: 'download' }, p));
      if (win && p.total) win.setProgressBar(p.got / p.total);
    });
  } catch (e) {
    download = null;
    if (win) win.setProgressBar(-1);
    log('letöltés hiba', e.message);
    return { ok: false, error: e.message === 'cancelled' ? 'cancelled' : 'download', detail: e.message };
  }
  download = null;

  // kicsomagolás egy ideiglenes mappába, majd csere (a beállítások / mentett adatok a régi kliensből átkerülnek)
  send('progress', { phase: 'install', got: 0, total: 0 });
  if (win) win.setProgressBar(2, { mode: 'indeterminate' });
  const target = clientDir();
  const tmp = target + '.uj';
  try {
    const extract = require('extract-zip');
    rmrf(tmp);
    let n = 0;
    await extract(zip, { dir: tmp, onEntry: () => { if (++n % 200 === 0) send('progress', { phase: 'install', files: n }); } });
    if (!fs.existsSync(path.join(tmp, MTA_EXE))) throw new Error('a csomagban nincs ' + MTA_EXE);
    // megtartandó felhasználói adatok: beállítások, képernyőképek, letöltött szerver fájlok
    const keep = ['MTA\\config', 'MTA\\screenshots', 'mods\\deathmatch\\resources', 'mods\\deathmatch\\priv'];
    if (fs.existsSync(target)) {
      for (const k of keep) {
        const from = path.join(target, k), to = path.join(tmp, k);
        if (fs.existsSync(from)) { rmrf(to); ensureDir(path.dirname(to)); fs.renameSync(from, to); }
      }
      const old = target + '.regi';
      rmrf(old);
      fs.renameSync(target, old);
      rmrf(old);
    }
    fs.renameSync(tmp, target);
    writeJsonAtomic(path.join(target, VERSION_FILE), { tag: rel.tag, installed: new Date().toISOString() });
  } catch (e) {
    if (win) win.setProgressBar(-1);
    rmrf(tmp);
    log('kicsomagolás hiba', e.message);
    return { ok: false, error: 'install', detail: e.message };
  }
  if (win) win.setProgressBar(-1);
  try { fs.unlinkSync(zip); fs.rmdirSync(path.dirname(zip)); } catch (e) {}
  log('kliens kész', rel.tag, target);
  return { ok: true, client: await findClient() };
}

// ---------------------------------------------------------------- szerver állapot (ASE, port + 123)
function queryServer(host, port) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const t0 = Date.now();
    let done = false;
    const finish = (r) => { if (done) return; done = true; try { sock.close(); } catch (e) {} resolve(r); };
    const timer = setTimeout(() => finish({ online: false }), 2500);
    sock.on('error', () => { clearTimeout(timer); finish({ online: false }); });
    sock.on('message', (msg) => {
      clearTimeout(timer);
      try {
        if (msg.slice(0, 4).toString() !== 'EYE1') return finish({ online: false });
        let i = 4;
        const fields = [];
        while (i < msg.length && fields.length < 9) {
          const len = msg[i];
          if (!len) break;
          fields.push(msg.slice(i + 1, i + len).toString('utf8'));
          i += len;
        }
        finish({
          online: true, ping: Date.now() - t0, name: fields[2] || '',
          players: parseInt(fields[7], 10) || 0, maxPlayers: parseInt(fields[8], 10) || 0,
        });
      } catch (e) { finish({ online: false }); }
    });
    sock.send(Buffer.from('s'), port + 123, host, (err) => { if (err) { clearTimeout(timer); finish({ online: false }); } });
  });
}

// ---------------------------------------------------------------- hírek
function loadLocalNews() { return readJson(path.join(__dirname, 'news.json'), []); }
function fetchNews() {
  return new Promise((resolve) => {
    if (!CONFIG.newsUrl) return resolve(loadLocalNews());
    let body = '', settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const req = net.request(CONFIG.newsUrl);
      req.on('response', (res) => {
        res.on('data', (c) => { body += c; });
        res.on('end', () => { try { const j = JSON.parse(body); done(Array.isArray(j) ? j : loadLocalNews()); } catch (e) { done(loadLocalNews()); } });
      });
      req.on('error', () => done(loadLocalNews()));
      setTimeout(() => done(loadLocalNews()), 5000);
      req.end();
    } catch (e) { done(loadLocalNews()); }
  });
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('init', async () => ({
  config: { serverName: CONFIG.serverName, servers: SERVERS.map(({ password, ...s }) => s) },
  version: app.getVersion(),
  settings,
  themes: loadThemes(),
  client: await findClient(),
}));
ipcMain.handle('client', () => findClient());
ipcMain.handle('status', (_e, id) => { const s = serverById(id); return queryServer(s.host, s.port); });
ipcMain.handle('news', () => fetchNews());
ipcMain.handle('themes', () => loadThemes());
ipcMain.handle('install', () => (download ? { ok: false, error: 'busy' } : installClient()));
ipcMain.on('cancel', () => cancelDownload());

ipcMain.handle('setSetting', (_e, key, value) => {
  if (key === 'theme' && typeof value === 'string') settings.theme = value.slice(0, 60);
  else if (key === 'closeOnPlay') settings.closeOnPlay = !!value;
  else return settings;
  saveSettings();
  return settings;
});

ipcMain.handle('pickClientDir', async () => {
  if (download) return { settings };
  const r = await dialog.showOpenDialog(win, { title: 'Kliens mappa kiválasztása', defaultPath: settings.clientDir, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { settings };
  let dir = r.filePaths[0];
  if (path.basename(dir).toLowerCase() !== 'vibemta') dir = path.join(dir, 'VibeMTA');
  settings.clientDir = dir;
  saveSettings();
  return { settings, client: await findClient() };
});

ipcMain.on('openFolder', (_e, what) => {
  const dir = what === 'themes' ? (syncThemes(), THEME_DIR) : what === 'data' ? DATA_DIR : settings.clientDir;
  ensureDir(dir);
  shell.openPath(dir);
});

ipcMain.on('win', (_e, what) => {
  if (!win) return;
  if (what === 'min') win.minimize();
  else if (what === 'close') win.close();
});

// ---------------------------------------------------------------- egyszeri rendszer beállítás (mint egy telepítő)
//   A kliens (MTA alapú) a HKLM\SOFTWARE\Multi Theft Auto: San Andreas All\VibeMTA kulcsot és a
//   C:\ProgramData\MTA San Andreas All\VibeMTA mappát várja, írható jogokkal. Ezt egyszer, rendszergazdaként állítjuk be.
const REG_KEY = 'HKLM\\SOFTWARE\\Multi Theft Auto: San Andreas All\\VibeMTA';

function regRead32(key, value) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('reg', ['query', key, '/v', value, '/reg:32'], { windowsHide: true }, (err, out) => {
      if (err || !out) return resolve(null);
      const m = out.match(/REG_SZ\s+(.+)/i);
      resolve(m ? m[1].trim() : null);
    });
  });
}

function dataDirsWritable() {
  const base = path.join(process.env.ProgramData || 'C:\\ProgramData', 'MTA San Andreas All');
  for (const d of ['VibeMTA', 'Common']) {
    const f = path.join(base, d, 'vibemta-launcher-test.tmp');
    try { fs.writeFileSync(f, 'ok'); fs.unlinkSync(f); } catch (e) { return false; }
  }
  return true;
}

async function clientSetupOk(dir) {
  if (process.platform !== 'win32') return true;
  const v = await regRead32(REG_KEY, 'Last Install Location');
  return !!v && path.resolve(v).toLowerCase() === path.resolve(dir).toLowerCase() && dataDirsWritable();
}

function runSetupElevated(dir) {
  return new Promise((resolve) => {
    const q = (x) => String(x).replace(/'/g, "''");
    const script = `
$ErrorActionPreference = 'Stop'
$users = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
$hklm = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry32)
foreach ($sub in @('SOFTWARE\\Multi Theft Auto: San Andreas All\\VibeMTA', 'SOFTWARE\\Multi Theft Auto: San Andreas All\\Common')) {
  $k = $hklm.CreateSubKey($sub)
  $acl = $k.GetAccessControl()
  $acl.AddAccessRule((New-Object System.Security.AccessControl.RegistryAccessRule($users, 'FullControl', 'ContainerInherit', 'None', 'Allow')))
  $k.SetAccessControl($acl)
  if ($sub -like '*VibeMTA') { $k.SetValue('Last Install Location', '${q(dir)}') }
  $k.Close()
}
$pd = Join-Path $env:ProgramData 'MTA San Andreas All'
foreach ($d in @('VibeMTA', 'Common')) {
  $p = Join-Path $pd $d
  New-Item -ItemType Directory -Force -Path $p | Out-Null
  & icacls $p /grant '*S-1-5-32-545:(OI)(CI)F' /T /C /Q | Out-Null
}
`;
    const file = path.join(os.tmpdir(), 'vibemta-setup.ps1');
    try { fs.writeFileSync(file, '\ufeff' + script, 'utf8'); } catch (e) { return resolve({ ok: false, error: 'setup', detail: e.message }); }
    const ps = `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${q(file)}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true }, (err, _o, stderr) => {
      try { fs.unlinkSync(file); } catch (e) {}
      if (err) {
        const msg = String(stderr || err.message || '');
        log('beállítás hiba', msg);
        return resolve({ ok: false, error: /cancel|megszak|1223/i.test(msg) ? 'uac' : 'setup', detail: msg });
      }
      resolve({ ok: true });
    });
  });
}

async function ensureClientSetup(dir) {
  if (await clientSetupOk(dir)) return { ok: true };
  log('rendszer beállítás', dir);
  send('progress', { phase: 'setup' });
  const r = await runSetupElevated(dir);
  if (!r.ok) return r;
  return (await clientSetupOk(dir)) ? { ok: true } : { ok: false, error: 'setup', detail: 'ellenőrzés sikertelen' };
}

ipcMain.handle('play', async (_e, id) => {
  const srv = serverById(id);
  const c = installedInfo();
  if (!c) return { ok: false, error: 'noclient' };
  const su = await ensureClientSetup(c.dir);
  if (!su.ok) return su;
  try {
    const child = spawn(c.exe, [serverUri(srv)], { cwd: c.dir, detached: true, stdio: 'ignore' });
    child.on('error', (e) => log('indítás hiba', e.message));
    child.unref();
    log('játék indítása', c.exe, `${srv.host}:${srv.port}`);
  } catch (e) {
    return { ok: false, error: 'start', detail: String((e && e.message) || e) };
  }
  if (settings.closeOnPlay) setTimeout(() => app.quit(), 4000);
  else if (win) setTimeout(() => win.minimize(), 1500);
  return { ok: true };
});
