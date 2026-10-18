const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isBlockedByKeyword,
  evaluateVideo,
  compileRules,
  isVideoAllowed,
  filterVideoItems,
  filterPlaylists
} = require('../lib/videoFilter');
const { FilterUnavailableError } = require('../lib/errors');
const { makeRules, makeVideo, kw } = require('../testSupport/helpers');

// --- word boundary / case / phrase -------------------------------------------

test('word boundary: "ass" does not block "class" or "assist" but blocks the word itself', () => {
  const rules = [kw('ass')];
  assert.equal(isBlockedByKeyword('Math class for kids', rules), false);
  assert.equal(isBlockedByKeyword('How to assist', rules), false);
  assert.equal(isBlockedByKeyword('Bass guitar', rules), false);
  assert.equal(isBlockedByKeyword('big ass fail', rules), true);
  assert.equal(isBlockedByKeyword('ASS', rules), true);
  assert.equal(isBlockedByKeyword('(ass)', rules), true);
});

test('word boundary: letters/digits adjacent to the keyword prevent a match', () => {
  assert.equal(isBlockedByKeyword('ghostbusters', [kw('ghost')]), false);
  assert.equal(isBlockedByKeyword('Ghost-busters', [kw('ghost')]), true);
  assert.equal(isBlockedByKeyword('war2', [kw('war')]), false);
  assert.equal(isBlockedByKeyword('The War.', [kw('war')]), true);
});

test('case-insensitive by default, case-sensitive when the rule says so', () => {
  assert.equal(isBlockedByKeyword('SCARY movie', [kw('scary')]), true);
  assert.equal(isBlockedByKeyword('SCARY movie', [kw('scary', true)]), false);
  assert.equal(isBlockedByKeyword('Scary movie', [kw('Scary', true)]), true);
});

test('phrase keywords match across any whitespace/hyphen run, not across partial words', () => {
  const rules = [kw('escape room')];
  assert.equal(isBlockedByKeyword('Escape   Room challenge', rules), true);
  assert.equal(isBlockedByKeyword('escape-room', rules), true);
  assert.equal(isBlockedByKeyword('escape rooms', rules), true); // plural
  assert.equal(isBlockedByKeyword('escaped room', rules), false);
  assert.equal(isBlockedByKeyword('escape from the room', rules), false);
});

test('plural tolerance can be switched off', () => {
  assert.equal(isBlockedByKeyword('so many ghosts', [kw('ghost')]), true);
  assert.equal(isBlockedByKeyword('so many ghosts', [kw('ghost')], { matchPlurals: false }), false);
  assert.equal(isBlockedByKeyword('asses', [kw('ass')]), true);
});

test('keywords with symbols are matched literally (and regex metacharacters are escaped)', () => {
  assert.equal(isBlockedByKeyword('Rated 18+ only', [kw('18+')]), true);
  assert.equal(isBlockedByKeyword('Age 118+', [kw('18+')]), false);
  assert.equal(isBlockedByKeyword('anything', [kw('.*')]), false);
  assert.equal(isBlockedByKeyword('a(b', [kw('a(b')]), true);
});

test('unicode evasion: fullwidth letters and zero-width characters are normalised', () => {
  assert.equal(isBlockedByKeyword('ｇｈｏｓｔ story', [kw('ghost')]), true);
  assert.equal(isBlockedByKeyword('gh​ost story', [kw('ghost')]), true);
});

// --- description / tags / fields ------------------------------------------------

test('keywords are matched in title, description AND tags', () => {
  const rules = makeRules({ blocked_keywords: [kw('zombie')] });
  const compiled = compileRules(rules);

  assert.equal(evaluateVideo(makeVideo({ title: 'Zombie dance' }), compiled), 'keyword');
  assert.equal(evaluateVideo(makeVideo({ description: 'full of zombies, beware' }), compiled), 'keyword');
  assert.equal(evaluateVideo(makeVideo({ tags: ['fun', 'Zombie'] }), compiled), 'keyword');
  assert.equal(evaluateVideo(makeVideo(), compiled), null);
});

test('a phrase cannot straddle two separate tags', () => {
  const rules = makeRules({ blocked_keywords: [kw('escape room')] });
  const compiled = compileRules(rules);
  assert.equal(evaluateVideo(makeVideo({ tags: ['escape', 'room'] }), compiled), null);
  assert.equal(evaluateVideo(makeVideo({ tags: ['escape room'] }), compiled), 'keyword');
});

test('search-only snippets (no detailed flag) are dropped, never passed through', () => {
  const compiled = compileRules(makeRules());
  assert.equal(evaluateVideo(makeVideo({ detailed: false }), compiled), 'no_details');
  assert.equal(evaluateVideo(makeVideo({ detailed: undefined }), compiled), 'no_details');
  assert.equal(evaluateVideo(makeVideo({ channelId: '' }), compiled), 'incomplete');
});

// --- channels / allowlist --------------------------------------------------------

test('blocked channels are removed', () => {
  const rules = makeRules({ blocked_channels: [{ channel_id: 'UCbad' }] });
  assert.equal(isVideoAllowed(makeVideo({ channelId: 'UCbad' }), rules), false);
  assert.equal(isVideoAllowed(makeVideo(), rules), true);
});

test('allowlist-only mode is enforced: only allowed channels pass', () => {
  const rules = makeRules({
    allowed_channels: [{ channel_id: 'UCok' }],
    config: { allowlist_only: true }
  });
  assert.equal(isVideoAllowed(makeVideo({ channelId: 'UCok' }), rules), true);
  assert.equal(isVideoAllowed(makeVideo({ channelId: 'UCother' }), rules), false);
});

test('allowlist-only with an EMPTY allowlist shows nothing', () => {
  const rules = makeRules({ config: { allowlist_only: true } });
  const out = filterVideoItems([makeVideo(), makeVideo({ videoId: 'vid00000002' })], rules);
  assert.equal(out.items.length, 0);
  assert.equal(out.reasons.not_allowlisted, 2);
});

test('allowlist off: allowed_channels are ignored', () => {
  const rules = makeRules({ allowed_channels: [{ channel_id: 'UCok' }] });
  assert.equal(isVideoAllowed(makeVideo({ channelId: 'UCother' }), rules), true);
});

test('blocked channel beats allowlist', () => {
  const rules = makeRules({
    blocked_channels: [{ channel_id: 'UCok' }],
    allowed_channels: [{ channel_id: 'UCok' }, { channel_id: 'UCfine' }],
    config: { allowlist_only: true }
  });
  assert.equal(isVideoAllowed(makeVideo({ channelId: 'UCok' }), rules), false);
  assert.equal(isVideoAllowed(makeVideo({ channelId: 'UCfine' }), rules), true);
});

// --- allowed channels: keywords flag instead of block -------------------------------

test('allowed channel is NOT blocked by a keyword but the match is flagged', () => {
  const rules = makeRules({
    blocked_keywords: [kw('scary'), kw('escape')],
    allowed_channels: [{ channel_id: 'UCfine' }]
  });
  const video = makeVideo({ channelId: 'UCfine', title: 'Scary escape night' });
  const out = filterVideoItems([video], rules);
  assert.equal(out.items.length, 1);
  assert.deepEqual(out.flagged.map(f => f.keywords), [['scary', 'escape']]);
  // Same words on a channel that is not allowed are still blocked, with nothing flagged.
  const other = filterVideoItems([makeVideo({ title: 'Scary night' })], rules);
  assert.equal(other.items.length, 0);
  assert.equal(other.flagged.length, 0);
});

test('ignored channel+keyword pairs are shown without a flag; other keywords still flag', () => {
  const rules = makeRules({
    blocked_keywords: [kw('scary'), kw('escape')],
    allowed_channels: [{ channel_id: 'UCfine' }],
    alert_ignores: [{ channel_id: 'UCfine', keyword: 'scary' }]
  });
  const out = filterVideoItems([makeVideo({ channelId: 'UCfine', title: 'Scary escape' })], rules);
  assert.equal(out.items.length, 1);
  assert.deepEqual(out.flagged.map(f => f.keywords), [['escape']]);
  const quiet = filterVideoItems([makeVideo({ channelId: 'UCfine', title: 'Scary night' })], rules);
  assert.equal(quiet.items.length, 1);
  assert.equal(quiet.flagged.length, 0);
});

test('an ignore for one channel does not apply to another allowed channel', () => {
  const rules = makeRules({
    blocked_keywords: [kw('scary')],
    allowed_channels: [{ channel_id: 'UCa' }, { channel_id: 'UCb' }],
    alert_ignores: [{ channel_id: 'UCa', keyword: 'scary' }]
  });
  const out = filterVideoItems([
    makeVideo({ videoId: 'vid00000001', channelId: 'UCa', title: 'Scary' }),
    makeVideo({ videoId: 'vid00000002', channelId: 'UCb', title: 'Scary' })
  ], rules);
  assert.equal(out.items.length, 2);
  assert.deepEqual(out.flagged.map(f => f.video.channelId), ['UCb']);
});

test('allowed channels still lose to age restriction and live blocking', () => {
  const rules = makeRules({ allowed_channels: [{ channel_id: 'UCfine' }] });
  assert.equal(isVideoAllowed(makeVideo({ channelId: 'UCfine', ageRestricted: true }), rules), false);
  assert.equal(isVideoAllowed(makeVideo({ channelId: 'UCfine', liveBroadcastContent: 'live' }), rules), false);
});

// --- age restriction / live / made for kids ----------------------------------------

test('age-restricted videos are always dropped', () => {
  assert.equal(isVideoAllowed(makeVideo({ ageRestricted: true }), makeRules()), false);
});

test('non-embeddable videos are dropped', () => {
  assert.equal(isVideoAllowed(makeVideo({ embeddable: false }), makeRules()), false);
});

test('live streams and upcoming premieres are dropped when block_live is on, kept when off', () => {
  const live = makeVideo({ liveBroadcastContent: 'live' });
  const upcoming = makeVideo({ liveBroadcastContent: 'upcoming' });
  assert.equal(isVideoAllowed(live, makeRules()), false);
  assert.equal(isVideoAllowed(upcoming, makeRules()), false);
  assert.equal(isVideoAllowed(live, makeRules({ config: { block_live: false } })), true);
});

test('made_for_kids: off ignores, require drops non-kids and unknown, prefer reorders', () => {
  const kids = makeVideo({ videoId: 'kids0000001', madeForKids: true });
  const notKids = makeVideo({ videoId: 'notk0000001', madeForKids: false });
  const unknown = makeVideo({ videoId: 'unkn0000001', madeForKids: null });
  const input = [notKids, unknown, kids];

  assert.deepEqual(filterVideoItems(input, makeRules()).items.map(v => v.videoId),
    ['notk0000001', 'unkn0000001', 'kids0000001']);

  assert.deepEqual(filterVideoItems(input, makeRules({ config: { made_for_kids: 'require' } })).items.map(v => v.videoId),
    ['kids0000001']);

  const preferred = filterVideoItems(input, makeRules({ config: { made_for_kids: 'prefer' } }));
  assert.deepEqual(preferred.items.map(v => v.videoId), ['kids0000001', 'notk0000001', 'unkn0000001']);
  assert.equal(preferred.filteredCount, 0);
});

test('filterVideoItems returns counts', () => {
  const rules = makeRules({ blocked_keywords: [kw('horror')], blocked_channels: [{ channel_id: 'UCbad' }] });
  const out = filterVideoItems([
    makeVideo({ videoId: 'vid00000001' }),
    makeVideo({ videoId: 'vid00000002', channelId: 'UCbad' }),
    makeVideo({ videoId: 'vid00000003', title: 'Horror stories' })
  ], rules);
  assert.equal(out.totalCount, 3);
  assert.equal(out.filteredCount, 2);
  assert.deepEqual(out.items.map(v => v.videoId), ['vid00000001']);
});

// --- fail closed ---------------------------------------------------------------------

test('FAIL CLOSED: missing or malformed rules throw instead of returning unfiltered items', () => {
  const items = [makeVideo()];
  for (const bad of [
    undefined,
    null,
    {},
    { blocked_keywords: [], blocked_channels: [], allowed_channels: [] },
    makeRules({ config: { allowlist_only: 'false' } }),
    makeRules({ config: { made_for_kids: 'sometimes' } }),
    { ...makeRules(), blocked_keywords: null }
  ]) {
    assert.throws(() => filterVideoItems(items, bad), FilterUnavailableError);
    assert.throws(() => isVideoAllowed(items[0], bad), FilterUnavailableError);
  }
});

// --- playlists ----------------------------------------------------------------------

test('filterPlaylists drops playlists whose title/description match a keyword', () => {
  const rules = makeRules({ blocked_keywords: [kw('horror')] });
  const out = filterPlaylists([
    { id: 'PL1', title: 'Songs', description: '' },
    { id: 'PL2', title: 'Horror night', description: '' },
    { id: 'PL3', title: 'Fun', description: 'some horror stuff' }
  ], rules);
  assert.deepEqual(out.map(p => p.id), ['PL1']);
});

// --- obfuscation and channel name ----------------------------------------------------

test('lookalike, combining-mark and invisible-character spellings are still blocked', () => {
  const rules = makeRules({ blocked_keywords: [kw('horror')] });
  const variants = [
    'h0rror',                    // leetspeak
    'h0rr0r',
    'h\u043error',               // Cyrillic o
    'h\u0336o\u0336rror',        // combining strikethrough
    'h\u00f3rror',               // precomposed accent
    'ho\u034Frror',              // combining grapheme joiner
    'ho\u180Eror'.replace('ror', 'rror'), // Mongolian vowel separator inside the word
    '\uFF48\uFF4F\uFF52\uFF52\uFF4F\uFF52' // fullwidth
  ];
  for (const title of variants) {
    const out = filterVideoItems([makeVideo({ title })], rules);
    assert.equal(out.items.length, 0, `should block: ${JSON.stringify(title)}`);
  }
  assert.equal(filterVideoItems([makeVideo({ title: 'Math 101' })], rules).items.length, 1);
});

test('lookalike folding never rewrites keywords that contain digits or symbols', () => {
  const rules = makeRules({ blocked_keywords: [kw('18+')] });
  assert.equal(filterVideoItems([makeVideo({ title: 'Rated 18+' })], rules).items.length, 0);
  assert.equal(filterVideoItems([makeVideo({ title: 'Rated i8+' })], rules).items.length, 1);
});

test('a blocked word in the channel name blocks a non-allowed channel but only flags an allowed one', () => {
  const rules = makeRules({ blocked_keywords: [kw('horror')], allowed_channels: [{ channel_id: 'UCfine' }] });
  assert.equal(filterVideoItems([makeVideo({ channelTitle: 'Horror House' })], rules).items.length, 0);
  const out = filterVideoItems([makeVideo({ channelId: 'UCfine', channelTitle: 'Horror House' })], rules);
  assert.equal(out.items.length, 1);
  assert.equal(out.flagged.length, 1);
});

test('accents, 1-as-l leetspeak, Greek/small-cap lookalikes, apostrophes and fillers are blocked', () => {
  const blocked = [
    ['mönster', 'monster'], ['kıll', 'kill'], ['KİLL', 'kill'], ['ki11', 'kill'], ['b1ood', 'blood'],
    ['kiII', 'kill'], ['ghοst', 'ghost'], ['ᴋill', 'kill'], ["Five Nights at Freddy's", 'five nights at freddys'],
    ['kiㅤll', 'kill'], ['ki⠀ll', 'kill'], ['five​nights', 'five nights'], ['ki​ll', 'kill']
  ];
  for (const [title, keyword] of blocked) {
    const out = filterVideoItems([makeVideo({ title })], makeRules({ blocked_keywords: [kw(keyword)] }));
    assert.equal(out.items.length, 0, `${JSON.stringify(title)} vs ${keyword}`);
  }
});

test('innocent titles survive the stronger matching', () => {
  const rules = makeRules({ blocked_keywords: ['kill', 'hell', 'blood', 'monster', 'ghost', 'scary'].map(k => kw(k)) });
  for (const title of ['Math 101', 'Bus 5', 'Class', 'Peppa Pig', 'Dr. Seuss! 4 you', 'Top 10 Toys', 'Baby Shark 4K', 'Toy Story 3', 'Hello Kitty', 'Spelling bee']) {
    assert.equal(filterVideoItems([makeVideo({ title })], rules).items.length, 1, title);
  }
});
