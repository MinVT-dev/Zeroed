// Usage: npm run set-dev-key -- "your new password"
const fs = require('fs');
const path = require('path');
const { makeKey } = require('../src/devauth');

const pw = process.argv[2];
if (!pw || pw.length < 4) { console.error('Usage: npm run set-dev-key -- "<password, 4+ chars>"'); process.exit(1); }
fs.writeFileSync(path.join(__dirname, '..', 'src', 'devkey.json'), JSON.stringify(makeKey(pw), null, 2) + '\n');
console.log('Dev key updated. Rebuild the app for it to take effect in the .exe.');
