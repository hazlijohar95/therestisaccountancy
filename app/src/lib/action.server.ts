import type { Store } from '../../../src/server/instance.ts';
import { createAction } from './action.ts';
import { clientKey } from './limits.server.ts';
import { sendLater } from './mail.server.ts';
import { currentMember } from './session.server.ts';
import { withStore } from './store.server.ts';

/** A form's server function, run against the request, the club's store and the mail. */
export const action = createAction<Store>({
  member: currentMember,
  open: withStore,
  allow: (store, form) => store.limits.allow(clientKey(form)),
  send: sendLater,
});
