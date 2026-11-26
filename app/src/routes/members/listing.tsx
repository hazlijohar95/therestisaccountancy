import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent, type ReactNode } from 'react';
import { LISTING_LIMITS, listingPath, services, states } from '../../../../src/data/directory.ts';
import type { Listing, SaveOutcome } from '../../../../src/server/listings.ts';
import { ListingEntry } from '../../components/club/ListingEntry.tsx';
import { Masthead } from '../../components/club/Masthead.tsx';
import { Notice } from '../../components/club/Notice.tsx';
import { membersListing, pauseListing, saveListing } from '../../functions/members-listings.ts';
import { formText } from '../../lib/form.ts';
import type { Outcome } from '../../lib/outcome.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './listing.module.css';

export const Route = createFileRoute('/members/listing')({
  validateSearch: (search: Record<string, unknown>): { saved?: SaveOutcome } => {
    const saved = search['saved'];
    return typeof saved === 'string' && isOutcome(saved) ? { saved } : {};
  },
  loader: () => membersListing(),
  head: () => ({ meta: clubTitle('Your listing') }),
  component: ListingPage,
});

const savedNotice: Record<SaveOutcome, string> = {
  submitted: 'Sent. A host checks it, and we email you once it is in the directory.',
  resubmitted: 'Sent back to the hosts. It goes in the directory again once a host has checked it.',
  updated: 'Saved. It still waits for a host to check it.',
  unchanged: 'Nothing had changed, so nothing was sent.',
};

const isOutcome = (value: string): value is SaveOutcome => Object.hasOwn(savedNotice, value);

function standing(l: Listing | null): string {
  if (!l) return "Business owners use the club's directory to find an accountant, and a host checks each listing before it goes up.";
  if (l.review.state === 'returned') return 'A host sent your listing back with this note.';
  if (l.review.state === 'pending') return l.paused ? 'A host is checking your listing, which stays out of the directory while it is paused.' : 'A host is checking your listing, and we email you once it is in the directory.';
  if (l.shown) return 'Your practice is in the directory, where business owners can find it.';
  return l.paused ? 'Your listing is paused, so business owners cannot see it until you unpause it.' : 'Your listing is approved, but it is out of the directory until your membership is paid up.';
}

function ListingPage() {
  const { email, listing } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const save = useServerFn(saveListing);
  const pause = useServerFn(pauseListing);
  /* The last answer from either form on this page. An outcome from before it no longer shows. */
  const [saved, setSaved] = useState<Outcome<unknown> | null>(null);
  const [paused, setPaused] = useState<Outcome<{ paused: boolean }> | null>(null);

  const fields = saved && !saved.ok ? saved.fields : {};
  const failure = [saved, paused].map((o) => (o && !o.ok && Object.keys(o.fields).length === 0 ? o.message : null)).find(Boolean) ?? null;
  const outcome = saved === null && paused === null ? search.saved : undefined;
  const submit = !listing ? 'Send for a check' : listing.review.state === 'returned' ? 'Send it back for a check' : 'Save changes';
  const warning = listing?.review.state === 'listed' ? 'Saving a change takes your listing out of the directory until a host has checked it. Pausing does not.' : null;
  const see = listing ? (listing.shown ? { href: listingPath(listing), label: 'See it in the directory' } : { href: '#preview', label: 'Preview how it reads' }) : null;
  const error = (name: string): ReactNode =>
    fields[name] && (
      <span className={`error ${s.error}`} id={`${name}-error`}>
        {fields[name]}
      </span>
    );
  const invalid = (name: string) => (fields[name] ? true : undefined);

  const submitListing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await save({
      data: {
        practice: formText(form, 'practice'),
        state: formText(form, 'state'),
        town: formText(form, 'town'),
        remote: form.has('remote'),
        services: form.getAll('services').map(String),
        niche: formText(form, 'niche'),
        bio: formText(form, 'bio'),
        qualifications: formText(form, 'qualifications'),
        website: formText(form, 'website'),
        contactEmail: formText(form, 'contactEmail'),
        declared: form.has('declared'),
      },
    });
    setPaused(null);
    if (!result.ok) return setSaved(result);
    setSaved(null);
    await navigate({ to: '/members/listing', search: { saved: result.value.outcome } });
    await router.invalidate();
  };
  const togglePause = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!listing) return;
    const result = await pause({ data: { paused: !listing.paused } });
    setSaved(null);
    setPaused(result);
    /* Forms answer on the bare address, so a notice from an earlier save never shows beside this one. */
    await navigate({ to: '/members/listing', search: {} });
    await router.invalidate();
  };

  return (
    <>
      <Masthead label="Find an accountant" title={listing?.practice ?? 'List your practice.'}>
        <p>{standing(listing)}</p>
        {listing?.review.state === 'returned' && <blockquote className={s.note}>{listing.review.note}</blockquote>}
        {listing && see && (
          <div className={s.row}>
            <a className="btn" href={see.href}>
              {see.label}
            </a>
            <form method="POST" onSubmit={togglePause}>
              <button className="btn ghost" type="submit">
                {listing.paused ? 'Unpause it' : 'Pause it'}
              </button>
            </form>
          </div>
        )}
      </Masthead>

      {outcome && <Notice>{savedNotice[outcome]}</Notice>}
      {paused?.ok && <Notice>{paused.value.paused ? 'Paused. It is out of the directory until you unpause it.' : 'Unpaused.'}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}

      <section className={`wrap ${s.block}`} aria-labelledby="form-title">
        <h2 className="head" id="form-title">
          {listing ? 'Your listing' : 'Write your listing'}
        </h2>
        <p className={`small ${s.intro}`}>Everything here is shown in the directory, written for a business owner looking for an accountant. A host checks that you are a member and that the practice is real and yours.</p>
        <form key={listing?.updatedAt ?? 'new'} method="POST" className={s.form} onSubmit={submitListing}>
          <div className="field">
            <label htmlFor="practice">Practice name</label>
            <input className="input" id="practice" name="practice" required maxLength={LISTING_LIMITS.practice} autoComplete="organization" defaultValue={listing?.practice ?? ''} aria-invalid={invalid('practice')} aria-describedby={fields['practice'] ? 'practice-error' : undefined} />
            {error('practice')}
          </div>

          <div className={`pair ${s.pair}`}>
            <div className="field">
              <label htmlFor="state">State</label>
              <select className="input" id="state" name="state" required defaultValue={listing?.state ?? ''} aria-invalid={invalid('state')} aria-describedby={fields['state'] ? 'state-error' : undefined}>
                <option value="" disabled>
                  Pick a state
                </option>
                {states.map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
              {error('state')}
            </div>
            <div className="field">
              <label htmlFor="town">Town or city</label>
              <input className="input" id="town" name="town" required maxLength={LISTING_LIMITS.town} autoComplete="address-level2" defaultValue={listing?.town ?? ''} aria-invalid={invalid('town')} aria-describedby={fields['town'] ? 'town-error' : undefined} />
              {error('town')}
            </div>
          </div>

          <label className={s.check}>
            <input type="checkbox" name="remote" defaultChecked={listing?.remote ?? false} />
            <span>
              <b>I take clients anywhere in Malaysia</b>
              <span className="hint">You are shown to business owners in other states too.</span>
            </span>
          </label>

          <fieldset className={`field ${s.services}`} aria-describedby={fields['services'] ? 'services-hint services-error' : 'services-hint'}>
            <legend>Services</legend>
            <span className="hint" id="services-hint">
              Tick every one you offer.
            </span>
            <div className={s.options}>
              {services.map((service) => (
                <label key={service.slug} className={s.check}>
                  <input type="checkbox" name="services" value={service.slug} defaultChecked={listing?.services.includes(service.slug) ?? false} />
                  <span>{service.label}</span>
                </label>
              ))}
            </div>
            {error('services')}
          </fieldset>

          <div className="field">
            <label htmlFor="niche">
              Who you work with most <span className="hint">(optional)</span>
            </label>
            <input className="input" id="niche" name="niche" maxLength={LISTING_LIMITS.niche} defaultValue={listing?.niche ?? ''} aria-describedby={fields['niche'] ? 'niche-hint niche-error' : 'niche-hint'} aria-invalid={invalid('niche')} />
            <span className="hint" id="niche-hint">
              For example: clinics, restaurants or online sellers.
            </span>
            {error('niche')}
          </div>

          <div className="field">
            <label htmlFor="bio">About your practice</label>
            <textarea className={`input ${s.textarea}`} id="bio" name="bio" rows={6} required maxLength={LISTING_LIMITS.bio} defaultValue={listing?.bio ?? ''} aria-describedby={fields['bio'] ? 'bio-hint bio-error' : 'bio-hint'} aria-invalid={invalid('bio')} />
            <span className="hint" id="bio-hint">
              What you do, who for, and how you work. Up to {LISTING_LIMITS.bio} characters.
            </span>
            {error('bio')}
          </div>

          <div className="field">
            <label htmlFor="qualifications">Qualifications</label>
            <input
              className="input"
              id="qualifications"
              name="qualifications"
              required
              maxLength={LISTING_LIMITS.qualifications}
              defaultValue={listing?.qualifications ?? ''}
              aria-describedby={fields['qualifications'] ? 'qualifications-hint qualifications-error' : 'qualifications-hint'}
              aria-invalid={invalid('qualifications')}
            />
            <span className="hint" id="qualifications-hint">
              As you write them after your name. For example: Chartered Accountant (MIA), ACCA.
            </span>
            {error('qualifications')}
          </div>

          <div className="field">
            <label htmlFor="website">
              Website <span className="hint">(optional)</span>
            </label>
            <input
              className="input"
              id="website"
              name="website"
              inputMode="url"
              autoComplete="url"
              maxLength={LISTING_LIMITS.website}
              placeholder="rahman.com.my"
              defaultValue={listing?.website ?? ''}
              aria-invalid={invalid('website')}
              aria-describedby={fields['website'] ? 'website-error' : undefined}
            />
            {error('website')}
          </div>

          <div className="field">
            <label htmlFor="contactEmail">Email for enquiries</label>
            <input
              className="input"
              id="contactEmail"
              name="contactEmail"
              type="email"
              required
              autoComplete="email"
              defaultValue={listing?.contactEmail ?? email}
              aria-describedby={fields['contactEmail'] ? 'contact-hint contactEmail-error' : 'contact-hint'}
              aria-invalid={invalid('contactEmail')}
            />
            <span className="hint" id="contact-hint">
              Shown in the directory. Business owners write to you here; the club never sees it.
            </span>
            {error('contactEmail')}
          </div>

          <label className={`${s.check} ${s.declare}`}>
            <input type="checkbox" name="declared" required aria-invalid={invalid('declared')} aria-describedby={fields['declared'] ? 'declared-error' : undefined} />
            <span>
              <b>I hold the qualifications, registrations and professional indemnity cover that the services I list require.</b>
              <span className="hint">The club does not check these, and the directory tells business owners so.</span>
            </span>
          </label>
          {error('declared')}

          <div className={s.send}>
            <button className="btn" type="submit">
              {submit}
            </button>
            {warning && <span className="small">{warning}</span>}
          </div>
        </form>
      </section>

      {listing && !listing.shown && (
        <section className={`wrap ${s.block}`} id="preview" aria-labelledby="preview-title">
          <h2 className="head" id="preview-title">
            How it reads in the directory
          </h2>
          <p className={`small ${s.intro}`}>{listing.review.state === 'listed' ? 'This is what business owners see once it is back in the directory.' : 'This is what business owners see once a host approves it. Until then only you and the hosts can see it.'}</p>
          <div className={s.entries}>
            <ListingEntry listing={listing} />
          </div>
        </section>
      )}
    </>
  );
}
