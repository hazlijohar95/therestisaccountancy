import { join, signIn, site } from '../../../../src/data/club.ts';
import { footerGroups } from '../../../../src/data/lines.ts';
import s from './Footer.module.css';
import { Logo } from './Logo.tsx';
import { Signup } from './Signup.tsx';

const idOf = (group: string) => `footer-${group.toLowerCase().replaceAll(' ', '-')}`;

/** The club's footer. A page whose task contradicts the newsletter sign-up, like unsubscribing, leaves it out. */
export function Footer({ signup = true }: { signup?: boolean }) {
  return (
    <footer>
      <div className={`wrap ${s.in}`}>
        {signup && <Signup source="footer" />}
        <div className={s.map} id="site-map">
          <a href="/" className={s.home}>
            <Logo brand="club" label={site.name} className={s.logo} />
          </a>
          {footerGroups.map(({ group, links }) => (
            <nav key={group} aria-labelledby={idOf(group)}>
              <h2 className="label" id={idOf(group)}>
                {group}
              </h2>
              {links.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
          ))}
          <nav aria-labelledby="footer-club">
            <h2 className="label" id="footer-club">
              Club
            </h2>
            <a href={join.href}>{join.label}</a>
            <a href={signIn.href}>{signIn.label}</a>
          </nav>
        </div>
        <p className="small">
          {site.tagline} © {new Date().getFullYear()} {site.name}.
        </p>
      </div>
    </footer>
  );
}
