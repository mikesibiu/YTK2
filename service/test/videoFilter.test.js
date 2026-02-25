const test = require('node:test');
const assert = require('node:assert/strict');

const { isBlockedByKeyword, isVideoAllowed, filterVideoItems } = require('../lib/videoFilter');

test('isBlockedByKeyword respects case sensitivity', () => {
  assert.equal(isBlockedByKeyword('Scary movie', [{ keyword: 'scary', case_sensitive: false }]), true);
  assert.equal(isBlockedByKeyword('Scary movie', [{ keyword: 'scary', case_sensitive: true }]), false);
});

test('isVideoAllowed blocks blocked channels and keywords', () => {
  const filters = {
    blocked_keywords: [{ keyword: 'monster', case_sensitive: false }],
    blocked_channels: [{ channel_id: 'blocked-1' }],
    allowed_channels: [],
    config: { whitelist_mode: true }
  };

  assert.equal(isVideoAllowed({ channelId: 'blocked-1', title: 'Kids songs' }, filters), false);
  assert.equal(isVideoAllowed({ channelId: 'good-1', title: 'Monster truck' }, filters), false);
  assert.equal(isVideoAllowed({ channelId: 'good-1', title: 'Alphabet song' }, filters), true);
});

test('filterVideoItems returns safe list and counts', () => {
  const filters = {
    blocked_keywords: [{ keyword: 'horror', case_sensitive: false }],
    blocked_channels: [{ channel_id: 'bad' }]
  };

  const input = [
    { videoId: '1', channelId: 'good', title: 'Math for kids' },
    { videoId: '2', channelId: 'bad', title: 'Art for kids' },
    { videoId: '3', channelId: 'good', title: 'Horror stories' }
  ];

  const out = filterVideoItems(input, filters);
  assert.equal(out.totalCount, 3);
  assert.equal(out.filteredCount, 2);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].videoId, '1');
});
