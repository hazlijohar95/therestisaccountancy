import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { SESSION_KINDS } from '../../../src/data/sessions.ts';
import { formatMoment, listOf } from '../../../src/lib/format.ts';
import { sessionLetters } from '../../../src/server/letters.ts';
import { id, malaysiaTime } from '../lib/fields.ts';
import { adminOrRefusal } from '../lib/guards.server.ts';
import { absolute, sendLater } from '../lib/mail.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';
import { adminOrRedirect, malaysiaToday } from './admin.server.ts';

/** The sessions on the calendar, with who is coming to each. */
export const adminSessions = createServerFn({ method: 'GET' }).handler(async () => {
  await adminOrRedirect();
  const sessions = await withStore(async (store) => {
    const upcoming = await store.schedule.upcoming(null);
    const listed = [];
    for (const s of upcoming) {
      const names = (await store.schedule.attendees(s.id)).map((m) => m.name);
      listed.push({ id: s.id, title: s.title, when: `${formatMoment(s.startsAt)} · ${s.minutes} min · ${s.kind}`, coming: s.going === 0 ? 'Nobody coming yet.' : `Coming: ${listOf(names)}.` });
    }
    return listed;
  });
  return { sessions, today: malaysiaToday(), kinds: SESSION_KINDS };
});

const newSession = z.object({
  title: z.string().trim().min(3, 'Give the session a title.').max(120, 'Keep the title under 120 characters.'),
  kind: z.enum(SESSION_KINDS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time.'),
  minutes: z.coerce.number().int().min(15, 'At least 15 minutes.').max(480, 'At most 8 hours.'),
  link: z.url({ protocol: /^https$/, message: 'Paste the https link to the call.' }),
  detail: z.string().trim().max(1000, 'Keep it under 1,000 characters.').default(''),
});

export type SessionForm = Readonly<Record<'title' | 'kind' | 'date' | 'time' | 'minutes' | 'link' | 'detail', string>>;

export const addSession = createServerFn({ method: 'POST' })
  .validator((input: SessionForm) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const admin = await adminOrRefusal();
    if (!admin.ok) return admin;
    const input = parsed(newSession, data);
    if (!input.ok) return input;
    const { date, time, ...session } = input.value;
    const startsAt = malaysiaTime(date, time);
    if (!startsAt) return refused('That date or time does not exist.');
    if (new Date(startsAt).getTime() <= Date.now()) return refused('That time has passed. Pick one ahead.');
    await withStore(async (store) => await store.schedule.add({ ...session, startsAt }));
    return done(null);
  });

const sessionInput = z.object({ session: id });

/** Calls a session off and emails everyone who said they were coming. Answers how many were told. */
export const cancelSession = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof sessionInput>) => input)
  .handler(async ({ data }): Promise<Outcome<number>> => {
    const admin = await adminOrRefusal();
    if (!admin.ok) return admin;
    const input = parsed(sessionInput, data);
    if (!input.ok) return input;
    const roll = await withStore(async (store) => await store.schedule.cancel(input.value.session));
    if (!roll) return refused('That session is already over or called off.');
    sendLater(sessionLetters('cancelled', roll.session, roll.attendees, absolute('/')));
    return done(roll.attendees.length);
  });
