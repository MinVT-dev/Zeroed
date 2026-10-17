// Zeroed community gallery: a tiny dependency-free HTTP server that stores share codes.
// Run: node server/server.js   (PORT, DATA_FILE, ADMIN_TOKEN, TRUST_PROXY env vars)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Crosshair = require('../src/crosshair');

const MAX_BODY = 4096;
const MAX_ITEMS = 5000;
const POSTS_PER_HOUR = 5;

function createServer({ dataFile = path.join(__dirname, 'data.json'), adminToken = '', trustProxy = false } = {}) {
  let items = [];
  try { items = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { /* new store */ }
  const likes = new Map();   // id -> Set(ipHash)
  const posts = new Map();   // ipHash -> [timestamps]
  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { fs.writeFileSync(dataFile, JSON.stringify(items)); } catch (e) { console.error(e.message); } }, 300);
  };
  const ipHash = (req) => {
    const ip = (trustProxy && req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
    return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
  };
  const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
  const pub = (i) => ({ id: i.id, name: i.name, author: i.author, code: i.code, likes: i.likes, downloads: i.downloads, created: i.created });

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
      req.on('error', reject);
    });
  }
  const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const m = /^\/api\/crosshairs(?:\/([a-f0-9]{12}))?(?:\/(like|download))?$/.exec(url.pathname);
      if (!m) return reply(res, 404, { error: 'Not found' });
      const [, id, action] = m;

      if (req.method === 'GET' && !id) {
        const q = clean(url.searchParams.get('q'), 40).toLowerCase();
        const sort = url.searchParams.get('sort') === 'top' ? 'top' : 'new';
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        let list = q ? items.filter(i => i.name.toLowerCase().includes(q) || i.author.toLowerCase().includes(q)) : items.slice();
        list.sort(sort === 'top' ? (a, b) => (b.likes * 3 + b.downloads) - (a.likes * 3 + a.downloads) : (a, b) => b.created - a.created);
        return reply(res, 200, list.slice(0, limit).map(pub));
      }
      if (req.method === 'POST' && !id) {
        const ih = ipHash(req), now = Date.now();
        const recent = (posts.get(ih) || []).filter(t => now - t < 3600e3);
        if (recent.length >= POSTS_PER_HOUR) return reply(res, 429, { error: 'Too many uploads, try again later' });
        const body = await readJson(req);
        let code;
        try { code = Crosshair.encode(Crosshair.decode(String(body.code))); } catch (e) { return reply(res, 400, { error: e.message }); }
        const name = clean(body.name, 40);
        if (!name) return reply(res, 400, { error: 'Name required' });
        const existing = items.find(i => i.code === code);
        if (existing) return reply(res, 200, pub(existing));
        if (items.length >= MAX_ITEMS) return reply(res, 507, { error: 'Gallery is full' });
        const item = { id: crypto.randomBytes(6).toString('hex'), name, author: clean(body.author, 24) || 'anonymous', code, likes: 0, downloads: 0, created: now };
        items.push(item); recent.push(now); posts.set(ih, recent); save();
        return reply(res, 201, pub(item));
      }
      const item = id && items.find(i => i.id === id);
      if (id && !item) return reply(res, 404, { error: 'Not found' });
      if (req.method === 'POST' && action === 'like') {
        const set = likes.get(id) || new Set(); const ih = ipHash(req);
        if (!set.has(ih)) { set.add(ih); likes.set(id, set); item.likes++; save(); }
        return reply(res, 200, pub(item));
      }
      if (req.method === 'POST' && action === 'download') { item.downloads++; save(); return reply(res, 200, pub(item)); }
      if (req.method === 'DELETE' && !action) {
        const tok = String(req.headers['x-admin-token'] || '');
        const ok = adminToken && tok.length === adminToken.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(adminToken));
        if (!ok) return reply(res, 403, { error: 'Forbidden' });
        items = items.filter(i => i.id !== id); save();
        return reply(res, 200, { ok: true });
      }
      return reply(res, 405, { error: 'Method not allowed' });
    } catch (e) { reply(res, e.status || 500, { error: e.status ? e.message : 'Server error' }); }
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  createServer({ dataFile: process.env.DATA_FILE || undefined, adminToken: process.env.ADMIN_TOKEN || '', trustProxy: process.env.TRUST_PROXY === '1' })
    .listen(port, () => console.log(`Zeroed gallery listening on :${port}`));
}
module.exports = { createServer };
