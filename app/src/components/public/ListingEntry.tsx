import { serviceBySlug } from '../../../../src/data/directory.ts';
import type { PublicListing } from '../../../../src/server/listings.ts';
import s from './ListingEntry.module.css';

/** One practice as the directory shows it. The directory, the member's preview and the hosts' check all draw it here, so each sees the same thing. */
export function ListingEntry({ listing }: { listing: PublicListing }) {
  const anchor = `listing-${listing.memberId}`;
  const website = listing.website ? new URL(listing.website) : null;
  const offered = listing.services.flatMap((slug) => serviceBySlug(slug)?.label ?? []);
  return (
    <article className={s.entry} id={anchor} aria-labelledby={`${anchor}-title`}>
      <header className={s.lede}>
        <p className={`${s.place} small`}>
          {listing.town}, {listing.state}
          {listing.remote && <span> · Takes clients anywhere in Malaysia</span>}
        </p>
        <h3 className={`${s.practice} serif`} id={`${anchor}-title`}>
          {listing.practice}
        </h3>
        <p>{listing.name}</p>
      </header>
      <div className={s.about}>
        <p className={s.bio}>{listing.bio}</p>
        <dl className={`${s.meta} small`}>
          <div>
            <dt>Services</dt>
            <dd>
              <ul className={s.services}>
                {offered.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </dd>
          </div>
          {listing.niche && (
            <div>
              <dt>Works mostly with</dt>
              <dd>{listing.niche}</dd>
            </div>
          )}
          <div>
            <dt>Qualifications</dt>
            <dd>{listing.qualifications}</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd className={s.contact}>
              <a href={`mailto:${listing.contactEmail}`}>{listing.contactEmail}</a>
              {website && (
                <a href={website.href} rel="nofollow ugc noopener">
                  {website.hostname.replace(/^www\./, '')}
                </a>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
