import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { services, states } from '../../../src/data/directory.ts';
import { numberWord } from '../../../src/lib/format.ts';
import { Page } from '../components/club/Page.tsx';
import { PageHead } from '../components/club/PageHead.tsx';
import { ListingEntry } from '../components/club/ListingEntry.tsx';
import { Section } from '../components/public/Section.tsx';
import { directoryPage } from '../functions/public-directory.ts';
import { linkTextParam } from '../lib/search-params.ts';
import { clubTitle } from '../lib/title.ts';
import s from './directory.module.css';

export const Route = createFileRoute('/directory')({
  validateSearch: (search: Record<string, unknown>): { state?: string; service?: string } => ({
    ...(search['state'] !== undefined && { state: linkTextParam(search['state']) }),
    ...(search['service'] !== undefined && { service: linkTextParam(search['service']) }),
  }),
  loaderDeps: ({ search }) => ({ state: search.state ?? '', service: search.service ?? '' }),
  loader: ({ deps }) => directoryPage({ data: deps }),
  head: () => ({
    meta: [
      ...clubTitle('Find an accountant'),
      { name: 'description', content: 'Accountants in practice across Malaysia who are members of The Rest Is Accountancy. Pick your state and the work you need, then contact them directly.' },
    ],
  }),
  component: Directory,
});

const checks = [
  { term: 'We check', detail: 'That each accountant here is a member of the club, and that the practice is real and theirs: its name, its town and any website.' },
  { term: 'We do not check', detail: 'The quality of their work. The club does not vouch for anyone listed, and does not check qualifications, registrations or insurance.' },
  { term: 'They declare', detail: 'That they hold the qualifications, registrations and professional indemnity cover that the services they list require.' },
  { term: 'Before you engage', detail: 'Ask to see what they hold. Agree the work and the fee in writing, and keep the engagement letter.' },
  { term: 'Who stays listed', detail: 'Members only. A practice leaves the directory when its accountant leaves the club.' },
];

function Directory() {
  const { total, matches, anywhere, summary, state, service } = Route.useLoaderData();
  const navigate = useNavigate();
  const filtered = state !== null || service !== null;
  const nothing = filtered && matches.length === 0 && anywhere.length === 0;

  /* Filtering stays in the page; the form still works as a plain GET before the page's script runs. */
  const filter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const picked = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' && value ? value : undefined;
    };
    const next = { state: picked('state'), service: picked('service') };
    void navigate({ to: '/directory', search: { ...(next.state && { state: next.state }), ...(next.service && { service: next.service }) }, hash: 'practices' });
  };

  const rail =
    total > 0 ? (
      <form key={`${state}|${service}`} className={s.filter} method="get" action="/directory#practices" role="search" aria-label="Filter the practices" onSubmit={filter}>
        <div className="field">
          <label htmlFor="state">State</label>
          <select className="input" id="state" name="state" defaultValue={state ?? ''}>
            <option value="">All of Malaysia</option>
            {states.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="service">The work you need</label>
          <select className="input" id="service" name="service" defaultValue={service ?? ''}>
            <option value="">Any service</option>
            {services.map((option) => (
              <option key={option.slug} value={option.slug}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className={s.go}>
          <button className="btn" type="submit">
            Show practices
          </button>
          {filtered && <a href="/directory#practices">Clear the filter</a>}
        </div>
      </form>
    ) : null;

  return (
    <Page>
      <PageHead
        label="Find an accountant"
        title="Find an accountant for your business."
        lead="Every practice here is run by a member of The Rest Is Accountancy, a club for accountants in practice. Pick your state and the work you need, then contact them directly. Your enquiry goes straight to them."
      />

      <Section id="practices" no={1} title="Practices" rail={rail}>
        <div className={s.results}>
          {total === 0 ? (
            <p className={s.empty}>No practices are listed yet. Members of the club are adding theirs, so check back soon.</p>
          ) : (
            <>
              <p className={`${s.count} serif`}>{summary}</p>
              {nothing && (
                <p className={s.empty}>
                  Try another state or service, or <a href="/directory#practices">clear the filter</a> to see all {numberWord(total)}.
                </p>
              )}
              {matches.length > 0 && (
                <ol className={s.entries} aria-label={state ? `Practices in ${state}` : 'Practices'}>
                  {matches.map((listing) => (
                    <li key={listing.memberId}>
                      <ListingEntry listing={listing} />
                    </li>
                  ))}
                </ol>
              )}
              {anywhere.length > 0 && (
                <>
                  <p className={`label ${s.group}`} id="anywhere-title">
                    Based elsewhere, taking clients anywhere in Malaysia
                  </p>
                  <ol className={s.entries} aria-labelledby="anywhere-title">
                    {anywhere.map((listing) => (
                      <li key={listing.memberId}>
                        <ListingEntry listing={listing} />
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </>
          )}
        </div>
      </Section>

      <Section id="checks" no={2} title="What does the club check?" intro="Enough for you to know who you are dealing with. Not their work.">
        <dl className="facts">
          {checks.map(({ term, detail }) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
        <p className={`small ${s.aside}`}>
          Are you an accountant? Members of the club can list their practice here. <a href="/membership">About membership</a>.
        </p>
      </Section>
    </Page>
  );
}
