import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type ReactNode } from 'react';
import { pageHref } from '../../../../src/lib/paging.ts';
import { useActing } from '../../components/admin/acting.ts';
import { Masthead } from '../../components/club/Masthead.tsx';
import { Notice } from '../../components/club/Notice.tsx';
import { Pager } from '../../components/club/Pager.tsx';
import { countParam } from '../../components/admin/search.ts';
import { adminFees, deleteFeeResponse, publishFees, unpublishFees } from '../../functions/admin-fees.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './fees.module.css';

export const Route = createFileRoute('/admin/fees')({
  validateSearch: (search: Record<string, unknown>): { edition?: number | undefined; page?: number | undefined } => ({
    edition: countParam(search['edition']),
    page: countParam(search['page']),
  }),
  loaderDeps: ({ search }) => ({ edition: search.edition, page: search.page }),
  loader: async ({ deps, location }) => {
    const data = await adminFees({ data: deps });
    if (data.page > data.pages) throw redirect({ href: pageHref(new URL(location.href, 'http://admin'), data.pages) });
    return data;
  },
  head: () => ({ meta: clubTitle('Fee survey · Admin') }),
  component: Fees,
});

function Fees() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const publish = useServerFn(publishFees);
  const unpublish = useServerFn(unpublishFees);
  const remove = useServerFn(deleteFeeResponse);
  const { busy, act } = useActing();
  const [shown, setShown] = useState<ReactNode>(null);
  const { shown: year, editions, answers } = data;

  const onPublish = async (edition: number) => {
    const outcome = await act(() => publish({ data: { edition } }));
    setShown(
      outcome.ok ? (
        <Notice>
          The {outcome.value.edition} results are up on <a href={`/fees?edition=${outcome.value.edition}#results`}>the fee survey page</a>.
        </Notice>
      ) : (
        <Notice tone="error">{outcome.message}</Notice>
      ),
    );
  };

  const onUnpublish = async (edition: number) => {
    const outcome = await act(() => unpublish({ data: { edition } }));
    setShown(
      outcome.ok ? (
        <Notice>
          The {outcome.value.edition} results are down. {outcome.value.reopened ? 'The survey takes answers again.' : ''}
        </Notice>
      ) : (
        <Notice tone="error">{outcome.message}</Notice>
      ),
    );
  };

  const onDelete = async (answer: number) => {
    const outcome = await act(() => remove({ data: { answer } }));
    setShown(outcome.ok ? <Notice>Answer deleted. It no longer counts in the results.</Notice> : <Notice tone="error">{outcome.message}</Notice>);
  };

  return (
    <>
      <Masthead label="Admin" title="Fee survey">
        <p>
          Answers are anonymous. The form asks for no name or email, and nothing that says who sent them is kept. A year’s results go up on <a href="/fees">the fee survey page</a>{' '}
          only when a host publishes it, which needs {data.publishMin} answers. Read them first and delete any that are plainly made up. Publishing this year’s stops it taking
          answers until you take it down again.
        </p>
      </Masthead>

      {shown}

      <section className={`wrap ${s.block}`} aria-labelledby="years-title">
        <h2 className="head" id="years-title">
          By year
        </h2>
        <div className={s.scroll}>
          <table className={`ledger ${s.years}`}>
            <thead>
              <tr>
                <th>Year</th>
                <th>Answers</th>
                <th>Status</th>
                <th>
                  <span className={s.sr}>Results</span>
                </th>
                <th>
                  <span className={s.sr}>Download</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {editions.map((e) => (
                <tr key={e.edition} aria-current={e.edition === year ? 'true' : undefined}>
                  <td>
                    <Link to="/admin/fees" search={{ edition: e.edition }} hash="answers-title">
                      {e.edition}
                    </Link>
                  </td>
                  <td>{e.responses}</td>
                  <td>{e.status}</td>
                  <td className={s.act}>
                    {e.published ? (
                      <form
                        method="POST"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void onUnpublish(e.edition);
                        }}
                      >
                        <button className="btn ghost" type="submit" disabled={busy}>
                          Take down
                        </button>
                      </form>
                    ) : (
                      <form
                        method="POST"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void onPublish(e.edition);
                        }}
                      >
                        <button className="btn" type="submit" disabled={busy || !e.publishable}>
                          Publish
                        </button>
                      </form>
                    )}
                    {e.responses > 0 && <a href={`/fees?edition=${e.edition}#results`}>{e.published ? 'See them' : 'Preview'}</a>}
                  </td>
                  <td>
                    {e.responses > 0 && (
                      <a href={`/admin/fees.csv?edition=${e.edition}`} download>
                        CSV
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`wrap ${s.block}`} aria-labelledby="answers-title">
        <h2 className="head" id="answers-title">
          {year} answers, newest first
        </h2>
        {answers.length === 0 ? (
          <p className={s.empty}>No answers for {year} yet. They appear here as people send them from the fee survey page.</p>
        ) : (
          <>
            <p className={`small ${s.small}`}>
              A figure far from most answers for that fee is <mark className="mark">marked</mark>, so the ones worth a second look stand out.
            </p>
            <div className={s.scroll}>
              <table className={`ledger ${s.answers}`}>
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Practice</th>
                    <th>Pricing</th>
                    {data.figures.map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                    <th>Sure (1 to 5)</th>
                    <th>
                      <span className={s.sr}>Delete</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {answers.map((r) => (
                    <tr key={r.id}>
                      <td>{r.received}</td>
                      <td className={s.practice}>{r.practice}</td>
                      <td>{r.pricing}</td>
                      {r.fees.map((fee) =>
                        fee.unusual ? (
                          <td key={fee.figure}>
                            <mark className="mark">{fee.text}</mark>
                            <span className={s.sr}> (far from most answers)</span>
                          </td>
                        ) : (
                          <td key={fee.figure}>{fee.text}</td>
                        ),
                      )}
                      <td>{r.confidence}</td>
                      <td>
                        <details className={s.confirm}>
                          <summary>Delete</summary>
                          <form
                            method="POST"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void onDelete(r.id);
                            }}
                          >
                            <button className="btn" type="submit" disabled={busy}>
                              Delete for good
                            </button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={data.page}
              pages={data.pages}
              label={`${year} answer pages`}
              link={(page, rel, text) => (
                <Link to="/admin/fees" search={{ ...search, page: page > 1 ? page : undefined }} rel={rel}>
                  {text}
                </Link>
              )}
            />
          </>
        )}
      </section>
    </>
  );
}
