const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../lib/rateLimiter');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

function hit(limiter, ip) {
  const res = makeRes();
  let passed = false;
  limiter({ ip }, res, () => { passed = true; });
  return { passed, res };
}

test('allows up to max requests per window then returns 429 with Retry-After', () => {
  let t = 1000;
  const limiter = createRateLimiter({ windowMs: 60000, max: 3, now: () => t });
  try {
    assert.equal(hit(limiter, '1.1.1.1').passed, true);
    assert.equal(hit(limiter, '1.1.1.1').passed, true);
    assert.equal(hit(limiter, '1.1.1.1').passed, true);
    const blocked = hit(limiter, '1.1.1.1');
    assert.equal(blocked.passed, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.ok(Number(blocked.res.headers['Retry-After']) >= 1);
  } finally {
    limiter.stop();
  }
});

test('limits are per key (IP)', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: () => 0 });
  try {
    assert.equal(hit(limiter, 'a').passed, true);
    assert.equal(hit(limiter, 'a').passed, false);
    assert.equal(hit(limiter, 'b').passed, true);
  } finally {
    limiter.stop();
  }
});

test('window resets after windowMs', () => {
  let t = 0;
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => t });
  try {
    assert.equal(hit(limiter, 'a').passed, true);
    assert.equal(hit(limiter, 'a').passed, false);
    t = 1001;
    assert.equal(hit(limiter, 'a').passed, true);
  } finally {
    limiter.stop();
  }
});

test('sets X-RateLimit headers', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 5, now: () => 0 });
  try {
    const { res } = hit(limiter, 'a');
    assert.equal(res.headers['X-RateLimit-Limit'], '5');
    assert.equal(res.headers['X-RateLimit-Remaining'], '4');
  } finally {
    limiter.stop();
  }
});

test('refuses new keys once maxKeys is reached (bounded memory)', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 10, maxKeys: 2, now: () => 0 });
  try {
    assert.equal(hit(limiter, 'a').passed, true);
    assert.equal(hit(limiter, 'b').passed, true);
    assert.equal(hit(limiter, 'c').passed, false);
    assert.equal(limiter.size(), 2);
  } finally {
    limiter.stop();
  }
});

test('IPv6 clients are keyed by /64 so rotating addresses share a bucket', () => {
  const { clientKey } = require('../lib/rateLimiter');
  assert.equal(clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), clientKey('2001:db8:1:2:1111:2222:3333:4444'));
  assert.notEqual(clientKey('2001:db8:1:2::1'), clientKey('2001:db8:1:3::1'));
  assert.equal(clientKey('203.0.113.9'), '203.0.113.9');
  assert.equal(clientKey('::ffff:203.0.113.9'), '203.0.113.9');
});
