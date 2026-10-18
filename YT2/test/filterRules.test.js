const test = require('node:test');
const assert = require('node:assert/strict');

const { createRulesLoader } = require('../lib/filterRules');
const { FilterUnavailableError } = require('../lib/errors');

function fakeDb({ failOn, config } = {}) {
  const calls = [];
  const defaultConfig = [
    { key: 'allowlist_only', value: 'false' },
    { key: 'made_for_kids', value: 'off' },
    { key: 'block_live', value: 'true' },
    { key: 'match_plurals', value: 'true' }
  ];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (failOn && sql.includes(failOn)) throw new Error('db down');
      if (sql.includes('blocked_keywords')) return { rows: [{ keyword: 'scary', case_sensitive: false }] };
      if (sql.includes('blocked_channels')) return { rows: [] };
      if (sql.includes('allowed_channels')) return { rows: [] };
      if (sql.includes('alert_ignores')) return { rows: [] };
      if (sql.includes('FROM config')) return { rows: config || defaultConfig };
      throw new Error('unexpected query');
    }
  };
}

test('loads and parses rules', async () => {
  const { getRules } = createRulesLoader({ db: fakeDb() });
  const rules = await getRules();
  assert.equal(rules.blocked_keywords.length, 1);
  assert.deepEqual(rules.config, { allowlist_only: false, made_for_kids: 'off', block_live: true, match_plurals: true });
});

test('FAIL CLOSED: a database error becomes FilterUnavailableError', async () => {
  for (const failOn of ['blocked_keywords', 'blocked_channels', 'allowed_channels', 'alert_ignores', 'FROM config']) {
    const { getRules } = createRulesLoader({ db: fakeDb({ failOn }) });
    await assert.rejects(getRules(), FilterUnavailableError, failOn);
  }
});

test('FAIL CLOSED: missing or garbage config rows are rejected', async () => {
  const missing = createRulesLoader({ db: fakeDb({ config: [{ key: 'block_live', value: 'true' }] }) });
  await assert.rejects(missing.getRules(), FilterUnavailableError);

  const garbage = createRulesLoader({
    db: fakeDb({ config: [
      { key: 'allowlist_only', value: 'maybe' },
      { key: 'made_for_kids', value: 'off' },
      { key: 'block_live', value: 'true' },
      { key: 'match_plurals', value: 'true' }
    ] })
  });
  await assert.rejects(garbage.getRules(), FilterUnavailableError);
});

test('rules are cached for the ttl, and invalidate() forces a reload', async () => {
  let t = 0;
  const db = fakeDb();
  const { getRules, invalidate } = createRulesLoader({ db, ttlMs: 1000, now: () => t });
  await getRules();
  const afterFirst = db.calls.length;
  await getRules();
  assert.equal(db.calls.length, afterFirst);
  invalidate();
  await getRules();
  assert.ok(db.calls.length > afterFirst);
  t = 5000;
  const before = db.calls.length;
  await getRules();
  assert.ok(db.calls.length > before);
});

test('no stale rules are served after the ttl if the database has failed', async () => {
  let t = 0;
  let down = false;
  const inner = fakeDb();
  const db = { query: (...a) => (down ? Promise.reject(new Error('down')) : inner.query(...a)) };
  const { getRules } = createRulesLoader({ db, ttlMs: 1000, now: () => t });
  await getRules();
  down = true;
  t = 2000;
  await assert.rejects(getRules(), FilterUnavailableError);
});

test('rules loaded by a request that started before invalidate() are not cached', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  let first = true;
  const db = {
    async query(sql) {
      if (sql.includes('blocked_keywords')) {
        if (first) { first = false; await gate; return { rows: [{ keyword: 'old', case_sensitive: false }] }; }
        return { rows: [{ keyword: 'new', case_sensitive: false }] };
      }
      if (sql.includes('blocked_channels') || sql.includes('allowed_channels') || sql.includes('alert_ignores')) return { rows: [] };
      return { rows: [
        { key: 'allowlist_only', value: 'false' }, { key: 'made_for_kids', value: 'off' },
        { key: 'block_live', value: 'true' }, { key: 'match_plurals', value: 'true' }
      ] };
    }
  };
  const { getRules, invalidate } = createRulesLoader({ db });
  const stale = getRules();
  invalidate();
  release();
  await stale;
  const fresh = await getRules();
  assert.equal(fresh.blocked_keywords[0].keyword, 'new');
});
