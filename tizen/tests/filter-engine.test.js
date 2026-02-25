const test = require('node:test');
const assert = require('node:assert/strict');

const { isAllowedVideo, isBlockedByKeyword } = require('../js/filter-engine.js');

test('blocks on blocked channel', () => {
  const filters = {
    blocked_keywords: [],
    blocked_channels: [{ channel_id: 'blocked123' }],
    allowed_channels: [],
    config: { whitelist_mode: false }
  };

  const item = { snippet: { channelId: 'blocked123', title: 'Kids songs' } };
  assert.equal(isAllowedVideo(item, filters), false);
});

test('blocks on case-insensitive keyword', () => {
  const filters = {
    blocked_keywords: [{ keyword: 'scary', case_sensitive: false }],
    blocked_channels: []
  };

  assert.equal(isBlockedByKeyword('ScArY story', filters), true);
});

test('allows safe item when no rules match', () => {
  const filters = {
    blocked_keywords: [{ keyword: 'horror', case_sensitive: false }],
    blocked_channels: [{ channel_id: 'bad1' }],
    allowed_channels: [],
    config: { whitelist_mode: true }
  };

  const item = { snippet: { channelId: 'good1', title: 'Kids learning numbers' } };
  assert.equal(isAllowedVideo(item, filters), true);
});
