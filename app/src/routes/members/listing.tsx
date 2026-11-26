import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { LISTING_LIMITS, listingPath, services, states } from '../../../../src/data/directory.ts';
import type { Listing, SaveOutcome } from '../../../../src/server/listings.ts';
import { ListingEntry } from '../../components/club/ListingEntry.tsx';
import { Masthead } from '../../components/club/Masthead.tsx';
import { Notice } from '../../components/club/Notice.tsx';
import { FieldError } from '../../components/FieldError.tsx';
import { useAction } from '../../components/useAction.ts';
import { membersListing, pauseListing, saveListing } from '../../functions/members-listings.ts';
import { formText } from '../../lib/form.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './listing.module.css';
import { hostFirstName } from '../../../../src/data/authors.ts';

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
  submitted: `Sent. ${hostFirstName} checks it, and we email you once it is in the directory.`,
  resubmitted: `Sent back to ${hostFirstName}. It goes in the directory again once ${hostFirstName} has checked it.`,
  updated: `Saved. It still waits for ${hostFirstName} to check it.`,
  unchanged: 'Nothing had changed, so nothing was sent.',
};

const isOutcome = (value: string): value is SaveOutcome => Object.hasOwn(savedNotice, value);

function standing(l: Listing | null): string {
  if (!l) return `Business owners use the club's directory to find an accountant, and ${hostFirstName} checks each listing before it goes up.`;
  if (l.review.state === 'returned') return `${hostFirstName} sent your listing back with this note.`;
  if (l.review.state === 'pending') return l.paused ? `${hostFirstName} is checking your listing, which stays out of the directory while it is paused.` : `${hostFirstName} is checking your listing, and we email you once it is in the directory.`;
  if (l.shown) return 'Your practice is in the directory, where business owners can find it.';
  return l.paused ? 'Your listing is paused, so business owners cannot see it until you unpause it.' : 'Your listing is approved, but it is out of the directory until your membership is paid up.';
}

function ListingPage() {
  const { email, listing } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const save = useAction(saveListing, { refresh: 'never' });
  const pause = useAction(pauseListing, { refresh: 'never' });
  const [paused, setPaused] = useState<{ paused: boolean } | null>(null);

  const practice = save.field('practice');
  const stateField = save.field('state');
  const town = save.field('town');
  const servicesField = save.field('services', { hint: 'services-hint' });
  const niche = save.field('niche', { hint: 'niche-hint' });
  const bio = save.field('bio', { hint: 'bio-hint' });
  const qualifications = save.field('qualifications', { hint: 'qualifications-hint' });
  const website = save.field('website');
  const contactEmail = save.field('contactEmail', { hint: 'contact-hint' });
  const declared = save.field('declared');
  const failure = save.failure ?? pause.failure;
  /* The last answer from either form on this page. An outcome from before it no longer shows. */
  const outcome = save.refusal === null && pause.refusal === null && paused === null ? search.saved : undefined;
  const submit = !listing ? 'Send for a check' : listing.review.state === 'returned' ? 'Send it back for a check' : 'Save changes';
  const warning = listing?.review.state === 'listed' ? `Saving a change takes your listing out of the directory until ${hostFirstName} has checked it. Pausing does not.` : null;
  const see = listing ? (listing.shown ? { href: listingPath(listing), label: 'See it in the directory' } : { href: '#preview', label: 'Preview how it reads' }) : null;

  const submitListing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await save.run({
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
    });
    if (!result) return;
    setPaused(null);
    pause.clear();
    if (!result.ok) return;
    await navigate({ to: '/members/listing', search: { saved: result.value.outcome } });
    await router.invalidate();
  };
  const togglePause = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!listing) return;
    const result = await pause.run({ paused: !listing.paused });
    if (!result) return;
    save.clear();
    setPaused(result.ok ? result.value : null);
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
      {paused && <Notice>{paused.paused ? 'Paused. It is out of the directory until you unpause it.' : 'Unpaused.'}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}

      <section className={`wrap ${s.block}`} aria-labelledby="form-title">
        <h2 className="head" id="form-title">
          {listing ? 'Your listing' : 'Write your listing'}
        </h2>
        <p className={`small ${s.intro}`}>Everything here is shown in the directory, written for a business owner looking for an accountant. {hostFirstName} checks that you are a member and that the practice is real and yours.</p>
        <form key={listing?.updatedAt ?? 'new'} method="POST" className={s.form} onSubmit={submitListing}>
          <div className="field">
            <label htmlFor="practice">Practice name</label>
            <input className="input" id="practice" name="practice" required maxLength={LISTING_LIMITS.practice} autoComplete="organization" defaultValue={listing?.practice ?? ''} {...practice.input} />
            <FieldError field={practice} className={s.error} />
          </div>

          <div className={`pair ${s.pair}`}>
            <div className="field">
              <label htmlFor="state">State</label>
              <select className="input" id="state" name="state" required defaultValue={listing?.state ?? ''} {...stateField.input}>
                <option value="" disabled>
                  Pick a state
                </option>
                {states.map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
              <FieldError field={stateField} className={s.error} />
            </div>
            <div className="field">
              <label htmlFor="town">Town or city</label>
              <input className="input" id="town" name="town" required maxLength={LISTING_LIMITS.town} autoComplete="address-level2" defaultValue={listing?.town ?? ''} {...town.input} />
              <FieldError field={town} className={s.error} />
            </div>
          </div>

          <label className={s.check}>
            <input type="checkbox" name="remote" defaultChecked={listing?.remote ?? false} />
            <span>
              <b>I take clients anywhere in Malaysia</b>
              <span className="hint">You are shown to business owners in other states too.</span>
            </span>
          </label>

          <fieldset className={`field ${s.services}`} aria-describedby={servicesField.input['aria-describedby']}>
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
            <FieldError field={servicesField} className={s.error} />
          </fieldset>

          <div className="field">
            <label htmlFor="niche">
              Who you work with most <span className="hint">(optional)</span>
            </label>
            <input className="input" id="niche" name="niche" maxLength={LISTING_LIMITS.niche} defaultValue={listing?.niche ?? ''} {...niche.input} />
            <span className="hint" id="niche-hint">
              For example: clinics, restaurants or online sellers.
            </span>
            <FieldError field={niche} className={s.error} />
          </div>

          <div className="field">
            <label htmlFor="bio">About your practice</label>
            <textarea className={`input ${s.textarea}`} id="bio" name="bio" rows={6} required maxLength={LISTING_LIMITS.bio} defaultValue={listing?.bio ?? ''} {...bio.input} />
            <span className="hint" id="bio-hint">
              What you do, who for, and how you work. Up to {LISTING_LIMITS.bio} characters.
            </span>
            <FieldError field={bio} className={s.error} />
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
              {...qualifications.input}
            />
            <span className="hint" id="qualifications-hint">
              As you write them after your name. For example: Chartered Accountant (MIA), ACCA.
            </span>
            <FieldError field={qualifications} className={s.error} />
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
              {...website.input}
            />
            <FieldError field={website} className={s.error} />
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
              {...contactEmail.input}
            />
            <span className="hint" id="contact-hint">
              Shown in the directory. Business owners write to you here; the club never sees it.
            </span>
            <FieldError field={contactEmail} className={s.error} />
          </div>

          <label className={`${s.check} ${s.declare}`}>
            <input type="checkbox" name="declared" required {...declared.input} />
            <span>
              <b>I hold the qualifications, registrations and professional indemnity cover that the services I list require.</b>
              <span className="hint">The club does not check these, and the directory tells business owners so.</span>
            </span>
          </label>
          <FieldError field={declared} className={s.error} />

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
          <p className={`small ${s.intro}`}>{listing.review.state === 'listed' ? 'This is what business owners see once it is back in the directory.' : `This is what business owners see once ${hostFirstName} approves it. Until then only you and ${hostFirstName} can see it.`}</p>
          <div className={s.entries}>
            <ListingEntry listing={listing} />
          </div>
        </section>
      )}
    </>
  );
}
