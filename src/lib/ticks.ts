import { VOUCHES_TO_TICK } from '../data/social.ts';
import { daysLeft, monthOf, type Claim, type LedgerClaim } from '../server/social-claims.ts';
import { formatMonth } from './format.ts';

type Shown = Pick<Claim | LedgerClaim, 'kind' | 'review' | 'until' | 'vouches'>;

/** Ticks this close to lapsing say so beside them. */
export const RENEWAL_WINDOW_DAYS = 60;

/** The date column of a ledger row: when it was ticked and how long it runs, or where it stands. */
export function claimWhen(claim: Shown): string {
  const { review } = claim;
  switch (review.state) {
    case 'ticked':
      return `${formatMonth(monthOf(new Date(review.at)))}${claim.until ? ` → ${formatMonth(claim.until)}` : ''}`;
    case 'lapsed':
      return `Lapsed ${claim.until ? formatMonth(claim.until) : ''}`.trim();
    case 'rejected':
      return `Not ticked: ${review.reason}`;
    case 'pending':
      if (claim.kind === 'experience') return `Not checked · ${claim.vouches} of ${VOUCHES_TO_TICK} vouches`;
      if (claim.kind === 'employer') return 'Waiting for you to open the link';
      return 'Waiting for the team';
  }
}

/** Days until a ticked claim lapses, when that is soon enough to mention. Null otherwise. */
export function renewsIn(claim: Shown, now: Date): number | null {
  if (claim.review.state !== 'ticked' || !claim.until) return null;
  const left = daysLeft(claim.until, now);
  return left > 0 && left <= RENEWAL_WINDOW_DAYS ? left : null;
}

/** How a claim's tick draws: self-declared experience has its own dashed tick until peers vouch for it. */
export const tickState = (claim: Pick<Claim | LedgerClaim, 'source' | 'review'>) => (claim.source === 'self' && claim.review.state === 'pending' ? 'self' : claim.review.state);
