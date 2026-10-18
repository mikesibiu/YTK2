const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSearchUrl, parseSearchResponse } = require('../js/search-client');

test('buildSearchUrl encodes the query and trims trailing slash', () => {
  assert.equal(
    buildSearchUrl('https://ytk2.example/', 'kids & animals'),
    'https://ytk2.example/api/search?q=kids%20%26%20animals'
  );
});

test('parseSearchResponse drops entries without a video id', () => {
  const out = parseSearchResponse({
    filtered_count: 2,
    items: [{ video_id: 'abc', title: 'A' }, { title: 'no id' }, null]
  });
  assert.equal(out.items.length, 1);
  assert.equal(out.filteredCount, 2);
});

test('parseSearchResponse tolerates an empty payload', () => {
  assert.deepEqual(parseSearchResponse(null), { items: [], filteredCount: 0 });
});
