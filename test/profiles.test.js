const assert = require('assert');
const P = require('../src/profiles');
const { parseLine, PS_SCRIPT } = require('../src/foreground');

// sanitize: Default always first, junk dropped, duplicates removed, fields clamped
const list = P.sanitizeProfiles([
  { id: 'rbx', name: 'Roblox', match: 'RobloxPlayerBeta', watch: 'game', detector: { enabled: true, sensitivity: 'high', tuning: { fast: 3 } } },
  { id: 'rbx', name: 'dup' }, { id: 'BAD ID', name: 'x' }, null, 'junk',
  { id: 'cs2', name: 'x'.repeat(99), match: ' cs2 ' }
], { color: '#ff0000' }, { enabled: false });
assert.deepStrictEqual(list.map(p => p.id), ['default', 'rbx', 'cs2']);
assert.strictEqual(list[0].crosshair.color, '#ff0000', 'Default built from the live crosshair when missing');
assert.strictEqual(list[1].detector.tuning.fast, 3);
assert.strictEqual(list[2].name.length, 40);
assert.strictEqual(list[2].match, 'cs2');
assert.strictEqual(list[2].watch, 'screen');
assert.strictEqual(P.sanitizeProfiles([{ id: 'default', match: 'should be cleared' }])[0].match, '', 'Default never auto-matches');

// matching: case-insensitive on process name or title; Default never matches
assert.strictEqual(P.matchProfile(list, { process: 'RobloxPlayerBeta', title: 'Roblox' }).id, 'rbx');
assert.strictEqual(P.matchProfile(list, { process: 'cs2', title: 'Counter-Strike 2' }).id, 'cs2');
assert.strictEqual(P.matchProfile(list, { process: 'chrome', title: 'Some page' }), null);
assert.strictEqual(P.matchProfile(list, null), null);

// ids are unique
const ids = new Set(); for (let i = 0; i < 50; i++) ids.add(P.newId(list)); assert.strictEqual(ids.size, 50);

// foreground parsing of the PowerShell watcher output
assert.deepStrictEqual(parseLine('RobloxPlayerBeta\tRoblox'), { process: 'RobloxPlayerBeta', title: 'Roblox' });
assert.deepStrictEqual(parseLine('just a title'), { process: '', title: 'just a title' });
assert.ok(PS_SCRIPT.includes('`t'), 'PowerShell tab escape survives the JS template literal');
console.log('profiles tests passed');
