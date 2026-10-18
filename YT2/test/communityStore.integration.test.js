// Needs a Postgres with database/schema.sql applied:
//   TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/ytk2test npm test
// Skipped otherwise. It empties the community tables, blocked/allowed channels and keyword sources.
const test = require('node:test');
const assert = require('node:assert/strict');

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';

const UC = n => `UC${String(n).padStart(22, 'x')}`;

test('community store: review queue, allowed-channel protection, handles, auto-block, removal', { skip }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url });
  const db = { query: (sql, params) => pool.query(sql, params) };
  const { createCommunityStore } = require('../lib/communityStore');
  const { SOURCES } = require('../lib/communityLists');

  await db.query(`TRUNCATE community_candidates, community_sources, community_handles, channel_handles, blocked_channels, allowed_channels RESTART IDENTITY`);
  await db.query('DELETE FROM blocked_keywords WHERE source IS NOT NULL');
  await db.query("UPDATE config SET value = 'false' WHERE key = 'community_auto_block'");

  const dkRows = [UC(1), UC(2), UC(3)].map((id, i) => ({ channel_id: id, channel_name: `Chan ${i}`, status: 'blocked', category: 'farm', reason: 'r' }));
  const fakeFetch = async url => {
    const body = url === SOURCES.dkberktas.url ? JSON.stringify(dkRows)
      : url === SOURCES.aislist.url ? '! header\n@slopchannel\n@other-slop\n'
        : 'zzzfoo\ncrap\nzzzbar\ngore\n'; // crap: kids-context skip list; gore: already a keyword
    return { ok: true, status: 200, text: async () => body };
  };
  const store = createCommunityStore(db, { fetchImpl: fakeFetch, log: { error() {} } });

  try {
    assert.deepEqual(await store.importSource('dkberktas'), { entries: 3, queued: 3 });
    assert.equal((await store.importSource('dkberktas')).queued, 0, 're-import adds nothing');
    const kw = await store.importSource('ldnoobw');
    assert.equal(kw.queued, 2, 'kids-context word is not offered');

    // allowed channel: flagged and cannot be blocked from here
    await db.query('INSERT INTO allowed_channels (channel_id) VALUES ($1)', [UC(3)]);
    const rows = await store.listCandidates({ source: 'dkberktas' });
    const allowed = rows.find(r => r.value === UC(3));
    assert.equal(allowed.conflicts_with_allowed, true);
    assert.deepEqual(await store.accept(allowed.id), { ok: false, reason: 'allowed_channel' });

    const first = rows.find(r => r.value === UC(1));
    assert.deepEqual(await store.accept(first.id), { ok: true });
    assert.equal((await db.query('SELECT source FROM blocked_channels WHERE channel_id = $1', [UC(1)])).rows[0].source, 'dkberktas');

    assert.deepEqual(await store.bulk({ source: 'dkberktas', action: 'accept' }), { done: 1, skippedAllowed: 1 });

    // handle list: matches are queued, not applied
    await store.importSource('aislist');
    const ids = [UC(10), UC(11)];
    let fetched = 0;
    const yt = async () => { fetched += 1; return { items: [
      { id: ids[0], snippet: { customUrl: '@SlopChannel', title: 'Slop' } },
      { id: ids[1], snippet: { customUrl: '@fine', title: 'Fine' } }] }; };
    assert.equal(await store.resolveAndMatch(yt, ids), 1);
    assert.equal((await db.query("SELECT status FROM community_candidates WHERE value = $1", [ids[0]])).rows[0].status, 'pending');
    assert.equal((await db.query('SELECT 1 FROM blocked_channels WHERE channel_id = $1', [ids[0]])).rowCount, 0);
    await store.resolveAndMatch(yt, ids);
    assert.equal(fetched, 1, 'known handles are not fetched again');

    // auto-block applies to a new match but never to an allowed channel
    await db.query("UPDATE config SET value = 'true' WHERE key = 'community_auto_block'");
    await db.query('INSERT INTO allowed_channels (channel_id) VALUES ($1)', [UC(13)]);
    await store.resolveAndMatch(async () => ({ items: [
      { id: UC(12), snippet: { customUrl: '@other-slop', title: 'S2' } },
      { id: UC(13), snippet: { customUrl: '@other-slop', title: 'S3' } }] }), [UC(12), UC(13)]);
    assert.equal((await db.query('SELECT 1 FROM blocked_channels WHERE channel_id = $1', [UC(12)])).rowCount, 1);
    assert.equal((await db.query('SELECT 1 FROM blocked_channels WHERE channel_id = $1', [UC(13)])).rowCount, 0);

    // removing a source takes back what it added
    const removed = await store.removeSource('dkberktas');
    assert.equal(removed.channels, 2, 'the accepted one and the bulk-accepted one');
    assert.equal((await db.query("SELECT 1 FROM blocked_channels WHERE source = 'dkberktas'")).rowCount, 0);
  } finally {
    await pool.end();
  }
});
