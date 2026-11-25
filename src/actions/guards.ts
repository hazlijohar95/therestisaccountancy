import { ActionError, type ActionAPIContext, type ActionErrorCode } from 'astro:actions';
import { z } from 'astro/zod';
import { joinSection } from '../data/club.ts';
import type { Member, PasswordLink, SessionKey } from '../server/club.ts';
import { MIN_PASSWORD_LENGTH } from '../server/password.ts';
import type { Result } from '../server/result.ts';

export const signedIn = (locals: App.Locals): Member => {
  if (!locals.member) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in first.' });
  return locals.member;
};

export const admin = (locals: App.Locals): Member => {
  const member = signedIn(locals);
  if (member.role !== 'admin') throw new ActionError({ code: 'FORBIDDEN', message: 'Only a club admin can do that.' });
  return member;
};

export interface Refusal {
  readonly code: ActionErrorCode;
  readonly message: string;
}

/** The value of a result, or the refusal as the action's error. The table must name every reason, so none goes unexplained. */
export const settle = <T, R extends string>(result: Result<T, R>, refusals: Record<R, Refusal>): T => {
  if (result.ok) return result.value;
  throw new ActionError(refusals[result.reason]);
};

export const email = z.string().trim().toLowerCase().pipe(z.email(joinSection.messages.email));
export const memberName = z.string().trim().min(1, 'Enter a name.').max(60, 'Keep the name under 60 characters.');
export const id = z.coerce.number().int().positive();
export const newPassword = {
  password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`).max(200),
  confirm: z.string(),
};
export const passwordsMatch = (v: { password: string; confirm: string }) => v.password === v.confirm;
export const mismatch = { message: 'The two passwords are different.', path: ['confirm'] };

/** A new session id for every sign-in, tied to the epoch it was opened in. */
export const startSession = async (context: ActionAPIContext, key: SessionKey) => {
  await context.session?.regenerate();
  context.session?.set('signedIn', key);
};

/** Built on the configured site address when there is one, so links never depend on the request's Host. */
export const shareable = ({ member, purpose, token, expiresAt }: PasswordLink, context: ActionAPIContext) => ({
  name: member.name,
  purpose,
  link: new URL(`/welcome?token=${encodeURIComponent(token)}`, context.site ?? context.url).href,
  expiresAt,
});
