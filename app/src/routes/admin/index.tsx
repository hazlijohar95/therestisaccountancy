import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { LINK_DAYS } from '../../../../src/data/links.ts';
import { tally } from '../../../../src/lib/format.ts';
import { pageHref } from '../../../../src/lib/paging.ts';
import { useAction } from '../../components/useAction.ts';
import { LinkNotice } from '../../components/admin/LinkNotice.tsx';
import { Masthead } from '../../components/club/Masthead.tsx';
import { Notice } from '../../components/club/Notice.tsx';
import { Pager } from '../../components/club/Pager.tsx';
import { adminOverview, declineRequest, inviteRequest } from '../../functions/admin-members.ts';
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
        {invited.name} already has an account from Social, so nothing new was made. They can pay for the club now.{' '}
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
      <Masthead label="Admin" title={waiting}>
        <p>
          Invite someone and the club makes them a member with a private link to set a password, emailed to them. It works once and lasts {LINK_DAYS.welcome} days.
          Open a member to edit them, send a reset link, suspend or remove them.
        </p>
        <p className={s.tools}>
          <Link to="/admin/sessions">Sessions</Link>
          <Link to="/admin/calls">One-to-one</Link>
          <Link to="/admin/plans">Plans</Link>
          <Link to="/admin/listings">Directory</Link>
          <Link to="/admin/fees">Fee survey</Link>
          <a href="/admin/members.csv" download>
            Download members (CSV)
          </a>
        </p>
      </Masthead>

      {sessionsHeld && (
        <Notice tone="error">
          No live session is scheduled between a day and two weeks from now, so getting-started emails are on hold
          {sessionsHeld.waiting > 0 && ` for ${tally(sessionsHeld.waiting, 'new member', 'new members')}`}. <Link to="/admin/sessions">Schedule one</Link>
        </Notice>
      )}

      {shown}

      <section className={`wrap ${s.block}`} aria-labelledby="pending-title">
        <h2 className="head" id="pending-title">
          Waiting for a decision
        </h2>
        {pending.length === 0 ? (
          <p className={s.empty}>Nothing waiting. New requests from the join form appear here.</p>
        ) : (
          <div className={s.scroll}>
            <table className={`ledger ${s.ledger}`}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Where they are</th>
                  <th>Received</th>
                  <th>
                    <span className={s.sr}>Decision</span>
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
            </table>
          </div>
        )}
      </section>

      {quiet.length > 0 && (
        <section className={`wrap ${s.block}`} aria-labelledby="quiet-title">
          <h2 className="head" id="quiet-title">
            Gone quiet
          </h2>
          <p>Paying members who have not said yes to a session, posted, finished a lesson, booked a call or worked on their plan in {quietDays} days. Quietest first.</p>
          <div className={s.scroll}>
            <table className={`ledger ${s.ledger}`}>
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
            </table>
          </div>
        </section>
      )}

      <section className={`wrap ${s.block}`} aria-labelledby="members-title">
        <h2 className="head" id="members-title">
          Members
        </h2>
        <form method="GET" action="/admin#members-title" className={s.search} role="search" onSubmit={onSearch}>
          <label className={s.sr} htmlFor="q">
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
          <p className={s.empty}>{query ? `No member matches “${query}”.` : 'No members with that status.'}</p>
        ) : (
          <div className={s.scroll}>
            <table className={`ledger ${s.ledger}`}>
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
                    <td>{m.status}</td>
                    <td>{m.since}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      </section>

      {decided.length > 0 && (
        <section className={`wrap ${s.block}`} aria-labelledby="decided-title">
          <h2 className="head" id="decided-title">
            Recent decisions
          </h2>
          <div className={s.scroll}>
            <table className={`ledger ${s.ledger}`}>
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
                    <td>{r.decision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
