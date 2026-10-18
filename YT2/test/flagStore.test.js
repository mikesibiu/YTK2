const test = require('node:test');
const assert = require('node:assert/strict');

const { createFlagStore } = require('../lib/flagStore');
const { makeVideo } = require('../testSupport/helpers');

test('record upserts one row per video and keyword', async () => {
  const calls = [];
  const store = createFlagStore({ async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } });
  await store.record([{ video: makeVideo({ videoId: 'v1', title: 'T', channelId: 'UCa', channelTitle: 'A' }), keywords: ['scary', 'escape'] }]);

  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /ON CONFLICT \(video_id, keyword\)/);
  assert.deepEqual(calls[0].params, ['v1', 'scary', 'T', 'UCa', 'A']);
  assert.equal(calls[1].params[1], 'escape');
});

test('record never throws when the database fails', async () => {
  const errors = [];
  const store = createFlagStore(
    { async query() { throw new Error('db down'); } },
    { log: { error: (...a) => errors.push(a.join(' ')) } }
  );
  await store.record([{ video: makeVideo(), keywords: ['x'] }]);
  assert.equal(errors.length, 1);
});
