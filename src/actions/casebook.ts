import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import {
  AREAS,
  BANDS,
  CASEBOOK_LIMITS,
  EMPLOYER_KINDS,
  ENGAGEMENT_ROLES,
  FRAMEWORKS,
  INDUSTRIES,
  ROLE_LIMITS,
  SERVICES,
  SHELF_KINDS,
  SHELF_LIMITS,
} from '../data/social.ts';
import { identifying, ROLE_TITLE_SKIP } from '../lib/guard.ts';
import type { CosignRefusal, EntryRefusal, RoleRefusal } from '../server/social-casebook.ts';
import type { SaveRefusal, ShelfRefusal } from '../server/social-shelf.ts';
import { blankable, id, oneLine, settle, signedIn, throttle, type Refusal } from './guards.ts';

const noHandle: Refusal = { code: 'BAD_REQUEST', message: 'Claim your handle first. Your casebook and shelf show on your profile.' };

const entryRefusals: Record<EntryRefusal, Refusal> = {
  'no-handle': noHandle,
  identifying: { code: 'BAD_REQUEST', message: 'That note could point at a client. Take out figures, names, places, listing status, dates and words like only or largest.' },
  year: { code: 'BAD_REQUEST', message: 'Pick a year that has ended.' },
  'cosigner-not-found': { code: 'NOT_FOUND', message: 'Nobody here has that handle. Check it on their profile.' },
  'cosigner-self': { code: 'BAD_REQUEST', message: 'Ask a colleague. You cannot co-sign your own entry.' },
  'cosigner-no-seal': { code: 'FORBIDDEN', message: 'Only a member with the seal can co-sign. Ask a colleague who has it.' },
};
const cosignRefusals: Record<CosignRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That request is gone. Its author may have removed the entry.' },
  already: { code: 'CONFLICT', message: 'You already answered that request.' },
  'no-seal': { code: 'FORBIDDEN', message: 'Co-signing needs the seal. Get ticked, then co-sign.' },
};
const roleRefusals: Record<RoleRefusal, Refusal> = {
  identifying: { code: 'BAD_REQUEST', message: 'That title could name an employer. Say what you did. The kind of employer is picked below.' },
  years: { code: 'BAD_REQUEST', message: 'Check the years. It cannot end before it starts, or be in the future.' },
};
const shelfRefusals: Record<ShelfRefusal, Refusal> = {
  'no-handle': noHandle,
  url: { code: 'BAD_REQUEST', message: 'Use a full https link to where the work is public.' },
  full: { code: 'CONFLICT', message: `A shelf holds ${SHELF_LIMITS.items} items. Take one down first.` },
};
const saveRefusals: Record<SaveRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That item is no longer on the shelf.' },
  self: { code: 'BAD_REQUEST', message: 'It is already on your shelf.' },
};

const year = z.coerce.number('Enter a year.').int('Enter a year.').min(ROLE_LIMITS.earliest, `Enter a year from ${ROLE_LIMITS.earliest}.`);

export const casebook = {
  addEntry: defineAction({
    accept: 'form',
    input: z.object({
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
    }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      await throttle(context, 'casebook');
      return settle(await context.locals.socialCasebook.add(member.id, input), entryRefusals);
    },
  }),

  removeEntry: defineAction({
    accept: 'form',
    input: z.object({ entry: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return { removed: await context.locals.socialCasebook.remove(member.id, input.entry) };
    },
  }),

  decideCosign: defineAction({
    accept: 'form',
    input: z.object({ entry: id, outcome: z.enum(['signed', 'declined']) }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return settle(await context.locals.socialCasebook.decide(member.id, input.entry, input.outcome), cosignRefusals);
    },
  }),

  addRole: defineAction({
    accept: 'form',
    input: z
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
      }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      await throttle(context, 'casebook');
      return settle(await context.locals.socialCasebook.addRole(member.id, input), roleRefusals);
    },
  }),

  removeRole: defineAction({
    accept: 'form',
    input: z.object({ role: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return { removed: await context.locals.socialCasebook.removeRole(member.id, input.role) };
    },
  }),

  addShelfItem: defineAction({
    accept: 'form',
    input: z.object({
      kind: z.enum(SHELF_KINDS, 'Pick what it is.'),
      title: z.string('Give it a title.').transform(oneLine).pipe(z.string().min(1, 'Give it a title.').max(SHELF_LIMITS.title, `Keep it under ${SHELF_LIMITS.title} characters.`)),
      url: z.string('Paste the link.').trim().min(1, 'Paste the link.').max(SHELF_LIMITS.url, `Keep the link under ${SHELF_LIMITS.url} characters.`),
    }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      await throttle(context, 'shelf');
      return settle(await context.locals.socialShelf.add(member.id, input), shelfRefusals);
    },
  }),

  removeShelfItem: defineAction({
    accept: 'form',
    input: z.object({ item: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return { removed: await context.locals.socialShelf.remove(member.id, input.item) };
    },
  }),

  saveItem: defineAction({
    accept: 'form',
    input: z.object({ item: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const { saves } = settle(await context.locals.socialShelf.save(member.id, input.item), saveRefusals);
      return { item: input.item, saves, saved: true };
    },
  }),

  unsaveItem: defineAction({
    accept: 'form',
    input: z.object({ item: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const { saves } = await context.locals.socialShelf.unsave(member.id, input.item);
      return { item: input.item, saves, saved: false };
    },
  }),

  /** Called from the badge page when the member copies a line, so their setup checklist can tick it off. */
  badgeCopied: defineAction({
    handler: async (_input, context) => {
      const member = signedIn(context.locals);
      await context.locals.socialProfiles.badgeCopied(member.id);
      return { copied: true };
    },
  }),
};
