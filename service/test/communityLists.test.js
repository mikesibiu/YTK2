const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDkberktas, parseAislist, parseWordList, diffAgainstExisting } = require('../lib/communityLists');

const UC = suffix => `UC${suffix.padEnd(22, 'a')}`;

test('parseDkberktas keeps only blocked rows with valid channel IDs, and can drop categories', () => {
  const rows = [
    { channel_id: UC('one'), channel_name: 'A', status: 'blocked', category: 'chase', reason: 'r' },
    { channel_id: UC('two'), status: 'watchlist', category: 'chase' },
    { channel_id: 'not-an-id', status: 'blocked', category: 'chase' },
    { channel_id: UC('three'), status: 'blocked', category: 'language-policy' }
  ];
  assert.deepEqual(parseDkberktas(rows).map(e => e.value), [UC('one'), UC('three')]);
  assert.deepEqual(parseDkberktas(rows, { excludeCategories: ['language-policy'] }).map(e => e.value), [UC('one')]);
  assert.equal(parseDkberktas(rows, { statuses: ['blocked', 'watchlist'] }).length, 3);
  assert.deepEqual(parseDkberktas(null), []);
});

test('parseAislist skips comments and separates handles from channel IDs', () => {
  const text = ['! Title: x', '', '@SomeChannel', UC('id'), 'garbage line', '@ab', '@Good.Name-1'].join('\n');
  const out = parseAislist(text);
  assert.deepEqual(out.map(e => [e.type, e.value]), [
    ['channel-handle', '@somechannel'],
    ['channel', UC('id')],
    ['channel-handle', '@good.name-1']
  ]);
});

test('parseWordList lowercases, dedupes and honours skip', () => {
  const out = parseWordList('Ass\nass\n# note\n\nhell\nbad word', 'ldnoobw', { skip: ['hell'] });
  assert.deepEqual(out.map(e => e.value), ['ass', 'bad word']);
});

test('diffAgainstExisting never offers channels that are already allowed or blocked', () => {
  const entries = [
    { type: 'channel', value: 'UCa' }, { type: 'channel', value: 'UCb' }, { type: 'channel', value: 'UCc' },
    { type: 'keyword', value: 'kill' }, { type: 'keyword', value: 'gore' }
  ];
  const d = diffAgainstExisting(entries, { blockedChannelIds: ['UCa'], allowedChannelIds: ['UCb'], keywords: ['Kill'] });
  assert.deepEqual(d.new.map(e => e.value), ['UCc', 'gore']);
  assert.deepEqual(d.alreadyBlocked.map(e => e.value), ['UCa']);
  assert.deepEqual(d.conflictsWithAllowed.map(e => e.value), ['UCb']);
  assert.deepEqual(d.alreadyKeyword.map(e => e.value), ['kill']);
});
