const baseConfig = {
  allowlist_only: false,
  made_for_kids: 'off',
  block_live: true,
  match_plurals: true
};

function makeRules(overrides = {}) {
  return {
    blocked_keywords: [],
    blocked_channels: [],
    allowed_channels: [],
    ...overrides,
    config: { ...baseConfig, ...(overrides.config || {}) }
  };
}

function makeVideo(overrides = {}) {
  return {
    detailed: true,
    videoId: 'vid00000001',
    title: 'Fun with letters',
    description: 'A friendly alphabet song',
    tags: ['abc', 'learning'],
    channelId: 'UCgood00000000000000000A',
    channelTitle: 'Good Channel',
    publishedAt: '2026-01-01T00:00:00Z',
    thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg',
    liveBroadcastContent: 'none',
    ageRestricted: false,
    madeForKids: null,
    embeddable: true,
    ...overrides
  };
}

const kw = (keyword, case_sensitive = false) => ({ keyword, case_sensitive });

module.exports = { makeRules, makeVideo, kw };
