import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { listOf } from '../../../../../src/lib/format.ts';
import { pageStatus } from '../../../components/social/status.ts';
import { useAction } from '../../../components/social/useAction.ts';
import { claimNomination, claimPage, declineNomination } from '../../../functions/social-nominations.ts';
import { socialHref } from '../../../lib/links.ts';
import { noindex, socialTitle } from '../../../lib/title.ts';

export const Route = createFileRoute('/social/claim/$token')({
  validateSearch: z.object({ confirm: z.literal('decline').optional().catch(undefined), done: z.literal('declined').optional().catch(undefined) }),
  loader: async ({ params }) => {
    const page = await claimPage({ data: params.token });
    if (!page.invitation) pageStatus(404);
    return page;
  },
  head: () => ({ meta: [...socialTitle('Your invite'), { name: 'description', content: 'People in accountancy want to follow you on The Rest Is Accountancy Social.' }, noindex] }),
  component: Claim,
});

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

function Claim() {
  const { invitation, signedIn, hasProfile } = Route.useLoaderData();
  const { token } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const claim = useAction(claimNomination, { refresh: false });
  const decline = useAction(declineNomination);
  const done = search.done === 'declined' && !invitation;
  const confirming = search.confirm === 'decline' || decline.refusal !== null;
  const failure = claim.refusal?.message ?? decline.refusal?.message ?? null;
  const here = { to: '/social/claim/$token', params: { token } } as const;

  const claimIt = async () => {
    const outcome = await claim.run({ token });
    /* The account waits on Get ticked for its proof. A full load: that page is not part of this app's routes yet. */
    if (outcome?.ok) window.location.assign(socialHref('/verify?step=account&done=addAccount'));
  };
  const declineIt = async () => {
    const outcome = await decline.run({ token });
    if (outcome?.ok) await navigate({ ...here, search: { done: 'declined' } });
  };

  if (done)
    return (
      <div className="page narrow">
        <section className="claim card" aria-labelledby="claim-title">
          <p className="kicker">Invite</p>
          <h1 className="title" id="claim-title">
            Deleted.
          </h1>
          <p className="lead">We removed the nomination and won’t invite you again.</p>
          <Link className="btn" to="/social">
            Go to the Floor
          </Link>
        </section>
      </div>
    );

  if (!invitation)
    return (
      <div className="page narrow">
        <div className="card empty">
          <h1 className="head">This invite has been used or withdrawn.</h1>
          <p>If you were sent it and it never worked, write to the team, or ask to join and the team reads your request.</p>
          <div className="actions">
            <Link className="btn sm" to="/social/request">
              Request to join
            </Link>
            <Link className="btn sm ghost" to="/social">
              Go to the Floor
            </Link>
          </div>
        </div>
      </div>
    );

  return (
    <div className="page narrow">
      <section className="claim card" aria-labelledby="claim-title">
        <span className="tape slap" aria-hidden="true">
          you’re on the list
        </span>
        <p className="kicker">Invite · {invitation.platform}</p>
        <h1 className="title" id="claim-title">
          @{invitation.handle}, people want to follow you here.
        </h1>
        <p className="lead">
          {people(invitation.nominators)} nominated you for your posts on {invitation.topics.length ? listOf(invitation.topics) : 'accountancy'}.
        </p>
        <div className="claim-grid">
          <div>
            <p className="kicker">Public right now</p>
            <p>
              <b>Nothing.</b> Your listing stays private until you claim it.
            </p>
          </div>
          <div>
            <p className="kicker">If you claim it</p>
            <ul className="plain-list">
              <li>Your handle shows on The List.</li>
              <li>You add ticks for your credentials.</li>
              <li>You can leave any time.</li>
            </ul>
          </div>
        </div>
        {failure && (
          <p className="error" role="alert">
            {failure}
          </p>
        )}
        {confirming ? (
          <div className="confirm" role="group" aria-labelledby="decline-title">
            <p id="decline-title">
              <b>Delete this nomination?</b> We won’t invite you again.
            </p>
            <div className="confirm-actions">
              <button className="btn sm danger" type="button" onClick={declineIt} autoFocus>
                Delete nomination
              </button>
              <Link className="btn sm ghost" {...here} search={{}}>
                Keep it
              </Link>
            </div>
          </div>
        ) : (
          <div className="actions">
            {!signedIn ? (
              <Link className="btn" to="/social/sign-up" search={{ nomination: token }}>
                Claim and get ticked
              </Link>
            ) : hasProfile ? (
              <button className="btn" type="button" onClick={claimIt}>
                Claim and get ticked
              </button>
            ) : (
              <Link className="btn" to="/social/edit">
                Claim your handle first
              </Link>
            )}
            <Link className="btn ghost" {...here} search={{ confirm: 'decline' }}>
              Not for me
            </Link>
          </div>
        )}
        {signedIn && !hasProfile && <p className="small">Pick your handle, then open this link again to claim the invite.</p>}
        {!signedIn && <p className="small">You join with your name and email. We never see your {invitation.platform} password.</p>}
      </section>
    </div>
  );
}
