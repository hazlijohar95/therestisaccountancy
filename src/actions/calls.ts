import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { CALL_MINUTES, TOPIC_MAX, callLetters, type AddRefusal, type BookRefusal } from '../server/calls.ts';
import { absolute, admin, id, oneLine, paidMember, sendLater, settle, signedIn, type Refusal } from './guards.ts';
import { malaysiaTime } from './sessions.ts';

const bookRefusals: Record<BookRefusal, Refusal> = {
  closed: { code: 'NOT_FOUND', message: 'That time is no longer open. Pick another one.' },
  taken: { code: 'CONFLICT', message: 'Someone booked that time a moment before you. Pick another one.' },
  'own-slot': { code: 'BAD_REQUEST', message: 'That is your own slot, so there is nobody to book it with.' },
  'one-at-a-time': { code: 'CONFLICT', message: 'You already have a call booked. Cancel it first, then pick another time.' },
};

const addRefusals: Record<AddRefusal, Refusal> = {
  'too-soon': { code: 'BAD_REQUEST', message: 'Booking closes two hours before a call, so the slot has to start later than that.' },
  overlaps: { code: 'CONFLICT', message: 'You already have a slot at that time. Pick one that does not overlap it.' },
};

export const calls = {
  bookCall: defineAction({
    accept: 'form',
    input: z.object({
      slot: z.coerce.number({ message: 'Pick a time.' }).int().positive('Pick a time.'),
      topic: z
        .string()
        .transform(oneLine)
        .pipe(z.string().min(1, 'Say what you are stuck on, in a sentence or two.').max(TOPIC_MAX, `Keep it to ${TOPIC_MAX} characters.`)),
    }),
    handler: async (input, context) => {
      const member = await paidMember(context.locals);
      const { call, changed } = settle(await context.locals.calls.book(member.id, input.slot, input.topic), bookRefusals);
      if (changed) sendLater(context, callLetters('booked', call, absolute(context, '/')));
      return { id: call.id };
    },
  }),

  cancelCall: defineAction({
    accept: 'form',
    input: z.object({ slot: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const call = settle(await context.locals.calls.cancelBooking(member.id, input.slot), {
        'not-booked': { code: 'NOT_FOUND', message: 'You have no call booked at that time.' },
      });
      sendLater(context, callLetters('cancelled-by-member', call, absolute(context, '/')));
      return { id: call.id };
    },
  }),

  openSlot: defineAction({
    accept: 'form',
    input: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
      time: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time.'),
      minutes: z.coerce
        .number()
        .int()
        .min(CALL_MINUTES.min, `At least ${CALL_MINUTES.min} minutes.`)
        .max(CALL_MINUTES.max, `At most ${CALL_MINUTES.max} minutes.`),
      link: z.url({ protocol: /^https$/, message: 'Paste the https link to the call.' }),
    }),
    handler: async ({ date, time, minutes, link }, context) => {
      const host = admin(context.locals);
      const startsAt = malaysiaTime(date, time);
      if (!startsAt) throw new ActionError({ code: 'BAD_REQUEST', message: 'That date or time does not exist.' });
      return { id: settle(await context.locals.calls.add(host.id, { startsAt, minutes, link }), addRefusals) };
    },
  }),

  cancelSlot: defineAction({
    accept: 'form',
    input: z.object({ slot: id }),
    handler: async (input, context) => {
      admin(context.locals);
      const call = settle(await context.locals.calls.cancelSlot(input.slot), {
        'not-upcoming': { code: 'NOT_FOUND', message: 'That slot is already over or cancelled.' },
      });
      if (call) sendLater(context, callLetters('cancelled-by-host', call, absolute(context, '/')));
      return { told: call ? call.booking.member.name : null };
    },
  }),
};
