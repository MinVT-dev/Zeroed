// Replays a gameplay recording through the same motion estimator and detector the app uses.
// Requires ffmpeg on PATH. Usage:
//   node scripts/analyze-recording.js <video> [--fps 30] [--sensitivity medium] [--json out.json]
// Prints every snap the detector scores and every alert it would raise, with timestamps.
const { execFileSync } = require('child_process');
const fs = require('fs');
const Motion = require('../src/motion');
const { Detector } = require('../src/detector');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file || !fs.existsSync(file)) { console.error('Usage: node scripts/analyze-recording.js <video> [--fps 30] [--sensitivity medium] [--json out.json]'); process.exit(1); }
const FPS = Number(opt('fps', 30));
const W = 128, H = 72, CW = 192, CH = 144;

// Decode once into grayscale frames: the full frame at analysis size, and a sharp centre crop for snap weighting.
const decode = (vf, size) => {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', `fps=${FPS},${vf},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  const n = Math.floor(buf.length / size), out = [];
  for (let i = 0; i < n; i++) out.push(new Uint8ClampedArray(buf.buffer, buf.byteOffset + i * size, size));
  return out;
};
const frames = decode(`scale=${W}:${H}:flags=area`, W * H);
const crops = decode(`crop=iw*0.3:ih*0.4:iw*0.35:ih*0.25,scale=${CW}:${CH}:flags=area`, CW * CH);

const snaps = [], alerts = [];
let idx = 0, settleCrop = null, wasSettling = false;
const detector = new Detector({
  sensitivity: opt('sensitivity', 'medium'),
  onAlert: (a) => alerts.push({ t: +(idx / FPS).toFixed(2), ...a }),
  weigh: () => {
    if (!settleCrop) return 1;
    const f = Motion.changedFraction(settleCrop, crops[idx]);
    settleCrop = null;
    return f >= 0.004 && f <= 0.45 ? 1 : 0.5;
  }
});

let prev = null, moving = 0, cuts = 0;
for (idx = 0; idx < frames.length; idx++) {
  const profile = Motion.profiles(frames[idx], W, H);
  if (prev) {
    const m = Motion.estimate(prev, profile, 40);
    const cut = (m.dx || m.dy) && Motion.isCut(frames[idx - 1], frames[idx], W, H, m.dx, m.dy);
    if (cut) cuts++; else if (m.dx || m.dy) moving++;
    detector.push(cut ? { t: (idx * 1000) / FPS, dx: 0, dy: 0, cut: true } : { t: (idx * 1000) / FPS, dx: m.dx / W, dy: m.dy / W });
    // snaps older than the detector's window are pruned from the front, so compare by timestamp, not index
    for (const s of detector.snaps) if (!snaps.some(x => x._t === s.t)) snaps.push({ _t: s.t, t: +(s.t / 1000).toFixed(2), score: +s.score.toFixed(2), weight: s.weight });
    const settling = detector.isSettling();
    if (settling && !wasSettling) settleCrop = crops[idx];
    if (!settling) settleCrop = null;
    wasSettling = settling;
  }
  prev = profile;
}

const strong = snaps.filter(s => s.score >= detector.cfg.minScore);
console.log(`${file}\n${frames.length} frames at ${FPS} fps (${(frames.length / FPS).toFixed(1)} s); camera moving in ${(100 * moving / Math.max(1, frames.length - 1)).toFixed(1)}% of frames; ${cuts} scene cuts ignored`);
console.log(`snaps scored: ${snaps.length}, strong (score >= ${detector.cfg.minScore}): ${strong.length}, alerts: ${alerts.length}`);
for (const s of strong) console.log(`  strong snap  t=${s.t}s  score ${s.score}  weight ${s.weight}`);
for (const a of alerts) console.log(`  ALERT        t=${a.t}s  snaps ${a.snaps}  confidence ~${Math.round(a.confidence * 100)}%`);
const out = opt('json');
if (out) fs.writeFileSync(out, JSON.stringify({ file, fps: FPS, frames: frames.length, snaps: snaps.map(({ _t, ...s }) => s), alerts }, null, 2));
