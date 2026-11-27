import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { byDay, callLetters, TOPIC_MAX, type BookRefusal } from '../../../src/server/calls.ts';
import { numberId, oneLine } from '../lib/fields.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { absolute } from '../lib/mail.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

const bookRefusals: Record<BookRefusal, string> = {
  closed: 'That time is no longer open. Pick another one.',
  taken: 'Someone booked that time a moment before you. Pick another one.',
  'own-slot': 'That is your own slot, so there is nobody to book it with.',
  'one-at-a-time': 'You already have a call booked. Cancel it first, then pick another time.',
};

/** The member's own call, if they hold one, and the open times by day. Open times never carry the call link. */
export const membersCalls = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await admit('paid', toClub);
  return withStore(async (store) => {
    const call = await store.calls.booking(member.id);
    const open = (await store.calls.open(member.id)).map(({ id, startsAt, minutes, host }) => ({ id, startsAt, minutes, host }));
    return {
      email: member.email,
      topicMax: TOPIC_MAX,
      mine: call && { id: call.id, startsAt: call.startsAt, minutes: call.minutes, link: call.link, host: call.host.name, topic: call.booking.topic },
      days: byDay(open).map(({ date, slots }) => ({ date, slots: [...slots] })),
    };
  });
});

const bookInput = z.object({
  slot: z.coerce.number({ message: 'Pick a time.' }).int().positive('Pick a time.'),
  topic: z
    .string()
    .transform(oneLine)
    .pipe(z.string().min(1, 'Say what you are stuck on, in a sentence or two.').max(TOPIC_MAX, `Keep it to ${TOPIC_MAX} characters.`)),
});

export const bookCall = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof bookInput>) => input)
  .handler(
    action({ access: 'paid', input: bookInput, limit: 'call', refusals: bookRefusals }, async ({ actor, input, store, send }) => {
      const booked = await store.calls.book(actor.id, input.slot, input.topic);
      if (!booked.ok) return booked;
      if (booked.value.changed) send(callLetters('booked', booked.value.call, absolute('/')));
      return done({ id: booked.value.call.id });
    }),
  );

const cancelInput = z.object({ slot: numberId });

export const cancelCall = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof cancelInput>) => input)
  .handler(
    action({ access: 'member', input: cancelInput, limit: 'call' }, async ({ actor, input, store, send }) => {
      const cancelled = await store.calls.cancelBooking(actor.id, input.slot);
      if (!cancelled.ok) return refused('You have no call booked at that time.');
      send(callLetters('cancelled-by-member', cancelled.value, absolute('/')));
      return done({ id: cancelled.value.id });
    }),
  );
