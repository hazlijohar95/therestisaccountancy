import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { sessionLetters } from '../../../src/server/letters.ts';
import { allRecordings } from '../lib/content.server.ts';
import { numberId } from '../lib/fields.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { absolute } from '../lib/mail.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';

/** The sessions coming up, as this member sees them, and the recordings of those gone, newest first. */
export const membersSessions = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await admit('paid', toClub);
  const upcoming = await withStore(async (store) => store.schedule.upcoming(member.id));
  const recordings = allRecordings().map((r) => ({ id: r.id, title: r.data.title, kind: r.data.kind, url: r.data.url, date: r.data.date.toISOString() }));
  return { upcoming, recordings };
});

const rsvpInput = z.object({ session: numberId, going: z.boolean() });

/** Says the member is coming, or no longer is. Saying yes emails them the calendar file. */
export const rsvp = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof rsvpInput>) => input)
  .handler(
    action({ access: 'paid', input: rsvpInput }, async ({ actor, input, store, send }) => {
      const result = await store.schedule.rsvp(actor.id, input.session, input.going);
      if (!result) return refused('That session is over or was called off.');
      if (result.changed && result.session.attending) send(sessionLetters('confirmed', result.session, [actor], absolute('/')));
      return done({ going: result.session.attending });
    }),
  );
