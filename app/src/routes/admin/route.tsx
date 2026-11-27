import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { MembersLayout } from '../../components/club/MembersLayout.tsx';
import { clubAway, decideDirect } from '../../lib/access.ts';
import { noindex } from '../../lib/title.ts';

/* Every admin page needs an admin: a visitor signs in and comes back, a member who is not an admin goes to the members' area. */
export const Route = createFileRoute('/admin')({
  beforeLoad: ({ context, location }) => {
    const decision = decideDirect('admin', context.member);
    if (!decision.ok) throw redirect({ href: clubAway[decision.denial](location.pathname + location.searchStr) });
  },
  head: () => ({ meta: [noindex] }),
  component: AdminLayout,
});

function AdminLayout() {
  const { member } = Route.useRouteContext();
  return (
    <MembersLayout member={member}>
      <Outlet />
    </MembersLayout>
  );
}
