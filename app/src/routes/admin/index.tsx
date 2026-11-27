import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { LINK_DAYS } from '../../../../src/data/links.ts';
import { tally } from '../../../../src/lib/format.ts';
import { pageHref } from '../../../../src/lib/paging.ts';
import { useAction } from '../../components/useAction.ts';
import { LinkNotice } from '../../components/admin/LinkNotice.tsx';
import { Pager } from '../../components/club/Pager.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Empty } from '../../components/ui/Empty.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { PageHead } from '../../components/ui/PageHead.tsx';
import { Section } from '../../components/ui/Section.tsx';
import { Stats } from '../../components/ui/Stat.tsx';
import { Table } from '../../components/ui/Table.tsx';
import { adminOverview, declineRequest, inviteRequest } from '../../functions/admin-members.ts';
import { socialHref } from '../../lib/links.ts';
import { countParam, textParam } from '../../lib/search-params.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './index.module.css';

export const Route = createFileRoute('/admin/')({
  validateSearch: (search: Record<string, unknown>): { q?: string | undefined; status?: string | undefined; page?: number | undefined; removed?: true | undefined } => ({
    q: textParam(search['q']),
    status: textParam(search['status']),
    page: countParam(search['page']),
    removed: search['removed'] === undefined ? undefined : true,
  }),
  loaderDeps: ({ search }) => ({ q: search.q, status: search.status, page: search.page }),
  loader: async ({ deps, location }) => {
    const data = await adminOverview({ data: deps });
    if (data.page > data.pages) throw redirect({ href: pageHref(new URL(location.href, 'http://admin'), data.pages) });
    return data;
  },
  head: () => ({ meta: clubTitle('Admin') }),
  component: Admin,
});

function Admin() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const invite = useAction(inviteRequest, { refresh: 'always' });
  const decline = useAction(declineRequest, { refresh: 'always' });
  const busy = invite.busy || decline.busy;
  const [shown, setShown] = useState<ReactNode>(search.removed ? <Notice>Member removed.</Notice> : null);
  const { pending, decided, members, quiet, quietDays, sessionsHeld, query, status } = data;
  const waiting = pending.length === 1 ? 'One request waiting.' : pending.length === 0 ? 'No requests waiting.' : `${pending.length} requests waiting.`;

  const onInvite = async (request: number) => {
    const outcome = await invite.run({ request });
    if (!outcome) return;
    if (!outcome.ok) return setShown(<Notice tone="error">{outcome.message}</Notice>);
    const invited = outcome.value;
    if (invited.kind === 'link') return setShown(<LinkNotice issued={invited.issued} />);
    setShown(
      <Notice tone={invited.emailed ? 'ok' : 'error'}>
        {invited.name} already has a Social account, so no new one was made. They can pay for the club now.{' '}
        {invited.emailed ? `We emailed ${invited.email} to say so.` : `The email to ${invited.email} did not send. Tell them yourself.`}
      </Notice>,
    );
  };

  const onDecline = async (request: number) => {
    const outcome = await decline.run({ request });
    if (!outcome) return;
    setShown(outcome.ok ? <Notice>Request declined.</Notice> : <Notice tone="error">{outcome.message}</Notice>);
  };

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get('q') ?? '');
    void navigate({ to: '/admin', search: { q: q || undefined, status: status ?? undefined }, hash: 'members-title' });
  };

  return (
    <>
      <PageHead
        label="Admin"
        title={waiting}
        lead={`Invite emails a one-time link to set a password, good for ${LINK_DAYS.welcome} days. Open a member to edit, reset, suspend or remove them.`}
        actions={
          <>
            <Link className="btn ghost" to="/admin/sessions">
              Sessions
            </Link>
            <Link className="btn ghost" to="/admin/calls">
              One-to-one
            </Link>
            <Link className="btn ghost" to="/admin/plans">
              Plans
            </Link>
            <Link className="btn ghost" to="/admin/listings">
              Directory
            </Link>
            <Link className="btn ghost" to="/admin/fees">
              Fee survey
            </Link>
            <a className="btn ghost" href="/admin/members.csv" download>
              Members CSV
            </a>
          </>
        }
      />

      {sessionsHeld && (
        <Notice tone="error">
          Getting-started emails are on hold{sessionsHeld.waiting > 0 && ` for ${tally(sessionsHeld.waiting, 'new member', 'new members')}`}. No live session is scheduled
          between a day and two weeks from now. <Link to="/admin/sessions">Schedule one</Link>
        </Notice>
      )}

      <Section title="Waiting on you">
        {data.queues.length === 0 ? (
          <Empty icon="check">Nothing is waiting on you.</Empty>
        ) : (
          <Stats
            items={data.queues.map((q) => ({
              label: q.label,
              value: (
                <a href={q.where.site === 'social' ? socialHref(q.where.path) : q.where.path}>
                  {q.count}
                  <span className="visually-hidden"> {q.label.toLowerCase()}</span>
                </a>
              ),
              note: (
                <span className={s.waited}>
                  Oldest waited {q.waited}
                  {q.stale && <Badge tone="solid">Too long</Badge>}
                </span>
              ),
            }))}
          />
        )}
      </Section>

      {shown}

      <Section title="Join requests" id="pending-title">
        {pending.length === 0 ? (
          <Empty icon="mail">No requests waiting. New ones from the join form land here.</Empty>
        ) : (
          <Table words label="Join requests">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Where they are</th>
                <th>Received</th>
                <th>
                  <span className="visually-hidden">Decision</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{r.stage}</td>
                  <td>{r.received}</td>
                  <td className={s.decide}>
                    <form
                      method="POST"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void onInvite(r.id);
                      }}
                    >
                      <button className="btn" type="submit" disabled={busy}>
                        Invite
                      </button>
                    </form>
                    <form
                      method="POST"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void onDecline(r.id);
                      }}
                    >
                      <button className="btn ghost" type="submit" disabled={busy}>
                        Decline
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      {quiet.length > 0 && (
        <Section title="Gone quiet">
          <p className={`small ${s.note}`}>Paying members with no RSVP, post, finished lesson, booked call or plan work in {quietDays} days. Quietest first.</p>
          <Table words label="Gone quiet">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Last did</th>
                <th>Paid until</th>
                <th>Renews</th>
              </tr>
            </thead>
            <tbody>
              {quiet.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to="/admin/members/$id" params={{ id: String(m.id) }}>
                      {m.name}
                    </Link>
                  </td>
                  <td>{m.email}</td>
                  <td>{m.last}</td>
                  <td>{m.paidUntil}</td>
                  <td>{m.renews}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      <Section title="Members" id="members-title">
        <form method="GET" action="/admin#members-title" className={s.search} role="search" onSubmit={onSearch}>
          <label className="visually-hidden" htmlFor="q">
            Search members
          </label>
          <input className="input" id="q" name="q" type="search" key={query} defaultValue={query} placeholder="Name or email" maxLength={100} />
          <button className="btn ghost" type="submit">
            Search
          </button>
        </form>
        <nav className={s.filters} aria-label="Filter members by status">
          {data.filters.map((f) => (
            <Link key={f.label} to="/admin" search={{ q: query || undefined, status: f.status }} hash="members-title" aria-current={f.status === status ? 'page' : undefined}>
              {f.label}
            </Link>
          ))}
        </nav>
        {members.length === 0 ? (
          <Empty icon="users">{query ? `No member matches “${query}”.` : 'No members with that status.'}</Empty>
        ) : (
          <Table words label="Members">
            <thead>
              <tr>
                <th>No.</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.number}</td>
                  <td>
                    <Link to="/admin/members/$id" params={{ id: String(m.id) }}>
                      {m.name}
                    </Link>
                  </td>
                  <td>{m.email}</td>
                  <td>{m.role}</td>
                  <td>
                    <Badge>{m.status}</Badge>
                  </td>
                  <td>{m.since}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager
          page={data.page}
          pages={data.pages}
          label="Member pages"
          link={(page, rel, text) => (
            <Link to="/admin" search={{ ...search, removed: undefined, page: page > 1 ? page : undefined }} rel={rel}>
              {text}
            </Link>
          )}
        />
      </Section>

      {decided.length > 0 && (
        <Section title="Recent decisions">
          <Table words label="Recent decisions">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Where they are</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{r.stage}</td>
                  <td>
                    <Badge tone={r.decision === 'Invited' ? 'solid' : 'plain'}>{r.decision}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}
    </>
  );
}
