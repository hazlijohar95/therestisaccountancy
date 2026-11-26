import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { MembersLayout } from '../../components/club/MembersLayout.tsx';
import { noindex } from '../../lib/title.ts';

/* Every admin page needs an admin: a visitor signs in and comes back, a member who is not an admin goes to the members' area. */
export const Route = createFileRoute('/admin')({
  beforeLoad: ({ context, location }) => {
    if (!context.member) throw redirect({ href: `/sign-in?next=${encodeURIComponent(location.pathname + location.searchStr)}` });
    if (context.member.role !== 'admin') throw redirect({ href: '/members' });
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
