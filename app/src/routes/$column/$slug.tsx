import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { join } from '../../../../src/data/club.ts';
import { formatDay } from '../../../../src/lib/format.ts';
import { plain, runs } from '../../../../src/lib/marked.ts';
import { Page } from '../../components/club/Page.tsx';
import { Closing } from '../../components/members/Closing.tsx';
import { memberPost } from '../../functions/members-posts.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './$slug.module.css';

/* Rendered per request: a members-only post shows its body to paid members alone. */
export const Route = createFileRoute('/$column/$slug')({
  loader: ({ params }) => memberPost({ data: { column: params.column, slug: params.slug } }),
  head: ({ loaderData }) => ({ meta: loaderData ? [...clubTitle(plain(loaderData.title)), { name: 'description', content: loaderData.dek }] : clubTitle() }),
  component: PostPage,
});

const FACE = 32;

function PostPage() {
  const post = Route.useLoaderData();
  const { pathname } = Route.useMatch({ select: (match) => ({ pathname: match.pathname }) });
  /* The cover is the player. Nothing loads from YouTube until it is pressed; without the page's script the link opens YouTube. */
  const [playing, setPlaying] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (playing) frame.current?.focus();
  }, [playing]);
  const play = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    setPlaying(true);
  };
  const title = plain(post.title);
  const cover = <img src={post.cover} alt="" loading="eager" fetchPriority="high" />;

  return (
    <Page>
      <article className={`wrap ${s.post}`}>
        <header className={s.header}>
          <p className={s.meta}>
            <a href={post.column.href}>{post.column.name}</a>
            {post.episode && <span>Episode {post.episode}</span>}
            <span>{formatDay(post.date)}</span>
          </p>
          <h1 className={`headline serif ${s.headline}`}>{runs(post.title).map((run, i) => (run.mark ? <span key={i} className="mark">{run.text}</span> : run.text))}</h1>
          <p className={`lead ${s.lead}`}>{post.dek}</p>
          <p className="small">
            <span className={s.byline} style={{ '--face': `${FACE}px` } as CSSProperties}>
              {post.authors.map((author) => (
                <a key={author.href} href={author.href}>
                  {author.photo ? (
                    <img className={s.face} src={author.photo} alt="" loading="lazy" width={FACE} height={FACE} />
                  ) : (
                    <span className={`${s.face} ${s.initial}`} aria-hidden="true">
                      {author.name.charAt(0)}
                    </span>
                  )}
                  <span>{author.name}</span>
                </a>
              ))}
            </span>
          </p>
        </header>
        <figure className={post.player ? `${s.cover} ${s.video}` : s.cover}>
          {post.player ? (
            playing ? (
              <iframe ref={frame} src={post.player.embed} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
            ) : (
              <a className={s.play} href={post.player.href} onClick={play}>
                {cover}
                <span className={s.button}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5.5v13l11-6.5z" />
                  </svg>
                  <span>Play the episode</span>
                </span>
              </a>
            )
          ) : (
            cover
          )}
          {post.membersOnly && <span className={`stamp ${s.stamp}`}>Members</span>}
        </figure>
        {post.platforms.length > 0 && (
          <div className={s.listen}>
            {post.platforms.map((p) => (
              <a key={p.name} className="btn ghost" href={p.href} rel="noopener">
                {p.verb} {p.name}
              </a>
            ))}
          </div>
        )}
        {post.body !== null ? (
          <div className={s.body} dangerouslySetInnerHTML={{ __html: post.body }} />
        ) : (
          <div className={s.wall}>
            <p className="serif">The rest of this post is for members.</p>
            {post.signedIn ? (
              <>
                <p>Your membership needs a payment before you can read it. Pay, and every members’ post opens.</p>
                <div className={s.listen}>
                  <a className="btn" href="/members/pay">
                    Pay for membership
                  </a>
                </div>
              </>
            ) : (
              <>
                <p>Members read every post, work through the programmes and bring their own figures to the live sessions.</p>
                <div className={s.listen}>
                  <a className="btn" href={join.href}>
                    {join.label}
                  </a>
                  <a className="btn ghost" href={`/sign-in?next=${encodeURIComponent(pathname)}`}>
                    Sign in
                  </a>
                </div>
              </>
            )}
          </div>
        )}
        {post.topics.length > 0 && (
          <aside className={s.topics} aria-label="Work it through">
            <p className="label">Work it through in the club</p>
            <ul className="ruled">
              {post.topics.map((p) => (
                <li key={p.href}>
                  <a href={p.href}>{p.name}</a> <span className="small">{p.promise}</span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </article>
      <Closing title="Read it here. Work it through in the club." lead="Each post’s topic is a programme. Members take it from reading to doing, with the hosts and each other." />
    </Page>
  );
}
