import { account } from './account.ts';
import { adminActions } from './admin.ts';
import { billing } from './billing.ts';
import { calls } from './calls.ts';
import { community } from './community.ts';
import { fees } from './fees.ts';
import { floor } from './floor.ts';
import { listings } from './listings.ts';
import { newsletter } from './newsletter.ts';
import { nominations } from './nominations.ts';
import { plans } from './plans.ts';
import { problems } from './problems.ts';
import { sessions } from './sessions.ts';
import { social } from './social.ts';
import { ticks } from './ticks.ts';

export const server = { ...account, ...adminActions, ...community, ...sessions, ...billing, ...plans, ...calls, ...listings, ...fees, ...social, ...ticks, ...nominations, ...floor, ...problems, newsletter };
