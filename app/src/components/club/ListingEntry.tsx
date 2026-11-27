import { serviceBySlug } from '../../../../src/data/directory.ts';
import type { PublicListing } from '../../../../src/server/listings.ts';
import { Badge } from '../ui/Badge.tsx';
import { Meta } from '../ui/List.tsx';
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
        </p>
        <h3 className={`${s.practice} serif`} id={`${anchor}-title`}>
          {listing.practice}
        </h3>
        <p>{listing.name}</p>
        {listing.remote && (
          <span>
            <Badge tone="solid">Clients anywhere in Malaysia</Badge>
          </span>
        )}
      </header>
      <div className={s.about}>
        <p className={s.bio}>{listing.bio}</p>
        <ul className={s.services} aria-label="Services">
          {offered.map((label) => (
            <li key={label}>
              <Badge>{label}</Badge>
            </li>
          ))}
        </ul>
        <dl className={`${s.meta} small`}>
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
        </dl>
        <p className={`${s.contact} small`}>
          <Meta icon="mail">
            <a href={`mailto:${listing.contactEmail}`}>{listing.contactEmail}</a>
          </Meta>
          {website && (
            <Meta icon="arrow">
              <a href={website.href} rel="nofollow ugc noopener">
                {website.hostname.replace(/^www\./, '')}
              </a>
            </Meta>
          )}
        </p>
      </div>
    </article>
  );
}
