import { useRouter, useRouterState } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';
import { site } from '../../../../src/data/club.ts';
import { signOut } from '../../functions/auth.ts';
import { Logo } from './Logo.tsx';
import s from './MembersLayout.module.css';

const LINKS = [
  { href: '/members', label: 'Overview' },
  { href: '/members/resources', label: 'Templates' },
  { href: '/members/sessions', label: 'Sessions' },
  { href: '/members/calls', label: 'One-to-one' },
  { href: '/members/community', label: 'Community' },
  { href: '/members/account', label: 'Account' },
] as const;

/** The members' area and admin: their own bar with sign-out, the page, and a footer saying who is signed in. */
export function MembersLayout({ member, children }: { member: { email: string; role: 'member' | 'admin' } | null; children: ReactNode }) {
  const here = useRouterState({ select: (state) => state.location.pathname.replace(/\/$/, '') });
  const router = useRouter();
  const leave = useServerFn(signOut);
  const links = member?.role === 'admin' ? [...LINKS, { href: '/admin', label: 'Admin' }] : LINKS;
  const current = (href: string) => (here === href || (href !== '/members' && here.startsWith(`${href}/`)) ? 'page' : undefined);

  return (
    <>
      <header className={`${s.bar} night`}>
        <div className={`wrap ${s.in}`}>
          <a className={s.home} href="/members">
            <Logo brand="club" label={`${site.name}, members`} />
          </a>
          <nav className={s.nav} aria-label="Members">
            {links.map((link) => (
              <a key={link.href} href={link.href} aria-current={current(link.href)}>
                {link.label}
              </a>
            ))}
          </nav>
          <form
            className={s.form}
            method="POST"
            onSubmit={async (event) => {
              event.preventDefault();
              await leave();
              await router.navigate({ to: '/sign-in', search: { out: 1 } });
            }}
          >
            <button className={`btn ghost ${s.out}`} type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className={`wrap small ${s.foot}`}>
        <a href="/">Public site</a>
        <span>{member ? `Signed in as ${member.email}` : ''}</span>
      </footer>
    </>
  );
}
