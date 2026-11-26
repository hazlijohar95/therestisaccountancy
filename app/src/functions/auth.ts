import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { site } from '../../../src/data/site.ts';
import type { SignInRefusal } from '../../../src/server/club.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { tooManyTries } from '../lib/action.ts';
import { clientKey } from '../lib/limits.server.ts';
import { currentMember, endSession, startSession } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

const signInRefusals: Record<SignInRefusal, string> = {
  'no-match': 'That email and password do not match.',
  suspended: `Your membership is paused. Write to ${site.inbox} to ask about it.`,
};

const credentials = z.object({ email: z.string().trim().toLowerCase().pipe(z.email('Enter your email.')), password: z.string().min(1, 'Enter your password.') });

/** Who is signed in, for every page. Null when signed out. */
export const me = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  return member && { id: member.id, name: member.name, email: member.email, role: member.role, clubApproved: member.clubApproved };
});

/** Signs in with email and password. Only failed tries count against the address, so an office's people do not lock each other out. */
export const signIn = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof credentials>) => input)
  .handler(async ({ data }): Promise<Outcome<{ role: 'member' | 'admin'; clubApproved: boolean }>> => {
    const input = await parsed(credentials, data);
    if (!input.ok) return input;
    const key = clientKey('sign-in');
    const result = await withStore(async (store) => {
      if (await store.limits.full(key)) return null;
      const attempt = await store.club.authenticate(input.value.email, input.value.password);
      if (!attempt.ok) await store.limits.allow(key);
      return attempt;
    });
    if (!result) return refused(tooManyTries);
    if (!result.ok) return refused(signInRefusals[result.reason]);
    await startSession(result.value.key);
    return done({ role: result.value.member.role, clubApproved: result.value.member.clubApproved });
  });

export const signOut = createServerFn({ method: 'POST' }).handler(async () => {
  await endSession();
  return done(null);
});
