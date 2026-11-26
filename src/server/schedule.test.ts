import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClub } from './club.ts';
import { openDatabase } from './node-db.ts';
import { createSchedule } from './schedule.ts';

const PASSWORD = 'correct horse battery';
const session = (title: string, startsAt: string) => ({ title, kind: 'Clinics' as const, startsAt, minutes: 60, link: 'https://meet.example/room', detail: '' });

test('the admin sees each session still to come with the active members coming to it, in the order they said so; a suspended member still counts as going', async () => {
  const db = openDatabase(':memory:');
  const now = () => new Date('2026-11-26T02:00:00Z');
  const club = createClub(db, now);
  const schedule = createSchedule(db, now);
  const admin = await club.ensureAdmin({ email: 'admin@club.test', name: 'Admin', password: PASSWORD });
  const aina = await club.ensureAdmin({ email: 'aina@firm.my', name: 'Aina', password: PASSWORD });
  const abu = await club.ensureAdmin({ email: 'abu@firm.my', name: 'Abu', password: PASSWORD });
  const later = schedule.add(session('Year-end close', '2026-12-03T07:00:00Z'));
  const sooner = schedule.add(session('Pricing clinic', '2026-11-27T07:00:00Z'));
  const onlyAbu = schedule.add(session('Audit clinic', '2026-12-10T07:00:00Z'));
  const empty = schedule.add(session('Empty room', '2026-12-17T07:00:00Z'));
  schedule.add(session('Already over', '2026-11-20T07:00:00Z'));
  schedule.rsvp(abu.id, sooner, true);
  schedule.rsvp(aina.id, sooner, true);
  schedule.rsvp(aina.id, later, true);
  schedule.rsvp(abu.id, later, true);
  schedule.rsvp(abu.id, onlyAbu, true);
  club.suspendMember(admin.id, abu.id);

  const listed = schedule.upcoming(null).map((s) => ({ id: s.id, title: s.title, going: s.going, names: schedule.attendees(s.id).map((m) => m.name) }));
  assert.deepEqual(listed, [
    { id: sooner, title: 'Pricing clinic', going: 2, names: ['Aina'] },
    { id: later, title: 'Year-end close', going: 2, names: ['Aina'] },
    { id: onlyAbu, title: 'Audit clinic', going: 1, names: [] },
    { id: empty, title: 'Empty room', going: 0, names: [] },
  ]);
});
