import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClub } from './club.ts';
import { createCommunity } from './community.ts';
import { migrate } from './db.ts';
import { createBilling } from './billing.ts';
import { createMailings, digestWeek, onboardingStep, REPLY_NOTICE_GAP_MS } from './mailings.ts';
import { openDatabase } from './node-db.ts';
import { createSchedule } from './schedule.ts';

const PASSWORD = 'correct horse battery';
const DAY_MS = 86_400_000;

const world = () => {
  let clock = new Date('2026-11-24T10:00:00Z');
  const now = () => clock;
  const db = openDatabase(':memory:');
  migrate(db);
  const club = createClub(db, now);
  const join = async (email: string, name: string) => {
    club.recordJoinRequest({ name, email, stage: 'I run a practice' });
    const request = club.joinRequests({ decided: false }).find((r) => r.email === email);
    const invited = club.inviteFromRequest(request?.id ?? 0);
    assert.ok(invited.ok);
    const accepted = await club.setPasswordFromLink(invited.value.token, PASSWORD);
    assert.ok(accepted);
    return accepted.member;
  };
  return { db, club, join, now, community: createCommunity(db, now), mailings: createMailings(db, now), schedule: createSchedule(db, now), later: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
};

test('a reply tells everyone else who posted in the thread, at most once every six hours', async () => {
  const w = await world();
  const aina = await w.join('aina@firm.com.my', 'Aina');
  const abu = await w.join('abu@firm.com.my', 'Abu');
  const siti = await w.join('siti@firm.com.my', 'Siti');
  const place = w.community.startThread(aina, { channel: 'pricing', title: 'Fixed fees for audits', body: 'How do you price them?' });
  w.community.reply(abu, place.threadId, { body: 'Per entity.' });

  w.community.reply(siti, place.threadId, { body: 'Per hour, sadly.' });
  const first = w.mailings.replyNotices(place.threadId, siti.id);
  assert.equal(first.title, 'Fixed fees for audits');
  assert.deepEqual(first.recipients.map((r) => r.name).sort(), ['Abu', 'Aina'], 'the replier is not told');
  w.community.reply(abu, place.threadId, { body: 'Try fixed.' });
  assert.deepEqual(w.mailings.replyNotices(place.threadId, abu.id).recipients.map((r) => r.name), ['Siti'], 'Aina, told minutes ago, is skipped');

  w.later(REPLY_NOTICE_GAP_MS + 1);
  w.mailings.setPrefs(abu.id, { replies: false, digest: true });
  assert.deepEqual(w.mailings.replyNotices(place.threadId, siti.id).recipients.map((r) => r.name), ['Aina'], 'a member who turned replies off is skipped');
  assert.deepEqual(w.mailings.prefs(abu.id), { replies: false, digest: true });
});

test('the digest goes only to active members who asked for it, once a week', async () => {
  const w = await world();
  const aina = await w.join('aina@firm.com.my', 'Aina');
  await w.join('abu@firm.com.my', 'Abu');
  w.club.appointAdmin({ email: 'new@club.test', name: 'Not yet active' });
  assert.deepEqual(w.mailings.digestRecipients(), [], 'nobody gets it without asking');
  w.mailings.setPrefs(aina.id, { replies: true, digest: true });
  const [subscriber] = w.mailings.digestRecipients();
  assert.equal(subscriber?.name, 'Aina');
  assert.equal(w.mailings.unsubscribe(subscriber?.key ?? '', 'digest'), true);
  assert.deepEqual(w.mailings.digestRecipients(), [], 'one click stops it');
  assert.equal(w.mailings.prefs(aina.id).replies, true, 'and only that email');
  assert.equal(w.mailings.unsubscribe('not-a-key', 'replies'), false);
  assert.equal(w.mailings.claimDigest('2026-11-23'), true);
  assert.equal(w.mailings.claimDigest('2026-11-23'), false, 'a rerun the same week sends nothing');
});

test('the digest is due from 8 am Malaysia time on Mondays', () => {
  assert.equal(digestWeek(new Date('2026-11-23T00:00:00Z')), '2026-11-23', 'Monday 8 am in Malaysia');
  assert.equal(digestWeek(new Date('2026-11-22T23:00:00Z')), null, 'Monday 7 am in Malaysia');
  assert.equal(digestWeek(new Date('2026-11-23T15:59:00Z')), '2026-11-23', 'still Monday in Malaysia');
  assert.equal(digestWeek(new Date('2026-11-23T16:00:00Z')), null, 'Tuesday in Malaysia');
});

test('members say they are coming, are reminded once, and hear when a session is called off', async () => {
  const w = await world();
  const aina = await w.join('aina@firm.com.my', 'Aina');
  const id = w.schedule.add({ title: 'Pricing clinic', kind: 'Clinics', startsAt: '2026-11-26T12:00:00Z', minutes: 60, link: 'https://meet.example/x', detail: '' });

  const yes = w.schedule.rsvp(aina.id, id, true);
  assert.equal(yes?.changed, true);
  assert.equal(yes?.session.attending, true);
  assert.equal(yes?.session.going, 1);
  assert.equal(w.schedule.rsvp(aina.id, id, true)?.changed, false, 'saying yes twice changes nothing, so no second confirmation');

  assert.deepEqual(w.schedule.dueReminders(), [], 'two days out, no reminder yet');
  w.later(27 * 3_600_000);
  const due = w.schedule.dueReminders();
  assert.equal(due.length, 1);
  assert.deepEqual(due[0]?.attendees.map((a) => a.name), ['Aina']);
  assert.deepEqual(w.schedule.dueReminders(), [], 'a rerun sends no second reminder');

  w.later(23.5 * 3_600_000);
  assert.equal(w.schedule.upcoming(aina.id).length, 1, 'still listed while it runs');
  w.later(3_600_000);
  assert.equal(w.schedule.upcoming(aina.id).length, 0, 'gone once it ends');
  assert.equal(w.schedule.rsvp(aina.id, id, false), null, 'too late to answer');

  const next = w.schedule.add({ title: 'Guest session', kind: 'Guest sessions', startsAt: '2026-12-10T12:00:00Z', minutes: 90, link: 'https://meet.example/y', detail: '' });
  w.schedule.rsvp(aina.id, next, true);
  assert.deepEqual(w.schedule.cancel(next)?.attendees.map((a) => a.name), ['Aina']);
  assert.equal(w.schedule.cancel(next), null, 'calling it off twice does nothing');
  assert.equal(w.schedule.upcoming(aina.id).length, 0);
});

test('the getting-started emails follow the first payment on days 1, 4 and 9, two days apart at least, for three weeks', () => {
  const paid = new Date('2026-12-01T00:00:00Z');
  const day = (n: number) => new Date(paid.getTime() + n * 86_400_000);
  assert.equal(onboardingStep(paid, 0, null, day(0.9)), null, 'nothing on the first day');
  assert.equal(onboardingStep(paid, 0, null, day(1)), 0);
  assert.equal(onboardingStep(paid, 1, day(1), day(3.9)), null);
  assert.equal(onboardingStep(paid, 1, day(1), day(4)), 1);
  assert.equal(onboardingStep(paid, 2, day(4), day(9)), 2);
  assert.equal(onboardingStep(paid, 3, day(9), day(12)), null, 'three and done');
  assert.equal(onboardingStep(paid, 1, day(8), day(9)), null, 'one held back for want of a session does not land on top of the next');
  assert.equal(onboardingStep(paid, 1, day(8), day(10)), 1);
  assert.equal(onboardingStep(paid, 0, null, day(22)), null, 'after three weeks the member is left alone');
});

test('a paying member who has not booked a session gets each getting-started email once, until they book or stop them', async () => {
  const w = world();
  const billing = createBilling(w.db, () => new Date(w.now()));
  const pay = (memberId: number, purchase: string) => {
    billing.opened(purchase, memberId, 'checkout', 'month');
    assert.ok(billing.paid(purchase, false));
  };
  const aina = await w.join('aina@firm.com.my', 'Aina');
  const abu = await w.join('abu@firm.com.my', 'Abu');
  const siti = await w.join('siti@firm.com.my', 'Siti');
  await w.join('unpaid@firm.com.my', 'Unpaid');
  pay(aina.id, 'p-aina');
  pay(abu.id, 'p-abu');
  pay(siti.id, 'p-siti');
  const due = () => w.mailings.dueOnboarding().map((m) => `${m.name} ${m.step}`).sort();

  assert.deepEqual(due(), [], 'nothing the day they pay');
  w.later(DAY_MS);
  assert.deepEqual(due(), ['Abu 0', 'Aina 0', 'Siti 0'], 'the member who has not paid is not told about sessions they cannot book');
  assert.deepEqual(due(), [], 'a rerun of the hourly job sends nothing twice');

  const session = w.schedule.add({ title: 'Pricing clinic', kind: 'Clinics', startsAt: '2026-12-10T12:00:00Z', minutes: 60, link: 'https://meet.example/x', detail: '' });
  w.schedule.rsvp(abu.id, session, true);
  assert.deepEqual(due(), [], 'nothing more until day 4');
  const key = w.db.prepare('SELECT unsubscribe_key FROM members WHERE id = ?').get(siti.id)?.unsubscribe_key;
  assert.ok(typeof key === 'string' && w.mailings.unsubscribe(key, 'onboarding'), 'one click stops them');

  w.later(3 * DAY_MS);
  assert.deepEqual(due(), ['Aina 1'], 'Abu said he is coming and Siti stopped them');
  w.later(5 * DAY_MS);
  assert.deepEqual(due(), ['Aina 2']);
  w.later(5 * DAY_MS);
  assert.deepEqual(due(), [], 'three emails at most');
});

test('a getting-started email that did not send is tried again on the next run, and only once', async () => {
  const w = world();
  const billing = createBilling(w.db, () => new Date(w.now()));
  const aina = await w.join('aina@firm.com.my', 'Aina');
  billing.opened('p-aina', aina.id, 'checkout', 'month');
  assert.ok(billing.paid('p-aina', false));
  w.later(DAY_MS);
  const [claimed] = w.mailings.dueOnboarding();
  assert.equal(claimed?.step, 0);
  w.mailings.releaseOnboarding(aina.id, 0);
  w.mailings.releaseOnboarding(aina.id, 0);
  assert.deepEqual(w.mailings.dueOnboarding().map((m) => m.step), [0], 'the same email again, not skipped and not doubled');
  assert.deepEqual(w.mailings.dueOnboarding(), []);
});

test('the migration leaves out members who had already paid, but not members still to pay', async () => {
  const w = world();
  const billing = createBilling(w.db, () => new Date(w.now()));
  const paid = await w.join('paid@firm.com.my', 'Paid');
  const later = await w.join('later@firm.com.my', 'Later');
  billing.opened('p-paid', paid.id, 'checkout', 'month');
  assert.ok(billing.paid('p-paid', false));
  /* Back to the schema before the getting-started emails (migration 16), undoing the social one after it, then upgrade again. */
  w.db.exec('DROP TABLE follows; DROP TABLE profiles; ALTER TABLE members DROP COLUMN joined_via;');
  w.db.exec('ALTER TABLE members DROP COLUMN email_onboarding; ALTER TABLE members DROP COLUMN onboarding_sent; ALTER TABLE members DROP COLUMN onboarding_last_at;');
  w.db.prepare('DELETE FROM schema_version WHERE version >= 16').run();
  migrate(w.db);
  const sent = (id: number) => w.db.prepare('SELECT onboarding_sent AS n FROM members WHERE id = ?').get(id)?.['n'];
  assert.equal(sent(paid.id), 3, 'a member who paid before the emails existed is not told they joined recently');
  assert.equal(sent(later.id), 0, 'a member invited but not yet paid still gets them once they pay');
});
