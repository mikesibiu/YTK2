const { SOURCES, parseDkberktas, parseAislist, parseWordList } = require('./communityLists');

// Words from the profanity list that are ordinary in kids' content (nursery rhymes, animals,
// sports, names), so they are never offered for review. Everything else is the parent's call.
const KIDS_CONTEXT_SKIP = [
  'pussy', 'cock', 'dick', 'balls', 'bum', 'butt', 'tit', 'tits', 'boob', 'boobs', 'nuts', 'nut', 'crap', 'damn',
  'hell', 'ass', 'bastard', 'bloody', 'bollocks', 'rear', 'fanny', 'spunk', 'wood', 'knob', 'bimbo', 'poop',
  'pee', 'piss', 'fart', 'snatch', 'hooker', 'shit', 'wank'
];

const HANDLE_MAX_AGE_DAYS = 30;
const ONE_MB = 1024 * 1024;

async function downloadText(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 8 * ONE_MB) throw new Error('List is unexpectedly large');
  return text;
}

function createCommunityStore(db, { log = console, fetchImpl = fetch } = {}) {
  async function isAutoBlock() {
    const result = await db.query("SELECT value FROM config WHERE key = 'community_auto_block'");
    return result.rows[0] && result.rows[0].value === 'true';
  }

  async function touchSource(source, count) {
    await db.query(
      `INSERT INTO community_sources (source, last_imported_at, entry_count) VALUES ($1, CURRENT_TIMESTAMP, $2)
       ON CONFLICT (source) DO UPDATE SET last_imported_at = CURRENT_TIMESTAMP, entry_count = EXCLUDED.entry_count`,
      [source, count]
    );
  }

  // Queue channels whose handle is known and listed by a handle source. With auto-block on,
  // they are blocked at once (never if the parent allowed the channel).
  async function matchHandles(channelIds) {
    const filter = channelIds ? 'AND ch.channel_id = ANY($1::text[])' : '';
    const params = channelIds ? [channelIds] : [];
    const queued = await db.query(
      `INSERT INTO community_candidates (source, type, value, name, category, reason)
       SELECT h.source, 'channel', ch.channel_id, ch.channel_name, 'ai-generated',
              'Handle ' || ch.handle || ' is on the ' || h.source || ' list'
       FROM channel_handles ch
       JOIN community_handles h ON h.handle = ch.handle
       WHERE NOT EXISTS (SELECT 1 FROM blocked_channels b WHERE b.channel_id = ch.channel_id)
         ${filter}
       ON CONFLICT (source, type, value) DO NOTHING
       RETURNING id`,
      params
    );
    if (queued.rowCount > 0 && (await isAutoBlock())) {
      await db.query(
        `INSERT INTO blocked_channels (channel_id, channel_name, reason, source)
         SELECT c.value, c.name, 'Community list: ' || c.source || ' (' || COALESCE(c.category, '') || ')', c.source
         FROM community_candidates c
         WHERE c.id = ANY($1::int[])
           AND NOT EXISTS (SELECT 1 FROM allowed_channels a WHERE a.channel_id = c.value)
         ON CONFLICT (channel_id) DO NOTHING`,
        [queued.rows.map(r => r.id)]
      );
      await db.query(
        `UPDATE community_candidates SET status = 'accepted', decided_at = CURRENT_TIMESTAMP
         WHERE id = ANY($1::int[]) AND EXISTS (SELECT 1 FROM blocked_channels b WHERE b.channel_id = value)`,
        [queued.rows.map(r => r.id)]
      );
    }
    return queued.rowCount;
  }

  // Learn the handles of channels that just appeared in results (1 quota unit per 50 channels),
  // then queue any that a handle list contains. Best effort: callers must not fail on errors.
  async function resolveAndMatch(youtubeGet, channelIds) {
    const unique = [...new Set((channelIds || []).filter(Boolean))];
    if (unique.length === 0) return 0;

    const known = await db.query(
      `SELECT channel_id FROM channel_handles
       WHERE channel_id = ANY($1::text[]) AND fetched_at > CURRENT_TIMESTAMP - ($2 || ' days')::interval`,
      [unique, String(HANDLE_MAX_AGE_DAYS)]
    );
    const knownSet = new Set(known.rows.map(r => r.channel_id));
    const missing = unique.filter(id => !knownSet.has(id));

    for (let i = 0; i < missing.length; i += 50) {
      const batch = missing.slice(i, i + 50);
      const payload = await youtubeGet('channels', { part: 'snippet', id: batch.join(',') });
      const found = (payload.items || []).map(item => ({
        id: item.id,
        handle: item.snippet && item.snippet.customUrl ? String(item.snippet.customUrl).toLowerCase() : null,
        name: item.snippet && item.snippet.title ? String(item.snippet.title).slice(0, 255) : null
      }));
      // Channels YouTube does not return are stored without a handle so they are not asked again.
      const byId = new Map(found.map(f => [f.id, f]));
      const rows = batch.map(id => byId.get(id) || { id, handle: null, name: null });
      await db.query(
        `INSERT INTO channel_handles (channel_id, handle, channel_name, fetched_at)
         SELECT t.id, t.handle, t.name, CURRENT_TIMESTAMP FROM unnest($1::text[], $2::text[], $3::text[]) AS t(id, handle, name)
         ON CONFLICT (channel_id) DO UPDATE SET handle = EXCLUDED.handle, channel_name = EXCLUDED.channel_name, fetched_at = CURRENT_TIMESTAMP`,
        [rows.map(r => r.id), rows.map(r => r.handle), rows.map(r => r.name)]
      );
    }
    // Only channels whose handle was just learned can be new matches (earlier ones were matched
    // then, or when the list was imported).
    return missing.length > 0 ? matchHandles(missing) : 0;
  }

  // ---- Import --------------------------------------------------------------------------

  async function importChannelRows(entries) {
    if (entries.length === 0) return 0;
    const result = await db.query(
      `INSERT INTO community_candidates (source, type, value, name, category, reason)
       SELECT t.source, 'channel', t.value, t.name, t.category, t.reason
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) AS t(source, value, name, category, reason)
       WHERE NOT EXISTS (SELECT 1 FROM blocked_channels b WHERE b.channel_id = t.value)
       ON CONFLICT (source, type, value) DO NOTHING
       RETURNING id`,
      [entries.map(e => e.source), entries.map(e => e.value), entries.map(e => e.name || null),
        entries.map(e => e.category || null), entries.map(e => e.reason || null)]
    );
    return result.rowCount;
  }

  async function importKeywordRows(entries) {
    if (entries.length === 0) return 0;
    const result = await db.query(
      `INSERT INTO community_candidates (source, type, value, category, reason)
       SELECT t.source, 'keyword', t.value, 'profanity', 'Word on the ' || t.source || ' list'
       FROM unnest($1::text[], $2::text[]) AS t(source, value)
       WHERE NOT EXISTS (SELECT 1 FROM blocked_keywords k WHERE lower(k.keyword) = t.value)
       ON CONFLICT (source, type, value) DO NOTHING
       RETURNING id`,
      [entries.map(e => e.source), entries.map(e => e.value)]
    );
    return result.rowCount;
  }

  async function importHandles(source, entries) {
    const handles = [...new Set(entries.filter(e => e.type === 'channel-handle').map(e => e.value))];
    for (let i = 0; i < handles.length; i += 10000) {
      await db.query(
        `INSERT INTO community_handles (source, handle) SELECT $1, h FROM unnest($2::text[]) AS h ON CONFLICT DO NOTHING`,
        [source, handles.slice(i, i + 10000)]
      );
    }
    // Entries the maintainers removed no longer count.
    await db.query('DELETE FROM community_handles WHERE source = $1 AND handle <> ALL($2::text[])', [source, handles]);
    const direct = entries.filter(e => e.type === 'channel');
    return { handles: handles.length, queuedDirect: await importChannelRows(direct) };
  }

  async function importSource(source) {
    const def = SOURCES[source];
    if (!def) throw new Error('Unknown source');
    const text = await downloadText(def.url, fetchImpl);

    let summary;
    if (source === 'dkberktas') {
      const entries = parseDkberktas(JSON.parse(text));
      summary = { entries: entries.length, queued: await importChannelRows(entries) };
    } else if (source === 'aislist') {
      const entries = parseAislist(text);
      const result = await importHandles(source, entries);
      summary = { entries: result.handles + entries.filter(e => e.type === 'channel').length, queued: result.queuedDirect };
      summary.queued += await matchHandles(null);
    } else if (source === 'ldnoobw') {
      const entries = parseWordList(text, source, { skip: KIDS_CONTEXT_SKIP });
      summary = { entries: entries.length, queued: await importKeywordRows(entries) };
    } else {
      throw new Error('Unknown source');
    }
    await touchSource(source, summary.entries);
    return summary;
  }

  // ---- Review queue --------------------------------------------------------------------

  async function listSources() {
    const counts = await db.query(
      `SELECT source,
              COUNT(*) FILTER (WHERE status = 'pending') AS pending,
              COUNT(*) FILTER (WHERE status = 'accepted') AS accepted,
              COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
       FROM community_candidates GROUP BY source`
    );
    const meta = await db.query('SELECT * FROM community_sources');
    const handleCounts = await db.query('SELECT source, COUNT(*) AS n FROM community_handles GROUP BY source');
    const metaBy = new Map(meta.rows.map(r => [r.source, r]));
    const countBy = new Map(counts.rows.map(r => [r.source, r]));
    const handlesBy = new Map(handleCounts.rows.map(r => [r.source, Number(r.n)]));
    return Object.entries(SOURCES).map(([key, def]) => ({
      source: key,
      label: def.label,
      license: def.license,
      kind: def.kind,
      last_imported_at: (metaBy.get(key) || {}).last_imported_at || null,
      entry_count: (metaBy.get(key) || {}).entry_count || 0,
      handles_stored: handlesBy.get(key) || 0,
      pending: Number((countBy.get(key) || {}).pending || 0),
      accepted: Number((countBy.get(key) || {}).accepted || 0),
      rejected: Number((countBy.get(key) || {}).rejected || 0)
    }));
  }

  async function listCandidates({ status = 'pending', source = null, limit = 300 } = {}) {
    const result = await db.query(
      `SELECT c.*,
              EXISTS (SELECT 1 FROM allowed_channels a WHERE c.type = 'channel' AND a.channel_id = c.value) AS conflicts_with_allowed
       FROM community_candidates c
       WHERE c.status = $1 AND ($2::text IS NULL OR c.source = $2)
       ORDER BY c.source, c.category NULLS LAST, c.name NULLS LAST, c.value
       LIMIT $3`,
      [status, source, limit]
    );
    return result.rows;
  }

  // Apply one candidate. Returns { ok, reason }. Channels on the parent's allowed list are never
  // blocked from here: the parent's own choice wins.
  async function accept(id) {
    const found = await db.query('SELECT * FROM community_candidates WHERE id = $1', [id]);
    if (found.rows.length === 0) return { ok: false, reason: 'not_found' };
    const c = found.rows[0];
    if (c.status === 'accepted') return { ok: true };

    if (c.type === 'channel') {
      const allowed = await db.query('SELECT 1 FROM allowed_channels WHERE channel_id = $1', [c.value]);
      if (allowed.rowCount > 0) return { ok: false, reason: 'allowed_channel' };
      await db.query(
        `INSERT INTO blocked_channels (channel_id, channel_name, reason, source) VALUES ($1, $2, $3, $4)
         ON CONFLICT (channel_id) DO NOTHING`,
        [c.value, c.name, `Community list: ${c.source}${c.category ? ` (${c.category})` : ''}`.slice(0, 500), c.source]
      );
    } else {
      await db.query(
        'INSERT INTO blocked_keywords (keyword, case_sensitive, source) VALUES ($1, false, $2) ON CONFLICT (keyword) DO NOTHING',
        [c.value, c.source]
      );
    }
    await db.query("UPDATE community_candidates SET status = 'accepted', decided_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);
    return { ok: true };
  }

  async function reject(id) {
    const result = await db.query(
      "UPDATE community_candidates SET status = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id",
      [id]
    );
    return result.rowCount > 0;
  }

  // Accept or reject every pending entry of a source (optionally one category).
  async function bulk({ source, category = null, action }) {
    const pending = await db.query(
      `SELECT id FROM community_candidates
       WHERE status = 'pending' AND source = $1 AND ($2::text IS NULL OR category = $2) ORDER BY id`,
      [source, category]
    );
    const result = { done: 0, skippedAllowed: 0 };
    for (const row of pending.rows) {
      if (action === 'reject') {
        await reject(row.id);
        result.done += 1;
      } else {
        const r = await accept(row.id);
        if (r.ok) result.done += 1;
        else if (r.reason === 'allowed_channel') result.skippedAllowed += 1;
      }
    }
    return result;
  }

  // Take back everything this source added and forget its pending entries.
  async function removeSource(source) {
    const channels = await db.query('DELETE FROM blocked_channels WHERE source = $1 RETURNING channel_id', [source]);
    const keywords = await db.query('DELETE FROM blocked_keywords WHERE source = $1 RETURNING keyword', [source]);
    await db.query("UPDATE community_candidates SET status = 'removed', decided_at = CURRENT_TIMESTAMP WHERE source = $1 AND status IN ('accepted', 'pending')", [source]);
    return { channels: channels.rowCount, keywords: keywords.rowCount };
  }

  return { importSource, listSources, listCandidates, accept, reject, bulk, removeSource, resolveAndMatch, matchHandles };
}

module.exports = { createCommunityStore, KIDS_CONTEXT_SKIP };
