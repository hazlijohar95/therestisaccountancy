import { createFileRoute } from '@tanstack/react-router';
import { firstName, formatDay } from '../../../../src/lib/format.ts';
import { MemberCard } from '../../components/members/MemberCard.tsx';
import { membersOverview } from '../../functions/members-overview.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './index.module.css';

export const Route = createFileRoute('/members/')({
  /* ?welcome after setting a first password, ?reset after a new one. Either may come without a value. */
  validateSearch: (search: Record<string, unknown>) => ({ welcome: search['welcome'] === undefined ? undefined : true, reset: search['reset'] === undefined ? undefined : true }),
  loader: () => membersOverview(),
  head: () => ({ meta: clubTitle('Members') }),
  component: Overview,
});

function Overview() {
  const { member, progress, around } = Route.useLoaderData();
  const search = Route.useSearch();
  const greeting = search.welcome
    ? { label: 'Your password is set', title: `Welcome to the club, ${firstName(member.name)}.` }
    : { label: search.reset ? 'Your new password is set' : `Member since ${formatDay(member.joinedAt)}`, title: `Good to see you, ${firstName(member.name)}.` };

  return (
    <>
      <section className="night">
        <div className={`wrap ${s.masthead}`}>
          <div>
            <p className={`label ${s.top}`}>{greeting.label}</p>
            <h1 className={`headline serif ${s.headline}`}>{greeting.title}</h1>
            <p className={s.lead}>Pick up the programme that matters most this month. The live sessions and their recordings are under Sessions.</p>
          </div>
          <MemberCard name={member.name} number={member.number} role={member.role === 'admin' ? 'Admin' : 'Member'} />
        </div>
      </section>

      <section className="wrap sec" aria-labelledby="programmes-title">
        <div className={s.rail}>
          <h2 className="head" id="programmes-title">
            Your programmes
          </h2>
          <p>Lessons appear here as they are published. Mark each one done as you finish it.</p>
        </div>
        <div className="ep-list">
          {progress.map((programme, i) => (
            <a key={programme.slug} className="ep-row" href={`/members/programmes/${programme.slug}`}>
              <span className="no">{String(i + 1).padStart(2, '0')}</span>
              <span className={s.what}>
                <h3>{programme.name}</h3>
                <span className="small">{programme.promise}</span>
              </span>
              <span className={`small ${s.count}`}>{programme.published === 0 ? 'Being written' : `${programme.done} of ${programme.published} done`}</span>
              <span className="go" aria-hidden="true">
                →
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="wrap sec" aria-labelledby="around-title">
        <div className={s.rail}>
          <h2 className="head" id="around-title">
            Around the club
          </h2>
          <p>The parts that are not lessons. Each one is yours to use as often as you need it.</p>
        </div>
        <div className="ep-list">
          {around.map((item) => (
            <a key={item.no} className="ep-row" href={item.href}>
              <span className="no">{item.no}</span>
              <span className={s.what}>
                <h3>{item.title}</h3>
                <span className="small">{item.detail}</span>
              </span>
              <span className={`small ${s.count}`}>{item.action}</span>
              <span className="go" aria-hidden="true">
                →
              </span>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
