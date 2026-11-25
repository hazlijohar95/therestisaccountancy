import { defineMiddleware } from 'astro:middleware';
import { openStore } from './server/instance.ts';
import { movedPath, requiredRole } from './server/paths.ts';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.member = null;
  if (context.isPrerendered) return next();
  const moved = movedPath(context.url.pathname);
  if (moved) return context.redirect(moved, 301);

  const store = await openStore();
  try {
    context.locals.club = store.club;
    context.locals.community = store.community;
    context.locals.limits = store.limits;
    const key = await context.session?.get('signedIn');
    context.locals.member = key ? await store.club.sessionMember(key) : null;

    const role = requiredRole(context.url.pathname);
    if (role && !context.locals.member) {
      return context.redirect(`/sign-in?next=${encodeURIComponent(context.url.pathname)}`);
    }
    if (role === 'admin' && context.locals.member?.role !== 'admin') return context.redirect('/members');
    return await next();
  } finally {
    store[Symbol.dispose]();
  }
});
