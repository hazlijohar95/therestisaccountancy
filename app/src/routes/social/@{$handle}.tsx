import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { SocialLink } from '../../components/social/SocialLink.tsx';
import { useRef, useState, type FormEvent } from 'react';
import { SERVICES, SHELF_KINDS, SHELF_LIMITS, TICK_SOURCES, VOUCHES_TO_TICK, type TickSource } from '../../../../src/data/social.ts';
import { Avatar } from '../../components/social/Avatar.tsx';
import { Flair } from '../../components/social/Flair.tsx';
import { useSignInHref } from '../../components/social/here.ts';
import { NoticeLine, NoticeProvider, useSay } from '../../components/social/Notice.tsx';
import { PostCard } from '../../components/social/PostCard.tsx';
import { ReportDialog } from '../../components/social/ReportDialog.tsx';
import { Tick } from '../../components/social/Tick.tsx';
import { fieldError, useAction } from '../../components/social/useAction.ts';
import { follow, profilePage, unfollow, vouch } from '../../functions/social-profiles.ts';
import { addShelfItem, removeShelfItem, saveItem, unsaveItem } from '../../functions/social-shelf.ts';
import { socialHref } from '../../lib/links.ts';
import { socialTitle } from '../../lib/title.ts';

export const Route = createFileRoute('/social/@{$handle}')({
  loader: async ({ params }) => {
    const page = await profilePage({ data: params.handle });
    if (!page) throw notFound();
    if (page.profile.handle !== params.handle) throw redirect({ to: '/social/@{$handle}', params: { handle: page.profile.handle } });
    return page;
  },
  staticData: { section: 'list' },
  head: ({ loaderData }) => ({
    meta: [
      ...socialTitle(loaderData ? `${loaderData.profile.name} (@${loaderData.profile.handle})` : 'Not found'),
      ...(loaderData?.profile.headline ? [{ name: 'description', content: loaderData.profile.headline }] : []),
    ],
  }),
  notFoundComponent: Missing,
  component: Profile,
});

type Page = NonNullable<Awaited<ReturnType<typeof profilePage>>>;

function Missing() {
  const { handle } = Route.useParams();
  return (
    <div className="page">
      <div className="card empty">
        <h1 className="head">Not on the List.</h1>
        <p>No one here goes by @{handle}.</p>
        <SocialLink className="btn sm" to="/social/list">
          See The List
        </SocialLink>
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/* Halftone by count: one entry is the lightest dot, eight or more is solid. */
const level = (n: number) => (n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : n <= 7 ? 4 : 5);

function Profile() {
  const page = Route.useLoaderData();
  const { profile, own, counts, invitedBy, signedIn } = page;
  return (
    <div className="page profile">
      <div>
        <NoticeProvider>
          <section className="hero card" aria-labelledby="name">
            <div className="cover" />
            <div className="inner">
              <Avatar name={profile.name} track={profile.track} sealed={profile.sealed} size="lg" />
              <h1 className="display" id="name">
                {profile.name}
                {profile.sealed && (
                  <svg className="seal" role="img" aria-label="Ticked">
                    <use href="#seal" />
                  </svg>
                )}
              </h1>
              <span className="handle">@{profile.handle}</span>
              {profile.headline ? <p className="headline">{profile.headline}</p> : own && <p className="headline small">Add a headline. One line on what you post about.</p>}
              <div className="traits">
                <Flair track={profile.track} />
                {profile.sector && <span className="tag">{profile.sector}</span>}
                {profile.jurisdictions.map((j) => (
                  <span key={j} className="jur">
                    {j}
                  </span>
                ))}
                {profile.city && <span className="tag">{profile.city}</span>}
                {profile.topics.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
              <p className="counts">
                <span>
                  <b>{plural(counts.followers, 'follower', 'followers')}</b>
                </span>
                <span>
                  Following <b>{counts.following}</b>
                </span>
                {invitedBy && (
                  <span>
                    Invited by{' '}
                    <SocialLink to="/social/@{$handle}" params={{ handle: invitedBy.handle }}>
                      {invitedBy.name}
                    </SocialLink>
                  </span>
                )}
              </p>
              <div className="actions">
                {own ? (
                  <>
                    <SocialLink className="btn sm" to="/social/edit">
                      <svg aria-hidden="true">
                        <use href="#i-edit" />
                      </svg>
                      Edit profile
                    </SocialLink>
                    {profile.sealed && (
                      <SocialLink className="btn sm ghost" to="/social/badge">
                        Get your badge
                      </SocialLink>
                    )}
                    <SocialLink className="btn sm ghost" to="/social/invites">
                      Invites
                    </SocialLink>
                    <a className="btn sm ghost" href={socialHref('/casebook/new')}>
                      <svg aria-hidden="true">
                        <use href="#i-plus" />
                      </svg>
                      Add to casebook
                    </a>
                  </>
                ) : signedIn ? (
                  <FollowButton handle={profile.handle} name={profile.name} following={page.following} />
                ) : (
                  <SignInToFollow />
                )}
                {signedIn && !own && <ReportDialog target="profile" handle={profile.handle} about={`@${profile.handle}`} className="btn sm ghost" />}
              </div>
              <NoticeLine />
            </div>
          </section>
        </NoticeProvider>

        <NoticeProvider>
          <Claims page={page} />
        </NoticeProvider>
        <Casebook page={page} />
        {own && (
          <NoticeProvider>
            <Saved page={page} />
          </NoticeProvider>
        )}
        <NoticeProvider>
          <Shelf page={page} />
        </NoticeProvider>
        <NoticeProvider>
          <section className="section card" aria-labelledby="posts-title">
            <header>
              <h2 className="head" id="posts-title">
                Recent posts
              </h2>
            </header>
            <NoticeLine />
            {page.posts.length ? (
              <div className="recent">
                {page.posts.map((post) => (
                  <PostCard key={post.id} post={post} signedIn={signedIn} />
                ))}
              </div>
            ) : (
              <div className="empty">
                <p>{own ? 'You have not posted yet.' : 'No posts yet.'}</p>
                {own && (
                  <SocialLink className="btn sm" to="/social">
                    Ask the Floor
                  </SocialLink>
                )}
              </div>
            )}
          </section>
        </NoticeProvider>
      </div>
      <Side page={page} />
    </div>
  );
}

function SignInToFollow() {
  return (
    <a className="btn sm" href={useSignInHref()}>
      Sign in to follow
    </a>
  );
}

function FollowButton({ handle, name, following }: { handle: string; name: string; following: boolean }) {
  const on = useAction(follow);
  const off = useAction(unfollow);
  const say = useSay();
  const toggle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await (following ? off : on).run({ handle });
    if (outcome) say(outcome.ok ? { tone: 'quiet', text: following ? 'Unfollowed.' : `Following ${name}.` } : { tone: 'error', text: outcome.message });
  };
  return (
    <form method="POST" onSubmit={toggle}>
      <button className={following ? 'btn sm ghost' : 'btn sm'} type="submit">
        {following ? (
          <>
            Following<span className="sr-only">. Select to unfollow.</span>
          </>
        ) : (
          'Follow'
        )}
      </button>
    </form>
  );
}

function Claims({ page }: { page: Page }) {
  const { claims, accounts, own, canVouch, profile } = page;
  const sources = [...new Set<TickSource>([...(accounts.length ? ['account' as const] : []), ...claims.map((c) => c.source)])];
  return (
    <section className="section card" aria-labelledby="claims-title">
      <header>
        <h2 className="head" id="claims-title">
          Ticked claims
        </h2>
        <span className="small">
          <SocialLink to="/social/ticks">What a tick means</SocialLink>
        </span>
      </header>
      <NoticeLine />
      <div className="claims-wrap">
        {claims.length + accounts.length === 0 ? (
          <div className="empty">
            <p>No claims yet.</p>
            {own && (
              <a className="btn sm" href={socialHref('/verify')}>
                Get ticked
              </a>
            )}
          </div>
        ) : (
          <>
            <table className="claims">
              <caption className="sr-only">Claims about {profile.name}, and how each was checked</caption>
              <tbody>
                {accounts.map((a) => (
                  <tr key={`a${a.id}`} data-state="ticked">
                    <td>
                      <Tick source="account" state="ticked" />
                    </td>
                    <td className="what">
                      {a.platform} · @{a.handle}
                    </td>
                    <td className="src">{TICK_SOURCES.account.name}</td>
                    <td className="when">Proven</td>
                  </tr>
                ))}
                {claims.map((c) => (
                  <tr key={`c${c.id}`} data-state={c.state}>
                    <td>
                      <Tick source={c.source} state={c.tick} vouches={c.vouches} />
                    </td>
                    <td className="what">{c.label}</td>
                    <td className="src">
                      {TICK_SOURCES[c.source].name}
                      {c.kind === 'experience' && c.vouches > 0 && ` · ${c.vouches}`}
                    </td>
                    <td className="when">
                      {c.kind === 'experience' && c.state === 'ticked' ? `Vouched by ${c.vouches}` : c.when}
                      {c.due !== null && (
                        <>
                          <br />
                          <span className="due-chip">
                            Renews in {c.due} {c.due === 1 ? 'day' : 'days'}
                          </span>
                        </>
                      )}
                      {canVouch && c.kind === 'experience' && !c.vouchedByViewer && <VouchButton claim={c.id} label={c.label} />}
                      {canVouch && c.kind === 'experience' && c.vouchedByViewer && (
                        <>
                          <br />
                          You vouched
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="claims-foot">
              {sources.map((source) => (
                <span key={source}>
                  <Tick source={source} state={source === 'self' ? 'self' : 'ticked'} />
                  {TICK_SOURCES[source].name}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      {own && (
        <p className="small">
          Self-declared claims are ticked once {VOUCHES_TO_TICK} members with the seal vouch for them. <a href={socialHref('/verify')}>Add or renew claims</a>.
        </p>
      )}
    </section>
  );
}

function VouchButton({ claim, label }: { claim: number; label: string }) {
  const send = useAction(vouch);
  const say = useSay();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await send.run({ claim });
    if (outcome) say(outcome.ok ? { tone: 'quiet', text: outcome.value.ticked ? 'Vouched. That was the third: it is ticked.' : 'Vouched.' } : { tone: 'error', text: outcome.message });
  };
  return (
    <form method="POST" onSubmit={submit}>
      <button className="btn sm ghost" type="submit">
        Vouch<span className="sr-only"> for {label}</span>
      </button>
    </form>
  );
}

function Casebook({ page }: { page: Page }) {
  const { heat, roles, own, firstYear, latestYear } = page;
  const span = Math.max(1, latestYear - firstYear);
  const cell = (industry: string, service: string) => heat.cells.find((c) => c.industry === industry && c.service === service) ?? { entries: 0, cosigned: 0 };
  return (
    <section className="section card" id="casebook" aria-labelledby="casebook-title">
      <header>
        <h2 className="head" id="casebook-title">
          Casebook
        </h2>
        <span className="small">Bands and years only. No client names.</span>
      </header>
      {heat.entries > 0 ? (
        <div className="heat-wrap">
          <div className="heat" role="table" aria-label="Engagements by industry and type of work">
            <div className="hr" role="row">
              <span role="columnheader">
                <span className="sr-only">Industry</span>
              </span>
              {SERVICES.map((service) => (
                <span key={service} className="ch" role="columnheader">
                  {service}
                </span>
              ))}
            </div>
            {heat.industries.map((industry) => (
              <div key={industry} className="hr" role="row">
                <span className="rh" role="rowheader">
                  {industry}
                </span>
                {SERVICES.map((service) => {
                  const c = cell(industry, service);
                  return (
                    <span key={service} className={`cell ht-${level(c.entries)}`} role="cell" tabIndex={c.entries ? 0 : undefined} aria-label={`${industry}, ${service}: ${plural(c.entries, 'engagement', 'engagements')}, ${c.cosigned} co-signed`}>
                      {c.cosigned > 0 && (
                        <span className="cs" aria-hidden="true">
                          <svg>
                            <use href="#tk" />
                          </svg>
                        </span>
                      )}
                      {c.entries > 0 && (
                        <span className="tip" aria-hidden="true">
                          {plural(c.entries, 'engagement', 'engagements')} · {c.cosigned} co-signed
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="heat-legend" aria-hidden="true">
            <span className="scale">
              Fewer{' '}
              {[1, 2, 3, 4, 5].map((l) => (
                <i key={l} className={`ht-${l}`} />
              ))}{' '}
              More
            </span>
            <span className="scale">
              <span className="cs-key">
                <svg>
                  <use href="#tk" />
                </svg>
              </span>{' '}
              Co-signed by a colleague with the seal
            </span>
          </div>
          <div className="heat-stats">
            <div>
              <b>{heat.entries}</b>
              <small>{heat.entries === 1 ? 'engagement' : 'engagements'}</small>
            </div>
            <div>
              <b>{heat.cosigned}</b>
              <small>co-signed</small>
            </div>
            <div>
              <b>{heat.industries.length}</b>
              <small>{heat.industries.length === 1 ? 'industry' : 'industries'}</small>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty">
          <p className="head">No entries yet.</p>
          <p>Log work by type, industry and size band. No client names.</p>
          {own && (
            <a className="btn sm" href={socialHref('/casebook/new')}>
              <svg aria-hidden="true">
                <use href="#i-plus" />
              </svg>{' '}
              Add an entry
            </a>
          )}
        </div>
      )}
      {roles.length > 0 && (
        <div className="timeline">
          <div className="axis" aria-hidden="true">
            <span>{firstYear}</span>
            <span>{Math.round(firstYear + span / 2)}</span>
            <span>Now</span>
          </div>
          <ol className="tl-list" aria-label="Roles">
            {roles.map((role) => (
              <li key={role.id} className="tl-row">
                <div className="bar" aria-hidden="true">
                  <div className={role.to === null ? 'now' : undefined} style={{ '--x': `${((role.from - firstYear) / span) * 100}%`, '--w': `${(((role.to ?? latestYear) - role.from) / span) * 100}%` }} />
                </div>
                <p className="tl-label">
                  <b>{role.title}</b> · {role.employer}{' '}
                  <span className="pixel">
                    {role.from}–{role.to ?? 'now'}
                  </span>
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {own && heat.entries > 0 && (
        <a className="small" href={socialHref('/casebook/new')}>
          Add an entry or a role
        </a>
      )}
    </section>
  );
}

function Saved({ page }: { page: Page }) {
  const remove = useAction(unsaveItem);
  const say = useSay();
  const unsave = async (event: FormEvent<HTMLFormElement>, item: number) => {
    event.preventDefault();
    const outcome = await remove.run({ item });
    if (outcome) say(outcome.ok ? { tone: 'quiet', text: 'Removed from Saved.' } : { tone: 'error', text: outcome.message });
  };
  return (
    <section className="section card" id="saved" aria-labelledby="saved-title">
      <header>
        <h2 className="head" id="saved-title">
          Saved
        </h2>
        <span className="small">Only you see this.</span>
      </header>
      <NoticeLine />
      {page.saved.length ? (
        <ul className="saved-list">
          {page.saved.map((item) => (
            <li key={item.id}>
              <svg className="ic" aria-hidden="true">
                <use href="#i-file" />
              </svg>
              <span>
                <a href={item.url} rel="noopener noreferrer nofollow ugc">
                  <b>{item.title}</b>
                </a>
                <br />
                <SocialLink to="/social/@{$handle}" params={{ handle: item.owner.handle }}>
                  {item.owner.name}
                </SocialLink>{' '}
                · {item.kind}
              </span>
              <form method="POST" onSubmit={(event) => unsave(event, item.id)}>
                <button className="btn sm ghost" type="submit">
                  Remove<span className="sr-only"> {item.title} from Saved</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <p>Nothing saved yet. Save templates and explainers from anyone’s shelf.</p>
          <SocialLink className="btn sm ghost" to="/social/list">
            Browse The List
          </SocialLink>
        </div>
      )}
    </section>
  );
}

function Shelf({ page }: { page: Page }) {
  const { shelf, own, signedIn } = page;
  return (
    <section className="section card" id="shelf" aria-labelledby="shelf-title">
      <header>
        <h2 className="head" id="shelf-title">
          Shelf
        </h2>
        <span className="small">{own ? 'Work you share in public. Link to it; we never host the file.' : 'Work they share in public.'}</span>
      </header>
      <NoticeLine />
      {shelf.length ? (
        <div className="shelf">
          {shelf.map((item) => (
            <article key={item.id} className="item" aria-labelledby={`item-${item.id}`}>
              <span className="ic" aria-hidden="true">
                <svg>
                  <use href="#i-file" />
                </svg>
              </span>
              <p className="kicker">{item.kind}</p>
              <h3 id={`item-${item.id}`}>
                <a href={item.url} rel="noopener noreferrer nofollow ugc">
                  {item.title}
                </a>
              </h3>
              <div className="nums">
                <span>
                  <svg aria-hidden="true">
                    <use href="#i-down" />
                  </svg>{' '}
                  {plural(item.saves, 'save', 'saves')}
                </span>
              </div>
              {item.mine ? <TakeDown item={item.id} title={item.title} /> : signedIn ? <SaveButton item={item.id} title={item.title} saved={item.savedByViewer} /> : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>{own ? 'Nothing on your shelf yet.' : 'Nothing shared yet.'}</p>
        </div>
      )}
      {own && <AddToShelf />}
    </section>
  );
}

function TakeDown({ item, title }: { item: number; title: string }) {
  const remove = useAction(removeShelfItem);
  const say = useSay();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await remove.run({ item });
    if (outcome) say(outcome.ok ? { tone: 'note', text: 'Taken off your shelf.' } : { tone: 'error', text: outcome.message });
  };
  return (
    <details className="remove">
      <summary className="act">
        Take down<span className="sr-only"> {title}</span>
      </summary>
      <form method="POST" onSubmit={submit}>
        <p className="small">It leaves everyone’s Saved list too.</p>
        <button className="btn sm danger" type="submit">
          Take it down
        </button>
      </form>
    </details>
  );
}

function SaveButton({ item, title, saved }: { item: number; title: string; saved: boolean }) {
  const save = useAction(saveItem);
  const unsave = useAction(unsaveItem);
  const say = useSay();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await (saved ? unsave : save).run({ item });
    if (outcome) say(outcome.ok ? { tone: 'quiet', text: saved ? 'Removed from Saved.' : 'Saved to your profile.' } : { tone: 'error', text: outcome.message });
  };
  return (
    <form method="POST" onSubmit={submit}>
      <button className="btn sm ghost" type="submit" id={`save-${item}`} aria-pressed={saved}>
        {saved ? (
          <>
            <svg aria-hidden="true">
              <use href="#tk" />
            </svg>{' '}
            Saved
          </>
        ) : (
          'Save'
        )}
        <span className="sr-only"> {title}</span>
      </button>
    </form>
  );
}

function AddToShelf() {
  const details = useRef<HTMLDetailsElement>(null);
  const add = useAction(addShelfItem);
  const say = useSay();
  const [draft, setDraft] = useState({ title: '', kind: SHELF_KINDS[0] as string, url: '' });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await add.run(draft);
    if (!outcome?.ok) return;
    setDraft({ title: '', kind: SHELF_KINDS[0], url: '' });
    if (details.current) details.current.open = false;
    say({ tone: 'note', text: 'Added to your shelf.' });
  };
  const title = fieldError(add.refusal, 'title', { id: 's-title-error' });
  const url = fieldError(add.refusal, 'url', { id: 's-url-error', hint: 's-url-hint' });
  const failure = add.refusal && Object.keys(add.refusal.fields).length === 0 ? add.refusal.message : null;
  return (
    <details className="add-shelf" ref={details}>
      <summary className="btn sm ghost">
        <svg aria-hidden="true">
          <use href="#i-plus" />
        </svg>{' '}
        Add to your shelf
      </summary>
      <form method="POST" onSubmit={submit} noValidate>
        {failure && (
          <p className="error" role="alert">
            {failure}
          </p>
        )}
        <div className="row2">
          <div className="field">
            <label htmlFor="s-title">Title</label>
            <input className="input" id="s-title" name="title" maxLength={SHELF_LIMITS.title} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-invalid={title.invalid} aria-describedby={title.describedBy} />
            {title.error && (
              <span className="error" id={title.errorId}>
                {title.error}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="s-kind">What it is</label>
            <select className="input" id="s-kind" name="kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              {SHELF_KINDS.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="s-url">Link</label>
          <input className="input" id="s-url" name="url" type="url" inputMode="url" maxLength={SHELF_LIMITS.url} placeholder="https://" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} aria-invalid={url.invalid} aria-describedby={url.error ? url.errorId : 's-url-hint'} />
          {url.error ? (
            <span className="error" id={url.errorId}>
              {url.error}
            </span>
          ) : (
            <span className="hint" id="s-url-hint">
              An https link to where it is public: a drive folder, a post, a video.
            </span>
          )}
        </div>
        <button className="btn sm" type="submit">
          Add to shelf
        </button>
      </form>
    </details>
  );
}

function Side({ page }: { page: Page }) {
  const { checklist, record, accounts, own } = page;
  const steps = checklist
    ? [
        { label: 'Get ticked', done: checklist.ticked, href: socialHref('/verify') },
        { label: 'Write a headline', done: checklist.headline, href: socialHref('/edit') },
        { label: 'Log a casebook entry', done: checklist.casebook, href: socialHref('/casebook/new') },
        { label: 'Answer a problem', done: checklist.answered, href: socialHref('/problems') },
        { label: 'Copy your badge for your bio', done: checklist.badge, href: socialHref('/badge') },
      ]
    : [];
  const stepsDone = steps.filter((step) => step.done).length;
  const share = (n: number) => (record.rated ? (n / record.rated) * 100 : 0);
  return (
    <aside className="side" aria-label="About ticks">
      {checklist && stepsDone < steps.length && (
        <div className="card checklist">
          <p className="kicker">Set up your profile</p>
          <p className="small">
            <b>
              {stepsDone} of {steps.length}
            </b>{' '}
            done.
          </p>
          <div className="meter" role="img" aria-label={`${stepsDone} of ${steps.length} done`}>
            <i className="ht-5" style={{ width: `${(stepsDone / steps.length) * 100}%` }} />
          </div>
          <ul className="check-list">
            {steps.map((step) => (
              <li key={step.label} className={step.done ? 'done' : undefined}>
                {step.done ? (
                  <>
                    <span className="ck" aria-hidden="true">
                      <svg>
                        <use href="#tk" />
                      </svg>
                    </span>
                    <span>
                      <span className="sr-only">Done: </span>
                      {step.label}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="ck" aria-hidden="true" />
                    <a href={step.href}>{step.label}</a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="card record">
        <p className="kicker">Judgment record</p>
        {record.rated ? (
          <>
            <div className="big">
              <b>{Math.round(share(record.sound))}%</b>
              <span className="small">
                of {plural(record.rated, 'rated answer', 'rated answers')} judged sound by members with the seal
                {record.answers > record.rated && `, out of ${plural(record.answers, 'answer', 'answers')}`}
              </span>
            </div>
            <div className="meter" role="img" aria-label={`${record.sound} sound, ${record.partly} partly sound, ${record.unsound} unsound`}>
              <i className="ht-5" style={{ width: `${share(record.sound)}%` }} />
              <i className="hatch" style={{ width: `${share(record.partly)}%` }} />
              <i style={{ flex: 1 }} />
            </div>
            <div className="heat-legend" aria-hidden="true">
              <span className="scale">
                <i className="ht-5" /> Sound
              </span>
              <span className="scale">
                <i className="hatch" /> Partly
              </span>
              <span className="scale">
                <i className="empty-box" /> Unsound
              </span>
            </div>
          </>
        ) : (
          <p className="small">{record.answers ? `${plural(record.answers, 'answer', 'answers')}. None rated yet.` : own ? 'No answers yet. Answer a problem and members with the seal rate your reasoning.' : 'No answers yet.'}</p>
        )}
        <a className="small" href={socialHref('/problems')}>
          {own && !record.answers ? 'Answer this week’s problem' : 'Open problems'}
        </a>
      </div>
      <div className="card">
        <p className="kicker">Find them on</p>
        <ul className="links">
          {accounts.length === 0 && <li>No accounts proven yet.</li>}
          {accounts.map((a) => (
            <li key={a.id}>
              <Tick source="account" state="ticked" />
              <a href={a.url} rel="noopener noreferrer me">
                {a.platform} · @{a.handle}
              </a>
              <span className="pixel">proven</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card disclaim">
        <p className="kicker">Read this</p>
        <p>Ticks confirm credentials. They never vouch for advice.</p>
        <p>Every tick is re-checked each year. A lapsed one is struck in red.</p>
      </div>
    </aside>
  );
}
