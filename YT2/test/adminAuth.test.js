const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBasicAuth, safeEqual, createRequireAdminAuth } = require('../lib/adminAuth');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.payload = obj; return this; }
  };
}

const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

test('parseBasicAuth parses valid Basic header (password may contain colons)', () => {
  assert.deepEqual(parseBasicAuth(basic('parent', '*******')), { username: 'parent', password: '*******' });
});

test('parseBasicAuth returns null for malformed header', () => {
  assert.equal(parseBasicAuth('Bearer abc'), null);
  assert.equal(parseBasicAuth(''), null);
  assert.equal(parseBasicAuth('Basic ' + Buffer.from('noseparator').toString('base64')), null);
});

test('safeEqual compares correctly regardless of length', () => {
  assert.equal(safeEqual('secret', 'secret'), true);
  assert.equal(safeEqual('secret', 'secreT'), false);
  assert.equal(safeEqual('secret', 'secret-and-more'), false);
  assert.equal(safeEqual('', 'x'), false);
});

test('accepts correct credentials', () => {
  const mw = createRequireAdminAuth('parent', 'pw');
  let called = false;
  mw({ headers: { authorization: basic('parent', 'pw') } }, makeRes(), () => { called = true; });
  assert.equal(called, true);
});

test('rejects wrong password, wrong username, and missing header with 401 + challenge', () => {
  const mw = createRequireAdminAuth('parent', 'pw');
  for (const header of [basic('parent', 'nope'), basic('other', 'pw'), undefined]) {
    const res = makeRes();
    let called = false;
    mw({ headers: header ? { authorization: header } : {} }, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['WWW-Authenticate'], 'Basic realm="YT2 Admin"');
  }
});

test('with no credentials configured the default is to FAIL CLOSED (503)', () => {
  const mw = createRequireAdminAuth('', '');
  const res = makeRes();
  let called = false;
  mw({ headers: {} }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 503);
});

test('allowOpenWhenUnset (dev only) lets requests through when nothing is configured', () => {
  const mw = createRequireAdminAuth('', '', { allowOpenWhenUnset: true });
  let called = false;
  mw({ headers: {} }, makeRes(), () => { called = true; });
  assert.equal(called, true);
});

test('allowOpenWhenUnset does not bypass configured credentials', () => {
  const mw = createRequireAdminAuth('parent', 'pw', { allowOpenWhenUnset: true });
  const res = makeRes();
  let called = false;
  mw({ headers: {} }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
});
