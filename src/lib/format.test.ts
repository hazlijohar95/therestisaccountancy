import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayParts, waited } from './format.ts';

test('a wait is told in words', () => {
  const since = '2026-11-25T01:00:00Z';
  const after = (hours: number) => new Date(Date.parse(since) + hours * 3_600_000);
  assert.equal(waited(since, after(0.5)), 'under an hour');
  assert.equal(waited(since, after(1)), 'an hour');
  assert.equal(waited(since, after(5)), 'five hours');
  assert.equal(waited(since, after(30)), 'a day');
  assert.equal(waited(since, after(74)), 'three days');
});

test('a date tile reads the day in Malaysian time', () => {
  assert.deepEqual(dayParts('2026-11-30T09:00:00Z'), { weekday: 'Mon', day: '30', month: 'Nov' });
  assert.deepEqual(dayParts('2026-11-30T17:00:00Z'), { weekday: 'Tue', day: '1', month: 'Dec' });
});
