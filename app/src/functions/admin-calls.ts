import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { formatMoment } from '../../../src/lib/format.ts';
import { CALL_MINUTES, callLetters, type AddRefusal } from '../../../src/server/calls.ts';
import { id, malaysiaTime } from '../lib/fields.ts';
import { adminOrRefusal } from '../lib/guards.server.ts';
import { absolute, sendLater } from '../lib/mail.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';
import { adminOrRedirect, malaysiaToday } from './admin.server.ts';

const addRefusals: Record<AddRefusal, string> = {
  'too-soon': 'Booking closes two hours before a call, so the slot has to start later than that.',
  overlaps: 'You already have a slot at that time. Pick one that does not overlap it.',
};

/** The one-to-one slots still to come, open or booked, and the link this admin used last. */
export const adminCalls = createServerFn({ method: 'GET' }).handler(async () => {
  const me = await adminOrRedirect();
  const { upcoming, lastLink } = await withStore(async (store) => ({ upcoming: await store.calls.upcoming(), lastLink: await store.calls.lastLink(me.id) }));
  return {
    slots: upcoming.map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      when: formatMoment(s.startsAt),
      minutes: s.minutes,
      host: s.host.name,
      link: s.link,
      booking: s.state === 'booked' ? { name: s.booking.member.name, email: s.booking.member.email, topic: s.booking.topic, bookedAt: formatMoment(s.booking.bookedAt) } : null,
    })),
    lastLink: lastLink ?? '',
    today: malaysiaToday(),
    minutes: CALL_MINUTES,
  };
});

const newSlot = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time.'),
  minutes: z.coerce.number().int().min(CALL_MINUTES.min, `At least ${CALL_MINUTES.min} minutes.`).max(CALL_MINUTES.max, `At most ${CALL_MINUTES.max} minutes.`),
  link: z.url({ protocol: /^https$/, message: 'Paste the https link to the call.' }),
});

export type SlotForm = Readonly<Record<'date' | 'time' | 'minutes' | 'link', string>>;

export const openSlot = createServerFn({ method: 'POST' })
  .validator((input: SlotForm) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const admin = await adminOrRefusal();
    if (!admin.ok) return admin;
    const input = await parsed(newSlot, data);
    if (!input.ok) return input;
    const { date, time, minutes, link } = input.value;
    const startsAt = malaysiaTime(date, time);
    if (!startsAt) return refused('That date or time does not exist.');
    const added = await withStore(async (store) => await store.calls.add(admin.value.id, { startsAt, minutes, link }));
    return added.ok ? done(null) : refused(addRefusals[added.reason]);
  });

const slotInput = z.object({ slot: id });

/** Cancels a slot. Whoever booked it is emailed; the answer is their name, or null when nobody had. */
export const cancelSlot = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof slotInput>) => input)
  .handler(async ({ data }): Promise<Outcome<string | null>> => {
    const admin = await adminOrRefusal();
    if (!admin.ok) return admin;
    const input = await parsed(slotInput, data);
    if (!input.ok) return input;
    const result = await withStore(async (store) => await store.calls.cancelSlot(input.value.slot));
    if (!result.ok) return refused('That slot is already over or cancelled.');
    const call = result.value;
    if (call) sendLater(callLetters('cancelled-by-host', call, absolute('/')));
    return done(call ? call.booking.member.name : null);
  });
