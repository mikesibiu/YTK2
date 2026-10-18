const { FilterUnavailableError } = require('./errors');
const { MADE_FOR_KIDS_MODES, assertValidRules } = require('./videoFilter');

const CONFIG_KEYS = ['allowlist_only', 'made_for_kids', 'block_live', 'match_plurals'];

function parseBool(value, key) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new FilterUnavailableError(`Invalid config value for ${key}`);
}

function parseConfig(rows) {
  const raw = {};
  for (const row of rows) raw[row.key] = row.value;

  for (const key of CONFIG_KEYS) {
    if (raw[key] === undefined) {
      throw new FilterUnavailableError(`Missing config key ${key} (was database/schema.sql applied?)`);
    }
  }
  if (!MADE_FOR_KIDS_MODES.includes(raw.made_for_kids)) {
    throw new FilterUnavailableError('Invalid config value for made_for_kids');
  }

  return {
    allowlist_only: parseBool(raw.allowlist_only, 'allowlist_only'),
    made_for_kids: raw.made_for_kids,
    block_live: parseBool(raw.block_live, 'block_live'),
    match_plurals: parseBool(raw.match_plurals, 'match_plurals')
  };
}

/**
 * Loads filter rules from the database. FAIL CLOSED: any database or validation problem
 * throws FilterUnavailableError. A successful load is reused for `ttlMs` only; there is
 * never a "serve stale rules after an error" path.
 */
function createRulesLoader({ db, ttlMs = 10 * 1000, now = Date.now }) {
  let cached = null; // { rules, expiresAt }
  let inflight = null;
  let generation = 0; // bumped on invalidate so a load that started before an edit is not cached

  async function load() {
    try {
      const [keywords, blocked, allowed, ignores, config] = await Promise.all([
        db.query('SELECT keyword, case_sensitive FROM blocked_keywords ORDER BY keyword'),
        db.query('SELECT channel_id, channel_name FROM blocked_channels ORDER BY channel_name'),
        db.query('SELECT channel_id, channel_name FROM allowed_channels ORDER BY channel_name'),
        db.query('SELECT channel_id, keyword FROM alert_ignores'),
        db.query('SELECT key, value FROM config')
      ]);
      const rules = {
        blocked_keywords: keywords.rows,
        blocked_channels: blocked.rows,
        allowed_channels: allowed.rows,
        alert_ignores: ignores.rows,
        config: parseConfig(config.rows)
      };
      assertValidRules(rules);
      return rules;
    } catch (error) {
      if (error instanceof FilterUnavailableError) throw error;
      const wrapped = new FilterUnavailableError('Could not load filter rules');
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async function getRules() {
    if (cached && cached.expiresAt > now()) return cached.rules;
    if (inflight) return inflight;
    const started = generation;
    const promise = load()
      .then(rules => {
        if (started === generation) cached = { rules, expiresAt: now() + ttlMs };
        return rules;
      })
      .catch(error => {
        cached = null;
        throw error;
      })
      .finally(() => {
        if (inflight === promise) inflight = null;
      });
    inflight = promise;
    return promise;
  }

  function invalidate() {
    generation += 1;
    cached = null;
    inflight = null;
  }

  return { getRules, invalidate };
}

module.exports = { createRulesLoader, parseConfig, CONFIG_KEYS };
