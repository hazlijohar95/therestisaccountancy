import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { services, states } from '../../../src/data/directory.ts';
import { numberWord } from '../../../src/lib/format.ts';
import { Page } from '../components/club/Page.tsx';
import { ListingEntry } from '../components/club/ListingEntry.tsx';
import { Empty } from '../components/ui/Empty.tsx';
import { Field, Form } from '../components/ui/Form.tsx';
import { PageHead } from '../components/ui/PageHead.tsx';
import { Points } from '../components/ui/Points.tsx';
import { Actions, Section } from '../components/ui/Section.tsx';
import { Stat } from '../components/ui/Stat.tsx';
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
  { icon: 'check', text: <><b>We check</b> that each accountant is a club member, and that the practice is real and theirs: its name, town and any website.</> },
  { icon: 'alert', text: <><b>We do not check</b> their work, qualifications, registrations or insurance. The club vouches for no one listed.</> },
  { icon: 'file', text: <><b>They declare</b> the qualifications, registrations and professional indemnity cover their services require.</> },
  { icon: 'lock', text: <><b>Before you engage,</b> ask to see what they hold. Agree the work and fee in writing. Keep the engagement letter.</> },
  { icon: 'users', text: <><b>Members only.</b> A practice leaves when its accountant leaves the club.</> },
] as const;

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

  return (
    <Page>
      <PageHead
        label="Find an accountant"
        title="Find an accountant for your business."
        lead="Every practice here is run by a member of the club. Pick your state and the work you need, then contact them directly."
        aside={total > 0 ? <Stat value={total} label={total === 1 ? 'practice listed' : 'practices listed'} /> : undefined}
      />

      <Section id="practices" title="Practices" meta={total > 0 ? summary : undefined}>
        {total === 0 ? (
          <Empty icon="users">No practices listed yet. Members are adding theirs, so check back soon.</Empty>
        ) : (
          <>
            <Form key={`${state}|${service}`} method="get" action="/directory#practices" role="search" aria-label="Filter the practices" onSubmit={filter}>
              <Field label="State" id="state">
                <select className="input" id="state" name="state" defaultValue={state ?? ''}>
                  <option value="">All of Malaysia</option>
                  {states.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </Field>
              <Field label="The work you need" id="service">
                <select className="input" id="service" name="service" defaultValue={service ?? ''}>
                  <option value="">Any service</option>
                  {services.map((option) => (
                    <option key={option.slug} value={option.slug}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Actions>
                <button className="btn" type="submit">
                  Show practices
                </button>
                {filtered && <a href="/directory#practices">Clear the filter</a>}
              </Actions>
            </Form>
            {nothing && (
              <Empty
                icon="info"
                action={
                  <a className="btn ghost" href="/directory#practices">
                    See all {numberWord(total)}
                  </a>
                }
              >
                Try another state or service.
              </Empty>
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
      </Section>

      <Section id="checks" title="What does the club check?" meta="Who you are dealing with. Not their work.">
        <Points items={checks} />
        <Actions>
          <a href="/membership">Are you an accountant? Members list their practice here.</a>
        </Actions>
      </Section>
    </Page>
  );
}
