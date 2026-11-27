import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { joiningRate, stopReasonLabel } from '../../../src/data/membership.ts';
import { roleLabel, statusLabel } from '../../../src/data/members.ts';
import { formatDay, waited } from '../../../src/lib/format.ts';
import { pageCount } from '../../../src/lib/paging.ts';
import { MEMBER_STATUSES, ROLES, memberNumber, type EditRefusal, type InviteRefusal, type LinkRefusal } from '../../../src/server/club.ts';
import { QUIET_DAYS, type ActivityKind, type LastActivity } from '../../../src/server/activity.ts';
import { deleteMemberEvidence } from '../../../src/server/evidence.ts';
import { clubApprovedLetter } from '../../../src/server/letters.ts';
import { send } from '../../../src/server/mail.ts';
import { report } from '../../../src/server/report.ts';
import { email, id, memberName } from '../lib/fields.ts';
import { admit, toClub } from '../lib/access.server.ts';
import { action } from '../lib/action.server.ts';
import { absolute } from '../lib/mail.server.ts';
import { done, refused } from '../lib/outcome.ts';
import { withStore } from '../lib/store.server.ts';
import { deliver, pagingFor, type Issued } from './admin.server.ts';

const PAGE_SIZE = 50;
const DECIDED_SHOWN = 20;

const activityVerbs: Record<ActivityKind, string> = {
  session: 'Said yes to a session',
  post: 'Posted',
  lesson: 'Finished a lesson',
  call: 'Booked a call',
  plan: 'Worked on their plan',
};

const lastDid = (last: LastActivity | null) => (last ? `${activityVerbs[last.kind]}, ${formatDay(last.at)}` : 'Nothing yet');

const memberRefusals: Record<EditRefusal, string> = {
  'not-found': 'There is no such member.',
  self: 'You cannot do that to your own account. Ask another admin.',
  'last-admin': 'The club needs at least one active admin. Make someone else an admin first.',
  'email-taken': 'Another member already uses that email.',
};

const inviteRefusals: Record<InviteRefusal, string> = {
  decided: 'That request has already been decided.',
  suspended: 'That email belongs to a suspended member. Reinstate them first, or decline the request.',
};

const linkRefusals: Record<LinkRefusal, string> = {
  'not-found': memberRefusals['not-found'],
  suspended: 'A suspended member cannot get a link. Reinstate them first.',
};

/** What the admin sees after accepting a request: the link that was sent, or that an existing account was approved. */
export type Invited = { readonly kind: 'link'; readonly issued: Issued } | { readonly kind: 'approved'; readonly name: string; readonly email: string; readonly emailed: boolean };

export interface OverviewSearch {
  readonly q?: string | undefined;
  readonly status?: string | undefined;
  readonly page?: number | undefined;
}

/**
 * The admin's front page: every queue waiting on the hosts, join requests waiting and decided, paying members gone quiet,
 * whether getting-started emails are held for want of a session, and one page of members, searched and filtered.
 */
export const adminOverview = createServerFn({ method: 'GET' })
  .validator((input: OverviewSearch) => input)
  .handler(async ({ data }) => {
    await admit('admin', toClub);
    const query = (typeof data.q === 'string' ? data.q : '').trim().slice(0, 100);
    const status = MEMBER_STATUSES.find((s) => s === data.status);
    const paging = pagingFor(data.page, PAGE_SIZE);
    return withStore(async (store) => {
      const host = await store.queues.host();
      const pending = await store.club.joinRequests({ decided: false });
      const decided = await store.club.joinRequests({ decided: true, limit: DECIDED_SHOWN });
      const { items, total } = await store.club.members({ query, status, limit: paging.size, offset: paging.offset });
      const counts = await store.club.memberCounts();
      const quiet = await store.activity.quiet();
      const sessionsHeld = (await store.schedule.forOnboarding()).length ? null : { waiting: await store.mailings.onboardingWaiting() };
      const filters = [
        { status: undefined, label: `All ${counts.invited + counts.active + counts.suspended}` },
        ...MEMBER_STATUSES.map((s) => ({ status: s, label: `${statusLabel[s]} ${counts[s]}` })),
      ];
      const now = new Date();
      return {
        query,
        status,
        queues: host.flatMap((q) => (q.since === null ? [] : [{ id: q.id, label: q.label, where: q.where, count: q.count, waited: waited(q.since, now), stale: q.stale }])),
        page: paging.page,
        pages: pageCount(total, paging.size),
        filters,
        sessionsHeld,
        quietDays: QUIET_DAYS,
        quiet: quiet.map((m) => ({ id: m.id, name: m.name, email: m.email, last: lastDid(m.last), paidUntil: formatDay(m.paidUntil), renews: m.renews ? 'On' : m.stop?.reason ? `Off (${stopReasonLabel[m.stop.reason]})` : 'Off' })),
        pending: pending.map((r) => ({ id: r.id, name: r.name, email: r.email, stage: r.stage, received: formatDay(r.createdAt) })),
        decided: decided.map((r) => ({ id: r.id, name: r.name, email: r.email, stage: r.stage, decision: r.status === 'invited' ? 'Invited' : 'Declined' })),
        members: items.map((m) => ({ id: m.id, number: memberNumber(m), name: m.name, email: m.email, role: roleLabel[m.role], status: statusLabel[m.status], since: formatDay(m.joinedAt) })),
      };
    });
  });

/** One member as the admin sees them: what is on record, and what may be done to them. */
export const adminMember = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const me = await admit('admin', toClub);
    const memberId = Number(data.id);
    if (!Number.isInteger(memberId) || memberId <= 0) throw notFound();
    const found = await withStore(async (store) => {
      const member = await store.club.member(memberId);
      if (!member) return null;
      const completed = await store.club.completedLessons(member.id);
      const postCount = await store.socialFloor.postCount(member.id);
      const last = await store.activity.last(member.id);
      const standing = await store.billing.standing(member.id);
      const stop = standing.renews ? null : await store.billing.lastStop(member.id);
      return {
        member,
        stop,
        lessonsDone: completed.size,
        postCount,
        last,
        standing: { paidUntil: standing.paidUntil, access: standing.access, renews: standing.renews, cardOnFile: standing.cardOnFile, term: standing.term },
      };
    });
    if (!found) throw notFound();
    const { member, standing } = found;
    const paid =
      member.role === 'admin'
        ? 'Admins do not pay'
        : standing.paidUntil
          ? `Until ${formatDay(standing.paidUntil)}${standing.access === 'grace' ? ', now in the grace period' : ''}, ${!standing.renews ? 'not renewing' : standing.cardOnFile ? `renews by card each ${standing.term}` : `pays each ${standing.term}`}`
          : 'Not yet';
    return {
      member: { id: member.id, name: member.name, email: member.email, role: member.role, status: member.status },
      self: member.id === me.id,
      roles: ROLES.map((role) => ({ value: role, label: roleLabel[role] })),
      facts: [
        { term: 'Member number', detail: memberNumber(member) },
        { term: 'Status', detail: statusLabel[member.status] },
        { term: 'Paid', detail: paid },
        ...(found.stop ? [{ term: 'Renewal off', detail: `${formatDay(found.stop.at)}, ${found.stop.reason ? stopReasonLabel[found.stop.reason] : 'no reason given'}${found.stop.note ? `. They wrote: ${found.stop.note}` : ''}` }] : []),
        { term: 'Role', detail: roleLabel[member.role] },
        { term: 'Since', detail: formatDay(member.joinedAt) },
        { term: 'Lessons done', detail: String(found.lessonsDone) },
        { term: 'Community posts', detail: String(found.postCount) },
        { term: 'Last active', detail: lastDid(found.last) },
      ],
    };
  });

const requestInput = z.object({ request: id });
const memberInput = z.object({ member: id });

/** Accepts a join request: a new member gets an invitation link; someone already on Social is approved for the club. */
export const inviteRequest = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof requestInput>) => input)
  .handler(
    action({ access: 'admin', input: requestInput, refusals: inviteRefusals }, async ({ input, store }) => {
      const invitation = await store.club.inviteFromRequest(input.request);
      if (!invitation.ok) return invitation;
      if (invitation.value.kind === 'link') return done<Invited>({ kind: 'link', issued: await deliver(invitation.value.link) });
      const { name, email: address } = invitation.value.member;
      const emailed = await send(clubApprovedLetter({ name, email: address, rate: joiningRate, payUrl: absolute('/members/pay') }));
      return done<Invited>({ kind: 'approved', name, email: address, emailed });
    }),
  );

export const declineRequest = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof requestInput>) => input)
  .handler(
    action({ access: 'admin', input: requestInput }, async ({ input, store }) => {
      const declined = await store.club.declineRequest(input.request);
      return declined ? done(null) : refused(inviteRefusals.decided);
    }),
  );

/** A new invitation or reset link, emailed. The admin sees the link either way, to send by hand if the email failed. */
export const issueLink = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof memberInput>) => input)
  .handler(
    action({ access: 'admin', input: memberInput, refusals: linkRefusals }, async ({ input, store }) => {
      const link = await store.club.newLink(input.member);
      if (!link.ok) return link;
      return done(await deliver(link.value));
    }),
  );

const memberUpdate = z.object({ member: id, name: memberName, email, role: z.enum(ROLES).optional() });

export const updateMember = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof memberUpdate>) => input)
  .handler(
    action({ access: 'admin', input: memberUpdate, refusals: memberRefusals }, async ({ actor, input, store, send }) => {
      const updated = await store.club.updateMember(actor.id, input.member, input, absolute('/'));
      if (!updated.ok) return updated;
      send(updated.value.letters);
      return done(null);
    }),
  );

export const suspendMember = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof memberInput>) => input)
  .handler(
    action({ access: 'admin', input: memberInput, refusals: memberRefusals }, async ({ actor, input, store, send }) => {
      const suspended = await store.club.suspendMember(actor.id, input.member, absolute('/'));
      if (!suspended.ok) return suspended;
      send(suspended.value.letters);
      return done(null);
    }),
  );

export const reinstateMember = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof memberInput>) => input)
  .handler(
    action({ access: 'admin', input: memberInput, refusals: memberRefusals }, async ({ input, store }) => {
      const result = await store.club.reinstateMember(input.member);
      return result.ok ? done(null) : result;
    }),
  );

const memberRemoval = z.object({ member: id, confirm: z.literal('yes', { error: 'Tick the box to confirm.' }) });

export const removeMember = createServerFn({ method: 'POST' })
  .validator((input: { member: number; confirm: string }) => input)
  .handler(
    action({ access: 'admin', input: memberRemoval, refusals: memberRefusals }, async ({ actor, input, store, send }) => {
      const member = input.member;
      const removed = await store.club.removeMember(actor.id, member, absolute('/'));
      if (!removed.ok) return removed;
      /* Their claims go with them, so documents still waiting for the team would be left in R2 with nothing pointing at them. */
      await deleteMemberEvidence(member).catch((error: unknown) => report('evidence', `Documents of removed member ${member} were not deleted`, error));
      send(removed.value.letters);
      return done(null);
    }),
  );
