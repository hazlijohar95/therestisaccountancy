import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { renewsIn } from '../../../src/lib/ticks.ts';
import type { CosignRefusal } from '../../../src/server/social-casebook.ts';
import { numberId } from '../lib/fields.ts';
import { action } from '../lib/action.server.ts';
import { done } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

const cosignRefusals: Record<CosignRefusal, string> = {
  'not-found': 'That request is gone. Its author may have removed the entry.',
  already: 'You already answered that request.',
  'no-seal': 'Co-signing needs the seal. Get ticked, then co-sign.',
};

/**
 * The notifications page, read and then marked read in one call. What needs the member comes from what is true now;
 * the list says what happened. Null when signed out.
 */
export const openNotifications = createServerFn({ method: 'POST' }).handler(async () => {
  const member = await currentMember();
  if (!member) return null;
  const now = new Date();
  return withStore(async (store) => {
    const requests = await store.socialCasebook.requests(member.id);
    const mine = await store.socialClaims.mine(member.id);
    const due = mine.claims.flatMap((claim) => {
      const days = renewsIn(claim, now);
      return days === null || !claim.until ? [] : [{ id: claim.id, source: claim.source, label: claim.label, kind: claim.kind, until: claim.until, days }];
    });
    const notices = await store.socialNotifications.open(member.id);
    return {
      requests: requests.map(({ entry, author }) => ({
        entry: { id: entry.id, service: entry.service, industry: entry.industry, band: entry.band, framework: entry.framework, year: entry.year, role: entry.role, areas: entry.areas, note: entry.note, createdAt: entry.createdAt },
        author,
      })),
      due,
      /* Requests and renewals still waiting show above, under Needs you, not twice. */
      activity: notices.filter((n) => !((n.kind === 'cosign-request' || n.kind === 'renewal') && n.live)),
    };
  });
});

/** The co-signer named on an entry signs it or declines, once. */
export const decideCosign = createServerFn({ method: 'POST' })
  .validator((input: { entry: number; outcome: 'signed' | 'declined' }) => input)
  .handler(
    action({ access: 'member', input: z.object({ entry: numberId, outcome: z.enum(['signed', 'declined']) }), refusals: cosignRefusals }, async ({ actor, input, store }) => {
      const { entry, outcome } = input;
      const result = await store.socialCasebook.decide(actor.id, entry, outcome);
      return result.ok ? done({ outcome: result.value.outcome }) : result;
    }),
  );
