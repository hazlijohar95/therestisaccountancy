import { createServerFn } from '@tanstack/react-start';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/** What Social's header draws for the signed-in member: their avatar's track and seal, and the bell's unread count. */
export const socialChrome = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (!member) return { profile: null, unread: 0 };
  return withStore(async (store) => {
    const own = await store.socialProfiles.ownProfile(member.id);
    const unread = await store.socialNotifications.unread(member.id);
    return { profile: own && { handle: own.handle, track: own.track, sealed: own.sealed }, unread };
  });
});
