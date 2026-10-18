/**
 * Minimal fixed-window, in-memory rate limiter (per process, per key).
 * No dependencies. Suitable for a single-instance deployment.
 */
// IPv6 clients usually control a whole /64, so key them by it: otherwise rotating addresses
// would give every guess a fresh bucket.
function clientKey(ip) {
  const addr = String(ip).replace(/^::ffff:/i, '');
  if (!addr.includes(':')) return addr;
  const groups = addr.split('::')[0].split(':');
  if (addr.includes('::') || groups.length >= 4) {
    return `${groups.concat(['0', '0', '0', '0']).slice(0, 4).join(':')}::/64`;
  }
  return addr;
}

function createRateLimiter(options = {}) {
  const {
    windowMs = 60 * 1000,
    max = 60,
    keyFn = req => clientKey(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'),
    maxKeys = 10000,
    now = Date.now
  } = options;

  const hits = new Map(); // key -> { count, resetAt }

  function sweep(t) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= t) hits.delete(key);
    }
  }

  const sweeper = setInterval(() => sweep(now()), Math.max(windowMs, 1000));
  if (typeof sweeper.unref === 'function') sweeper.unref();

  function middleware(req, res, next) {
    const t = now();
    const key = String(keyFn(req));
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= t) {
      if (!entry && hits.size >= maxKeys) {
        sweep(t);
        if (hits.size >= maxKeys) {
          // Under key-flood pressure refuse new keys rather than grow without bound.
          res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
          return res.status(429).json({ error: 'Too many requests' });
        }
      }
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));

    if (entry.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - t) / 1000))));
      return res.status(429).json({ error: 'Too many requests' });
    }
    return next();
  }

  middleware.stop = () => clearInterval(sweeper);
  middleware.size = () => hits.size;
  return middleware;
}

module.exports = { createRateLimiter, clientKey };
