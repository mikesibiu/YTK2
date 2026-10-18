const test = require('node:test');
const assert = require('node:assert/strict');

const { createYouTubeClient, createQuotaGuard, normalizeVideo } = require('../lib/youtubeClient');
const { QuotaBudgetError, YouTubeApiError } = require('../lib/errors');

function ok(body) { return { ok: true, status: 200, json: async () => body }; }

test('normalizeVideo reads description, tags, age rating, madeForKids, live, embeddable', () => {
  const v = normalizeVideo({
    id: 'abc',
    snippet: { title: 'T', description: 'D', tags: ['x', 'y'], channelId: 'UC1', channelTitle: 'C', liveBroadcastContent: 'live', thumbnails: { high: { url: 'https://i.ytimg.com/h.jpg' } } },
    contentDetails: { contentRating: { ytRating: 'ytAgeRestricted' } },
    status: { madeForKids: true, embeddable: true }
  });
  assert.equal(v.detailed, true);
  assert.deepEqual(v.tags, ['x', 'y']);
  assert.equal(v.ageRestricted, true);
  assert.equal(v.madeForKids, true);
  assert.equal(v.liveBroadcastContent, 'live');
  assert.equal(v.thumbnail, 'https://i.ytimg.com/h.jpg');
});

test('normalizeVideo marks incomplete items as not detailed (so the filter drops them)', () => {
  assert.equal(normalizeVideo({ id: 'a', snippet: { title: 'x' } }).detailed, false);
  assert.equal(normalizeVideo({}).detailed, false);
});

test('videoDetails batches ids in groups of 50 and requests snippet,contentDetails,status', async () => {
  const urls = [];
  const fetchFn = async url => {
    urls.push(new URL(url));
    const ids = new URL(url).searchParams.get('id').split(',');
    return ok({ items: ids.map(id => ({ id, snippet: { title: id, channelId: 'UC' }, contentDetails: {}, status: {} })) });
  };
  const client = createYouTubeClient({ getAccessToken: async () => 'tok', fetchFn });
  const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
  const out = await client.videoDetails(ids);
  assert.equal(urls.length, 3);
  assert.equal(urls[0].searchParams.get('part'), 'snippet,contentDetails,status');
  assert.equal(urls[0].searchParams.get('id').split(',').length, 50);
  assert.equal(out.length, 120);
});

test('search asks for strict safe search, embeddable videos only, 50 results, with a Bearer token', async () => {
  let seen;
  const fetchFn = async (url, opts) => { seen = { url: new URL(url), headers: opts.headers }; return ok({ items: [{ id: { videoId: 'v1' } }], nextPageToken: 'N' }); };
  const client = createYouTubeClient({ getAccessToken: async () => 'tok', fetchFn });
  const out = await client.search({ q: 'songs' });
  assert.deepEqual(out, { ids: ['v1'], nextPageToken: 'N' });
  assert.equal(seen.url.searchParams.get('safeSearch'), 'strict');
  assert.equal(seen.url.searchParams.get('videoEmbeddable'), 'true');
  assert.equal(seen.url.searchParams.get('maxResults'), '50');
  assert.equal(seen.headers.Authorization, 'Bearer tok');
  assert.equal(seen.url.searchParams.has('key'), false);
});

test('quota guard blocks calls beyond the budget before they reach YouTube', async () => {
  let fetched = 0;
  const fetchFn = async () => { fetched += 1; return ok({ items: [] }); };
  const client = createYouTubeClient({
    getAccessToken: async () => 'tok',
    fetchFn,
    quota: createQuotaGuard({ budget: 150 })
  });
  await client.search({ q: 'a' }); // 100
  await assert.rejects(client.search({ q: 'b' }), QuotaBudgetError); // 200 > 150
  assert.equal(fetched, 1);
});

test('401 triggers one retry with a forced token refresh', async () => {
  const forced = [];
  let n = 0;
  const fetchFn = async () => (++n === 1 ? { ok: false, status: 401, json: async () => ({}) } : ok({ items: [] }));
  const client = createYouTubeClient({
    getAccessToken: async ({ forceRefresh }) => { forced.push(forceRefresh); return 't'; },
    fetchFn
  });
  await client.playlistsMine();
  assert.deepEqual(forced, [false, true]);
});

test('API errors surface as YouTubeApiError with the reason', async () => {
  const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }] } }) });
  const client = createYouTubeClient({ getAccessToken: async () => 't', fetchFn });
  await assert.rejects(client.playlistsMine(), e => e instanceof YouTubeApiError && e.reason === 'quotaExceeded');
});

test('channelUploads derives the UU uploads playlist id and rejects malformed channel ids', async () => {
  let seen;
  const fetchFn = async url => { seen = new URL(url); return ok({ items: [{ contentDetails: { videoId: 'v', videoPublishedAt: '2026-01-01' } }] }); };
  const client = createYouTubeClient({ getAccessToken: async () => 't', fetchFn });
  const id = 'UC' + 'a'.repeat(22);
  const out = await client.channelUploads(id, 5);
  assert.equal(seen.searchParams.get('playlistId'), 'UU' + 'a'.repeat(22));
  assert.equal(out.length, 1);
  assert.deepEqual(await client.channelUploads('nope', 5), []);
});
