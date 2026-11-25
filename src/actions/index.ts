import { account } from './account.ts';
import { adminActions } from './admin.ts';
import { billing } from './billing.ts';
import { community } from './community.ts';
import { sessions } from './sessions.ts';

export const server = { ...account, ...adminActions, ...community, ...sessions, ...billing };
