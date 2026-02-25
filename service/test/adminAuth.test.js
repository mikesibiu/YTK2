const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBasicAuth, createRequireAdminAuth } = require('../lib/adminAuth');

test('parseBasicAuth parses valid Basic header', () => {
  const header = 'Basic ' + Buffer.from('parent:1967').toString('base64');
  const parsed = parseBasicAuth(header);
  assert.deepEqual(parsed, { username: 'parent', password: '1967' });
});

test('parseBasicAuth returns null for malformed header', () => {
  assert.equal(parseBasicAuth('Bearer abc'), null);
  const bad = 'Basic ' + Buffer.from('missingSeparator').toString('base64');
  assert.equal(parseBasicAuth(bad), null);
});

test('createRequireAdminAuth allows request when auth disabled', () => {
  let nextCalled = false;
  const middleware = createRequireAdminAuth('', '');
  middleware({ headers: {} }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('createRequireAdminAuth rejects invalid credentials', () => {
  const middleware = createRequireAdminAuth('parent', '1967');

  let statusCode = 200;
  let payload;
  const res = {
    headers: {},
    set(key, value) { this.headers[key] = value; },
    status(code) { statusCode = code; return this; },
    json(obj) { payload = obj; return this; }
  };

  const header = 'Basic ' + Buffer.from('parent:wrong').toString('base64');
  middleware({ headers: { authorization: header } }, res, () => {});

  assert.equal(statusCode, 401);
  assert.equal(payload.error, 'Invalid credentials');
  assert.equal(res.headers['WWW-Authenticate'], 'Basic realm="YTK2 Admin"');
});
