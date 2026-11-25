import { account } from './account.ts';
import { adminActions } from './admin.ts';
import { community } from './community.ts';

export const server = { ...account, ...adminActions, ...community };
