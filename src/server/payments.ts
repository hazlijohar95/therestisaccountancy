import { env } from 'cloudflare:workers';
import type { Term } from '../data/membership.ts';
import type { Renewal } from './billing.ts';
import type { Member } from './club.ts';
import * as charges from './charges.ts';
import { chip, type Chip } from './chip.ts';
import type { Store } from './instance.ts';

/** CHIP with the club's keys. Test keys take test cards; live keys take real money. */
export const club = (): Chip => chip({ secretKey: env.CHIP_SECRET_KEY, brandId: env.CHIP_BRAND_ID });

/** CHIP's signing key, fetched once per Worker instance. */
let signingKey: Promise<string> | null = null;
export const chipSigningKey = () => (signingKey ??= club().publicKey().catch((error: unknown) => {
  signingKey = null;
  throw error;
}));

/** Opens CHIP's payment page for a term. Returns where to send the member, or why it did not open one. */
export const checkout = (billing: Store['billing'], member: Pick<Member, 'id' | 'email' | 'name' | 'clubApproved'>, term: Term, siteUrl: string) => charges.checkout(club(), billing, member, term, siteUrl);

/** Asks CHIP for a purchase's state and records it if paid. */
export const settle = (billing: Store['billing'], purchaseId: string) => charges.settle(club(), billing, purchaseId);

/** Charges the subscription's term to a member's saved card. */
export const renew = (billing: Store['billing'], renewal: Renewal, siteUrl: string) => charges.renew(club(), billing, renewal, siteUrl);
