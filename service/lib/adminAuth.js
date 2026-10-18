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

// Hash both sides so the comparison is constant-time regardless of length.
function safeEqual(a, b) {
  const hash = value => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function createRequireAdminAuth(adminUsername, adminPassword) {
  return function requireAdminAuth(req, res, next) {
    if (!adminUsername || !adminPassword) {
      return next();
    }

    const parsed = parseBasicAuth(req.headers.authorization || '');
    if (!parsed) {
      res.set('WWW-Authenticate', 'Basic realm="YTK2 Admin"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userOk = safeEqual(parsed.username, adminUsername);
    const passOk = safeEqual(parsed.password, adminPassword);
    if (!userOk || !passOk) {
      res.set('WWW-Authenticate', 'Basic realm="YTK2 Admin"');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    return next();
  };
}

module.exports = {
  parseBasicAuth,
  createRequireAdminAuth
};
