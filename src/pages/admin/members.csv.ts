import type { APIRoute } from 'astro';
import { roleLabel, statusLabel } from '../../data/members.ts';
import { csv } from '../../lib/csv.ts';
import { memberNumber } from '../../server/club.ts';

export const prerender = false;

/** Every member as a spreadsheet: the admin's own copy of the list. */
export const GET: APIRoute = async ({ locals }) => {
  if (locals.member?.role !== 'admin') return new Response(null, { status: 403 });
  const { items } = await locals.club.members({ limit: -1, offset: 0 });
  const rows = [['Number', 'Name', 'Email', 'Role', 'Status', 'Joined'], ...items.map((m) => [memberNumber(m), m.name, m.email, roleLabel[m.role], statusLabel[m.status], m.joinedAt.slice(0, 10)])];
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv(rows), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="members-${day}.csv"`, 'cache-control': 'no-store' },
  });
};
