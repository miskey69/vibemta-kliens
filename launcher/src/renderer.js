// VibeMTA launcher - felület
const $ = (id) => document.getElementById(id);
const S = { config: {}, settings: {}, themes: [], client: { installed: false }, busy: false };

// ---------------------------------------------------------------- téma
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function applyTheme(id) {
  const t = S.themes.find((x) => x.id === id) || S.themes[0];
  if (!t) return;
  const r = document.documentElement.style;
  for (const k of ['accent', 'accent2', 'bg', 'panel', 'text', 'muted', 'glow1', 'glow2']) r.setProperty('--' + k, t[k]);
  r.setProperty('--on-accent', luminance(t.accent) > 0.55 ? '#121214' : '#ffffff');
  document.querySelectorAll('.theme').forEach((el) => el.classList.toggle('active', el.dataset.id === t.id));
}

function renderThemes() {
  const box = $('themeList');
  box.innerHTML = '';
  for (const t of S.themes) {
    const b = document.createElement('button');
    b.className = 'theme';
    b.dataset.id = t.id;
    b.innerHTML = `<div class="theme-sw" style="background:linear-gradient(135deg, ${t.bg}, ${t.panel})"><i style="background:${t.accent}"></i><b style="background:${t.glow2}"></b></div><div class="theme-name"></div>`;
    b.querySelector('.theme-name').textContent = t.name;
    b.onclick = async () => { applyTheme(t.id); S.settings = await window.vibe.setSetting('theme', t.id); };
    box.appendChild(b);
  }
  applyTheme(S.settings.theme);
}

// ---------------------------------------------------------------- fő gomb
function note(text, err) { const n = $('playNote'); n.textContent = text || ''; n.classList.toggle('err', !!err); }

function showProgress(on) {
  $('progress').classList.toggle('hidden', !on);
  $('servers').classList.toggle('busy', on);
}

const playButtons = () => Array.from(document.querySelectorAll('.srv .play'));

function setButton() {
  if (S.busy) return;
  showProgress(false);
  for (const b of playButtons()) {
    b.disabled = false;
    b.classList.remove('busy');
    const label = b.querySelector('.play-label');
    if (S.client.installed && S.client.update) {
      b.classList.add('dl');
      label.textContent = 'Frissítés';
    } else if (S.client.installed) {
      b.classList.remove('dl');
      label.textContent = 'Játék';
    } else {
      b.classList.add('dl');
      label.textContent = 'Kliens letöltése';
    }
  }
}

function setClientInfo() {
  const el = $('clientInfo');
  if (S.client.installed) {
    el.textContent = `Kliens: ${S.client.dir}` + (S.client.tag ? `  ·  ${S.client.tag}` : '') + (S.client.update ? `  ·  új verzió: ${S.client.latest}` : '');
    el.className = 'ok';
  } else {
    el.textContent = 'A kliens még nincs letöltve';
    el.className = '';
  }
  $('clientDir').textContent = S.settings.clientDir;
  $('dirHint').textContent = S.client.installed && S.client.own
    ? 'A kliens ebben a mappában van.'
    : 'Ide kerül a kliens a letöltéskor (a mappán belül: Kliens).';
}

const fmtMB = (b) => (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
function fmtTime(s) {
  if (!isFinite(s) || s <= 0) return '';
  if (s < 60) return `~${Math.ceil(s)} mp`;
  return `~${Math.floor(s / 60)} p ${Math.ceil(s % 60)} mp`;
}

window.vibe.onProgress((p) => {
  if (p.phase === 'download') {
    $('prPhase').textContent = 'Kliens letöltése';
    $('btnCancel').classList.remove('hidden');
    $('progress').querySelector('.pr-bar').classList.toggle('indet', !p.total);
    const pct = p.total ? Math.floor((p.got / p.total) * 100) : 0;
    $('prPct').textContent = p.total ? pct + '%' : '';
    $('prFill').style.width = pct + '%';
    const left = p.total && p.speed ? (p.total - p.got) / p.speed : 0;
    $('prInfo').textContent = p.got
      ? `${fmtMB(p.got)}${p.total ? ' / ' + fmtMB(p.total) : ''}  ·  ${fmtMB(p.speed || 0)}/s  ${fmtTime(left)}`
      : 'Kapcsolódás...';
  } else if (p.phase === 'setup') {
    note('Első indítás: a Windows rendszergazdai engedélyt kér a kliens beállításához (csak egyszer kell).');
  } else if (p.phase === 'install') {
    $('prPhase').textContent = 'Kliens telepítése';
    $('prPct').textContent = '';
    $('btnCancel').classList.add('hidden');
    $('progress').querySelector('.pr-bar').classList.add('indet');
    $('prInfo').textContent = p.files ? `Kicsomagolás... ${p.files} fájl` : 'Kicsomagolás...';
  }
});

const ERRORS = {
  cancelled: 'A letöltést megszakítottad.',
  download: 'Nem sikerült letölteni a klienst. Ellenőrizd az internetkapcsolatot, és próbáld újra.',
  norelease: 'Nem érhető el a letöltési szerver. Ellenőrizd az internetkapcsolatot, és próbáld újra.',
  install: 'A kicsomagolás nem sikerült. Próbáld újra, vagy válassz másik kliens mappát a beállításokban.',
  dir: 'A kliens mappába nem lehet írni. Válassz másikat a beállításokban.',
  busy: 'Már folyamatban van egy letöltés.',
};

async function doInstall() {
  S.busy = true;
  note('');
  showProgress(true);
  $('prFill').style.width = '0%';
  $('btnPickDir').disabled = true;
  const r = await window.vibe.install();
  S.busy = false;
  $('btnPickDir').disabled = false;
  if (r.ok) {
    S.client = r.client;
    note('A kliens elkészült, indulhat a játék!');
  } else {
    note(ERRORS[r.error] || 'Ismeretlen hiba.', r.error !== 'cancelled');
  }
  setClientInfo();
  setButton();
}

async function doPlay(srv, b) {
  S.busy = true;
  for (const x of playButtons()) x.disabled = true;
  b.classList.add('busy');
  b.querySelector('.play-label').textContent = 'Indítás...';
  note(`Az MTA indul, és magától csatlakozik: ${srv.label} (${srv.host}:${srv.port}).`);
  const r = await window.vibe.play(srv.id);
  S.busy = false;
  if (!r.ok) {
    if (r.error === 'noclient') S.client = await window.vibe.client();
    setClientInfo();
    setButton();
    const msg = r.error === 'noclient' ? 'A kliens nem található, töltsd le újra.'
      : r.error === 'uac' ? 'Az első indításhoz engedélyezni kell a Windows rendszergazda kérdését.'
      : r.error === 'setup' ? 'Nem sikerült beállítani a klienst. Próbáld újra (a Windows kérdésére Igen).'
      : 'Nem sikerült elindítani a klienst. Próbáld újra.';
    note(msg, true);
    return;
  }
  setTimeout(() => { setButton(); note(''); }, 5000);
}

// ---------------------------------------------------------------- szerver kártyák (bal: fő szerver, jobb: localhost)
function renderServers() {
  const box = $('servers');
  box.innerHTML = '';
  for (const srv of S.config.servers || []) {
    const col = document.createElement('div');
    col.className = 'srv';
    col.dataset.id = srv.id;
    col.innerHTML = `
      <div class="srv-label"></div>
      <div class="server-card">
        <div class="sc-row"><span class="dot"></span><span class="sc-status">Szerver lekérdezése...</span></div>
        <div class="sc-stats">
          <div class="stat"><div class="stat-v st-players">–</div><div class="stat-l">Játékos</div></div>
          <div class="stat"><div class="stat-v st-ping">–</div><div class="stat-l">Ping</div></div>
          <div class="stat"><div class="stat-v small st-addr"></div><div class="stat-l">Cím</div></div>
        </div>
        <div class="bar"><div class="bar-fill"></div></div>
      </div>
      <div class="action">
        <button class="play" disabled>
          <svg class="ic ic-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          <svg class="ic ic-dl" viewBox="0 0 24 24"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/></svg>
          <span class="play-label">Betöltés...</span>
        </button>
      </div>`;
    col.querySelector('.srv-label').textContent = srv.label;
    col.querySelector('.st-addr').textContent = `${srv.host}:${srv.port}`;
    const b = col.querySelector('.play');
    b.onclick = () => { if (S.busy) return; if (S.client.installed && !S.client.update) doPlay(srv, b); else doInstall(); };
    box.appendChild(col);
  }
}

$('btnCancel').onclick = () => window.vibe.cancel();

// ---------------------------------------------------------------- szerver állapot, hírek
async function checkOne(srv) {
  const col = document.querySelector(`.srv[data-id="${srv.id}"]`);
  if (!col) return;
  const s = await window.vibe.status(srv.id);
  const q = (c) => col.querySelector(c);
  if (s && s.online) {
    q('.dot').className = 'dot on';
    q('.sc-status').textContent = 'Online' + (s.name ? ' · ' + s.name : '');
    q('.st-players').textContent = `${s.players} / ${s.maxPlayers}`;
    q('.st-ping').textContent = `${s.ping} ms`;
    q('.bar-fill').style.width = (s.maxPlayers > 0 ? Math.min(100, (s.players / s.maxPlayers) * 100) : 0) + '%';
  } else {
    q('.dot').className = 'dot off';
    q('.sc-status').textContent = 'Nem érhető el';
    q('.st-players').textContent = '–';
    q('.st-ping').textContent = '–';
    q('.bar-fill').style.width = '0%';
  }
}
function checkStatus() { for (const srv of S.config.servers || []) checkOne(srv); }

function esc(t) { const d = document.createElement('div'); d.textContent = String(t == null ? '' : t); return d.innerHTML; }
async function loadNews() {
  const list = await window.vibe.news();
  const box = $('newsList');
  if (!Array.isArray(list) || !list.length) { box.innerHTML = '<div class="news-empty">Nincs friss hír.</div>'; return; }
  box.innerHTML = list.map((n) => `
    <article class="news-item">
      ${n.date ? `<div class="news-date">${esc(n.date)}</div>` : ''}
      <div class="news-title">${esc(n.title)}</div>
      ${n.body ? `<div class="news-body">${esc(n.body)}</div>` : ''}
    </article>`).join('');
}

// ---------------------------------------------------------------- beállítások
function openSettings(on) { $('settings').classList.toggle('hidden', !on); }
$('btnSettings').onclick = () => openSettings($('settings').classList.contains('hidden'));
$('btnSettingsClose').onclick = () => openSettings(false);
$('settings').onclick = (e) => { if (e.target.id === 'settings') openSettings(false); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSettings(false); });
$('btnThemeDir').onclick = () => window.vibe.openFolder('themes');
$('btnOpenDir').onclick = () => window.vibe.openFolder('client');
$('btnPickDir').onclick = async () => {
  const r = await window.vibe.pickClientDir();
  S.settings = r.settings;
  if (r.client) S.client = r.client;
  setClientInfo();
  setButton();
};
$('optClose').onchange = async (e) => { S.settings = await window.vibe.setSetting('closeOnPlay', e.target.checked); };
$('btnMin').onclick = () => window.vibe.win('min');
$('btnClose').onclick = () => window.vibe.win('close');

// ---------------------------------------------------------------- indulás
(async () => {
  const d = await window.vibe.init();
  Object.assign(S, d);
  renderServers();
  $('verInfo').textContent = 'Launcher v' + d.version;
  $('optClose').checked = !!S.settings.closeOnPlay;
  renderThemes();
  setClientInfo();
  setButton();
  checkStatus();
  loadNews();
  setInterval(checkStatus, 15000);
})();
