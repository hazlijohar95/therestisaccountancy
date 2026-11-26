import { createFileRoute } from '@tanstack/react-router';
import { roleLabel, statusLabel } from '../../../../src/data/members.ts';
import { csv } from '../../../../src/lib/csv.ts';
import { memberNumber } from '../../../../src/server/club.ts';
import { admit, toClub } from '../../lib/access.server.ts';
import { withStore } from '../../lib/store.server.ts';

/** Every member as a spreadsheet: the admin's own copy of the list. */
export const Route = createFileRoute('/admin/members.csv')({
  server: {
    handlers: {
      GET: async () => {
        await admit('admin', toClub);
        const { items } = await withStore(async (store) => await store.club.members({ limit: -1, offset: 0 }));
        const rows = [['Number', 'Name', 'Email', 'Role', 'Status', 'Joined'], ...items.map((m) => [memberNumber(m), m.name, m.email, roleLabel[m.role], statusLabel[m.status], m.joinedAt.slice(0, 10)])];
        const day = new Date().toISOString().slice(0, 10);
        return new Response(csv(rows), {
          headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="members-${day}.csv"`, 'cache-control': 'no-store' },
        });
      },
    },
  },
});
