// Parsers for publicly maintained filter lists. Pure functions, no network or database access.
// Each parser returns entries shaped { type, value, source, category?, reason? } so a later
// importer can put them in a review queue instead of applying them blindly.

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

const SOURCES = {
  dkberktas: {
    label: 'dkberktas/youtube-kids-blocklist',
    url: 'https://raw.githubusercontent.com/dkberktas/youtube-kids-blocklist/main/data/channels.json',
    license: 'CC0-1.0',
    kind: 'channel-ids'
  },
  aislist: {
    label: 'Override92/AiSList (AI-generated channels)',
    url: 'https://raw.githubusercontent.com/Override92/AiSList/main/AiSList/aislist_blocklist.txt',
    license: 'CC-BY-NC-4.0 (personal, non-commercial use)',
    kind: 'channel-handles'
  },
  ldnoobw: {
    label: 'LDNOOBW English bad words',
    url: 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en',
    license: 'CC-BY-4.0 (attribution required)',
    kind: 'keywords'
  }
};

// Channel records with a reason per row. Only rows judged "blocked" are returned unless
// `statuses` says otherwise, and `excludeCategories` lets a parent drop a class of decisions
// they disagree with (the list itself says its language rule is one household's preference).
function parseDkberktas(json, { statuses = ['blocked'], excludeCategories = [] } = {}) {
  const rows = Array.isArray(json) ? json : [];
  return rows
    .filter(r => r && CHANNEL_ID.test(r.channel_id || ''))
    .filter(r => statuses.includes(r.status))
    .filter(r => !excludeCategories.includes(r.category))
    .map(r => ({
      type: 'channel',
      value: r.channel_id,
      name: r.channel_name || null,
      source: 'dkberktas',
      category: r.category || null,
      reason: String(r.reason || '').slice(0, 300) || null
    }));
}

// AdGuard-style text file: "!" comments, one "@handle" or channel ID per line.
function parseAislist(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('!')) continue;
    if (CHANNEL_ID.test(line)) {
      out.push({ type: 'channel', value: line, source: 'aislist', category: 'ai-generated' });
    } else if (/^@[\w.\-]{3,100}$/.test(line)) {
      // Handles must be resolved to channel IDs before they can be matched (see docs).
      out.push({ type: 'channel-handle', value: line.toLowerCase(), source: 'aislist', category: 'ai-generated' });
    }
  }
  return out;
}

// One word or phrase per line. `skip` removes entries the parent does not want, for example
// words that are harmless in a kids context.
function parseWordList(text, source = 'ldnoobw', { skip = [] } = {}) {
  const skipSet = new Set(skip.map(s => s.toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const word = raw.trim().toLowerCase();
    if (!word || word.startsWith('#') || skipSet.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push({ type: 'keyword', value: word, source });
  }
  return out;
}

// Compare a candidate set with what is already configured, so a review queue only shows news.
function diffAgainstExisting(entries, { blockedChannelIds = [], allowedChannelIds = [], keywords = [] } = {}) {
  const blocked = new Set(blockedChannelIds);
  const allowed = new Set(allowedChannelIds);
  const words = new Set(keywords.map(k => String(k).toLowerCase()));
  const result = { new: [], alreadyBlocked: [], conflictsWithAllowed: [], alreadyKeyword: [] };
  for (const e of entries) {
    if (e.type === 'channel') {
      if (allowed.has(e.value)) result.conflictsWithAllowed.push(e);
      else if (blocked.has(e.value)) result.alreadyBlocked.push(e);
      else result.new.push(e);
    } else if (e.type === 'keyword') {
      (words.has(e.value) ? result.alreadyKeyword : result.new).push(e);
    } else {
      result.new.push(e);
    }
  }
  return result;
}

module.exports = { SOURCES, parseDkberktas, parseAislist, parseWordList, diffAgainstExisting };
