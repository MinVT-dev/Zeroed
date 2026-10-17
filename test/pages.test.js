// Every app page must exist, be non-empty, and contain each element its own scripts look up by id.
// (Regression guard: alert.html once shipped as an empty file, so alerts were invisible.)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const pages = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.html')) pages.push(p); } })(root);
assert.ok(pages.length >= 6, 'expected the app pages');

for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const rel = path.relative(root, page);
  assert.ok(/<body[\s>]/.test(html) && html.length > 100, `${rel} is empty or has no body`);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
    const file = path.join(path.dirname(page), src);
    assert.ok(fs.existsSync(file), `${rel} references missing script ${src}`);
    if (path.dirname(file) !== path.dirname(page)) continue; // shared modules (crosshair.js etc.) don't own page elements
    for (const [, id] of fs.readFileSync(file, 'utf8').matchAll(/getElementById\('([^']+)'\)/g)) {
      if (!ids.has(id)) assert.fail(`${rel}: script ${src} looks up #${id}, which the page does not contain`);
    }
    for (const [, id] of fs.readFileSync(file, 'utf8').matchAll(/\$\('([^']+)'\)/g)) {
      if (!ids.has(id)) assert.fail(`${rel}: script ${src} looks up #${id}, which the page does not contain`);
    }
  }
  for (const [, href] of html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(path.dirname(page), href)), `${rel} references missing stylesheet ${href}`);
}
console.log(`pages tests passed (${pages.length} pages)`);
