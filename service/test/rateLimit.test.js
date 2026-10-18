const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter, createTtlCache } = require('../lib/rateLimit');

function run(limiter, ip) {
  const res = {
    code: 200,
    headers: {},
    set(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json() { return this; }
  };
  let passed = false;
  limiter({ ip }, res, () => { passed = true; });
  return { passed, res };
}

test('rate limiter blocks after max requests per IP', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
  assert.equal(run(limiter, '1.1.1.1').passed, true);
  assert.equal(run(limiter, '1.1.1.1').passed, true);
  const third = run(limiter, '1.1.1.1');
  assert.equal(third.passed, false);
  assert.equal(third.res.code, 429);
  assert.equal(run(limiter, '2.2.2.2').passed, true);
});

test('ttl cache expires entries and evicts oldest at capacity', async () => {
  const cache = createTtlCache({ ttlMs: 20, maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('c'), 3);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(cache.get('c'), undefined);
});
