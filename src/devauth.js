// Dev-section gate. This is a convenience lock, not security: the check ships inside the app,
// so anyone able to edit the installed files can bypass it. It keeps casual users out of test settings.
const crypto = require('crypto');

function makeKey(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString('hex') };
}

function verify(password, key) {
  if (!key || typeof key.salt !== 'string' || typeof key.hash !== 'string') return false;
  const got = crypto.scryptSync(String(password), key.salt, 32);
  const want = Buffer.from(key.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { makeKey, verify };
