const { YouTubeApiError, QuotaBudgetError, NotConnectedError } = require('./errors');

const API_BASE = 'https://www.googleapis.com/youtube/v3';

// Approximate YouTube Data API quota costs (units per call).
const COST = { search: 100, list: 1 };

function pacificDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date);
}

/**
 * Soft, in-memory daily budget so a bug or abuse cannot burn the whole project quota.
 * Resets at midnight Pacific (when Google resets quota). Does not survive restarts.
 */
function createQuotaGuard({ budget = 9000, now = Date.now } = {}) {
  let day = pacificDayKey(new Date(now()));
  let used = 0;
  return {
    consume(units) {
      const today = pacificDayKey(new Date(now()));
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used + units > budget) throw new QuotaBudgetError();
      used += units;
    },
    used: () => used
  };
}

function pickThumbnail(thumbnails) {
  if (!thumbnails) return '';
  return (
    (thumbnails.high && thumbnails.high.url) ||
    (thumbnails.medium && thumbnails.medium.url) ||
    (thumbnails.default && thumbnails.default.url) ||
    ''
  );
}

/**
 * Turn a videos.list item (part=snippet,contentDetails,status) into the record the filter
 * expects. `detailed` is only true when all three parts are present.
 */
function normalizeVideo(item) {
  const snippet = item && item.snippet;
  const contentDetails = item && item.contentDetails;
  const status = item && item.status;
  const detailed = Boolean(item && item.id && snippet && contentDetails && status);

  return {
    detailed,
    videoId: (item && item.id) || '',
    title: (snippet && snippet.title) || '',
    description: (snippet && snippet.description) || '',
    tags: (snippet && Array.isArray(snippet.tags) ? snippet.tags : []).map(String),
    channelId: (snippet && snippet.channelId) || '',
    channelTitle: (snippet && snippet.channelTitle) || 'Unknown channel',
    publishedAt: (snippet && snippet.publishedAt) || '',
    thumbnail: pickThumbnail(snippet && snippet.thumbnails),
    liveBroadcastContent: (snippet && snippet.liveBroadcastContent) || 'none',
    ageRestricted: Boolean(
      contentDetails && contentDetails.contentRating && contentDetails.contentRating.ytRating === 'ytAgeRestricted'
    ),
    madeForKids: status && typeof status.madeForKids === 'boolean' ? status.madeForKids : null,
    embeddable: status && typeof status.embeddable === 'boolean' ? status.embeddable : null
  };
}

function createYouTubeClient({
  getAccessToken,
  fetchFn = (...args) => fetch(...args),
  quota = createQuotaGuard(),
  timeoutMs = 10000,
  regionCode = ''
}) {
  async function call(resource, params, units = COST.list) {
    quota.consume(units);
    const query = new URLSearchParams(params).toString();

    async function attempt(forceRefresh) {
      const token = await getAccessToken({ forceRefresh });
      const response = await fetchFn(`${API_BASE}/${resource}?${query}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      return response;
    }

    let response = await attempt(false);
    if (response.status === 401) {
      response = await attempt(true); // access token may have been revoked/expired early
    }

    if (!response.ok) {
      let reason = '';
      try {
        const body = await response.json();
        reason = (body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason) || '';
      } catch (_) {
        // ignore
      }
      if (response.status === 401) throw new NotConnectedError('Google rejected the stored credentials');
      throw new YouTubeApiError(response.status, reason);
    }
    return response.json();
  }

  async function search({ q, pageToken }) {
    const params = {
      part: 'snippet',
      type: 'video',
      maxResults: '50',
      safeSearch: 'strict',
      videoEmbeddable: 'true',
      q
    };
    if (pageToken) params.pageToken = pageToken;
    if (regionCode) params.regionCode = regionCode;
    const data = await call('search', params, COST.search);
    const ids = (data.items || []).map(i => i && i.id && i.id.videoId).filter(Boolean);
    return { ids, nextPageToken: data.nextPageToken || null };
  }

  async function subscriptions(maxChannels) {
    const channels = [];
    let pageToken = '';
    do {
      const params = { part: 'snippet', mine: 'true', maxResults: '50', order: 'relevance' };
      if (pageToken) params.pageToken = pageToken;
      const data = await call('subscriptions', params);
      for (const item of data.items || []) {
        const id = item && item.snippet && item.snippet.resourceId && item.snippet.resourceId.channelId;
        if (id) channels.push({ channelId: id, title: item.snippet.title || '' });
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken && channels.length < maxChannels);
    return channels.slice(0, maxChannels);
  }

  // A channel's "uploads" playlist id is its channel id with the UC prefix replaced by UU.
  async function channelUploads(channelId, perChannel) {
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) return [];
    try {
      const data = await call('playlistItems', {
        part: 'contentDetails',
        playlistId: `UU${channelId.slice(2)}`,
        maxResults: String(perChannel)
      });
      return (data.items || [])
        .map(i => ({
          videoId: i.contentDetails && i.contentDetails.videoId,
          publishedAt: (i.contentDetails && i.contentDetails.videoPublishedAt) || ''
        }))
        .filter(v => v.videoId);
    } catch (error) {
      if (error instanceof YouTubeApiError && (error.status === 404 || error.status === 403)) return [];
      throw error;
    }
  }

  async function playlistsMine() {
    const playlists = [];
    let pageToken = '';
    let pages = 0;
    do {
      const params = { part: 'snippet,contentDetails', mine: 'true', maxResults: '50' };
      if (pageToken) params.pageToken = pageToken;
      const data = await call('playlists', params);
      for (const p of data.items || []) {
        playlists.push({
          id: p.id,
          title: (p.snippet && p.snippet.title) || '',
          description: (p.snippet && p.snippet.description) || '',
          channelId: (p.snippet && p.snippet.channelId) || '',
          thumbnail: pickThumbnail(p.snippet && p.snippet.thumbnails),
          itemCount: (p.contentDetails && p.contentDetails.itemCount) || 0
        });
      }
      pageToken = data.nextPageToken || '';
      pages += 1;
    } while (pageToken && pages < 4);
    return playlists;
  }

  async function playlistItems({ playlistId, pageToken }) {
    const params = { part: 'contentDetails', playlistId, maxResults: '50' };
    if (pageToken) params.pageToken = pageToken;
    const data = await call('playlistItems', params);
    const ids = (data.items || []).map(i => i.contentDetails && i.contentDetails.videoId).filter(Boolean);
    return { ids, nextPageToken: data.nextPageToken || null };
  }

  // videos.list in batches of 50. Videos that YouTube does not return (private/deleted) are omitted.
  async function videoDetails(ids) {
    const unique = [...new Set(ids)];
    const batches = [];
    for (let i = 0; i < unique.length; i += 50) batches.push(unique.slice(i, i + 50));

    const results = await Promise.all(
      batches.map(batch =>
        call('videos', { part: 'snippet,contentDetails,status', id: batch.join(','), maxResults: '50' })
      )
    );
    const byId = new Map();
    for (const data of results) {
      for (const item of data.items || []) byId.set(item.id, normalizeVideo(item));
    }
    return unique.map(id => byId.get(id)).filter(Boolean);
  }

  // Plain read call (1 quota unit), used to look up channel handles for community lists.
  const rawGet = (resource, params) => call(resource, params);

  return { search, subscriptions, channelUploads, playlistsMine, playlistItems, videoDetails, rawGet };
}

module.exports = { createYouTubeClient, createQuotaGuard, normalizeVideo, COST };
