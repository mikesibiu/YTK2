const test = require('node:test');
const assert = require('node:assert/strict');

const { createTtlCache } = require('../lib/ttlCache');

test('entries expire after ttl', () => {
  let t = 0;
  const cache = createTtlCache({ ttlMs: 100, now: () => t });
  cache.set('k', 'v');
  assert.equal(cache.get('k'), 'v');
  t = 101;
  assert.equal(cache.get('k'), undefined);
});

test('getOrLoad shares one in-flight load and caches the result', async () => {
  const cache = createTtlCache({ ttlMs: 1000 });
  let calls = 0;
  const loader = async () => { calls += 1; return 'x'; };
  const [a, b] = await Promise.all([cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)]);
  assert.equal(a, 'x');
  assert.equal(b, 'x');
  await cache.getOrLoad('k', loader);
  assert.equal(calls, 1);
});

test('getOrLoad does not cache failures', async () => {
  const cache = createTtlCache({ ttlMs: 1000 });
  await assert.rejects(cache.getOrLoad('k', async () => { throw new Error('boom'); }));
  assert.equal(await cache.getOrLoad('k', async () => 'ok'), 'ok');
});

test('maxEntries evicts the oldest entry', () => {
  const cache = createTtlCache({ ttlMs: 1000, maxEntries: 2 });
  cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.size(), 2);
});
