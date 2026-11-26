import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { AREAS, BANDS, CASEBOOK_LIMITS, casebookYears, EMPLOYER_KINDS, ENGAGEMENT_ROLES, FRAMEWORKS, INDUSTRIES, ROLE_LIMITS, SERVICES } from '../../../src/data/social.ts';
import { identifying, ROLE_TITLE_SKIP } from '../../../src/lib/guard.ts';
import { signInPath } from '../../../src/server/paths.ts';
import type { EntryRefusal, RoleRefusal } from '../../../src/server/social-casebook.ts';
import { blankable, id, oneLine } from '../lib/fields.ts';
import { allowed, tooManyTries } from '../lib/limits.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * The casebook and the roles timeline: entries carry bands and years only, and role titles say what someone did, never
 * where. The guard in src/lib/guard.ts warns as people type and refuses the same text here. Co-signing is decided on
 * the notifications page.
 */

const entryRefusals: Record<EntryRefusal, string> = {
  'no-handle': 'Claim your handle first. Your casebook and shelf show on your profile.',
  identifying: 'That note could point at a client. Take out figures, names, places, listing status, dates and words like only or largest.',
  year: 'Pick a year that has ended.',
  'cosigner-not-found': 'Nobody here has that handle. Check it on their profile.',
  'cosigner-self': 'Ask a colleague. You cannot co-sign your own entry.',
  'cosigner-no-seal': 'Only a member with the seal can co-sign. Ask a colleague who has it.',
};
const roleRefusals: Record<RoleRefusal, string> = {
  identifying: 'That title could name an employer. Say what you did. The kind of employer is picked below.',
  years: 'Check the years. It cannot end before it starts, or be in the future.',
};

/** The member's entries and roles, and the years an entry may have ended in. Signed out goes to sign in. */
export const casebookPage = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (!member) throw redirect({ href: signInPath(new URL(getRequest().url), '/casebook/new') });
  return withStore(async (store) => {
    const profile = await store.socialProfiles.ownProfile(member.id);
    return {
      hasProfile: profile !== null,
      entries: profile ? await store.socialCasebook.entries(member.id) : [],
      roles: profile ? await store.socialCasebook.roles(member.id) : [],
      years: casebookYears(new Date()),
    };
  });
});

const entryInput = z.object({
  service: z.enum(SERVICES, 'Pick the type of work.'),
  industry: z.enum(INDUSTRIES, 'Pick the industry.'),
  band: z.enum(BANDS, 'Pick the size band.'),
  framework: z.enum(FRAMEWORKS, 'Pick the framework.'),
  year: z.string('Pick the year it ended.'),
  role: z.enum(ENGAGEMENT_ROLES, 'Pick your role.'),
  areas: z.array(z.enum(AREAS)).default([]),
  note: blankable(
    z
      .string()
      .transform((value) => value.replace(/\s+/g, ' ').trim())
      .pipe(z.string().max(CASEBOOK_LIMITS.note, `Keep it under ${CASEBOOK_LIMITS.note} characters.`))
      .superRefine((value, ctx) => {
        for (const message of identifying(value)) ctx.addIssue({ code: 'custom', message });
      }),
  ),
  cosigner: blankable(z.string().transform((value) => value.trim().replace(/^@/, '') || null)),
});

type EntryForm = Record<'service' | 'industry' | 'band' | 'framework' | 'year' | 'role' | 'note' | 'cosigner', string> & { areas: string[] };

export const addEntry = createServerFn({ method: 'POST' })
  .validator((input: EntryForm) => input)
  .handler(async ({ data }): Promise<Outcome<{ id: number }>> => {
    const member = await currentMember();
    if (!member) return refused('Sign in first.');
    const input = parsed(entryInput, data);
    if (!input.ok) return input;
    if (!(await allowed('casebook'))) return refused(tooManyTries);
    const added = await withStore(async (store) => await store.socialCasebook.add(member.id, input.value));
    return added.ok ? done({ id: added.value.id }) : refused(entryRefusals[added.reason]);
  });

export const removeEntry = createServerFn({ method: 'POST' })
  .validator((input: { entry: number }) => input)
  .handler(async ({ data }): Promise<Outcome<{ removed: boolean }>> => {
    const member = await currentMember();
    if (!member) return refused('Sign in first.');
    const input = parsed(z.object({ entry: id }), data);
    if (!input.ok) return input;
    return done({ removed: await withStore(async (store) => await store.socialCasebook.remove(member.id, input.value.entry)) });
  });

const year = z.coerce.number('Enter a year.').int('Enter a year.').min(ROLE_LIMITS.earliest, `Enter a year from ${ROLE_LIMITS.earliest}.`);

const roleInput = z
  .object({
    from: year,
    /* Blank while they still hold it. */
    to: blankable(z.union([z.literal('').transform(() => null), year])),
    title: z
      .string('Write what you did.')
      .transform(oneLine)
      .pipe(z.string().min(1, 'Write what you did.').max(ROLE_LIMITS.title, `Keep it under ${ROLE_LIMITS.title} characters.`))
      .superRefine((value, ctx) => {
        for (const message of identifying(value, ROLE_TITLE_SKIP)) ctx.addIssue({ code: 'custom', message });
      }),
    employer: z.enum(EMPLOYER_KINDS, 'Pick the kind of employer.'),
  })
  .superRefine((value, ctx) => {
    if (value.to !== null && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'It cannot end before it starts.' });
  });

export const addRole = createServerFn({ method: 'POST' })
  .validator((input: Record<'from' | 'to' | 'title' | 'employer', string>) => input)
  .handler(async ({ data }): Promise<Outcome<{ id: number }>> => {
    const member = await currentMember();
    if (!member) return refused('Sign in first.');
    const input = parsed(roleInput, data);
    if (!input.ok) {
      /* A title can trip more than one guard. The form shows every one, as the page always has. */
      const guards = identifying(oneLine(data.title), ROLE_TITLE_SKIP);
      return guards.length > 1 && input.fields['title'] ? refused(input.message, { ...input.fields, title: guards.join(' ') }) : input;
    }
    if (!(await allowed('casebook'))) return refused(tooManyTries);
    const added = await withStore(async (store) => await store.socialCasebook.addRole(member.id, input.value));
    return added.ok ? done({ id: added.value.id }) : refused(roleRefusals[added.reason]);
  });

export const removeRole = createServerFn({ method: 'POST' })
  .validator((input: { role: number }) => input)
  .handler(async ({ data }): Promise<Outcome<{ removed: boolean }>> => {
    const member = await currentMember();
    if (!member) return refused('Sign in first.');
    const input = parsed(z.object({ role: id }), data);
    if (!input.ok) return input;
    return done({ removed: await withStore(async (store) => await store.socialCasebook.removeRole(member.id, input.value.role)) });
  });
