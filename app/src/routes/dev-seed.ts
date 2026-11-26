import { createFileRoute } from '@tanstack/react-router';
import { startSession } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * Local only: a team admin and three Social members with a known password, two of them
 * ticked, to sign in with locally. Safe to rerun.
 */
const PASSWORD = 'local test password 1';
const MEMBERS = [
  { name: 'Test Member A', email: 'a@local.test', handle: 'member_a', ticked: true },
  { name: 'Test Member B', email: 'b@local.test', handle: 'member_b', ticked: true },
  { name: 'Test Member C', email: 'c@local.test', handle: 'member_c', ticked: false },
] as const;

export const Route = createFileRoute('/dev-seed')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        /* Built in only with VITE_LOCAL_SEED=on, and answers only on the machine's own address. */
        const local = ['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname);
        if (import.meta.env['VITE_LOCAL_SEED'] !== 'on' || !local) return new Response('Not found', { status: 404 });
        await withStore(async (store) => {
          const host = await store.club.ensureAdmin({ email: 'team@local.test', name: 'Team Reviewer', password: PASSWORD });
          if (!(await store.socialProfiles.ownProfile(host.id))) await store.socialProfiles.claimHandle(host.id, 'team');
          for (const person of MEMBERS) {
            const joined = await store.socialProfiles.signUp({ name: person.name, email: person.email, handle: person.handle }, { via: 'team' });
            if (!joined.ok) continue;
            const link = await store.club.newLink(joined.value.memberId);
            if (link.ok) await store.club.setPasswordFromLink(link.value.token, PASSWORD);
            if (!person.ticked) continue;
            const account = await store.socialClaims.addAccount(joined.value.memberId, 'LinkedIn', person.handle.replace('_', '-'));
            if (account.ok) await store.socialClaims.decideAccount(account.value.id, host.id, { verdict: 'approve' });
            const claim = await store.socialClaims.addClaim(joined.value.memberId, { kind: 'body', bodyId: 'acca', status: 'Member', reference: '1', otherName: null, evidenceKey: null });
            if (claim.ok) await store.socialClaims.decideClaim(claim.value.id, host.id, { verdict: 'approve' });
          }
        });
        const as = new URL(request.url).searchParams.get('as');
        if (as) {
          const key = await withStore(async (store) => {
            const access = await store.club.authenticate(as, PASSWORD);
            return access.ok ? access.value.key : null;
          });
          if (!key) return new Response(`No seeded account ${as}`, { status: 404 });
          await startSession(key);
        }
        return Response.json({ password: PASSWORD, accounts: ['team@local.test', ...MEMBERS.map((m) => m.email)], signedIn: as });
      },
    },
  },
});
