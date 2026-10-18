const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../app');
const { FilterUnavailableError, NotConnectedError } = require('../lib/errors');

const AUTH = 'Basic ' + Buffer.from('parent:pw').toString('base64');
const ADMIN_HEADERS = { Authorization: AUTH, 'X-Requested-With': 'yt2', 'Content-Type': 'application/json' };

function makeDeps(overrides = {}) {
  const dbCalls = [];
  const db = {
    dbCalls,
    async query(sql, params) {
      dbCalls.push({ sql, params });
      if (/DELETE FROM/.test(sql)) return { rowCount: 1, rows: [{ id: params[0] }] };
      if (/UPDATE config/.test(sql)) return { rowCount: 1, rows: [{ key: params[1], value: params[0] }] };
      if (/INSERT INTO/.test(sql)) return { rowCount: 1, rows: [{ id: 1, ...Object.fromEntries((params || []).map((v, i) => [`p${i}`, v])) }] };
      return { rowCount: 0, rows: [] };
    }
  };
  const invalidated = { n: 0 };
  const content = {
    async search({ q }) { return { query: q, items: [], total_count: 0, filtered_count: 0, next_page_token: null }; },
    async subscriptions() { return { items: [] }; },
    async playlists() { return { items: [] }; },
    async playlistItems({ playlistId }) { return { playlist_id: playlistId, items: [] }; },
    clearCache() {}
  };
  const google = {
    async getStatus() { return { configured: true, connected: true, channel_title: 'Dad' }; },
    createAuthRequest() { return { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', state: 'STATE123', verifier: 'VERIFIER456' }; },
    async handleCallback(args) { google.lastCallback = args; },
    async disconnect() { google.disconnected = true; }
  };
  return {
    db,
    content,
    google,
    rules: { invalidate: () => { invalidated.n += 1; } },
    invalidated,
    adminUsername: 'parent',
    adminPassword: 'pw',
    isProduction: true,
    ...overrides
  };
}

async function withServer(deps, fn) {
  const app = createApp(deps);
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
    app.locals.stopLimiters();
  }
}

// ---- public API ---------------------------------------------------------------

test('public search works without credentials and is not cacheable by browsers', async () => {
  await withServer(makeDeps(), async base => {
    const res = await fetch(`${base}/api/search?q=songs`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await res.json()).query, 'songs');
  });
});

test('search validates q and pageToken', async () => {
  await withServer(makeDeps(), async base => {
    assert.equal((await fetch(`${base}/api/search`)).status, 400);
    assert.equal((await fetch(`${base}/api/search?q=%20%20`)).status, 400);
    assert.equal((await fetch(`${base}/api/search?q=${'a'.repeat(101)}`)).status, 400);
    assert.equal((await fetch(`${base}/api/search?q=ok&pageToken=${encodeURIComponent('bad token!')}`)).status, 400);
    assert.equal((await fetch(`${base}/api/search?q=a&q=b`)).status, 400); // repeated param is not a string
  });
});

test('FAIL CLOSED at the HTTP layer: filter errors give 503 and no items', async () => {
  const deps = makeDeps();
  deps.content.search = async () => { throw new FilterUnavailableError(); };
  deps.content.subscriptions = async () => { throw new FilterUnavailableError(); };
  deps.content.playlists = async () => { throw new FilterUnavailableError(); };
  deps.content.playlistItems = async () => { throw new FilterUnavailableError(); };
  await withServer(deps, async base => {
    for (const path of ['/api/search?q=x', '/api/subscriptions', '/api/playlists', '/api/playlists/PLabc/items']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 503, path);
      const body = await res.json();
      assert.equal(body.error, 'filter_unavailable');
      assert.equal(body.items, undefined);
    }
  });
});

test('not connected to Google -> 503 not_connected', async () => {
  const deps = makeDeps();
  deps.content.subscriptions = async () => { throw new NotConnectedError(); };
  await withServer(deps, async base => {
    const res = await fetch(`${base}/api/subscriptions`);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'not_connected');
  });
});

test('playlist id is validated', async () => {
  await withServer(makeDeps(), async base => {
    assert.equal((await fetch(`${base}/api/playlists/PLabc123/items`)).status, 200);
    assert.equal((await fetch(`${base}/api/playlists/${encodeURIComponent('a b')}/items`)).status, 400);
    assert.equal((await fetch(`${base}/api/playlists/${encodeURIComponent('x'.repeat(80))}/items`)).status, 400);
  });
});

test('search is rate limited per IP', async () => {
  await withServer(makeDeps({ limits: { searchMax: 3, publicMax: 100 } }), async base => {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await fetch(`${base}/api/search?q=x`)).status);
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  });
});

test('all public routes share the general limiter', async () => {
  await withServer(makeDeps({ limits: { publicMax: 2, searchMax: 100 } }), async base => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await fetch(`${base}/api/playlists`)).status);
    assert.deepEqual(statuses, [200, 200, 429, 429]);
  });
});

test('security headers: CSP restricts frames to youtube-nocookie and blocks framing of the app', async () => {
  await withServer(makeDeps(), async base => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

test('child UI contains no links to youtube.com and the iframe is sandboxed', async () => {
  await withServer(makeDeps(), async base => {
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(!/href=["']https?:\/\/[^"']*youtube\.com/i.test(html));
    assert.ok(!/<a\s/i.test(html));
    assert.match(html, /<iframe[^>]*sandbox="[^"]*"/);
    assert.ok(!/allow-popups|allow-top-navigation/.test(html));
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /youtube-nocookie\.com\/embed/);
    assert.match(js, /rel: '0'/);
    assert.ok(!/https:\/\/www\.youtube\.com/.test(js));
  });
});

// ---- admin ---------------------------------------------------------------------

test('admin API and UI require Basic auth', async () => {
  await withServer(makeDeps(), async base => {
    for (const path of ['/api/admin/keywords', '/api/admin/config', '/api/admin/google/status', '/admin/', '/admin/admin.js']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 401, path);
      assert.equal(res.headers.get('www-authenticate'), 'Basic realm="YT2 Admin"');
    }
    const bad = await fetch(`${base}/api/admin/keywords`, { headers: { Authorization: 'Basic ' + Buffer.from('parent:wrong').toString('base64') } });
    assert.equal(bad.status, 401);
  });
});

test('admin UI is served with valid credentials', async () => {
  await withServer(makeDeps(), async base => {
    const res = await fetch(`${base}/admin/`, { headers: { Authorization: AUTH } });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /YT2 Filter Admin/);
  });
});

test('production-style app with no admin credentials configured refuses admin access (503)', async () => {
  await withServer(makeDeps({ adminUsername: '', adminPassword: '' }), async base => {
    assert.equal((await fetch(`${base}/api/admin/keywords`)).status, 503);
  });
});

test(':id params must be integers (400 otherwise)', async () => {
  await withServer(makeDeps(), async base => {
    for (const route of ['keywords', 'blocked-channels', 'allowed-channels']) {
      for (const bad of ['abc', '1abc', '1.5', '-1', '1e3', '99999999999999999999', '%20']) {
        const res = await fetch(`${base}/api/admin/${route}/${bad}`, { method: 'DELETE', headers: ADMIN_HEADERS });
        assert.equal(res.status, 400, `${route}/${bad}`);
      }
      const ok = await fetch(`${base}/api/admin/${route}/5`, { method: 'DELETE', headers: ADMIN_HEADERS });
      assert.equal(ok.status, 200);
    }
  });
});

test('state-changing admin requests need the X-Requested-With header (CSRF guard)', async () => {
  await withServer(makeDeps(), async base => {
    const res = await fetch(`${base}/api/admin/keywords`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'x' })
    });
    assert.equal(res.status, 403);
  });
});

test('adding a keyword normalises, validates, and invalidates the rules cache', async () => {
  const deps = makeDeps();
  await withServer(deps, async base => {
    const post = body => fetch(`${base}/api/admin/keywords`, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify(body) });

    assert.equal((await post({ keyword: '  Escape   ROOM ' })).status, 201);
    const insert = deps.db.dbCalls.find(c => /INSERT INTO blocked_keywords/.test(c.sql));
    assert.deepEqual(insert.params, ['escape room', false]);
    assert.equal(deps.invalidated.n, 1);

    assert.equal((await post({ keyword: 'FNAF', case_sensitive: true })).status, 201);
    assert.deepEqual(deps.db.dbCalls.filter(c => /INSERT INTO blocked_keywords/.test(c.sql))[1].params, ['FNAF', true]);

    assert.equal((await post({ keyword: '' })).status, 400);
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ keyword: 123 })).status, 400);
    assert.equal((await post({ keyword: 'x'.repeat(101) })).status, 400);
  });
});

test('channel ids must look like YouTube channel ids', async () => {
  await withServer(makeDeps(), async base => {
    const post = body => fetch(`${base}/api/admin/blocked-channels`, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify(body) });
    assert.equal((await post({ channel_id: '@somehandle' })).status, 400);
    assert.equal((await post({ channel_id: 'UCshort' })).status, 400);
    assert.equal((await post({ channel_id: 'UC' + 'a'.repeat(22) })).status, 201);
  });
});

test('config updates are whitelisted and validated', async () => {
  await withServer(makeDeps(), async base => {
    const put = (key, value) => fetch(`${base}/api/admin/config/${key}`, { method: 'PUT', headers: ADMIN_HEADERS, body: JSON.stringify({ value }) });
    assert.equal((await put('allowlist_only', true)).status, 200);
    assert.equal((await put('allowlist_only', 'maybe')).status, 400);
    assert.equal((await put('made_for_kids', 'require')).status, 200);
    assert.equal((await put('made_for_kids', 'always')).status, 400);
    assert.equal((await put('block_live', 'false')).status, 200);
    assert.equal((await put('api_version', '2')).status, 404);
  });
});

test('database errors in admin routes return a generic 500 (no internals leaked)', async () => {
  const deps = makeDeps();
  deps.db.query = async () => { throw new Error('secret connection string postgres://u:p@h/db'); };
  await withServer(deps, async base => {
    const res = await fetch(`${base}/api/admin/keywords`, { headers: { Authorization: AUTH } });
    assert.equal(res.status, 500);
    assert.ok(!(await res.text()).includes('postgres://'));
  });
});

// ---- Google OAuth routes -----------------------------------------------------------

test('google/start sets an HttpOnly SameSite cookie and redirects to Google', async () => {
  await withServer(makeDeps(), async base => {
    const res = await fetch(`${base}/api/admin/google/start`, { headers: { Authorization: AUTH }, redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /yt2_oauth=STATE123\.VERIFIER456/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  });
});

test('google/callback rejects a missing or mismatched state and does not exchange the code', async () => {
  const deps = makeDeps();
  await withServer(deps, async base => {
    const noCookie = await fetch(`${base}/api/admin/google/callback?code=C&state=STATE123`, { headers: { Authorization: AUTH }, redirect: 'manual' });
    assert.equal(noCookie.headers.get('location'), '/admin/?google=error');

    const wrong = await fetch(`${base}/api/admin/google/callback?code=C&state=OTHER`, {
      headers: { Authorization: AUTH, Cookie: 'yt2_oauth=STATE123.VERIFIER456' }, redirect: 'manual'
    });
    assert.equal(wrong.headers.get('location'), '/admin/?google=error');
    assert.equal(deps.google.lastCallback, undefined);
  });
});

test('google/callback with a matching state exchanges the code with the stored PKCE verifier', async () => {
  const deps = makeDeps();
  await withServer(deps, async base => {
    const res = await fetch(`${base}/api/admin/google/callback?code=CODE&state=STATE123`, {
      headers: { Authorization: AUTH, Cookie: 'yt2_oauth=STATE123.VERIFIER456' }, redirect: 'manual'
    });
    assert.equal(res.headers.get('location'), '/admin/?google=connected');
    assert.deepEqual(deps.google.lastCallback, { code: 'CODE', verifier: 'VERIFIER456' });
    assert.match(res.headers.get('set-cookie'), /yt2_oauth=;.*Max-Age=0/);
  });
});

test('google/callback requires admin auth too', async () => {
  await withServer(makeDeps(), async base => {
    const res = await fetch(`${base}/api/admin/google/callback?code=C&state=S`, { redirect: 'manual' });
    assert.equal(res.status, 401);
  });
});

test('google/status exposes connection info only; disconnect needs the CSRF header', async () => {
  const deps = makeDeps();
  await withServer(deps, async base => {
    const status = await (await fetch(`${base}/api/admin/google/status`, { headers: { Authorization: AUTH } })).json();
    assert.equal(status.connected, true);
    assert.ok(!('refresh_token' in status) && !('refresh_token_enc' in status));

    const noHeader = await fetch(`${base}/api/admin/google/disconnect`, { method: 'POST', headers: { Authorization: AUTH } });
    assert.equal(noHeader.status, 403);
    assert.equal(deps.google.disconnected, undefined);

    const ok = await fetch(`${base}/api/admin/google/disconnect`, { method: 'POST', headers: ADMIN_HEADERS, body: '{}' });
    assert.equal(ok.status, 200);
    assert.equal(deps.google.disconnected, true);
  });
});
