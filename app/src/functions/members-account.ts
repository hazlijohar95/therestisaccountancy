import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { memberNumber } from '../../../src/server/club.ts';
import { MIN_PASSWORD_LENGTH } from '../../../src/server/password.ts';
import { memberOrRefusal, memberOrSignIn } from '../lib/guards.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { startSession } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/** The account page: open to every signed-in member, paid up or not. Admins have no membership to show. */
export const membersAccount = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await memberOrSignIn();
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
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const input = await parsed(passwordInput, data);
    if (!input.ok) return input;
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    const access = await withStore(async (store) => store.club.changePassword(member.value.id, input.value.current, input.value.password));
    if (!access) return refused('Your current password is wrong.');
    await startSession(access.key);
    return done(null);
  });

const prefsInput = z.object({ replies: z.boolean(), digest: z.boolean() });

export const setEmailPrefs = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof prefsInput>) => input)
  .handler(async ({ data }): Promise<Outcome<z.output<typeof prefsInput>>> => {
    const input = await parsed(prefsInput, data);
    if (!input.ok) return input;
    const member = await memberOrRefusal();
    if (!member.ok) return member;
    await withStore(async (store) => {
      await store.mailings.setPrefs(member.value.id, input.value);
    });
    return done(input.value);
  });
