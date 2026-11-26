import assert from 'node:assert/strict';
import { test } from 'node:test';
import { done, failure, refused } from './outcome.ts';

test('a refusal that names no field is the failure to show above the button', () => {
  assert.equal(failure(refused('That slot has just been taken.')), 'That slot has just been taken.');
});

test('a refusal that names a field shows beside the field, not above the button', () => {
  assert.equal(failure(refused('Check the fields marked below.', { topic: 'Say what you are stuck on.' })), null);
});

test('a success, or no answer yet, is no failure', () => {
  assert.equal(failure(done(null)), null);
  assert.equal(failure(null), null);
  assert.equal(failure(undefined), null);
});
