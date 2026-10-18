// Text normalization shared by the keyword matchers. Copied from ../service/lib/videoFilter.js.
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


// Text variants to test: invisible characters removed, and zero-width characters read as spaces.
function textVariants(text) {
  const raw = String(text == null ? '' : text);
  return [normalizeText(raw), normalizeText(raw.replace(ZERO_WIDTH, ' '))];
}

module.exports = { normalizeText, skeleton, textVariants };
