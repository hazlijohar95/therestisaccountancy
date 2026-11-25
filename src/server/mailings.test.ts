import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClub } from './club.ts';
import { createCommunity } from './community.ts';
import { migrate } from './db.ts';
import { createMailings, digestWeek, REPLY_NOTICE_GAP_MS } from './mailings.ts';
import { openDatabase } from './node-db.ts';
import { createSchedule } from './schedule.ts';

const PASSWORD = 'correct horse battery';

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
  return { db, club, join, community: createCommunity(db, now), mailings: createMailings(db, now), schedule: createSchedule(db, now), later: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
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
