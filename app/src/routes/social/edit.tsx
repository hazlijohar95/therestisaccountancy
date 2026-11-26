import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { SocialLink } from '../../components/social/SocialLink.tsx';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import { HANDLE, JURISDICTIONS, PROFILE_LIMITS, SECTORS, socialHost, TOPICS } from '../../../../src/data/social.ts';
import { fieldError, useAction } from '../../components/useAction.ts';
import { signOut } from '../../functions/auth.ts';
import { editPage, saveProfile } from '../../functions/social-profiles.ts';
import { socialHref, socialSignInHref } from '../../lib/links.ts';
import { noindex, socialTitle } from '../../lib/title.ts';
import s from './edit.module.css';

export const Route = createFileRoute('/social/edit')({
  beforeLoad: ({ context }) => {
    if (!context.member) throw redirect({ href: socialSignInHref('/edit') });
  },
  loader: async () => {
    const page = await editPage();
    if (!page) throw redirect({ href: socialSignInHref('/edit') });
    return page;
  },
  head: ({ loaderData }) => ({ meta: [...socialTitle(loaderData?.profile ? 'Edit profile' : 'Claim your handle'), noindex] }),
  component: Edit,
});

const toggled = <T extends string>(list: readonly T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((entry) => entry !== value));

function Edit() {
  const { name, email, profile, mayClaim } = Route.useLoaderData();
  const out = useServerFn(signOut);
  const leave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await out();
    /* A full load, so the header and every host see the session end. */
    window.location.assign(socialHref('/'));
  };
  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <p className="kicker">Your profile</p>
          <h1 className="title">{profile ? 'Edit profile.' : 'Claim your handle.'}</h1>
          {!profile && <p className="lead">Signed in as {name}. Pick the handle people find you by.</p>}
        </div>
      </div>
      {!mayClaim ? (
        <section className="panel card" aria-labelledby="closed-title">
          <h2 className="head" id="closed-title">
            Social is invite-only.
          </h2>
          <p>Every account here is one we know. Open the invite link someone sent you, signed in as you are now, or ask to join and the team reads your request.</p>
          <SocialLink className="btn sm" to="/social/request">
            Request to join
          </SocialLink>
        </section>
      ) : (
        <ProfileForm profile={profile} />
      )}
      <form className={s.signout} method="POST" onSubmit={leave}>
        <p className="small">
          Signed in as {email}.{' '}
          <button className="linkish" type="submit">
            Sign out
          </button>
        </p>
      </form>
    </div>
  );
}

type Loaded = ReturnType<typeof Route.useLoaderData>;

function ProfileForm({ profile }: { profile: Loaded['profile'] }) {
  const [form, setForm] = useState({
    handle: '',
    headline: profile?.headline ?? '',
    sector: profile?.sector ?? '',
    city: profile?.city ?? '',
    jurisdictions: profile?.jurisdictions ?? [],
    topics: profile?.topics ?? [],
    creator: profile?.creator ?? false,
    listed: profile?.listed ?? true,
  });
  const save = useAction(saveProfile, { refresh: 'never' });
  const navigate = useNavigate();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { handle, ...fields } = form;
    const outcome = await save.run({ ...fields, ...(profile ? {} : { handle }) });
    if (!outcome) return;
    if (!outcome.ok) {
      const first = (['handle', 'headline', 'sector', 'city'] as const).find((field) => outcome.fields[field]);
      if (first) document.getElementById(first)?.focus();
      return;
    }
    await navigate({ to: '/social/@{$handle}', params: { handle: outcome.value.handle } });
  };
  const refusal = save.refusal;
  const handle = fieldError(refusal, 'handle', { hint: 'handle-hint' });
  const headline = fieldError(refusal, 'headline', { hint: 'headline-hint' });
  const sector = fieldError(refusal, 'sector');
  const city = fieldError(refusal, 'city');
  const failure = save.failure;
  return (
    <form className="panel card" method="POST" onSubmit={submit} noValidate>
      {!profile && (
        <div className="field">
          <label htmlFor="handle">Handle</label>
          <div className="prefix">
            <input className="input" id="handle" name="handle" required minLength={HANDLE.min} maxLength={HANDLE.max} autoCapitalize="none" spellCheck={false} value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} aria-invalid={handle.invalid} aria-describedby={handle.describedBy} />
          </div>
          <span className="hint" id="handle-hint">
            {HANDLE.min} to {HANDLE.max} lowercase letters, digits or underscores. Your page is {socialHost}/@handle. You cannot change it later.
          </span>
          {handle.error && (
            <span className="error" id={handle.errorId}>
              {handle.error}
            </span>
          )}
        </div>
      )}
      <div className="field">
        <label htmlFor="headline">Headline</label>
        <textarea className="input" id="headline" name="headline" rows={2} maxLength={PROFILE_LIMITS.headline} placeholder="Tax agent. Explains Malaysian tax one case at a time." value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} aria-invalid={headline.invalid} aria-describedby={headline.describedBy} />
        <span className="hint" id="headline-hint">
          Up to {PROFILE_LIMITS.headline} characters. One line on what you post about.
        </span>
        {headline.error && (
          <span className="error" id={headline.errorId}>
            {headline.error}
          </span>
        )}
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="sector">Where you work</label>
          <select className="input" id="sector" name="sector" value={form.sector} onChange={(e) => setForm({ ...form, sector: SECTORS.find((s) => s === e.target.value) ?? '' })} aria-invalid={sector.invalid} aria-describedby={sector.describedBy}>
            <option value="">Not saying</option>
            {SECTORS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          {sector.error && (
            <span className="error" id={sector.errorId}>
              {sector.error}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="city">City</label>
          <input className="input" id="city" name="city" maxLength={PROFILE_LIMITS.city} autoComplete="address-level2" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} aria-invalid={city.invalid} aria-describedby={city.describedBy} />
          {city.error && (
            <span className="error" id={city.errorId}>
              {city.error}
            </span>
          )}
        </div>
      </div>
      <fieldset className="plain-fieldset">
        <legend className="label-text">Jurisdictions you work in</legend>
        <div className="chips">
          {JURISDICTIONS.map((j) => (
            <label key={j} className="chip">
              <input className="sr-only" type="checkbox" name="jurisdictions" value={j} checked={form.jurisdictions.includes(j)} onChange={(e) => setForm({ ...form, jurisdictions: toggled(form.jurisdictions, j, e.target.checked) })} />
              {j}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="plain-fieldset">
        <legend className="label-text">What you post about</legend>
        <div className="chips">
          {TOPICS.map((t) => (
            <label key={t} className="chip">
              <input className="sr-only" type="checkbox" name="topics" value={t} checked={form.topics.includes(t)} onChange={(e) => setForm({ ...form, topics: toggled(form.topics, t, e.target.checked) })} />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="check">
        <input type="checkbox" name="creator" checked={form.creator} onChange={(e) => setForm({ ...form, creator: e.target.checked })} />
        <span>
          <b>I mainly make content</b>
          <span className="hint">Shows the Creator flair until a credential is ticked.</span>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" name="listed" checked={form.listed} onChange={(e) => setForm({ ...form, listed: e.target.checked })} />
        <span>
          <b>Show me on The List</b>
          <span className="hint">Off, your page still works for anyone with the link.</span>
        </span>
      </label>
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      <div className="panel-foot">
        {profile ? (
          <SocialLink className="btn ghost" to="/social/@{$handle}" params={{ handle: profile.handle }}>
            Cancel
          </SocialLink>
        ) : (
          <SocialLink className="btn ghost" to="/social">
            Cancel
          </SocialLink>
        )}
        <button className="btn" type="submit">
          {profile ? 'Save profile' : 'Claim handle'}
        </button>
      </div>
    </form>
  );
}
