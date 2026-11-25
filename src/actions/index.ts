import { account } from './account.ts';
import { adminActions } from './admin.ts';
import { billing } from './billing.ts';
import { calls } from './calls.ts';
import { community } from './community.ts';
import { fees } from './fees.ts';
import { listings } from './listings.ts';
import { newsletter } from './newsletter.ts';
import { plans } from './plans.ts';
import { sessions } from './sessions.ts';

export const server = { ...account, ...adminActions, ...community, ...sessions, ...billing, ...plans, ...calls, ...listings, ...fees, newsletter };
