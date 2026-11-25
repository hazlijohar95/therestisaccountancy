import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrate } from './db.ts';
import { createIncidents, summaryDue } from './incidents.ts';
import { openDatabase } from './node-db.ts';

test('failures are summarised once, then only new ones', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  const incidents = createIncidents(db, () => new Date('2026-11-25T01:00:00Z'));
  incidents.record('email', 'Reset to aina@firm.com.my did not send');
  incidents.record('renewal', 'x'.repeat(900));
  const first = incidents.takeUnreported();
  assert.deepEqual(first.map((i) => i.kind), ['email', 'renewal']);
  assert.equal(first[1]?.detail.length, 500, 'details are kept short');
  assert.deepEqual(incidents.takeUnreported(), [], 'a rerun sends nothing twice');
  incidents.record('job', 'boom');
  assert.equal(incidents.takeUnreported().length, 1);
});

test('the summary is due in the 9 am hour in Malaysia', () => {
  assert.equal(summaryDue(new Date('2026-11-25T01:00:00Z')), true);
  assert.equal(summaryDue(new Date('2026-11-25T02:00:00Z')), false);
});
