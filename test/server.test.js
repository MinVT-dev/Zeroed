const assert = require('assert');
const os = require('os');
const path = require('path');
const { createServer } = require('../server/server');
const C = require('../src/crosshair');

(async () => {
  const server = createServer({ dataFile: path.join(os.tmpdir(), `sl-test-${process.pid}.json`), adminToken: 'secret' });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/crosshairs`;
  const call = async (p, opt = {}) => { const r = await fetch(base + p, opt); return { status: r.status, body: await r.json() }; };
  const post = (p, body) => call(p, { method: 'POST', body: JSON.stringify(body) });

  const code = C.encode({ style: 't', color: '#112233' });
  let r = await post('', { name: 'Test <b>x</b>', author: 'me', code });
  assert.strictEqual(r.status, 201);
  assert.ok(!/[<>]/.test(r.body.name));
  const id = r.body.id;
  assert.strictEqual((await post('', { name: 'dup', code })).body.id, id, 'identical code is deduplicated');
  assert.strictEqual((await post('', { name: 'bad', code: 'SL1:AAAA' })).status, 400);
  assert.strictEqual((await post('', { name: '', code })).status, 400);
  assert.strictEqual((await post(`/${id}/like`, {})).body.likes, 1);
  assert.strictEqual((await post(`/${id}/like`, {})).body.likes, 1, 'one like per client');
  assert.strictEqual((await post(`/${id}/download`, {})).body.downloads, 1);
  assert.strictEqual((await call('?q=test')).body.length, 1);
  assert.strictEqual((await call('?q=zzz')).body.length, 0);
  assert.strictEqual((await call(`/${id}`, { method: 'DELETE' })).status, 403);
  assert.strictEqual((await call(`/${id}`, { method: 'DELETE', headers: { 'x-admin-token': 'secret' } })).status, 200);
  assert.strictEqual((await call('')).body.length, 0);
  const big = await fetch(base, { method: 'POST', body: 'x'.repeat(10000) }).then(r => r.status).catch(() => 'closed');
  assert.ok(big === 413 || big === 'closed');
  server.close();
  console.log('server tests passed');
})().catch(e => { console.error(e); process.exit(1); });
