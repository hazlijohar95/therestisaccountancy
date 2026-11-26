import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { SocialLink } from '../../components/social/SocialLink.tsx';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { LINK_DAYS } from '../../../../src/data/links.ts';
import { HANDLE, socialHost } from '../../../../src/data/social.ts';
import { pageStatus } from '../../components/social/status.ts';
import { fieldError, useAction } from '../../components/useAction.ts';
import { signUpPage, socialSignUp, useInvite } from '../../functions/social-invites.ts';
import { clubHref, socialSignInHref } from '../../lib/links.ts';
import { noindex, socialTitle } from '../../lib/title.ts';

/* The router reads an all-digit token as a number, so every value counts as text here. */
const token = z.union([z.string(), z.number()]).transform(String).optional().catch(undefined);

/*
 * Social is invite-only, so this page is where a link lands: an invite (?invite=) or a nomination the nominee claims
 * (?nomination=). Only the token travels with the form; what it lets in is read again by the server. Without a link,
 * the way in is to ask.
 */
export const Route = createFileRoute('/social/sign-up')({
  validateSearch: z.object({ invite: token, nomination: token }),
  beforeLoad: ({ context, search }) => {
    if (!search.invite && !search.nomination) throw redirect({ to: '/social/request' });
    if (context.member && search.nomination) throw redirect({ to: '/social/claim/$token', params: { token: search.nomination } });
  },
  loaderDeps: ({ search }) => ({ invite: search.invite ?? '', nomination: search.nomination ?? '' }),
  loader: async ({ deps }) => {
    const page = await signUpPage({ data: deps });
    const live = page.look?.state === 'live';
    if (deps.invite ? !live : !page.invitation) pageStatus(404);
    return page;
  },
  head: ({ loaderData }) => ({
    meta: [...socialTitle(loaderData && (loaderData.look ? loaderData.look.state === 'live' : loaderData.invitation) ? 'Join' : 'Invite'), { name: 'description', content: 'Join The Rest Is Accountancy Social with an invite.' }, noindex],
  }),
  component: SignUp,
});

const DEAD = { used: 'This invite has been used.', expired: 'This invite has run out.', revoked: 'This invite was withdrawn.', unknown: 'This invite link does not work.' } as const;

function SignUp() {
  const page = Route.useLoaderData();
  const { invite = '', nomination = '' } = Route.useSearch();
  const live = page.look?.state === 'live' ? page.look : null;
  const { invitation, member } = page;
  /* After joining, the form says to check email; the link it spent is not read again. */
  const dead = invite ? !live : !invitation;
  const from = live ? (live.team ? 'the team' : live.inviter) : null;

  if (dead)
    return (
      <div className="page narrow">
        <section className="card empty" aria-labelledby="dead-title">
          <p className="kicker">Invite</p>
          <h1 className="head" id="dead-title">
            {page.look && page.look.state !== 'live' ? DEAD[page.look.state] : 'This invite has been used or withdrawn.'}
          </h1>
          <p>Invite links work once, for a limited time. Ask whoever sent it for a new one, or ask to join and the team reads your request.</p>
          <div className="actions">
            <SocialLink className="btn sm" to="/social/request">
              Request to join
            </SocialLink>
            <SocialLink className="btn sm ghost" to="/social">
              Read the Floor
            </SocialLink>
          </div>
        </section>
      </div>
    );

  if (member)
    return (
      <div className="page narrow">
        <section className="panel card" aria-labelledby="in-title">
          <p className="kicker">Invite from {from}</p>
          {page.handle ? (
            <>
              <h1 className="head" id="in-title">
                You are on Social already.
              </h1>
              <p>This invite is for someone new. Pass it on, or leave it: it runs out by itself.</p>
              <SocialLink className="btn sm" to="/social/@{$handle}" params={{ handle: page.handle }}>
                Go to your profile
              </SocialLink>
            </>
          ) : page.inAlready ? (
            <>
              <h1 className="head" id="in-title">
                You can pick your handle now.
              </h1>
              <p>Signed in as {member.name}, you need no invite. Leave this one for someone new.</p>
              <SocialLink className="btn sm" to="/social/edit">
                Pick your handle
              </SocialLink>
            </>
          ) : (
            <UseInvite name={member.name} invite={invite} />
          )}
        </section>
      </div>
    );

  return <JoinForm invite={invite} nomination={nomination} from={from} name={live?.name ?? ''} email={live?.email ?? ''} invitation={invitation} />;
}

function UseInvite({ name, invite }: { name: string; invite: string }) {
  const use = useAction(useInvite, { refresh: 'never' });
  const navigate = useNavigate();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await use.run({ token: invite });
    if (outcome?.ok) await navigate({ to: '/social/edit' });
  };
  return (
    <>
      <h1 className="head" id="in-title">
        Use this invite.
      </h1>
      <p>Signed in as {name}. Use the invite, then pick the handle people find you by.</p>
      {use.refusal && (
        <p className="error" role="alert">
          {use.refusal.message}
        </p>
      )}
      <form method="POST" onSubmit={submit}>
        <button className="btn" type="submit">
          Use the invite
        </button>
      </form>
    </>
  );
}

function JoinForm({ invite, nomination, from, name, email, invitation }: { invite: string; nomination: string; from: string | null; name: string; email: string; invitation: { platform: string; handle: string } | null }) {
  const [form, setForm] = useState({ name, email, handle: invitation && HANDLE.pattern.test(invitation.handle) ? invitation.handle : '', trap: '' });
  const [joined, setJoined] = useState<{ email: string; claimed: boolean } | null>(null);
  const join = useAction(socialSignUp, { refresh: 'never' });
  /* Someone who already has an account signs in and comes back to this link, not to a blank profile. */
  const afterSignIn = nomination ? `/claim/${encodeURIComponent(nomination)}` : `/sign-up?invite=${encodeURIComponent(invite)}`;
  const signIn = socialSignInHref(afterSignIn);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await join.run({ ...form, invite, nomination });
    if (!outcome) return;
    if (!outcome.ok) {
      const first = (['name', 'email', 'handle'] as const).find((field) => outcome.fields[field]);
      if (first) document.getElementById(first)?.focus();
      return;
    }
    setJoined(outcome.value);
  };
  const refusal = join.refusal;
  const nameError = fieldError(refusal, 'name');
  const emailError = fieldError(refusal, 'email', { hint: 'email-hint' });
  const handleError = fieldError(refusal, 'handle', { hint: 'handle-hint' });
  const failure = join.failure;

  if (joined)
    return (
      <div className="page narrow">
        <section className="panel card" aria-labelledby="done-title">
          <p className="kicker">Almost there</p>
          <h1 className="head" id="done-title">
            Check your email.
          </h1>
          <p>
            We sent a link to <b>{joined.email}</b>. Set a password with it and your profile goes live. The link works for {LINK_DAYS.welcome} days.
          </p>
          {joined.claimed && <p>Your invited account waits in Get ticked. Put the code we give you in its bio, and the team proves it.</p>}
          <p className="small">
            No email? Check spam, or <a href={clubHref('/forgot')}>ask for a new link</a>.
          </p>
        </section>
      </div>
    );

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <p className="kicker">{invitation ? 'Claim your invite' : `Invite from ${from}`}</p>
          <h1 className="title">Claim your handle.</h1>
          <p className="lead">Social is free, and invite-only. Post, answer the weekly problem and get your credentials ticked.</p>
        </div>
      </div>
      {invitation && (
        <p className="note plain" role="note">
          Claiming <b>@{invitation.handle}</b> on {invitation.platform}. It goes to Get ticked for proof once you are in.
        </p>
      )}
      <form className="panel card" method="POST" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" required maxLength={60} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={nameError.invalid} aria-describedby={nameError.describedBy} />
          {nameError.error && (
            <span className="error" id={nameError.errorId}>
              {nameError.error}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-invalid={emailError.invalid} aria-describedby={emailError.describedBy} />
          <span className="hint" id="email-hint">
            We send a link here to set your password. Nobody else sees it.
          </span>
          {emailError.error && (
            <span className="error" id={emailError.errorId}>
              {emailError.error} <a href={signIn}>Sign in</a> and use the invite there, or <a href={clubHref('/forgot')}>get a new link</a> if you never set a password.
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="handle">Handle</label>
          <div className="prefix">
            <input className="input" id="handle" name="handle" required minLength={HANDLE.min} maxLength={HANDLE.max} autoCapitalize="none" autoComplete="nickname" spellCheck={false} value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} aria-invalid={handleError.invalid} aria-describedby={handleError.describedBy} />
          </div>
          <span className="hint" id="handle-hint">
            {HANDLE.min} to {HANDLE.max} lowercase letters, digits or underscores. Your page is {socialHost}/@handle.
          </span>
          {handleError.error && (
            <span className="error" id={handleError.errorId}>
              {handleError.error}
            </span>
          )}
        </div>
        <div className="trap" aria-hidden="true">
          <label htmlFor="signup-trap">Leave this empty</label>
          <input id="signup-trap" name="trap" type="text" tabIndex={-1} autoComplete="off" data-1p-ignore data-lpignore="true" value={form.trap} onChange={(e) => setForm({ ...form, trap: e.target.value })} />
        </div>
        {failure && (
          <p className="error" role="alert">
            {failure}
          </p>
        )}
        <div className="panel-foot">
          <span className="small">
            Have an account? <a href={signIn}>Sign in</a> and use the invite there.
          </span>
          <button className="btn" type="submit">
            Join
          </button>
        </div>
      </form>
    </div>
  );
}
