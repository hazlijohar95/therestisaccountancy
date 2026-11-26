import { createFileRoute } from '@tanstack/react-router';
import { SocialLink } from '../../components/social/SocialLink.tsx';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { Avatar } from '../../components/social/Avatar.tsx';
import { useSignInHref } from '../../components/social/here.ts';
import { Tick } from '../../components/social/Tick.tsx';
import { useCopy } from '../../components/social/useCopy.ts';
import { badgeCopied, badgePage } from '../../functions/social-shelf.ts';
import { socialHref } from '../../lib/links.ts';
import { noindex, socialTitle } from '../../lib/title.ts';

export const Route = createFileRoute('/social/badge')({
  loader: () => badgePage(),
  head: () => ({ meta: [...socialTitle('Your badge'), noindex] }),
  component: Badge,
});

function Badge() {
  const page = Route.useLoaderData();
  const signIn = useSignInHref();
  const { ready, status, copy } = useCopy();
  const copied = useServerFn(badgeCopied);
  const [style, setStyle] = useState<'light' | 'dark'>('light');
  const badge = page.signedIn ? page.badge : null;

  if (!badge)
    return (
      <div className="page narrow">
        <section className="claim card">
          <p className="kicker">Your badge</p>
          <h1 className="title">Get ticked first.</h1>
          <p className="lead">The badge links to your ticked claims, so it needs the seal: one account proven and one credential ticked.</p>
          {page.signedIn ? (
            <a className="btn" href={socialHref('/verify')}>
              Get ticked
            </a>
          ) : (
            <a className="btn" href={signIn}>
              Sign in
            </a>
          )}
        </section>
      </div>
    );

  const copyLine = async (id: string) => {
    await copy(id);
    /* The setup checklist ticks this off. If it fails, the next copy tries again. */
    await copied().catch(() => undefined);
  };
  const { profile } = badge;
  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <p className="kicker">Your badge</p>
          <h1 className="title">Put your ticks in your bio.</h1>
          <p className="lead">Anyone who taps it sees your ticked claims and how each one was checked.</p>
        </div>
      </div>
      <div className="form-grid">
        <section className="panel card" aria-label="Badge">
          <div className="badge-stage">
            <span className="badge-pill">
              <svg className="seal" aria-hidden="true">
                <use href="#seal" />
              </svg>
              <span>
                <b>Ticked on TRIA</b> · {badge.credential ?? 'Member'}
              </span>
            </span>
          </div>
          <fieldset className="chips plain-fieldset">
            <legend className="sr-only">Badge style</legend>
            {(['light', 'dark'] as const).map((value) => (
              <label key={value} className="chip">
                <input className="sr-only" type="radio" name="badge-style" value={value} checked={style === value} onChange={() => setStyle(value)} />
                {value === 'light' ? 'Light' : 'Dark'}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="b-link">Profile link</label>
            <div className="copy-row">
              <input className="input" id="b-link" readOnly value={badge.link} />
              <button className="btn sm" type="button" aria-label="Copy profile link" hidden={!ready} onClick={() => copyLine('b-link')}>
                <svg aria-hidden="true">
                  <use href="#i-copy" />
                </svg>
                Copy
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="b-bio">Line for your bio</label>
            <div className="copy-row">
              <input className="input" id="b-bio" readOnly value={badge.bio} />
              <button className="btn sm" type="button" aria-label="Copy line for your bio" hidden={!ready} onClick={() => copyLine('b-bio')}>
                <svg aria-hidden="true">
                  <use href="#i-copy" />
                </svg>
                Copy
              </button>
            </div>
          </div>
          <p className="small" role="status">
            {status}
          </p>
        </section>
        <aside className="aside-stack" aria-labelledby="preview-title">
          <p className="kicker" id="preview-title">
            What people see when they tap it
          </p>
          <article className="card mini-profile">
            <div className="by">
              <Avatar name={profile.name} track={profile.track} sealed={profile.sealed} />
              <div>
                <p className="name-line">
                  {profile.name}
                  <svg className="seal" role="img" aria-label="Ticked">
                    <use href="#seal" />
                  </svg>
                </p>
                <p className="small">@{profile.handle}</p>
              </div>
            </div>
            <ul className="links">
              {badge.shown.map((claim) => (
                <li key={claim.key}>
                  <Tick source={claim.source} state="ticked" />
                  <span>{claim.label}</span>
                </li>
              ))}
            </ul>
            <SocialLink className="btn sm ghost" to="/social/@{$handle}" params={{ handle: profile.handle }}>
              Open your profile
            </SocialLink>
          </article>
        </aside>
      </div>
    </div>
  );
}
