import { useEffect, useRef } from 'react';
import { join, signIn, site } from '../../../../src/data/club.ts';
import { company, lines } from '../../../../src/data/lines.ts';
import { Logo } from './Logo.tsx';
import s from './Bar.module.css';

const menu = [...lines, company.membership, company.directory, company.about, signIn];

/** The club's top bar. Below desktop width the links fold into a menu that closes when focus leaves it or on Escape. */
export function Bar({ pathname }: { pathname: string }) {
  const here = pathname.replace(/\/$/, '') || '/';
  const current = (href: string) => (here === href || here.startsWith(`${href}/`) ? 'page' : undefined);
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const menuElement = details.current;
    if (!menuElement) return;
    const onFocusOut = (event: FocusEvent) => {
      /* No relatedTarget is a mouse press that focused nothing, as Safari's on a link does. Closing then would swallow the click. */
      if (event.relatedTarget instanceof Node && !menuElement.contains(event.relatedTarget)) menuElement.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !menuElement.open) return;
      menuElement.open = false;
      menuElement.querySelector('summary')?.focus();
    };
    menuElement.addEventListener('focusout', onFocusOut);
    menuElement.addEventListener('keydown', onKeyDown);
    return () => {
      menuElement.removeEventListener('focusout', onFocusOut);
      menuElement.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <header className={`${s.bar} night`}>
      <div className={`wrap ${s.in}`}>
        <a className={s.home} href="/">
          <Logo brand="club" label={site.name} />
        </a>
        <nav className={s.wide} aria-label="Site">
          {lines.map((link) => (
            <a key={link.href} href={link.href} aria-current={current(link.href)}>
              {link.label}
            </a>
          ))}
        </nav>
        <a className={s.signIn} href={signIn.href}>
          {signIn.label}
        </a>
        <a className={`btn ${s.cta}`} href={join.href}>
          {join.label}
        </a>
        <details className={s.menu} ref={details}>
          <summary className="btn ghost">Menu</summary>
          <nav className={s.drawer} aria-label="Site">
            {menu.map((link) => (
              <a key={link.href} href={link.href} aria-current={current(link.href)}>
                {link.label}
              </a>
            ))}
            <a className="btn" href={join.href}>
              {join.label}
            </a>
          </nav>
        </details>
      </div>
    </header>
  );
}
