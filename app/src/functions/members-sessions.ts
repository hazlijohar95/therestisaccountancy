import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { sessionLetters } from '../../../src/server/letters.ts';
import { allRecordings } from '../lib/content.server.ts';
import { numberId } from '../lib/fields.ts';
import { paidOrRefusal } from '../lib/guards.server.ts';
import { absolute, sendLater } from '../lib/mail.server.ts';
import { paidMemberOrRedirect } from '../lib/members.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

/** The sessions coming up, as this member sees them, and the recordings of those gone, newest first. */
export const membersSessions = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await paidMemberOrRedirect();
  const upcoming = await withStore(async (store) => store.schedule.upcoming(member.id));
  const recordings = allRecordings().map((r) => ({ id: r.id, title: r.data.title, kind: r.data.kind, url: r.data.url, date: r.data.date.toISOString() }));
  return { upcoming, recordings };
});

const rsvpInput = z.object({ session: numberId, going: z.boolean() });

/** Says the member is coming, or no longer is. Saying yes emails them the calendar file. */
export const rsvp = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof rsvpInput>) => input)
  .handler(async ({ data }): Promise<Outcome<{ going: boolean }>> => {
    const input = parsed(rsvpInput, data);
    if (!input.ok) return input;
    const member = await paidOrRefusal();
    if (!member.ok) return member;
    const result = await withStore(async (store) => store.schedule.rsvp(member.value.id, input.value.session, input.value.going));
    if (!result) return refused('That session is over or was called off.');
    if (result.changed && result.session.attending) sendLater(sessionLetters('confirmed', result.session, [member.value], absolute('/')));
    return done({ going: result.session.attending });
  });
