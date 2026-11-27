import { createFileRoute } from '@tanstack/react-router';
import { firstName, formatDay, formatMoment } from '../../../../src/lib/format.ts';
import { MemberCard } from '../../components/members/MemberCard.tsx';
import { flags } from '../../components/members/flags.ts';
import { Badge } from '../../components/ui/Badge.tsx';
import { Icon } from '../../components/ui/Icon.tsx';
import { DateTile, List, Meta, Row } from '../../components/ui/List.tsx';
import { Actions, Section } from '../../components/ui/Section.tsx';
import { Progress, Steps, type StepState } from '../../components/ui/Steps.tsx';
import { membersOverview } from '../../functions/members-overview.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './index.module.css';

export const Route = createFileRoute('/members/')({
  /* ?welcome after setting a first password, ?reset after a new one, ?paid back from a payment. Each may come without a value. */
  validateSearch: flags('welcome', 'reset', 'paid'),
  loader: () => membersOverview(),
  head: () => ({ meta: clubTitle('Members') }),
  component: Overview,
});

function Overview() {
  const { member, next, steps, progress, around } = Route.useLoaderData();
  const search = Route.useSearch();
  const name = firstName(member.name);
  const greeting = search.paid
    ? { label: 'Payment received', title: `You're in, ${name}.` }
    : search.welcome
      ? { label: 'Your password is set', title: `Welcome to the club, ${name}.` }
      : { label: search.reset ? 'Your new password is set' : `Member since ${formatDay(member.joinedAt)}`, title: `Good to see you, ${name}.` };

  const done = steps.filter((step) => step.done).length;
  /* Admins host the club: the first steps are for members. */
  const current = member.role === 'admin' ? undefined : steps.find((step) => !step.done);
  const stateOf = (step: (typeof steps)[number]): StepState => (step.done ? 'done' : step === current ? 'current' : 'todo');

  return (
    <>
      <section className="night">
        <div className={`wrap ${s.masthead}`}>
          <div>
            <p className={`label ${s.top}`}>{greeting.label}</p>
            <h1 className={`headline serif ${s.headline}`}>{greeting.title}</h1>
          </div>
          <MemberCard name={member.name} number={member.number} role={member.role === 'admin' ? 'Admin' : 'Member'} />
        </div>
      </section>

      {current && (
        <Section title="Your first steps">
          <Progress value={done} max={steps.length} label="Done" />
          <Steps label="Your first steps" items={steps.map((step) => ({ label: step.label, detail: step.detail, href: step.href, state: stateOf(step) }))} />
          <Actions>
            <a className="btn" href={current.href}>
              {current.label}
              <Icon name="arrow" size={18} />
            </a>
          </Actions>
        </Section>
      )}

      {next && (
        <Section title="Next live session" meta={<a href="/members/sessions">All sessions</a>}>
          <List>
            <Row
              lead={<DateTile at={next.startsAt} />}
              title={<a href="/members/sessions">{next.title}</a>}
              meta={
                <>
                  <Badge>{next.kind}</Badge>
                  <Meta icon="clock">
                    {formatMoment(next.startsAt)} · {next.minutes} min
                  </Meta>
                </>
              }
              trail={next.attending ? <Badge tone="solid">Going</Badge> : <a href="/members/sessions">Say you're coming</a>}
            />
          </List>
        </Section>
      )}

      <Section title="Your programmes">
        <List ordered>
          {progress.map((programme, i) => (
            <Row
              key={programme.slug}
              lead={<span className={`serif ${s.no}`}>{String(i + 1).padStart(2, '0')}</span>}
              title={<a href={`/members/programmes/${programme.slug}`}>{programme.name}</a>}
              meta={programme.promise}
              trail={programme.published === 0 ? <Badge>Soon</Badge> : <span className={s.count}>{`${programme.done}/${programme.published}`}</span>}
            />
          ))}
        </List>
      </Section>

      <Section title="Around the club">
        <List>
          {around.map((item) => (
            <Row key={item.no} title={<a href={item.href}>{item.title}</a>} meta={item.detail} trail={<Badge>{item.action}</Badge>} />
          ))}
        </List>
      </Section>
    </>
  );
}
