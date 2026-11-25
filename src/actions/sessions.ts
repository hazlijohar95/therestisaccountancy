import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { SESSION_KINDS } from '../data/sessions.ts';
import { sessionLetters } from '../server/letters.ts';
import { absolute, admin, id, paidMember, sendLater } from './guards.ts';

/** Malaysia keeps UTC+8 all year, so a local date and time map to one instant. */
export const malaysiaTime = (date: string, time: string): string => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const [hh = 0, mm = 0] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm)).toISOString().replace(/\.\d{3}Z$/, 'Z');
};

export const sessions = {
  rsvp: defineAction({
    accept: 'form',
    input: z.object({ session: id, going: z.enum(['true', 'false']) }),
    handler: async (input, context) => {
      const member = await paidMember(context.locals);
      const result = await context.locals.schedule.rsvp(member.id, input.session, input.going === 'true');
      if (!result) throw new ActionError({ code: 'NOT_FOUND', message: 'That session is over or was called off.' });
      if (result.changed && result.session.attending) sendLater(context, sessionLetters('confirmed', result.session, [member], absolute(context, '/')));
      return { going: result.session.attending };
    },
  }),

  addSession: defineAction({
    accept: 'form',
    input: z.object({
      title: z.string().trim().min(3, 'Give the session a title.').max(120, 'Keep the title under 120 characters.'),
      kind: z.enum(SESSION_KINDS),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
      time: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time.'),
      minutes: z.coerce.number().int().min(15, 'At least 15 minutes.').max(480, 'At most 8 hours.'),
      link: z.url({ protocol: /^https$/, message: 'Paste the https link to the call.' }),
      detail: z.string().trim().max(1000, 'Keep it under 1,000 characters.').default(''),
    }),
    handler: async ({ date, time, ...input }, context) => {
      admin(context.locals);
      const startsAt = malaysiaTime(date, time);
      if (new Date(startsAt).getTime() <= Date.now()) throw new ActionError({ code: 'BAD_REQUEST', message: 'That time has passed. Pick one ahead.' });
      return { id: await context.locals.schedule.add({ ...input, startsAt }) };
    },
  }),

  cancelSession: defineAction({
    accept: 'form',
    input: z.object({ session: id }),
    handler: async (input, context) => {
      admin(context.locals);
      const roll = await context.locals.schedule.cancel(input.session);
      if (!roll) throw new ActionError({ code: 'NOT_FOUND', message: 'That session is already over or called off.' });
      sendLater(context, sessionLetters('cancelled', roll.session, roll.attendees, absolute(context, '/')));
      return { told: roll.attendees.length };
    },
  }),
};
