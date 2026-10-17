const assert = require('assert');
const { Detector } = require('../src/detector');
const Motion = require('../src/motion');

const DT = 33;
function run(det, seq) { let t = 0, out = []; for (const [dx, dy] of seq) { t += DT; const a = det.push({ t, dx, dy }); if (a) out.push(a); } return out; }
const still = (n) => Array(n).fill([0, 0]);

// Bot-like: crisp two-frame snaps, then dead still, repeated.
const alerts = [];
const bot = new Detector({ sensitivity: 'medium', onAlert: a => alerts.push(a) });
const botSeq = []; for (let i = 0; i < 6; i++) botSeq.push([0.12, 0], [0.12, 0], ...still(10));
const out = run(bot, botSeq);
assert.strictEqual(out.length, 1, 'bot-like pattern should alert once (cooldown prevents repeats)');
assert.ok(out[0].confidence > 0 && out[0].confidence <= 0.9);

// Human-like: flicks that decelerate gradually with a correction tail.
const human = new Detector({ sensitivity: 'high' });
const flick = [[0.05, 0], [0.09, 0], [0.1, 0], [0.07, 0], [0.04, 0], [0.02, 0], [-0.015, 0], [0.01, 0.005], ...still(6)];
assert.strictEqual(run(human, Array(10).fill(flick).flat()).length, 0, 'human-like flicks should not alert');

// Snaps that end on empty scenery count half: the same bot-like sequence no longer alerts at 'medium' (needs weight 4).
const aimless = new Detector({ sensitivity: 'medium', weigh: () => 0.5 });
assert.strictEqual(run(aimless, botSeq).length, 0, 'half-weight snaps should not reach the threshold');
const aimed = new Detector({ sensitivity: 'medium', weigh: () => 1 });
assert.strictEqual(run(aimed, botSeq).length, 1);

// Scene cuts / stalled capture never count: no samples within 250ms of each other.
const gap = new Detector({ sensitivity: 'high' });
let t = 0, fired = 0;
for (let i = 0; i < 40; i++) { t += 400; if (gap.push({ t, dx: 0.3, dy: 0 })) fired++; }
assert.strictEqual(fired, 0);

// Motion estimation recovers a known horizontal pan and ignores brightness change.
const W = 128, H = 72;
const hash = (n) => (Math.imul(n ^ (n >>> 15), 2246822519) >>> 0) % 100; // aperiodic texture
const frame = (ox, oy, bright = 0) => { const g = new Uint8ClampedArray(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = Math.min(255, hash(x + ox + 1000) + hash(y + oy + 5000) + bright); return g; };
const p0 = Motion.profiles(frame(0, 0), W, H), p1 = Motion.profiles(frame(7, 0, 20), W, H);
const m = Motion.estimate(p0, p1, 30);
assert.strictEqual(Math.abs(m.dx), 7);
assert.strictEqual(m.dy, 0);
assert.deepStrictEqual(Motion.estimate(p0, p0, 30), { dx: 0, dy: 0 });
// Changed-fraction (centre check): identical crops -> 0, a moved patch -> > 0.
const base = frame(0, 0), moved = frame(0, 0);
for (let y = 28; y < 44; y++) for (let x = 56; x < 72; x++) moved[y * W + x] = 255;
assert.ok(Motion.changedFraction(base, moved) > 0.01);
assert.strictEqual(Motion.changedFraction(base, base), 0);

// Pan-compensated blobs: a box appears around an object that moves while the camera pans 5 px.
const A = frame(0, 0), B = frame(5, 0);                 // camera panned right by 5
for (let y = 30; y < 42; y++) for (let x = 60; x < 72; x++) B[y * W + x] = 255; // plus a moving object
const blobs = Motion.movingBlobs(A, B, W, H, 5, 0);
assert.ok(blobs.length >= 1, 'moving object found');
const bx = blobs[0];
assert.ok(bx.x * W < 72 && (bx.x + bx.w) * W > 60 && bx.y * H < 42 && (bx.y + bx.h) * H > 30, 'box overlaps the object');
assert.strictEqual(Motion.movingBlobs(A, frame(5, 0), W, H, 5, 0).length, 0, 'pure camera pan produces no boxes');

// Overrides: a stricter threshold silences an alert the preset would raise; clearing it restores the preset.
const strict = new Detector({ sensitivity: 'medium' }); strict.setOverride({ minSnaps: 99, minScore: 0.8 });
assert.strictEqual(run(strict, botSeq).length, 0);
const info = strict.debugInfo(); assert.strictEqual(info.needed, 99); assert.ok(info.strong >= 4);
strict.setOverride(null); assert.strictEqual(strict.debugInfo().needed, 4);
// Repeating texture + a figure walking past: the camera is still, so no pan should be reported.
const stripes = (objX) => { const g = new Uint8ClampedArray(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = (Math.floor(x / 4) % 2) ? 90 : 60; if (objX != null) for (let y = 30; y < 50; y++) for (let x = objX; x < objX + 6; x++) g[y * W + x] = 230; return g; };
const s0 = Motion.profiles(stripes(50), W, H), s1 = Motion.profiles(stripes(53), W, H);
assert.deepStrictEqual(Motion.estimate(s0, s1, 40), { dx: 0, dy: 0 }, 'periodic background must not alias into a pan');
assert.deepStrictEqual(Motion.estimate(Motion.profiles(stripes(), W, H), Motion.profiles(stripes(), W, H), 40), { dx: 0, dy: 0 });

// A flat-coloured moving object yields ONE merged box, not two edge slivers.
const one = Motion.movingBlobs(stripes(50), stripes(53), W, H, 0, 0);
assert.strictEqual(one.length, 1, 'edge slivers merged into one box');
assert.ok(one[0].x * W <= 50 && (one[0].x + one[0].w) * W >= 59, 'merged box spans the object');
// Two separate figures far apart stay as two boxes.
const two = (() => { const a = stripes(), b = stripes(); for (const [x0, g] of [[20, a], [23, b], [100, a], [103, b]]) for (let y = 30; y < 40; y++) for (let x = x0; x < x0 + 5; x++) g[y * W + x] = 230; return Motion.movingBlobs(a, b, W, H, 0, 0); })();
assert.strictEqual(two.length, 2, 'distant figures are not merged');
// Change-driven capture: while the picture is still, frames arrive ~300 ms apart; snaps must still be caught.
const sparse = new Detector({ sensitivity: 'medium' });
let ts = 0, sparseAlerts = 0;
const pushAt = (gap, dx) => { ts += gap; if (sparse.push({ t: ts, dx, dy: 0 })) sparseAlerts++; };
for (let k = 0; k < 6; k++) { pushAt(300, 0); pushAt(300, 0); pushAt(320, 0.12); pushAt(33, 0.12); pushAt(300, 0); pushAt(300, 0); }
assert.strictEqual(sparseAlerts, 1, 'snaps after long still gaps are timed at one frame interval, not the gap');

// A scene cut in the middle of a snap aborts it.
const cutDet = new Detector({ sensitivity: 'high' });
let tc = 0, cutAlerts = 0;
for (let k = 0; k < 6; k++) for (const smp of [[0.12, false], [0, true], ...Array(8).fill([0, false])]) { tc += 33; if (cutDet.push({ t: tc, dx: smp[0], dy: 0, cut: smp[1] })) cutAlerts++; }
assert.strictEqual(cutAlerts, 0, 'snaps interrupted by a cut never count');

// Cut detection: a real shift explains the frame; unrelated content does not.
assert.ok(!Motion.isCut(frame(0, 0), frame(5, 0), W, H, 5, 0), 'pan is not a cut');
assert.ok(Motion.isCut(frame(0, 0), frame(57, 31), W, H, 5, 0), 'unrelated frame is a cut');
// Tuning: sanitized, and it changes behaviour. A higher snap-speed bar silences the bot-like sequence.
const D = require('../src/detector');
assert.deepStrictEqual(D.sanitizeTuning({ fast: 99, minSnaps: 2.6, centre: 'nope', cuts: false, maxFps: 60, junk: 1 }), { fast: 6, minSnaps: 3, cuts: false });
assert.strictEqual(D.sanitizeTuning({}), null);
const slow = new Detector({ sensitivity: 'medium' }); slow.setTuning({ fast: 6 });
assert.strictEqual(run(slow, botSeq).length, 0, 'snaps slower than the tuned speed do not count');
const loose = new Detector({ sensitivity: 'low' }); loose.setTuning({ minSnaps: 2 });
assert.strictEqual(run(loose, botSeq).length, 1, 'tuned snap count overrides the preset');
assert.strictEqual(loose.cfg.minScore, D.LEVELS.low.minScore, 'untuned keys keep the preset');
console.log('detector tests passed');
