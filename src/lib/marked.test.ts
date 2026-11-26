import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plain, runs, wellMarked } from './marked.ts';

test('a marked phrase becomes its own run', () => {
  assert.deepEqual(runs('Who signs off *the AI audit*?'), [
    { text: 'Who signs off ', mark: false },
    { text: 'the AI audit', mark: true },
    { text: '?', mark: false },
  ]);
});

test('a title with no mark is one plain run, and plain() strips the asterisks', () => {
  assert.deepEqual(runs('Pricing'), [{ text: 'Pricing', mark: false }]);
  assert.equal(plain('Who signs off *the AI audit*?'), 'Who signs off the AI audit?');
});

test('a title marks one phrase or none', () => {
  assert.ok(wellMarked('Plain'));
  assert.ok(wellMarked('One *mark*'));
  assert.ok(!wellMarked('An *open mark'));
  assert.ok(!wellMarked('*Two* marks *here*'));
});
