import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchSite, type Entry } from './site-search.ts';

const entries: Entry[] = [
  { kind: 'People', title: 'Hazli Johar', summary: 'Host', href: '/@hazli' },
  { kind: 'Posts', title: 'Can AI replace accountants?', summary: 'A podcast episode.', href: '/podcast/can-ai-replace-accountants' },
  { kind: 'Programmes', title: 'Pricing', summary: 'Fixed fees, not hours.', keywords: 'Your floor rate · Repricing the clients you have', href: '/programmes/pricing' },
  { kind: 'Posts', title: 'Fixed fees in practice', summary: 'Why hours undersell you.', href: '/essays/fixed-fees' },
];

test('results come grouped in the page order, posts first, with empty kinds left out', () => {
  const groups = searchSite(entries, 'fixed');
  assert.deepEqual(groups?.map((g) => [g.kind, g.entries.map((e) => e.title)]), [
    ['Posts', ['Fixed fees in practice']],
    ['Programmes', ['Pricing']],
  ]);
});

test('a search finds hidden keywords, and matches the start of a word only', () => {
  assert.deepEqual(searchSite(entries, 'floor')?.map((g) => g.kind), ['Programmes']);
  assert.deepEqual(searchSite(entries, 'ixed'), []);
});

test('an empty search is no search, not every result', () => {
  assert.equal(searchSite(entries, '   '), null);
});
