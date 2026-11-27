import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrate } from './db.ts';
import { createIncidents, summaryDue } from './incidents.ts';
import { openDatabase } from './node-db.ts';

test('failures are summarised once the summary has gone, then only new ones', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  const incidents = createIncidents(db, () => new Date('2026-11-25T01:00:00Z'));
  incidents.record('email', 'Reset to aina@firm.com.my did not send');
  incidents.record('renewal', 'x'.repeat(900));
  const first = incidents.unreported();
  assert.deepEqual(first.incidents.map((i) => i.kind), ['email', 'renewal']);
  assert.equal(first.incidents[1]?.detail.length, 500, 'details are kept short');
  assert.equal(incidents.unreported().incidents.length, 2, 'until the summary is sent, they stay unreported');
  incidents.record('job', 'boom');
  incidents.reported(first.lastId);
  assert.deepEqual(incidents.unreported().incidents.map((i) => i.detail), ['boom'], 'one recorded meanwhile waits for the next summary');
});

test('the summary is due in the 9 am hour in Malaysia', () => {
  assert.equal(summaryDue(new Date('2026-11-25T01:00:00Z')), true);
  assert.equal(summaryDue(new Date('2026-11-25T02:00:00Z')), false);
});

test('recordOnce skips a kind already recorded in the last 20 hours, whether or not it was reported', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  let clock = new Date('2026-11-25T01:00:00Z');
  const incidents = createIncidents(db, () => clock);
  assert.equal(incidents.recordOnce('schedule', 'No live session'), true);
  clock = new Date(clock.getTime() + 3_600_000);
  assert.equal(incidents.recordOnce('schedule', 'No live session'), false, 'a rerun in the same summary hour');
  assert.equal(incidents.recordOnce('job', 'Another kind'), true, 'only its own kind counts');
  incidents.reported(incidents.unreported().lastId);
  assert.equal(incidents.recordOnce('schedule', 'No live session'), false, 'a summary that has gone does not reopen it');
  clock = new Date(clock.getTime() + 20 * 3_600_000);
  assert.equal(incidents.recordOnce('schedule', 'No live session'), true, 'the next morning it is recorded again');
  assert.deepEqual(incidents.unreported().incidents.map((i) => i.kind), ['schedule']);
});
