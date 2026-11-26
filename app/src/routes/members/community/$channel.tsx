import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import { LIMITS } from '../../../../../src/data/community.ts';
import { Masthead } from '../../../components/club/Masthead.tsx';
import { Notice } from '../../../components/club/Notice.tsx';
import { Pager } from '../../../components/club/Pager.tsx';
import { ThreadList } from '../../../components/members/ThreadList.tsx';
import { landingHref, membersChannel, startThread } from '../../../functions/members-community.ts';
import type { Outcome } from '../../../lib/outcome.ts';
import { flags, pageIn } from '../../../components/members/flags.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './$channel.module.css';

export const Route = createFileRoute('/members/community/$channel')({
  validateSearch: (search: Record<string, unknown>): { page?: number; removed?: true; deleted?: true } => ({
    ...flags('removed', 'deleted')(search),
    ...pageIn(search),
  }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ params, deps, location }) => membersChannel({ data: { channel: params.channel, page: deps.page, query: location.searchStr } }),
  head: ({ loaderData }) => ({ meta: clubTitle(loaderData?.channel.name) }),
  component: Channel,
});

function Channel() {
  const { channel, threads, page, pages } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const start = useServerFn(startThread);
  const [outcome, setOutcome] = useState<Outcome<unknown> | null>(null);
  const fields = outcome && !outcome.ok ? outcome.fields : {};
  const failure = outcome && !outcome.ok ? (Object.keys(outcome.fields).length === 0 ? outcome.message : (fields['channel'] ?? null)) : null;
  const notice = search.removed ? 'Thread removed.' : search.deleted ? 'Post deleted. It was the last one, so the thread is gone too.' : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await start({ data: { channel: channel.slug, title: String(form.get('title') ?? ''), body: String(form.get('body') ?? '') } });
    setOutcome(result);
    if (result.ok) await navigate({ href: landingHref(result.value) });
  };

  return (
    <>
      <Masthead label={<a href="/members/community">Community</a>} title={channel.name} narrow>
        <p>{channel.about}</p>
      </Masthead>

      {notice && <Notice>{notice}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}

      <section className={`wrap ${s.block}`} aria-labelledby="start-title">
        <details className={s.start} open={outcome && !outcome.ok ? true : undefined}>
          <summary className="btn">
            <span id="start-title">Start a thread</span>
          </summary>
          <form method="POST" className={s.form} onSubmit={submit}>
            <div className="field">
              <label htmlFor="title">Title</label>
              <input
                className="input"
                id="title"
                name="title"
                required
                minLength={LIMITS.title.min}
                maxLength={LIMITS.title.max}
                aria-invalid={fields['title'] ? true : undefined}
                aria-describedby={fields['title'] ? 'title-hint title-error' : 'title-hint'}
              />
              <span className="hint" id="title-hint">
                A question or a headline. Others decide from this whether to open it.
              </span>
              {fields['title'] && (
                <span className={`error ${s.error}`} id="title-error">
                  {fields['title']}
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="body">Post</label>
              <textarea
                className={`input ${s.textarea}`}
                id="body"
                name="body"
                rows={8}
                required
                maxLength={LIMITS.body.max}
                aria-invalid={fields['body'] ? true : undefined}
                aria-describedby={fields['body'] ? 'body-hint body-error' : 'body-hint'}
              />
              <span className="hint" id="body-hint">
                Plain text. Leave a blank line between paragraphs. Links starting with https:// become clickable.
              </span>
              {fields['body'] && (
                <span className={`error ${s.error}`} id="body-error">
                  {fields['body']}
                </span>
              )}
            </div>
            <button className="btn" type="submit">
              Post thread
            </button>
          </form>
        </details>
      </section>

      <section className={`wrap ${s.block}`} aria-labelledby="threads-title">
        <h2 className="head" id="threads-title">
          Threads
        </h2>
        {threads.length === 0 ? <p className={s.empty}>No threads here yet. Start the first one.</p> : <ThreadList threads={threads} />}
        <Pager page={page} pages={pages} label="Thread pages" />
      </section>
    </>
  );
}
