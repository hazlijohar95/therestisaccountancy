import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { BODY_IDS, bodyById, CLAIM_LIMITS, LICENCES, PLATFORMS, accountHandle, statusTrack } from '../data/social.ts';
import { deleteEvidence, storeEvidence, type EvidenceRefusal } from '../server/evidence.ts';
import { socialUrl } from '../server/paths.ts';
import { report } from '../server/report.ts';
import {
  evidenceType,
  monthOf,
  type AccountRefusal,
  type ClaimDraft,
  type ClaimRefusal,
  type ConfirmRefusal,
  type DecisionRefusal,
  type VouchRefusal,
  type WorkEmailRefusal,
} from '../server/social-claims.ts';
import { accountDecidedLetter, claimDecidedLetter, workEmailLetter } from '../server/social-letters.ts';
import type { Profile } from '../server/social-profiles.ts';
import { admin, email, id, oneLine, sendLater, settle, signedIn, throttle, type Refusal } from './guards.ts';

const accountRefusals: Record<AccountRefusal, Refusal> = {
  'handle-invalid': { code: 'BAD_REQUEST', message: 'That does not look like a handle on that platform. Type the handle, or paste the profile’s address.' },
  'platform-taken': { code: 'CONFLICT', message: 'You already have an account on that platform here. Remove it first to add another.' },
  'proven-elsewhere': { code: 'CONFLICT', message: 'Someone has already proven that account. If it is yours, write to the team.' },
};

const claimRefusals: Record<ClaimRefusal, Refusal> = {
  duplicate: { code: 'CONFLICT', message: 'That claim is already waiting for the team.' },
  'too-many': { code: 'CONFLICT', message: 'You have 20 claims waiting. Wait for the team to check some first.' },
};

const evidenceRefusals: Record<EvidenceRefusal, Refusal> = {
  'evidence-type': { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Upload a PDF, or a photo as JPEG, PNG or WebP.' },
  'evidence-size': { code: 'CONTENT_TOO_LARGE', message: 'Upload a file under 5 MB.' },
};

const workEmailRefusals: Record<WorkEmailRefusal, Refusal> = {
  'address-invalid': { code: 'BAD_REQUEST', message: 'Enter your work email, like you@yourfirm.com.' },
  'personal-domain': { code: 'BAD_REQUEST', message: 'That is a personal address. Use the one your employer gave you.' },
  'already-ticked': { code: 'CONFLICT', message: 'That workplace is already ticked on your profile.' },
  'too-soon': { code: 'TOO_MANY_REQUESTS', message: 'We sent a link there a few minutes ago. Check that inbox, or wait ten minutes to send another.' },
  'too-many': claimRefusals['too-many'],
};

const confirmRefusals: Record<ConfirmRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'This link has been used or has run out. Send a new one from Get ticked.' },
  'not-yours': { code: 'FORBIDDEN', message: 'This link is for another account. Sign in as the person who asked for it.' },
};

const vouchRefusals: Record<VouchRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That claim is no longer here.' },
  self: { code: 'BAD_REQUEST', message: 'You cannot vouch for yourself.' },
  'no-seal': { code: 'FORBIDDEN', message: 'Only members with the seal can vouch.' },
  already: { code: 'CONFLICT', message: 'You have already vouched for this.' },
};

const decisionRefusals: Record<DecisionRefusal, Refusal> = {
  'not-found': { code: 'NOT_FOUND', message: 'That is no longer in the queue. The member may have removed it.' },
  already: { code: 'CONFLICT', message: 'Someone on the team already decided that. Nothing was sent.' },
  'proven-elsewhere': { code: 'CONFLICT', message: 'Another member has already proven that account. Reject this one.' },
};

/** The signed-in member's profile. Ticks belong to a profile, so a member without a handle claims one first. */
const withProfile = (locals: App.Locals): Profile => {
  signedIn(locals);
  if (!locals.profile) throw new ActionError({ code: 'BAD_REQUEST', message: 'Claim your handle first.' });
  return locals.profile;
};

const line = (max: number, empty: string) =>
  z
    .string(empty)
    .transform(oneLine)
    .pipe(z.string().min(1, empty).max(max, `Keep it under ${max} characters.`));

/** Why an uploaded file cannot be evidence, read from its first bytes. Null when it can. */
const fileProblem = async (file: File | undefined): Promise<string | null> => {
  if (!file || file.size === 0) return 'Choose the file to upload.';
  if (file.size > CLAIM_LIMITS.evidenceBytes) return evidenceRefusals['evidence-size'].message;
  const type = evidenceType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  return type ? null : evidenceRefusals['evidence-type'].message;
};

/** A month from an <input type="month">: this month at the earliest, ten years ahead at the latest. */
const month = z
  .string('Pick the month it runs to.')
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick the month it runs to.')
  .refine((value) => value >= monthOf(new Date()) && value <= monthOf(new Date(), 120), 'Pick a month from this one on. An expired licence cannot be ticked.');

const https = z
  .string('Paste the https address of the page.')
  .trim()
  .max(CLAIM_LIMITS.url, `Keep the address under ${CLAIM_LIMITS.url} characters.`)
  .pipe(z.url({ protocol: /^https$/, hostname: /^([a-z\d-]+\.)+[a-z]{2,}$/i, message: 'Paste the https address of the page, like https://orcid.org/0000-0002-1825-0097.' }));

/** Stores the upload, then the claim. A refused claim leaves no file behind. */
const addWithEvidence = async (context: ActionAPIContext, memberId: number, file: File, draft: (key: string) => ClaimDraft) => {
  const key = settle(await storeEvidence(memberId, file), evidenceRefusals);
  const added = await context.locals.socialClaims.addClaim(memberId, draft(key));
  if (!added.ok) await deleteEvidence(key);
  return settle(added, claimRefusals);
};

/** Deletes a decided or removed claim's document, now if R2 answers, or in the next hourly run if not. */
const dropEvidence = async (context: ActionAPIContext, claimId: number, key: string | null) => {
  if (!key) return;
  try {
    await deleteEvidence(key);
    await context.locals.socialClaims.evidenceDeleted(claimId);
  } catch (error) {
    await report('evidence', `The document for claim ${claimId} was not deleted; the hourly job tries again`, error);
  }
};

const site = (context: ActionAPIContext) => (context.site ?? context.url).href;

export const ticks = {
  addAccount: defineAction({
    accept: 'form',
    input: z.object({
      platform: z.enum(PLATFORMS, 'Pick the platform.'),
      handle: z.string('Enter your handle on that platform.').transform(accountHandle).pipe(z.string().min(1, 'Enter your handle on that platform.').max(100, 'That handle is too long.')),
    }),
    handler: async (input, context) => {
      const profile = withProfile(context.locals);
      await throttle(context, 'ticks');
      const account = settle(await context.locals.socialClaims.addAccount(profile.memberId, input.platform, input.handle), accountRefusals);
      return { account: account.id };
    },
  }),

  removeAccount: defineAction({
    accept: 'form',
    input: z.object({ account: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      return { removed: await context.locals.socialClaims.removeAccount(member.id, input.account) };
    },
  }),

  addBody: defineAction({
    accept: 'form',
    input: z
      .object({
        body: z.enum(BODY_IDS, 'Pick your body.'),
        status: z.string('Pick your exact status.').min(1, 'Pick your exact status.'),
        reference: line(CLAIM_LIMITS.reference, 'Enter your member or student number.'),
        otherName: z.string().transform(oneLine).pipe(z.string().max(CLAIM_LIMITS.otherBody, `Keep it under ${CLAIM_LIMITS.otherBody} characters.`)).optional(),
        evidence: z.instanceof(File).optional(),
      })
      .superRefine(async (value, ctx) => {
        if (statusTrack(value.body, value.status) === null) ctx.addIssue({ code: 'custom', path: ['status'], message: 'Pick your exact status.' });
        if (value.body !== 'other') return;
        if (!value.otherName) ctx.addIssue({ code: 'custom', path: ['otherName'], message: 'Enter the name of the body.' });
        const problem = await fileProblem(value.evidence);
        if (problem) ctx.addIssue({ code: 'custom', path: ['evidence'], message: problem });
      }),
    handler: async (input, context) => {
      const profile = withProfile(context.locals);
      await throttle(context, 'ticks');
      const body = bodyById(input.body);
      if (!body) throw new ActionError({ code: 'BAD_REQUEST', message: 'Pick your body.' });
      const { socialClaims } = context.locals;
      const draft = { kind: 'body', bodyId: body.id, status: input.status, reference: input.reference } as const;
      const claim =
        body.id === 'other' && input.evidence && input.otherName
          ? await addWithEvidence(context, profile.memberId, input.evidence, (key) => ({ ...draft, otherName: input.otherName ?? null, evidenceKey: key }))
          : settle(await socialClaims.addClaim(profile.memberId, { ...draft, otherName: null, evidenceKey: null }), claimRefusals);
      return { claim: claim.id, label: claim.label };
    },
  }),

  addLicence: defineAction({
    accept: 'form',
    input: z
      .object({
        licence: z.enum(LICENCES, 'Pick the licence you hold.'),
        reference: line(CLAIM_LIMITS.reference, 'Enter the licence or certificate number.'),
        until: month,
        evidence: z.instanceof(File).optional(),
      })
      .superRefine(async (value, ctx) => {
        const problem = await fileProblem(value.evidence);
        if (problem) ctx.addIssue({ code: 'custom', path: ['evidence'], message: problem });
      }),
    handler: async (input, context) => {
      const profile = withProfile(context.locals);
      await throttle(context, 'ticks');
      const { evidence } = input;
      if (!evidence) throw new ActionError({ code: 'BAD_REQUEST', message: 'Choose the file to upload.' });
      const claim = await addWithEvidence(context, profile.memberId, evidence, (key) => ({
        kind: 'licence',
        licence: input.licence,
        reference: input.reference,
        until: input.until,
        evidenceKey: key,
      }));
      return { claim: claim.id, label: claim.label };
    },
  }),

  addAcademic: defineAction({
    accept: 'form',
    input: z.object({ role: line(CLAIM_LIMITS.label, 'Enter your post, like Senior lecturer, Universiti Malaya.'), url: https }),
    handler: async (input, context) => {
      const profile = withProfile(context.locals);
      await throttle(context, 'ticks');
      const claim = settle(await context.locals.socialClaims.addClaim(profile.memberId, { kind: 'academic', role: input.role, url: input.url }), claimRefusals);
      return { claim: claim.id, label: claim.label };
    },
  }),

  addExperience: defineAction({
    accept: 'form',
    input: z.object({ text: line(CLAIM_LIMITS.label, 'Say what experience you have, like Six years in audit.') }),
    handler: async (input, context) => {
      const profile = withProfile(context.locals);
      await throttle(context, 'ticks');
      const claim = settle(await context.locals.socialClaims.addClaim(profile.memberId, { kind: 'experience', text: input.text }), claimRefusals);
      return { claim: claim.id, label: claim.label };
    },
  }),

  removeClaim: defineAction({
    accept: 'form',
    input: z.object({ claim: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const { removed, evidenceKey } = await context.locals.socialClaims.removeClaim(member.id, input.claim);
      if (evidenceKey) await deleteEvidence(evidenceKey).catch((error: unknown) => report('evidence', `The document of removed claim ${input.claim} was not deleted`, error));
      return { removed };
    },
  }),

  sendWorkEmail: defineAction({
    accept: 'form',
    input: z.object({ email }),
    handler: async (input, context) => {
      const profile = withProfile(context.locals);
      await throttle(context, 'work-email');
      const check = settle(await context.locals.socialClaims.startWorkEmail(profile.memberId, input.email), workEmailRefusals);
      const link = socialUrl(site(context), `/verify/email?token=${encodeURIComponent(check.token)}`);
      const domain = check.claim.label.replace(/^Works at /, '');
      sendLater(context, [workEmailLetter({ address: check.address, name: profile.name, handle: profile.handle, domain, link, expiresAt: check.expiresAt })]);
      return { address: check.address };
    },
  }),

  confirmWorkEmail: defineAction({
    accept: 'form',
    input: z.object({ token: z.string().min(1) }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const claim = settle(await context.locals.socialClaims.confirmWorkEmail(member.id, input.token), confirmRefusals);
      return { label: claim.label };
    },
  }),

  vouch: defineAction({
    accept: 'form',
    input: z.object({ claim: id }),
    handler: async (input, context) => {
      const member = signedIn(context.locals);
      const claim = settle(await context.locals.socialClaims.vouch(member.id, input.claim), vouchRefusals);
      return { vouches: claim.vouches, ticked: claim.review.state === 'ticked' };
    },
  }),

  approveAccount: defineAction({
    accept: 'form',
    input: z.object({ account: id }),
    handler: async (input, context) => {
      const reviewer = admin(context.locals);
      const { item, member } = settle(await context.locals.socialClaims.decideAccount(input.account, reviewer.id, { verdict: 'approve' }), decisionRefusals);
      sendLater(context, [accountDecidedLetter(member, item, reviewer, socialUrl(site(context), '/verify'))]);
      return { decided: 'approved' };
    },
  }),

  rejectAccount: defineAction({
    accept: 'form',
    input: z.object({ account: id, reason: line(CLAIM_LIMITS.reason, 'Say why, in a line. The member gets it by email.') }),
    handler: async (input, context) => {
      const reviewer = admin(context.locals);
      const { item, member } = settle(
        await context.locals.socialClaims.decideAccount(input.account, reviewer.id, { verdict: 'reject', reason: input.reason }),
        decisionRefusals,
      );
      sendLater(context, [accountDecidedLetter(member, item, reviewer, socialUrl(site(context), '/verify'))]);
      return { decided: 'rejected' };
    },
  }),

  approveClaim: defineAction({
    accept: 'form',
    input: z.object({ claim: id }),
    handler: async (input, context) => {
      const reviewer = admin(context.locals);
      const { socialClaims } = context.locals;
      const key = await socialClaims.evidenceKey(input.claim);
      const { item, member } = settle(await socialClaims.decideClaim(input.claim, reviewer.id, { verdict: 'approve' }), decisionRefusals);
      await dropEvidence(context, item.id, key);
      const urls = { profile: socialUrl(site(context), member.handle ? `/@${member.handle}` : '/me'), verify: socialUrl(site(context), '/verify') };
      sendLater(context, [claimDecidedLetter(member, item, reviewer, urls)]);
      return { decided: 'approved' };
    },
  }),

  rejectClaim: defineAction({
    accept: 'form',
    input: z.object({ claim: id, reason: line(CLAIM_LIMITS.reason, 'Say why, in a line. The member gets it by email.') }),
    handler: async (input, context) => {
      const reviewer = admin(context.locals);
      const { socialClaims } = context.locals;
      const key = await socialClaims.evidenceKey(input.claim);
      const { item, member } = settle(await socialClaims.decideClaim(input.claim, reviewer.id, { verdict: 'reject', reason: input.reason }), decisionRefusals);
      await dropEvidence(context, item.id, key);
      const urls = { profile: socialUrl(site(context), member.handle ? `/@${member.handle}` : '/me'), verify: socialUrl(site(context), '/verify') };
      sendLater(context, [claimDecidedLetter(member, item, reviewer, urls)]);
      return { decided: 'rejected' };
    },
  }),
};
