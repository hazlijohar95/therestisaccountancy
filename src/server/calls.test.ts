import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLetter } from '../emails/render.tsx';
import { calendarFile, sessionEvent } from './calendar.ts';
import { byDay, callEvent, callLetters, createCalls, type Call } from './calls.ts';
import { createClub } from './club.ts';
import type { Letter } from './letters.ts';
import { openDatabase } from './node-db.ts';
import type { Result } from './result.ts';

const PASSWORD = 'correct horse battery';
const LINK = 'https://meet.example/hazli';
const SITE = 'https://therestisaccountancy.com/';
const HOUR = 3_600_000;
/** 3 pm on Thursday 26 November, Malaysia time. */
const THURSDAY = '2026-11-26T07:00:00Z';
const shift = (at: string, ms: number) => new Date(new Date(at).getTime() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const value = <T, R extends string>(result: Result<T, R>): T => {
  if (!result.ok) assert.fail(`expected success, got ${result.reason}`);
  return result.value;
};
const reason = <T, R extends string>(result: Result<T, R>): R | null => (result.ok ? null : result.reason);

/** Two hosts, two members, and a clock the test moves. It starts at 9 am on Wednesday 25 November, Malaysia time. */
const world = async () => {
  const clock = { now: new Date('2026-11-25T01:00:00Z') };
  const db = openDatabase(':memory:');
  const club = createClub(db, () => clock.now);
  const calls = createCalls(db, () => clock.now);
  const hazli = await club.ensureAdmin({ email: 'hazli@club.test', name: 'Hazli Johar', password: PASSWORD });
  const shukri = await club.ensureAdmin({ email: 'shukri@club.test', name: 'Shukri Yusof', password: PASSWORD });
  const member = async (email: string, name: string) => {
    const made = await club.ensureAdmin({ email, name, password: PASSWORD });
    return value(club.updateMember(hazli.id, made.id, { name, email, role: 'member' }, SITE)).member;
  };
  const aina = await member('aina@firm.com.my', 'Aina Rahman');
  const abu = await member('abu@firm.com.my', 'Abu Musa');
  const slot = (startsAt: string, minutes = 30, host = hazli.id) => value(calls.add(host, { startsAt, minutes, link: LINK }));
  const at = (moment: string) => {
    clock.now = new Date(moment);
  };
  const openIds = (viewerId: number) => calls.open(viewerId).map((s) => s.id);
  return { calls, club, hazli, shukri, aina, abu, slot, at, openIds };
};

test('members see when an open slot is, how long and with whom, but never its link', async () => {
  const w = await world();
  const id = w.slot(THURSDAY);
  assert.deepEqual(w.calls.open(w.aina.id), [{ id, startsAt: THURSDAY, minutes: 30, host: 'Hazli Johar' }]);
  assert.deepEqual(w.calls.open(w.hazli.id), [], 'a host is not offered their own slot');
  assert.equal(w.calls.booking(w.aina.id), null);
});

test('a slot opens only while it can still be booked, and never over another slot of the same host', async () => {
  const w = await world();
  const add = (startsAt: string, minutes: number, host = w.hazli.id) => w.calls.add(host, { startsAt, minutes, link: LINK });
  assert.equal(reason(add('2026-11-25T03:00:00Z', 30)), 'too-soon', 'exactly two hours ahead, booking has already closed');
  value(add('2026-11-25T03:00:01Z', 30));

  const hour = w.slot(THURSDAY, 60);
  assert.equal(reason(add(shift(THURSDAY, 0.5 * HOUR), 30)), 'overlaps', 'starting inside it');
  assert.equal(reason(add(shift(THURSDAY, -0.25 * HOUR), 30)), 'overlaps', 'running into it');
  value(add(shift(THURSDAY, HOUR), 30));
  value(add(shift(THURSDAY, -0.5 * HOUR), 30));
  value(add(THURSDAY, 30, w.shukri.id));

  value(w.calls.cancelSlot(hour));
  value(add(shift(THURSDAY, 0.25 * HOUR), 30));
});

test("a host's next slot starts from the call link they used last", async () => {
  const w = await world();
  assert.equal(w.calls.lastLink(w.hazli.id), null);
  value(w.calls.add(w.hazli.id, { startsAt: THURSDAY, minutes: 30, link: 'https://meet.example/first' }));
  value(w.calls.add(w.hazli.id, { startsAt: shift(THURSDAY, HOUR), minutes: 30, link: 'https://meet.example/second' }));
  assert.equal(w.calls.lastLink(w.hazli.id), 'https://meet.example/second');
  assert.equal(w.calls.lastLink(w.shukri.id), null, 'each host starts from their own');
});

test('a member books an open slot: they and the host get the call, and it leaves the open list', async () => {
  const w = await world();
  const id = w.slot(THURSDAY);
  const { call, changed } = value(w.calls.book(w.aina.id, id, 'Pricing a retainer for a client who wants everything.'));
  assert.equal(changed, true);
  assert.equal(call.link, LINK);
  assert.deepEqual(call.host, { name: 'Hazli Johar', email: 'hazli@club.test' });
  assert.deepEqual(call.booking.member, { name: 'Aina Rahman', email: 'aina@firm.com.my' });
  assert.equal(call.booking.topic, 'Pricing a retainer for a client who wants everything.');

  assert.deepEqual(w.calls.booking(w.aina.id), call);
  assert.deepEqual(w.openIds(w.abu.id), []);
  const [hosted] = w.calls.upcoming();
  assert.equal(hosted?.state, 'booked');
  assert.deepEqual(hosted, call, 'the hosts see who booked and why');
  assert.deepEqual(value(w.calls.book(w.aina.id, id, 'Pricing a retainer for a client who wants everything.')), { call, changed: false }, 'a second press of Book changes nothing');
});

test('two members who both saw a slot open race for it: one gets it, the other is told it was taken', async () => {
  const w = await world();
  const id = w.slot(THURSDAY);
  assert.deepEqual(w.openIds(w.aina.id), [id]);
  assert.deepEqual(w.openIds(w.abu.id), [id]);

  value(w.calls.book(w.aina.id, id, 'A client who pays late, every month.'));
  assert.equal(reason(w.calls.book(w.abu.id, id, 'My first hire.')), 'taken');
  assert.equal(w.calls.booking(w.abu.id), null, 'the loser holds no call');
  assert.equal(w.calls.booking(w.aina.id)?.booking.topic, 'A client who pays late, every month.', "the winner's booking is untouched");
});

test('a member holds one call at a time: a second booking is rolled back and that slot stays open for others', async () => {
  const w = await world();
  const first = w.slot(THURSDAY);
  const second = w.slot(shift(THURSDAY, 2 * HOUR));
  value(w.calls.book(w.aina.id, first, 'Repricing.'));
  assert.equal(reason(w.calls.book(w.aina.id, second, 'Something else.')), 'one-at-a-time');
  assert.deepEqual(w.openIds(w.abu.id), [second]);
  value(w.calls.book(w.abu.id, second, 'My first hire.'));

  const friday = w.slot('2026-11-27T07:00:00Z');
  w.at(shift(THURSDAY, 10 * 60_000));
  assert.equal(w.calls.booking(w.aina.id)?.id, first, 'a call in progress is still hers');
  assert.equal(reason(w.calls.book(w.aina.id, friday, 'Next thing.')), 'one-at-a-time');
  w.at(shift(THURSDAY, 30 * 60_000));
  assert.equal(w.calls.booking(w.aina.id), null, 'once it ends, it is over');
  value(w.calls.book(w.aina.id, friday, 'Next thing.'));
});

test('booking closes two hours before the start, and nobody books a slot that is off, unknown or their own', async () => {
  const w = await world();
  const hazlis = w.slot(THURSDAY);
  const shukris = w.slot(THURSDAY, 30, w.shukri.id);
  w.at(shift(THURSDAY, -2 * HOUR - 1000));
  value(w.calls.book(w.aina.id, hazlis, 'Just in time.'));
  w.at(shift(THURSDAY, -2 * HOUR));
  assert.equal(reason(w.calls.book(w.abu.id, shukris, 'Too late.')), 'closed');
  assert.deepEqual(w.openIds(w.abu.id), []);

  w.at('2026-11-25T01:00:00Z');
  const off = w.slot('2026-11-27T07:00:00Z');
  value(w.calls.cancelSlot(off));
  assert.equal(reason(w.calls.book(w.abu.id, off, 'Hello?')), 'closed');
  assert.equal(reason(w.calls.book(w.abu.id, 9999, 'Hello?')), 'closed');
  const own = w.slot('2026-11-28T07:00:00Z');
  assert.equal(reason(w.calls.book(w.hazli.id, own, 'Talking to myself.')), 'own-slot');
});

test('a member who cancels in time gives the slot back; cancel too late and nobody else can book it', async () => {
  const w = await world();
  const early = w.slot(THURSDAY);
  const late = w.slot('2026-11-27T07:00:00Z', 30, w.shukri.id);
  value(w.calls.book(w.aina.id, early, 'Repricing.'));
  assert.equal(reason(w.calls.cancelBooking(w.abu.id, early)), 'not-booked', "nobody cancels someone else's call");
  const given = value(w.calls.cancelBooking(w.aina.id, early));
  assert.equal(given.booking.member.email, 'aina@firm.com.my', 'the call comes back for the letter to the host');
  assert.equal(w.calls.booking(w.aina.id), null);
  assert.equal(reason(w.calls.cancelBooking(w.aina.id, early)), 'not-booked');
  assert.deepEqual(w.openIds(w.abu.id), [early, late]);
  assert.equal(value(w.calls.book(w.abu.id, early, 'My first hire.')).call.booking.topic, 'My first hire.');

  value(w.calls.book(w.aina.id, late, 'Repricing, again.'));
  w.at(shift('2026-11-27T07:00:00Z', -2 * HOUR));
  value(w.calls.cancelBooking(w.aina.id, late));
  assert.deepEqual(w.openIds(w.abu.id), []);
  assert.deepEqual(w.calls.upcoming(), [], 'nobody to host, and too late to offer');
});

test('a host calls a slot off: the member who booked it comes back to be told, and the slot is gone', async () => {
  const w = await world();
  const booked = w.slot(THURSDAY);
  const empty = w.slot(shift(THURSDAY, HOUR));
  value(w.calls.book(w.aina.id, booked, 'Repricing.'));
  assert.equal(value(w.calls.cancelSlot(booked))?.booking.member.email, 'aina@firm.com.my');
  assert.equal(value(w.calls.cancelSlot(empty)), null, 'nobody had booked it, so nobody to tell');
  assert.equal(reason(w.calls.cancelSlot(booked)), 'not-upcoming');
  assert.equal(w.calls.booking(w.aina.id), null);
  assert.deepEqual(w.calls.upcoming(), []);
  value(w.calls.book(w.aina.id, w.slot('2026-11-27T07:00:00Z'), 'Repricing.'));
});

test('a reminder goes once, a day ahead, and not for a call booked within a day of it', async () => {
  const w = await world();
  const saturday = '2026-11-28T07:00:00Z';
  value(w.calls.book(w.aina.id, w.slot(saturday), 'Repricing.'));
  value(w.calls.book(w.abu.id, w.slot('2026-11-25T13:00:00Z'), 'My first hire.'));
  assert.deepEqual(w.calls.dueReminders(), [], 'the confirmation Abu just got is his reminder');

  w.at(shift(saturday, -24 * HOUR - 60_000));
  assert.deepEqual(w.calls.dueReminders(), []);
  w.at(shift(saturday, -24 * HOUR));
  assert.deepEqual(w.calls.dueReminders().map((c) => c.booking.member.name), ['Aina Rahman']);
  assert.deepEqual(w.calls.dueReminders(), [], 'a rerun of the hourly job sends nothing');
});

test("removing a member frees the slot they booked, and removing a host takes their slots off", async () => {
  const w = await world();
  const id = w.slot(THURSDAY);
  value(w.calls.book(w.aina.id, id, 'Repricing.'));
  value(w.club.removeMember(w.hazli.id, w.aina.id, SITE));
  assert.deepEqual(w.openIds(w.abu.id), [id]);
  assert.equal(value(w.calls.book(w.abu.id, id, 'My first hire.')).call.booking.topic, 'My first hire.');

  const shukris = w.slot('2026-11-27T07:00:00Z', 30, w.shukri.id);
  value(w.club.removeMember(w.hazli.id, w.shukri.id, SITE));
  assert.ok(!w.calls.upcoming().some((s) => s.id === shukris));
  assert.equal(reason(w.calls.cancelSlot(shukris)), 'not-upcoming');
});

test('the members page groups slots by their date in Malaysia', () => {
  const afternoon = { startsAt: '2026-11-26T07:00:00Z' };
  const lateEvening = { startsAt: '2026-11-26T15:30:00Z' };
  const pastMidnight = { startsAt: '2026-11-26T16:30:00Z' };
  assert.deepEqual(byDay([afternoon, lateEvening, pastMidnight]), [
    { date: '2026-11-26', slots: [afternoon, lateEvening] },
    { date: '2026-11-27', slots: [pastMidnight] },
  ]);
});

const uid = (ics: string) => /\r\nUID:([^\r]+)\r\n/.exec(ics)?.[1];

test("a call goes into each side's calendar as one event, with a UID no session and no later booking shares", async () => {
  const w = await world();
  const id = w.slot(THURSDAY);
  const first = value(w.calls.book(w.aina.id, id, 'Repricing.')).call;
  const forMember = calendarFile(callEvent(first, 'member'));
  const forHost = calendarFile(callEvent(first, 'host'));
  assert.ok(forMember.includes('\r\nSUMMARY:One-to-one with Hazli Johar\r\n'));
  assert.ok(forHost.includes('\r\nSUMMARY:One-to-one with Aina Rahman\r\n'));
  assert.match(forMember, /\r\nDTSTART:20261126T070000Z\r\nDTEND:20261126T073000Z\r\n/);
  assert.equal(uid(forMember), uid(forHost));
  assert.match(uid(forMember) ?? '', /^call-/);

  const session = { id, title: 'Clinic', kind: 'Clinics' as const, startsAt: THURSDAY, minutes: 30, link: LINK, detail: '', going: 0, attending: false };
  assert.notEqual(uid(calendarFile(sessionEvent(session))), uid(forMember));

  value(w.calls.cancelBooking(w.aina.id, id));
  w.at('2026-11-25T02:00:00Z');
  const second = value(w.calls.book(w.abu.id, id, 'My first hire.')).call;
  assert.notEqual(uid(calendarFile(callEvent(second, 'host'))), uid(forHost), "the host's cancelled event does not swallow the new booking");
});

/** A booked call from the store, with a topic that tries to be a link. */
const bookedCall = async (): Promise<Call> => {
  const w = await world();
  return value(w.calls.book(w.aina.id, w.slot(THURSDAY), 'Repricing. See https://evil.example <b>now</b>')).call;
};
const calendarOf = (letter: { attachments?: readonly { content: string }[] }) => letter.attachments?.[0]?.content ?? '';

test('booking a call writes to the member, from the host, and to the host with what they are stuck on, both with the invite', async () => {
  const call = await bookedCall();
  const [toMember, toHost, ...rest] = callLetters('booked', call, SITE);
  assert.ok(toMember && toHost);
  assert.deepEqual(rest, []);

  assert.equal(toMember.to, 'aina@firm.com.my');
  assert.equal(toMember.from, 'Hazli from The Rest Is Accountancy');
  assert.equal(toMember.subject, 'Booked: your call with Hazli on 26 Nov 2026, 3:00 pm');
  const member = await renderLetter(toMember);
  assert.ok(member.html.includes(`href="${LINK}"`), 'the member gets the link');
  assert.ok(member.html.includes('href="https://therestisaccountancy.com/members/calls"'));
  assert.ok(member.text.includes('Repricing. See https://evil.example <b>now</b>'));
  assert.ok(!member.html.includes('href="https://evil.example'), 'what they typed never becomes a link');
  assert.match(calendarOf(toMember), /METHOD:PUBLISH[\s\S]*SUMMARY:One-to-one with Hazli Johar/);

  assert.equal(toHost.to, 'hazli@club.test');
  assert.equal(toHost.from, undefined);
  assert.ok(!toHost.subject.includes('Repricing'), 'the topic stays out of the subject');
  const host = await renderLetter(toHost);
  assert.ok(host.text.includes('Aina Rahman (aina@firm.com.my)'));
  assert.ok(host.text.includes('Repricing. See https://evil.example'));
  assert.ok(host.html.includes('href="https://therestisaccountancy.com/admin/calls"'));
  assert.match(calendarOf(toHost), /METHOD:PUBLISH[\s\S]*SUMMARY:One-to-one with Aina Rahman/);
});

test('the day before, both sides are reminded, with the link and no attachment', async () => {
  const call = await bookedCall();
  const letters = callLetters('reminder', call, SITE);
  assert.deepEqual(letters.map((l) => l.to), ['aina@firm.com.my', 'hazli@club.test']);
  for (const letter of letters) {
    assert.equal(letter.attachments, undefined);
    assert.ok((await renderLetter(letter)).html.includes(`href="${LINK}"`));
  }
  assert.ok((await renderLetter(letters[1] ?? assert.fail('no host reminder'))).text.includes('Repricing.'), 'the host is reminded what it is about');
});

test('a member cancelling tells only the host, and takes the call out of their calendar', async () => {
  const call = await bookedCall();
  const [letter, ...rest] = callLetters('cancelled-by-member', call, SITE);
  assert.ok(letter);
  assert.deepEqual(rest, []);
  assert.equal(letter.to, 'hazli@club.test');
  assert.ok((await renderLetter(letter)).text.includes("Aina Rahman can't make your call on 26 Nov 2026, 3:00 pm"));
  assert.match(calendarOf(letter), /METHOD:CANCEL[\s\S]*STATUS:CANCELLED/);
});

test('a host cancelling tells only the member, from the host, and points them at another time', async () => {
  const call = await bookedCall();
  const [letter, ...rest] = callLetters('cancelled-by-host', call, SITE);
  assert.ok(letter);
  assert.deepEqual(rest, []);
  assert.equal(letter.to, 'aina@firm.com.my');
  assert.equal(letter.from, 'Hazli from The Rest Is Accountancy');
  const { html, text } = await renderLetter(letter);
  assert.ok(text.includes('your call with Hazli Johar on 26 Nov 2026, 3:00 pm'));
  assert.ok(html.includes('href="https://therestisaccountancy.com/members/calls"'));
  assert.ok(!html.includes(`href="${LINK}"`), 'no link to a call that is off');
  assert.match(calendarOf(letter), /METHOD:CANCEL[\s\S]*STATUS:CANCELLED/);
});

test('a host who is suspended or loses the admin role takes their slots off the list, booked ones included', async () => {
  const w = await world();
  const booked = w.slot(THURSDAY);
  const open = w.slot(shift(THURSDAY, 2 * HOUR));
  value(w.calls.book(w.aina.id, booked, 'Pricing a messy client.'));
  assert.deepEqual(w.openIds(w.abu.id), [open]);

  value(w.club.suspendMember(w.shukri.id, w.hazli.id, SITE));
  assert.deepEqual(w.openIds(w.abu.id), [], 'nothing left to book with a suspended host');
  assert.equal(w.calls.booking(w.aina.id), null, 'the booked call is off');
  assert.equal(reason(w.calls.book(w.abu.id, open, 'Anything.')), 'closed');

  value(w.club.reinstateMember(w.hazli.id));
  value(w.club.updateMember(w.shukri.id, w.hazli.id, { name: 'Hazli Johar', email: 'hazli@club.test', role: 'member' }, SITE));
  assert.deepEqual(w.openIds(w.abu.id), [], 'nor with a host who is no longer an admin');
});

test('slots a host lost stay off when the host is reinstated or made an admin again', async () => {
  const suspended = await world();
  const booked = suspended.slot(THURSDAY);
  suspended.slot(shift(THURSDAY, 2 * HOUR));
  value(suspended.calls.book(suspended.aina.id, booked, 'Pricing a messy client.'));
  value(suspended.club.suspendMember(suspended.shukri.id, suspended.hazli.id, SITE));
  value(suspended.club.reinstateMember(suspended.hazli.id));
  assert.equal(suspended.calls.booking(suspended.aina.id), null, 'the member was told the call is off');
  assert.deepEqual(suspended.openIds(suspended.abu.id), []);
  assert.deepEqual(suspended.calls.upcoming(), []);

  const demoted = await world();
  const host = { name: 'Hazli Johar', email: 'hazli@club.test' };
  value(demoted.calls.book(demoted.aina.id, demoted.slot(THURSDAY), 'Pricing a messy client.'));
  value(demoted.club.updateMember(demoted.shukri.id, demoted.hazli.id, { ...host, role: 'member' }, SITE));
  value(demoted.club.updateMember(demoted.shukri.id, demoted.hazli.id, { ...host, role: 'admin' }, SITE));
  assert.equal(demoted.calls.booking(demoted.aina.id), null);
  assert.deepEqual(demoted.calls.upcoming(), []);
});

const letters = (change: { letters: readonly Letter[] }) => change.letters.map((l) => [l.to, l.subject]);

const twoBooked = async () => {
  const w = await world();
  value(w.calls.book(w.aina.id, w.slot(THURSDAY), 'Pricing.'));
  value(w.calls.book(w.abu.id, w.slot(shift(THURSDAY, DAY)), 'Hiring.'));
  w.slot(shift(THURSDAY, 2 * HOUR));
  return w;
};
const DAY = 24 * HOUR;
const calledOff = [
  ['aina@firm.com.my', 'Cancelled: your call with Hazli on 26 Nov 2026, 3:00 pm'],
  ['abu@firm.com.my', 'Cancelled: your call with Hazli on 27 Nov 2026, 3:00 pm'],
];

test('suspending or removing a host calls off their booked calls and tells each member who booked one', async () => {
  const suspended = await twoBooked();
  assert.deepEqual(letters(value(suspended.club.suspendMember(suspended.shukri.id, suspended.hazli.id, SITE))), calledOff);
  assert.equal(suspended.calls.booking(suspended.aina.id), null);

  const removed = await twoBooked();
  assert.deepEqual(letters(value(removed.club.removeMember(removed.shukri.id, removed.hazli.id, SITE))), calledOff);
  assert.equal(removed.calls.booking(removed.abu.id), null);
});

test('demoting a host tells their members by the name they booked with; a rename alone tells nobody', async () => {
  const renamed = await twoBooked();
  const kept = value(renamed.club.updateMember(renamed.shukri.id, renamed.hazli.id, { name: 'Harun Johar', email: 'hazli@club.test' }, SITE));
  assert.deepEqual(letters(kept), []);
  assert.equal(renamed.calls.booking(renamed.aina.id)?.host.name, 'Harun Johar', 'the call stays booked');

  const demoted = await twoBooked();
  const demotion = demoted.club.updateMember(demoted.shukri.id, demoted.hazli.id, { name: 'Harun Johar', email: 'harun@club.test', role: 'member' }, SITE);
  assert.deepEqual(letters(value(demotion)), calledOff);
});

test('a refused change to a host, or a change to someone who hosts nothing, tells nobody', async () => {
  const w = await twoBooked();
  assert.equal(reason(w.club.suspendMember(w.hazli.id, w.hazli.id, SITE)), 'self');
  assert.equal(w.calls.booking(w.aina.id)?.host.name, 'Hazli Johar', 'the call is still on');

  assert.deepEqual(letters(value(w.club.removeMember(w.hazli.id, w.aina.id, SITE))), []);
  assert.deepEqual(letters(value(w.club.suspendMember(w.hazli.id, w.shukri.id, SITE))), [], 'a host with nothing booked');
});
