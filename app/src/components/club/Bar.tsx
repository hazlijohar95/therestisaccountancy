import { useRef, type MouseEvent } from 'react';
import { join, signIn, site } from '../../../../src/data/club.ts';
import { menu } from '../../../../src/data/lines.ts';
import s from './Bar.module.css';
import { Logo } from './Logo.tsx';

/**
 * The club's top bar: the menu and search on the left, the logo in the middle, sign-in and join on the right. Without
 * JavaScript the menu link goes to the footer's site map; with it, the menu opens as a modal drawer.
 */
export function Bar({ pathname }: { pathname: string }) {
  const here = pathname.replace(/\/$/, '') || '/';
  const current = (href: string) => (here === href || here.startsWith(`${href}/`) ? 'page' : undefined);
  const drawer = useRef<HTMLDialogElement>(null);

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    drawer.current?.showModal();
  };
  /* A click on the backdrop lands on the dialog itself, outside its box. */
  const backdrop = (event: MouseEvent<HTMLDialogElement>) => {
    const dialog = drawer.current;
    if (!dialog || event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX > box.right || event.clientX < box.left || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  };

  return (
    <header className={`${s.bar} night`}>
      <div className={`wrap ${s.in}`}>
        <div className={s.start}>
          <a className={`${s.icon} ${s.open}`} href="#site-map" aria-label="Menu" aria-controls="site-menu" onClick={open}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6.5h18M3 12h18M3 17.5h18" />
            </svg>
          </a>
          <a className={`${s.icon} ${s.search}`} href="/search" aria-label="Search" aria-current={current('/search')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5L21 21" />
            </svg>
          </a>
        </div>
        <a className={s.home} href="/">
          <Logo brand="club" label={site.name} />
        </a>
        <div className={s.end}>
          <a className={s.signIn} href={signIn.href}>
            {signIn.label}
          </a>
          <a className={`btn ${s.cta}`} href={join.href}>
            {join.label}
          </a>
        </div>
      </div>
      <dialog className={`${s.drawer} night`} id="site-menu" aria-label="Site menu" ref={drawer} onClick={backdrop}>
        <button className={`${s.icon} ${s.close}`} type="button" aria-label="Close menu" onClick={() => drawer.current?.close()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        </button>
        <nav aria-label="Site">
          <ul className={s.primary}>
            {menu.primary.map((link) => (
              <li key={link.href}>
                <a href={link.href} aria-current={current(link.href)}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <a className="btn" href={join.href}>
            {join.label}
          </a>
          <ul className={s.secondary}>
            {menu.secondary.map((link) => (
              <li key={link.href}>
                <a href={link.href} aria-current={current(link.href)}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </dialog>
    </header>
  );
}
