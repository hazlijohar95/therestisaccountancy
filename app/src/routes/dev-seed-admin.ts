import { createFileRoute } from '@tanstack/react-router';
import { isLocalHost } from '../lib/local.ts';
import { planSections } from '../../../src/data/plan.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * Local only: what the admin pages act on, on top of /dev-seed's accounts. Two join requests (one new person, one
 * already on Social), a sent plan and a listing to check from member A, fee survey answers, a session member B is going
 * to, and a slot member B has booked. Run /dev-seed first. Safe to rerun.
 */
const PASSWORD = 'local test password 1';
const DAY_MS = 86_400_000;
const FEE_ANSWERS = 55;

export const Route = createFileRoute('/dev-seed-admin')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const local = isLocalHost(request.url);
        if (import.meta.env.VITE_LOCAL_SEED !== 'on' || !local) return new Response('Not found', { status: 404 });
        const seeded = await withStore(async (store) => {
          const host = await store.club.authenticate('team@local.test', PASSWORD);
          const a = await store.club.authenticate('a@local.test', PASSWORD);
          const b = await store.club.authenticate('b@local.test', PASSWORD);
          if (!host.ok || !a.ok || !b.ok) return null;
          const hostId = host.value.member.id;
          const aId = a.value.member.id;
          const bId = b.value.member.id;

          await store.club.recordJoinRequest({ name: 'New Person', email: 'new.person@local.test', stage: 'I run a practice' });
          await store.club.recordJoinRequest({ name: 'Test Member A', email: 'a@local.test', stage: 'I work in a firm' });

          await store.plans.send(aId, Object.fromEntries(planSections.map((section) => [section.slug, `What I would write under “${section.heading}”.\n\nA second paragraph, with https://example.com in it.`])));

          await store.listings.save(aId, {
            practice: 'Member A & Co',
            state: 'Selangor',
            town: 'Petaling Jaya',
            remote: true,
            services: ['bookkeeping', 'company-tax'],
            niche: 'Clinics and dental practices',
            bio: 'A small practice that keeps the books and files the returns.\nTwo of us, both chartered.',
            qualifications: 'ACCA, MIA',
            website: 'https://example.com',
            contactEmail: 'a@local.test',
          });

          const current = await store.fees.current();
          for (let i = current.responses; i < FEE_ANSWERS; i++) {
            await store.fees.respond({
              stage: 'own',
              years: i % 2 ? '2-4' : '5-9',
              team: 'solo',
              pricing: 'fixed',
              state: 'Selangor',
              niche: i % 3 === 0,
              confidence: 3,
              fees: { hourly: i === 0 ? 1900 : 150 + i, bookkeeping: 500 + i * 10, taxReturn: i % 4 ? null : 1200 },
            });
          }

          const startsAt = new Date(Math.ceil((Date.now() + 3 * DAY_MS) / 3_600_000) * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
          if ((await store.schedule.upcoming(null)).length === 0) {
            const session = await store.schedule.add({ title: 'Pricing a first engagement', kind: 'Clinics', startsAt, minutes: 60, link: 'https://meet.example.com/clinic', detail: 'Bring a quote.' });
            await store.schedule.rsvp(bId, session, true);
          }
          if ((await store.calls.upcoming()).length === 0) {
            const slot = await store.calls.add(hostId, { startsAt, minutes: 30, link: 'https://meet.example.com/call' });
            if (slot.ok) await store.calls.book(bId, slot.value, 'Whether to take on a client who pays late.');
          }
          return { plans: (await store.plans.waiting()).length, fees: (await store.fees.current()).responses };
        });
        if (!seeded) return new Response('Run /dev-seed first', { status: 409 });
        return Response.json(seeded);
      },
    },
  },
});
