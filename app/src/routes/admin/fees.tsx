import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { pageHref } from '../../../../src/lib/paging.ts';
import { useAction } from '../../components/useAction.ts';
import { Pager } from '../../components/club/Pager.tsx';
import { Empty } from '../../components/ui/Empty.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { PageHead } from '../../components/ui/PageHead.tsx';
import { Points } from '../../components/ui/Points.tsx';
import { Section } from '../../components/ui/Section.tsx';
import { Progress } from '../../components/ui/Steps.tsx';
import { Confirm, Table } from '../../components/ui/Table.tsx';
import { adminFees, deleteFeeResponse, publishFees, unpublishFees } from '../../functions/admin-fees.ts';
import { countParam } from '../../lib/search-params.ts';
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
  const publish = useAction(publishFees, { refresh: 'always' });
  const unpublish = useAction(unpublishFees, { refresh: 'always' });
  const remove = useAction(deleteFeeResponse, { refresh: 'always' });
  const busy = publish.busy || unpublish.busy || remove.busy;
  const [shown, setShown] = useState<ReactNode>(null);
  const { shown: year, editions, answers } = data;
  const current = editions.find((e) => e.edition === year);

  const onPublish = async (edition: number) => {
    const outcome = await publish.run({ edition });
    if (!outcome) return;
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
    const outcome = await unpublish.run({ edition });
    if (!outcome) return;
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
    const outcome = await remove.run({ answer });
    if (!outcome) return;
    setShown(outcome.ok ? <Notice>Answer deleted. It no longer counts in the results.</Notice> : <Notice tone="error">{outcome.message}</Notice>);
  };

  return (
    <>
      <PageHead
        label="Admin"
        title="Fee survey"
        lead={
          <>
            Results go up on <a href="/fees">the fee survey page</a> only when a host publishes them.
          </>
        }
      />

      {shown}

      <Section title="By year">
        <Points
          items={[
            { icon: 'lock', text: 'Anonymous. No name or email asked, nothing kept that says who sent it' },
            { icon: 'users', text: `Publishing needs ${data.publishMin} answers` },
            { icon: 'alert', text: 'Read them first and delete any plainly made up' },
            { icon: 'repeat', text: 'Publishing this year stops new answers until you take it down' },
          ]}
        />
        <div className={s.years}>
          <Table label="Fee survey by year">
            <thead>
              <tr>
                <th>Year</th>
                <th>Answers</th>
                <th>Status</th>
                <th>
                  <span className="visually-hidden">Results</span>
                </th>
                <th>
                  <span className="visually-hidden">Download</span>
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
          </Table>
        </div>
      </Section>

      <Section title={`${year} answers, newest first`} id="answers-title">
        {current && !current.published && <Progress value={Math.min(current.responses, data.publishMin)} max={data.publishMin} label="Answers toward publishing" />}
        {answers.length === 0 ? (
          <Empty icon="file">No answers for {year} yet. They land here as people send them from the fee survey page.</Empty>
        ) : (
          <>
            <p className={`small ${s.note}`}>
              A figure far from most answers for that fee is <mark className="mark">marked</mark>. Those are worth a second look.
            </p>
            <div className={s.answers}>
              <Table label={`${year} answers`}>
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
                      <span className="visually-hidden">Delete</span>
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
                            <span className="visually-hidden"> (far from most answers)</span>
                          </td>
                        ) : (
                          <td key={fee.figure}>{fee.text}</td>
                        ),
                      )}
                      <td>{r.confidence}</td>
                      <td>
                        <Confirm summary="Delete">
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
                        </Confirm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
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
      </Section>
    </>
  );
}
