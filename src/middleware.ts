import { defineMiddleware } from 'astro:middleware';
import { getClub } from './server/instance.ts';
import { requiredRole } from './server/paths.ts';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.member = null;
  if (context.isPrerendered) return next();

  const key = await context.session?.get('signedIn');
  context.locals.member = key ? getClub().sessionMember(key) : null;

  const role = requiredRole(context.url.pathname);
  if (role && !context.locals.member) {
    return context.redirect(`/sign-in?next=${encodeURIComponent(context.url.pathname)}`);
  }
  if (role === 'admin' && context.locals.member?.role !== 'admin') return context.redirect('/members');
  return next();
});
