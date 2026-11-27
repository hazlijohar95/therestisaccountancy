import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { needsPayment } from '../../../../src/server/paths.ts';
import { MembersLayout } from '../../components/club/MembersLayout.tsx';
import { gate } from '../../functions/gate.ts';
import { clubAway } from '../../lib/access.ts';
import { noindex } from '../../lib/title.ts';

/*
 * The members' area: signed-in members only, and every page but paying and the account needs membership paid up.
 * Each page's server function checks again, since it can be called without this route.
 */
export const Route = createFileRoute('/members')({
  beforeLoad: async ({ location }) => {
    const denial = await gate({ data: needsPayment(location.pathname) ? 'paid' : 'member' });
    if (denial) throw redirect({ href: clubAway[denial](location.pathname + location.searchStr) });
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
