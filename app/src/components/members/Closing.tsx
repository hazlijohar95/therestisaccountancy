import { join } from '../../../../src/data/club.ts';
import s from './Closing.module.css';

/** The night band that closes a page with the way to join. */
export function Closing({ title, lead }: { title: string; lead?: string }) {
  return (
    <section className="night" aria-label="Join the club">
      <div className={`wrap ${s.in}`}>
        <h2 className={`headline serif ${s.headline}`}>{title}</h2>
        <div className={s.side}>
          {lead && <p className={`lead ${s.lead}`}>{lead}</p>}
          <div className={s.actions}>
            <a className="btn" href={join.href}>
              {join.label}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
