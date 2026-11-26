import { createFileRoute, useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { channelBySlug, channelPath, LIMITS, threadPath } from '../../../../../../src/data/community.ts';
import { formatMoment } from '../../../../../../src/lib/format.ts';
import type { Moderation } from '../../../../../../src/server/community.ts';
import { Masthead } from '../../../../components/club/Masthead.tsx';
import { Notice } from '../../../../components/club/Notice.tsx';
import { Pager } from '../../../../components/club/Pager.tsx';
import { useAction } from '../../../../components/useAction.ts';
import { FieldError } from '../../../../components/FieldError.tsx';
import { PostText } from '../../../../components/PostText.tsx';
import { deletePost, editPost, GONE, landingHref, membersThread, moderateThread, reply } from '../../../../functions/members-community.ts';
import { formText } from '../../../../lib/form.ts';
import { pageIn } from '../../../../components/members/flags.ts';
import { clubTitle } from '../../../../lib/title.ts';
import s from './$id.module.css';

export const Route = createFileRoute('/members/community/threads/$id')({
  validateSearch: (search: Record<string, unknown>): { page?: number; edit?: number } => ({
    ...pageIn(search),
    ...(typeof search['edit'] === 'number' ? { edit: search['edit'] } : {}),
  }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ params, deps, location }) => membersThread({ data: { id: params.id, page: deps.page, query: location.searchStr } }),
  head: ({ loaderData }) => ({ meta: clubTitle(loaderData?.thread.title) }),
  component: ThreadPage,
});

function ThreadPage() {
  const { me, thread, posts, page, pages } = Route.useLoaderData();
  const search = Route.useSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const replying = useAction(reply, { refresh: 'never' });
  const editing = useAction(editPost, { refresh: 'never' });
  const removing = useAction(deletePost, { refresh: 'never' });
  const moderating = useAction(moderateThread, { refresh: 'never' });
  /* The four forms share one notice slot, so only the last answer's refusal is kept. A refused reply or edit keeps what was typed. */
  const [draft, setDraft] = useState('');
  const replyBody = replying.field('body', { id: 'reply-error', hint: 'reply-hint' });

  const isAdmin = me.role === 'admin';
  const canWrite = !thread.locked || isAdmin;
  const channel = channelBySlug(thread.channel);
  const flags = [thread.pinned ? 'Pinned' : null, thread.locked ? 'Locked' : null].filter(Boolean).join(' · ');
  const failure = replying.failure ?? editing.failure ?? removing.failure ?? moderating.failure;
  const replyDraft = replying.refusal ? draft : '';

  const withoutEdit = (() => {
    const query = new URLSearchParams(location.searchStr);
    query.delete('edit');
    const rest = query.toString();
    return rest ? `${location.pathname}?${rest}` : location.pathname;
  })();
  const editHref = (postId: number) => {
    const query = new URLSearchParams(location.searchStr);
    query.set('edit', String(postId));
    return `${location.pathname}?${query.toString()}#post-${postId}`;
  };

  const clear = (except?: { clear: () => void }) => {
    for (const action of [replying, editing, removing, moderating]) if (action !== except) action.clear();
  };
  /* A refusal shows above the posts. When the thread itself went, the member goes back to the board. */
  const refuse = async (by: { clear: () => void }, outcome: { message: string }, typed = '') => {
    if (outcome.message === GONE) {
      by.clear();
      return navigate({ href: '/members/community?gone' });
    }
    clear(by);
    setDraft(typed);
    await router.invalidate();
  };
  const land = async (href: string) => {
    clear();
    await navigate({ href });
    await router.invalidate();
  };

  const submitReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = formText(new FormData(form), 'body');
    const outcome = await replying.run({ thread: thread.id, body });
    if (!outcome) return;
    if (!outcome.ok) return refuse(replying, outcome, body);
    form.reset();
    await land(landingHref(outcome.value));
  };
  const submitEdit = (postId: number) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = formText(new FormData(event.currentTarget), 'body');
    const outcome = await editing.run({ post: postId, body });
    if (!outcome) return;
    if (!outcome.ok) return refuse(editing, outcome, body);
    await land(landingHref(outcome.value));
  };
  const submitDelete = (postId: number) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await removing.run({ post: postId });
    if (!outcome) return;
    if (!outcome.ok) return refuse(removing, outcome);
    await land(outcome.value.threadRemoved ? `${channelPath(outcome.value.channel)}?deleted` : landingHref(outcome.value));
  };
  const moderate = (action: Moderation) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await moderating.run({ thread: thread.id, action });
    if (!outcome) return;
    if (!outcome.ok) return refuse(moderating, outcome);
    await land(outcome.value.action === 'remove' ? `${channelPath(outcome.value.channel)}?removed` : threadPath(outcome.value.threadId));
  };
  /* The pin and lock buttons share one form, as on the page before; the pressed button says which. */
  const moderateBy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pressed = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;
    const action = pressed instanceof HTMLButtonElement ? pressed.value : '';
    const chosen = (['pin', 'unpin', 'lock', 'unlock'] as const).find((a) => a === action);
    if (chosen) await moderate(chosen)(event);
  };

  return (
    <>
      <Masthead
        label={
          <span>
            <a href="/members/community">Community</a> / <a href={channelPath(thread.channel)}>{channel?.name}</a>
          </span>
        }
        title={thread.title}
      >
        <p>
          Started by {thread.author?.name ?? 'a former member'} on {formatMoment(thread.createdAt)}.{flags && ` ${flags}.`}
        </p>
      </Masthead>

      {failure && <Notice tone="error">{failure}</Notice>}

      {isAdmin && (
        <section className={`wrap ${s.moderation}`} aria-label="Moderation">
          <span className="small">Admin</span>
          <form method="POST" onSubmit={moderateBy}>
            <button className="btn ghost" name="action" value={thread.pinned ? 'unpin' : 'pin'}>
              {thread.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button className="btn ghost" name="action" value={thread.locked ? 'unlock' : 'lock'}>
              {thread.locked ? 'Unlock' : 'Lock'}
            </button>
          </form>
          <details className={s.confirm}>
            <summary className="btn ghost">Remove thread</summary>
            <form method="POST" onSubmit={moderate('remove')}>
              <p className="small">The thread and every post in it disappear for everyone.</p>
              <button className="btn" name="action" value="remove">
                Remove for everyone
              </button>
            </form>
          </details>
        </section>
      )}

      <section className={`wrap ${s.posts}`} aria-label="Posts">
        {posts.map((post) => {
          const mine = post.author?.id === me.id;
          const isEditing = search.edit === post.id && mine && !post.deleted && canWrite;
          const editDraft = editing.refusal && isEditing ? draft : post.body;
          const editBody = editing.field('body', { id: `edit-${post.id}-error` });
          return (
            <article key={post.id} className={s.post} id={`post-${post.id}`}>
              <header className={`small ${s.meta}`}>
                <b>{post.author?.name ?? 'Former member'}</b>
                {post.author?.role === 'admin' && <span className={s.tag}>Admin</span>}
                <a href={`#post-${post.id}`}>
                  <time dateTime={post.createdAt}>{formatMoment(post.createdAt)}</time>
                </a>
                {post.editedAt && !post.deleted && <span>edited</span>}
              </header>
              {post.deleted ? (
                <p className={s.gone}>This post was deleted.</p>
              ) : isEditing ? (
                <form method="POST" className={s.form} onSubmit={submitEdit(post.id)}>
                  <label className={s.sr} htmlFor={`edit-${post.id}`}>
                    Edit your post
                  </label>
                  <textarea
                    key={editDraft}
                    className={`input ${s.textarea}`}
                    id={`edit-${post.id}`}
                    name="body"
                    rows={8}
                    required
                    maxLength={LIMITS.body.max}
                    defaultValue={editDraft}
                    {...editBody.input}
                  />
                  <FieldError field={editBody} className={s.error} />
                  <div className={s.row}>
                    <button className="btn" type="submit">
                      Save
                    </button>
                    <a href={`${withoutEdit}#post-${post.id}`}>Cancel</a>
                  </div>
                </form>
              ) : (
                <PostText text={post.body} />
              )}
              {!post.deleted && !isEditing && (mine || isAdmin) && (
                <footer className={`small ${s.row}`}>
                  {mine && canWrite && <a href={editHref(post.id)}>Edit</a>}
                  <details className={s.confirm}>
                    <summary>Delete</summary>
                    <form method="POST" onSubmit={submitDelete(post.id)}>
                      <span>{mine ? 'Delete your post? Its text is erased.' : 'Delete this post for everyone?'}</span>
                      <button className="btn" type="submit">
                        Delete
                      </button>
                    </form>
                  </details>
                </footer>
              )}
            </article>
          );
        })}
        <Pager page={page} pages={pages} label="Post pages" />
      </section>

      <section className={`wrap ${s.block}`} aria-labelledby="reply-title">
        <h2 className="head" id="reply-title">
          Reply
        </h2>
        {canWrite ? (
          <form method="POST" className={s.form} onSubmit={submitReply}>
            {thread.locked && <p className="small">This thread is locked. As an admin you can still add to it.</p>}
            <label className={s.sr} htmlFor="reply">
              Your reply
            </label>
            <textarea
              key={replyDraft}
              className={`input ${s.textarea}`}
              id="reply"
              name="body"
              rows={6}
              required
              maxLength={LIMITS.body.max}
              defaultValue={replyDraft}
              {...replyBody.input}
            />
            <span className="hint small" id="reply-hint">
              Plain text. Leave a blank line between paragraphs.
            </span>
            <FieldError field={replyBody} className={s.error} />
            <button className="btn" type="submit">
              Post reply
            </button>
          </form>
        ) : (
          <>
            <p className={s.empty}>This thread is locked. It stays here to read, but it takes no more replies.</p>
            {replyDraft && (
              <div className="field">
                <label htmlFor="unsent">Your reply was not posted. Copy it if you want to keep it.</label>
                <textarea className={`input ${s.textarea}`} id="unsent" rows={6} readOnly defaultValue={replyDraft} />
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
