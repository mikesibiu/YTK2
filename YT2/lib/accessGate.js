const crypto = require('crypto');

const COOKIE_NAME = 'yt2_access';

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Access code for the child UI. A correct code earns a signed, expiring cookie
 * ("<expiryMs>.<hmac>"); nothing is stored server-side. Without a code configured
 * the gate is open.
 */
function createAccessGate({ code, secret, ttlMs = 30 * 24 * 60 * 60 * 1000, now = Date.now }) {
  const enabled = Boolean(code);
  // Derived key (so a shared secret is not reused raw). Random if unset: codes must be re-entered after a restart.
  const key = secret ? hash(`yt2-access:${secret}`) : crypto.randomBytes(32);

  // The code is part of the signed data, so changing the code invalidates every issued cookie.
  function sign(expiry) {
    return crypto.createHmac('sha256', key).update(`${expiry}:${hash(code || '').toString('hex')}`).digest('base64url');
  }

  function checkCode(input) {
    return enabled && typeof input === 'string' && safeEqual(input.trim(), code);
  }

  function issueToken() {
    const expiry = now() + ttlMs;
    return `${expiry}.${sign(expiry)}`;
  }

  function hasAccess(req) {
    if (!enabled) return true;
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return false;
    const [expiry, signature] = token.split('.');
    if (!expiry || !signature || !/^\d{1,16}$/.test(expiry)) return false;
    if (Number(expiry) <= now()) return false;
    return safeEqual(signature, sign(expiry));
  }

  function cookie(req, token, maxAgeSeconds) {
    return [
      `${COOKIE_NAME}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeSeconds}`,
      req.secure ? 'Secure' : ''
    ].filter(Boolean).join('; ');
  }

  function requireAccess(req, res, next) {
    if (hasAccess(req)) return next();
    return res.status(401).json({ error: 'locked', message: 'Enter the access code.' });
  }

  return {
    enabled,
    checkCode,
    hasAccess,
    requireAccess,
    unlockCookie: req => cookie(req, issueToken(), Math.floor(ttlMs / 1000)),
    lockCookie: req => cookie(req, '', 0)
  };
}

module.exports = { createAccessGate, COOKIE_NAME };
