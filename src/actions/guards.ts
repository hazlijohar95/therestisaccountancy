import { ActionError, type ActionAPIContext, type ActionErrorCode } from 'astro:actions';
import { z } from 'astro/zod';
import { joinSection } from '../data/club.ts';
import type { Member, PasswordLink, SessionKey } from '../server/club.ts';
import { passwordLetter, type Letter } from '../server/letters.ts';
import { sourceOf } from '../server/limits.ts';
import { send } from '../server/mail.ts';
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

/** A public form takes a few posts a minute from one source. */
export const throttle = async (context: ActionAPIContext, form: 'join' | 'sign-in' | 'link') => {
  const source = sourceOf(context.request.headers.get('cf-connecting-ip') ?? 'unknown');
  if (!(await context.locals.limits.allow(`${form} ${source}`))) throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'Too many tries from here. Wait a minute and try again.' });
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
/** A person's name on one line: runs of whitespace, line breaks included, become one space. It goes into email subjects. */
export const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
export const memberName = z.string().transform(oneLine).pipe(z.string().min(1, 'Enter a name.').max(60, 'Keep the name under 60 characters.'));
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
  email: member.email,
  purpose,
  link: new URL(`/welcome?token=${encodeURIComponent(token)}`, context.site ?? context.url).href,
  expiresAt,
});

/** Emails a link an admin issued. The admin sees whether it went, and the link either way, to send by hand if not. */
export const deliver = async (link: PasswordLink, context: ActionAPIContext) => {
  const shared = shareable(link, context);
  return { ...shared, emailed: await send(passwordLetter(shared)) };
};

/** A full address on the configured site, for links that leave in an email. */
export const absolute = (context: ActionAPIContext, path: string) => new URL(path, context.site ?? context.url).href;

/** Sends after the response, so the person does not wait on the mail. Gather what the letters need before calling. */
export const sendLater = (context: ActionAPIContext, letters: readonly Letter[]) => {
  if (letters.length) context.locals.cfContext.waitUntil(Promise.all(letters.map(send)));
};
