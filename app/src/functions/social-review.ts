import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { CLAIM_LIMITS, REPORT_TARGETS } from '../../../src/data/social.ts';
import { deleteEvidence } from '../../../src/server/evidence.ts';
import { send } from '../../../src/server/mail.ts';
import type { Store } from '../../../src/server/instance.ts';
import { inviteUrl } from '../../../src/server/paths.ts';
import { report } from '../../../src/server/report.ts';
import type { DecisionRefusal } from '../../../src/server/social-claims.ts';
import type { RevokeRefusal, TeamInviteRefusal } from '../../../src/server/social-invites.ts';
import { accountDecidedLetter, claimDecidedLetter, requestDeclinedLetter, teamInviteLetter } from '../../../src/server/social-letters.ts';
import type { InviteRefusal } from '../../../src/server/social-nominations.ts';
import type { DecideRefusal } from '../../../src/server/social-requests.ts';
import { blankable, email, id, line, oneLine } from '../lib/fields.ts';
import { admit, hidden } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { absolute } from '../lib/mail.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { socialAbsolute } from '../lib/social-input.server.ts';
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

const reportDecided = 'Someone on the team already decided that.';
const reason = line(CLAIM_LIMITS.reason, 'Say why, in a line. The member gets it by email.');

/** The queue, every tab of it, so each tab can show its count. Anyone but an admin gets a 404. */
export const reviewQueue = createServerFn({ method: 'GET' }).handler(async () => {
  await admit('admin', hidden);
  return withStore(async (store) => {
    const { accounts, credentials, documents } = await store.socialClaims.queue();
    const { pending, invited } = await store.socialNominations.queue();
    return {
      queue: { accounts, credentials, documents },
      nominations: { pending, invited },
      reports: await store.socialFloor.reports(),
      requests: await store.socialRequests.queue(),
      teamInvites: await store.socialInvites.teamInvites(),
      /* What each item's wait is told against, so the server's page and the browser's agree. */
      now: new Date().toISOString(),
    };
  });
});

/** Where a decided claim's member reads about it. */
const claimUrls = (handle: string | null) => ({ profile: socialAbsolute(handle ? `/@${handle}` : '/me'), verify: socialAbsolute('/verify') });

/** Deletes a decided claim's document, now if R2 answers, or in the next hourly run if not. */
async function dropEvidence(store: Store, claimId: number, key: string | null): Promise<void> {
  if (!key) return;
  try {
    await deleteEvidence(key);
    await store.socialClaims.evidenceDeleted(claimId);
  } catch (error) {
    await report('evidence', `The document for claim ${claimId} was not deleted; the hourly job tries again`, error);
  }
}

export const approveAccount = createServerFn({ method: 'POST' })
  .validator((input: { account: number }) => input)
  .handler(
    action({ access: 'admin', input: z.object({ account: id }), refusals: decisionRefusals }, async ({ actor, input, store, send }) => {
      const decided = await store.socialClaims.decideAccount(input.account, actor.id, { verdict: 'approve' });
      if (!decided.ok) return decided;
      send([accountDecidedLetter(decided.value.member, decided.value.item, actor, socialAbsolute('/verify'))]);
      return done(null);
    }),
  );

export const rejectAccount = createServerFn({ method: 'POST' })
  .validator((input: { account: number; reason: string }) => input)
  .handler(
    action({ access: 'admin', input: z.object({ account: id, reason }), refusals: decisionRefusals }, async ({ actor, input, store, send }) => {
      const decided = await store.socialClaims.decideAccount(input.account, actor.id, { verdict: 'reject', reason: input.reason });
      if (!decided.ok) return decided;
      send([accountDecidedLetter(decided.value.member, decided.value.item, actor, socialAbsolute('/verify'))]);
      return done(null);
    }),
  );

export const approveClaim = createServerFn({ method: 'POST' })
  .validator((input: { claim: number }) => input)
  .handler(
    action({ access: 'admin', input: z.object({ claim: id }), refusals: decisionRefusals }, async ({ actor, input, store, send }) => {
      const key = await store.socialClaims.evidenceKey(input.claim);
      const decided = await store.socialClaims.decideClaim(input.claim, actor.id, { verdict: 'approve' });
      if (!decided.ok) return decided;
      const { item, member } = decided.value;
      await dropEvidence(store, item.id, key);
      send([claimDecidedLetter(member, item, actor, claimUrls(member.handle))]);
      return done(null);
    }),
  );

export const rejectClaim = createServerFn({ method: 'POST' })
  .validator((input: { claim: number; reason: string }) => input)
  .handler(
    action({ access: 'admin', input: z.object({ claim: id, reason }), refusals: decisionRefusals }, async ({ actor, input, store, send }) => {
      const key = await store.socialClaims.evidenceKey(input.claim);
      const decided = await store.socialClaims.decideClaim(input.claim, actor.id, { verdict: 'reject', reason: input.reason });
      if (!decided.ok) return decided;
      const { item, member } = decided.value;
      await dropEvidence(store, item.id, key);
      send([claimDecidedLetter(member, item, actor, claimUrls(member.handle))]);
      return done(null);
    }),
  );

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
  .handler(
    action({ access: 'admin', input: nominationInput, refusals: inviteRefusals }, async ({ actor, input, store }) => {
      const invited = await store.socialNominations.invite(input.nomination, actor.id);
      if (!invited.ok) return invited;
      const { nomination, token } = invited.value;
      return done<InviteLink>({ platform: nomination.platform, handle: nomination.handle, url: nomination.url, link: socialAbsolute(`/claim/${encodeURIComponent(token)}`) });
    }),
  );

export const relinkNomination = createServerFn({ method: 'POST' })
  .validator((input: { nomination: number }) => input)
  .handler(
    action({ access: 'admin', input: nominationInput, refusals: inviteRefusals }, async ({ actor, input, store }) => {
      const invited = await store.socialNominations.relink(input.nomination, actor.id);
      if (!invited.ok) return invited;
      const { nomination, token } = invited.value;
      return done<InviteLink>({ platform: nomination.platform, handle: nomination.handle, url: nomination.url, link: socialAbsolute(`/claim/${encodeURIComponent(token)}`) });
    }),
  );

export const rejectNomination = createServerFn({ method: 'POST' })
  .validator((input: { nomination: number }) => input)
  .handler(
    action({ access: 'admin', input: nominationInput, refusals: inviteRefusals }, async ({ actor, input, store }) => {
      const rejected = await store.socialNominations.reject(input.nomination, actor.id);
      return rejected.ok ? done(null) : rejected;
    }),
  );

const reportedInput = z.object({ target: z.enum(REPORT_TARGETS), id });

/** Hides a reported post or reply, or takes a profile off The List, and closes every report on it. */
export const hideReported = createServerFn({ method: 'POST' })
  .validator((input: { target: string; id: number }) => input)
  .handler(
    action({ access: 'admin', input: reportedInput }, async ({ actor, input, store }) => {
      const decided = await store.socialFloor.decideReports(actor.id, input.target, input.id, 'hide');
      return decided.ok ? done(null) : refused(reportDecided);
    }),
  );

/** Leaves a reported thing as it is, and closes every report on it. */
export const dismissReported = createServerFn({ method: 'POST' })
  .validator((input: { target: string; id: number }) => input)
  .handler(
    action({ access: 'admin', input: reportedInput }, async ({ actor, input, store }) => {
      const decided = await store.socialFloor.decideReports(actor.id, input.target, input.id, 'dismiss');
      return decided.ok ? done(null) : refused(reportDecided);
    }),
  );

const requestInput = z.object({ request: id });

/** Approves a request to join. Someone new gets the link to set a password; someone who signs in already, never a reset. */
export const approveRequest = createServerFn({ method: 'POST' })
  .validator((input: { request: number }) => input)
  .handler(
    action({ access: 'admin', input: requestInput, refusals: decideRefusals }, async ({ actor, input, store, send }) => {
      const approved = await store.socialRequests.approve(input.request, actor.id, absolute('/'));
      if (!approved.ok) return approved;
      send(approved.value);
      return done(null);
    }),
  );

export const declineRequest = createServerFn({ method: 'POST' })
  .validator((input: { request: number }) => input)
  .handler(
    action({ access: 'admin', input: requestInput }, async ({ actor, input, store, send }) => {
      const declined = await store.socialRequests.decline(input.request, actor.id);
      if (!declined.ok) return refused(decideRefusals.decided);
      send([requestDeclinedLetter(declined.value)]);
      return done(null);
    }),
  );

/** The team invites by email. The link is emailed, and shown once in the answer to send by hand if the email fails. */
export const teamInvite = createServerFn({ method: 'POST' })
  .validator((input: { email: string; name: string }) => input)
  .handler(
    action(
      {
        access: 'admin',
        input: z.object({ email, name: blankable(z.string().transform(oneLine).pipe(z.string().max(60, 'Keep the name under 60 characters.'))) }),
        refusals: teamInviteRefusals,
      },
      async ({ actor, input, store }) => {
        const to = { email: input.email, name: input.name || null };
        const invited = await store.socialInvites.inviteByEmail(actor.id, to);
        if (!invited.ok) return invited;
        const link = inviteUrl(absolute('/'), invited.value.token);
        const emailed = await send(teamInviteLetter(to, actor, { link, expiresAt: invited.value.invite.expiresAt }));
        return done({ email: to.email, link, emailed });
      },
    ),
  );

export const withdrawTeamInvite = createServerFn({ method: 'POST' })
  .validator((input: { invite: number }) => input)
  .handler(
    action({ access: 'admin', input: z.object({ invite: id }), refusals: revokeRefusals }, async ({ input, store }) => {
      const withdrawn = await store.socialInvites.withdraw(input.invite);
      return withdrawn.ok ? done(null) : withdrawn;
    }),
  );
