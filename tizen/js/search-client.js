(function (global) {
  function buildSearchUrl(apiBase, query) {
    return String(apiBase || '').replace(/\/$/, '') + '/api/search?q=' + encodeURIComponent(query);
  }

  function parseSearchResponse(payload) {
    const items = ((payload && payload.items) || []).filter(function (item) {
      return item && item.video_id;
    });
    return {
      items: items,
      filteredCount: (payload && payload.filtered_count) || 0
    };
  }

  const api = { buildSearchUrl: buildSearchUrl, parseSearchResponse: parseSearchResponse };
  global.YTK2SearchClient = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
