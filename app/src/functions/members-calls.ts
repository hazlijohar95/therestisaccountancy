import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { byDay, callLetters, TOPIC_MAX, type BookRefusal } from '../../../src/server/calls.ts';
import { memberOrRefusal, paidOrRefusal } from '../lib/guards.server.ts';
import { allowed, tooManyTries } from '../lib/limits.server.ts';
import { absolute, sendLater } from '../lib/mail.server.ts';
import { paidMemberOrRedirect } from '../lib/members.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

const bookRefusals: Record<BookRefusal, string> = {
  closed: 'That time is no longer open. Pick another one.',
  taken: 'Someone booked that time a moment before you. Pick another one.',
  'own-slot': 'That is your own slot, so there is nobody to book it with.',
  'one-at-a-time': 'You already have a call booked. Cancel it first, then pick another time.',
};

/** The member's own call, if they hold one, and the open times by day. Open times never carry the call link. */
export const membersCalls = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await paidMemberOrRedirect();
  return withStore(async (store) => {
    const call = await store.calls.booking(member.id);
    const open = (await store.calls.open(member.id)).map(({ id, startsAt, minutes, host }) => ({ id, startsAt, minutes, host }));
    return {
      email: member.email,
      mine: call && { id: call.id, startsAt: call.startsAt, minutes: call.minutes, link: call.link, host: call.host.name, topic: call.booking.topic },
      days: byDay(open).map(({ date, slots }) => ({ date, slots: [...slots] })),
    };
  });
});

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

const bookInput = z.object({
  slot: z.coerce.number({ message: 'Pick a time.' }).int().positive('Pick a time.'),
  topic: z
    .string()
    .transform(oneLine)
    .pipe(z.string().min(1, 'Say what you are stuck on, in a sentence or two.').max(TOPIC_MAX, `Keep it to ${TOPIC_MAX} characters.`)),
});

export const bookCall = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof bookInput>) => input)
  .handler(async ({ data }): Promise<Outcome<{ id: number }>> => {
    const input = parsed(bookInput, data);
    if (!input.ok) return input;
    const member = await paidOrRefusal();
    if (!member.ok) return member;
    if (!(await allowed('call'))) return refused(tooManyTries);
    const booked = await withStore(async (store) => store.calls.book(member.value.id, input.value.slot, input.value.topic));
    if (!booked.ok) return refused(bookRefusals[booked.reason]);
    if (booked.value.changed) sendLater(callLetters('booked', booked.value.call, absolute('/')));
    return done({ id: booked.value.call.id });
  });

const cancelInput = z.object({ slot: z.number().int().positive() });

export const cancelCall = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof cancelInput>) => input)
  .handler(async ({ data }): Promise<Outcome<{ id: number }>> => {
    const input = parsed(cancelInput, data);
    if (!input.ok) return input;
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    if (!(await allowed('call'))) return refused(tooManyTries);
    const cancelled = await withStore(async (store) => store.calls.cancelBooking(member.value.id, input.value.slot));
    if (!cancelled.ok) return refused('You have no call booked at that time.');
    sendLater(callLetters('cancelled-by-member', cancelled.value, absolute('/')));
    return done({ id: cancelled.value.id });
  });
