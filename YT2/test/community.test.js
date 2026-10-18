const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../app');

const AUTH = 'Basic ' + Buffer.from('parent:pw').toString('base64');
const ADMIN = { Authorization: AUTH, 'X-Requested-With': 'yt2', 'Content-Type': 'application/json' };

function makeDeps(community) {
  return {
    db: { async query() { return { rowCount: 0, rows: [] }; } },
    content: { clearCache() {} },
    google: {},
    rules: { invalidate() { this.n = (this.n || 0) + 1; } },
    community,
    adminUsername: 'parent',
    adminPassword: 'pw',
    isProduction: true
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

const fakeStore = (calls = []) => ({
  async listSources() { return [{ source: 'dkberktas' }]; },
  async importSource(source) { calls.push(['import', source]); return { entries: 3, queued: 3 }; },
  async listCandidates(opts) { calls.push(['list', opts]); return []; },
  async accept(id) { calls.push(['accept', id]); return id === 5 ? { ok: false, reason: 'allowed_channel' } : id === 9 ? { ok: false, reason: 'not_found' } : { ok: true }; },
  async reject(id) { calls.push(['reject', id]); return id !== 9; },
  async bulk(args) { calls.push(['bulk', args]); return { done: 2, skippedAllowed: 1 }; },
  async removeSource(source) { calls.push(['remove', source]); return { channels: 4, keywords: 0 }; }
});

test('community endpoints need admin login and the CSRF header', async () => {
  await withServer(makeDeps(fakeStore()), async base => {
    assert.equal((await fetch(`${base}/api/admin/community/sources`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/community/import`, { method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: '{"source":"dkberktas"}' })).status, 403);
    assert.equal((await fetch(`${base}/api/admin/community/sources`, { headers: { Authorization: AUTH } })).status, 200);
  });
});

test('import validates the source and calls the store', async () => {
  const calls = [];
  await withServer(makeDeps(fakeStore(calls)), async base => {
    const post = body => fetch(`${base}/api/admin/community/import`, { method: 'POST', headers: ADMIN, body: JSON.stringify(body) });
    assert.equal((await post({ source: 'evil' })).status, 400);
    assert.equal((await post({ source: 5 })).status, 400);
    const ok = await post({ source: 'dkberktas' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { entries: 3, queued: 3 });
    assert.deepEqual(calls, [['import', 'dkberktas']]);
  });
});

test('accept maps an allowed-channel conflict to 409, unknown ids to 404, and reloads rules', async () => {
  const deps = makeDeps(fakeStore());
  await withServer(deps, async base => {
    const accept = id => fetch(`${base}/api/admin/community/candidates/${id}/accept`, { method: 'POST', headers: ADMIN, body: '{}' });
    assert.equal((await accept(1)).status, 200);
    assert.equal((await accept(5)).status, 409);
    assert.equal((await accept(9)).status, 404);
    assert.equal((await accept('abc')).status, 400);
    assert.equal(deps.rules.n, 1);
  });
});

test('bulk, reject and remove-source validate input', async () => {
  const calls = [];
  await withServer(makeDeps(fakeStore(calls)), async base => {
    const bulk = body => fetch(`${base}/api/admin/community/candidates/bulk`, { method: 'POST', headers: ADMIN, body: JSON.stringify(body) });
    assert.equal((await bulk({ source: 'dkberktas', action: 'nuke' })).status, 400);
    assert.equal((await bulk({ source: 'nope', action: 'accept' })).status, 400);
    assert.deepEqual(await (await bulk({ source: 'dkberktas', category: 'chase', action: 'accept' })).json(), { done: 2, skippedAllowed: 1 });
    assert.equal((await fetch(`${base}/api/admin/community/candidates/9/reject`, { method: 'POST', headers: ADMIN, body: '{}' })).status, 404);
    assert.equal((await fetch(`${base}/api/admin/community/sources/nope`, { method: 'DELETE', headers: ADMIN })).status, 400);
    assert.deepEqual(await (await fetch(`${base}/api/admin/community/sources/dkberktas`, { method: 'DELETE', headers: ADMIN })).json(), { channels: 4, keywords: 0 });
  });
});

test('without a community store the endpoints answer 503 instead of crashing', async () => {
  await withServer(makeDeps(null), async base => {
    assert.equal((await fetch(`${base}/api/admin/community/sources`, { headers: { Authorization: AUTH } })).status, 503);
  });
});
