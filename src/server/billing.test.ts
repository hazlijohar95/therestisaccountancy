import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_TERM, monthsFree, terms } from '../data/membership.ts';
import { createBilling, GRACE_MS, PAY_REMINDER_LEAD_MS } from './billing.ts';
import { createClub } from './club.ts';
import { migrate } from './db.ts';
import { renewalNoticeLetter } from './letters.ts';
import { openDatabase } from './node-db.ts';

const DAY = 86_400_000;
const SITE = 'https://club.test';
const NO_COUNTS = { session: 0, post: 0, lesson: 0, call: 0, plan: 0 };

const world = async () => {
  let clock = new Date('2026-01-31T10:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  migrate(db);
  const club = createClub(db, now);
  club.recordJoinRequest({ name: 'Aina', email: 'aina@firm.com.my', stage: 'I run a practice' });
  const invited = club.inviteFromRequest(club.joinRequests()[0]?.id ?? 0);
  assert.ok(invited.ok && invited.value.kind === 'link');
  const accepted = await club.setPasswordFromLink(invited.value.link.token, 'correct horse battery');
  assert.ok(accepted);
  return { db, club, billing: createBilling(db, now), member: accepted.member, later: (ms: number) => (clock = new Date(clock.getTime() + ms)), now };
};

const at = (value: string) => new Date(value);

test('a month on keeps the day, or the last day of a shorter month', () => {
  assert.equal(terms.month.after(at('2026-01-31T10:00:00Z')).toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(terms.month.after(at('2026-03-15T00:00:00Z')).toISOString(), '2026-04-15T00:00:00.000Z');
  assert.equal(terms.month.after(at('2026-12-31T00:00:00Z')).toISOString(), '2027-01-31T00:00:00.000Z');
});

test('a year on is twelve calendar months in one step, clamped only on a leap day', () => {
  assert.equal(terms.year.after(at('2026-01-31T10:00:00Z')).toISOString(), '2027-01-31T10:00:00.000Z');
  assert.equal(terms.year.after(at('2026-08-31T00:00:00Z')).toISOString(), '2027-08-31T00:00:00.000Z', 'not worn down to the 28th by twelve single months');
  assert.equal(terms.year.after(at('2028-02-29T00:00:00Z')).toISOString(), '2029-02-28T00:00:00.000Z');
});

test('taking a term off goes back the same calendar months', () => {
  assert.equal(terms.month.before(at('2026-03-31T10:00:00Z')).toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(terms.month.before(at('2026-04-15T00:00:00Z')).toISOString(), '2026-03-15T00:00:00.000Z');
  assert.equal(terms.year.before(at('2027-01-31T10:00:00Z')).toISOString(), '2026-01-31T10:00:00.000Z');
  assert.equal(terms.year.before(at('2028-02-29T00:00:00Z')).toISOString(), '2027-02-28T00:00:00.000Z');
});

test('a year costs ten months, so two are free', () => {
  assert.equal(terms.month.label, 'RM 99 a month');
  assert.equal(terms.year.label, 'RM 990 a year');
  assert.equal(terms.year.sen, 10 * terms.month.sen);
  assert.equal(monthsFree('year'), 2);
  assert.equal(monthsFree('month'), 0);
});

test('a paid checkout opens a month, saves the card, and a repeated callback changes nothing', async () => {
  const w = await world();
  assert.equal(w.billing.access(w.member.id), 'unpaid');
  assert.equal(w.billing.standing(w.member.id).term, DEFAULT_TERM, 'nothing chosen yet');
  w.billing.opened('p1', w.member.id, 'checkout', 'month');
  w.billing.opened('p0', w.member.id, 'checkout', 'month');
  assert.deepEqual(w.billing.unpaid(w.member.id, 'checkout'), ['p0', 'p1'], 'every open checkout, newest first');

  const first = w.billing.paid('p1', true);
  assert.equal(first?.standing.access, 'paid');
  assert.equal(first?.standing.paidUntil, '2026-02-28T10:00:00Z');
  assert.equal(first?.standing.cardOnFile, true);
  assert.equal(w.billing.paid('p1', true), null, 'CHIP calling back again is ignored');
  assert.equal(w.billing.paid('unknown', true), null, 'a purchase that is not ours is ignored');
  assert.deepEqual(w.billing.unpaid(w.member.id, 'checkout'), ['p0']);
});

test('renewals come due half a day early, retry daily through the grace period, then stop', async () => {
  const w = await world();
  w.billing.opened('p1', w.member.id, 'checkout', 'month');
  w.billing.paid('p1', true);
  assert.deepEqual(w.billing.dueRenewals(), [], 'not yet');

  w.later(28 * DAY - 6 * 3_600_000);
  const due = w.billing.dueRenewals();
  assert.equal(due.length, 1);
  assert.equal(due[0]?.token, 'p1');
  assert.deepEqual(w.billing.dueRenewals(), [], 'the next hourly run does not charge again');

  w.billing.opened('r1', w.member.id, 'renewal', 'month');
  w.billing.failed('r1', false);
  w.later(DAY);
  assert.equal(w.billing.access(w.member.id), 'grace', 'the month ended; the member keeps access for a few days');
  assert.equal(w.billing.dueRenewals().length, 1, 'tried again a day later');

  w.billing.opened('r2', w.member.id, 'renewal', 'month');
  assert.equal(w.billing.paid('r2', false)?.standing.paidUntil, '2026-04-01T04:00:00Z', 'a late renewal counts a month from when it was paid');
  assert.equal(w.billing.standing(w.member.id).cardOnFile, true, 'a renewal keeps the saved card');
});

test('a refused card stops renewals, and the member loses access after the grace period', async () => {
  const w = await world();
  w.billing.opened('p1', w.member.id, 'checkout', 'month');
  w.billing.paid('p1', true);
  w.later(28 * DAY);
  assert.equal(w.billing.dueRenewals().length, 1);
  w.billing.opened('r1', w.member.id, 'renewal', 'month');
  w.billing.failed('r1', true);
  assert.equal(w.billing.standing(w.member.id).cardOnFile, false);
  w.later(DAY);
  assert.deepEqual(w.billing.dueRenewals(), [], 'no card, no charge');
  w.later(GRACE_MS);
  assert.equal(w.billing.access(w.member.id), 'unpaid');
});

test('turning renewal off means no charge, and access lasts to the end of the month', async () => {
  const w = await world();
  w.billing.opened('p1', w.member.id, 'checkout', 'month');
  w.billing.paid('p1', true);
  assert.equal(w.billing.setRenews(w.member.id, false, SITE).standing.renews, false);
  w.later(27 * DAY);
  assert.deepEqual(w.billing.dueRenewals(), []);
  assert.equal(w.billing.access(w.member.id), 'paid');
  w.later(DAY);
  assert.equal(w.billing.access(w.member.id), 'unpaid', 'no grace without a renewal coming');
});

test('a member paying by FPX is reminded once before each month ends, and keeps the grace period', async () => {
  const w = await world();
  w.billing.opened('p1', w.member.id, 'checkout', 'month');
  assert.equal(w.billing.paid('p1', false)?.standing.cardOnFile, false);
  assert.deepEqual(w.billing.dueRenewals(), [], 'nothing to charge without a card');
  assert.deepEqual(w.billing.paymentReminders(), [], 'too early');

  w.later(28 * DAY - PAY_REMINDER_LEAD_MS + 3_600_000);
  assert.deepEqual(w.billing.paymentReminders().map((r) => r.name), ['Aina']);
  assert.deepEqual(w.billing.paymentReminders(), [], 'once per month');

  w.later(PAY_REMINDER_LEAD_MS);
  assert.equal(w.billing.access(w.member.id), 'grace');
  w.billing.opened('p2', w.member.id, 'checkout', 'month');
  w.billing.paid('p2', false);
  assert.equal(w.billing.access(w.member.id), 'paid');
  w.later(26 * DAY);
  assert.equal(w.billing.paymentReminders().length, 1, 'reminded again for the next month');
});

test('a full refund or chargeback takes off the month it bought, once', async () => {
  const w = await world();
  w.billing.opened('p1', w.member.id, 'checkout', 'month');
  w.billing.paid('p1', true);
  w.billing.opened('p2', w.member.id, 'checkout', 'month');
  w.billing.paid('p2', false);
  assert.equal(w.billing.standing(w.member.id).paidUntil, '2026-03-28T10:00:00Z');

  const undone = w.billing.reversed('p1');
  assert.equal(undone?.standing.paidUntil, '2026-02-28T10:00:00Z');
  assert.equal(undone?.standing.cardOnFile, false, 'the card saved by the refunded payment is dropped');
  assert.equal(w.billing.reversed('p1'), null, 'CHIP reporting it again changes nothing');
  assert.equal(w.billing.reversed('not-ours'), null);
  assert.equal(w.billing.reversed('p2')?.standing.access, 'unpaid', 'both months refunded: no access');
});

test('a yearly checkout adds twelve calendar months, and a repeated callback changes nothing', async () => {
  const w = await world();
  w.billing.opened('y1', w.member.id, 'checkout', 'year');
  const first = w.billing.paid('y1', true);
  assert.equal(first?.term, 'year');
  assert.equal(first?.standing.paidUntil, '2027-01-31T10:00:00Z');
  assert.equal(first?.standing.term, 'year');

  w.later(DAY);
  assert.equal(w.billing.paid('y1', true), null, 'CHIP calling back again is ignored');
  assert.deepEqual(w.billing.standing(w.member.id), first?.standing, 'and nothing moved');
});

test('a payment adds the term it was opened with, after the time already paid for', async () => {
  const w = await world();
  w.billing.opened('m1', w.member.id, 'checkout', 'month');
  w.billing.opened('y1', w.member.id, 'checkout', 'year');
  assert.equal(w.billing.paid('m1', false)?.standing.paidUntil, '2026-02-28T10:00:00Z');
  const year = w.billing.paid('y1', false);
  assert.equal(year?.standing.paidUntil, '2027-02-28T10:00:00Z', 'a year on from the end of the paid month');
  assert.equal(year?.standing.term, 'year', 'the last paid checkout sets the term');

  w.billing.opened('m2', w.member.id, 'checkout', 'month');
  const month = w.billing.paid('m2', false);
  assert.equal(month?.standing.paidUntil, '2027-03-28T10:00:00Z');
  assert.equal(month?.standing.term, 'month');
});

test('a refund takes off the term that payment added, whatever the member pays by now', async () => {
  const w = await world();
  w.billing.opened('m1', w.member.id, 'checkout', 'month');
  w.billing.paid('m1', false);
  w.billing.opened('y1', w.member.id, 'checkout', 'year');
  w.billing.paid('y1', false);
  assert.equal(w.billing.standing(w.member.id).paidUntil, '2027-02-28T10:00:00Z');

  const month = w.billing.reversed('m1');
  assert.equal(month?.term, 'month');
  assert.equal(month?.standing.paidUntil, '2027-01-28T10:00:00Z', 'the month comes off, the year stays');
  assert.equal(month?.standing.term, 'year');
  assert.equal(w.billing.reversed('m1'), null, 'CHIP reporting it again changes nothing');
  assert.equal(w.billing.standing(w.member.id).paidUntil, '2027-01-28T10:00:00Z');

  const year = w.billing.reversed('y1');
  assert.equal(year?.term, 'year');
  assert.equal(year?.standing.paidUntil, '2026-01-28T10:00:00Z', 'twelve months off');
  assert.equal(year?.standing.access, 'unpaid');
});

test('a refunded yearly payment takes twelve months off and leaves the months paid before it', async () => {
  const w = await world();
  w.billing.opened('m1', w.member.id, 'checkout', 'month');
  w.billing.paid('m1', true);
  w.billing.opened('y1', w.member.id, 'checkout', 'year');
  w.billing.paid('y1', true);

  const undone = w.billing.reversed('y1');
  assert.equal(undone?.standing.paidUntil, '2026-02-28T10:00:00Z');
  assert.equal(undone?.standing.access, 'paid');
  assert.equal(undone?.standing.term, 'month', 'back to the term of the checkout still standing');
  assert.equal(undone?.standing.cardOnFile, false, 'the card saved by the refunded payment is dropped');
});

test('a card renewal is for the term of the last paid checkout, and paying it keeps that term', async () => {
  const w = await world();
  w.billing.opened('y1', w.member.id, 'checkout', 'year');
  w.billing.paid('y1', true);
  w.later(360 * DAY);
  assert.deepEqual(w.billing.dueRenewals(), [], 'not in the last days of the year, only the last half day');

  w.later(5 * DAY - 6 * 3_600_000);
  const due = w.billing.dueRenewals();
  assert.deepEqual(due.map((r) => [r.term, r.token, r.paidUntil]), [['year', 'y1', '2027-01-31T10:00:00Z']]);
  assert.deepEqual(w.billing.dueRenewals(), [], 'the next hourly run does not charge again');

  w.billing.opened('r1', w.member.id, 'renewal', 'year');
  const renewed = w.billing.paid('r1', false);
  assert.equal(renewed?.standing.paidUntil, '2028-01-31T10:00:00Z');
  assert.equal(renewed?.standing.term, 'year');
  assert.equal(renewed?.standing.cardOnFile, true);
  assert.deepEqual(w.billing.dueRenewals(), [], 'paid for: nothing is due');

  w.billing.opened('m1', w.member.id, 'checkout', 'month');
  assert.equal(w.billing.paid('m1', true)?.standing.term, 'month', 'paying a month at checkout switches the renewal to monthly');
  w.later(366 * DAY + 28 * DAY);
  assert.deepEqual(w.billing.dueRenewals().map((r) => [r.term, r.token]), [['month', 'm1']]);
});

test('a renewal opened at one term still adds that term if the member has since paid for the other', async () => {
  const w = await world();
  w.billing.opened('m1', w.member.id, 'checkout', 'month');
  w.billing.paid('m1', true);
  w.billing.opened('r1', w.member.id, 'renewal', 'month');
  w.billing.opened('y1', w.member.id, 'checkout', 'year');
  w.billing.paid('y1', true);

  const late = w.billing.paid('r1', false);
  assert.equal(late?.standing.paidUntil, '2027-03-28T10:00:00Z', 'a month, a year, and the renewal month');
  assert.equal(late?.standing.term, 'year', 'a renewal never changes what the member chose');
});

test('a yearly member paying by FPX is reminded once before the year ends, and keeps the grace period', async () => {
  const w = await world();
  w.billing.opened('y1', w.member.id, 'checkout', 'year');
  w.billing.paid('y1', false);
  w.later(300 * DAY);
  assert.deepEqual(w.billing.paymentReminders(), [], 'too early');

  w.later(65 * DAY - PAY_REMINDER_LEAD_MS + 3_600_000);
  assert.deepEqual(w.billing.paymentReminders(), [{ email: 'aina@firm.com.my', name: 'Aina', term: 'year', paidUntil: '2027-01-31T10:00:00Z' }]);
  assert.deepEqual(w.billing.paymentReminders(), [], 'once per year paid for');

  w.later(PAY_REMINDER_LEAD_MS);
  assert.equal(w.billing.access(w.member.id), 'grace');
  w.later(GRACE_MS);
  assert.equal(w.billing.access(w.member.id), 'unpaid');
});

test('a yearly card member hears once, a week before the charge; a monthly card member does not', async () => {
  const w = await world();
  w.billing.opened('y1', w.member.id, 'checkout', 'year');
  w.billing.paid('y1', true);
  w.later(357 * DAY);
  assert.deepEqual(w.billing.renewalNotices(), [], 'more than a week out');

  w.later(2 * DAY);
  assert.deepEqual(w.billing.renewalNotices(), [{ memberId: w.member.id, email: 'aina@firm.com.my', name: 'Aina', term: 'year', paidUntil: '2027-01-31T10:00:00Z', chargesAt: '2027-01-30T22:00:00Z' }]);
  assert.deepEqual(w.billing.renewalNotices(), [], 'once per renewal');

  const m = await world();
  m.billing.opened('m1', m.member.id, 'checkout', 'month');
  m.billing.paid('m1', true);
  m.later(30 * DAY);
  assert.deepEqual(m.billing.renewalNotices(), [], 'a month needs no warning');
});

test('turning renewal off means no notice', async () => {
  const w = await world();
  w.billing.opened('y1', w.member.id, 'checkout', 'year');
  w.billing.paid('y1', true);
  w.billing.setRenews(w.member.id, false, SITE);
  w.later(362 * DAY);
  assert.deepEqual(w.billing.renewalNotices(), []);
});

test('the notice names the day the card is charged, which can be the day before the paid year ends', async () => {
  const w = await world();
  w.later(-9 * 3_600_000);
  w.billing.opened('y1', w.member.id, 'checkout', 'year');
  w.billing.paid('y1', true);
  w.later(360 * DAY);
  const [notice] = w.billing.renewalNotices();
  assert.ok(notice);
  assert.equal(notice.paidUntil, '2027-01-31T01:00:00Z', 'the year ends at 9 am on 31 January, Malaysia time');
  assert.equal(notice.chargesAt, '2027-01-30T13:00:00Z', 'charged at 9 pm on 30 January, Malaysia time');
  const letter = renewalNoticeLetter(notice, { term: notice.term, chargesAt: notice.chargesAt, accountUrl: 'https://club.test/members/account', counts: NO_COUNTS, upcoming: [] });
  assert.equal(letter.subject, 'Your membership renews on 30 Jan 2027');
});

/** A paid member with a card, and an admin to hear about it. */
const leaver = async () => {
  const w = await world();
  w.club.recordJoinRequest({ name: 'Host', email: 'host@club.test', stage: 'I run a practice' });
  const invited = w.club.inviteFromRequest(w.club.joinRequests({ decided: false })[0]?.id ?? 0);
  assert.ok(invited.ok && invited.value.kind === 'link');
  assert.ok(await w.club.setPasswordFromLink(invited.value.link.token, 'correct horse battery'));
  w.db.prepare(`UPDATE members SET role = 'admin' WHERE email = 'host@club.test'`).run();
  w.billing.opened('p1', w.member.id, 'checkout', 'year');
  w.billing.paid('p1', true);
  return w;
};

const stops = (w: Awaited<ReturnType<typeof leaver>>) => w.db.prepare('SELECT count(*) AS n FROM renewal_stops WHERE member_id = ?').get(w.member.id)?.n;

test('turning renewal off records one stop with the reason and note, and tells the admins', async () => {
  const w = await leaver();
  const { standing, letters } = w.billing.setRenews(w.member.id, false, SITE, { reason: 'price', note: '  Cash is tight  ' });
  assert.equal(standing.renews, false);
  assert.deepEqual(w.billing.lastStop(w.member.id), { at: '2026-01-31T10:00:00Z', reason: 'price', note: 'Cash is tight' });
  assert.equal(letters.length, 1);
  const [letter] = letters;
  assert.deepEqual(letter?.to, ['host@club.test']);
  assert.equal(letter?.subject, 'Aina turned renewal off');
  assert.deepEqual(letter?.lines, [
    'Aina turned renewal off. They keep access until 31 Jan 2027.',
    'Reason: It costs too much right now.',
    'They wrote: Cash is tight',
    { href: 'https://club.test/admin/members/' + w.member.id, label: 'Open their page' },
  ]);
});

test('the reason and the note are both optional', async () => {
  const w = await leaver();
  const { letters } = w.billing.setRenews(w.member.id, false, SITE);
  assert.deepEqual(w.billing.lastStop(w.member.id), { at: '2026-01-31T10:00:00Z', reason: null, note: null });
  assert.equal(letters[0]?.lines[1], 'No reason given.');
  assert.equal(letters[0]?.lines.length, 3, 'no note line, so name, reason and link');
});

test('turning renewal off when it is already off, or on, records nothing and sends nothing', async () => {
  const w = await leaver();
  assert.equal(w.billing.setRenews(w.member.id, false, SITE, { reason: 'time', note: null }).letters.length, 1);
  assert.deepEqual(w.billing.setRenews(w.member.id, false, SITE, { reason: 'price', note: null }).letters, []);
  assert.equal(stops(w), 1);
  assert.equal(w.billing.lastStop(w.member.id)?.reason, 'time', 'the second answer did not replace the first');
  assert.deepEqual(w.billing.setRenews(w.member.id, true, SITE).letters, []);
  assert.equal(stops(w), 1);
  assert.equal(w.billing.standing(w.member.id).renews, true);
});

test('lastStop is the latest of several stops, and null for a member who never stopped', async () => {
  const w = await leaver();
  assert.equal(w.billing.lastStop(w.member.id), null);
  w.billing.setRenews(w.member.id, false, SITE, { reason: 'time', note: null });
  w.billing.setRenews(w.member.id, true, SITE);
  w.later(DAY);
  w.billing.setRenews(w.member.id, false, SITE, { reason: 'done', note: 'Thanks' });
  assert.equal(stops(w), 2);
  assert.deepEqual(w.billing.lastStop(w.member.id), { at: '2026-02-01T10:00:00Z', reason: 'done', note: 'Thanks' });
});

test('a stop is recorded even when there is no admin to tell, and a member with no subscription has none', async () => {
  const w = await world();
  assert.deepEqual(w.billing.setRenews(w.member.id, false, SITE, { reason: 'time', note: null }).letters, []);
  assert.equal(w.billing.lastStop(w.member.id), null, 'nothing to turn off before the first payment');
  w.billing.opened('p1', w.member.id, 'checkout', 'month');
  w.billing.paid('p1', true);
  assert.deepEqual(w.billing.setRenews(w.member.id, false, SITE, { reason: 'time', note: null }).letters, []);
  assert.equal(w.billing.lastStop(w.member.id)?.reason, 'time');
});
