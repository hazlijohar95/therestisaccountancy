import { join } from '../../../../src/data/club.ts';
import { Actions } from '../ui/Section.tsx';
import s from './Closing.module.css';

/** The night band that closes a page with the way to join. */
export function Closing({ title, lead }: { title: string; lead?: string }) {
  return (
    <section className="night" aria-label="Join the club">
      <div className={`wrap ${s.in}`}>
        <h2 className={`headline serif ${s.headline}`}>{title}</h2>
        <div className={s.side}>
          {lead && <p className={`lead ${s.lead}`}>{lead}</p>}
          <Actions>
            <a className="btn" href={join.href}>
              {join.label}
            </a>
          </Actions>
        </div>
      </div>
    </section>
  );
}
