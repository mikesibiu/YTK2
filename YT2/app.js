const express = require('express');
const path = require('path');
const { createRequireAdminAuth, safeEqual } = require('./lib/adminAuth');
const { createRateLimiter } = require('./lib/rateLimiter');
const { createAccessGate } = require('./lib/accessGate');
const { SOURCES } = require('./lib/communityLists');
const { normalizeText } = require('./lib/videoFilter');
const {
  FilterUnavailableError,
  NotConnectedError,
  NotFoundError,
  YouTubeApiError,
  QuotaBudgetError
} = require('./lib/errors');

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{2,64}$/;
const PAGE_TOKEN_RE = /^[A-Za-z0-9_-]{1,200}$/;
const OAUTH_COOKIE = 'yt2_oauth';

const BOOLEAN_CONFIG_KEYS = ['allowlist_only', 'block_live', 'match_plurals', 'community_auto_block'];
const MADE_FOR_KIDS_VALUES = ['off', 'prefer', 'require'];

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' https://i.ytimg.com https://*.ytimg.com data:",
      'frame-src https://www.youtube-nocookie.com',
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '),
    // The YouTube embed needs the page origin as referrer, but nothing more than that.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  next();
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sendError(res, error) {
  if (error instanceof FilterUnavailableError) {
    return res.status(503).json({ error: 'filter_unavailable', message: 'Filters are unavailable right now. Nothing is shown until they are back.' });
  }
  if (error instanceof NotConnectedError) {
    return res.status(503).json({ error: 'not_connected', message: 'A parent needs to sign in with Google first.' });
  }
  if (error instanceof NotFoundError) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (error instanceof QuotaBudgetError || (error instanceof YouTubeApiError && /quota/i.test(error.reason))) {
    return res.status(503).json({ error: 'quota_exceeded', message: 'Too many searches today. Try again tomorrow.' });
  }
  if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return res.status(504).json({ error: 'upstream_timeout' });
  }
  if (error instanceof YouTubeApiError) {
    return res.status(502).json({ error: 'upstream_error' });
  }
  return res.status(500).json({ error: 'internal_error' });
}

function parseIdParam(req, res, next, value) {
  if (!/^\d{1,9}$/.test(String(value))) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  req.params.id = Number.parseInt(value, 10);
  return next();
}

/**
 * @param {object} deps
 *  db        { query }
 *  content   contentService (search, subscriptions, playlists, playlistItems, clearCache)
 *  google    googleAuth service
 *  rules     { invalidate } rules loader handle
 *  adminUsername, adminPassword, isProduction
 *  limits    { windowMs, publicMax, searchMax, adminMax }
 */
function createApp(deps) {
  const {
    db,
    content,
    google,
    rules,
    access = createAccessGate({}),
    community = null,
    adminUsername,
    adminPassword,
    isProduction = false,
    trustProxy = false,
    limits = {}
  } = deps;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  const windowMs = limits.windowMs || 60 * 1000;
  const publicLimiter = createRateLimiter({ windowMs, max: limits.publicMax || 120 });
  const searchLimiter = createRateLimiter({ windowMs, max: limits.searchMax || 20 });
  const adminLimiter = createRateLimiter({ windowMs, max: limits.adminMax || 120 });
  // A short numeric code is guessable, so wrong attempts are limited hard per IP.
  const unlockLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: limits.unlockMax || 10 });
  app.locals.stopLimiters = () => [publicLimiter, searchLimiter, adminLimiter, unlockLimiter].forEach(l => l.stop());

  const requireAdminAuth = createRequireAdminAuth(adminUsername, adminPassword, {
    allowOpenWhenUnset: !isProduction
  });

  app.use(securityHeaders);
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ==========================================================================
  // PUBLIC (child-facing) API. Every video/playlist goes through the filter in
  // contentService; if the filter cannot run, the response is an error.
  // ==========================================================================

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  function adminOrPublicLimit(req, res, next) {
    return req.path.startsWith('/admin') ? next() : publicLimiter(req, res, next);
  }
  app.use('/api', adminOrPublicLimit);

  // --- Access code -----------------------------------------------------------
  app.get('/api/session', (req, res) => {
    res.json({ unlocked: access.hasAccess(req) });
  });

  app.post('/api/unlock', unlockLimiter, (req, res) => {
    if (!access.checkCode(req.body && req.body.code)) {
      return res.status(401).json({ error: 'wrong_code', message: 'That is not the code.' });
    }
    res.set('Set-Cookie', access.unlockCookie(req));
    return res.json({ unlocked: true });
  });

  app.post('/api/lock', (req, res) => {
    res.set('Set-Cookie', access.lockCookie(req));
    res.json({ unlocked: false });
  });

  // Everything that returns videos needs the code.
  app.use(['/api/search', '/api/subscriptions', '/api/playlists'], access.requireAccess);

  app.get('/api/search', searchLimiter, asyncRoute(async (req, res) => {
    const q = normalizeText(typeof req.query.q === 'string' ? req.query.q : '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!q) return res.status(400).json({ error: 'Query parameter q is required' });
    if (q.length > 100) return res.status(400).json({ error: 'Query is too long' });

    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : '';
    if (pageToken && !PAGE_TOKEN_RE.test(pageToken)) {
      return res.status(400).json({ error: 'Invalid pageToken' });
    }

    try {
      res.json(await content.search({ q, pageToken }));
    } catch (error) {
      sendError(res, error);
    }
  }));

  app.get('/api/subscriptions', asyncRoute(async (req, res) => {
    try {
      res.json(await content.subscriptions());
    } catch (error) {
      sendError(res, error);
    }
  }));

  app.get('/api/playlists', asyncRoute(async (req, res) => {
    try {
      res.json(await content.playlists());
    } catch (error) {
      sendError(res, error);
    }
  }));

  app.get('/api/playlists/:playlistId/items', asyncRoute(async (req, res) => {
    const { playlistId } = req.params;
    if (!PLAYLIST_ID_RE.test(playlistId)) {
      return res.status(400).json({ error: 'Invalid playlist id' });
    }
    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : '';
    if (pageToken && !PAGE_TOKEN_RE.test(pageToken)) {
      return res.status(400).json({ error: 'Invalid pageToken' });
    }
    try {
      res.json(await content.playlistItems({ playlistId, pageToken }));
    } catch (error) {
      sendError(res, error);
    }
  }));

  // ==========================================================================
  // ADMIN API (Basic auth)
  // ==========================================================================

  app.use('/api/admin', adminLimiter, requireAdminAuth);

  // Basic-auth credentials are attached by the browser automatically, so state-changing
  // requests must carry a custom header (which cross-site forms cannot send).
  app.use('/api/admin', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'yt2') {
      return res.status(403).json({ error: 'Missing X-Requested-With header' });
    }
    return next();
  });

  app.param('id', parseIdParam);

  function adminRoute(handler) {
    return asyncRoute(async (req, res) => {
      try {
        await handler(req, res);
      } catch (error) {
        console.error(`Admin ${req.method} ${req.path} failed:`, error.message);
        res.status(500).json({ error: 'Request failed' });
      }
    });
  }

  app.get('/api/admin/summary', adminRoute(async (req, res) => {
    const result = await db.query('SELECT * FROM filter_summary');
    res.json(result.rows[0]);
  }));

  // --- Keywords ---
  app.get('/api/admin/keywords', adminRoute(async (req, res) => {
    const result = await db.query('SELECT * FROM blocked_keywords ORDER BY keyword');
    res.json(result.rows);
  }));

  app.post('/api/admin/keywords', adminRoute(async (req, res) => {
    const { keyword, case_sensitive } = req.body || {};
    if (typeof keyword !== 'string' || keyword.trim() === '') {
      return res.status(400).json({ error: 'Keyword is required' });
    }
    const cleaned = normalizeText(keyword).replace(/\s+/g, ' ').trim();
    if (cleaned.length > 100) {
      return res.status(400).json({ error: 'Keyword is too long (max 100)' });
    }
    const caseSensitive = case_sensitive === true;
    try {
      const result = await db.query(
        'INSERT INTO blocked_keywords (keyword, case_sensitive) VALUES ($1, $2) RETURNING *',
        [caseSensitive ? cleaned : cleaned.toLowerCase(), caseSensitive]
      );
      rules.invalidate();
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Keyword already exists' });
      throw error;
    }
  }));

  app.delete('/api/admin/keywords/:id', adminRoute(async (req, res) => {
    const result = await db.query('DELETE FROM blocked_keywords WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Keyword not found' });
    rules.invalidate();
    res.json({ message: 'Keyword deleted', keyword: result.rows[0] });
  }));

  // --- Review log: keyword matches on allowed channels -------------------------
  // Allowed channels are never blocked by keywords. A match is logged here and the
  // parent decides: leave it, stop alerting for that channel+keyword, or block the channel.
  app.get('/api/admin/flags', adminRoute(async (req, res) => {
    const where = req.query.status === 'all' ? '' : "WHERE status = 'open'";
    const result = await db.query(
      `SELECT * FROM review_flags ${where} ORDER BY last_seen DESC, id DESC LIMIT 200`
    );
    res.json(result.rows);
  }));

  async function findFlag(req, res) {
    const result = await db.query('SELECT * FROM review_flags WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Flag not found' });
      return null;
    }
    return result.rows[0];
  }

  // "Don't alert in the future": stop logging this keyword for this channel.
  app.post('/api/admin/flags/:id/ignore', adminRoute(async (req, res) => {
    const flag = await findFlag(req, res);
    if (!flag) return;
    await db.query(
      'INSERT INTO alert_ignores (channel_id, channel_name, keyword) VALUES ($1, $2, $3) ON CONFLICT (channel_id, keyword) DO NOTHING',
      [flag.channel_id, flag.channel_name, flag.keyword]
    );
    await db.query(
      "UPDATE review_flags SET status = 'ignored' WHERE channel_id = $1 AND keyword = $2 AND status = 'open'",
      [flag.channel_id, flag.keyword]
    );
    rules.invalidate();
    res.json({ message: 'Will not alert again for this channel and keyword' });
  }));

  // "Block future access": block the channel and take it off the allowed list.
  app.post('/api/admin/flags/:id/block', adminRoute(async (req, res) => {
    const flag = await findFlag(req, res);
    if (!flag) return;
    // Block first: if a later step fails, the channel is already blocked (the safe state).
    await db.query(
      'INSERT INTO blocked_channels (channel_id, channel_name, reason) VALUES ($1, $2, $3) ON CONFLICT (channel_id) DO NOTHING',
      [flag.channel_id, flag.channel_name, `Blocked from review: "${flag.keyword}"`.slice(0, 255)]
    );
    rules.invalidate();
    await db.query('DELETE FROM allowed_channels WHERE channel_id = $1', [flag.channel_id]);
    await db.query(
      "UPDATE review_flags SET status = 'blocked' WHERE channel_id = $1 AND status = 'open'",
      [flag.channel_id]
    );
    rules.invalidate();
    res.json({ message: 'Channel blocked' });
  }));

  // Acknowledge one entry without changing any rule.
  app.post('/api/admin/flags/:id/dismiss', adminRoute(async (req, res) => {
    const flag = await findFlag(req, res);
    if (!flag) return;
    await db.query("UPDATE review_flags SET status = 'dismissed' WHERE id = $1", [flag.id]);
    res.json({ message: 'Dismissed' });
  }));

  app.get('/api/admin/alert-ignores', adminRoute(async (req, res) => {
    const result = await db.query('SELECT * FROM alert_ignores ORDER BY channel_name NULLS LAST, keyword');
    res.json(result.rows);
  }));

  app.delete('/api/admin/alert-ignores/:id', adminRoute(async (req, res) => {
    const result = await db.query('DELETE FROM alert_ignores WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    rules.invalidate();
    res.json({ message: 'Alerts turned back on', ignore: result.rows[0] });
  }));

  // --- Channel lists (blocked / allowed) ---
  function channelRoutes({ route, table, extraField, label }) {
    app.get(`/api/admin/${route}`, adminRoute(async (req, res) => {
      const result = await db.query(`SELECT * FROM ${table} ORDER BY channel_name NULLS LAST, channel_id`);
      res.json(result.rows);
    }));

    app.post(`/api/admin/${route}`, adminRoute(async (req, res) => {
      const body = req.body || {};
      const channelId = typeof body.channel_id === 'string' ? body.channel_id.trim() : '';
      if (!CHANNEL_ID_RE.test(channelId)) {
        return res.status(400).json({ error: 'Channel ID must look like UCxxxxxxxxxxxxxxxxxxxxxx (24 characters, starts with UC)' });
      }
      const clip = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 255) : null);
      try {
        const result = await db.query(
          `INSERT INTO ${table} (channel_id, channel_name, ${extraField}) VALUES ($1, $2, $3) RETURNING *`,
          [channelId, clip(body.channel_name), clip(body[extraField])]
        );
        rules.invalidate();
        res.status(201).json(result.rows[0]);
      } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: `Channel already in ${label} list` });
        throw error;
      }
    }));

    app.delete(`/api/admin/${route}/:id`, adminRoute(async (req, res) => {
      const result = await db.query(`DELETE FROM ${table} WHERE id = $1 RETURNING *`, [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: 'Channel not found' });
      rules.invalidate();
      res.json({ message: 'Channel deleted', channel: result.rows[0] });
    }));
  }

  channelRoutes({ route: 'blocked-channels', table: 'blocked_channels', extraField: 'reason', label: 'blocked' });
  channelRoutes({ route: 'allowed-channels', table: 'allowed_channels', extraField: 'notes', label: 'allowed' });

  // --- Community lists (reviewed import) ---------------------------------------------
  // Imported entries wait in a review queue. Allowed channels are never blocked from here.
  function communityRoute(handler) {
    return adminRoute(async (req, res) => {
      if (!community) return res.status(503).json({ error: 'Community lists are not enabled' });
      return handler(req, res);
    });
  }

  app.get('/api/admin/community/sources', communityRoute(async (req, res) => {
    res.json(await community.listSources());
  }));

  app.post('/api/admin/community/import', communityRoute(async (req, res) => {
    const source = req.body && req.body.source;
    if (typeof source !== 'string' || !SOURCES[source]) return res.status(400).json({ error: 'Unknown source' });
    try {
      res.json(await community.importSource(source));
    } catch (error) {
      console.error('Community import failed:', error.message);
      res.status(502).json({ error: 'Import failed' });
    }
  }));

  app.get('/api/admin/community/candidates', communityRoute(async (req, res) => {
    const source = typeof req.query.source === 'string' && SOURCES[req.query.source] ? req.query.source : null;
    const status = ['pending', 'accepted', 'rejected', 'removed'].includes(req.query.status) ? req.query.status : 'pending';
    res.json(await community.listCandidates({ status, source }));
  }));

  app.post('/api/admin/community/candidates/bulk', communityRoute(async (req, res) => {
    const { source, category, action } = req.body || {};
    if (typeof source !== 'string' || !SOURCES[source] || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'source and action (accept or reject) are required' });
    }
    const result = await community.bulk({ source, category: typeof category === 'string' ? category : null, action });
    rules.invalidate();
    res.json(result);
  }));

  app.post('/api/admin/community/candidates/:id/accept', communityRoute(async (req, res) => {
    const result = await community.accept(req.params.id);
    if (result.ok) {
      rules.invalidate();
      return res.json({ message: 'Applied' });
    }
    if (result.reason === 'allowed_channel') {
      return res.status(409).json({ error: 'This channel is on your allowed list. Remove it from there first.' });
    }
    return res.status(404).json({ error: 'Not found' });
  }));

  app.post('/api/admin/community/candidates/:id/reject', communityRoute(async (req, res) => {
    if (!(await community.reject(req.params.id))) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Rejected' });
  }));

  app.delete('/api/admin/community/sources/:source', communityRoute(async (req, res) => {
    if (!SOURCES[req.params.source]) return res.status(400).json({ error: 'Unknown source' });
    const result = await community.removeSource(req.params.source);
    rules.invalidate();
    res.json(result);
  }));

  // --- Config ---
  app.get('/api/admin/config', adminRoute(async (req, res) => {
    const result = await db.query('SELECT * FROM config ORDER BY key');
    const config = {};
    result.rows.forEach(row => {
      config[row.key] = { value: row.value, description: row.description, updated_at: row.updated_at };
    });
    res.json(config);
  }));

  app.put('/api/admin/config/:key', adminRoute(async (req, res) => {
    const { key } = req.params;
    const raw = req.body && req.body.value;
    if (raw === undefined || raw === null) return res.status(400).json({ error: 'Value is required' });
    const value = String(raw);

    if (BOOLEAN_CONFIG_KEYS.includes(key)) {
      if (value !== 'true' && value !== 'false') {
        return res.status(400).json({ error: `${key} must be true or false` });
      }
    } else if (key === 'made_for_kids') {
      if (!MADE_FOR_KIDS_VALUES.includes(value)) {
        return res.status(400).json({ error: 'made_for_kids must be off, prefer or require' });
      }
    } else {
      return res.status(404).json({ error: 'Configuration key not found' });
    }

    const result = await db.query(
      'UPDATE config SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2 RETURNING *',
      [value, key]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Configuration key not found' });
    rules.invalidate();
    res.json(result.rows[0]);
  }));

  // --- Google sign-in / sign-out ---
  app.get('/api/admin/google/status', adminRoute(async (req, res) => {
    res.json(await google.getStatus());
  }));

  app.get('/api/admin/google/start', (req, res) => {
    let request;
    try {
      request = google.createAuthRequest();
    } catch (error) {
      return res.redirect('/admin/?google=not_configured');
    }
    const cookie = [
      `${OAUTH_COOKIE}=${request.state}.${request.verifier}`,
      'Path=/api/admin/google',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=600',
      req.secure ? 'Secure' : ''
    ].filter(Boolean).join('; ');
    res.set('Set-Cookie', cookie);
    return res.redirect(request.url);
  });

  app.get('/api/admin/google/callback', asyncRoute(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    // Always clear the one-shot cookie.
    res.append('Set-Cookie', `${OAUTH_COOKIE}=; Path=/api/admin/google; HttpOnly; SameSite=Lax; Max-Age=0`);

    const [cookieState, verifier] = String(cookies[OAUTH_COOKIE] || '').split('.');
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';

    if (!cookieState || !verifier || !state || !safeEqual(cookieState, state)) {
      return res.redirect('/admin/?google=error');
    }
    if (req.query.error || !code) {
      return res.redirect('/admin/?google=denied');
    }

    try {
      await google.handleCallback({ code, verifier });
      content.clearCache();
      return res.redirect('/admin/?google=connected');
    } catch (error) {
      console.error('Google sign-in failed:', error.message);
      return res.redirect('/admin/?google=error');
    }
  }));

  app.post('/api/admin/google/disconnect', adminRoute(async (req, res) => {
    await google.disconnect();
    content.clearCache();
    res.json({ message: 'Signed out of Google' });
  }));

  // Unknown admin API routes
  app.use('/api/admin', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ==========================================================================
  // STATIC: admin UI (auth) and child UI (public)
  // ==========================================================================

  app.use('/admin', adminLimiter, requireAdminAuth, express.static(path.join(__dirname, 'admin')));
  app.use('/', express.static(path.join(__dirname, 'public')));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    console.error('Unhandled error:', err && err.message);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

module.exports = { createApp, CHANNEL_ID_RE };
