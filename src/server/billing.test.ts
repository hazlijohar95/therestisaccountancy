import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBilling, GRACE_MS, monthAfter, PAY_REMINDER_LEAD_MS } from './billing.ts';
import { createClub } from './club.ts';
import { migrate } from './db.ts';
import { openDatabase } from './node-db.ts';

const DAY = 86_400_000;

const world = async () => {
  let clock = new Date('2026-01-31T10:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  migrate(db);
  const club = createClub(db, now);
  club.recordJoinRequest({ name: 'Aina', email: 'aina@firm.com.my', stage: 'I run a practice' });
  const invited = club.inviteFromRequest(club.joinRequests()[0]?.id ?? 0);
  assert.ok(invited.ok);
  const accepted = await club.setPasswordFromLink(invited.value.token, 'correct horse battery');
  assert.ok(accepted);
  return { billing: createBilling(db, now), member: accepted.member, later: (ms: number) => (clock = new Date(clock.getTime() + ms)), now };
};

test('a month on keeps the day, or the last day of a shorter month', () => {
  assert.equal(monthAfter(new Date('2026-01-31T10:00:00Z')).toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(monthAfter(new Date('2026-03-15T00:00:00Z')).toISOString(), '2026-04-15T00:00:00.000Z');
  assert.equal(monthAfter(new Date('2026-12-31T00:00:00Z')).toISOString(), '2027-01-31T00:00:00.000Z');
});

test('a paid checkout opens a month, saves the card, and a repeated callback changes nothing', async () => {
  const w = await world();
  assert.equal(w.billing.access(w.member.id), 'unpaid');
  w.billing.opened('p1', w.member.id, 'checkout', 9900);
  assert.equal(w.billing.unpaid(w.member.id, 'checkout'), 'p1');

  const first = w.billing.paid('p1', true);
  assert.equal(first?.standing.access, 'paid');
  assert.equal(first?.standing.paidUntil, '2026-02-28T10:00:00Z');
  assert.equal(first?.standing.cardOnFile, true);
  assert.equal(w.billing.paid('p1', true), null, 'CHIP calling back again is ignored');
  assert.equal(w.billing.paid('unknown', true), null, 'a purchase that is not ours is ignored');
  assert.equal(w.billing.unpaid(w.member.id, 'checkout'), null);
});

test('renewals come due half a day early, retry daily through the grace period, then stop', async () => {
  const w = await world();
  w.billing.opened('p1', w.member.id, 'checkout', 9900);
  w.billing.paid('p1', true);
  assert.deepEqual(w.billing.dueRenewals(), [], 'not yet');

  w.later(28 * DAY - 6 * 3_600_000);
  const due = w.billing.dueRenewals();
  assert.equal(due.length, 1);
  assert.equal(due[0]?.token, 'p1');
  assert.deepEqual(w.billing.dueRenewals(), [], 'the next hourly run does not charge again');

  w.billing.opened('r1', w.member.id, 'renewal', 9900);
  w.billing.failed('r1', false);
  w.later(DAY);
  assert.equal(w.billing.access(w.member.id), 'grace', 'the month ended; the member keeps access for a few days');
  assert.equal(w.billing.dueRenewals().length, 1, 'tried again a day later');

  w.billing.opened('r2', w.member.id, 'renewal', 9900);
  assert.equal(w.billing.paid('r2', false)?.standing.paidUntil, '2026-04-01T04:00:00Z', 'a late renewal counts a month from when it was paid');
  assert.equal(w.billing.standing(w.member.id).cardOnFile, true, 'a renewal keeps the saved card');
});

test('a refused card stops renewals, and the member loses access after the grace period', async () => {
  const w = await world();
  w.billing.opened('p1', w.member.id, 'checkout', 9900);
  w.billing.paid('p1', true);
  w.later(28 * DAY);
  assert.equal(w.billing.dueRenewals().length, 1);
  w.billing.opened('r1', w.member.id, 'renewal', 9900);
  w.billing.failed('r1', true);
  assert.equal(w.billing.standing(w.member.id).cardOnFile, false);
  w.later(DAY);
  assert.deepEqual(w.billing.dueRenewals(), [], 'no card, no charge');
  w.later(GRACE_MS);
  assert.equal(w.billing.access(w.member.id), 'unpaid');
});

test('turning renewal off means no charge, and access lasts to the end of the month', async () => {
  const w = await world();
  w.billing.opened('p1', w.member.id, 'checkout', 9900);
  w.billing.paid('p1', true);
  assert.equal(w.billing.setRenews(w.member.id, false).renews, false);
  w.later(27 * DAY);
  assert.deepEqual(w.billing.dueRenewals(), []);
  assert.equal(w.billing.access(w.member.id), 'paid');
  w.later(DAY);
  assert.equal(w.billing.access(w.member.id), 'unpaid', 'no grace without a renewal coming');
});

test('a member paying by FPX is reminded once before each month ends, and keeps the grace period', async () => {
  const w = await world();
  w.billing.opened('p1', w.member.id, 'checkout', 9900);
  assert.equal(w.billing.paid('p1', false)?.standing.cardOnFile, false);
  assert.deepEqual(w.billing.dueRenewals(), [], 'nothing to charge without a card');
  assert.deepEqual(w.billing.paymentReminders(), [], 'too early');

  w.later(28 * DAY - PAY_REMINDER_LEAD_MS + 3_600_000);
  assert.deepEqual(w.billing.paymentReminders().map((r) => r.name), ['Aina']);
  assert.deepEqual(w.billing.paymentReminders(), [], 'once per month');

  w.later(PAY_REMINDER_LEAD_MS);
  assert.equal(w.billing.access(w.member.id), 'grace');
  w.billing.opened('p2', w.member.id, 'checkout', 9900);
  w.billing.paid('p2', false);
  assert.equal(w.billing.access(w.member.id), 'paid');
  w.later(26 * DAY);
  assert.equal(w.billing.paymentReminders().length, 1, 'reminded again for the next month');
});
