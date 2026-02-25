function isBlockedByKeyword(title, blockedKeywords) {
  const text = title || '';
  return (blockedKeywords || []).some(rule => {
    const keyword = (rule && rule.keyword) || '';
    if (!keyword) return false;
    if (rule.case_sensitive) {
      return text.includes(keyword);
    }
    return text.toLowerCase().includes(keyword.toLowerCase());
  });
}

function isVideoAllowed(video, filters) {
  const channelId = video.channelId || '';
  const title = video.title || '';

  const blockedChannels = new Set((filters.blocked_channels || []).map(c => c.channel_id));
  if (blockedChannels.has(channelId)) {
    return false;
  }

  // Whitelist intentionally disabled for now across clients.
  return !isBlockedByKeyword(title, filters.blocked_keywords || []);
}

function filterVideoItems(items, filters) {
  const safeItems = (items || []).filter(item => isVideoAllowed(item, filters));
  return {
    items: safeItems,
    totalCount: (items || []).length,
    filteredCount: (items || []).length - safeItems.length
  };
}

module.exports = {
  isBlockedByKeyword,
  isVideoAllowed,
  filterVideoItems
};
