const crypto = require('crypto');

function parseBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }

  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1)
  };
}

// Constant-time comparison. Both sides are hashed first so timingSafeEqual always
// receives equal-length buffers and the length of the secret is not leaked.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * @param {string} adminUsername
 * @param {string} adminPassword
 * @param {{ allowOpenWhenUnset?: boolean }} [options]
 *   allowOpenWhenUnset: dev convenience (like YTK2). When false (default) and no
 *   credentials are configured, every request is rejected (fail closed).
 */
function createRequireAdminAuth(adminUsername, adminPassword, options = {}) {
  const { allowOpenWhenUnset = false } = options;

  return function requireAdminAuth(req, res, next) {
    if (!adminUsername || !adminPassword) {
      if (allowOpenWhenUnset) {
        return next();
      }
      return res.status(503).json({ error: 'Admin credentials are not configured' });
    }

    const parsed = parseBasicAuth(req.headers.authorization || '');
    if (!parsed) {
      res.set('WWW-Authenticate', 'Basic realm="YT2 Admin"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Evaluate both comparisons unconditionally (no short-circuit timing difference).
    const userOk = safeEqual(parsed.username, adminUsername);
    const passOk = safeEqual(parsed.password, adminPassword);
    if (!(userOk && passOk)) {
      res.set('WWW-Authenticate', 'Basic realm="YT2 Admin"');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    return next();
  };
}

module.exports = {
  parseBasicAuth,
  safeEqual,
  createRequireAdminAuth
};
