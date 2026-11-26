import { notFound, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { accountHandle, BODY_IDS, bodyById, CLAIM_LIMITS, LICENCES, PLATFORMS, statusTrack, type Platform } from '../../../src/data/social.ts';
import { claimWhen, renewsIn } from '../../../src/lib/ticks.ts';
import { deleteEvidence, storeEvidence, type EvidenceRefusal } from '../../../src/server/evidence.ts';
import { signInPath, socialPath } from '../../../src/server/paths.ts';
import { report } from '../../../src/server/report.ts';
import { email, id, line, oneLine } from '../lib/fields.ts';
import { denials } from '../lib/access.ts';
import { admit } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
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
import type { Store } from '../../../src/server/instance.ts';
import { done, refused, type Outcome } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { formFields, socialAbsolute } from '../lib/social-input.server.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * Get ticked: proving accounts, sending claims to the team, the work-email link, and vouching. The team's decisions
 * are in social-review.ts.
 */

const noHandle = denials['no-handle'];

const accountRefusals: Record<AccountRefusal | 'no-handle', string> = {
  'no-handle': noHandle,
  'handle-invalid': 'That does not look like a handle on that platform. Type the handle, or paste the profile’s address.',
  'platform-taken': 'You already have an account on that platform here. Remove it first to add another.',
  'proven-elsewhere': 'Someone has already proven that account. If it is yours, write to the team.',
};

const claimRefusals: Record<ClaimRefusal, string> = {
  'no-handle': noHandle,
  duplicate: 'That claim is already waiting for the team.',
  'too-many': 'You have 20 claims waiting. Wait for the team to check some first.',
};

const evidenceRefusals: Record<EvidenceRefusal, string> = {
  'evidence-type': 'Upload a PDF, or a photo as JPEG, PNG or WebP.',
  'evidence-size': 'Upload a file under 5 MB.',
};

const workEmailRefusals: Record<WorkEmailRefusal, string> = {
  'no-handle': noHandle,
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
async function addWithEvidence(store: Store, memberId: number, file: File, draft: (key: string) => ClaimDraft): Promise<Outcome<{ claim: number }>> {
  const stored = await storeEvidence(memberId, file);
  if (!stored.ok) return refused(evidenceRefusals[stored.reason]);
  const added = await store.socialClaims.addClaim(memberId, draft(stored.value));
  if (added.ok) return done({ claim: added.value.id });
  await deleteEvidence(stored.value);
  return refused(claimRefusals[added.reason]);
}

/** Adds a claim with no document, or the refusal. */
async function addPlain(store: Store, memberId: number, draft: ClaimDraft): Promise<Outcome<{ claim: number }>> {
  const added = await store.socialClaims.addClaim(memberId, draft);
  return added.ok ? done({ claim: added.value.id }) : refused(claimRefusals[added.reason]);
}

/** A form's fields as the claim schemas read them. Posted as a form, since a document rides with it. */
const claimForm = (names: readonly string[]) => (input: FormData) => {
  if (!(input instanceof FormData)) throw new Error('Expected a form.');
  return formFields(input, names);
};

/** Get ticked: the member's accounts and claims, each with what its row says. Signed out goes to sign in; no handle, to claim one. */
export const verifyPage = createServerFn({ method: 'GET' }).handler(async () => {
  const profile = await admit('profile', (denial, here) => redirect({ href: denial === 'signed-out' ? signInPath(here, '/verify') : socialPath(here, '/edit') }));
  const now = new Date();
  return withStore(async (store) => {
    const { accounts, claims } = await store.socialClaims.mine(profile.memberId);
    return {
      name: profile.name,
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
  .handler(
    action({ access: 'profile', input: accountInput, limit: 'ticks', refusals: accountRefusals }, async ({ actor, input, store }) => {
      const platform: Platform = input.platform;
      const added = await store.socialClaims.addAccount(actor.memberId, platform, input.handle);
      return added.ok ? done({ account: added.value.id }) : added;
    }),
  );

export const removeAccount = createServerFn({ method: 'POST' })
  .validator((input: { account: number }) => input)
  .handler(action({ access: 'member', input: z.object({ account: id }) }, async ({ actor, input, store }) => done({ removed: await store.socialClaims.removeAccount(actor.id, input.account) })));

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

/** A body claim. A body with no register sends its certificate with it. */
export const addBody = createServerFn({ method: 'POST' })
  .validator(claimForm(['body', 'status', 'reference', 'otherName', 'evidence']))
  .handler(
    action({ access: 'profile', input: bodyInput, limit: 'ticks' }, async ({ actor, input, store }) => {
      const body = bodyById(input.body);
      if (!body) return refused('Pick your body.');
      const draft = { kind: 'body', bodyId: body.id, status: input.status, reference: input.reference } as const;
      const { evidence: file, otherName } = input;
      return body.id === 'other' && file && otherName
        ? await addWithEvidence(store, actor.memberId, file, (key) => ({ ...draft, otherName, evidenceKey: key }))
        : await addPlain(store, actor.memberId, { ...draft, otherName: null, evidenceKey: null });
    }),
  );

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
  .validator(claimForm(['licence', 'reference', 'until', 'evidence']))
  .handler(
    action({ access: 'profile', input: licenceInput, limit: 'ticks' }, async ({ actor, input, store }) => {
      const { evidence: file, licence, reference, until } = input;
      if (!file) return refused('Choose the file to upload.');
      return await addWithEvidence(store, actor.memberId, file, (key) => ({ kind: 'licence', licence, reference, until, evidenceKey: key }));
    }),
  );

export const addAcademic = createServerFn({ method: 'POST' })
  .validator((input: { role: string; url: string }) => input)
  .handler(
    action(
      { access: 'profile', input: z.object({ role: line(CLAIM_LIMITS.label, 'Enter your post, like Senior lecturer, Universiti Malaya.'), url: https }), limit: 'ticks' },
      async ({ actor, input, store }) => await addPlain(store, actor.memberId, { kind: 'academic', role: input.role, url: input.url }),
    ),
  );

export const addExperience = createServerFn({ method: 'POST' })
  .validator((input: { text: string }) => input)
  .handler(
    action(
      { access: 'profile', input: z.object({ text: line(CLAIM_LIMITS.label, 'Say what experience you have, like Six years in audit.') }), limit: 'ticks' },
      async ({ actor, input, store }) => await addPlain(store, actor.memberId, { kind: 'experience', text: input.text }),
    ),
  );

export const removeClaim = createServerFn({ method: 'POST' })
  .validator((input: { claim: number }) => input)
  .handler(
    action({ access: 'member', input: z.object({ claim: id }) }, async ({ actor, input, store }) => {
      const { removed, evidenceKey } = await store.socialClaims.removeClaim(actor.id, input.claim);
      if (evidenceKey) await deleteEvidence(evidenceKey).catch((error: unknown) => report('evidence', `The document of removed claim ${input.claim} was not deleted`, error));
      return done({ removed });
    }),
  );

/** Emails a link to a work address. Only the domain shows on the profile, once the member confirms it signed in. */
export const sendWorkEmail = createServerFn({ method: 'POST' })
  .validator((input: { email: string }) => input)
  .handler(
    action({ access: 'profile', input: z.object({ email }), limit: 'work-email', refusals: workEmailRefusals }, async ({ actor, input, store, send }) => {
      const started = await store.socialClaims.startWorkEmail(actor.memberId, input.email);
      if (!started.ok) return started;
      const { address, token, expiresAt, claim } = started.value;
      const link = socialAbsolute(`/verify/email?token=${encodeURIComponent(token)}`);
      const domain = claim.label.replace(/^Works at /, '');
      send([workEmailLetter({ address, name: actor.name, handle: actor.handle, domain, link, expiresAt })]);
      return done({ address });
    }),
  );

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
  .handler(
    action({ access: 'member', input: z.object({ token: z.string().min(1) }), refusals: confirmRefusals }, async ({ actor, input, store }) => {
      const claim = await store.socialClaims.confirmWorkEmail(actor.id, input.token);
      return claim.ok ? done({ label: claim.value.label }) : claim;
    }),
  );

/** A member with the seal vouches for someone else's experience. Used on profiles. */
export const vouch = createServerFn({ method: 'POST' })
  .validator((input: { claim: number }) => input)
  .handler(
    action({ access: 'member', input: z.object({ claim: id }), refusals: vouchRefusals }, async ({ actor, input, store }) => {
      const claim = await store.socialClaims.vouch(actor.id, input.claim);
      return claim.ok ? done({ vouches: claim.value.vouches, ticked: claim.value.review.state === 'ticked' }) : claim;
    }),
  );

