import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { SocialLink } from '../../components/social/SocialLink.tsx';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { z } from 'zod';
import { FEED_FILTERS, FLOOR_LIMITS, POST_JURISDICTIONS, ROOM_IDS, ROOMS, type FeedFilter, type PostJurisdiction, type RoomId } from '../../../../src/data/social.ts';
import { tally } from '../../../../src/lib/format.ts';
import { DRAFT_KEY } from '../../../../src/lib/drafts.ts';
import { Avatar } from '../../components/social/Avatar.tsx';
import { useSignInHref } from '../../components/social/here.ts';
import { NoticeLine, NoticeProvider } from '../../components/social/Notice.tsx';
import { PostCard } from '../../components/social/PostCard.tsx';
import { ReportDialog } from '../../components/social/ReportDialog.tsx';
import { FieldError } from '../../components/FieldError.tsx';
import { useAction } from '../../components/useAction.ts';
import { floorPage, floorPost } from '../../functions/social-floor.ts';
import { socialHref } from '../../lib/links.ts';
import { socialTitle } from '../../lib/title.ts';

const FILTER_IDS = FEED_FILTERS.map((f) => f.id);

export const Route = createFileRoute('/social/')({
  validateSearch: z.object({
    room: z.enum(ROOM_IDS).optional().catch(undefined),
    filter: z.enum(FILTER_IDS).optional().catch(undefined),
    /* Anything past the last page goes to the last page; huge numbers stop at a page SQLite can still offset to. */
    page: z.number().int().positive().transform((n) => Math.min(n, 1_000_000)).optional().catch(undefined),
    done: z.literal('deleted').optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ room: search.room ?? null, filter: search.filter ?? ('all' as const), page: search.page ?? 1 }),
  loader: async ({ deps }) => {
    const data = await floorPage({ data: deps });
    if (deps.page > data.pages) throw redirect({ to: '/social', search: { room: deps.room ?? undefined, filter: deps.filter === 'all' ? undefined : deps.filter, page: data.pages > 1 ? data.pages : undefined } });
    return data;
  },
  staticData: { section: 'floor' },
  head: ({ loaderData, match }) => {
    const room = ROOMS.find((r) => r.id === match.search.room)?.name;
    return { meta: socialTitle(loaderData && room ? room : undefined) };
  },
  component: () => (
    <NoticeProvider>
      <Floor />
    </NoticeProvider>
  ),
});

function Floor() {
  const { feed, pages, week, signedIn, own } = Route.useLoaderData();
  const search = Route.useSearch();
  const room: RoomId | null = search.room ?? null;
  const filter: FeedFilter = search.filter ?? 'all';
  const page = search.page ?? 1;
  const signIn = useSignInHref();
  const compose = useRef<HTMLDialogElement>(null);
  const roomName = room ? ROOMS.find((r) => r.id === room)?.name : null;
  /* The Floor with one choice changed and the other kept, back on the first page. */
  const link = (change: { room?: RoomId | null; filter?: FeedFilter }) => {
    const next = { room, filter, ...change };
    return { room: next.room ?? undefined, filter: next.filter === 'all' ? undefined : next.filter };
  };
  const postRooms = feed.rooms.filter((r) => !r.locked);

  return (
    <div className="page floor">
      <nav className="rooms card" aria-labelledby="rooms-title">
        <p className="kicker" id="rooms-title">
          Rooms
        </p>
        <ul>
          <li>
            <SocialLink className="room" to="/social" search={link({ room: null })} current={room === null}>
              <span>All rooms</span>
            </SocialLink>
          </li>
          {feed.rooms.map((r) => (
            <li key={r.id}>
              <SocialLink className="room" to="/social" search={link({ room: r.id })} current={r.id === room}>
                <span>{r.name}</span>
                {r.locked ? (
                  <svg role="img" aria-label="Needs a practising tick">
                    <use href="#i-lock" />
                  </svg>
                ) : (
                  <span className="n">
                    {r.posts}
                    <span className="sr-only"> posts</span>
                  </span>
                )}
              </SocialLink>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-labelledby="floor-title">
        <h1 className="sr-only" id="floor-title">
          {roomName ?? 'Floor'}
        </h1>
        {own ? (
          <div className="composer card">
            <Avatar name={own.name} track={own.track} sealed={own.sealed} size="sm" />
            <button className="fake" type="button" onClick={() => compose.current?.showModal()}>
              Ask the floor, or share what you know.
            </button>
            <button className="btn sm" type="button" onClick={() => compose.current?.showModal()} aria-label="New post">
              <svg aria-hidden="true">
                <use href="#i-plus" />
              </svg>
              <span>Post</span>
            </button>
          </div>
        ) : (
          <div className="composer card">
            <p className="small">
              {signedIn ? (
                <>
                  <SocialLink to="/social/edit">Claim your handle</SocialLink> to post and reply.
                </>
              ) : (
                <>
                  <a href={signIn}>Sign in</a> to post and reply. New here? <SocialLink to="/social/request">Request to join</SocialLink>.
                </>
              )}
            </p>
          </div>
        )}
        <nav className="filters chips" aria-label="Filter posts">
          {FEED_FILTERS.map((f) => (
            <SocialLink key={f.id} className="chip" to="/social" search={link({ filter: f.id })} current={f.id === filter}>
              {f.id === 'ticked' && (
                <svg aria-hidden="true">
                  <use href="#tk" />
                </svg>
              )}
              {f.label}
            </SocialLink>
          ))}
        </nav>
        <NoticeLine />
        {search.done === 'deleted' && (
          <p className="note" role="status">
            Deleted.
          </p>
        )}
        <div className="feed">
          {feed.locked ? (
            <div className="empty">
              <p className="head">This room needs a practising tick.</p>
              <p>Practitioners talk shop here. Fees, inspections, clients. Everyone else reads the open floor.</p>
              <a className="btn sm" href={socialHref('/verify?step=licence')}>
                Get ticked
              </a>
            </div>
          ) : filter === 'following' && !signedIn ? (
            <div className="empty">
              <p className="head">Sign in to see who you follow.</p>
              <p>Follow people from The List and their posts show here.</p>
              <a className="btn sm" href={signIn}>
                Sign in
              </a>
            </div>
          ) : feed.posts.length ? (
            feed.posts.map((post) => (
              <PostCard key={post.id} post={post} signedIn={signedIn}>
                {signedIn && !post.mine && <ReportDialog target="post" id={post.id} about={`“${post.title}”`} />}
              </PostCard>
            ))
          ) : filter === 'following' ? (
            <div className="empty">
              <p className="head">Nothing from people you follow yet.</p>
              <p>Follow people from The List and their posts show here.</p>
              <SocialLink className="btn sm" to="/social/list">
                Open The List
              </SocialLink>
            </div>
          ) : room === null && filter === 'all' ? (
            <div className="empty">
              <p className="head">Nothing on the Floor yet.</p>
              <p>Ask the first question. People who know answer here, and ticked answers show it.</p>
              {!own &&
                (signedIn ? (
                  <SocialLink className="btn sm" to="/social/edit">
                    Claim your handle
                  </SocialLink>
                ) : (
                  <SocialLink className="btn sm" to="/social/request">
                    Request to join
                  </SocialLink>
                ))}
            </div>
          ) : (
            <div className="empty">
              <p className="head">Quiet in here.</p>
              <p>Nothing matches this room and filter yet.</p>
              <SocialLink className="btn sm ghost" to="/social" search={{}}>
                Show everything
              </SocialLink>
            </div>
          )}
        </div>
        {pages > 1 && (
          <nav className="pager" aria-label="Pages">
            {page > 1 ? (
              <SocialLink className="btn sm ghost" to="/social" search={(prev) => ({ ...prev, page: page - 1 > 1 ? page - 1 : undefined, done: undefined })}>
                Newer
              </SocialLink>
            ) : (
              <span />
            )}
            <span className="small">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <SocialLink className="btn sm ghost" to="/social" search={(prev) => ({ ...prev, page: page + 1, done: undefined })}>
                Older
              </SocialLink>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
      <aside className="rail" aria-label="Next steps">
        {week && (
          <a className="rail-card card potw" href={socialHref('/problems')}>
            <span className="tape" aria-hidden="true">
              this week
            </span>
            <p className="kicker">
              Problem #{week.number} · {week.tag}
            </p>
            <p className="head">{week.title}</p>
            <p className="small">{week.mine ? `You answered. ${tally(week.answers, 'answer')} so far.` : `${tally(week.answers, 'answer')}. Hidden until you answer.`}</p>
            <span className="btn sm">
              {week.mine ? 'See the answers' : 'Answer it'}
              <svg aria-hidden="true">
                <use href="#i-arrow" />
              </svg>
            </span>
          </a>
        )}
        {!(own?.sealed ?? false) && (
          <div className="rail-card card">
            <p className="hand-note">get your seal</p>
            <h2 className="head">Get ticked</h2>
            <p className="small">Prove your account. Add your body. The seal shows once one account and one credential are ticked.</p>
            <a className="btn sm" href={socialHref('/verify')}>
              Start
            </a>
          </div>
        )}
        <div className="rail-card card">
          <p className="kicker">The List</p>
          <p className="small">People worth following, ranked by peers. Never by followers.</p>
          <SocialLink className="small" to="/social/list">
            See The List
          </SocialLink>
        </div>
      </aside>
      {own && <Compose dialog={compose} rooms={postRooms} room={room && postRooms.some((r) => r.id === room) ? room : 'open'} />}
    </div>
  );
}

interface Draft {
  title: string;
  body: string;
  room: RoomId;
  jurisdiction: PostJurisdiction;
}

/** Reads the draft this browser kept, field by field, dropping anything that no longer fits the form. */
function storedDraft(rooms: readonly { id: RoomId }[]): Partial<Draft> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}');
    if (typeof stored !== 'object' || stored === null) return {};
    const field = (key: string) => {
      const value: unknown = Reflect.get(stored, key);
      return typeof value === 'string' && value ? value : undefined;
    };
    const room = rooms.find((r) => r.id === field('room'))?.id;
    const jurisdiction = POST_JURISDICTIONS.find((j) => j === field('jurisdiction'));
    const title = field('title');
    const body = field('body');
    return { ...(title && { title }), ...(body && { body }), ...(room && { room }), ...(jurisdiction && { jurisdiction }) };
  } catch {
    return {};
  }
}

/*
 * The composer keeps a draft in this browser as you type, and brings it back next time. A refused post keeps what was
 * typed. The thread page clears the draft once a post lands.
 */
function Compose({ dialog, rooms, room }: { dialog: RefObject<HTMLDialogElement | null>; rooms: readonly { id: RoomId; name: string }[]; room: RoomId }) {
  const [draft, setDraft] = useState<Draft>({ title: '', body: '', room, jurisdiction: 'MY' });
  const [status, setStatus] = useState('');
  const post = useAction(floorPost, { refresh: 'never' });
  const navigate = useNavigate();

  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const stored = storedDraft(rooms);
    setDraft((current) => ({ ...current, ...stored }));
    if (stored.title || stored.body) setStatus('Draft restored.');
  }, [rooms]);

  const change = (next: Draft) => {
    setDraft(next);
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      setStatus('Draft saved.');
    } catch {
      /* Storage can be full or blocked. The post still sends. */
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await post.run(draft);
    if (!outcome) return;
    if (!outcome.ok) {
      const first = (['title', 'body', 'room', 'jurisdiction'] as const).find((field) => outcome.fields[field]);
      document.getElementById(first ? `compose-${first === 'title' ? 'title-input' : first}` : 'compose-title-input')?.focus();
      return;
    }
    dialog.current?.close();
    await navigate({ to: '/social/post/$id', params: { id: String(outcome.value.id) }, search: { posted: 1 } });
  };

  const title = post.field('title', { id: 'compose-title-error' });
  const body = post.field('body', { id: 'compose-body-error' });
  const roomError = post.field('room', { id: 'compose-room-error' });
  const jurisdiction = post.field('jurisdiction', { id: 'compose-jurisdiction-error', hint: 'compose-jurisdiction-hint' });
  const failure = post.failure;

  return (
    <dialog className="modal card" id="compose" ref={dialog} aria-labelledby="compose-title">
      <form method="POST" onSubmit={submit} noValidate>
        <p className="kicker">New post</p>
        <h2 className="head" id="compose-title">
          What do you want to ask or share?
        </h2>
        <div className="field">
          <label htmlFor="compose-title-input">Title</label>
          <input
            className="input"
            id="compose-title-input"
            name="title"
            required
            minLength={FLOOR_LIMITS.titleMin}
            maxLength={FLOOR_LIMITS.title}
            value={draft.title}
            onChange={(e) => change({ ...draft, title: e.target.value })}
            placeholder="Does a dormant Sdn Bhd still need an audit?"
            {...title.input}
          />
          <FieldError field={title} />
        </div>
        <div className="field">
          <label htmlFor="compose-body">Details · optional</label>
          <textarea
            className="input"
            id="compose-body"
            name="body"
            rows={5}
            maxLength={FLOOR_LIMITS.body}
            placeholder="What you know so far, and what you’ve tried."
            value={draft.body}
            onChange={(e) => change({ ...draft, body: e.target.value })}
            {...body.input}
          />
          <FieldError field={body} />
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="compose-room">Room</label>
            <select className="input" id="compose-room" name="room" value={draft.room} onChange={(e) => change({ ...draft, room: rooms.find((r) => r.id === e.target.value)?.id ?? draft.room })} {...roomError.input}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <FieldError field={roomError} />
          </div>
          <div className="field">
            <label htmlFor="compose-jurisdiction">Jurisdiction</label>
            <select className="input" id="compose-jurisdiction" name="jurisdiction" value={draft.jurisdiction} onChange={(e) => change({ ...draft, jurisdiction: POST_JURISDICTIONS.find((j) => j === e.target.value) ?? draft.jurisdiction })} {...jurisdiction.input}>
              {POST_JURISDICTIONS.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
            <FieldError field={jurisdiction} />
          </div>
        </div>
        <p className="small" id="compose-jurisdiction-hint">
          Tag the jurisdiction. Tax answers change at the border.
        </p>
        {failure && (
          <p className="error" role="alert">
            {failure}
          </p>
        )}
        <div className="row-end">
          <span className="small" role="status">
            {status}
          </span>
          <button className="btn" type="submit">
            Post
          </button>
        </div>
      </form>
      <button className="icon-btn close" type="button" onClick={() => dialog.current?.close()} aria-label="Close dialog">
        <svg aria-hidden="true">
          <use href="#i-x" />
        </svg>
      </button>
    </dialog>
  );
}
