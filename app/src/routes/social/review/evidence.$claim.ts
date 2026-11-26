import { createFileRoute } from '@tanstack/react-router';
import { evidenceDownload } from '../../../../../src/server/evidence.ts';
import { currentMember } from '../../../lib/session.server.ts';
import { withStore } from '../../../lib/store.server.ts';

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

/** A claim's document, for the team only. Anyone else, and any claim already decided, gets a plain 404. */
export const Route = createFileRoute('/social/review/evidence/$claim')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const member = await currentMember();
        if (member?.role !== 'admin') return notFound();
        const claimId = Number(params.claim);
        if (!Number.isSafeInteger(claimId) || claimId <= 0) return notFound();
        const key = await withStore(async (store) => await store.socialClaims.evidenceKey(claimId));
        return (key && (await evidenceDownload(key, `claim-${claimId}`))) || notFound();
      },
    },
  },
});
