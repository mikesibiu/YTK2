require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { createRequireAdminAuth } = require('./lib/adminAuth');
const { filterVideoItems, activeKeywordCount } = require('./lib/videoFilter');
const { createRateLimiter, createTtlCache } = require('./lib/rateLimit');
const { createCommunityStore } = require('./lib/communityStore');
const { SOURCES } = require('./lib/communityLists');

const community = createCommunityStore(db);
const app = express();
// Behind Koyeb's proxy; needed so rate limiting sees the real client IP.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8080;
const isProduction = process.env.NODE_ENV === 'production';
const requireAdminAuth = createRequireAdminAuth(
  process.env.ADMIN_USERNAME,
  process.env.ADMIN_PASSWORD
);

// Middleware
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

if (isProduction && (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD)) {
  throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD are required in production');
}

if (isProduction && allowedOrigins.length === 0) {
  throw new Error('ALLOWED_ORIGINS is required in production');
}

// Express 4 ignores rejected promises from async handlers, which would crash the process.
for (const method of ['get', 'post', 'put', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (...args) => original(...args.map(arg => (
    typeof arg === 'function' && arg.constructor.name === 'AsyncFunction'
      ? (req, res, next) => arg(req, res, next).catch(next)
      : arg
  )));
}

app.use(cors(
  allowedOrigins.length > 0
    ? { origin: allowedOrigins }
    : {}
));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// API ENDPOINTS FOR MOBILE APP
// ============================================

// GET all filters
app.get('/api/filters', requireAdminAuth, async (req, res) => {
  try {
    const filters = await getFilterRules();
    res.json({ ...filters, updated_at: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching filters:', error);
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
});

// Get filter summary stats
app.get('/api/filters/summary', requireAdminAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM filter_summary');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

async function getFilterRules() {
  const [keywordsResult, blockedChannelsResult, allowedChannelsResult, configResult] = await Promise.all([
    db.query('SELECT keyword, case_sensitive FROM blocked_keywords ORDER BY keyword'),
    db.query('SELECT channel_id, channel_name FROM blocked_channels ORDER BY channel_name'),
    db.query('SELECT channel_id, channel_name FROM allowed_channels ORDER BY channel_name'),
    db.query('SELECT key, value FROM config')
  ]);

  const config = {};
  configResult.rows.forEach(row => {
    config[row.key] = row.value;
  });

  return {
    blocked_keywords: keywordsResult.rows,
    blocked_channels: blockedChannelsResult.rows,
    allowed_channels: allowedChannelsResult.rows,
    config: {
      // Anything other than an explicit 'false' turns the allowlist ON (fails closed).
      whitelist_mode: String(config.whitelist_mode ?? 'false').trim().toLowerCase() !== 'false',
      search_in: config.search_in || 'title,description,tags'
    }
  };
}

const optionalText = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
const searchLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });
const searchCache = createTtlCache({ ttlMs: 10 * 60 * 1000, maxEntries: 200 });

async function youtubeGet(resource, params) {
  const query = new URLSearchParams({ ...params, key: process.env.YOUTUBE_API_KEY });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${query.toString()}`, {
      signal: controller.signal
    });
    if (!response.ok) {
      const err = new Error(`YouTube API failed with status ${response.status}`);
      err.upstreamStatus = response.status;
      throw err;
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Search, then fetch full details (description, tags, age rating) for every hit so
// keyword rules can look beyond the title.
async function searchCandidates(query, maxResults) {
  const cacheKey = `${maxResults}:${query.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const searchPayload = await youtubeGet('search', {
    part: 'snippet',
    type: 'video',
    maxResults: maxResults.toString(),
    safeSearch: 'strict',
    videoEmbeddable: 'true',
    q: query
  });

  const base = (searchPayload.items || []).map(item => ({
    videoId: item?.id?.videoId || '',
    title: item?.snippet?.title || '',
    description: item?.snippet?.description || '',
    channelId: item?.snippet?.channelId || '',
    channelName: item?.snippet?.channelTitle || 'Unknown channel',
    thumbnail: item?.snippet?.thumbnails?.medium?.url || item?.snippet?.thumbnails?.default?.url || ''
  })).filter(item => item.videoId);

  let candidates = base;
  if (base.length > 0) {
    const detailsPayload = await youtubeGet('videos', {
      part: 'snippet,contentDetails',
      id: base.map(item => item.videoId).join(',')
    });
    const details = new Map((detailsPayload.items || []).map(item => [item.id, item]));
    // A video we cannot get details for cannot be checked, so it is dropped.
    candidates = base.filter(item => details.has(item.videoId)).map(item => {
      const detail = details.get(item.videoId);
      return {
        ...item,
        // videos.list returns plain text; search.list returns HTML-escaped titles.
        title: detail.snippet?.title || item.title,
        channelName: detail.snippet?.channelTitle || item.channelName,
        description: detail.snippet?.description || item.description,
        tags: detail.snippet?.tags || [],
        ageRestricted: detail.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted'
      };
    });
  }

  // Learn handles of new channels and queue matches from imported community lists. Best effort:
  // this must never change or delay what the search returns.
  community.resolveAndMatch(youtubeGet, candidates.map(item => item.channelId)).catch(error => {
    console.error('Community list matching failed:', error.message);
  });

  searchCache.set(cacheKey, candidates);
  return candidates;
}

// Server-side YouTube search so clients never hold the API key. Fails closed:
// if rules cannot be loaded or a video cannot be checked, nothing is returned.
app.get('/api/search', searchLimiter, async (req, res) => {
  const query = (req.query.q || '').toString().trim().slice(0, 200);
  const maxResultsRaw = Number.parseInt((req.query.max || '25').toString(), 10);
  const maxResults = Number.isFinite(maxResultsRaw)
    ? Math.min(Math.max(maxResultsRaw, 1), 50)
    : 25;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  if (!process.env.YOUTUBE_API_KEY) {
    return res.status(500).json({ error: 'YOUTUBE_API_KEY is not configured on server' });
  }

  let filters;
  try {
    filters = await getFilterRules();
    if (activeKeywordCount(filters.blocked_keywords) === 0) {
      throw new Error('No blocked keywords configured');
    }
  } catch (error) {
    console.error('Filter rules unavailable, refusing search:', error);
    return res.status(503).json({ error: 'Filters unavailable' });
  }

  try {
    const candidates = await searchCandidates(query, maxResults);
    const result = filterVideoItems(candidates, filters);

    res.json({
      query,
      total_count: result.totalCount,
      filtered_count: result.filteredCount,
      items: result.items.map(item => ({
        video_id: item.videoId,
        title: item.title,
        channel_id: item.channelId,
        channel_name: item.channelName,
        thumbnail: item.thumbnail
      }))
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'YouTube API timed out' });
    }
    if (error.upstreamStatus) {
      console.error('YouTube API error:', error.message);
      return res.status(502).json({ error: 'Upstream search failed' });
    }
    console.error('Error in /api/search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ============================================
// ADMIN API ENDPOINTS (for web UI)
// ============================================

const adminLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60 });
app.use('/api/admin', adminLimiter, requireAdminAuth);

// --- Blocked Keywords ---

// Get all blocked keywords
app.get('/api/admin/keywords', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM blocked_keywords ORDER BY keyword'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching keywords:', error);
    res.status(500).json({ error: 'Failed to fetch keywords' });
  }
});

// Add blocked keyword
app.post('/api/admin/keywords', async (req, res) => {
  const { keyword, case_sensitive } = req.body || {};

  if (typeof keyword !== 'string' || keyword.trim() === '') {
    return res.status(400).json({ error: 'Keyword is required' });
  }

  try {
    const normalizedKeyword = case_sensitive
      ? keyword.trim()
      : keyword.trim().toLowerCase();

    const result = await db.query(
      'INSERT INTO blocked_keywords (keyword, case_sensitive) VALUES ($1, $2) RETURNING *',
      [normalizedKeyword, case_sensitive || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({ error: 'Keyword already exists' });
    }
    console.error('Error adding keyword:', error);
    res.status(500).json({ error: 'Failed to add keyword' });
  }
});

// Delete blocked keyword
app.delete('/api/admin/keywords/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const result = await db.query(
      'DELETE FROM blocked_keywords WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Keyword not found' });
    }

    res.json({ message: 'Keyword deleted', keyword: result.rows[0] });
  } catch (error) {
    console.error('Error deleting keyword:', error);
    res.status(500).json({ error: 'Failed to delete keyword' });
  }
});

// --- Blocked Channels ---

// Get all blocked channels
app.get('/api/admin/blocked-channels', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM blocked_channels ORDER BY channel_name'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching blocked channels:', error);
    res.status(500).json({ error: 'Failed to fetch blocked channels' });
  }
});

// Add blocked channel
app.post('/api/admin/blocked-channels', async (req, res) => {
  const { channel_id, channel_name, reason } = req.body || {};

  if (typeof channel_id !== 'string' || channel_id.trim() === '') {
    return res.status(400).json({ error: 'Channel ID is required' });
  }

  try {
    const result = await db.query(
      'INSERT INTO blocked_channels (channel_id, channel_name, reason) VALUES ($1, $2, $3) RETURNING *',
      [channel_id.trim(), optionalText(channel_name), optionalText(reason)]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Channel already blocked' });
    }
    console.error('Error adding blocked channel:', error);
    res.status(500).json({ error: 'Failed to add blocked channel' });
  }
});

// Delete blocked channel
app.delete('/api/admin/blocked-channels/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const result = await db.query(
      'DELETE FROM blocked_channels WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json({ message: 'Channel deleted', channel: result.rows[0] });
  } catch (error) {
    console.error('Error deleting blocked channel:', error);
    res.status(500).json({ error: 'Failed to delete blocked channel' });
  }
});

// --- Allowed Channels ---

// Get all allowed channels
app.get('/api/admin/allowed-channels', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM allowed_channels ORDER BY channel_name'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching allowed channels:', error);
    res.status(500).json({ error: 'Failed to fetch allowed channels' });
  }
});

// Add allowed channel
app.post('/api/admin/allowed-channels', async (req, res) => {
  const { channel_id, channel_name, notes } = req.body || {};

  if (typeof channel_id !== 'string' || channel_id.trim() === '') {
    return res.status(400).json({ error: 'Channel ID is required' });
  }

  try {
    const result = await db.query(
      'INSERT INTO allowed_channels (channel_id, channel_name, notes) VALUES ($1, $2, $3) RETURNING *',
      [channel_id.trim(), optionalText(channel_name), optionalText(notes)]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Channel already in allowed list' });
    }
    console.error('Error adding allowed channel:', error);
    res.status(500).json({ error: 'Failed to add allowed channel' });
  }
});

// Delete allowed channel
app.delete('/api/admin/allowed-channels/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const result = await db.query(
      'DELETE FROM allowed_channels WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json({ message: 'Channel deleted', channel: result.rows[0] });
  } catch (error) {
    console.error('Error deleting allowed channel:', error);
    res.status(500).json({ error: 'Failed to delete allowed channel' });
  }
});

// --- Configuration ---

// Get configuration
app.get('/api/admin/config', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM config ORDER BY key');
    const config = {};
    result.rows.forEach(row => {
      config[row.key] = {
        value: row.value,
        description: row.description,
        updated_at: row.updated_at
      };
    });
    res.json(config);
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// Update configuration
app.put('/api/admin/config/:key', async (req, res) => {
  const { key } = req.params;
  const { value } = req.body || {};

  if (value === undefined || value === null || typeof value === 'object') {
    return res.status(400).json({ error: 'Value is required' });
  }

  if (['whitelist_mode', 'community_auto_block'].includes(key) && !['true', 'false'].includes(String(value).trim().toLowerCase())) {
    return res.status(400).json({ error: `${key} must be true or false` });
  }

  try {
    const result = await db.query(
      'UPDATE config SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2 RETURNING *',
      [value.toString(), key]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Configuration key not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// --- Community lists (reviewed import) ---

app.get('/api/admin/community/sources', async (req, res) => {
  res.json(await community.listSources());
});

app.post('/api/admin/community/import', async (req, res) => {
  const source = req.body && req.body.source;
  if (typeof source !== 'string' || !SOURCES[source]) {
    return res.status(400).json({ error: 'Unknown source' });
  }
  try {
    res.json(await community.importSource(source));
  } catch (error) {
    console.error('Community import failed:', error.message);
    res.status(502).json({ error: 'Import failed' });
  }
});

app.get('/api/admin/community/candidates', async (req, res) => {
  const source = typeof req.query.source === 'string' && SOURCES[req.query.source] ? req.query.source : null;
  const status = ['pending', 'accepted', 'rejected', 'removed'].includes(req.query.status) ? req.query.status : 'pending';
  res.json(await community.listCandidates({ status, source }));
});

app.post('/api/admin/community/candidates/bulk', async (req, res) => {
  const { source, category, action } = req.body || {};
  if (typeof source !== 'string' || !SOURCES[source] || !['accept', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'source and action (accept or reject) are required' });
  }
  res.json(await community.bulk({ source, category: typeof category === 'string' ? category : null, action }));
});

app.post('/api/admin/community/candidates/:id/accept', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await community.accept(Number(req.params.id));
  if (result.ok) return res.json({ message: 'Applied' });
  if (result.reason === 'allowed_channel') {
    return res.status(409).json({ error: 'This channel is on your allowed list. Remove it from there first.' });
  }
  return res.status(404).json({ error: 'Not found' });
});

app.post('/api/admin/community/candidates/:id/reject', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  if (!(await community.reject(Number(req.params.id)))) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Rejected' });
});

app.delete('/api/admin/community/sources/:source', async (req, res) => {
  if (!SOURCES[req.params.source]) return res.status(400).json({ error: 'Unknown source' });
  res.json(await community.removeSource(req.params.source));
});

// Admin UI (protected if ADMIN_USERNAME and ADMIN_PASSWORD are set)
app.use('/', adminLimiter, requireAdminAuth, express.static(path.join(__dirname, 'public')));

// ============================================
// START SERVER
// ============================================

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  console.error('Unhandled error:', err && err.message);
  res.status(500).json({ error: 'Internal error' });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 YTK2 Filter Service running on port ${PORT}`);
  console.log(`📊 Admin UI: http://localhost:${PORT}/`);
  console.log(`🔌 Search API: http://localhost:${PORT}/api/search?q=...`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
