import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { joinSection } from '../../../src/data/club.ts';
import { everyRate } from '../../../src/data/membership.ts';
import { firstName } from '../../../src/lib/format.ts';
import { LINK_FOR, type LinkPurpose, type PasswordLink } from '../../../src/server/club.ts';
import { passwordLetter } from '../../../src/server/letters.ts';
import { MIN_PASSWORD_LENGTH } from '../../../src/server/password.ts';
import { allowed, tooManyTries } from '../lib/limits.server.ts';
import { absolute, sendLater } from '../lib/mail.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { startSession } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';
import { JOIN_RESULT, takeResult } from './public-forms.server.ts';

const email = z.string().trim().toLowerCase().pipe(z.email(joinSection.messages.email));

const newPassword = z
  .object({
    token: z.string().min(1),
    password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`).max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Enter the same password in both fields.', path: ['confirm'] });

/** What a password link's email says, built on the configured site so the link never depends on the request's Host. */
const shareable = ({ member, purpose, token, expiresAt }: PasswordLink) => ({
  name: member.name,
  email: member.email,
  purpose,
  link: absolute(`/welcome?token=${encodeURIComponent(token)}`),
  expiresAt,
  /** What they can pay, told with the invitation. Admins do not pay, and the social site is free until the club accepts them. */
  rate: member.role === 'admin' || !member.clubApproved ? null : everyRate,
  welcomeTo: member.clubApproved ? ('club' as const) : ('social' as const),
});

export interface LinkHolder {
  readonly firstName: string;
  readonly email: string;
  readonly purpose: LinkPurpose;
}

/** Who a password link is for, or null when it is unknown, spent, expired or held by a suspended member. */
export const passwordLink = createServerFn({ method: 'GET' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }): Promise<{ holder: LinkHolder | null; minLength: number }> => {
    const member = data.token ? await withStore(async (store) => store.club.linkMember(data.token)) : null;
    const purpose = member ? LINK_FOR[member.status] : null;
    const holder = member && purpose ? { firstName: firstName(member.name), email: member.email, purpose } : null;
    return { holder, minLength: MIN_PASSWORD_LENGTH };
  });

/** Sets the password from an emailed link, spends the link and signs the member in. */
export const setPassword = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof newPassword>) => input)
  .handler(async ({ data }): Promise<Outcome<{ purpose: LinkPurpose; clubApproved: boolean }>> => {
    const input = parsed(newPassword, data);
    if (!input.ok) return input;
    const result = await withStore(async (store) => store.club.setPasswordFromLink(input.value.token, input.value.password));
    if (!result) return refused('This link has been used or has expired. Get a new one from the sign-in page.');
    await startSession(result.key);
    return done({ purpose: result.purpose, clubApproved: result.member.clubApproved });
  });

const linkRequest = z.object({ email });

/** Emails a password link to a member who asks. Answers the same whether or not the email belongs to anyone. */
export const requestLink = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof linkRequest>) => input)
  .handler(async ({ data }): Promise<Outcome<{ email: string }>> => {
    const input = parsed(linkRequest, data);
    if (!input.ok) return input;
    if (!(await allowed('link'))) return refused(tooManyTries);
    const link = await withStore(async (store) => store.club.requestLink(input.value.email));
    if (link) sendLater([passwordLetter(shareable(link))]);
    return done({ email: input.value.email });
  });

/** What the membership request form's plain post did, for /join/request. Read once. */
export const joinResult = createServerFn({ method: 'GET' }).handler(async () => takeResult(JOIN_RESULT));
