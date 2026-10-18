const test = require('node:test');
const assert = require('node:assert/strict');

const { createContentService } = require('../lib/contentService');
const { createTtlCache } = require('../lib/ttlCache');
const { FilterUnavailableError, NotFoundError } = require('../lib/errors');
const { makeRules, makeVideo, kw } = require('../testSupport/helpers');

function fakeYoutube(videos, extra = {}) {
  const calls = { search: 0, details: 0, subscriptions: 0, uploads: 0, playlists: 0, playlistItems: 0 };
  return {
    calls,
    async search() { calls.search += 1; return { ids: videos.map(v => v.videoId), nextPageToken: 'NEXT' }; },
    async videoDetails(ids) { calls.details += 1; return videos.filter(v => ids.includes(v.videoId)); },
    async subscriptions() { calls.subscriptions += 1; return [{ channelId: 'UCsub0000000000000000001', title: 's' }]; },
    async channelUploads() { calls.uploads += 1; return videos.map(v => ({ videoId: v.videoId, publishedAt: v.publishedAt })); },
    async playlistsMine() {
      calls.playlists += 1;
      return [
        { id: 'PLgood', title: 'Songs', description: '', channelId: 'UCparent', thumbnail: '', itemCount: 2 },
        { id: 'PLbad', title: 'Horror night', description: '', channelId: 'UCparent', thumbnail: '', itemCount: 1 }
      ];
    },
    async playlistItems() { calls.playlistItems += 1; return { ids: videos.map(v => v.videoId), nextPageToken: null }; },
    ...extra
  };
}

function service(youtube, rules, options) {
  return createContentService({
    youtube,
    getRules: typeof rules === 'function' ? rules : async () => rules,
    cache: createTtlCache({ ttlMs: 60000 }),
    options
  });
}

const goodVideo = makeVideo({ videoId: 'good0000001' });
const badVideo = makeVideo({ videoId: 'bad00000001', title: 'Scary night' });

test('search filters results and never exposes description/tags', async () => {
  const yt = fakeYoutube([goodVideo, badVideo]);
  const svc = service(yt, makeRules({ blocked_keywords: [kw('scary')] }));
  const out = await svc.search({ q: 'songs' });
  assert.deepEqual(out.items.map(i => i.video_id), ['good0000001']);
  assert.equal(out.filtered_count, 1);
  assert.equal(out.next_page_token, 'NEXT');
  assert.equal('description' in out.items[0], false);
  assert.equal('tags' in out.items[0], false);
});

test('FAIL CLOSED: if rules cannot be loaded, search errors and never calls YouTube', async () => {
  const yt = fakeYoutube([goodVideo]);
  const svc = service(yt, async () => { throw new Error('db down'); });
  await assert.rejects(svc.search({ q: 'x' }), FilterUnavailableError);
  await assert.rejects(svc.subscriptions(), FilterUnavailableError);
  await assert.rejects(svc.playlists(), FilterUnavailableError);
  await assert.rejects(svc.playlistItems({ playlistId: 'PLgood' }), FilterUnavailableError);
  assert.equal(yt.calls.search, 0);
  assert.equal(yt.calls.details, 0);
});

test('FAIL CLOSED: malformed rules object is rejected', async () => {
  const svc = service(fakeYoutube([goodVideo]), async () => ({ blocked_keywords: [] }));
  await assert.rejects(svc.search({ q: 'x' }), FilterUnavailableError);
});

test('search results are cached per query, but filtering uses the CURRENT rules each time', async () => {
  const yt = fakeYoutube([goodVideo, badVideo]);
  let rules = makeRules();
  const svc = service(yt, async () => rules);

  const first = await svc.search({ q: 'Songs' });
  assert.equal(first.items.length, 2);

  rules = makeRules({ blocked_keywords: [kw('scary')] });
  const second = await svc.search({ q: 'songs' }); // same normalised key
  assert.equal(second.items.length, 1);
  assert.equal(yt.calls.search, 1, 'YouTube search.list called once for repeated query');
});

test('a query that itself contains a blocked word returns nothing and costs no quota', async () => {
  const yt = fakeYoutube([goodVideo]);
  const svc = service(yt, makeRules({ blocked_keywords: [kw('gore')] }));
  const out = await svc.search({ q: 'gore compilation' });
  assert.deepEqual(out.items, []);
  assert.equal(yt.calls.search, 0);
});

test('allowlist mode applies to search results', async () => {
  const other = makeVideo({ videoId: 'othr0000001', channelId: 'UCother' });
  const svc = service(fakeYoutube([goodVideo, other]), makeRules({
    allowed_channels: [{ channel_id: goodVideo.channelId }],
    config: { allowlist_only: true }
  }));
  const out = await svc.search({ q: 'x' });
  assert.deepEqual(out.items.map(i => i.video_id), ['good0000001']);
});

test('subscriptions feed is fetched via channel uploads, filtered and cached', async () => {
  const yt = fakeYoutube([goodVideo, badVideo]);
  const svc = service(yt, makeRules({ blocked_keywords: [kw('scary')] }));
  const out = await svc.subscriptions();
  assert.deepEqual(out.items.map(i => i.video_id), ['good0000001']);
  await svc.subscriptions();
  assert.equal(yt.calls.subscriptions, 1);
});

test('playlists: keyword-blocked playlists are hidden and cannot be opened by id', async () => {
  const yt = fakeYoutube([goodVideo, badVideo]);
  const svc = service(yt, makeRules({ blocked_keywords: [kw('horror'), kw('scary')] }));

  const list = await svc.playlists();
  assert.deepEqual(list.items.map(p => p.id), ['PLgood']);

  await assert.rejects(svc.playlistItems({ playlistId: 'PLbad' }), NotFoundError);
  await assert.rejects(svc.playlistItems({ playlistId: 'PLsomeoneelses' }), NotFoundError);

  const items = await svc.playlistItems({ playlistId: 'PLgood' });
  assert.deepEqual(items.items.map(i => i.video_id), ['good0000001']);
});

test('result limit is applied after filtering', async () => {
  const many = Array.from({ length: 10 }, (_, i) => makeVideo({ videoId: `vid0000000${i}` }));
  const svc = service(fakeYoutube(many), makeRules(), { resultLimit: 3 });
  const out = await svc.search({ q: 'x' });
  assert.equal(out.items.length, 3);
});

test('keyword matches on allowed channels are recorded, and only for videos actually shown', async () => {
  const recorded = [];
  const flaggedVideo = makeVideo({ videoId: 'flag0000001', title: 'Scary tale', channelId: 'UCfine' });
  const svc = createContentService({
    youtube: fakeYoutube([flaggedVideo, goodVideo]),
    getRules: async () => makeRules({ blocked_keywords: [kw('scary')], allowed_channels: [{ channel_id: 'UCfine' }] }),
    cache: createTtlCache({ ttlMs: 60000 }),
    flags: { async record(f) { recorded.push(...f); } }
  });
  const out = await svc.search({ q: 'songs', pageToken: '' });
  assert.equal(out.items.length, 2);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].video.videoId, 'flag0000001');
  assert.deepEqual(recorded[0].keywords, ['scary']);
});

test('a failing flag store does not break the response', async () => {
  const flaggedVideo = makeVideo({ videoId: 'flag0000001', title: 'Scary tale', channelId: 'UCfine' });
  const svc = createContentService({
    youtube: fakeYoutube([flaggedVideo]),
    getRules: async () => makeRules({ blocked_keywords: [kw('scary')], allowed_channels: [{ channel_id: 'UCfine' }] }),
    cache: createTtlCache({ ttlMs: 60000 }),
    flags: { async record() { throw new Error('db down'); } }
  });
  const out = await svc.search({ q: 'songs', pageToken: '' });
  assert.equal(out.items.length, 1);
});

test('fresh results tell the community matcher which channels appeared, and a failing matcher is harmless', async () => {
  const seen = [];
  const svc = createContentService({
    youtube: fakeYoutube([goodVideo, makeVideo({ videoId: 'two00000001', channelId: 'UCother' })]),
    getRules: async () => makeRules(),
    cache: createTtlCache({ ttlMs: 60000 }),
    community: { async match(ids) { seen.push(ids); throw new Error('boom'); } }
  });
  const out = await svc.search({ q: 'songs', pageToken: '' });
  assert.equal(out.items.length, 2);
  assert.equal(seen.length, 1);
  assert.deepEqual([...seen[0]].sort(), [goodVideo.channelId, 'UCother'].sort());
  await svc.search({ q: 'songs', pageToken: '' }); // cache hit: no second lookup
  assert.equal(seen.length, 1);
});
