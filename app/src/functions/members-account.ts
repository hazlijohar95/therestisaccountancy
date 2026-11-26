import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { memberNumber } from '../../../src/server/club.ts';
import { MIN_PASSWORD_LENGTH } from '../../../src/server/password.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { startSession } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/** The account page: open to every signed-in member, paid up or not. Admins have no membership to show. */
export const membersAccount = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await admit('member', toClub);
  const { standing, prefs } = await withStore(async (store) => ({
    prefs: await store.mailings.prefs(member.id),
    standing: member.role === 'admin' ? null : await store.billing.standing(member.id),
  }));
  return { member: { name: member.name, email: member.email, number: memberNumber(member), joinedAt: member.joinedAt }, standing, prefs, minPassword: MIN_PASSWORD_LENGTH };
});

const passwordInput = z
  .object({
    current: z.string(),
    password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`).max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Enter the same password in both fields.', path: ['confirm'] });

/** Changes the password, which ends every other session. This browser gets a new one. */
export const changePassword = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof passwordInput>) => input)
  .handler(
    action({ access: 'member', input: passwordInput }, async ({ actor, input, store }) => {
      const access = await store.club.changePassword(actor.id, input.current, input.password);
      if (!access) return refused('Your current password is wrong.');
      await startSession(access.key);
      return done(null);
    }),
  );

const prefsInput = z.object({ replies: z.boolean(), digest: z.boolean() });

export const setEmailPrefs = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof prefsInput>) => input)
  .handler(
    action({ access: 'member', input: prefsInput }, async ({ actor, input, store }) => {
      await store.mailings.setPrefs(actor.id, input);
      return done(input);
    }),
  );
