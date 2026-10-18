const { FilterUnavailableError, NotFoundError, YouTubeApiError } = require('./errors');
const { assertValidRules, filterVideoItems, filterPlaylists, isBlockedByKeyword } = require('./videoFilter');

function toPublicVideo(v) {
  return {
    video_id: v.videoId,
    title: v.title,
    channel_id: v.channelId,
    channel_name: v.channelTitle,
    thumbnail: v.thumbnail,
    published_at: v.publishedAt,
    made_for_kids: v.madeForKids === true
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Orchestrates YouTube calls + filtering. Every path that returns videos or playlists
 * loads the rules FIRST (so a rules failure costs no quota and returns nothing) and
 * passes the result through the filter LAST (so cached candidates always see current rules).
 */
function createContentService({ youtube, getRules, cache, flags, options = {} }) {
  const {
    searchTtlMs = 10 * 60 * 1000,
    feedTtlMs = 15 * 60 * 1000,
    maxChannels = 50,
    perChannel = 5,
    feedSize = 50,
    resultLimit = 24
  } = options;

  async function loadRules() {
    let rules;
    try {
      rules = await getRules();
    } catch (error) {
      if (error instanceof FilterUnavailableError) throw error;
      throw new FilterUnavailableError('Could not load filter rules');
    }
    assertValidRules(rules); // throws FilterUnavailableError
    return rules;
  }

  function respond(videos, rules, extra) {
    const result = filterVideoItems(videos, rules);
    const shown = result.items.slice(0, resultLimit);
    if (flags && result.flagged.length > 0) {
      const shownIds = new Set(shown.map(v => v.videoId));
      // Fire and forget: logging must not delay or alter the response.
      Promise.resolve(flags.record(result.flagged.filter(f => shownIds.has(f.video.videoId)))).catch(() => {});
    }
    return {
      ...extra,
      total_count: result.totalCount,
      filtered_count: result.filteredCount,
      items: shown.map(toPublicVideo)
    };
  }

  async function search({ q, pageToken }) {
    const rules = await loadRules();

    // A query that is itself blocked gets nothing and costs no quota.
    if (isBlockedByKeyword(q, rules.blocked_keywords, { matchPlurals: rules.config.match_plurals })) {
      return { query: q, total_count: 0, filtered_count: 0, items: [], next_page_token: null };
    }

    const key = `search:${q.toLowerCase()}|${pageToken || ''}`;
    const entry = await cache.getOrLoad(
      key,
      async () => {
        const found = await youtube.search({ q, pageToken });
        const videos = await youtube.videoDetails(found.ids);
        return { videos, nextPageToken: found.nextPageToken };
      },
      searchTtlMs
    );
    return respond(entry.videos, rules, { query: q, next_page_token: entry.nextPageToken });
  }

  async function subscriptions() {
    const rules = await loadRules();
    const videos = await cache.getOrLoad(
      'subscriptions',
      async () => {
        const channels = await youtube.subscriptions(maxChannels);
        if (channels.length === 0) return [];

        let failures = 0;
        let lastError = null;
        const perChannelResults = await mapLimit(channels, 8, async ch => {
          try {
            return await youtube.channelUploads(ch.channelId, perChannel);
          } catch (error) {
            if (!(error instanceof YouTubeApiError)) throw error; // quota/auth problems abort the feed
            failures += 1;
            lastError = error;
            return [];
          }
        });
        if (failures === channels.length) throw lastError;

        const seen = new Set();
        const recent = perChannelResults
          .flat()
          .filter(v => (seen.has(v.videoId) ? false : seen.add(v.videoId)))
          .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
          .slice(0, feedSize);
        return youtube.videoDetails(recent.map(v => v.videoId));
      },
      feedTtlMs
    );
    return respond(videos, rules, { next_page_token: null });
  }

  async function ownedPlaylists() {
    return cache.getOrLoad('playlists', () => youtube.playlistsMine(), feedTtlMs);
  }

  async function playlists() {
    const rules = await loadRules();
    const all = await ownedPlaylists();
    return {
      items: filterPlaylists(all, rules).map(p => ({
        id: p.id,
        title: p.title,
        thumbnail: p.thumbnail,
        item_count: p.itemCount
      }))
    };
  }

  async function playlistItems({ playlistId, pageToken }) {
    const rules = await loadRules();
    // Only the parent's own playlists, and only ones that pass the keyword/channel rules.
    const owned = (await ownedPlaylists()).find(p => p.id === playlistId);
    if (!owned || filterPlaylists([owned], rules).length === 0) {
      throw new NotFoundError('Playlist not found');
    }

    const key = `playlist:${playlistId}|${pageToken || ''}`;
    const entry = await cache.getOrLoad(
      key,
      async () => {
        const page = await youtube.playlistItems({ playlistId, pageToken });
        const videos = await youtube.videoDetails(page.ids);
        return { videos, nextPageToken: page.nextPageToken };
      },
      feedTtlMs
    );
    return respond(entry.videos, rules, { playlist_id: playlistId, next_page_token: entry.nextPageToken });
  }

  return { search, subscriptions, playlists, playlistItems, clearCache: () => cache.clear() };
}

module.exports = { createContentService, toPublicVideo };
