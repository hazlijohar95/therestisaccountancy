import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describedBy, wireField } from './form.ts';

test('a field with no error is described by its hint alone, and is not marked invalid', () => {
  assert.deepEqual(wireField(undefined, { id: 'topic-error', hint: 'topic-hint' }), {
    error: undefined,
    errorId: 'topic-error',
    input: { 'aria-invalid': undefined, 'aria-describedby': 'topic-hint' },
  });
});

test('a field with an error is marked invalid and described by its hint, then its error', () => {
  assert.deepEqual(wireField('Say what you are stuck on.', { id: 'topic-error', hint: 'topic-hint' }), {
    error: 'Say what you are stuck on.',
    errorId: 'topic-error',
    input: { 'aria-invalid': true, 'aria-describedby': 'topic-hint topic-error' },
  });
});

test('a field with no hint is described by nothing until it has an error', () => {
  assert.deepEqual(wireField(undefined, { id: 'join-name-error' }).input, { 'aria-invalid': undefined, 'aria-describedby': undefined });
  assert.deepEqual(wireField('Enter a name.', { id: 'join-name-error' }).input, { 'aria-invalid': true, 'aria-describedby': 'join-name-error' });
});

test('an empty or missing message is no error', () => {
  for (const error of ['', null, undefined]) assert.deepEqual(wireField(error, { id: 'x-error', hint: 'x-hint' }).input, { 'aria-invalid': undefined, 'aria-describedby': 'x-hint' });
});

test('describedBy joins the ids it is given in order, and is nothing when given none', () => {
  assert.equal(describedBy('work-email-hint', 'sendWorkEmail-email-error', 'work-email-failure'), 'work-email-hint sendWorkEmail-email-error work-email-failure');
  assert.equal(describedBy('work-email-hint', undefined, false), 'work-email-hint');
  assert.equal(describedBy(null, '', false), undefined);
});
