import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { needsPayment } from '../../../../src/server/paths.ts';
import { MembersLayout } from '../../components/club/MembersLayout.tsx';
import { membersPaid } from '../../functions/members-gate.ts';
import { noindex } from '../../lib/title.ts';

/*
 * The members' area: signed-in members only, and every page but paying and the account needs membership paid up.
 * Each page's server function checks again, since it can be called without this route.
 */
export const Route = createFileRoute('/members')({
  beforeLoad: async ({ context, location }) => {
    if (!context.member) throw redirect({ href: `/sign-in?next=${encodeURIComponent(location.pathname)}` });
    if (needsPayment(location.pathname) && !(await membersPaid())) throw redirect({ href: '/members/pay' });
  },
  head: () => ({ meta: [noindex] }),
  component: Members,
});

function Members() {
  const { member } = Route.useRouteContext();
  return (
    <MembersLayout member={member}>
      <Outlet />
    </MembersLayout>
  );
}
