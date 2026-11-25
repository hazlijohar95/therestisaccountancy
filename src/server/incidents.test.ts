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
