import { useRouter, useRouterState } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';
import { site } from '../../../../src/data/club.ts';
import { roomPath } from '../../../../src/data/social.ts';
import { signOut } from '../../functions/auth.ts';
import { socialHref } from '../../lib/links.ts';
import { Logo } from './Logo.tsx';
import s from './MembersLayout.module.css';

/** The members' nav. Community is the members' room on the Floor, which lives on the social host. */
const links = () => [
  { href: '/members', label: 'Overview' },
  { href: '/members/resources', label: 'Templates' },
  { href: '/members/sessions', label: 'Sessions' },
  { href: '/members/calls', label: 'One-to-one' },
  { href: socialHref(roomPath('club')), label: 'Community' },
  { href: '/members/account', label: 'Account' },
];

/** The members' area and admin: their own bar with sign-out, the page, and a footer saying who is signed in. */
export function MembersLayout({ member, children }: { member: { email: string; role: 'member' | 'admin' } | null; children: ReactNode }) {
  const here = useRouterState({ select: (state) => state.location.pathname.replace(/\/$/, '') });
  const router = useRouter();
  const leave = useServerFn(signOut);
  const shown = member?.role === 'admin' ? [...links(), { href: '/admin', label: 'Admin' }] : links();
  const current = (href: string) => (here === href || (href !== '/members' && here.startsWith(`${href}/`)) ? 'page' : undefined);

  return (
    <>
      <header className={`${s.bar} night`}>
        <div className={`wrap ${s.in}`}>
          <a className={s.home} href="/members">
            <Logo brand="club" label={`${site.name}, members`} />
          </a>
          <nav className={s.nav} aria-label="Members">
            {shown.map((link) => (
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
