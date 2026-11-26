import { createFileRoute } from '@tanstack/react-router';
import { isLocalHost } from '../lib/local.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * Local only, after /dev-seed: something in each of the team's queues that only other pages fill. Two nominations,
 * a post and a profile reported, and two requests to join, one from someone already on Social. Safe to rerun.
 */
const PASSWORD = 'local test password 1';

export const Route = createFileRoute('/dev-seed-review')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const local = isLocalHost(request.url);
        if (import.meta.env.VITE_LOCAL_SEED !== 'on' || !local) return new Response('Not found', { status: 404 });
        const seeded = await withStore(async (store) => {
          const a = await store.club.authenticate('a@local.test', PASSWORD);
          const b = await store.club.authenticate('b@local.test', PASSWORD);
          if (!a.ok || !b.ok) return null;
          const [aId, bId] = [a.value.member.id, b.value.member.id];
          await store.socialNominations.nominate(aId, { platform: 'LinkedIn', handle: 'nominee-one', topics: ['Audit'], whyUrl: 'https://example.com/post/1' });
          await store.socialNominations.nominate(aId, { platform: 'Threads', handle: 'nominee_two', topics: [], whyUrl: null });
          const post = await store.socialFloor.post(bId, { room: 'open', jurisdiction: 'MY', title: 'A post someone reported', body: 'It names Client Sdn Bhd.' });
          if (post.ok) await store.socialFloor.report(aId, { target: 'post', id: post.value.id }, 'client', 'Names the client.');
          await store.socialFloor.report(aId, { target: 'profile', handle: 'member_c' }, 'impersonation', '');
          await store.socialRequests.request({ name: 'New Person', email: 'new@local.test', about: 'Audit senior, posts on LinkedIn.', link: 'https://example.com/new' });
          await store.socialRequests.request({ name: 'Test Member C', email: 'c@local.test', about: 'Already here, asking anyway.', link: null });
          return true;
        });
        return seeded ? Response.json({ seeded: true }) : new Response('Run /dev-seed first.', { status: 409 });
      },
    },
  },
});
