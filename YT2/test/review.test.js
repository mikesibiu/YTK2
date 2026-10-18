const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../app');
const { createAccessGate } = require('../lib/accessGate');

const AUTH = 'Basic ' + Buffer.from('parent:pw').toString('base64');
const ADMIN = { Authorization: AUTH, 'X-Requested-With': 'yt2', 'Content-Type': 'application/json' };

const FLAG = { id: 7, video_id: 'vid00000001', keyword: 'scary', title: 'T', channel_id: 'UCfine', channel_name: 'Fine', status: 'open' };

function makeDeps(overrides = {}) {
  const calls = [];
  const invalidated = { n: 0 };
  const db = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT \* FROM review_flags WHERE id/.test(sql)) {
        return { rowCount: params[0] === 7 ? 1 : 0, rows: params[0] === 7 ? [FLAG] : [] };
      }
      if (/SELECT \* FROM review_flags/.test(sql)) return { rowCount: 1, rows: [FLAG] };
      if (/DELETE FROM alert_ignores/.test(sql)) return { rowCount: params[0] === 3 ? 1 : 0, rows: [{ id: params[0] }] };
      return { rowCount: 1, rows: [] };
    }
  };
  const content = {
    async search({ q }) { return { query: q, items: [] }; },
    async subscriptions() { return { items: [] }; },
    async playlists() { return { items: [] }; },
    async playlistItems() { return { items: [] }; },
    clearCache() {}
  };
  return {
    db,
    content,
    google: { async getStatus() { return {}; } },
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
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    app.locals.stopLimiters();
  }
}

// ---- access code ----------------------------------------------------------------

test('child API is locked until the code is entered, then works with the cookie', async () => {
  const deps = makeDeps({ access: createAccessGate({ code: '6969', secret: 's' }) });
  await withServer(deps, async base => {
    for (const path of ['/api/search?q=a', '/api/subscriptions', '/api/playlists', '/api/playlists/PLx/items']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 401, path);
      assert.equal((await res.json()).error, 'locked');
    }
    assert.equal((await (await fetch(`${base}/api/session`)).json()).unlocked, false);

    const bad = await fetch(`${base}/api/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '0000' }) });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers.get('set-cookie'), null);

    const ok = await fetch(`${base}/api/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '6969' }) });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie').split(';')[0];

    assert.equal((await fetch(`${base}/api/search?q=a`, { headers: { cookie } })).status, 200);
    assert.equal((await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()).unlocked, true);
  });
});

test('wrong codes are rate limited', async () => {
  const deps = makeDeps({ access: createAccessGate({ code: '6969', secret: 's' }), limits: { unlockMax: 3 } });
  await withServer(deps, async base => {
    const attempt = () => fetch(`${base}/api/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '1111' }) });
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
    // Even the right code is refused while limited.
    const right = await fetch(`${base}/api/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '6969' }) });
    assert.equal(right.status, 429);
  });
});

test('admin API does not need the child code', async () => {
  const deps = makeDeps({ access: createAccessGate({ code: '6969', secret: 's' }) });
  await withServer(deps, async base => {
    assert.equal((await fetch(`${base}/api/admin/flags`, { headers: { Authorization: AUTH } })).status, 200);
  });
});

// ---- review log -----------------------------------------------------------------

test('flags endpoints require admin auth and the CSRF header on writes', async () => {
  await withServer(makeDeps(), async base => {
    assert.equal((await fetch(`${base}/api/admin/flags`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/flags/7/block`, { method: 'POST', headers: { Authorization: AUTH } })).status, 403);
  });
});

test('"don\'t alert again" stores the ignore, closes matching flags and reloads rules', async () => {
  const deps = makeDeps();
  await withServer(deps, async base => {
    const res = await fetch(`${base}/api/admin/flags/7/ignore`, { method: 'POST', headers: ADMIN, body: '{}' });
    assert.equal(res.status, 200);
    const insert = deps.db.calls.find(c => /INSERT INTO alert_ignores/.test(c.sql));
    assert.deepEqual(insert.params, ['UCfine', 'Fine', 'scary']);
    const update = deps.db.calls.find(c => /UPDATE review_flags SET status = 'ignored'/.test(c.sql));
    assert.deepEqual(update.params, ['UCfine', 'scary']);
    assert.ok(deps.invalidated.n >= 1);
  });
});

test('"block" blocks the channel first, removes it from allowed, and closes its flags', async () => {
  const deps = makeDeps();
  await withServer(deps, async base => {
    const res = await fetch(`${base}/api/admin/flags/7/block`, { method: 'POST', headers: ADMIN, body: '{}' });
    assert.equal(res.status, 200);
    const sqls = deps.db.calls.map(c => c.sql);
    const blockIdx = sqls.findIndex(s => /INSERT INTO blocked_channels/.test(s));
    const deleteIdx = sqls.findIndex(s => /DELETE FROM allowed_channels/.test(s));
    assert.ok(blockIdx >= 0 && deleteIdx > blockIdx, 'blocked before removed from allowed');
    assert.ok(sqls.some(s => /UPDATE review_flags SET status = 'blocked'/.test(s)));
    assert.ok(deps.invalidated.n >= 1);
  });
});

test('unknown flag id gives 404 and a bad id gives 400', async () => {
  await withServer(makeDeps(), async base => {
    assert.equal((await fetch(`${base}/api/admin/flags/99/dismiss`, { method: 'POST', headers: ADMIN, body: '{}' })).status, 404);
    assert.equal((await fetch(`${base}/api/admin/flags/abc/dismiss`, { method: 'POST', headers: ADMIN, body: '{}' })).status, 400);
  });
});

test('alert ignores can be removed to turn alerts back on', async () => {
  const deps = makeDeps();
  await withServer(deps, async base => {
    assert.equal((await fetch(`${base}/api/admin/alert-ignores/3`, { method: 'DELETE', headers: ADMIN })).status, 200);
    assert.equal((await fetch(`${base}/api/admin/alert-ignores/4`, { method: 'DELETE', headers: ADMIN })).status, 404);
    assert.ok(deps.invalidated.n >= 1);
  });
});
