const assert = require('assert');
const R = require('../src/report');

const start = 1_000_000;
const r = R.buildReport({
  start, end: start + 742_000, label: 'Roblox', profile: 'BRM5',
  alerts: [start + 251_400, start + 600_000],
  runs: { 3: { frames: 6000, moving: 2000, cuts: 3, strong: 2, seconds: 500 }, 4: { frames: 3120, moving: 1374, cuts: 1, strong: 1, seconds: 242 } }
});
assert.strictEqual(r.durationSec, 742);
assert.deepStrictEqual(r.alerts, [251, 600]);
assert.strictEqual(r.frames, 9120, 'capture restarts within a match add up');
assert.strictEqual(r.strong, 3);
assert.strictEqual(r.cuts, 4);
assert.strictEqual(r.movingPct, 37);
assert.strictEqual(r.fps, 12.3);
assert.ok(/2 alerts/.test(r.verdict));
assert.strictEqual(R.buildReport({ start, end: start + 90_000, runs: { 1: { frames: 900, seconds: 90 } } }).verdict, 'No suspicious aim patterns seen.');
assert.ok(/Too little/.test(R.buildReport({ start, end: start + 90_000, runs: {} }).verdict));

assert.strictEqual(R.formatDuration(742), '12:22');
assert.strictEqual(R.formatDuration(3725), '1:02:05');
assert.strictEqual(R.formatDuration(5), '0:05');

const back = R.sanitizeReports([r, null, 'x', { start: 'evil', alerts: ['1', -5, 'nope'], movingPct: 500, label: 'y'.repeat(500) }]);
assert.strictEqual(back.length, 2);
assert.deepStrictEqual(back[0], r);
assert.deepStrictEqual(back[1].alerts, [1, 0, 0]);
assert.strictEqual(back[1].movingPct, 100);
assert.strictEqual(back[1].label.length, 120);
console.log('report tests passed');
