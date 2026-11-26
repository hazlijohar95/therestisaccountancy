import { defineMiddleware } from 'astro:middleware';
import { openStore } from './server/instance.ts';
import { isSocialPage, needsPayment, paidAccess, requiredRole } from './server/paths.ts';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.member = null;
  context.locals.profile = null;
  if (context.isPrerendered) return next();

  const store = await openStore();
  try {
    context.locals.club = store.club;
    context.locals.community = store.community;
    context.locals.limits = store.limits;
    context.locals.mailings = store.mailings;
    context.locals.schedule = store.schedule;
    context.locals.billing = store.billing;
    context.locals.plans = store.plans;
    context.locals.calls = store.calls;
    context.locals.listings = store.listings;
    context.locals.fees = store.fees;
    context.locals.newsletter = store.newsletter;
    context.locals.socialProfiles = store.socialProfiles;
    context.locals.socialClaims = store.socialClaims;
    const key = await context.session?.get('signedIn');
    context.locals.member = key ? await store.club.sessionMember(key) : null;
    if (context.locals.member && isSocialPage(context.url.pathname)) context.locals.profile = await store.socialProfiles.ownProfile(context.locals.member.id);

    const role = requiredRole(context.url.pathname);
    if (role && !context.locals.member) {
      return context.redirect(`/sign-in?next=${encodeURIComponent(context.url.pathname)}`);
    }
    if (role === 'admin' && context.locals.member?.role !== 'admin') return context.redirect('/members');
    const member = context.locals.member;
    if (role === 'member' && member && needsPayment(context.url.pathname) && !paidAccess(member.role, await store.billing.access(member.id))) {
      return context.redirect('/members/pay');
    }
    return await next();
  } finally {
    store[Symbol.dispose]();
  }
});
