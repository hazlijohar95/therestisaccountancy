import type { MemberStatus, Role } from '../server/club.ts';

export const statusLabel = { invited: 'Invited', active: 'Active', suspended: 'Suspended' } as const satisfies Record<MemberStatus, string>;
export const roleLabel = { member: 'Member', admin: 'Admin' } as const satisfies Record<Role, string>;
