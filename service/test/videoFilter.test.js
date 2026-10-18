const test = require('node:test');
const assert = require('node:assert/strict');

const { isBlockedByKeyword, isVideoAllowed, filterVideoItems } = require('../lib/videoFilter');

const kw = (keyword, case_sensitive = false) => [{ keyword, case_sensitive }];

test('isBlockedByKeyword respects case sensitivity', () => {
  assert.equal(isBlockedByKeyword('Scary movie', kw('scary')), true);
  assert.equal(isBlockedByKeyword('Scary movie', kw('scary', true)), false);
});

test('keywords match whole words only', () => {
  assert.equal(isBlockedByKeyword('Fun in class today', kw('ass')), false);
  assert.equal(isBlockedByKeyword('Assassin game', kw('ass')), false);
  assert.equal(isBlockedByKeyword('escape room challenge', kw('escape')), true);
  assert.equal(isBlockedByKeyword('Great Escape!', kw('escape')), true);
  assert.equal(isBlockedByKeyword('scapegoat', kw('escape')), false);
});

test('keywords also match plurals and common verb endings', () => {
  assert.equal(isBlockedByKeyword('Zombies attack', kw('zombie')), true);
  assert.equal(isBlockedByKeyword('Ghosts of the house', kw('ghost')), true);
  assert.equal(isBlockedByKeyword('Killing time', kw('kill')), true);
  assert.equal(isBlockedByKeyword('Bloody hands', kw('blood')), false);
  assert.equal(isBlockedByKeyword('Blood and gore', kw('blood')), true);
});

test('multi-word keywords match across any whitespace', () => {
  assert.equal(isBlockedByKeyword('Five  Nights at Freddys', kw('five nights')), true);
  assert.equal(isBlockedByKeyword('five lights', kw('five nights')), false);
});

test('regex characters in keywords are treated literally', () => {
  assert.equal(isBlockedByKeyword('18+ only', kw('18+')), true);
  assert.equal(isBlockedByKeyword('a.b', kw('a.b')), true);
  assert.equal(isBlockedByKeyword('axb', kw('a.b')), false);
});

test('isVideoAllowed blocks blocked channels, keywords, description and tags', () => {
  const filters = {
    blocked_keywords: kw('monster'),
    blocked_channels: [{ channel_id: 'blocked-1' }],
    allowed_channels: [],
    config: { whitelist_mode: false }
  };

  assert.equal(isVideoAllowed({ channelId: 'blocked-1', title: 'Kids songs' }, filters), false);
  assert.equal(isVideoAllowed({ channelId: 'good-1', title: 'Monster truck' }, filters), false);
  assert.equal(isVideoAllowed({ channelId: 'good-1', title: 'Truck', description: 'a monster appears' }, filters), false);
  assert.equal(isVideoAllowed({ channelId: 'good-1', title: 'Truck', tags: ['fun', 'monster'] }, filters), false);
  assert.equal(isVideoAllowed({ channelId: 'good-1', title: 'Alphabet song' }, filters), true);
});

test('age restricted videos are blocked', () => {
  const filters = { blocked_keywords: [], blocked_channels: [], allowed_channels: [], config: {} };
  assert.equal(isVideoAllowed({ channelId: 'c', title: 'x', ageRestricted: true }, filters), false);
});

test('whitelist mode only allows allowed channels', () => {
  const filters = {
    blocked_keywords: [],
    blocked_channels: [],
    allowed_channels: [{ channel_id: 'ok' }],
    config: { whitelist_mode: true }
  };
  assert.equal(isVideoAllowed({ channelId: 'ok', title: 'Fine' }, filters), true);
  assert.equal(isVideoAllowed({ channelId: 'other', title: 'Fine' }, filters), false);
});

test('filterVideoItems returns safe list and counts', () => {
  const filters = {
    blocked_keywords: kw('horror'),
    blocked_channels: [{ channel_id: 'bad' }]
  };

  const input = [
    { videoId: '1', channelId: 'good', title: 'Math for kids' },
    { videoId: '2', channelId: 'bad', title: 'Art for kids' },
    { videoId: '3', channelId: 'good', title: 'Horror stories' }
  ];

  const out = filterVideoItems(input, filters);
  assert.equal(out.totalCount, 3);
  assert.equal(out.filteredCount, 2);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].videoId, '1');
});

test('obfuscated spellings are still blocked', () => {
  assert.equal(isBlockedByKeyword('k1ll them all', kw('kill')), true);
  assert.equal(isBlockedByKeyword('ｋｉｌｌ', kw('kill')), true);
  assert.equal(isBlockedByKeyword('𝐤𝐢𝐥𝐥', kw('kill')), true);
  assert.equal(isBlockedByKeyword('kіll', kw('kill')), true);
  assert.equal(isBlockedByKeyword('ki​ll', kw('kill')), true);
  assert.equal(isBlockedByKeyword('h0rr0r game', kw('horror')), true);
  assert.equal(isBlockedByKeyword('a killer clown', kw('kill')), true);
  assert.equal(isBlockedByKeyword('Math 101', kw('kill')), false);
});

test('18+ keyword is not rewritten by lookalike folding', () => {
  assert.equal(isBlockedByKeyword('Rated 18+ only', kw('18+')), true);
});

test('accented, fullwidth and dotted/dotless spellings are blocked', () => {
  for (const title of ['mönster', 'ghöst', 'sçary', 'kíll', 'kıll', 'KİLL', 'ｋｉｌｌ']) {
    const kws = ['monster', 'ghost', 'scary', 'kill'].map(k => ({ keyword: k, case_sensitive: false }));
    assert.equal(isBlockedByKeyword(title, kws), true, JSON.stringify(title));
  }
});

test('leetspeak where 1 means l, and Greek / Cyrillic / small-cap lookalikes are blocked', () => {
  const cases = [['ki11', 'kill'], ['he11', 'hell'], ['b1ood', 'blood'], ['kiII', 'kill'], ['кill', 'kill'],
    ['\u043conster', 'monster'], ['ghοst', 'ghost'], ['κnife', 'knife'], ['ᴋill', 'kill']];
  for (const [title, keyword] of cases) {
    assert.equal(isBlockedByKeyword(title, kw(keyword)), true, `${JSON.stringify(title)} vs ${keyword}`);
  }
});

test('apostrophes and invisible fillers do not hide a keyword', () => {
  assert.equal(isBlockedByKeyword("Five Nights at Freddy's", kw('five nights at freddys')), true);
  assert.equal(isBlockedByKeyword('Five Nights at Freddy’s', kw('five nights at freddys')), true);
  assert.equal(isBlockedByKeyword('kiㅤll', kw('kill')), true);
  assert.equal(isBlockedByKeyword('ki⠀ll', kw('kill')), true);
  assert.equal(isBlockedByKeyword('five​nights', kw('five nights')), true);
  assert.equal(isBlockedByKeyword('ki​ll', kw('kill')), true);
});

test('innocent titles are not blocked by folding', () => {
  const kws = ['kill', 'hell', 'blood', 'monster', 'ghost', 'scary'].map(k => ({ keyword: k, case_sensitive: false }));
  for (const title of ['Math 101', 'Bus 5', 'Class', 'Peppa Pig', 'Dr. Seuss! 4 you', 'Top 10 Toys', 'Baby Shark 4K', 'Toy Story 3', 'Hello Kitty', 'Spelling bee']) {
    assert.equal(isBlockedByKeyword(title, kws), false, title);
  }
});

test('activeKeywordCount ignores keywords that normalize to nothing', () => {
  const { activeKeywordCount } = require('../lib/videoFilter');
  assert.equal(activeKeywordCount([{ keyword: '​' }, { keyword: '  ' }, { keyword: 'ㅤ' }]), 0);
  assert.equal(activeKeywordCount([{ keyword: '​' }, { keyword: 'kill' }]), 1);
});
