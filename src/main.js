const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, dialog, nativeImage, clipboard, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const Crosshair = require('./crosshair');
const devAuth = require('./devauth');
const { sanitizeTuning } = require('./detector');
const Profiles = require('./profiles');
const { watchForeground } = require('./foreground');
const Report = require('./report');

const ICON_PATH = path.join(__dirname, 'assets', 'icon-256.png');
const OVERLAY_SIZE = 600; // window is larger than any sane crosshair; content is centered
const DEFAULT_STATE = () => ({
  active: Crosshair.sanitize({}),
  visible: true,
  display: 0,
  hotkeys: { toggle: 'F10', next: 'F9', prev: 'F8', endMatch: 'F7' },
  reports: [], reportPopup: true,
  detector: { enabled: false, sensitivity: 'medium', target: 'screen', windowName: '', badge: true, sound: true, tuning: null, debug: false, override: null },
  galleryUrl: 'http://localhost:8787',
  profiles: null, profileId: Profiles.DEFAULT_ID, autoProfiles: true, hideUnfocused: false,
  saved: Crosshair.PRESETS.map(p => ({ name: p.name, cfg: p.cfg }))
});

let state, overlay, panel, tray, analyzer, debugWin, statusWin, savedIndex = 0;
let badgeState = 'starting';
let overlayAllowed = true, fgSupported = false, fgWatcher = null, lastGame = null;
let session = null, reportWin = null;
let devUnlocked = false, devFails = 0, devLockedUntil = 0;
let devKey = null;
try { devKey = JSON.parse(fs.readFileSync(path.join(__dirname, 'devkey.json'), 'utf8')); } catch { /* no key file: dev section stays locked */ }
const alertLog = [];
const statePath = () => path.join(app.getPath('userData'), 'settings.json');

// The app was called Sightline before; carry its settings over on first run under the new name.
function readSettingsFile() {
  const candidates = [statePath(), ...['Sightline', 'sightline'].map(d => path.join(app.getPath('appData'), d, 'settings.json'))];
  for (const f of candidates) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* try the next location */ }
  }
  return null;
}

function loadState() {
  const base = DEFAULT_STATE();
  try {
    const raw = readSettingsFile();
    if (!raw) throw new Error('no settings yet');
    base.active = Crosshair.sanitize(raw.active);
    base.visible = raw.visible !== false;
    base.display = Number.isInteger(raw.display) ? raw.display : 0;
    if (raw.hotkeys && typeof raw.hotkeys === 'object') {
      for (const k of Object.keys(base.hotkeys)) if (typeof raw.hotkeys[k] === 'string') base.hotkeys[k] = raw.hotkeys[k];
    }
    if (raw.detector && typeof raw.detector === 'object') {
      base.detector.enabled = raw.detector.enabled === true;
      if (['low', 'medium', 'high'].includes(raw.detector.sensitivity)) base.detector.sensitivity = raw.detector.sensitivity;
      if (['window', 'screen'].includes(raw.detector.target)) base.detector.target = raw.detector.target;
      if (typeof raw.detector.windowName === 'string') base.detector.windowName = raw.detector.windowName.slice(0, 120);
      for (const k of ['badge', 'sound']) if (typeof raw.detector[k] === 'boolean') base.detector[k] = raw.detector[k];
      base.detector.tuning = sanitizeTuning(raw.detector.tuning);
    }
    if (typeof raw.galleryUrl === 'string' && /^https?:\/\//i.test(raw.galleryUrl)) base.galleryUrl = raw.galleryUrl.slice(0, 200);
    base.reports = Report.sanitizeReports(raw.reports);
    if (typeof raw.reportPopup === 'boolean') base.reportPopup = raw.reportPopup;
    base.profiles = raw.profiles;
    if (typeof raw.profileId === 'string') base.profileId = raw.profileId;
    if (typeof raw.autoProfiles === 'boolean') base.autoProfiles = raw.autoProfiles;
    if (typeof raw.hideUnfocused === 'boolean') base.hideUnfocused = raw.hideUnfocused;
    if (Array.isArray(raw.saved)) {
      base.saved = raw.saved.slice(0, 100).map(p => ({ name: String(p.name || 'Untitled').slice(0, 40), cfg: Crosshair.sanitize(p.cfg) }));
    }
  } catch { /* first run or corrupt file: fall back to defaults */ }
  base.profiles = Profiles.sanitizeProfiles(base.profiles, base.active, base.detector);
  if (!base.profiles.some(p => p.id === base.profileId)) base.profileId = Profiles.DEFAULT_ID;
  return base;
}

let saveTimer;
function persist() {
  snapshotProfile();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(statePath()), { recursive: true });
      const { enabled, sensitivity, target, windowName, badge, sound, tuning } = state.detector; // dev overrides are session-only
      fs.writeFileSync(statePath(), JSON.stringify(Object.assign({}, state, { detector: { enabled, sensitivity, target, windowName, badge, sound, tuning } }), null, 2));
    } catch (e) { console.error('save failed', e); }
  }, 200);
}

function targetDisplay() {
  const all = screen.getAllDisplays();
  return all[state.display] || screen.getPrimaryDisplay();
}

function placeOverlay() {
  if (!overlay) return;
  const b = targetDisplay().bounds;
  const next = {
    x: Math.round(b.x + b.width / 2 - OVERLAY_SIZE / 2 + state.active.offsetX),
    y: Math.round(b.y + b.height / 2 - OVERLAY_SIZE / 2 + state.active.offsetY),
    width: OVERLAY_SIZE, height: OVERLAY_SIZE
  };
  const cur = overlay.getBounds();
  if (cur.x !== next.x || cur.y !== next.y || cur.width !== next.width || cur.height !== next.height) overlay.setBounds(next);
}

function createOverlay() {
  overlay = new BrowserWindow({
    width: OVERLAY_SIZE, height: OVERLAY_SIZE,
    transparent: true, frame: false, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true); // click-through so the game still receives input
  overlay.loadFile(path.join(__dirname, 'overlay', 'overlay.html'));
  overlay.once('ready-to-show', () => { placeOverlay(); applyVisibility(); });
}

function applyVisibility() {
  if (!overlay) return;
  if (state.visible && overlayAllowed) overlay.showInactive(); else overlay.hide();
  refreshTray();
  send('state', publicState());
}

function createPanel() {
  if (panel && !panel.isDestroyed()) { panel.show(); panel.focus(); return; }
  panel = new BrowserWindow({
    width: 980, height: 700, minWidth: 820, minHeight: 560,
    title: 'Zeroed', icon: ICON_PATH, backgroundColor: '#14161a', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  panel.loadFile(path.join(__dirname, 'ui', 'index.html'));
  panel.on('closed', () => { panel = null; });
}

function publicState() {
  return {
    active: state.active, visible: state.visible, display: state.display,
    hotkeys: state.hotkeys, saved: state.saved, detector: state.detector, galleryUrl: state.galleryUrl,
    alerts: alertLog, dev: { unlocked: devUnlocked },
    profiles: state.profiles.map(({ id, name, match, watch, detector }) => ({ id, name, match, watch, detector })),
    profileId: state.profileId, autoProfiles: state.autoProfiles, hideUnfocused: state.hideUnfocused,
    reports: state.reports, reportPopup: state.reportPopup, matchOpen: !!session,
    foreground: { supported: fgSupported, last: lastGame },
    displays: screen.getAllDisplays().map((d, i) => ({ index: i, label: `Display ${i + 1} (${d.bounds.width}x${d.bounds.height})` }))
  };
}

function send(channel, payload) {
  // Each window only gets the slice of state it uses; presets (which can hold base64 images) go to the settings panel only.
  const slice = (w) => {
    if (channel !== 'state') return payload;
    if (w === overlay) return { active: payload.active };
    if (w === analyzer) return { detector: payload.detector };
    return payload;
  };
  for (const w of [overlay, panel, analyzer]) if (w && !w.isDestroyed()) w.webContents.send(channel, slice(w));
}

function setActive(cfg) {
  state.active = Crosshair.sanitize(cfg);
  placeOverlay();
  persist();
  send('state', publicState());
}

function cycleSaved(dir) {
  if (!state.saved.length) return;
  savedIndex = (savedIndex + dir + state.saved.length) % state.saved.length;
  setActive(state.saved[savedIndex].cfg);
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const fail = [];
  const bind = (accel, fn) => {
    try { if (!accel || !globalShortcut.register(accel, fn)) fail.push(accel); } catch { fail.push(accel); }
  };
  bind(state.hotkeys.toggle, () => { state.visible = !state.visible; persist(); applyVisibility(); });
  bind(state.hotkeys.next, () => cycleSaved(1));
  bind(state.hotkeys.prev, () => cycleSaved(-1));
  bind(state.hotkeys.endMatch, () => endMatch('hotkey'));
  return fail;
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open settings', click: createPanel },
    { label: state.visible ? 'Hide crosshair' : 'Show crosshair', click: () => { state.visible = !state.visible; persist(); applyVisibility(); } },
    { label: 'End match and show report', enabled: !!session, click: () => endMatch('tray') },
    { label: 'Profile', submenu: state.profiles.map(p => ({ label: p.name, type: 'radio', checked: p.id === state.profileId, click: () => switchProfile(p.id) })) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-32.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Zeroed by Solvra Development');
  tray.on('click', createPanel);
  refreshTray();
}

// ---- Experimental cheat-hint detector -------------------------------------------------
function syncAnalyzer() {
  if (state.detector.enabled && !analyzer) {
    analyzer = new BrowserWindow({
      show: false, width: 320, height: 200,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    analyzerLoaded = false; analyzerRunning = false; captureId = null;
    analyzer.loadFile(path.join(__dirname, 'analyzer', 'analyzer.html'));
    analyzer.on('closed', () => { analyzer = null; clearInterval(captureTimer); });
    captureTimer = setInterval(() => refreshCapture(false), 5000); // notice the chosen window opening/closing
  } else if (!state.detector.enabled && analyzer) {
    clearInterval(captureTimer);
    analyzer.destroy(); analyzer = null;
    endMatch('cheat hints turned off');
  }
  if (state.detector.enabled && !analyzerRunning) badgeState = 'starting';
  syncDebug(); syncStatus();
}

// Picks what to analyse: the whole screen, or one chosen window (cheaper, and ignores other apps/monitors
// and Zeroed's own overlay). If the chosen window isn't open, nothing is captured at all.
async function listWindows() {
  const wins = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
  const seen = new Set(), out = [];
  for (const w of wins) {
    const name = String(w.name || '').trim();
    if (!name || /^zeroed( |$)/i.test(name) || seen.has(name)) continue; // skip Zeroed's own windows
    seen.add(name); out.push({ id: w.id, name: name.slice(0, 120) });
  }
  return out.slice(0, 60);
}

async function findCaptureSource() {
  if (state.detector.target === 'window') {
    const w = state.detector.windowName && (await listWindows()).find(x => x.name === state.detector.windowName);
    return w ? { id: w.id } : null;
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const d = targetDisplay();
  const src = sources.find(x => x.display_id === String(d.id)) || sources[0];
  return src ? { id: src.id } : null;
}

let analyzerLoaded = false, analyzerRunning = false, captureId = null, lastAttempt = 0, captureTimer = null;
async function refreshCapture(force) {
  if (!analyzer || !analyzerLoaded) return;
  const src = await findCaptureSource();
  if (!analyzer) return;
  if (!src) {
    if (captureId) analyzer.webContents.send('capture-source', null);
    captureId = null; analyzerRunning = false;
    const win = state.detector.target === 'window';
    detectorStatus({
      running: false,
      note: win ? (state.detector.windowName ? `Waiting for the "${state.detector.windowName}" window…` : 'Pick a window to watch.') : '',
      error: win ? '' : 'No screen available to capture'
    });
    return;
  }
  const now = Date.now();
  // Retry a failed capture at most every 15 s so a denied permission doesn't spin.
  if (force || src.id !== captureId || (!analyzerRunning && now - lastAttempt > 15000)) {
    captureId = src.id; lastAttempt = now;
    analyzer.webContents.send('capture-source', src.id);
  }
}

// ---- Dev section (password-gated; session-only) ---------------------------------------
function syncDebug() {
  const want = devUnlocked && state.detector.debug && state.detector.enabled;
  if (want && !debugWin) {
    const b = targetDisplay().bounds;
    debugWin = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      transparent: true, frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
    });
    debugWin.setAlwaysOnTop(true, 'screen-saver');
    debugWin.setIgnoreMouseEvents(true);
    debugWin.setContentProtection(true); // keep our own boxes out of the screen capture (Windows/macOS)
    debugWin.loadFile(path.join(__dirname, 'debug', 'debug.html'));
    debugWin.once('ready-to-show', () => debugWin && debugWin.showInactive());
    debugWin.on('closed', () => { debugWin = null; });
  } else if (!want && debugWin) {
    debugWin.destroy(); debugWin = null;
  }
}

function lockDev() {
  devUnlocked = false; state.detector.debug = false; state.detector.override = null;
  syncDebug(); send('state', publicState());
}

ipcMain.handle('dev-unlock', (_e, password) => {
  const now = Date.now();
  if (now < devLockedUntil) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil((devLockedUntil - now) / 1000)} s.` };
  if (devKey && typeof password === 'string' && password.length <= 200 && devAuth.verify(password, devKey)) {
    devUnlocked = true; devFails = 0; send('state', publicState());
    return { ok: true };
  }
  if (++devFails >= 5) { devFails = 0; devLockedUntil = now + 30000; }
  return { ok: false, error: 'Wrong key.' };
});
ipcMain.on('dev-lock', () => lockDev());
ipcMain.on('dev-set', (_e, d) => {
  if (!devUnlocked || !d || typeof d !== 'object') return;
  if (typeof d.debug === 'boolean') state.detector.debug = d.debug;
  if (d.override === null) state.detector.override = null;
  else if (d.override && typeof d.override === 'object') {
    const minSnaps = Math.round(Number(d.override.minSnaps)), minScore = Number(d.override.minScore);
    if (Number.isFinite(minSnaps) && Number.isFinite(minScore)) state.detector.override = { minSnaps: Math.min(10, Math.max(1, minSnaps)), minScore: Math.min(0.95, Math.max(0.5, minScore)) };
  }
  syncDebug(); send('state', publicState());
});
ipcMain.on('dev-test-alert', () => { if (devUnlocked) showAlert({ confidence: 0.5, snaps: 4, test: true }); });
ipcMain.on('debug-frame', (e, f) => {
  if (!analyzer || e.sender !== analyzer.webContents || !debugWin || debugWin.isDestroyed() || !f || typeof f !== 'object') return;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const boxes = (Array.isArray(f.boxes) ? f.boxes : []).slice(0, 8).map(b => ({ x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) }));
  const i = f.info || {};
  debugWin.webContents.send('debug-frame', {
    boxes, dx: n(f.dx), dy: n(f.dy), fps: n(f.fps),
    info: { phase: String(i.phase || ''), speed: n(i.speed), strong: n(i.strong), weight: n(i.weight), needed: n(i.needed), minScore: n(i.minScore), lastScore: i.lastScore == null ? null : n(i.lastScore), lastWeight: i.lastWeight == null ? null : n(i.lastWeight) }
  });
});

// ---- Status badge: shows cheat hints is running and flashes on alerts --------------------
function syncStatus() {
  const want = state.detector.enabled && state.detector.badge;
  if (want && !statusWin) {
    const b = targetDisplay().workArea;
    statusWin = new BrowserWindow({
      width: 300, height: 40, x: b.x + b.width - 310, y: b.y + 8,
      transparent: true, frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
    });
    statusWin.setAlwaysOnTop(true, 'screen-saver');
    statusWin.setIgnoreMouseEvents(true);
    statusWin.setContentProtection(true); // keep it out of our own screen capture
    statusWin.loadFile(path.join(__dirname, 'status', 'status.html'));
    statusWin.once('ready-to-show', () => { if (statusWin) { statusWin.showInactive(); pushBadge(); } });
    statusWin.on('closed', () => { statusWin = null; });
  } else if (!want && statusWin) {
    statusWin.destroy(); statusWin = null;
  }
}
function pushBadge(flash, test) {
  if (!statusWin || statusWin.isDestroyed()) return;
  statusWin.webContents.send('badge', { state: badgeState, alerts: alertLog.filter(a => !a.test).length, flash: !!flash, test: !!test });
}
function detectorStatus(st) {
  badgeState = st.running ? 'watching' : st.error ? 'error' : 'waiting';
  if (st.running) startMatch(); else endMatch('capture stopped');
  send('detector-status', st);
  pushBadge();
}

function showAlert(a) {
  const entry = { at: Date.now(), confidence: a.confidence, snaps: a.snaps, test: !!a.test };
  alertLog.unshift(entry); alertLog.length = Math.min(alertLog.length, 20);
  send('state', publicState());
  pushBadge(true, a.test);
  const b = targetDisplay().workArea;
  const w = new BrowserWindow({
    width: 380, height: 100, x: Math.round(b.x + b.width / 2 - 190), y: b.y + 12,
    transparent: true, frame: false, resizable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: { sandbox: true, contextIsolation: true, autoplayPolicy: 'no-user-gesture-required' }
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setIgnoreMouseEvents(true);
  w.loadFile(path.join(__dirname, 'alert', 'alert.html'), { query: { c: String(a.confidence), n: String(a.snaps), w: String(a.windowSec || 15), t: a.test ? '1' : '0', s: state.detector.sound ? '1' : '0' } });
  w.once('ready-to-show', () => w.showInactive());
  setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 8000);
}

ipcMain.handle('list-windows', async () => ({ ok: true, windows: (await listWindows()).map(w => w.name) }));
ipcMain.on('analyzer-ready', (e) => {
  if (analyzer && e.sender === analyzer.webContents) { analyzerLoaded = true; refreshCapture(true); }
});
ipcMain.on('analyzer-status', (e, st) => {
  if (!analyzer || e.sender !== analyzer.webContents) return;
  analyzerRunning = !!st.running;
  const note = st.running ? (state.detector.target === 'window' ? `Watching "${state.detector.windowName}".` : 'Watching the screen.') : '';
  detectorStatus({ running: analyzerRunning, note, error: st.error ? String(st.error).slice(0, 200) : '' });
});
ipcMain.on('report-alert', (e, a) => {
  if (!analyzer || e.sender !== analyzer.webContents || !state.detector.enabled) return;
  const confidence = Math.min(1, Math.max(0, Number(a && a.confidence) || 0));
  const snaps = Math.max(0, Math.min(99, Math.round(Number(a && a.snaps) || 0)));
  if (session) session.alerts.push(Date.now());
  const windowSec = Math.max(1, Math.min(600, Math.round(Number(a && a.windowSec) || 15)));
  showAlert({ confidence, snaps, windowSec });
});
ipcMain.on('set-detector', (_e, d) => {
  if (!d || typeof d !== 'object') return;
  if (typeof d.enabled === 'boolean') state.detector.enabled = d.enabled;
  if (['low', 'medium', 'high'].includes(d.sensitivity)) state.detector.sensitivity = d.sensitivity;
  let targetChanged = false;
  if (['window', 'screen'].includes(d.target) && d.target !== state.detector.target) { state.detector.target = d.target; targetChanged = true; }
  if (typeof d.windowName === 'string' && d.windowName.slice(0, 120) !== state.detector.windowName) { state.detector.windowName = d.windowName.slice(0, 120); targetChanged = true; }
  for (const k of ['badge', 'sound']) if (typeof d[k] === 'boolean') state.detector[k] = d[k];
  if ('tuning' in d) state.detector.tuning = sanitizeTuning(d.tuning);
  persist(); syncAnalyzer(); syncDebug();
  if (targetChanged) refreshCapture(true);
  send('state', publicState());
});

// ---- Community gallery client ---------------------------------------------------------
const galleryCache = new Map(); // id -> decoded config, so the renderer never handles raw codes
async function galleryFetch(p, opts = {}) {
  const base = state.galleryUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/api/crosshairs${p}`, Object.assign({ signal: AbortSignal.timeout(8000) }, opts));
  const text = await res.text();
  if (text.length > 2e6) throw new Error('Response too large');
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('Not a Zeroed gallery server'); }
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}
const galleryOk = (fn) => async (...a) => { try { return Object.assign({ ok: true }, await fn(...a)); } catch (e) { return { ok: false, error: e.message }; } };

ipcMain.handle('set-gallery-url', (_e, u) => {
  if (typeof u !== 'string' || !/^https?:\/\/[^\s]+$/i.test(u.trim())) return { ok: false, error: 'Enter an http(s) URL' };
  state.galleryUrl = u.trim().slice(0, 200); persist(); send('state', publicState());
  return { ok: true };
});
ipcMain.handle('gallery-list', galleryOk(async (q, sort) => {
  const list = await galleryFetch(`?sort=${sort === 'top' ? 'top' : 'new'}&q=${encodeURIComponent(String(q || '').slice(0, 40))}`);
  if (!Array.isArray(list)) throw new Error('Unexpected response');
  galleryCache.clear();
  const items = [];
  for (const i of list.slice(0, 100)) {
    try {
      if (!/^[a-f0-9]{12}$/.test(i.id)) continue;
      galleryCache.set(i.id, Crosshair.decode(i.code));
      items.push({ id: i.id, name: String(i.name).slice(0, 40), author: String(i.author).slice(0, 24), likes: Number(i.likes) || 0, downloads: Number(i.downloads) || 0 });
    } catch { /* skip malformed entries from a misbehaving server */ }
  }
  return { items };
}));
ipcMain.handle('gallery-add', galleryOk(async (id, name) => {
  const cfg = galleryCache.get(id);
  if (!cfg) throw new Error('Refresh the list first');
  state.saved.push({ name: String(name || 'Community').slice(0, 40), cfg });
  state.saved = state.saved.slice(-100);
  setActive(cfg);
  galleryFetch(`/${id}/download`, { method: 'POST' }).catch(() => {});
  return {};
}));
ipcMain.handle('gallery-like', galleryOk(async (id) => {
  if (!/^[a-f0-9]{12}$/.test(String(id))) throw new Error('Bad id');
  const r = await galleryFetch(`/${id}/like`, { method: 'POST' });
  return { likes: Number(r.likes) || 0 };
}));
ipcMain.handle('gallery-publish', galleryOk(async (name, author) => {
  const cfg = state.active.style === 'image' ? Object.assign({}, state.active, { style: 'cross', image: '' }) : state.active;
  const body = JSON.stringify({ name: String(name || '').slice(0, 40), author: String(author || '').slice(0, 24), code: Crosshair.encode(cfg) });
  await galleryFetch('', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
  return {};
}));

// ---- Match reports ------------------------------------------------------------------------
function matchLabel() {
  return state.detector.target === 'window' ? state.detector.windowName || 'Window' : 'Whole screen';
}
function startMatch() {
  if (session) return;
  session = { start: Date.now(), label: matchLabel(), profile: currentProfile().name, alerts: [], runs: {} };
  refreshTray();
}
// Ends the current match. Long enough matches are saved and, if enabled, shown as a popup.
function endMatch(reason) {
  if (!session) return;
  const s = session;
  session = null;
  const report = Report.buildReport({ ...s, end: Date.now() });
  if (report.durationSec >= Report.MIN_MATCH_SEC) {
    state.reports = [report, ...state.reports].slice(0, 20);
    persist();
    if (state.reportPopup) showReport(report);
  }
  // A manual end while capture keeps running starts the next match straight away.
  if (reason === 'hotkey' || reason === 'tray') { if (analyzerRunning) startMatch(); }
  refreshTray();
  send('state', publicState());
}
function showReport(report) {
  if (reportWin && !reportWin.isDestroyed()) reportWin.destroy();
  const b = targetDisplay().workArea;
  const w = reportWin = new BrowserWindow({
    width: 360, height: 300, x: b.x + b.width - 372, y: b.y + b.height - 312,
    transparent: true, frame: false, resizable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.loadFile(path.join(__dirname, 'report', 'report.html'));
  w.webContents.once('did-finish-load', () => { if (!w.isDestroyed()) { w.webContents.send('report', report); w.showInactive(); } });
  w.on('closed', () => { if (reportWin === w) reportWin = null; });
  setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 30000);
}
ipcMain.on('analyzer-stats', (e, st) => {
  if (!analyzer || e.sender !== analyzer.webContents || !session || !st) return;
  const n = (v) => Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0);
  session.runs[String(n(st.run))] = { frames: n(st.frames), moving: n(st.moving), cuts: n(st.cuts), strong: n(st.strong), seconds: n(st.seconds) };
});
ipcMain.on('end-match', () => endMatch('tray'));
ipcMain.on('close-report', (e) => { if (reportWin && e.sender === reportWin.webContents) reportWin.destroy(); });
ipcMain.on('set-report-opts', (_e, d) => { if (d && typeof d.reportPopup === 'boolean') { state.reportPopup = d.reportPopup; persist(); send('state', publicState()); } });
ipcMain.on('show-report', (_e, id) => { const r = state.reports.find(x => x.id === id); if (r) showReport(r); });
ipcMain.on('clear-reports', () => { state.reports = []; persist(); send('state', publicState()); });

// ---- Per-game profiles ------------------------------------------------------------------
function currentProfile() { return state.profiles.find(p => p.id === state.profileId) || state.profiles[0]; }

// Copy the live settings into the active profile, so edits made while a profile is active stay with it.
function snapshotProfile() {
  const p = state && state.profiles && currentProfile();
  if (!p) return;
  p.crosshair = state.active;
  p.detector = Profiles.cleanDetector(state.detector);
}

function switchProfile(id, fg) {
  const next = state.profiles.find(p => p.id === id);
  if (!next) return;
  const newTitle = next.watch === 'game' && fg && fg.title && fg.title.slice(0, 120) !== state.detector.windowName;
  if (id === state.profileId && !newTitle && fg) return; // already active and watching the right window
  if (id !== state.profileId) {
    endMatch('profile switched');
    snapshotProfile();
    state.profileId = id;
    state.active = Crosshair.sanitize(next.crosshair);
    Object.assign(state.detector, next.detector);
  }
  // A profile set to watch its game captures that game's window; the title comes from the front window.
  if (next.watch === 'game' && fg && fg.title) { state.detector.target = 'window'; state.detector.windowName = fg.title.slice(0, 120); }
  else if (next.watch === 'screen' && id !== Profiles.DEFAULT_ID) state.detector.target = 'screen';
  persist(); placeOverlay(); syncAnalyzer(); syncDebug(); syncStatus(); refreshCapture(true);
  refreshTray(); applyVisibility();
}

function onForeground(fg) {
  const own = /^zeroed( |$)/i.test(fg.title) || /^zeroed$/i.test(fg.process);
  if (!own && fg.title) lastGame = { process: fg.process.slice(0, 80), title: fg.title.slice(0, 120) };
  const match = Profiles.matchProfile(state.profiles, fg);
  if (state.autoProfiles && match) switchProfile(match.id, fg);
  // Hide-when-unfocused: show the crosshair only while a profiled game (or Zeroed itself) is in front.
  const allowed = !state.hideUnfocused || own || !!match;
  if (allowed !== overlayAllowed) { overlayAllowed = allowed; applyVisibility(); }
  else send('state', publicState());
}

ipcMain.handle('profile-create', (_e, d) => {
  if (state.profiles.length >= Profiles.MAX_PROFILES) return { ok: false, error: `Up to ${Profiles.MAX_PROFILES} profiles.` };
  snapshotProfile();
  const p = { id: Profiles.newId(state.profiles), name: String((d && d.name) || 'New profile').trim().slice(0, 40) || 'New profile',
    match: String((d && d.match) || '').trim().slice(0, 80), watch: d && d.watch === 'game' ? 'game' : 'screen',
    crosshair: state.active, detector: Profiles.cleanDetector(state.detector) };
  state.profiles.push(p);
  switchProfile(p.id, lastGame);
  return { ok: true, id: p.id };
});
ipcMain.handle('profile-update', (_e, d) => {
  const p = d && state.profiles.find(x => x.id === d.id);
  if (!p) return { ok: false, error: 'Profile not found.' };
  if (typeof d.name === 'string') p.name = d.name.trim().slice(0, 40) || p.name;
  if (typeof d.match === 'string' && p.id !== Profiles.DEFAULT_ID) p.match = d.match.trim().slice(0, 80);
  if (d.watch === 'game' || d.watch === 'screen') p.watch = d.watch;
  persist(); refreshTray(); send('state', publicState());
  return { ok: true };
});
ipcMain.handle('profile-delete', (_e, id) => {
  if (id === Profiles.DEFAULT_ID) return { ok: false, error: 'The Default profile cannot be deleted.' };
  if (!state.profiles.some(p => p.id === id)) return { ok: false, error: 'Profile not found.' };
  if (state.profileId === id) switchProfile(Profiles.DEFAULT_ID);
  state.profiles = state.profiles.filter(p => p.id !== id);
  persist(); refreshTray(); send('state', publicState());
  return { ok: true };
});
ipcMain.on('profile-activate', (_e, id) => switchProfile(id, lastGame));
ipcMain.on('set-profile-opts', (_e, d) => {
  if (!d || typeof d !== 'object') return;
  if (typeof d.autoProfiles === 'boolean') state.autoProfiles = d.autoProfiles;
  if (typeof d.hideUnfocused === 'boolean') { state.hideUnfocused = d.hideUnfocused; if (!d.hideUnfocused) overlayAllowed = true; }
  persist(); applyVisibility();
});

ipcMain.handle('get-state', () => publicState());
ipcMain.on('set-active', (_e, cfg) => setActive(cfg));
ipcMain.on('set-visible', (_e, v) => { state.visible = !!v; persist(); applyVisibility(); });
ipcMain.on('set-display', (_e, i) => {
  if (!Number.isInteger(i) || i < 0 || i >= screen.getAllDisplays().length) return;
  state.display = i; persist(); placeOverlay();
  if (analyzer) { analyzer.destroy(); analyzer = null; syncAnalyzer(); } // re-target capture to the new display
  if (debugWin) { debugWin.destroy(); debugWin = null; syncDebug(); }
  if (statusWin) { statusWin.destroy(); statusWin = null; syncStatus(); }
  send('state', publicState());
});
ipcMain.handle('set-hotkeys', (_e, hk) => {
  const prev = state.hotkeys;
  state.hotkeys = Object.assign({}, prev);
  for (const k of Object.keys(prev)) if (hk && typeof hk[k] === 'string') state.hotkeys[k] = hk[k].slice(0, 40);
  const failed = registerHotkeys();
  if (failed.length) { state.hotkeys = prev; registerHotkeys(); return { ok: false, failed }; }
  persist(); send('state', publicState());
  return { ok: true };
});
ipcMain.on('save-preset', (_e, name) => {
  const clean = String(name || '').trim().slice(0, 40) || `Crosshair ${state.saved.length + 1}`;
  state.saved.push({ name: clean, cfg: state.active });
  persist(); send('state', publicState());
});
ipcMain.on('delete-preset', (_e, i) => {
  if (!Number.isInteger(i) || i < 0 || i >= state.saved.length) return;
  state.saved.splice(i, 1); persist(); send('state', publicState());
});
ipcMain.handle('export-code', () => { const code = Crosshair.encode(state.active); clipboard.writeText(code); return code; });
ipcMain.handle('import-code', (_e, code) => {
  try {
    const cfg = Crosshair.decode(code);
    state.saved.push({ name: `Imported ${state.saved.length + 1}`, cfg });
    state.saved = state.saved.slice(-100);
    setActive(cfg);
    return { ok: true };
  }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('export-file', async (_e, all) => {
  const list = all ? state.saved : [{ name: 'My crosshair', cfg: state.active }];
  if (!list.length) return { ok: false, error: 'Nothing to export' };
  const r = await dialog.showSaveDialog(panel, {
    title: all ? 'Export all saved crosshairs' : 'Export current crosshair',
    defaultPath: all ? 'crosshair-pack.zeroed' : 'crosshair.zeroed',
    filters: [{ name: 'Zeroed crosshairs', extensions: ['zeroed'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, Crosshair.toPack(list)); return { ok: true, count: list.length }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('import-file', async () => {
  const r = await dialog.showOpenDialog(panel, {
    title: 'Import crosshairs', properties: ['openFile'],
    filters: [{ name: 'Zeroed crosshairs', extensions: ['zeroed', 'sightline', 'json'] }]
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    if (fs.statSync(r.filePaths[0]).size > 8 * 1024 * 1024) throw new Error('File is too large');
    const items = Crosshair.parsePack(fs.readFileSync(r.filePaths[0], 'utf8'));
    state.saved.push(...items);
    state.saved = state.saved.slice(-100);
    setActive(items[0].cfg);
    return { ok: true, count: items.length };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(panel, { title: 'Choose a crosshair image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  const file = r.filePaths[0];
  const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
  const stat = fs.statSync(file);
  if (stat.size > 1024 * 1024) return { ok: false, error: 'Image must be under 1 MB' };
  const dataUrl = `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
  setActive(Object.assign({}, state.active, { style: 'image', image: dataUrl }));
  return { ok: true };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', createPanel);
  app.whenReady().then(() => {
    state = loadState();
    createOverlay();
    createTray();
    registerHotkeys();
    createPanel();
    syncAnalyzer();
    fgWatcher = watchForeground(onForeground);
    fgSupported = fgWatcher.supported;
    screen.on('display-metrics-changed', placeOverlay);
    screen.on('display-added', () => send('state', publicState()));
    screen.on('display-removed', () => { placeOverlay(); send('state', publicState()); });
  });
  app.on('window-all-closed', (e) => e.preventDefault()); // keep running in tray
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (fgWatcher) fgWatcher.stop(); });
}
