import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { bodyById, CLAIM_LIMITS } from '../../../../../src/data/social.ts';
import { formatDay, formatMonth } from '../../../../../src/lib/format.ts';
import { CopyLink } from '../../../components/social/CopyLink.tsx';
import { SocialLink } from '../../../components/social/SocialLink.tsx';
import { Tick } from '../../../components/social/Tick.tsx';
import { useAction } from '../../../components/social/useAction.ts';
import {
  approveAccount,
  approveClaim,
  approveRequest,
  declineRequest,
  dismissReported,
  hideReported,
  inviteNomination,
  rejectAccount,
  rejectClaim,
  rejectNomination,
  relinkNomination,
  reviewQueue,
  teamInvite,
  withdrawTeamInvite,
} from '../../../functions/social-review.ts';
import type { Outcome } from '../../../lib/outcome.ts';
import { socialHref, socialSignInHref } from '../../../lib/links.ts';
import { noindex, socialTitle } from '../../../lib/title.ts';

const TABS = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'documents', label: 'Documents' },
  { id: 'nominations', label: 'Nominations' },
  { id: 'reports', label: 'Reports' },
  { id: 'requests', label: 'Requests' },
  { id: 'invites', label: 'Invites' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const GUIDANCE: Record<Tab, string> = {
  accounts: 'Open the profile and look for the code in its bio. Approve only if you see it there, on that exact handle.',
  credentials: 'Find the member on the body’s public register, or open the staff page. The name and number must match.',
  documents: 'Download the document and read it. It is deleted once you decide, so decide only when you are sure.',
  nominations: 'Open the profile. Invite people who post things worth learning from, then send them the link by direct message. Once only, no chasing.',
  reports: 'Read it where it is. Hide removes a post or reply, or takes a profile off The List. Dismiss leaves it. Nobody is told either way.',
  requests: 'Look them up. Approve people in the profession whose posts you can see; they get the email to set a password. Decline sends a short, polite email.',
  invites: 'Invite by email, club members you bring over included. The link works once, for two weeks. It shows here once, too, in case the email does not arrive.',
};

/* What each decision says once it is made. */
const DONE = {
  approved: 'Approved. The member has been emailed.',
  rejected: 'Rejected. The member has your reason by email.',
  'nomination-rejected': 'Not invited. Nobody is told.',
  hidden: 'Hidden. The reports on it are closed.',
  dismissed: 'Dismissed. The reports on it are closed.',
  'request-approved': 'Approved. They have the email to get in.',
  'request-declined': 'Declined. They have a short, polite email.',
  'invite-withdrawn': 'Withdrawn. The link no longer works.',
} as const;
type Decided = keyof typeof DONE;

const HIDE = { post: 'Hide post', reply: 'Hide reply', profile: 'Take off The List' } as const;
const WHAT = { post: 'Post', reply: 'Reply', profile: 'Profile' } as const;
const INVITE_STATE = { live: 'Waiting', used: 'Used', expired: 'Ran out', revoked: 'Withdrawn' } as const;
const people = (n: number) => `${n} ${n === 1 ? 'nominator' : 'nominators'}`;

export const Route = createFileRoute('/social/review/')({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab | undefined } => ({ tab: TABS.find((t) => t.id === search['tab'])?.id }),
  beforeLoad: ({ context }) => {
    if (!context.member) throw redirect({ href: socialSignInHref('/review') });
  },
  loader: () => reviewQueue(),
  head: ({ loaderData }) => ({ meta: [...socialTitle(loaderData ? 'Review queue' : 'Not found'), noindex] }),
  notFoundComponent: () => (
    <div className="page">
      <div className="card empty">
        <h1 className="head">Not found.</h1>
        <SocialLink className="btn sm" to="/social">
          Back to the Floor
        </SocialLink>
      </div>
    </div>
  ),
  component: Review,
});

type Queue = Awaited<ReturnType<typeof reviewQueue>>;
/** Tells the page how a decision went: the note on success, the refusal's message when it is not about a field. */
type Settle = (outcome: Outcome<unknown> | null, decided: Decided) => void;

function Review() {
  const data = Route.useLoaderData();
  const tab: Tab = Route.useSearch().tab ?? 'accounts';
  const [done, setDone] = useState<Decided | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ platform: string; handle: string; url: string; link: string } | null>(null);
  const [teamInvited, setTeamInvited] = useState<{ email: string; link: string; emailed: boolean } | null>(null);

  useEffect(() => {
    setDone(null);
    setFailure(null);
    setInvited(null);
    setTeamInvited(null);
  }, [tab]);

  const settle: Settle = (outcome, decided) => {
    if (!outcome) return;
    setFailure(outcome.ok || Object.keys(outcome.fields).length ? null : outcome.message);
    setDone(outcome.ok ? decided : null);
    if (!outcome.ok) return;
    setInvited(null);
    setTeamInvited(null);
  };

  const counts: Record<Tab, number> = {
    accounts: data.queue.accounts.length,
    credentials: data.queue.credentials.length,
    documents: data.queue.documents.length,
    nominations: data.nominations.pending.length,
    reports: data.reports.length,
    requests: data.requests.length,
    invites: data.teamInvites.filter((i) => i.state === 'live').length,
  };

  return (
    <div className="page narrow">
      <p className="note tip plain">
        <svg aria-hidden="true">
          <use href="#i-shield" />
        </svg>
        <span>Team view. Members never see this page.</span>
      </p>
      <div className="page-head">
        <div>
          <p className="kicker">Review queue</p>
          <h1 className="title">Check before it goes public.</h1>
          <p className="lead">{GUIDANCE[tab]}</p>
        </div>
      </div>
      <nav className="chips" aria-label="Queue">
        {TABS.map((t) => (
          <SocialLink key={t.id} className="chip" to="/social/review" search={{ tab: t.id }} current={t.id === tab}>
            {t.label} · {counts[t.id]}
          </SocialLink>
        ))}
      </nav>
      {done && (
        <p className="note" role="status">
          {DONE[done]}
        </p>
      )}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      {invited && (
        <div className="invite-link">
          <p>
            <b>
              Invite link for @{invited.handle} on {invited.platform}.
            </b>{' '}
            Send it to them by direct message. It shows only now: make a new one if you lose it.
          </p>
          <CopyLink id="invite-link" link={invited.link}>
            <a className="btn sm ghost" href={invited.url} target="_blank" rel="noopener noreferrer">
              Open {invited.platform} profile<span className="sr-only"> (new tab)</span>
            </a>
          </CopyLink>
        </div>
      )}
      {teamInvited && (
        <div className="invite-link">
          <p>
            <b>Invite for {teamInvited.email}.</b> {teamInvited.emailed ? 'We emailed it.' : 'The email did not go: send the link yourself.'} It shows only now.
          </p>
          <CopyLink id="team-invite-link" link={teamInvited.link} />
        </div>
      )}
      {tab === 'requests' && <Requests data={data} settle={settle} />}
      {tab === 'invites' && (
        <Invites
          data={data}
          settle={settle}
          onInvited={(sent) => {
            setDone(null);
            setFailure(null);
            setTeamInvited(sent);
          }}
          onRefused={(message) => {
            setDone(null);
            setFailure(message);
          }}
        />
      )}
      {tab === 'nominations' && (
        <Nominations
          data={data}
          settle={settle}
          onInvited={(link) => {
            setDone(null);
            setFailure(null);
            setInvited(link);
          }}
        />
      )}
      {tab === 'reports' && <Reports data={data} settle={settle} />}
      {(tab === 'accounts' || tab === 'credentials' || tab === 'documents') && <Claims tab={tab} data={data} settle={settle} />}
    </div>
  );
}

function Empty() {
  return (
    <li className="empty card">
      <p>Queue clear.</p>
    </li>
  );
}

/** A form with one button that posts one id. */
function OneButton({ run, busy, className, children }: { run: () => Promise<void>; busy: boolean; className: string; children: ReactNode }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run();
  };
  return (
    <form method="POST" onSubmit={submit}>
      <button className={className} type="submit" disabled={busy}>
        {children}
      </button>
    </form>
  );
}

function Requests({ data, settle }: { data: Queue; settle: Settle }) {
  return (
    <ul className="queue">
      {data.requests.length === 0 && <Empty />}
      {data.requests.map((r) => (
        <RequestItem key={r.id} request={r} settle={settle} />
      ))}
    </ul>
  );
}

function RequestItem({ request: r, settle }: { request: Queue['requests'][number]; settle: Settle }) {
  const approve = useAction(approveRequest);
  const decline = useAction(declineRequest);
  return (
    <li className="queue-item card">
      <div className="facts">
        <p>
          <b>{r.name}</b> · {r.email}
        </p>
        <p>“{r.about}”</p>
        {r.link && (
          <p>
            <a href={r.link} target="_blank" rel="noopener noreferrer nofollow">
              {r.link}
              <span className="sr-only"> (new tab)</span>
            </a>
          </p>
        )}
        {r.onSocial && (
          <p>
            Already on Social as <SocialLink to="/social/@{$handle}" params={{ handle: r.onSocial }}>@{r.onSocial}</SocialLink>.
          </p>
        )}
      </div>
      <span className="ago">{formatDay(r.createdAt)}</span>
      <div className="actions">
        <OneButton className="btn sm" busy={approve.busy || decline.busy} run={async () => settle(await approve.run({ request: r.id }), 'request-approved')}>
          Approve<span className="sr-only">: {r.name}</span>
        </OneButton>
        <OneButton className="btn sm ghost" busy={approve.busy || decline.busy} run={async () => settle(await decline.run({ request: r.id }), 'request-declined')}>
          Decline<span className="sr-only">: {r.name}</span>
        </OneButton>
      </div>
    </li>
  );
}

function Invites({
  data,
  settle,
  onInvited,
  onRefused,
}: {
  data: Queue;
  settle: Settle;
  onInvited: (sent: { email: string; link: string; emailed: boolean }) => void;
  onRefused: (message: string | null) => void;
}) {
  const invite = useAction(teamInvite);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const outcome = await invite.run({ email: String(fields.get('email') ?? ''), name: String(fields.get('name') ?? '') });
    if (!outcome) return;
    if (!outcome.ok) return onRefused(Object.keys(outcome.fields).length ? null : outcome.message);
    form.reset();
    onInvited(outcome.value);
  };

  return (
    <>
      <form className="panel card" method="POST" ref={invite.form} onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input
            className="input"
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            aria-invalid={invite.error('email') ? true : undefined}
            aria-describedby={invite.error('email') ? 'invite-email-error' : undefined}
          />
          {invite.error('email') && (
            <span className="error" id="invite-email-error">
              {invite.error('email')}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="invite-name">Name · optional</label>
          <input
            className="input"
            id="invite-name"
            name="name"
            maxLength={60}
            autoComplete="off"
            aria-invalid={invite.error('name') ? true : undefined}
            aria-describedby={invite.error('name') ? 'invite-name-error' : undefined}
          />
          {invite.error('name') && (
            <span className="error" id="invite-name-error">
              {invite.error('name')}
            </span>
          )}
        </div>
        <div className="panel-foot">
          <span className="small">They pick a handle and set a password. Sending again replaces the earlier link.</span>
          <button className="btn" type="submit" disabled={invite.busy}>
            Send invite
          </button>
        </div>
      </form>
      <ul className="queue">
        {data.teamInvites.map((i) => (
          <TeamInviteItem key={i.id} invite={i} settle={settle} />
        ))}
      </ul>
    </>
  );
}

function TeamInviteItem({ invite: i, settle }: { invite: Queue['teamInvites'][number]; settle: Settle }) {
  const withdraw = useAction(withdrawTeamInvite);
  return (
    <li className="queue-item card">
      <div className="facts">
        <p>
          <b>{i.name ? `${i.name} · ${i.email}` : i.email}</b>
        </p>
        <p>
          {INVITE_STATE[i.state]}
          {i.state === 'used' && i.usedBy && (
            <>
              {' '}
              by <SocialLink to="/social/@{$handle}" params={{ handle: i.usedBy }}>@{i.usedBy}</SocialLink>
            </>
          )}
          {i.state === 'live' && ` · works until ${formatDay(i.expiresAt)}`}
        </p>
      </div>
      <span className="ago">{formatDay(i.createdAt)}</span>
      {i.state === 'live' && (
        <div className="actions">
          <OneButton className="btn sm ghost" busy={withdraw.busy} run={async () => settle(await withdraw.run({ invite: i.id }), 'invite-withdrawn')}>
            Withdraw<span className="sr-only">: {i.email}</span>
          </OneButton>
        </div>
      )}
    </li>
  );
}

type InviteLink = { platform: string; handle: string; url: string; link: string };

function Nominations({ data, settle, onInvited }: { data: Queue; settle: Settle; onInvited: (link: InviteLink) => void }) {
  const all = [...data.nominations.pending, ...data.nominations.invited];
  return (
    <ul className="queue">
      {all.length === 0 && <Empty />}
      {all.map((n) => (
        <NominationItem key={n.id} nomination={n} settle={settle} onInvited={onInvited} />
      ))}
    </ul>
  );
}

function NominationItem({ nomination: n, settle, onInvited }: { nomination: Queue['nominations']['pending'][number]; settle: Settle; onInvited: (link: InviteLink) => void }) {
  const invite = useAction(inviteNomination);
  const relink = useAction(relinkNomination);
  const reject = useAction(rejectNomination);
  const busy = invite.busy || relink.busy || reject.busy;

  const send = async () => {
    const outcome = n.invitedAt ? await relink.run({ nomination: n.id }) : await invite.run({ nomination: n.id });
    if (!outcome) return;
    if (outcome.ok) onInvited(outcome.value);
    else settle(outcome, 'nomination-rejected');
  };

  return (
    <li className="queue-item card">
      <div className="facts">
        <p>
          <b>
            {n.platform} · @{n.handle}
          </b>{' '}
          · {people(n.nominators)}
          {n.invitedAt && ` · invited ${formatDay(n.invitedAt)}`}
        </p>
        {n.topics.length > 0 && <p>Posts about {n.topics.join(', ')}</p>}
        <p>
          <a href={n.url} target="_blank" rel="noopener noreferrer">
            Open {n.platform} profile<span className="sr-only"> (new tab)</span>
          </a>
        </p>
        {n.links.length > 0 && (
          <ul>
            {n.links.map((link) => (
              <li key={link}>
                <a href={link} target="_blank" rel="noopener noreferrer nofollow">
                  {link}
                  <span className="sr-only"> (new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <span className="ago">{formatDay(n.createdAt)}</span>
      <div className="actions">
        <OneButton className="btn sm" busy={busy} run={send}>
          {n.invitedAt ? 'Make a new link' : 'Invite'}
          <span className="sr-only">: @{n.handle}</span>
        </OneButton>
        <OneButton className="btn sm ghost" busy={busy} run={async () => settle(await reject.run({ nomination: n.id }), 'nomination-rejected')}>
          {n.invitedAt ? 'Withdraw invite' : 'Don’t invite'}
          <span className="sr-only">: @{n.handle}</span>
        </OneButton>
      </div>
    </li>
  );
}

function Reports({ data, settle }: { data: Queue; settle: Settle }) {
  return (
    <ul className="queue">
      {data.reports.length === 0 && <Empty />}
      {data.reports.map((item) => (
        <ReportItem key={`${item.target}-${item.targetId}`} item={item} settle={settle} />
      ))}
    </ul>
  );
}

function ReportItem({ item, settle }: { item: Queue['reports'][number]; settle: Settle }) {
  const hide = useAction(hideReported);
  const dismiss = useAction(dismissReported);
  const target = { target: item.target, id: item.targetId };
  const busy = hide.busy || dismiss.busy;
  return (
    <li className="queue-item card">
      <div className="facts">
        <p>
          <b>{WHAT[item.target]}</b> by{' '}
          {item.member.handle ? (
            <SocialLink to="/social/@{$handle}" params={{ handle: item.member.handle }}>
              {item.member.name} (@{item.member.handle})
            </SocialLink>
          ) : (
            item.member.name
          )}
          {item.gone && ' · already off the Floor or The List'}
        </p>
        {item.summary && <p>“{item.summary}”</p>}
        <p>
          <ReportedPlace path={item.path}>Open it where it is</ReportedPlace>
        </p>
        <ul>
          {item.reports.map((r, i) => (
            <li key={i}>
              {r.reason}
              {r.note && `: ${r.note}`} · {r.reporter ? `@${r.reporter}` : 'a removed member'} · {formatDay(r.createdAt)}
            </li>
          ))}
        </ul>
      </div>
      <span className="ago">{item.reports.length === 1 ? '1 report' : `${item.reports.length} reports`}</span>
      <div className="actions">
        <OneButton className="btn sm danger" busy={busy} run={async () => settle(await hide.run(target), 'hidden')}>
          {HIDE[item.target]}
          <span className="sr-only">: {item.summary || item.member.name}</span>
        </OneButton>
        <OneButton className="btn sm ghost" busy={busy} run={async () => settle(await dismiss.run(target), 'dismissed')}>
          Dismiss<span className="sr-only">: {item.summary || item.member.name}</span>
        </OneButton>
      </div>
    </li>
  );
}

/** A link to where a reported item sits. The store writes the place as Social's own links do: /post/12, /post/12#reply-40 or /@aina. */
function ReportedPlace({ path, children }: { path: string; children: ReactNode }) {
  const post = /^\/post\/(\d+)(?:#(.+))?$/.exec(path);
  if (post?.[1])
    return (
      <SocialLink to="/social/post/$id" params={{ id: post[1] }} {...(post[2] ? { hash: post[2] } : {})}>
        {children}
      </SocialLink>
    );
  const handle = /^\/@(.+)$/.exec(path);
  if (handle?.[1])
    return (
      <SocialLink to="/social/@{$handle}" params={{ handle: handle[1] }}>
        {children}
      </SocialLink>
    );
  return <SocialLink to="/social">{children}</SocialLink>;
}

function Claims({ tab, data, settle }: { tab: 'accounts' | 'credentials' | 'documents'; data: Queue; settle: Settle }) {
  return (
    <ul className="queue">
      {data.queue[tab].length === 0 && <Empty />}
      {tab === 'accounts'
        ? data.queue.accounts.map((entry) => <AccountItem key={entry.item.id} entry={entry} settle={settle} />)
        : data.queue[tab].map((entry) => <ClaimItem key={entry.item.id} entry={entry} settle={settle} />)}
    </ul>
  );
}

type Person = Queue['queue']['accounts'][number]['member'];

function Who({ who }: { who: Person }) {
  return (
    <p>
      {who.handle ? (
        <SocialLink to="/social/@{$handle}" params={{ handle: who.handle }}>
          {who.name} (@{who.handle})
        </SocialLink>
      ) : (
        who.name
      )}{' '}
      · {who.email}
    </p>
  );
}

/** A rejection's form: it posts the reason, and shows the reason's error beside it. */
interface Rejecter {
  run: (reason: string) => Promise<Outcome<null> | null>;
  busy: boolean;
  error: string | undefined;
  form: RefObject<HTMLFormElement | null>;
}

/** Approve, or reject with a reason the member is emailed. */
function Decide({
  field,
  id,
  what,
  who,
  approveLabel,
  placeholder,
  approve,
  reject,
  settle,
}: {
  field: 'account' | 'claim';
  id: number;
  what: string;
  who: Person;
  approveLabel: string;
  placeholder: string;
  approve: () => Promise<Outcome<null> | null>;
  reject: Rejecter;
  settle: Settle;
}) {
  const [approving, setApproving] = useState(false);
  const reasonId = `reason-${field}-${id}`;
  const { error } = reject;

  const submitReject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    settle(await reject.run(reason), 'rejected');
  };

  return (
    <div className="actions">
      <OneButton
        className="btn sm"
        busy={approving || reject.busy}
        run={async () => {
          setApproving(true);
          const outcome = await approve();
          setApproving(false);
          settle(outcome, 'approved');
        }}
      >
        {approveLabel}
        <span className="sr-only">: {what}</span>
      </OneButton>
      <form className="reject" method="POST" ref={reject.form} onSubmit={submitReject} noValidate>
        <label className="label-text" htmlFor={reasonId}>
          Reason, emailed to {who.name}
        </label>
        <textarea
          className="input"
          id={reasonId}
          name="reason"
          rows={2}
          maxLength={CLAIM_LIMITS.reason}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${reasonId}-error` : undefined}
        />
        {error && (
          <span className="error" id={`${reasonId}-error`}>
            {error}
          </span>
        )}
        <button className="btn sm ghost" type="submit" disabled={approving || reject.busy}>
          Reject<span className="sr-only">: {what}</span>
        </button>
      </form>
    </div>
  );
}

function AccountItem({ entry, settle }: { entry: Queue['queue']['accounts'][number]; settle: Settle }) {
  const approve = useAction(approveAccount);
  const reject = useAction(rejectAccount);
  const { item, member: who } = entry;
  const what = `${item.platform} · @${item.handle}`;
  return (
    <li className="queue-item card">
      <div className="facts">
        <p>
          <Tick source="account" state="pending" /> <b>{what}</b>
        </p>
        <Who who={who} />
        <p>
          Code to look for: <code>{item.code}</code>
        </p>
        <p>
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            Open {item.platform} profile<span className="sr-only"> (new tab)</span>
          </a>
        </p>
      </div>
      <span className="ago">{formatDay(item.createdAt)}</span>
      <Decide
        field="account"
        id={item.id}
        what={what}
        who={who}
        approveLabel="Proven"
        placeholder="The code was not in the bio."
        approve={() => approve.run({ account: item.id })}
        reject={{ run: (reason) => reject.run({ account: item.id, reason }), busy: reject.busy, error: reject.error('reason'), form: reject.form }}
        settle={settle}
      />
    </li>
  );
}

function ClaimItem({ entry, settle }: { entry: Queue['queue']['credentials'][number]; settle: Settle }) {
  const approve = useAction(approveClaim);
  const reject = useAction(rejectClaim);
  const { item, member: who } = entry;
  const body = item.bodyId ? bodyById(item.bodyId) : undefined;
  return (
    <li className="queue-item card">
      <div className="facts">
        <p>
          <Tick source={item.source} state="pending" /> <b>{item.label}</b>
        </p>
        <Who who={who} />
        {item.status && <p>Exact status: {item.status}. Show it as written, never rounded up.</p>}
        {item.kind === 'academic' && item.reference ? (
          <p>
            <a href={item.reference} target="_blank" rel="noopener noreferrer">
              Open the page they gave<span className="sr-only"> (new tab)</span>
            </a>{' '}
            · {item.reference}
          </p>
        ) : (
          item.reference && <p>Number they gave: {item.reference}</p>
        )}
        {item.until && <p>Runs to: {formatMonth(item.until)}</p>}
        {body?.site && (
          <p>
            <a href={body.site} target="_blank" rel="noopener noreferrer">
              Open the {body.name} site<span className="sr-only"> (new tab)</span>
            </a>
          </p>
        )}
        {item.hasEvidence && (
          <p>
            {/* A download, so a full request: the router never handles it. */}
            <a href={socialHref(`/review/evidence/${item.id}`)}>Download the document</a>
          </p>
        )}
      </div>
      <span className="ago">{formatDay(item.createdAt)}</span>
      <Decide
        field="claim"
        id={item.id}
        what={item.label}
        who={who}
        approveLabel="Approve tick"
        placeholder="We could not find you on the register."
        approve={() => approve.run({ claim: item.id })}
        reject={{ run: (reason) => reject.run({ claim: item.id, reason }), busy: reject.busy, error: reject.error('reason'), form: reject.form }}
        settle={settle}
      />
    </li>
  );
}
