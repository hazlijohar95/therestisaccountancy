import type { Access } from './billing.ts';

/** Where a member area belongs, and who may see it. */
export function requiredRole(pathname: string): 'member' | 'admin' | null {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (under('/admin')) return 'admin';
  if (under('/members')) return 'member';
  return null;
}

/** A return path from a query string, kept on this site. Anything else falls back. */
export function safeNext(value: string | null, fallback = '/members'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}

/** Member pages open to a member who has not paid: where they pay, and their account. Admins never pay. */
export const needsPayment = (pathname: string) => !['/members/pay', '/members/account'].includes(pathname.replace(/\/$/, ''));

/** Whether someone may read what membership pays for: an admin always, a member while paid or in grace. */
export const paidAccess = (role: 'member' | 'admin', access: Access) => role === 'admin' || access !== 'unpaid';
