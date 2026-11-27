import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { SESSION_KINDS } from '../../../src/data/sessions.ts';
import { formatMoment, listOf } from '../../../src/lib/format.ts';
import { sessionLetters } from '../../../src/server/letters.ts';
import { id, malaysiaTime } from '../lib/fields.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { absolute } from '../lib/mail.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';
import { malaysiaToday } from './admin.server.ts';

/** The sessions on the calendar, with who is coming to each. */
export const adminSessions = createServerFn({ method: 'GET' }).handler(async () => {
  await admit('admin', toClub);
  const rolls = await withStore(async (store) => await store.schedule.rolls());
  const sessions = rolls.map(({ session: s, attendees }) => ({
    id: s.id,
    title: s.title,
    when: `${formatMoment(s.startsAt)} · ${s.minutes} min · ${s.kind}`,
    coming: s.going === 0 ? 'Nobody coming yet.' : `Coming: ${listOf(attendees.map((m) => m.name))}.`,
  }));
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
  .handler(
    action({ access: 'admin', input: newSession }, async ({ input, store }) => {
      const { date, time, ...session } = input;
      const startsAt = malaysiaTime(date, time);
      if (!startsAt) return refused('That date or time does not exist.');
      const added = await store.schedule.add({ ...session, startsAt });
      return added.ok ? done(null) : refused('That time has passed. Pick one ahead.');
    }),
  );

const sessionInput = z.object({ session: id });

/** Calls a session off and emails everyone who said they were coming. Answers how many were told. */
export const cancelSession = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof sessionInput>) => input)
  .handler(
    action({ access: 'admin', input: sessionInput }, async ({ input, store, send }) => {
      const roll = await store.schedule.cancel(input.session);
      if (!roll) return refused('That session is already over or called off.');
      send(sessionLetters('cancelled', roll.session, roll.attendees, absolute('/')));
      return done(roll.attendees.length);
    }),
  );
