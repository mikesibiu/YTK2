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

    if (parsed.username !== adminUsername || parsed.password !== adminPassword) {
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
