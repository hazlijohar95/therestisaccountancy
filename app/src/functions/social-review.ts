import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { CLAIM_LIMITS, REPORT_TARGETS } from '../../../src/data/social.ts';
import { deleteEvidence } from '../../../src/server/evidence.ts';
import { send } from '../../../src/server/mail.ts';
import { report } from '../../../src/server/report.ts';
import type { DecisionRefusal } from '../../../src/server/social-claims.ts';
import type { RevokeRefusal, TeamInviteRefusal } from '../../../src/server/social-invites.ts';
import { accountDecidedLetter, claimDecidedLetter, requestApprovedLetter, requestDeclinedLetter, teamInviteLetter } from '../../../src/server/social-letters.ts';
import type { InviteRefusal } from '../../../src/server/social-nominations.ts';
import type { DecideRefusal } from '../../../src/server/social-requests.ts';
import { adminOrRefusal } from '../lib/guards.server.ts';
import { absolute, sendLater } from '../lib/mail.server.ts';
import { done, parsed, refused, type Outcome } from '../lib/outcome.ts';
import { currentMember } from '../lib/session.server.ts';
import { blankable, email, id, line, oneLine, socialAbsolute } from '../lib/social-input.server.ts';
import { withStore } from '../lib/store.server.ts';

/*
 * The team's review queue: accounts, credentials and documents to tick, nominations to invite, reports, requests to
 * join and the team's own invites. Every function here is for admins only; anyone else gets a refusal, and the page a 404.
 */

const decisionRefusals: Record<DecisionRefusal, string> = {
  'not-found': 'That is no longer in the queue. The member may have removed it.',
  already: 'Someone on the team already decided that. Nothing was sent.',
  'proven-elsewhere': 'Another member has already proven that account. Reject this one.',
};

const inviteRefusals: Record<InviteRefusal, string> = {
  'not-found': 'That nomination is no longer in the queue.',
  already: 'Someone on the team already invited them. Make a new link from the invited list if the first one is lost.',
};

const decideRefusals: Record<DecideRefusal, string> = {
  decided: 'Someone on the team already decided that request.',
  suspended: 'That email belongs to a paused account. Reinstate it in the club admin first.',
};

const teamInviteRefusals: Record<TeamInviteRefusal, string> = {
  'on-social': 'That email is on Social already.',
};

const revokeRefusals: Record<RevokeRefusal, string> = {
  'not-found': 'That invite is not yours to revoke.',
  used: 'Someone has used that invite, so it cannot be taken back.',
};

const linkRefused = { 'not-found': 'That account was not saved. Try again.', suspended: 'That account is paused.' } as const;
const reportDecided = 'Someone on the team already decided that.';
const reason = line(CLAIM_LIMITS.reason, 'Say why, in a line. The member gets it by email.');

/** The queue, every tab of it, so each tab can show its count. Anyone but an admin gets a 404. */
export const reviewQueue = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember();
  if (member?.role !== 'admin') throw notFound();
  return withStore(async (store) => {
    const { accounts, credentials, documents } = await store.socialClaims.queue();
    const { pending, invited } = await store.socialNominations.queue();
    return {
      queue: { accounts, credentials, documents },
      nominations: { pending, invited },
      reports: await store.socialFloor.reports(),
      requests: await store.socialRequests.queue(),
      teamInvites: await store.socialInvites.teamInvites(),
    };
  });
});

/** Where a decided claim's member reads about it. */
const claimUrls = (handle: string | null) => ({ profile: socialAbsolute(handle ? `/@${handle}` : '/me'), verify: socialAbsolute('/verify') });

/** Deletes a decided claim's document, now if R2 answers, or in the next hourly run if not. */
async function dropEvidence(claimId: number, key: string | null): Promise<void> {
  if (!key) return;
  try {
    await deleteEvidence(key);
    await withStore(async (store) => await store.socialClaims.evidenceDeleted(claimId));
  } catch (error) {
    await report('evidence', `The document for claim ${claimId} was not deleted; the hourly job tries again`, error);
  }
}

export const approveAccount = createServerFn({ method: 'POST' })
  .validator((input: { account: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const reviewer = await adminOrRefusal();
    if (!reviewer.ok) return reviewer;
    const input = parsed(z.object({ account: id }), data);
    if (!input.ok) return input;
    const decided = await withStore(async (store) => await store.socialClaims.decideAccount(input.value.account, reviewer.value.id, { verdict: 'approve' }));
    if (!decided.ok) return refused(decisionRefusals[decided.reason]);
    sendLater([accountDecidedLetter(decided.value.member, decided.value.item, reviewer.value, socialAbsolute('/verify'))]);
    return done(null);
  });

export const rejectAccount = createServerFn({ method: 'POST' })
  .validator((input: { account: number; reason: string }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const reviewer = await adminOrRefusal();
    if (!reviewer.ok) return reviewer;
    const input = parsed(z.object({ account: id, reason }), data);
    if (!input.ok) return input;
    const decided = await withStore(
      async (store) => await store.socialClaims.decideAccount(input.value.account, reviewer.value.id, { verdict: 'reject', reason: input.value.reason }),
    );
    if (!decided.ok) return refused(decisionRefusals[decided.reason]);
    sendLater([accountDecidedLetter(decided.value.member, decided.value.item, reviewer.value, socialAbsolute('/verify'))]);
    return done(null);
  });

export const approveClaim = createServerFn({ method: 'POST' })
  .validator((input: { claim: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const reviewer = await adminOrRefusal();
    if (!reviewer.ok) return reviewer;
    const input = parsed(z.object({ claim: id }), data);
    if (!input.ok) return input;
    const { key, decided } = await withStore(async (store) => ({
      key: await store.socialClaims.evidenceKey(input.value.claim),
      decided: await store.socialClaims.decideClaim(input.value.claim, reviewer.value.id, { verdict: 'approve' }),
    }));
    if (!decided.ok) return refused(decisionRefusals[decided.reason]);
    const { item, member } = decided.value;
    await dropEvidence(item.id, key);
    sendLater([claimDecidedLetter(member, item, reviewer.value, claimUrls(member.handle))]);
    return done(null);
  });

export const rejectClaim = createServerFn({ method: 'POST' })
  .validator((input: { claim: number; reason: string }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const reviewer = await adminOrRefusal();
    if (!reviewer.ok) return reviewer;
    const input = parsed(z.object({ claim: id, reason }), data);
    if (!input.ok) return input;
    const { key, decided } = await withStore(async (store) => ({
      key: await store.socialClaims.evidenceKey(input.value.claim),
      decided: await store.socialClaims.decideClaim(input.value.claim, reviewer.value.id, { verdict: 'reject', reason: input.value.reason }),
    }));
    if (!decided.ok) return refused(decisionRefusals[decided.reason]);
    const { item, member } = decided.value;
    await dropEvidence(item.id, key);
    sendLater([claimDecidedLetter(member, item, reviewer.value, claimUrls(member.handle))]);
    return done(null);
  });

/** What the team sends a nominee by direct message. It exists only in this answer: only its hash is kept. */
interface InviteLink {
  readonly platform: string;
  readonly handle: string;
  readonly url: string;
  readonly link: string;
}

const nominationInput = z.object({ nomination: id });

export const inviteNomination = createServerFn({ method: 'POST' })
  .validator((input: { nomination: number }) => input)
  .handler(async ({ data }): Promise<Outcome<InviteLink>> => {
    const reviewer = await adminOrRefusal();
    if (!reviewer.ok) return reviewer;
    const input = parsed(nominationInput, data);
    if (!input.ok) return input;
    const invited = await withStore(async (store) => await store.socialNominations.invite(input.value.nomination, reviewer.value.id));
    if (!invited.ok) return refused(inviteRefusals[invited.reason]);
    const { nomination, token } = invited.value;
    return done({ platform: nomination.platform, handle: nomination.handle, url: nomination.url, link: socialAbsolute(`/claim/${encodeURIComponent(token)}`) });
  });

export const relinkNomination = createServerFn({ method: 'POST' })
  .validator((input: { nomination: number }) => input)
  .handler(async ({ data }): Promise<Outcome<InviteLink>> => {
    const reviewer = await adminOrRefusal();
    if (!reviewer.ok) return reviewer;
    const input = parsed(nominationInput, data);
    if (!input.ok) return input;
    const invited = await withStore(async (store) => await store.socialNominations.relink(input.value.nomination, reviewer.value.id));
    if (!invited.ok) return refused(inviteRefusals[invited.reason]);
    const { nomination, token } = invited.value;
    return done({ platform: nomination.platform, handle: nomination.handle, url: nomination.url, link: socialAbsolute(`/claim/${encodeURIComponent(token)}`) });
  });

export const rejectNomination = createServerFn({ method: 'POST' })
  .validator((input: { nomination: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const reviewer = await adminOrRefusal();
    if (!reviewer.ok) return reviewer;
    const input = parsed(nominationInput, data);
    if (!input.ok) return input;
    const rejected = await withStore(async (store) => await store.socialNominations.reject(input.value.nomination, reviewer.value.id));
    return rejected.ok ? done(null) : refused(inviteRefusals[rejected.reason]);
  });

const reportedInput = z.object({ target: z.enum(REPORT_TARGETS), id });

/** Hides a reported post or reply, or takes a profile off The List, and closes every report on it. */
export const hideReported = createServerFn({ method: 'POST' })
  .validator((input: { target: string; id: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const reviewer = await adminOrRefusal();
    if (!reviewer.ok) return reviewer;
    const input = parsed(reportedInput, data);
    if (!input.ok) return input;
    const decided = await withStore(async (store) => await store.socialFloor.decideReports(reviewer.value.id, input.value.target, input.value.id, 'hide'));
    return decided.ok ? done(null) : refused(reportDecided);
  });

/** Leaves a reported thing as it is, and closes every report on it. */
export const dismissReported = createServerFn({ method: 'POST' })
  .validator((input: { target: string; id: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const reviewer = await adminOrRefusal();
    if (!reviewer.ok) return reviewer;
    const input = parsed(reportedInput, data);
    if (!input.ok) return input;
    const decided = await withStore(async (store) => await store.socialFloor.decideReports(reviewer.value.id, input.value.target, input.value.id, 'dismiss'));
    return decided.ok ? done(null) : refused(reportDecided);
  });

const requestInput = z.object({ request: id });

/** Approves a request to join. Someone new gets the link to set a password; someone who signs in already, never a reset. */
export const approveRequest = createServerFn({ method: 'POST' })
  .validator((input: { request: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const team = await adminOrRefusal();
    if (!team.ok) return team;
    const input = parsed(requestInput, data);
    if (!input.ok) return input;
    const result = await withStore(async (store) => {
      const approval = await store.socialRequests.approve(input.value.request, team.value.id);
      if (!approval.ok || approval.value.kind !== 'welcome') return { approval, link: null };
      return { approval, link: await store.club.newLink(approval.value.memberId) };
    });
    const { approval, link } = result;
    if (!approval.ok) return refused(decideRefusals[approval.reason]);
    if (approval.value.kind === 'sign-in') {
      const signIn = absolute(`/sign-in?next=${encodeURIComponent(socialAbsolute('/me'))}`);
      sendLater([requestApprovedLetter(approval.value, { signIn, hasProfile: approval.value.hasProfile })]);
      return done(null);
    }
    if (!link?.ok) return refused(linkRefused[link?.reason ?? 'not-found']);
    const { member, token, expiresAt } = link.value;
    sendLater([requestApprovedLetter(member, { link: absolute(`/welcome?token=${encodeURIComponent(token)}`), expiresAt })]);
    return done(null);
  });

export const declineRequest = createServerFn({ method: 'POST' })
  .validator((input: { request: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const team = await adminOrRefusal();
    if (!team.ok) return team;
    const input = parsed(requestInput, data);
    if (!input.ok) return input;
    const declined = await withStore(async (store) => await store.socialRequests.decline(input.value.request, team.value.id));
    if (!declined.ok) return refused(decideRefusals.decided);
    sendLater([requestDeclinedLetter(declined.value)]);
    return done(null);
  });

/** The team invites by email. The link is emailed, and shown once in the answer to send by hand if the email fails. */
export const teamInvite = createServerFn({ method: 'POST' })
  .validator((input: { email: string; name: string }) => input)
  .handler(async ({ data }): Promise<Outcome<{ email: string; link: string; emailed: boolean }>> => {
    const team = await adminOrRefusal();
    if (!team.ok) return team;
    const input = parsed(z.object({ email, name: blankable(z.string().transform(oneLine).pipe(z.string().max(60, 'Keep the name under 60 characters.'))) }), data);
    if (!input.ok) return input;
    const to = { email: input.value.email, name: input.value.name || null };
    const invited = await withStore(async (store) => await store.socialInvites.inviteByEmail(team.value.id, to));
    if (!invited.ok) return refused(teamInviteRefusals[invited.reason]);
    const link = socialAbsolute(`/sign-up?invite=${encodeURIComponent(invited.value.token)}`);
    const emailed = await send(teamInviteLetter(to, team.value, { link, expiresAt: invited.value.invite.expiresAt }));
    return done({ email: to.email, link, emailed });
  });

export const withdrawTeamInvite = createServerFn({ method: 'POST' })
  .validator((input: { invite: number }) => input)
  .handler(async ({ data }): Promise<Outcome<null>> => {
    const team = await adminOrRefusal();
    if (!team.ok) return team;
    const input = parsed(z.object({ invite: id }), data);
    if (!input.ok) return input;
    const withdrawn = await withStore(async (store) => await store.socialInvites.withdraw(input.value.invite));
    return withdrawn.ok ? done(null) : refused(revokeRefusals[withdrawn.reason]);
  });
