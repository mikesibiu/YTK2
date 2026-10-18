const { FilterUnavailableError } = require('./errors');
const { normalizeText, skeleton, textVariants } = require('./textNormalize');

const MADE_FOR_KIDS_MODES = ['off', 'prefer', 'require'];

// ---------------------------------------------------------------------------
// Text matching
// ---------------------------------------------------------------------------

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a whole-word matcher for one blocked-keyword row.
 *  - Word boundary: the keyword must not be directly preceded/followed by a letter or digit,
 *    so "ass" does not match "class" or "assist".
 *  - Multi-word keywords are phrases: words may be separated by any run of whitespace, "-" or "_".
 *  - matchPlurals (default on) also accepts a trailing "s"/"es" ("ghost" matches "ghosts").
 *  - Case-insensitive unless the row has case_sensitive = true.
 */
function buildKeywordMatcher(rule, { matchPlurals = true, fold = false } = {}) {
  let raw = normalizeText(rule && rule.keyword).trim();
  if (fold) raw = skeleton(raw); // lookalike-folded form, tested against folded text
  if (!raw) return null;

  const words = raw.split(/[\s\-_]+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return null;

  let body = words.join('[\\s\\-_]+');
  if (matchPlurals && /[\p{L}\p{N}]$/u.test(raw)) {
    body += '(?:e?s)?';
  }

  const flags = rule.case_sensitive ? 'u' : 'iu';
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, flags);
}

// Test one matcher against a text. Folded (lookalike) matching is limited to case-insensitive,
// plain-letter keywords, so "18+" is never rewritten.
function textHits(m, variants, skeletons) {
  return variants.some(v => m.re.test(v)) || (m.reFold && skeletons.some(v => m.reFold.test(v)));
}

function textMatchesAny(text, matchers) {
  if (!text) return false;
  const variants = textVariants(text);
  const skeletons = variants.map(skeleton);
  return matchers.some(m => textHits(m, variants, skeletons));
}

// Each matcher keeps the keyword as stored, so a match can be reported (and ignored) by name.
function compileMatchers(blockedKeywords, matchPlurals) {
  return (blockedKeywords || [])
    .map(rule => {
      const re = buildKeywordMatcher(rule, { matchPlurals });
      if (!re) return null;
      const keyword = String(rule.keyword).trim();
      const foldable = !rule.case_sensitive && /^[\p{L}\s\-_]+$/u.test(normalizeText(keyword));
      return { re, keyword, reFold: foldable ? buildKeywordMatcher(rule, { matchPlurals, fold: true }) : null };
    })
    .filter(Boolean);
}

// Every blocked keyword that matches any of the fields.
function matchedKeywords(fields, matchers) {
  const texts = fields.filter(Boolean).map(f => {
    const variants = textVariants(f);
    return { variants, skeletons: variants.map(skeleton) };
  });
  return matchers
    .filter(m => texts.some(t => textHits(m, t.variants, t.skeletons)))
    .map(m => m.keyword);
}

/**
 * Does any blocked keyword match any of the supplied text fields?
 * `fields` is an array of strings (each one is tested on its own so a phrase
 * cannot straddle two tags).
 */
function isBlockedByKeyword(fields, blockedKeywords, options = {}) {
  const list = Array.isArray(fields) ? fields : [fields];
  const matchers = compileMatchers(blockedKeywords, options.matchPlurals !== false);
  return list.some(field => textMatchesAny(field, matchers));
}

// ---------------------------------------------------------------------------
// Rules validation / compilation (fail closed)
// ---------------------------------------------------------------------------

const compiledCache = new WeakMap();

function assertValidRules(rules) {
  if (!rules || typeof rules !== 'object') {
    throw new FilterUnavailableError('Filter rules missing');
  }
  for (const key of ['blocked_keywords', 'blocked_channels', 'allowed_channels']) {
    if (!Array.isArray(rules[key])) {
      throw new FilterUnavailableError(`Filter rules incomplete: ${key}`);
    }
  }
  const c = rules.config;
  if (
    !c ||
    typeof c.allowlist_only !== 'boolean' ||
    typeof c.block_live !== 'boolean' ||
    typeof c.match_plurals !== 'boolean' ||
    !MADE_FOR_KIDS_MODES.includes(c.made_for_kids)
  ) {
    throw new FilterUnavailableError('Filter rules incomplete: config');
  }
}

function compileRules(rules) {
  assertValidRules(rules);
  let compiled = compiledCache.get(rules);
  if (compiled) return compiled;

  compiled = {
    matchers: compileMatchers(rules.blocked_keywords, rules.config.match_plurals),
    blockedChannels: new Set(rules.blocked_channels.map(c => c.channel_id)),
    allowedChannels: new Set(rules.allowed_channels.map(c => c.channel_id)),
    // "Don't alert again" choices: allowed channel + keyword pairs that are no longer logged.
    ignored: new Set((rules.alert_ignores || []).map(i => `${i.channel_id}|${i.keyword}`)),
    config: rules.config
  };
  compiledCache.set(rules, compiled);
  return compiled;
}

// ---------------------------------------------------------------------------
// Per-video decision
// ---------------------------------------------------------------------------

/**
 * Decides one video. Returns { reason, flags }:
 *  - reason is null when the video may be shown, otherwise a short reason string.
 *  - flags lists keywords that matched on an ALLOWED channel. Allowed channels are not
 *    blocked by keywords; the match is reported so the parent can review it.
 *
 * `video` must be a fully detailed record (videos.list snippet/contentDetails/status):
 *   { detailed: true, videoId, title, description, tags[], channelId,
 *     ageRestricted, madeForKids, liveBroadcastContent, embeddable }
 * Anything without `detailed: true` is dropped, so a search-only snippet
 * (whose description is truncated and which has no tags) can never slip through.
 */
function assessVideo(video, compiled) {
  const none = [];
  if (!video || !video.videoId || !video.channelId) return { reason: 'incomplete', flags: none };
  if (video.detailed !== true) return { reason: 'no_details', flags: none };

  if (compiled.blockedChannels.has(video.channelId)) return { reason: 'blocked_channel', flags: none };
  const allowed = compiled.allowedChannels.has(video.channelId);
  if (compiled.config.allowlist_only && !allowed) return { reason: 'not_allowlisted', flags: none };

  if (video.ageRestricted) return { reason: 'age_restricted', flags: none };
  if (video.embeddable === false) return { reason: 'not_embeddable', flags: none };

  const live = video.liveBroadcastContent;
  if (compiled.config.block_live && (live === 'live' || live === 'upcoming')) return { reason: 'live', flags: none };

  if (compiled.config.made_for_kids === 'require' && video.madeForKids !== true) {
    return { reason: 'not_made_for_kids', flags: none };
  }

  const fields = [video.title, video.description, video.channelTitle, ...(Array.isArray(video.tags) ? video.tags : [])];
  const hits = matchedKeywords(fields, compiled.matchers);
  if (hits.length === 0) return { reason: null, flags: none };
  if (!allowed) return { reason: 'keyword', flags: none };

  const flags = hits.filter(k => !compiled.ignored.has(`${video.channelId}|${k}`));
  return { reason: null, flags };
}

// Reason string only (null = allowed).
function evaluateVideo(video, compiled) {
  return assessVideo(video, compiled).reason;
}

function isVideoAllowed(video, rules) {
  return evaluateVideo(video, compileRules(rules)) === null;
}

/**
 * Filter a list of detailed videos. Throws FilterUnavailableError if the rules are
 * unusable -- callers must never fall back to returning unfiltered items.
 */
function filterVideoItems(items, rules) {
  const compiled = compileRules(rules);
  const input = items || [];
  const reasons = {};
  const flagged = [];
  let kept = [];

  for (const item of input) {
    const { reason, flags } = assessVideo(item, compiled);
    if (reason === null) {
      kept.push(item);
      if (flags.length > 0) flagged.push({ video: item, keywords: flags });
    } else {
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
  }

  if (compiled.config.made_for_kids === 'prefer') {
    // Stable partition: made-for-kids first, original order otherwise preserved.
    kept = [...kept.filter(v => v.madeForKids === true), ...kept.filter(v => v.madeForKids !== true)];
  }

  return {
    items: kept,
    totalCount: input.length,
    filteredCount: input.length - kept.length,
    reasons,
    flagged
  };
}

/**
 * Playlists (the parent's own) are checked on title/description and channel block only.
 * The videos inside are filtered individually.
 */
function filterPlaylists(playlists, rules) {
  const compiled = compileRules(rules);
  return (playlists || []).filter(p => {
    if (!p || !p.id) return false;
    if (p.channelId && compiled.blockedChannels.has(p.channelId)) return false;
    return !textMatchesAny(p.title, compiled.matchers) && !textMatchesAny(p.description, compiled.matchers);
  });
}

module.exports = {
  MADE_FOR_KIDS_MODES,
  normalizeText,
  buildKeywordMatcher,
  isBlockedByKeyword,
  assertValidRules,
  assessVideo,
  evaluateVideo,
  isVideoAllowed,
  filterVideoItems,
  filterPlaylists,
  compileRules
};
