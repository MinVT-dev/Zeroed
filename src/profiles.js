// Per-game profiles: which crosshair and cheat-hint settings apply while a given game is in front.
// A profile matches when its match text appears in the front window's process name or title.
const Crosshair = require('./crosshair');
const { sanitizeTuning } = require('./detector');

const MAX_PROFILES = 30;
const DEFAULT_ID = 'default';

function defaultProfile(crosshair, detector) {
  return { id: DEFAULT_ID, name: 'Default', match: '', watch: 'screen', crosshair: Crosshair.sanitize(crosshair), detector: cleanDetector(detector) };
}

function cleanDetector(d) {
  d = d && typeof d === 'object' ? d : {};
  return {
    enabled: d.enabled === true,
    sensitivity: ['low', 'medium', 'high'].includes(d.sensitivity) ? d.sensitivity : 'medium',
    tuning: sanitizeTuning(d.tuning)
  };
}

function sanitizeProfile(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[a-z0-9]{1,16}$/.test(p.id)) return null;
  return {
    id: p.id,
    name: String(p.name || 'Profile').trim().slice(0, 40) || 'Profile',
    match: p.id === DEFAULT_ID ? '' : String(p.match || '').trim().slice(0, 80),
    watch: p.watch === 'game' ? 'game' : 'screen',
    crosshair: Crosshair.sanitize(p.crosshair),
    detector: cleanDetector(p.detector)
  };
}

// Always returns a list whose first entry is the Default profile, with unique ids.
function sanitizeProfiles(list, fallbackCrosshair, fallbackDetector) {
  const out = [], seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const p = sanitizeProfile(raw);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  let def = out.find(p => p.id === DEFAULT_ID);
  if (!def) def = defaultProfile(fallbackCrosshair, fallbackDetector);
  return [def, ...out.filter(p => p.id !== DEFAULT_ID)].slice(0, MAX_PROFILES);
}

// First non-default profile whose match text occurs in the process name or title (case-insensitive).
function matchProfile(profiles, fg) {
  if (!fg) return null;
  const hay = `${fg.process || ''}\n${fg.title || ''}`.toLowerCase();
  return profiles.find(p => p.id !== DEFAULT_ID && p.match && hay.includes(p.match.toLowerCase())) || null;
}

function newId(existing) {
  for (let i = 0; i < 100; i++) {
    const id = Math.random().toString(36).slice(2, 10);
    if (!existing.some(p => p.id === id)) return id;
  }
  throw new Error('could not allocate a profile id');
}

module.exports = { DEFAULT_ID, MAX_PROFILES, defaultProfile, sanitizeProfiles, matchProfile, cleanDetector, newId };
