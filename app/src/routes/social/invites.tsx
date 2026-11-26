import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { INVITE_DAYS, MEMBER_INVITES } from '../../../../src/data/social.ts';
import { formatDay } from '../../../../src/lib/format.ts';
import type { InviteState } from '../../../../src/server/social-invites.ts';
import { useAction } from '../../components/social/useAction.ts';
import { useCopy } from '../../components/social/useCopy.ts';
import { createInvite, invitesPage, revokeInvite } from '../../functions/social-invites.ts';
import { socialHref, socialSignInHref } from '../../lib/links.ts';
import { noindex, socialTitle } from '../../lib/title.ts';

/* A member's invite links. Each works once, for INVITE_DAYS; the link shows once, since only its hash is kept. */
export const Route = createFileRoute('/social/invites')({
  beforeLoad: ({ context }) => {
    if (!context.member) throw redirect({ href: socialSignInHref('/invites') });
  },
  loader: async () => {
    const page = await invitesPage();
    if (!page) throw redirect({ href: socialSignInHref('/invites') });
    if (!page.hasProfile) throw redirect({ to: '/social/edit' });
    return page;
  },
  head: () => ({ meta: [...socialTitle('Invites'), noindex] }),
  component: Invites,
});

const STATE: Record<InviteState, string> = { live: 'Unused', used: 'Used', expired: 'Ran out', revoked: 'Revoked' };
const left = (n: number) => (n === 1 ? '1 invite left' : `${n} invites left`);

function Invites() {
  const { allowance, mine } = Route.useLoaderData();
  const create = useAction(createInvite);
  const revoke = useAction(revokeInvite);
  const [link, setLink] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const { ready, status, copy } = useCopy();
  const failure = create.refusal?.message ?? revoke.refusal?.message ?? null;

  const make = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRevoked(false);
    const outcome = await create.run(undefined);
    if (outcome?.ok) setLink(outcome.value.link);
  };
  const takeBack = async (invite: number) => {
    const outcome = await revoke.run({ invite });
    if (outcome?.ok) setRevoked(true);
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <p className="kicker">Invites</p>
          <h1 className="title">Bring someone in.</h1>
          <p className="lead">Social is invite-only. Invite people you know from the profession: their profile says you invited them.</p>
        </div>
      </div>
      {revoked && (
        <p className="note" role="status">
          Revoked. The link no longer works, and the invite is yours again.
        </p>
      )}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      {link && (
        <div className="invite-link">
          <p>
            <b>Your invite link.</b> Send it to one person. It works once, for {INVITE_DAYS} days, and shows only now: revoke it and make another if you lose it.
          </p>
          <label className="label-text" htmlFor="invite-link">
            Invite link
          </label>
          <input className="input" id="invite-link" readOnly value={link} autoFocus />
          <div className="actions">
            <button className="btn sm" type="button" hidden={!ready} onClick={() => copy('invite-link')}>
              Copy link
            </button>
          </div>
          <p className="small" aria-live="polite">
            {status}
          </p>
        </div>
      )}
      <section className="panel card" aria-labelledby="make-title">
        <h2 className="head" id="make-title">
          {allowance.eligible ? left(allowance.left) : 'Invites open once you are ticked'}
        </h2>
        {allowance.eligible ? (
          <>
            <p>You have {MEMBER_INVITES} in all. A used one is spent; revoke one nobody has used and it comes back, as does one that runs out.</p>
            {allowance.left > 0 && (
              <form method="POST" onSubmit={make}>
                <button className="btn" type="submit">
                  Make an invite link
                </button>
              </form>
            )}
          </>
        ) : (
          <>
            <p>Every account here is one we know, so invites come from members with at least one ticked credential: a body, a licence, your work email or your workplace.</p>
            <a className="btn sm" href={socialHref('/verify')}>
              Get ticked
            </a>
          </>
        )}
      </section>
      {mine.length > 0 && (
        <section className="panel card" aria-labelledby="sent-title">
          <h2 className="head" id="sent-title">
            Your links
          </h2>
          <ul className="queue">
            {mine.map((invite) => (
              <li key={invite.id} className="queue-item">
                <div className="facts">
                  <p>
                    <b>{STATE[invite.state]}</b>
                    {invite.state === 'used' && invite.usedBy && (
                      <>
                        {' '}
                        by{' '}
                        <Link to="/social/@{$handle}" params={{ handle: invite.usedBy }}>
                          @{invite.usedBy}
                        </Link>
                      </>
                    )}
                    {invite.state === 'live' && ` · works until ${formatDay(invite.expiresAt)}`}
                  </p>
                </div>
                <span className="ago">Made {formatDay(invite.createdAt)}</span>
                {invite.state === 'live' && (
                  <div className="actions">
                    <button className="btn sm ghost" type="button" onClick={() => takeBack(invite.id)}>
                      Revoke<span className="sr-only">: the link made {formatDay(invite.createdAt)}</span>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
