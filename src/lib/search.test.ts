import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matcher, SEARCH_MAX } from './search.ts';

test('a search matches the start of a word, in any case', () => {
  const lease = matcher('lea');
  assert.ok(lease);
  assert.equal(lease.test('MFRS 16 Leases for a small firm'), true);
  assert.equal(lease.test('The release date'), false);
  assert.equal(matcher('co sec')?.test('Tax · Co sec'), true);
  assert.equal(matcher('ng')?.test('Daniel Ng'), true);
  assert.equal(matcher('élodie')?.test('Élodie Tan'), true);
});

test('what people type is text, never a pattern', () => {
  assert.equal(matcher('   '), null);
  assert.equal(matcher('a.c')?.test('abc'), false);
  assert.equal(matcher('(')?.test('a (note)'), true);
  assert.equal(matcher('50%_off')?.like, '%50\\%\\_off%');
  assert.equal(matcher('x'.repeat(200))?.like.length, SEARCH_MAX + 2);
});
