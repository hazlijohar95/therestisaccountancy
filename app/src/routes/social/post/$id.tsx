import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { SocialLink } from '../../../components/social/SocialLink.tsx';
import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { FLOOR_LIMITS, POST_JURISDICTIONS, ROOMS } from '../../../../../src/data/social.ts';
import { DRAFT_KEY } from '../../../../../src/lib/drafts.ts';
import { formatMoment } from '../../../../../src/lib/format.ts';
import type { PostCard as Post, ReplyCard, Viewer } from '../../../../../src/server/social-floor.ts';
import { Avatar } from '../../../components/social/Avatar.tsx';
import { Flair } from '../../../components/social/Flair.tsx';
import { useSignInHref } from '../../../components/social/here.ts';
import { NoticeLine, NoticeProvider, useSay } from '../../../components/social/Notice.tsx';
import { PostCard } from '../../../components/social/PostCard.tsx';
import { PostText } from '../../../components/PostText.tsx';
import { ReportDialog } from '../../../components/social/ReportDialog.tsx';
import { pageStatus } from '../../../components/social/status.ts';
import { UsefulButton } from '../../../components/social/UsefulButton.tsx';
import { fieldError, useAction } from '../../../components/useAction.ts';
import { acceptReply, editFloorPost, editFloorReply, floorReply, removeFloorPost, removeFloorReply, threadPage, unacceptReply } from '../../../functions/social-floor.ts';
import { socialHref } from '../../../lib/links.ts';
import { socialTitle } from '../../../lib/title.ts';

export const Route = createFileRoute('/social/post/$id')({
  validateSearch: z.object({
    sort: z.literal('new').optional().catch(undefined),
    edit: z.string().optional().catch(undefined),
    posted: z.literal(1).optional().catch(undefined),
    done: z.literal('reply-deleted').optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ sort: search.sort ?? ('top' as const) }),
  loader: async ({ params, deps }) => {
    const view = await threadPage({ data: { id: Number(params.id), sort: deps.sort } });
    if (!view) throw notFound();
    if (view.state === 'locked') pageStatus(403);
    return view;
  },
  staticData: { section: 'floor' },
  head: ({ loaderData }) => ({
    meta: [
      ...socialTitle(loaderData?.state === 'open' ? loaderData.post.title : loaderData ? 'Practitioners’ room' : 'Not found'),
      ...(loaderData?.state === 'open' && loaderData.post.body ? [{ name: 'description', content: loaderData.post.body.slice(0, 160) }] : []),
    ],
  }),
  notFoundComponent: Gone,
  component: () => (
    <NoticeProvider>
      <Thread />
    </NoticeProvider>
  ),
});

function Back() {
  return (
    <SocialLink className="back" to="/social">
      <svg aria-hidden="true">
        <use href="#i-back" />
      </svg>
      Floor
    </SocialLink>
  );
}

function Gone() {
  return (
    <div className="page thread">
      <Back />
      <div className="card empty">
        <h1 className="head">That post isn’t here any more.</h1>
        <SocialLink className="btn sm" to="/social">
          Back to the Floor
        </SocialLink>
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Thread() {
  const view = Route.useLoaderData();
  const search = Route.useSearch();
  const signIn = useSignInHref();

  useEffect(() => {
    if (!search.posted) return;
    /* The post landed, so the draft it came from is done with. */
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* Storage can be blocked. Nothing to clear then. */
    }
  }, [search.posted]);

  if (view.state === 'locked')
    return (
      <div className="page thread">
        <Back />
        <div className="card empty">
          <h1 className="head">This post is in the practitioners’ room.</h1>
          <p>Practitioners talk shop there. It needs a ticked practising licence to read.</p>
          {view.signedIn ? (
            <a className="btn sm" href={socialHref('/verify?step=licence')}>
              Get ticked
            </a>
          ) : (
            <a className="btn sm" href={signIn}>
              Sign in
            </a>
          )}
        </div>
      </div>
    );

  const { post, replies, viewer, signedIn } = view;
  const sort = search.sort ?? 'top';
  return (
    <div className="page thread">
      <Back />
      {search.posted === 1 && (
        <p className="note" role="status">
          Posted to the Floor.
        </p>
      )}
      {search.done === 'reply-deleted' && (
        <p className="note" role="status">
          Reply deleted.
        </p>
      )}
      <NoticeLine />
      {search.edit === 'post' && post.editable ? (
        <EditPost post={post} viewer={viewer} />
      ) : (
        <PostCard post={post} full signedIn={signedIn}>
          {(post.editable || post.mine || viewer.admin) && (
            <div className="owner-actions">
              {post.editable && (
                <SocialLink className="act" to="/social/post/$id" params={{ id: String(post.id) }} search={{ sort: search.sort, edit: 'post' }}>
                  <svg aria-hidden="true">
                    <use href="#i-edit" />
                  </svg>
                  Edit
                </SocialLink>
              )}
              <RemovePost post={post} />
            </div>
          )}
          {signedIn && !post.mine && <ReportDialog target="post" id={post.id} about="this post" />}
        </PostCard>
      )}

      <section className="replies" id="replies" aria-labelledby="replies-title">
        <header className="replies-head">
          <h2 className="head" id="replies-title">
            {plural(replies.length, 'reply', 'replies')}
          </h2>
          <nav className="chips" aria-label="Sort replies">
            <SocialLink className="chip" to="/social/post/$id" params={{ id: String(post.id) }} search={{}} hash="replies" current={sort === 'top'}>
              Top
            </SocialLink>
            <SocialLink className="chip" to="/social/post/$id" params={{ id: String(post.id) }} search={{ sort: 'new' }} hash="replies" current={sort === 'new'}>
              Newest
            </SocialLink>
          </nav>
        </header>
        {replies.length === 0 && (
          <div className="empty card">
            <p>No replies yet. Be the first.</p>
          </div>
        )}
        {replies.map((reply) => (
          <Reply key={reply.id} reply={reply} post={post} viewer={viewer} signedIn={signedIn} editing={search.edit === `reply-${reply.id}`} />
        ))}
        {viewer.hasHandle ? (
          <ReplyForm post={post} sealed={viewer.sealed} />
        ) : (
          <div className="reply-form card">
            <p className="small">
              {signedIn ? (
                <>
                  <SocialLink to="/social/edit">Claim your handle</SocialLink> to reply.
                </>
              ) : (
                <>
                  <a href={signIn}>Sign in</a> to reply. New here? <SocialLink to="/social/request">Request to join</SocialLink>.
                </>
              )}
            </p>
          </div>
        )}
      </section>
      <p className="small">In {ROOMS.find((room) => room.id === post.room)?.name ?? ''}. Ticks confirm credentials. They never vouch for advice.</p>
    </div>
  );
}

function EditPost({ post, viewer }: { post: Post; viewer: Viewer }) {
  const [draft, setDraft] = useState({ title: post.title, body: post.body, room: post.room, jurisdiction: post.jurisdiction });
  const save = useAction(editFloorPost);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const say = useSay();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await save.run({ post: post.id, ...draft });
    if (!outcome) return;
    if (!outcome.ok) {
      if (Object.keys(outcome.fields).length === 0) say({ tone: 'error', text: outcome.message });
      return;
    }
    say(null);
    await navigate({ to: '/social/post/$id', params: { id: String(post.id) }, search: { sort: search.sort } });
  };
  const title = fieldError(save.refusal, 'title', { id: 'edit-title-error' });
  const body = fieldError(save.refusal, 'body', { id: 'edit-body-error' });
  const rooms = ROOMS.filter((room) => !room.locked || viewer.practitioner);
  return (
    <form className="post edit-form" method="POST" onSubmit={submit} noValidate>
      <h1 className="head">Edit your post</h1>
      <div className="field">
        <label htmlFor="edit-title">Title</label>
        <input className="input" id="edit-title" name="title" required maxLength={FLOOR_LIMITS.title} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-invalid={title.invalid} aria-describedby={title.describedBy} autoFocus />
        {title.error && (
          <span className="error" id={title.errorId}>
            {title.error}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="edit-body">Details · optional</label>
        <textarea className="input" id="edit-body" name="body" rows={6} maxLength={FLOOR_LIMITS.body} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-invalid={body.invalid} aria-describedby={body.describedBy} />
        {body.error && (
          <span className="error" id={body.errorId}>
            {body.error}
          </span>
        )}
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="edit-room">Room</label>
          <select className="input" id="edit-room" name="room" value={draft.room} onChange={(e) => setDraft({ ...draft, room: rooms.find((room) => room.id === e.target.value)?.id ?? draft.room })}>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="edit-jurisdiction">Jurisdiction</label>
          <select className="input" id="edit-jurisdiction" name="jurisdiction" value={draft.jurisdiction} onChange={(e) => setDraft({ ...draft, jurisdiction: POST_JURISDICTIONS.find((j) => j === e.target.value) ?? draft.jurisdiction })}>
            {POST_JURISDICTIONS.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row-end">
        <span className="small">Edits close {FLOOR_LIMITS.editMinutes} minutes after posting.</span>
        <span className="actions">
          <SocialLink className="btn ghost" to="/social/post/$id" params={{ id: String(post.id) }} search={{ sort: search.sort }}>
            Cancel
          </SocialLink>
          <button className="btn" type="submit">
            Save
          </button>
        </span>
      </div>
    </form>
  );
}

function RemovePost({ post }: { post: Post }) {
  const remove = useAction(removeFloorPost, { refresh: 'never' });
  const navigate = useNavigate();
  const say = useSay();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await remove.run({ post: post.id });
    if (!outcome) return;
    if (!outcome.ok) return say({ tone: 'error', text: outcome.message });
    await navigate({ to: '/social', search: { done: 'deleted' } });
  };
  return (
    <details className="remove">
      <summary className="act">{post.mine ? 'Delete' : 'Remove'}</summary>
      <form method="POST" onSubmit={submit}>
        <p className="small">{post.mine ? 'Delete this post? Its replies go with it.' : 'Remove this post from the Floor? Its replies go with it.'}</p>
        <button className="btn sm danger" type="submit">
          {post.mine ? 'Delete post' : 'Remove post'}
        </button>
      </form>
    </details>
  );
}

function Reply({ reply, post, viewer, signedIn, editing }: { reply: ReplyCard; post: Post; viewer: Viewer; signedIn: boolean; editing: boolean }) {
  const search = Route.useSearch();
  const say = useSay();
  const accept = useAction(acceptReply);
  const unaccept = useAction(unacceptReply);
  const remove = useAction(removeFloorReply);
  const navigate = useNavigate();
  const canAccept = post.mine && !reply.mine;

  const toggleAccept = async () => {
    const outcome = await (reply.accepted ? unaccept : accept).run({ reply: reply.id });
    if (outcome) say(outcome.ok ? { tone: 'quiet', text: reply.accepted ? 'No longer the answer.' : 'Marked as the answer.' } : { tone: 'error', text: outcome.message });
  };
  const removeReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await remove.run({ reply: reply.id });
    if (!outcome) return;
    if (!outcome.ok) return say({ tone: 'error', text: outcome.message });
    say(null);
    await navigate({ to: '/social/post/$id', params: { id: String(post.id) }, search: { sort: search.sort, done: 'reply-deleted' }, hash: 'replies' });
  };

  return (
    <article className={['reply', reply.accepted && 'pinned', reply.correction && 'corrects'].filter(Boolean).join(' ')} id={`reply-${reply.id}`} aria-label={`Reply from ${reply.author.name}`}>
      {reply.accepted && (
        <p className="pin-label">
          <svg aria-hidden="true">
            <use href="#tk" />
          </svg>
          {reply.author.sealed ? 'Ticked answer' : 'Accepted answer'}
        </p>
      )}
      <div className="by">
        <SocialLink className="author" to="/social/@{$handle}" params={{ handle: reply.author.handle }}>
          <Avatar name={reply.author.name} track={reply.author.track} sealed={reply.author.sealed} size="sm" />
          <span className="name-line">
            {reply.author.name}
            {reply.author.sealed && (
              <svg className="seal" role="img" aria-label="Ticked">
                <use href="#seal" />
              </svg>
            )}
          </span>
        </SocialLink>
        <Flair track={reply.author.track} />
        <span className="ago">
          <time dateTime={reply.createdAt}>{formatMoment(reply.createdAt)}</time>
          {reply.editedAt && ' · edited'}
        </span>
      </div>
      {reply.correction && (
        <p className="correction">
          <svg aria-hidden="true">
            <use href="#i-flag" />
          </svg>
          <span>Correction from a member with the seal</span>
        </p>
      )}
      {editing && reply.editable ? <EditReply reply={reply} postId={post.id} /> : <PostText text={reply.body} />}
      <div className="foot-row">
        <UsefulButton target="reply" id={reply.id} useful={reply.useful} pressed={reply.usefulByViewer} canMark={signedIn && !reply.mine} />
        {canAccept && (
          <button className="act" type="button" id={`accept-${reply.id}`} aria-pressed={reply.accepted} onClick={toggleAccept}>
            <svg aria-hidden="true">
              <use href="#tk" />
            </svg>
            Mark as the answer
          </button>
        )}
        <span className="spacer" />
        {reply.editable && (
          <SocialLink className="act" to="/social/post/$id" params={{ id: String(post.id) }} search={{ sort: search.sort, edit: `reply-${reply.id}` }} hash={`reply-${reply.id}`}>
            Edit<span className="sr-only"> your reply</span>
          </SocialLink>
        )}
        {(reply.mine || viewer.admin) && (
          <details className="remove">
            <summary className="act">
              {reply.mine ? 'Delete' : 'Remove'}
              <span className="sr-only"> reply from {reply.author.name}</span>
            </summary>
            <form method="POST" onSubmit={removeReply}>
              <button className="btn sm danger" type="submit">
                {reply.mine ? 'Delete reply' : 'Remove reply'}
              </button>
            </form>
          </details>
        )}
        {signedIn && !reply.mine && <ReportDialog target="reply" id={reply.id} about={`the reply from ${reply.author.name}`} />}
      </div>
    </article>
  );
}

function EditReply({ reply, postId }: { reply: ReplyCard; postId: number }) {
  const [body, setBody] = useState(reply.body);
  const save = useAction(editFloorReply);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const say = useSay();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await save.run({ reply: reply.id, body });
    if (!outcome) return;
    if (!outcome.ok) {
      if (!outcome.fields['body']) say({ tone: 'error', text: outcome.message });
      return;
    }
    say(null);
    await navigate({ to: '/social/post/$id', params: { id: String(postId) }, search: { sort: search.sort }, hash: `reply-${reply.id}` });
  };
  const field = fieldError(save.refusal, 'body', { id: `edit-reply-${reply.id}-error` });
  return (
    <form className="edit-form" method="POST" onSubmit={submit} noValidate>
      <label className="label-text" htmlFor={`edit-reply-${reply.id}`}>
        Edit your reply
      </label>
      <textarea className="input" id={`edit-reply-${reply.id}`} name="body" rows={4} maxLength={FLOOR_LIMITS.body} value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={field.invalid} aria-describedby={field.describedBy} autoFocus />
      {field.error && (
        <span className="error" id={field.errorId}>
          {field.error}
        </span>
      )}
      <div className="actions">
        <SocialLink className="btn sm ghost" to="/social/post/$id" params={{ id: String(postId) }} search={{ sort: search.sort }} hash={`reply-${reply.id}`}>
          Cancel
        </SocialLink>
        <button className="btn sm" type="submit">
          Save
        </button>
      </div>
    </form>
  );
}

function ReplyForm({ post, sealed }: { post: Post; sealed: boolean }) {
  const [body, setBody] = useState('');
  const [correction, setCorrection] = useState(false);
  const send = useAction(floorReply);
  const navigate = useNavigate();
  const say = useSay();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await send.run({ post: post.id, body, correction });
    if (!outcome) return;
    if (!outcome.ok) {
      if (outcome.fields['body']) document.getElementById('reply-body')?.focus();
      else say({ tone: 'error', text: outcome.message });
      return;
    }
    setBody('');
    setCorrection(false);
    /* Newest first, so the reply just sent is at the top of the list, and the page scrolls to it. */
    await navigate({ to: '/social/post/$id', params: { id: String(post.id) }, search: { sort: 'new' }, hash: `reply-${outcome.value.id}` });
    document.getElementById(`reply-${outcome.value.id}`)?.scrollIntoView({ block: 'center' });
  };
  const field = fieldError(send.refusal, 'body', { id: 'reply-body-error' });
  return (
    <form className="reply-form card" method="POST" onSubmit={submit} noValidate>
      <label htmlFor="reply-body" className="label-text">
        Your reply
      </label>
      <textarea className="input" id="reply-body" name="body" rows={4} maxLength={FLOOR_LIMITS.body} placeholder="What you’d do, and why." value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={field.invalid} aria-describedby={field.describedBy} />
      {field.error && (
        <span className="error" id={field.errorId}>
          {field.error}
        </span>
      )}
      {sealed && (
        <label className="check">
          <input type="checkbox" name="correction" checked={correction} onChange={(e) => setCorrection(e.target.checked)} />
          <span>
            <b>This corrects the post</b>
            It shows in red on the post, as a correction from a member with the seal.
          </span>
        </label>
      )}
      <div className="row-end">
        <span className="small">Cite the standard or section if you lean on one.</span>
        <button className="btn" type="submit">
          Reply
        </button>
      </div>
    </form>
  );
}
