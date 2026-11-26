import { createServerFn } from '@tanstack/react-start';
import { paidAccess } from '../../../src/server/paths.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/** Whether the signed-in member may read what membership pays for. False when signed out. */
export const membersPaid = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (!member) return false;
  if (member.role === 'admin') return true;
  const access = await withStore((store) => store.billing.access(member.id));
  return paidAccess(member.role, access);
});
