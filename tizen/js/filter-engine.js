(function (global) {
  function normalizeFilters(filters) {
    return filters || {
      blocked_keywords: [],
      blocked_channels: [],
      allowed_channels: [],
      config: { whitelist_mode: false, search_in: 'title' }
    };
  }

  function isBlockedByKeyword(title, filters) {
    const effective = normalizeFilters(filters);
    const text = title || '';

    return (effective.blocked_keywords || []).some(function (rule) {
      const keyword = (rule && rule.keyword) || '';
      if (!keyword) return false;
      if (rule.case_sensitive) {
        return text.indexOf(keyword) !== -1;
      }
      return text.toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
    });
  }

  function isAllowedVideo(item, filters) {
    const effective = normalizeFilters(filters);
    const snippet = (item && item.snippet) || {};
    const channelId = snippet.channelId || '';
    const title = snippet.title || '';

    if ((effective.blocked_channels || []).some(function (c) { return c.channel_id === channelId; })) {
      return false;
    }

    // Whitelist intentionally disabled for now.

    return !isBlockedByKeyword(title, effective);
  }

  const api = {
    normalizeFilters: normalizeFilters,
    isBlockedByKeyword: isBlockedByKeyword,
    isAllowedVideo: isAllowedVideo
  };

  global.YTK2FilterEngine = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
