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

