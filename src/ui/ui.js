const api = window.zeroed;
const $ = (id) => document.getElementById(id);
let state = null, detStatus = { running: false, note: '', error: '' };
const lastKeys = {}; // skip DOM rebuilds when lists haven't changed (slider drags fire render() constantly)

function say(id, msg, kind) { const n = $(id); n.textContent = msg || ''; n.classList.toggle('err', kind === 'err'); n.classList.toggle('ok', kind === 'ok'); }
function el(tag, props = {}, ...kids) { const e = document.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; }
function emptyRow(list, text) { list.append(el('li', {}, el('span', { className: 'empty', textContent: text }))); }

// ---------- Navigation ----------
function showPage(name) {
  for (const b of document.querySelectorAll('.nav')) {
    const on = b.dataset.page === name;
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  for (const p of document.querySelectorAll('.page')) p.hidden = p.id !== `page-${name}`;
  try { localStorage.setItem('zeroed.page', name); } catch { /* storage unavailable: start on Crosshair next time */ }
}
for (const b of document.querySelectorAll('.nav')) b.addEventListener('click', () => showPage(b.dataset.page));
try { const p = localStorage.getItem('zeroed.page'); if (p && $(`page-${p}`)) showPage(p); } catch { /* ignore */ }

// ---------- Slider rows ----------
function slider(container, { key, label, min, max, step, fmt = (v) => v, onInput }) {
  const id = `s-${key}`;
  const row = el('div', { className: 'row' });
  const lbl = el('label', { className: 'lbl', htmlFor: id, textContent: label });
  const input = el('input', { type: 'range', id, min, max, step });
  const out = el('output', { htmlFor: id });
  input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); onInput(Number(input.value)); });
  row.append(lbl, input, out);
  container.append(row);
  return { row, set(v) { if (document.activeElement !== input) input.value = v; out.textContent = fmt(Number(v)); } };
}

// ---------- Crosshair ----------
const R = Crosshair.RANGES;
const px = (v) => `${Math.round(v)} px`;
const CH = {
  shape: [
    ['length', 'Arm length', 1, px, ['cross', 't']], ['thickness', 'Arm thickness', 1, px, ['cross', 't']],
    ['gap', 'Centre gap', 1, px, ['cross', 't']], ['dotSize', 'Dot size', 1, px, null],
    ['circleRadius', 'Ring size', 1, px, ['circle']], ['circleThickness', 'Ring thickness', 1, px, ['circle']],
    ['scale', 'Image scale', 0.1, (v) => `${v.toFixed(1)}×`, ['image']], ['rotation', 'Rotation', 1, (v) => `${Math.round(v)}°`, null]
  ],
  color: [['opacity', 'Opacity', 0.05, (v) => `${Math.round(v * 100)}%`, null], ['outlineThickness', 'Outline width', 1, px, null]],
  pos: [['offsetX', 'Left / right', 1, px, null], ['offsetY', 'Up / down', 1, px, null]]
};
const chRows = {};
for (const [group, defs] of Object.entries(CH)) {
  const host = $({ shape: 'shapeSliders', color: 'colorSliders', pos: 'posSliders' }[group]);
  for (const [key, label, step, fmt, styles] of defs) {
    chRows[key] = { styles, ...slider(host, { key, label, min: R[key][0], max: R[key][1], step, fmt, onInput: (v) => update({ [key]: v }) }) };
  }
}

function update(patch) {
  state.active = Crosshair.sanitize(Object.assign({}, state.active, patch));
  api.setActive(state.active);
  render();
}

const SCENES = { dark: ['#20261b', '#11140e'], mid: ['#7c8577', '#545b4f'], light: ['#dfe6ea', '#b9c2a8'] };
let scene = 'dark';
function drawPreview() {
  const c = $('preview'), ctx = c.getContext('2d');
  const [sky, ground] = SCENES[scene];
  ctx.fillStyle = sky; ctx.fillRect(0, 0, c.width, c.height * 0.55);
  ctx.fillStyle = ground; ctx.fillRect(0, c.height * 0.55, c.width, c.height * 0.45);
  Crosshair.draw(ctx, state.active, c.width / 2, c.height / 2, drawPreview);
}
for (const r of document.querySelectorAll('input[name=bg]')) r.addEventListener('change', () => { scene = r.value; drawPreview(); });
for (const r of document.querySelectorAll('input[name=style]')) r.addEventListener('change', () => update({ style: r.value }));
$('color').addEventListener('input', (e) => update({ color: e.target.value }));
$('outlineColor').addEventListener('input', (e) => update({ outlineColor: e.target.value }));
$('dot').addEventListener('change', (e) => update({ dot: e.target.checked }));
$('outline').addEventListener('change', (e) => update({ outline: e.target.checked }));
$('recenter').addEventListener('click', () => update({ offsetX: 0, offsetY: 0 }));
$('pickImage').addEventListener('click', async () => { const r = await api.pickImage(); if (r && r.error) say('saveMsg', r.error, 'err'); });
$('savePreset').addEventListener('click', () => {
  const name = $('presetName').value.trim();
  api.savePreset(name);
  $('presetName').value = '';
  say('saveMsg', `Saved${name ? ` "${name}"` : ''} to your library.`, 'ok');
});
$('visible').addEventListener('change', (e) => api.setVisible(e.target.checked));

// ---------- Profiles ----------
$('topProfile').addEventListener('change', (e) => api.profileActivate(e.target.value));
$('autoProfiles').addEventListener('change', (e) => api.setProfileOpts({ autoProfiles: e.target.checked }));
$('hideUnfocused').addEventListener('change', (e) => api.setProfileOpts({ hideUnfocused: e.target.checked }));

function editProfile(p) {
  $('pfId').value = p ? p.id : '';
  $('pfName').value = p ? p.name : '';
  $('pfMatch').value = p ? p.match : '';
  $('pfMatch').disabled = !!p && p.id === 'default';
  $('pfWatch').value = p ? p.watch : 'game';
  $('profileFormTitle').textContent = p ? `Edit ${p.name}` : 'New profile';
  $('pfSubmit').textContent = p ? 'Save changes' : 'Create from current settings';
  $('pfCancel').hidden = !p;
  say('pfMsg', '');
  if (p) $('pfName').focus();
}
$('pfCancel').addEventListener('click', () => editProfile(null));
$('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = { id: $('pfId').value, name: $('pfName').value, match: $('pfMatch').value, watch: $('pfWatch').value };
  if (!d.name.trim()) return say('pfMsg', 'Give the profile a name.', 'err');
  const r = d.id ? await api.profileUpdate(d) : await api.profileCreate(d);
  if (!r.ok) return say('pfMsg', r.error, 'err');
  editProfile(null);
  say('pfMsg', d.id ? 'Profile saved.' : 'Profile created and switched to it.', 'ok');
});

function renderProfiles() {
  const top = $('topProfile');
  const key = JSON.stringify([state.profiles, state.profileId]);
  if (key !== lastKeys.profiles) {
    lastKeys.profiles = key;
    top.innerHTML = '';
    for (const p of state.profiles) top.add(new Option(p.name, p.id, false, p.id === state.profileId));
    const list = $('profileList');
    list.innerHTML = '';
    for (const p of state.profiles) {
      const active = p.id === state.profileId;
      const info = el('div', { className: 'grow' },
        el('div', { className: 'title', textContent: p.name }),
        el('div', { className: 'sub', textContent: p.id === 'default' ? 'Used when no other profile matches' : `Window contains "${p.match || '(nothing set)'}" · watches ${p.watch === 'game' ? 'the game window' : 'the whole screen'}` }));
      const li = el('li', {}, info);
      if (active) li.append(el('span', { className: 'tag', textContent: 'Active' }));
      else li.append(el('button', { className: 'btn', textContent: 'Use now', onclick: () => api.profileActivate(p.id) }));
      li.append(el('button', { className: 'btn', textContent: 'Edit', onclick: () => editProfile(p) }));
      if (p.id !== 'default') li.append(el('button', { className: 'btn danger', textContent: 'Delete', onclick: async () => { const r = await api.profileDelete(p.id); if (!r.ok) say('pfMsg', r.error, 'err'); } }));
      list.append(li);
    }
  }
  $('autoProfiles').checked = state.autoProfiles;
  $('hideUnfocused').checked = state.hideUnfocused;
  const fg = state.foreground, note = $('fgNote');
  const fgKey = JSON.stringify(fg);
  if (fgKey !== lastKeys.fg) {
    lastKeys.fg = fgKey;
    note.textContent = '';
    note.classList.remove('err');
    if (!fg.supported) note.textContent = 'Automatic switching is not available on this system. You can still switch profiles from the top bar or the tray.';
    else if (!fg.last) note.textContent = 'No game window seen yet. Switch to your game for a moment and it shows up here.';
    else {
      note.append(`Last game window: ${fg.last.process ? `${fg.last.process} · ` : ''}${fg.last.title} `);
      note.append(el('button', { className: 'btn', textContent: 'Use for a new profile', onclick: () => { editProfile(null); $('pfName').value = fg.last.title.slice(0, 40); $('pfMatch').value = (fg.last.process || fg.last.title).slice(0, 80); $('pfName').focus(); } }));
    }
  }
  const cur = state.profiles.find(p => p.id === state.profileId);
  const note2 = $('editingNote');
  note2.textContent = '';
  note2.append('Editing profile ', el('strong', { textContent: cur ? cur.name : 'Default' }), '. Changes save to it automatically.');
}

// ---------- Cheat hints ----------
const D = Detector;
const TUNE = [
  ['fast', 'Snap speed', 0.25, (v) => `${v.toFixed(2)} screens/s`],
  ['minDisp', 'Smallest snap', 0.01, (v) => `${Math.round(v * 100)}% of screen`],
  ['settleMs', 'Hold-still time', 10, (v) => `${Math.round(v)} ms`],
  ['minSnaps', 'Snaps needed', 1, (v) => `${Math.round(v)}`],
  ['minScore', 'Crispness needed', 0.05, (v) => `${Math.round(v * 100)}%`],
  ['windowMs', 'Counting window', 1000, (v) => `${Math.round(v / 1000)} s`],
  ['cooldownMs', 'Alert cooldown', 5000, (v) => `${Math.round(v / 1000)} s`]
];
const effTuning = () => Object.assign({}, D.DEFAULTS, D.LEVELS[state.detector.sensitivity] || D.LEVELS.medium, state.detector.tuning || {});
const tuneRows = {};
for (const [key, label, step, fmt] of TUNE) {
  tuneRows[key] = slider($('tuneSliders'), { key: `t-${key}`, label, min: D.RANGES[key][0], max: D.RANGES[key][1], step, fmt, onInput: (v) => setTune({ [key]: v }) });
}
function setTune(patch) {
  const t = Object.assign(effTuning(), patch);
  const tuning = {};
  for (const k of [...Object.keys(D.RANGES), 'centre', 'cuts', 'maxFps']) tuning[k] = t[k];
  state.detector.tuning = tuning;
  api.setDetector({ tuning });
  renderHints();
}
$('tuneCentre').addEventListener('change', (e) => setTune({ centre: e.target.value }));
$('tuneCuts').addEventListener('change', (e) => setTune({ cuts: e.target.checked }));
$('tuneFps').addEventListener('change', (e) => setTune({ maxFps: Number(e.target.value) }));
$('tuneReset').addEventListener('click', () => { state.detector.tuning = null; api.setDetector({ tuning: null }); renderHints(); });
for (const r of document.querySelectorAll('input[name=sens]')) r.addEventListener('change', () => { state.detector.tuning = null; api.setDetector({ sensitivity: r.value, tuning: null }); });

$('detOn').addEventListener('change', (e) => { detStatus = { running: false, note: e.target.checked ? 'Starting…' : '' }; api.setDetector({ enabled: e.target.checked }); });
$('detTarget').addEventListener('change', (e) => api.setDetector({ target: e.target.value }));
$('detWindow').addEventListener('change', (e) => api.setDetector({ windowName: e.target.value }));
$('detBadge').addEventListener('change', (e) => api.setDetector({ badge: e.target.checked }));
$('detSound').addEventListener('change', (e) => api.setDetector({ sound: e.target.checked }));
let winListLoaded = false;
async function loadWindows() {
  winListLoaded = true;
  const sel = $('detWindow'), cur = state.detector.windowName;
  sel.innerHTML = '';
  sel.add(new Option('Loading windows…', ''));
  const r = await api.listWindows();
  sel.innerHTML = '';
  const names = (r && r.windows) || [];
  sel.add(new Option(names.length ? 'Choose a window…' : 'No windows found. Open your game, then Refresh.', ''));
  for (const name of names) sel.add(new Option(name, name));
  if (cur && !names.includes(cur)) sel.add(new Option(`${cur} (not open)`, cur));
  sel.value = cur;
}
$('winRefresh').addEventListener('click', loadWindows);
api.onDetectorStatus((s) => { detStatus = s; renderHints(); });

function renderHints() {
  const d = state.detector;
  $('detOn').checked = d.enabled;
  $('detTarget').value = d.target;
  $('winRow').hidden = d.target !== 'window';
  if (d.target === 'window' && !winListLoaded) loadWindows();
  $('detBadge').checked = d.badge !== false;
  $('detSound').checked = d.sound !== false;
  for (const r of document.querySelectorAll('input[name=sens]')) r.checked = !d.tuning && r.value === d.sensitivity;
  $('sensNote').textContent = d.tuning
    ? 'Custom: your advanced tuning is in use. Pick a level to go back to its preset.'
    : { low: 'Fewest alerts: needs more, crisper snaps.', medium: 'Balanced. A good starting point.', high: 'Most alerts, and more false alarms.' }[d.sensitivity];
  const t = effTuning();
  for (const [key] of TUNE) tuneRows[key].set(t[key]);
  $('tuneCentre').value = t.centre; $('tuneCuts').checked = t.cuts; $('tuneFps').value = String(t.maxFps);

  // status block: the focal point of this page
  let label = 'Off', dot = '', detail = 'Turn this on to watch for suspicious aim.';
  if (d.enabled) {
    if (detStatus.running) { label = d.target === 'window' ? `Watching ${d.windowName}` : 'Watching the screen'; dot = 'watching'; detail = state.matchOpen ? 'Recording a match. A report appears when it ends.' : ''; }
    else if (detStatus.error) { label = 'Capture error'; dot = 'error'; detail = detStatus.error; }
    else { label = detStatus.note && detStatus.note !== 'Starting…' ? 'Waiting' : 'Starting'; detail = detStatus.note || 'Getting the capture ready.'; }
  }
  $('hintState').textContent = label;
  $('hintDot').className = `state-dot ${dot}`;
  $('hintDetail').textContent = detail;

  const log = $('alertLog');
  const key = (state.alerts || []).map(a => a.at).join(',');
  if (key !== lastKeys.alerts) {
    lastKeys.alerts = key;
    log.innerHTML = '';
    if (!state.alerts.length) emptyRow(log, 'No alerts this session. That is the normal result: alerts only fire on repeated, very crisp snaps.');
    for (const a of state.alerts) log.append(el('li', {}, `${a.test ? 'Test alert · ' : ''}${new Date(a.at).toLocaleTimeString()} · ${a.snaps} crisp snaps · confidence about ${Math.round(a.confidence * 100)}%`));
  }
}

// ---------- Match reports ----------
$('reportPopup').addEventListener('change', (e) => api.setReportOpts({ reportPopup: e.target.checked }));
$('endMatch').addEventListener('click', () => api.endMatch());
$('clearReports').addEventListener('click', () => { if (state.reports.length) api.clearReports(); });
const openReports = new Set();
function renderReports() {
  $('reportPopup').checked = state.reportPopup;
  $('endMatch').disabled = !state.matchOpen;
  $('clearReports').disabled = !state.reports.length;
  $('matchNote').textContent = state.matchOpen ? 'A match is being recorded now.'
    : state.detector.enabled ? 'No match running. One starts when cheat hints begins watching.' : 'Turn on cheat hints to record matches.';
  const list = $('reportList');
  const key = JSON.stringify([state.reports.map(r => r.id), [...openReports]]);
  if (key === lastKeys.reports) return;
  lastKeys.reports = key;
  list.innerHTML = '';
  if (!state.reports.length) return emptyRow(list, 'No match reports yet. A report is saved after cheat hints has watched a match for at least a minute.');
  for (const r of state.reports) {
    const when = new Date(r.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const li = el('li', {},
      el('div', { className: 'grow' },
        el('div', { className: 'title', textContent: `${r.profile || r.label} · ${Report.formatDuration(r.durationSec)}` }),
        el('div', { className: 'sub', textContent: `${when} · ${r.verdict}` })));
    li.append(el('span', { className: r.alerts.length ? 'tag alert' : 'tag', textContent: r.alerts.length ? `${r.alerts.length} alert${r.alerts.length === 1 ? '' : 's'}` : 'Clean' }));
    const open = openReports.has(r.id);
    li.append(el('button', { className: 'btn', textContent: open ? 'Hide details' : 'Details', ariaExpanded: String(open), onclick: () => { if (open) openReports.delete(r.id); else openReports.add(r.id); renderReports(); } }));
    li.append(el('button', { className: 'btn', textContent: 'Show popup', onclick: () => api.showReport(r.id) }));
    if (open) {
      const dl = el('dl', { className: 'report-detail' });
      const add = (k, v) => dl.append(el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: v })));
      add('Watched', r.label); add('Duration', Report.formatDuration(r.durationSec));
      add('Alerts at', r.alerts.length ? r.alerts.map(Report.formatDuration).join(', ') : 'None');
      add('Crisp snaps seen', String(r.strong)); add('Camera moving', `${r.movingPct}% of frames`);
      add('Scene cuts ignored', String(r.cuts)); add('Frames analysed', `${r.frames} (about ${r.fps} per second)`);
      li.append(dl);
    }
    list.append(li);
  }
}

// ---------- Library ----------
function renderLibrary() {
  const list = $('presets');
  const key = JSON.stringify(state.saved.map(p => p.name));
  if (key === lastKeys.presets) return;
  lastKeys.presets = key;
  list.innerHTML = '';
  if (!state.saved.length) emptyRow(list, 'Nothing saved yet. Use "Save to library" on the Crosshair page.');
  state.saved.forEach((p, i) => {
    list.append(el('li', {},
      el('div', { className: 'grow' }, el('div', { className: 'title', textContent: p.name })),
      el('button', { className: 'btn', textContent: 'Use', onclick: () => { state.active = state.saved[i].cfg; api.setActive(state.active); render(); } }),
      el('button', { className: 'btn danger', textContent: 'Delete', ariaLabel: `Delete ${p.name}`, onclick: () => api.deletePreset(i) })));
  });
}
const fileResult = (verb) => (r) => {
  if (r.ok) say('shareMsg', `${verb} ${r.count} crosshair${r.count === 1 ? '' : 's'}.`, 'ok');
  else if (r.error) say('shareMsg', r.error, 'err');
};
$('exportCode').addEventListener('click', async () => say('shareMsg', `Copied to clipboard: ${(await api.exportCode()).slice(0, 32)}…`, 'ok'));
$('exportFile').addEventListener('click', async () => fileResult('Exported')(await api.exportFile(false)));
$('exportAll').addEventListener('click', async () => fileResult('Exported')(await api.exportFile(true)));
$('importFile').addEventListener('click', async () => fileResult('Imported')(await api.importFile()));
$('importCode').addEventListener('click', async () => {
  if (!$('code').value.trim()) return say('shareMsg', 'Paste a share code first.', 'err');
  const r = await api.importCode($('code').value);
  say('shareMsg', r.ok ? 'Imported and saved to your library.' : r.error, r.ok ? 'ok' : 'err');
});

async function browse() {
  const ul = $('galList');
  ul.innerHTML = '';
  emptyRow(ul, 'Loading the gallery…');
  const r = await api.galleryList($('galQ').value, $('galSort').value);
  ul.innerHTML = '';
  if (!r.ok) { emptyRow(ul, `Could not reach the gallery: ${r.error}. Check the server address above.`); return; }
  if (!r.items.length) { emptyRow(ul, 'No crosshairs match. Try another search, or publish the first one.'); return; }
  for (const i of r.items) {
    const like = el('button', { className: 'btn', textContent: `Like (${i.likes})`, ariaLabel: `Like ${i.name}` });
    like.onclick = async () => { const l = await api.galleryLike(i.id); if (l.ok) like.textContent = `Like (${l.likes})`; else say('galMsg', l.error, 'err'); };
    ul.append(el('li', {},
      el('div', { className: 'grow' }, el('div', { className: 'title', textContent: i.name }), el('div', { className: 'sub', textContent: `by ${i.author}` })),
      el('button', { className: 'btn', textContent: 'Add to library', onclick: async () => { const a = await api.galleryAdd(i.id, i.name); say('galMsg', a.ok ? `Added "${i.name}" and switched to it.` : a.error, a.ok ? 'ok' : 'err'); } }),
      like));
  }
}
$('galSave').addEventListener('click', async () => { const r = await api.setGalleryUrl($('galUrl').value); say('galMsg', r.ok ? 'Server address saved.' : r.error, r.ok ? 'ok' : 'err'); });
$('galGo').addEventListener('click', browse);
$('galPub').addEventListener('click', async () => {
  if (!$('galName').value.trim()) return say('galMsg', 'Give the crosshair a name first.', 'err');
  const r = await api.galleryPublish($('galName').value, $('galAuthor').value);
  say('galMsg', r.ok ? 'Published. Custom images are not shared.' : r.error, r.ok ? 'ok' : 'err');
});

// ---------- Settings ----------
$('display').addEventListener('change', (e) => api.setDisplay(Number(e.target.value)));
for (const box of document.querySelectorAll('.hk')) {
  box.readOnly = true;
  box.addEventListener('keydown', async (e) => {
    if (e.key === 'Tab') return; // keep keyboard navigation working
    e.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    const parts = [];
    if (e.ctrlKey) parts.push('Control');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Super');
    parts.push(e.key.length === 1 ? e.key.toUpperCase() : ({ ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[e.key] || e.key));
    const r = await api.setHotkeys({ [box.dataset.k]: parts.join('+') });
    say('hkMsg', r.ok ? 'Hotkey saved.' : `Could not use ${r.failed.join(', ')}: another app has it, or it is not a valid key.`, r.ok ? 'ok' : 'err');
  });
}
$('devUnlock').addEventListener('click', async () => {
  const r = await api.devUnlock($('devKey').value);
  $('devKey').value = '';
  say('devMsg', r.ok ? 'Unlocked until Zeroed restarts.' : r.error, r.ok ? 'ok' : 'err');
});
$('devKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('devUnlock').click(); });
$('devLockBtn').addEventListener('click', () => { api.devLock(); say('devMsg', 'Locked.'); });
$('devDebug').addEventListener('change', (e) => api.devSet({ debug: e.target.checked }));
const sendOverride = () => api.devSet({ override: $('devOv').checked ? { minSnaps: Number($('devSnaps').value), minScore: Number($('devScore').value) } : null });
$('devOv').addEventListener('change', sendOverride);
$('devSnaps').addEventListener('input', () => { $('devSnapsO').textContent = $('devSnaps').value; sendOverride(); });
$('devScore').addEventListener('input', () => { $('devScoreO').textContent = `${Math.round(Number($('devScore').value) * 100)}%`; sendOverride(); });
$('devTest').addEventListener('click', () => api.devTestAlert());

function renderSettings() {
  const sel = $('display');
  const key = JSON.stringify([state.displays, state.display]);
  if (key !== lastKeys.disp) {
    lastKeys.disp = key;
    sel.innerHTML = '';
    for (const d of state.displays) sel.add(new Option(d.label, d.index, false, d.index === state.display));
  }
  for (const box of document.querySelectorAll('.hk')) if (document.activeElement !== box) box.value = state.hotkeys[box.dataset.k] || '';
  const dev = state.dev && state.dev.unlocked;
  $('devLocked').hidden = dev; $('devOpen').hidden = !dev;
  if (dev) {
    const ov = state.detector.override;
    $('devDebug').checked = !!state.detector.debug;
    $('devOv').checked = !!ov;
    $('devSnaps').disabled = $('devScore').disabled = !ov;
    if (ov) { $('devSnaps').value = ov.minSnaps; $('devScore').value = ov.minScore; }
    $('devSnapsO').textContent = $('devSnaps').value;
    $('devScoreO').textContent = `${Math.round(Number($('devScore').value) * 100)}%`;
  }
}

// ---------- Render ----------
function render() {
  const a = state.active;
  $('visible').checked = state.visible;
  $('visibleLabel').textContent = state.visible ? 'Crosshair on' : 'Crosshair off';
  for (const r of document.querySelectorAll('input[name=style]')) r.checked = r.value === a.style;
  $('imageRow').hidden = a.style !== 'image';
  $('color').value = a.color; $('outlineColor').value = a.outlineColor;
  $('dot').checked = a.dot; $('outline').checked = a.outline;
  for (const [key, row] of Object.entries(chRows)) { row.row.hidden = !!row.styles && !row.styles.includes(a.style); row.set(a[key]); }
  drawPreview();
  renderProfiles(); renderHints(); renderReports(); renderLibrary(); renderSettings();
}

api.onState((s) => { state = s; render(); });
api.getState().then((s) => { state = s; render(); });
