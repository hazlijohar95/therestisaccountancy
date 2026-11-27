import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { hostFirstName } from '../../../../src/data/authors.ts';
import { LISTING_LIMITS, listingPath, services, states } from '../../../../src/data/directory.ts';
import type { Listing, SaveOutcome } from '../../../../src/server/listings.ts';
import { ListingEntry } from '../../components/club/ListingEntry.tsx';
import { FieldError } from '../../components/FieldError.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Check, Field, Form } from '../../components/ui/Form.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { PageHead } from '../../components/ui/PageHead.tsx';
import { Points } from '../../components/ui/Points.tsx';
import { Actions, Section } from '../../components/ui/Section.tsx';
import { useAction } from '../../components/useAction.ts';
import { membersListing, pauseListing, saveListing } from '../../functions/members-listings.ts';
import { formText } from '../../lib/form.ts';
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
  submitted: `Sent. ${hostFirstName} checks it, and we email you once it is in the directory.`,
  resubmitted: `Sent back to ${hostFirstName}. It goes in the directory again once ${hostFirstName} has checked it.`,
  updated: `Saved. It still waits for ${hostFirstName} to check it.`,
  unchanged: 'Nothing had changed, so nothing was sent.',
};

const isOutcome = (value: string): value is SaveOutcome => Object.hasOwn(savedNotice, value);

/** Where the listing stands: a badge, and one line on what it means. */
function standing(l: Listing | null): { badge: string | null; listed: boolean; text: string } {
  if (!l) return { badge: null, listed: false, text: `Business owners find accountants in the club's directory. ${hostFirstName} checks each listing first.` };
  if (l.review.state === 'returned') return { badge: 'Sent back', listed: false, text: `${hostFirstName} sent it back with a note.` };
  if (l.review.state === 'pending') return { badge: 'Being checked', listed: false, text: l.paused ? `${hostFirstName} is checking it. It stays out of the directory while it is paused.` : `${hostFirstName} is checking it. We email you once it is in the directory.` };
  if (l.shown) return { badge: 'In the directory', listed: true, text: 'Business owners can find your practice.' };
  return l.paused ? { badge: 'Paused', listed: false, text: 'Business owners cannot see it until you unpause it.' } : { badge: 'Approved', listed: false, text: 'It is out of the directory until your membership is paid up.' };
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
  const contactEmail = save.field('contactEmail', { hint: 'contactEmail-hint' });
  const declared = save.field('declared');
  const failure = save.failure ?? pause.failure;
  /* The last answer from either form on this page. An outcome from before it no longer shows. */
  const outcome = save.refusal === null && pause.refusal === null && paused === null ? search.saved : undefined;
  const submit = !listing ? 'Send for a check' : listing.review.state === 'returned' ? 'Send it back for a check' : 'Save changes';
  const warning = listing?.review.state === 'listed' ? `Saving a change takes your listing out of the directory until ${hostFirstName} has checked it. Pausing does not.` : null;
  const see = listing ? (listing.shown ? { href: listingPath(listing), label: 'See it in the directory' } : { href: '#preview', label: 'Preview how it reads' }) : null;
  const where = standing(listing);

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
      <PageHead
        label="Find an accountant"
        title={listing?.practice ?? 'List your practice.'}
        lead={
          <>
            {where.badge && <Badge tone={where.listed ? 'solid' : 'plain'}>{where.badge}</Badge>} {where.text}
          </>
        }
        aside={
          listing?.review.state === 'returned' && (
            <figure className={s.note}>
              <figcaption className="label">{hostFirstName}'s note</figcaption>
              <blockquote>{listing.review.note}</blockquote>
            </figure>
          )
        }
        actions={
          listing &&
          see && (
            <>
              <a className="btn" href={see.href}>
                {see.label}
              </a>
              <form method="POST" onSubmit={togglePause}>
                <button className="btn ghost" type="submit">
                  {listing.paused ? 'Unpause it' : 'Pause it'}
                </button>
              </form>
            </>
          )
        }
      />

      {outcome && <Notice>{savedNotice[outcome]}</Notice>}
      {paused && <Notice>{paused.paused ? 'Paused. It is out of the directory until you unpause it.' : 'Unpaused.'}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}

      <Section title={listing ? 'Your listing' : 'Write your listing'}>
        <Points
          items={[
            { icon: 'users', text: 'Everything here is shown in the directory, to business owners looking for an accountant.' },
            { icon: 'check', text: `${hostFirstName} checks that you are a member and that the practice is real and yours.` },
          ]}
        />
        <Form key={listing?.updatedAt ?? 'new'} wide onSubmit={submitListing}>
          <Field label="Practice name" id="practice" field={practice}>
            <input className="input" id="practice" name="practice" required maxLength={LISTING_LIMITS.practice} autoComplete="organization" defaultValue={listing?.practice ?? ''} {...practice.input} />
          </Field>

          <div className={`pair ${s.pair}`}>
            <Field label="State" id="state" field={stateField}>
              <select className="input" id="state" name="state" required defaultValue={listing?.state ?? ''} {...stateField.input}>
                <option value="" disabled>
                  Pick a state
                </option>
                {states.map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
            </Field>
            <Field label="Town or city" id="town" field={town}>
              <input className="input" id="town" name="town" required maxLength={LISTING_LIMITS.town} autoComplete="address-level2" defaultValue={listing?.town ?? ''} {...town.input} />
            </Field>
          </div>

          <Check name="remote" defaultChecked={listing?.remote ?? false} label="I take clients anywhere in Malaysia" hint="You are shown to business owners in other states too." />

          {/* Not Choices: the fieldset itself is described by its hint and its error. */}
          <fieldset className={`field ${s.services}`} aria-describedby={servicesField.input['aria-describedby']}>
            <legend>Services</legend>
            <span className="hint" id="services-hint">
              Tick every one you offer.
            </span>
            <div className={s.options}>
              {services.map((service) => (
                <Check key={service.slug} name="services" value={service.slug} defaultChecked={listing?.services.includes(service.slug) ?? false} label={service.label} />
              ))}
            </div>
            <FieldError field={servicesField} />
          </fieldset>

          <Field label="Who you work with most (optional)" id="niche" hint="For example: clinics, restaurants or online sellers." field={niche}>
            <input className="input" id="niche" name="niche" maxLength={LISTING_LIMITS.niche} defaultValue={listing?.niche ?? ''} {...niche.input} />
          </Field>

          <Field label="About your practice" id="bio" hint={`What you do, who for, and how you work. Up to ${LISTING_LIMITS.bio} characters.`} field={bio}>
            <textarea className="input" id="bio" name="bio" rows={6} required maxLength={LISTING_LIMITS.bio} defaultValue={listing?.bio ?? ''} {...bio.input} />
          </Field>

          <Field label="Qualifications" id="qualifications" hint="As you write them after your name. For example: Chartered Accountant (MIA), ACCA." field={qualifications}>
            <input className="input" id="qualifications" name="qualifications" required maxLength={LISTING_LIMITS.qualifications} defaultValue={listing?.qualifications ?? ''} {...qualifications.input} />
          </Field>

          <Field label="Website (optional)" id="website" field={website}>
            <input className="input" id="website" name="website" inputMode="url" autoComplete="url" maxLength={LISTING_LIMITS.website} placeholder="rahman.com.my" defaultValue={listing?.website ?? ''} {...website.input} />
          </Field>

          <Field label="Email for enquiries" id="contactEmail" hint="Shown in the directory. Business owners write to you here; the club never sees it." field={contactEmail}>
            <input className="input" id="contactEmail" name="contactEmail" type="email" required autoComplete="email" defaultValue={listing?.contactEmail ?? email} {...contactEmail.input} />
          </Field>

          <div className={s.declare}>
            <Check
              name="declared"
              required
              {...declared.input}
              label="I hold the qualifications, registrations and professional indemnity cover that the services I list require."
              hint="The club does not check these, and the directory tells business owners so."
            />
            {/* Inside .field only for the brand's error style: .field also restyles labels, which the check's label must not take. */}
            <div className="field">
              <FieldError field={declared} />
            </div>
          </div>

          <Actions>
            <button className="btn" type="submit">
              {submit}
            </button>
            {warning && <span className={`small ${s.warning}`}>{warning}</span>}
          </Actions>
        </Form>
      </Section>

      {listing && !listing.shown && (
        <Section title="How it reads in the directory" id="preview">
          <p className="small">{listing.review.state === 'listed' ? 'What business owners see once it is back in the directory.' : `What business owners see once ${hostFirstName} approves it. Until then only you and ${hostFirstName} can see it.`}</p>
          <div className={s.entries}>
            <ListingEntry listing={listing} />
          </div>
        </Section>
      )}
    </>
  );
}
