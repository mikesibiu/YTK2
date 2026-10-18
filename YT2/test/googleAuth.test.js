const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { parseKey, encrypt, decrypt } = require('../lib/tokenCrypto');
const { createGoogleAuth, SCOPE } = require('../lib/googleAuth');
const { NotConnectedError } = require('../lib/errors');

const key = crypto.randomBytes(32);

function memoryStore() {
  let row = null;
  return {
    get row() { return row; },
    async load() { return row; },
    async save(v) { row = { refresh_token_enc: v.refreshTokenEnc, scope: v.scope, channel_id: v.channelId, channel_title: v.channelTitle, connected_at: new Date() }; },
    async clear() { row = null; }
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeAuth(fetchFn, store = memoryStore(), extra = {}) {
  return {
    store,
    auth: createGoogleAuth({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'https://example.test/api/admin/google/callback',
      store,
      encryptionKey: key,
      fetchFn,
      ...extra
    })
  };
}

test('tokenCrypto round-trips, uses a fresh IV, and detects tampering and wrong keys', () => {
  const a = encrypt('refresh-token-123', key);
  const b = encrypt('refresh-token-123', key);
  assert.notEqual(a, b);
  assert.ok(!a.includes('refresh-token-123'));
  assert.equal(decrypt(a, key), 'refresh-token-123');

  const parts = a.split('.');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decrypt(parts.join('.'), key));
  assert.throws(() => decrypt(a, crypto.randomBytes(32)));
  assert.throws(() => decrypt('garbage', key));
});

test('parseKey accepts 32-byte base64 and 64-char hex, rejects anything else', () => {
  assert.equal(parseKey(crypto.randomBytes(32).toString('base64')).length, 32);
  assert.equal(parseKey(crypto.randomBytes(32).toString('hex')).length, 32);
  assert.throws(() => parseKey('short'));
  assert.throws(() => parseKey(''));
  assert.throws(() => parseKey(undefined));
});

test('auth request: read-only scope, offline access, PKCE, state; no client secret in the URL', () => {
  const { auth } = makeAuth(async () => { throw new Error('no network'); });
  const { url, state, verifier } = auth.createAuthRequest();
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.readonly');
  assert.equal(SCOPE, 'https://www.googleapis.com/auth/youtube.readonly');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('state'), state);
  assert.equal(
    u.searchParams.get('code_challenge'),
    crypto.createHash('sha256').update(verifier).digest('base64url')
  );
  assert.ok(!url.includes('secret'));
  assert.ok(!url.includes(verifier));
});

test('callback stores the refresh token ENCRYPTED and never exposes it via status', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url: String(url), body: opts && opts.body });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return jsonResponse(200, { access_token: 'ACCESS', refresh_token: 'REFRESH-SECRET', expires_in: 3600, scope: SCOPE });
    }
    return jsonResponse(200, { items: [{ id: 'UCabc', snippet: { title: 'Dad' } }] });
  };
  const { auth, store } = makeAuth(fetchFn);
  await auth.handleCallback({ code: 'CODE', verifier: 'VERIFIER' });

  assert.ok(!store.row.refresh_token_enc.includes('REFRESH-SECRET'));
  assert.equal(decrypt(store.row.refresh_token_enc, key), 'REFRESH-SECRET');
  assert.match(calls[0].body, /code_verifier=VERIFIER/);
  assert.match(calls[0].body, /grant_type=authorization_code/);

  const status = await auth.getStatus();
  assert.equal(status.connected, true);
  assert.equal(status.channel_title, 'Dad');
  assert.ok(!JSON.stringify(status).includes('REFRESH'));
  assert.ok(!JSON.stringify(status).includes('ACCESS'));
});

test('callback rejects a response without a refresh token or without the youtube.readonly scope', async () => {
  const noRefresh = makeAuth(async () => jsonResponse(200, { access_token: 'A', expires_in: 3600, scope: SCOPE }));
  await assert.rejects(noRefresh.auth.handleCallback({ code: 'c', verifier: 'v' }), /refresh token/i);
  assert.equal(noRefresh.store.row, null);

  const wrongScope = makeAuth(async () => jsonResponse(200, { access_token: 'A', refresh_token: 'R', expires_in: 3600, scope: 'openid' }));
  await assert.rejects(wrongScope.auth.handleCallback({ code: 'c', verifier: 'v' }), /not granted/i);
  assert.equal(wrongScope.store.row, null);
});

test('getAccessToken refreshes once, caches until near expiry, and shares in-flight refreshes', async () => {
  let refreshes = 0;
  let t = 0;
  const store = memoryStore();
  await store.save({ refreshTokenEnc: encrypt('R', key), scope: SCOPE });
  const fetchFn = async () => { refreshes += 1; return jsonResponse(200, { access_token: `A${refreshes}`, expires_in: 3600 }); };
  const { auth } = makeAuth(fetchFn, store, { now: () => t });

  const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
  assert.equal(a, 'A1');
  assert.equal(b, 'A1');
  assert.equal(await auth.getAccessToken(), 'A1');
  assert.equal(refreshes, 1);

  t = 3600 * 1000; // expired
  assert.equal(await auth.getAccessToken(), 'A2');
  assert.equal(await auth.getAccessToken({ forceRefresh: true }), 'A3');
});

test('invalid_grant clears the stored token and reports NotConnected', async () => {
  const store = memoryStore();
  await store.save({ refreshTokenEnc: encrypt('R', key), scope: SCOPE });
  const { auth } = makeAuth(async () => jsonResponse(400, { error: 'invalid_grant' }), store);
  await assert.rejects(auth.getAccessToken(), NotConnectedError);
  assert.equal(store.row, null);
});

test('not connected -> NotConnectedError; disconnect revokes and deletes the row', async () => {
  const store = memoryStore();
  const urls = [];
  const { auth } = makeAuth(async url => { urls.push(String(url)); return jsonResponse(200, {}); }, store);
  await assert.rejects(auth.getAccessToken(), NotConnectedError);

  await store.save({ refreshTokenEnc: encrypt('R', key), scope: SCOPE });
  await auth.disconnect();
  assert.equal(store.row, null);
  assert.ok(urls.some(u => u.startsWith('https://oauth2.googleapis.com/revoke')));
});

test('an undecryptable stored token (key changed) is reported as NotConnected', async () => {
  const store = memoryStore();
  await store.save({ refreshTokenEnc: encrypt('R', crypto.randomBytes(32)), scope: SCOPE });
  const { auth } = makeAuth(async () => jsonResponse(200, {}), store);
  await assert.rejects(auth.getAccessToken(), NotConnectedError);
});
