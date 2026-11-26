import { createServerFn } from '@tanstack/react-start';
import { programmes } from '../../../src/data/programmes.ts';
import { formatMoment } from '../../../src/lib/format.ts';
import { memberNumber } from '../../../src/server/club.ts';
import { allResources, lessonsOf } from '../lib/content.server.ts';
import { paidMemberOrRedirect } from '../lib/members.server.ts';
import { withStore } from '../lib/store.server.ts';
import { hostFirstName } from '../../../src/data/authors.ts';

/** The overview: the member, their progress through each programme, and where they stand with the rest of the club. */
export const membersOverview = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await paidMemberOrRedirect();
  const { done, plan, call, listing } = await withStore(async (store) => {
    const done = await store.club.completedLessons(member.id);
    const plan = await store.plans.ofMember(member.id);
    const call = await store.calls.booking(member.id);
    const listing = await store.listings.listing(member.id);
    return { done, plan: { open: plan.open && { status: plan.open.status }, answered: plan.answered.length }, call: call && { startsAt: call.startsAt }, listing };
  });
  const progress = programmes.map((programme) => {
    const lessons = lessonsOf(programme.slug);
    return { slug: programme.slug, name: programme.name, promise: programme.promise, published: lessons.length, done: lessons.filter((l) => done.has(l.id)).length };
  });
  const templates = allResources().length;
  /* Each row says where the member stands with it, so the overview answers "what's waiting on me?" at a glance. */
  const planState = plan.open ? { draft: 'Draft saved', sent: `With ${hostFirstName}` }[plan.open.status] : plan.answered ? 'Answered' : 'Write it';
  const listingState = !listing ? 'Get listed' : listing.paused ? 'Paused' : { pending: 'Being checked', returned: 'Needs a change', listed: 'Listed' }[listing.review.state];
  const around = [
    { no: 'A', href: '/members/plan', title: 'Your plan', detail: `Write down the firm you want and how you will get there. ${hostFirstName} reads it and answers in writing.`, action: planState },
    { no: 'B', href: '/members/calls', title: 'One-to-one', detail: `Stuck on a quote, a client or a decision? Book a short call with ${hostFirstName}.`, action: call ? `Booked for ${formatMoment(call.startsAt)}` : 'Book a call' },
    { no: 'C', href: '/members/resources', title: 'Templates', detail: 'Checklists, letters and scripts to use with your own clients.', action: templates ? `${templates} to use` : 'Open them' },
    { no: 'D', href: '/members/listing', title: 'Find an accountant', detail: 'List your practice in the club directory, where business owners look for an accountant.', action: listingState },
  ];
  return { member: { name: member.name, joinedAt: member.joinedAt, number: memberNumber(member), role: member.role }, progress, around };
});
