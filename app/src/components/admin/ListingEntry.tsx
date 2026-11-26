import { serviceBySlug } from '../../../../src/data/directory.ts';
import type { PublicListing } from '../../../../src/server/listings.ts';
import s from './ListingEntry.module.css';

/** One practice as the directory shows it, so the hosts check exactly what the public would see. */
export function ListingEntry({ listing }: { listing: PublicListing }) {
  const anchor = `listing-${listing.memberId}`;
  const website = listing.website ? new URL(listing.website) : null;
  const offered = listing.services.flatMap((slug) => serviceBySlug(slug)?.label ?? []);
  return (
    <article className={s.entry} id={anchor} aria-labelledby={`${anchor}-title`}>
      <header className={s.lede}>
        <p className={`small ${s.place}`}>
          {listing.town}, {listing.state}
          {listing.remote && <span> · Takes clients anywhere in Malaysia</span>}
        </p>
        <h3 className={`serif ${s.practice}`} id={`${anchor}-title`}>
          {listing.practice}
        </h3>
        <p>{listing.name}</p>
      </header>
      <div className={s.about}>
        <p className={s.bio}>{listing.bio}</p>
        <dl className={`small ${s.meta}`}>
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
