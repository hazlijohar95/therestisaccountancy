import { notFound, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { accountHandle, BODY_IDS, bodyById, CLAIM_LIMITS, LICENCES, PLATFORMS, statusTrack, type Platform } from '../../../src/data/social.ts';
import { claimWhen, renewsIn } from '../../../src/lib/ticks.ts';
import { deleteEvidence, storeEvidence, type EvidenceRefusal } from '../../../src/server/evidence.ts';
import { signInPath, socialPath } from '../../../src/server/paths.ts';
import { report } from '../../../src/server/report.ts';
import {
  evidenceType,
  monthOf,
  type AccountRefusal,
  type ClaimDraft,
  type ClaimRefusal,
  type ConfirmRefusal,
  type VouchRefusal,
  type WorkEmailRefusal,
} from '../../../src/server/social-claims.ts';
import { workEmailLetter } from '../../../src/server/social-letters.ts';
import type { Profile } from '../../../src/server/social-profiles.ts';
import { allowed, tooManyTries } from '../lib/limits.server.ts';
import { sendLater } from '../lib/mail.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { email, formFields, id, line, oneLine, socialAbsolute } from '../lib/social-input.server.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * Get ticked: proving accounts, sending claims to the team, the work-email link, and vouching. The team's decisions
 * are in social-review.ts.
 */

const accountRefusals: Record<AccountRefusal, string> = {
  'handle-invalid': 'That does not look like a handle on that platform. Type the handle, or paste the profile’s address.',
  'platform-taken': 'You already have an account on that platform here. Remove it first to add another.',
  'proven-elsewhere': 'Someone has already proven that account. If it is yours, write to the team.',
};

const claimRefusals: Record<ClaimRefusal, string> = {
  duplicate: 'That claim is already waiting for the team.',
  'too-many': 'You have 20 claims waiting. Wait for the team to check some first.',
};

const evidenceRefusals: Record<EvidenceRefusal, string> = {
  'evidence-type': 'Upload a PDF, or a photo as JPEG, PNG or WebP.',
  'evidence-size': 'Upload a file under 5 MB.',
};

const workEmailRefusals: Record<WorkEmailRefusal, string> = {
  'address-invalid': 'Enter your work email, like you@yourfirm.com.',
  'personal-domain': 'That is a personal address. Use the one your employer gave you.',
  'already-ticked': 'That workplace is already ticked on your profile.',
  'too-soon': 'We sent a link there a few minutes ago. Check that inbox, or wait ten minutes to send another.',
  'too-many': claimRefusals['too-many'],
};

const confirmRefusals: Record<ConfirmRefusal, string> = {
  'not-found': 'This link has been used or has run out. Send a new one from Get ticked.',
  'not-yours': 'This link is for another account. Sign in as the person who asked for it.',
};

const vouchRefusals: Record<VouchRefusal, string> = {
  'not-found': 'That claim is no longer here.',
  self: 'You cannot vouch for yourself.',
  'no-seal': 'Only members with the seal can vouch.',
  already: 'You have already vouched for this.',
};

const here = () => new URL(getRequest().url);

/** The signed-in member's profile. Ticks belong to a profile, so a member without a handle claims one first. */
async function profileOrRefusal(): Promise<Outcome<Profile>> {
  const member = await currentMember();
  if (!member) return refused('Sign in first.');
  const profile = await withStore(async (store) => await store.socialProfiles.ownProfile(member.id));
  return profile ? done(profile) : refused('Claim your handle first.');
}

/** Why an uploaded file cannot be evidence, read from its first bytes. Null when it can. */
async function fileProblem(file: File | undefined): Promise<string | null> {
  if (!file || file.size === 0) return 'Choose the file to upload.';
  if (file.size > CLAIM_LIMITS.evidenceBytes) return evidenceRefusals['evidence-size'];
  const type = evidenceType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  return type ? null : evidenceRefusals['evidence-type'];
}

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

/* A file input left empty can arrive as an empty string rather than an empty file. Either way nothing was chosen. */
const evidence = z.preprocess((value) => (value instanceof File ? value : undefined), z.instanceof(File).optional());

/** Stores the upload, then the claim. A refused claim leaves no file behind. */
async function addWithEvidence(memberId: number, file: File, draft: (key: string) => ClaimDraft): Promise<Outcome<{ claim: number }>> {
  const stored = await storeEvidence(memberId, file);
  if (!stored.ok) return refused(evidenceRefusals[stored.reason]);
  const added = await withStore(async (store) => await store.socialClaims.addClaim(memberId, draft(stored.value)));
  if (added.ok) return done({ claim: added.value.id });
  await deleteEvidence(stored.value);
  return refused(claimRefusals[added.reason]);
}

/** Adds a claim with no document, or the refusal. */
async function addPlain(memberId: number, draft: ClaimDraft): Promise<Outcome<{ claim: number }>> {
  const added = await withStore(async (store) => await store.socialClaims.addClaim(memberId, draft));
  return added.ok ? done({ claim: added.value.id }) : refused(claimRefusals[added.reason]);
}

/** Get ticked: the member's accounts and claims, each with what its row says. Signed out goes to sign in; no handle, to claim one. */
export const verifyPage = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (!member) throw redirect({ href: signInPath(here(), '/verify') });
  const now = new Date();
  return withStore(async (store) => {
    const profile = await store.socialProfiles.ownProfile(member.id);
    if (!profile) throw redirect({ href: socialPath(here(), '/edit') });
    const { accounts, claims } = await store.socialClaims.mine(member.id);
    return {
      name: member.name,
      profile: { name: profile.name, handle: profile.handle, track: profile.track, headline: profile.headline },
      accounts: accounts.map((a) => ({ id: a.id, platform: a.platform, handle: a.handle, code: a.code, state: a.review.state, reason: a.review.state === 'rejected' ? a.review.reason : null })),
      claims: claims.map((c) => ({
        id: c.id,
        kind: c.kind,
        bodyId: c.bodyId,
        label: c.label,
        source: c.source,
        state: c.review.state,
        /* Self-declared experience draws its own dashed tick until peers vouch for it. */
        tick: c.source === 'self' && c.review.state === 'pending' ? ('self' as const) : c.review.state,
        vouches: c.vouches,
        when: claimWhen(c),
        due: renewsIn(c, now),
      })),
      thisMonth: monthOf(now),
    };
  });
});

const accountInput = z.object({
  platform: z.enum(PLATFORMS, 'Pick the platform.'),
  handle: z.string('Enter your handle on that platform.').transform(accountHandle).pipe(z.string().min(1, 'Enter your handle on that platform.').max(100, 'That handle is too long.')),
});

export const addAccount = createServerFn({ method: 'POST' })
  .validator((input: { platform: string; handle: string }) => input)
  .handler(async ({ data }): Promise<Outcome<{ account: number }>> => {
    const profile = await profileOrRefusal();
    if (!profile.ok) return profile;
    const input = parsed(accountInput, data);
    if (!input.ok) return input;
    if (!(await allowed('ticks'))) return refused(tooManyTries);
    const platform: Platform = input.value.platform;
    const added = await withStore(async (store) => await store.socialClaims.addAccount(profile.value.memberId, platform, input.value.handle));
    return added.ok ? done({ account: added.value.id }) : refused(accountRefusals[added.reason]);
  });

export const removeAccount = createServerFn({ method: 'POST' })
  .validator((input: { account: number }) => input)
  .handler(async ({ data }): Promise<Outcome<{ removed: boolean }>> => {
    const member = await currentMember();
    if (!member) return refused('Sign in first.');
    const input = parsed(z.object({ account: id }), data);
    if (!input.ok) return input;
    return done({ removed: await withStore(async (store) => await store.socialClaims.removeAccount(member.id, input.value.account)) });
  });

const bodyInput = z
  .object({
    body: z.enum(BODY_IDS, 'Pick your body.'),
    status: z.string('Pick your exact status.').min(1, 'Pick your exact status.'),
    reference: line(CLAIM_LIMITS.reference, 'Enter your member or student number.'),
    otherName: z.string().transform(oneLine).pipe(z.string().max(CLAIM_LIMITS.otherBody, `Keep it under ${CLAIM_LIMITS.otherBody} characters.`)).optional(),
    evidence,
  })
  .superRefine(async (value, ctx) => {
    if (statusTrack(value.body, value.status) === null) ctx.addIssue({ code: 'custom', path: ['status'], message: 'Pick your exact status.' });
    if (value.body !== 'other') return;
    if (!value.otherName) ctx.addIssue({ code: 'custom', path: ['otherName'], message: 'Enter the name of the body.' });
    const problem = await fileProblem(value.evidence);
    if (problem) ctx.addIssue({ code: 'custom', path: ['evidence'], message: problem });
  });

/** A body claim. Posted as a form, since a body with no register sends its certificate with it. */
export const addBody = createServerFn({ method: 'POST' })
  .validator((input: FormData) => {
    if (!(input instanceof FormData)) throw new Error('Expected a form.');
    return input;
  })
  .handler(async ({ data }): Promise<Outcome<{ claim: number }>> => {
    const profile = await profileOrRefusal();
    if (!profile.ok) return profile;
    const input = await parsedAsync(bodyInput, formFields(data, ['body', 'status', 'reference', 'otherName', 'evidence']));
    if (!input.ok) return input;
    if (!(await allowed('ticks'))) return refused(tooManyTries);
    const body = bodyById(input.value.body);
    if (!body) return refused('Pick your body.');
    const memberId = profile.value.memberId;
    const draft = { kind: 'body', bodyId: body.id, status: input.value.status, reference: input.value.reference } as const;
    const { evidence: file, otherName } = input.value;
    return body.id === 'other' && file && otherName
      ? addWithEvidence(memberId, file, (key) => ({ ...draft, otherName, evidenceKey: key }))
      : addPlain(memberId, { ...draft, otherName: null, evidenceKey: null });
  });

const licenceInput = z
  .object({
    licence: z.enum(LICENCES, 'Pick the licence you hold.'),
    reference: line(CLAIM_LIMITS.reference, 'Enter the licence or certificate number.'),
    until: month,
    evidence,
  })
  .superRefine(async (value, ctx) => {
    const problem = await fileProblem(value.evidence);
    if (problem) ctx.addIssue({ code: 'custom', path: ['evidence'], message: problem });
  });

/** A licence claim, with the document that shows it. */
export const addLicence = createServerFn({ method: 'POST' })
  .validator((input: FormData) => {
    if (!(input instanceof FormData)) throw new Error('Expected a form.');
    return input;
  })
  .handler(async ({ data }): Promise<Outcome<{ claim: number }>> => {
    const profile = await profileOrRefusal();
    if (!profile.ok) return profile;
    const input = await parsedAsync(licenceInput, formFields(data, ['licence', 'reference', 'until', 'evidence']));
    if (!input.ok) return input;
    if (!(await allowed('ticks'))) return refused(tooManyTries);
    const { evidence: file, licence, reference, until } = input.value;
    if (!file) return refused('Choose the file to upload.');
    return addWithEvidence(profile.value.memberId, file, (key) => ({ kind: 'licence', licence, reference, until, evidenceKey: key }));
  });

export const addAcademic = createServerFn({ method: 'POST' })
  .validator((input: { role: string; url: string }) => input)
  .handler(async ({ data }): Promise<Outcome<{ claim: number }>> => {
    const profile = await profileOrRefusal();
    if (!profile.ok) return profile;
    const input = parsed(z.object({ role: line(CLAIM_LIMITS.label, 'Enter your post, like Senior lecturer, Universiti Malaya.'), url: https }), data);
    if (!input.ok) return input;
    if (!(await allowed('ticks'))) return refused(tooManyTries);
    return addPlain(profile.value.memberId, { kind: 'academic', role: input.value.role, url: input.value.url });
  });

export const addExperience = createServerFn({ method: 'POST' })
  .validator((input: { text: string }) => input)
  .handler(async ({ data }): Promise<Outcome<{ claim: number }>> => {
    const profile = await profileOrRefusal();
    if (!profile.ok) return profile;
    const input = parsed(z.object({ text: line(CLAIM_LIMITS.label, 'Say what experience you have, like Six years in audit.') }), data);
    if (!input.ok) return input;
    if (!(await allowed('ticks'))) return refused(tooManyTries);
    return addPlain(profile.value.memberId, { kind: 'experience', text: input.value.text });
  });

export const removeClaim = createServerFn({ method: 'POST' })
  .validator((input: { claim: number }) => input)
  .handler(async ({ data }): Promise<Outcome<{ removed: boolean }>> => {
    const member = await currentMember();
    if (!member) return refused('Sign in first.');
    const input = parsed(z.object({ claim: id }), data);
    if (!input.ok) return input;
    const { removed, evidenceKey } = await withStore(async (store) => await store.socialClaims.removeClaim(member.id, input.value.claim));
    if (evidenceKey) await deleteEvidence(evidenceKey).catch((error: unknown) => report('evidence', `The document of removed claim ${input.value.claim} was not deleted`, error));
    return done({ removed });
  });

/** Emails a link to a work address. Only the domain shows on the profile, once the member confirms it signed in. */
export const sendWorkEmail = createServerFn({ method: 'POST' })
  .validator((input: { email: string }) => input)
  .handler(async ({ data }): Promise<Outcome<{ address: string }>> => {
    const profile = await profileOrRefusal();
    if (!profile.ok) return profile;
    const input = parsed(z.object({ email }), data);
    if (!input.ok) return input;
    if (!(await allowed('work-email'))) return refused(tooManyTries);
    const check = await withStore(async (store) => await store.socialClaims.startWorkEmail(profile.value.memberId, input.value.email));
    if (!check.ok) return refused(workEmailRefusals[check.reason]);
    const { address, token, expiresAt, claim } = check.value;
    const link = socialAbsolute(`/verify/email?token=${encodeURIComponent(token)}`);
    const domain = claim.label.replace(/^Works at /, '');
    sendLater([workEmailLetter({ address, name: profile.value.name, handle: profile.value.handle, domain, link, expiresAt })]);
    return done({ address });
  });

/**
 * The page a work-email link opens: who asked and for which domain, and whether the signed-in member is them. A link
 * that is used, replaced or out of date is a 404.
 */
export const workEmailPage = createServerFn({ method: 'GET' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const member = await currentMember();
    const pending = data.token ? await withStore(async (store) => await store.socialClaims.workEmail(data.token)) : null;
    if (!pending) throw notFound();
    return {
      name: pending.name,
      handle: pending.handle,
      domain: pending.domain,
      viewer: member === null ? ('signed-out' as const) : pending.memberId === member.id ? ('asker' as const) : ('someone-else' as const),
      memberName: member?.name ?? null,
    };
  });

/** Opening the link confirms nothing, since mail scanners open links too. The member who asked confirms here, signed in. */
export const confirmWorkEmail = createServerFn({ method: 'POST' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }): Promise<Outcome<{ label: string }>> => {
    const member = await currentMember();
    if (!member) return refused('Sign in first.');
    const input = parsed(z.object({ token: z.string().min(1) }), data);
    if (!input.ok) return input;
    const claim = await withStore(async (store) => await store.socialClaims.confirmWorkEmail(member.id, input.value.token));
    return claim.ok ? done({ label: claim.value.label }) : refused(confirmRefusals[claim.reason]);
  });

/** A member with the seal vouches for someone else's experience. Used on profiles. */
export const vouch = createServerFn({ method: 'POST' })
  .validator((input: { claim: number }) => input)
  .handler(async ({ data }): Promise<Outcome<{ vouches: number; ticked: boolean }>> => {
    const member = await currentMember();
    if (!member) return refused('Sign in first.');
    const input = parsed(z.object({ claim: id }), data);
    if (!input.ok) return input;
    const claim = await withStore(async (store) => await store.socialClaims.vouch(member.id, input.value.claim));
    return claim.ok ? done({ vouches: claim.value.vouches, ticked: claim.value.review.state === 'ticked' }) : refused(vouchRefusals[claim.reason]);
  });

/** Like parsed(), for a schema with async checks: the file checks read the upload's first bytes. */
async function parsedAsync<S extends z.ZodType>(schema: S, input: unknown): Promise<{ readonly ok: true; readonly value: z.output<S> } | Outcome<never>> {
  const result = await schema.safeParseAsync(input);
  if (result.success) return { ok: true, value: result.data };
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !(field in fields)) fields[field] = issue.message;
  }
  return refused('Check the fields marked below.', fields);
}
