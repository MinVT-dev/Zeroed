const assert = require('assert');
const C = require('../src/crosshair');

// sanitize clamps and rejects junk
const s = C.sanitize({ style: 'evil', color: 'red', length: 9999, thickness: -5, opacity: 'x', image: 'javascript:alert(1)' });
assert.strictEqual(s.style, 'cross');
assert.strictEqual(s.color, C.DEFAULTS.color);
assert.strictEqual(s.length, C.RANGES.length[1]);
assert.strictEqual(s.thickness, C.RANGES.thickness[0]);
assert.strictEqual(s.opacity, C.DEFAULTS.opacity);
assert.strictEqual(s.image, '');
assert.deepStrictEqual(C.sanitize(null), C.DEFAULTS);

// share-code round trip
const cfg = C.sanitize({ style: 't', color: '#123abc', gap: 9, outline: false });
assert.deepStrictEqual(C.decode(C.encode(cfg)), cfg);
assert.throws(() => C.decode('hello'));
assert.throws(() => C.decode('SL1:' + Buffer.from('not json').toString('base64')));

// draw issues canvas calls without throwing, using a recording stub
const calls = [];
const ctx = new Proxy({}, { get: (_, k) => (...a) => { calls.push(k); }, set: () => true });
C.draw(ctx, cfg, 50, 50);
assert.ok(calls.includes('fillRect'));
C.draw(ctx, { style: 'circle' }, 50, 50);
assert.ok(calls.includes('arc'));
assert.ok(C.PRESETS.length >= 5);

// pack files round-trip and reject junk
const img = 'data:image/png;base64,iVBORw0KGgo=';
const pack = C.parsePack(C.toPack([{ name: 'A', cfg: { style: 'image', image: img } }, { name: 'B', cfg }]));
assert.strictEqual(pack.length, 2);
assert.strictEqual(pack[0].cfg.image, img);
assert.deepStrictEqual(pack[1].cfg, cfg);
assert.throws(() => C.parsePack('{"format":"other"}'));
assert.throws(() => C.parsePack('nope'));
assert.throws(() => C.parsePack('{"format":"sightline","crosshairs":[]}'));
assert.deepStrictEqual(C.decode('FH1:' + C.encode(cfg).slice(4)), cfg); // legacy prefix still accepted
// New share codes use the ZR1 prefix; older SL1 codes still import.
assert.ok(C.encode(cfg).startsWith('ZR1:'));
assert.deepStrictEqual(C.decode('SL1:' + C.encode(cfg).slice(4)), cfg);
assert.strictEqual(JSON.parse(C.toPack([{ name: 'x', cfg }])).format, 'zeroed');
assert.strictEqual(C.parsePack(JSON.stringify({ format: 'sightline', version: 1, crosshairs: [{ name: 'old', cfg }] }))[0].name, 'old', 'old .sightline files still import');
console.log('crosshair tests passed');
