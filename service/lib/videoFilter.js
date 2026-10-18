// Keyword rules match whole words (so "ass" does not block "class") but allow
// common endings (so "zombie" also blocks "zombies" and "kill" blocks "killing").
const WORD_CHAR = '\\p{L}\\p{N}';
const SUFFIX = '(?:e?s|e?d|e?r|e?rs|ing|in)?';

// Characters that render as nothing but are not format/combining marks.
const BLANKS = /[ᅟᅠㅤﾠ⠀᠎]/g;
// Zero-width characters can either hide inside a word ("ki<ZWSP>ll") or stand in for a space
// ("five<ZWSP>nights"), so text is checked both ways.
const ZERO_WIDTH = /[​⁠﻿]/g;
const APOSTROPHES = /['’ʼ‘`´]/g;

// Lookalikes used to dodge filters: leetspeak, Cyrillic, Greek and small-capital letters.
// i, l, 1, ! and | are one class because 1 and ! are used for both letters.
const LOOKALIKES = {
  '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's',
  '1': 'l', '!': 'l', '|': 'l', i: 'l', 'ı': 'l',
  'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h',
  'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
  'і': 'l', 'ѕ': 's', 'ј': 'j', 'ү': 'y',
  'α': 'a', 'ε': 'e', 'ι': 'l', 'κ': 'k', 'ν': 'v', 'ο': 'o',
  'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
  'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ɢ': 'g',
  'ʜ': 'h', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n',
  'ᴏ': 'o', 'ᴘ': 'p', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u',
  'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z'
};
const LOOKALIKE_CHARS = new RegExp(
  `[${Object.keys(LOOKALIKES).map(c => (/[\]\\^-]/.test(c) ? `\\${c}` : c)).join('')}]`,
  'gu'
);

const patternCache = new Map();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// NFKD splits accents into combining marks, which are then removed along with invisible
// characters; fullwidth and math-bold letters fold to plain ones.
function normalizeText(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .replace(BLANKS, '')
    .replace(APOSTROPHES, '');
}

function skeleton(text) {
  return text.toLowerCase().replace(LOOKALIKE_CHARS, ch => LOOKALIKES[ch] || ch);
}

function keywordPattern(keyword, caseSensitive) {
  const cacheKey = `${caseSensitive ? 'c' : 'i'}:${keyword}`;
  let pattern = patternCache.get(cacheKey);
  if (!pattern) {
    const words = keyword.trim().split(/\s+/).map(escapeRegex);
    // "scary" also matches scarier / scariest / scaries (a consonant followed by a final y).
    const last = words.length - 1;
    if (/[^aeiou]y$/i.test(words[last])) words[last] = `${words[last].slice(0, -1)}(?:y|ie(?:s|r|st)?)`;
    const body = words.join('\\s+');
    pattern = new RegExp(
      `(?<![${WORD_CHAR}])${body}${SUFFIX}(?![${WORD_CHAR}])`,
      caseSensitive ? 'u' : 'iu'
    );
    patternCache.set(cacheKey, pattern);
  }
  return pattern;
}

// A rule is usable only if its keyword is not empty once normalized.
function normalizedKeyword(rule) {
  return normalizeText((rule && rule.keyword) || '').trim();
}

function activeKeywordCount(blockedKeywords) {
  return (blockedKeywords || []).filter(rule => normalizedKeyword(rule) !== '').length;
}

function isBlockedByKeyword(text, blockedKeywords) {
  const variants = [
    normalizeText(text),
    normalizeText(String(text || '').replace(ZERO_WIDTH, ' '))
  ];
  const skeletons = variants.map(skeleton);

  return (blockedKeywords || []).some(rule => {
    const keyword = normalizedKeyword(rule);
    if (!keyword) return false;
    const caseSensitive = Boolean(rule.case_sensitive);
    if (variants.some(v => keywordPattern(keyword, caseSensitive).test(v))) return true;

    // Lookalike folding: case-insensitive, plain-letter keywords only ("18+" is never rewritten).
    if (caseSensitive || !/^[\p{L}\s\-_]+$/u.test(keyword)) return false;
    const folded = keywordPattern(skeleton(keyword), false);
    return skeletons.some(s => folded.test(s));
  });
}

function searchableText(video) {
  const tags = Array.isArray(video.tags) ? video.tags.join('\n') : '';
  return [video.title, video.description, video.channelName, tags].filter(Boolean).join('\n');
}

function isVideoAllowed(video, filters) {
  const channelId = video.channelId || '';

  const blockedChannels = new Set((filters.blocked_channels || []).map(c => c.channel_id));
  if (blockedChannels.has(channelId)) {
    return false;
  }

  if (video.ageRestricted) {
    return false;
  }

  if (filters.config && filters.config.whitelist_mode) {
    const allowedChannels = new Set((filters.allowed_channels || []).map(c => c.channel_id));
    if (!allowedChannels.has(channelId)) {
      return false;
    }
  }

  return !isBlockedByKeyword(searchableText(video), filters.blocked_keywords || []);
}

function filterVideoItems(items, filters) {
  const safeItems = (items || []).filter(item => isVideoAllowed(item, filters));
  return {
    items: safeItems,
    totalCount: (items || []).length,
    filteredCount: (items || []).length - safeItems.length
  };
}

module.exports = {
  normalizeText,
  activeKeywordCount,
  isBlockedByKeyword,
  isVideoAllowed,
  filterVideoItems
};
