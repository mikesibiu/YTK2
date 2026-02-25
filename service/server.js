require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { createRequireAdminAuth } = require('./lib/adminAuth');
const { filterVideoItems } = require('./lib/videoFilter');

const app = express();
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

// GET all filters (used by Android app)
app.get('/api/filters', async (req, res) => {
  try {
    // Get all blocked keywords
    const keywordsResult = await db.query(
      'SELECT keyword, case_sensitive FROM blocked_keywords ORDER BY keyword'
    );

    // Get all blocked channels
    const blockedChannelsResult = await db.query(
      'SELECT channel_id, channel_name FROM blocked_channels ORDER BY channel_name'
    );

    // Get all allowed channels
    const allowedChannelsResult = await db.query(
      'SELECT channel_id, channel_name FROM allowed_channels ORDER BY channel_name'
    );

    // Get configuration
    const configResult = await db.query('SELECT key, value FROM config');
    const config = {};
    configResult.rows.forEach(row => {
      config[row.key] = row.value;
    });

    res.json({
      blocked_keywords: keywordsResult.rows.map(r => ({
        keyword: r.keyword,
        case_sensitive: r.case_sensitive
      })),
      blocked_channels: blockedChannelsResult.rows.map(r => ({
        channel_id: r.channel_id,
        channel_name: r.channel_name
      })),
      allowed_channels: allowedChannelsResult.rows.map(r => ({
        channel_id: r.channel_id,
        channel_name: r.channel_name
      })),
      config: {
        whitelist_mode: config.whitelist_mode === 'true',
        search_in: config.search_in || 'title'
      },
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching filters:', error);
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
});

// Get filter summary stats
app.get('/api/filters/summary', async (req, res) => {
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
      whitelist_mode: config.whitelist_mode === 'true',
      search_in: config.search_in || 'title'
    }
  };
}

// Server-side YouTube search so browser clients do not expose API keys.
app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
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

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: maxResults.toString(),
      safeSearch: 'strict',
      q: query,
      key: process.env.YOUTUBE_API_KEY
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let payload;
    try {
      const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, {
        signal: controller.signal
      });
      if (!response.ok) {
        return res.status(502).json({ error: `YouTube API failed with status ${response.status}` });
      }
      payload = await response.json();
    } finally {
      clearTimeout(timeout);
    }

    const allItems = (payload.items || []).map(item => ({
      videoId: item?.id?.videoId || '',
      title: item?.snippet?.title || '',
      channelId: item?.snippet?.channelId || '',
      channelName: item?.snippet?.channelTitle || 'Unknown channel',
      thumbnail: item?.snippet?.thumbnails?.medium?.url || item?.snippet?.thumbnails?.default?.url || ''
    })).filter(item => item.videoId);

    const filters = await getFilterRules();
    const result = filterVideoItems(allItems, filters);

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
    console.error('Error in /api/search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ============================================
// ADMIN API ENDPOINTS (for web UI)
// ============================================

app.use('/api/admin', requireAdminAuth);

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
  const { keyword, case_sensitive } = req.body;

  if (!keyword || keyword.trim() === '') {
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
  const { channel_id, channel_name, reason } = req.body;

  if (!channel_id || channel_id.trim() === '') {
    return res.status(400).json({ error: 'Channel ID is required' });
  }

  try {
    const result = await db.query(
      'INSERT INTO blocked_channels (channel_id, channel_name, reason) VALUES ($1, $2, $3) RETURNING *',
      [channel_id.trim(), channel_name?.trim() || null, reason?.trim() || null]
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
  const { channel_id, channel_name, notes } = req.body;

  if (!channel_id || channel_id.trim() === '') {
    return res.status(400).json({ error: 'Channel ID is required' });
  }

  try {
    const result = await db.query(
      'INSERT INTO allowed_channels (channel_id, channel_name, notes) VALUES ($1, $2, $3) RETURNING *',
      [channel_id.trim(), channel_name?.trim() || null, notes?.trim() || null]
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
  const { value } = req.body;

  if (value === undefined || value === null) {
    return res.status(400).json({ error: 'Value is required' });
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

// Admin UI (protected if ADMIN_USERNAME and ADMIN_PASSWORD are set)
app.use('/', requireAdminAuth, express.static(path.join(__dirname, 'public')));

// ============================================
// START SERVER
// ============================================

const server = app.listen(PORT, () => {
  console.log(`🚀 YTK2 Filter Service running on port ${PORT}`);
  console.log(`📊 Admin UI: http://localhost:${PORT}/`);
  console.log(`🔌 API: http://localhost:${PORT}/api/filters`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
