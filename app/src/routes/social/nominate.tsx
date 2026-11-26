import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { SocialLink } from '../../components/social/SocialLink.tsx';
import { useState, type FormEvent } from 'react';
import { accountHandle, CLAIM_LIMITS, PLATFORMS, TOPICS, type Platform, type Topic } from '../../../../src/data/social.ts';
import { Tick } from '../../components/social/Tick.tsx';
import { FieldError } from '../../components/FieldError.tsx';
import { useAction } from '../../components/useAction.ts';
import { nominate, nominatePage } from '../../functions/social-nominations.ts';
import { socialHref, socialSignInHref } from '../../lib/links.ts';
import { socialTitle } from '../../lib/title.ts';

export const Route = createFileRoute('/social/nominate')({
  loader: () => nominatePage(),
  staticData: { section: 'list' },
  head: () => ({ meta: [...socialTitle('Nominate someone'), { name: 'description', content: 'Nominate someone in accountancy who posts things worth learning from.' }] }),
  component: Nominate,
});

function Nominate() {
  const { signedIn } = Route.useLoaderData();
  const [form, setForm] = useState<{ platform: Platform; handle: string; topics: readonly Topic[]; whyUrl: string }>({ platform: 'LinkedIn', handle: '', topics: [], whyUrl: '' });
  const [listed, setListed] = useState<string | null>(null);
  const send = useAction(nominate, { refresh: 'never' });
  const navigate = useNavigate();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await send.run(form);
    if (!outcome) return;
    if (!outcome.ok) {
      setListed('listed' in outcome ? outcome.listed : null);
      const first = (['platform', 'handle', 'whyUrl'] as const).find((field) => outcome.fields[field]);
      if (first) document.getElementById(first === 'platform' ? `nominate-platform-${form.platform}` : first === 'handle' ? 'nominate-handle' : 'nominate-why')?.focus();
      return;
    }
    /* A new nomination and a counted one read the same, so the address never tells a member that someone else nominated. */
    await navigate({ to: '/social/list', search: { nominated: outcome.value.outcome } });
  };
  const platform = send.field('platform', { id: 'nominate-platform-error' });
  const handle = send.field('handle', { id: 'nominate-handle-error', hint: 'nominate-handle-hint' });
  const whyUrl = send.field('whyUrl', { id: 'nominate-whyUrl-error' });
  const failure = send.failure;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="kicker">Nominate</p>
          <h1 className="title">Who should be on the List?</h1>
          <p className="lead">Someone who posts things worth learning from. Or yourself.</p>
        </div>
      </div>
      <div className="form-grid">
        {signedIn ? (
          <form className="panel card" method="POST" onSubmit={submit} noValidate>
            <fieldset className="plain-fieldset">
              <legend className="label-text">Platform</legend>
              <div className="chips">
                {PLATFORMS.map((p) => (
                  <label key={p} className="chip">
                    <input className="sr-only" type="radio" id={`nominate-platform-${p}`} name="platform" value={p} checked={form.platform === p} onChange={() => setForm({ ...form, platform: p })} />
                    {p}
                  </label>
                ))}
              </div>
              <FieldError field={platform} />
            </fieldset>
            <div className="field">
              <label htmlFor="nominate-handle">Their handle</label>
              <input className="input" id="nominate-handle" name="handle" required autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="@taxwithtan" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} {...handle.input} />
              <span className="hint" id="nominate-handle-hint">
                The handle, or paste their profile’s address.
              </span>
              {handle.error && (
                <span className="error" id={handle.errorId}>
                  {handle.error}
                  {listed && (
                    <>
                      {' '}
                      <SocialLink to="/social/@{$handle}" params={{ handle: listed }}>
                        See their profile
                      </SocialLink>
                    </>
                  )}
                </span>
              )}
            </div>
            <fieldset className="plain-fieldset">
              <legend className="label-text">What they post about</legend>
              <div className="chips">
                {TOPICS.map((t) => (
                  <label key={t} className="chip">
                    <input className="sr-only" type="checkbox" name="topics" value={t} checked={form.topics.includes(t)} onChange={(e) => setForm({ ...form, topics: e.target.checked ? [...form.topics, t] : form.topics.filter((topic) => topic !== t) })} />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="nominate-why">One post that convinced you · optional</label>
              <input className="input" id="nominate-why" name="whyUrl" type="url" inputMode="url" maxLength={CLAIM_LIMITS.url} placeholder="Paste a link" value={form.whyUrl} onChange={(e) => setForm({ ...form, whyUrl: e.target.value })} {...whyUrl.input} />
              <FieldError field={whyUrl} />
            </div>
            {failure && (
              <p className="error" role="alert">
                {failure}
              </p>
            )}
            <div className="panel-foot">
              <a className="small" href={socialHref('/verify')}>
                It’s me. Get ticked instead.
              </a>
              <button className="btn" type="submit">
                Nominate
              </button>
            </div>
          </form>
        ) : (
          <section className="panel card" aria-labelledby="signin-title">
            <h2 className="head" id="signin-title">
              Sign in to nominate.
            </h2>
            <p>Nominations come from members, so we know who to ask if something looks wrong. Social is free and invite-only.</p>
            <div className="panel-foot">
              <SocialLink className="small" to="/social/request">
                Request to join
              </SocialLink>
              <a className="btn" href={socialSignInHref('/nominate')}>
                Sign in
              </a>
            </div>
          </section>
        )}
        <aside className="aside-stack" aria-labelledby="created-title">
          <p className="kicker" id="created-title">
            What gets created
          </p>
          <div className="preview-card card">
            <span className="stamp">Not public</span>
            <span className="avatar" data-track="field" aria-hidden="true">
              @
            </span>
            <b>@{accountHandle(form.handle) || 'handle'}</b>
            <div className="chips">
              <span className="flair" data-track="field">
                Unclaimed
              </span>
              <span className="tag">{form.platform}</span>
            </div>
            <p className="small">Only their public handle. Nothing else.</p>
          </div>
          <ul className="links">
            <li>
              <Tick source="self" state="self" />
              <span>Private until they claim it.</span>
            </li>
            <li>
              <Tick source="self" state="self" />
              <span>We invite them once. No chasing.</span>
            </li>
            <li>
              <Tick source="self" state="self" />
              <span>They can delete it in one click.</span>
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
