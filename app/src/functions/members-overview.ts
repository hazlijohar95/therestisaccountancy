import { createServerFn } from '@tanstack/react-start';
import { doneSteps, FIRST_STEPS, firstSteps } from '../../../src/data/onboarding.ts';
import { programmes } from '../../../src/data/programmes.ts';
import { formatMoment } from '../../../src/lib/format.ts';
import { memberNumber } from '../../../src/server/club.ts';
import { allResources, lessonsOf } from '../lib/content.server.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { withStore } from '../lib/store.server.ts';
import { hostFirstName } from '../../../src/data/authors.ts';

/** The overview: the member, their first steps, their progress through each programme, and where they stand with the rest of the club. */
export const membersOverview = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await admit('paid', toClub);
  const { done, plan, call, listing, next, counts } = await withStore(async (store) => {
    const done = await store.club.completedLessons(member.id);
    /* Everything they have ever done: a first step stays done. */
    const counts = await store.activity.counts(member.id, '');
    const plan = await store.plans.ofMember(member.id);
    const call = await store.calls.booking(member.id);
    const listing = await store.listings.listing(member.id);
    const soonest = (await store.schedule.upcoming(member.id))[0];
    return {
      done,
      plan: { open: plan.open && { status: plan.open.status }, answered: plan.answered.length },
      call: call && { startsAt: call.startsAt },
      listing,
      next: soonest ? { title: soonest.title, kind: soonest.kind, startsAt: soonest.startsAt, minutes: soonest.minutes, attending: soonest.attending } : null,
      counts,
    };
  });
  const progress = programmes.map((programme) => {
    const lessons = lessonsOf(programme.slug);
    return { slug: programme.slug, name: programme.name, promise: programme.promise, published: lessons.length, done: lessons.filter((l) => done.has(l.id)).length };
  });
  const stepDone = doneSteps({ sessions: counts.session, lessons: counts.lesson, calls: counts.call, planSent: plan.open?.status === 'sent' || plan.answered > 0, listed: listing !== null });
  const steps = FIRST_STEPS.map((step) => ({ label: firstSteps[step].label, detail: firstSteps[step].detail, href: firstSteps[step].path, done: stepDone[step] }));
  const templates = allResources().length;
  /* Each row says where the member stands with it, so the overview answers "what's waiting on me?" at a glance. */
  /* A status only where there is one: the linked title is the way in, so nothing here reads as a button. */
  const planState = plan.open ? { draft: 'Draft saved', sent: `With ${hostFirstName}` }[plan.open.status] : plan.answered ? 'Answered' : null;
  const listingState = !listing ? null : listing.paused ? 'Paused' : { pending: 'Being checked', returned: 'Needs a change', listed: 'Listed' }[listing.review.state];
  const around = [
    { no: 'A', href: '/members/plan', title: 'Your plan', detail: `The firm you want, in writing. ${hostFirstName} answers.`, action: planState },
    { no: 'B', href: '/members/calls', title: 'One-to-one', detail: `A short call with ${hostFirstName} when you're stuck.`, action: call ? `Booked for ${formatMoment(call.startsAt)}` : null },
    { no: 'C', href: '/members/resources', title: 'Templates', detail: 'Checklists, letters and scripts for your clients.', action: templates ? `${templates} to use` : null },
    { no: 'D', href: '/members/listing', title: 'Find an accountant', detail: 'Where business owners find an accountant.', action: listingState },
  ];
  return { member: { name: member.name, joinedAt: member.joinedAt, number: memberNumber(member), role: member.role }, next, steps, progress, around };
});
