import { site } from '../data/site.ts';
import { firstName, formatDay, formatMonth } from '../lib/format.ts';
import type { Letter } from './letters.ts';
import type { Account, Claim, Person, Renewal } from './social-claims.ts';

/*
 * The emails ticks send. Decisions come from the person on the team who made them, so a reply reaches someone. Each
 * goes to the member's own address, never to anything they typed into a claim.
 */

const social = `${site.name} Social`;
const hi = (name: string) => `Hi ${firstName(name)},`;
const fromReviewer = (reviewer: { readonly name: string }) => `${firstName(reviewer.name)} from ${social}`;
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** The one-time link that proves a member gets mail at their employer's domain. */
export function workEmailLetter(to: { address: string; name: string; handle: string | null; domain: string; link: string; expiresAt: string }): Letter {
  const who = to.handle ? `${to.name} (@${to.handle})` : to.name;
  return {
    to: to.address,
    subject: `Confirm you work at ${to.domain}`,
    lines: [
      hi(to.name),
      `${who} asked ${social} to show that they work at ${to.domain}. Open the link, signed in as them, and confirm.`,
      { href: to.link, label: 'Confirm your work email' },
      `It works once, until ${formatDay(to.expiresAt)}. Only the domain shows on the profile, never this address.`,
      "Didn't ask for this? Ignore this email. Nothing is confirmed unless you sign in and say so.",
    ],
  };
}

/** The team's decision on a social account. */
export function accountDecidedLetter(member: Person, account: Account, reviewer: { readonly name: string }, verifyUrl: string): Letter {
  const where = `@${account.handle} on ${account.platform}`;
  if (account.review.state === 'proven') {
    return {
      to: member.email,
      from: fromReviewer(reviewer),
      subject: `Your ${account.platform} account is proven`,
      lines: [
        hi(member.name),
        `I found the code in the bio of ${where}, so it now shows as proven on your profile. You can take the code out.`,
        'Your seal shows once one more claim is ticked: a body, a licence or your work email.',
        { href: verifyUrl, label: 'See your ticks' },
        firstName(reviewer.name),
      ],
    };
  }
  const reason = account.review.state === 'rejected' ? account.review.reason : '';
  return {
    to: member.email,
    from: fromReviewer(reviewer),
    subject: `We could not prove your ${account.platform} account`,
    lines: [
      hi(member.name),
      `I looked at ${where} and could not prove it is yours:`,
      reason,
      'Add it again with a new code whenever you are ready. Questions? Reply to this email.',
      { href: verifyUrl, label: 'Add it again' },
      firstName(reviewer.name),
    ],
  };
}

/** The team's decision on a credential they checked. */
export function claimDecidedLetter(member: Person, claim: Claim, reviewer: { readonly name: string }, urls: { profile: string; verify: string }): Letter {
  if (claim.review.state === 'ticked') {
    return {
      to: member.email,
      from: fromReviewer(reviewer),
      subject: `Ticked: ${claim.label}`,
      lines: [
        hi(member.name),
        `I checked “${claim.label}” and ticked it. It shows on your profile now.`,
        ...(claim.until ? [`It runs to the end of ${formatMonth(claim.until)}. We remind you before then, so you can renew it.`] : []),
        ...(claim.source === 'document' ? ['The document you sent has been deleted. We keep only the decision.'] : []),
        { href: urls.profile, label: 'See your profile' },
        firstName(reviewer.name),
      ],
    };
  }
  const reason = claim.review.state === 'rejected' ? claim.review.reason : '';
  return {
    to: member.email,
    from: fromReviewer(reviewer),
    subject: `Not ticked: ${claim.label}`,
    lines: [
      hi(member.name),
      `I checked “${claim.label}” and could not tick it:`,
      reason,
      ...(claim.source === 'document' ? ['The document you sent has been deleted.'] : []),
      'Send it again with what was missing. Questions? Reply to this email.',
      { href: urls.verify, label: 'Send it again' },
      firstName(reviewer.name),
    ],
  };
}

/** A tick runs out soon. Sent 60 days before, and again 14 days before. */
export function tickRenewalLetter({ claim, member, daysLeft }: Renewal, verifyUrl: string): Letter {
  const until = claim.until ? formatMonth(claim.until) : '';
  return {
    to: member.email,
    subject: `Your “${claim.label}” tick runs out in ${days(daysLeft)}`,
    lines: [
      hi(member.name),
      `Your “${claim.label}” tick runs to the end of ${until}. ${days(daysLeft)} left.`,
      claim.kind === 'body'
        ? 'Send it again and someone on the team checks it once more.'
        : "Upload this year's document and someone on the team checks it once more.",
      'If it lapses, it stays on your profile struck through in red until you renew it.',
      { href: verifyUrl, label: 'Renew it' },
    ],
  };
}

/** The team invites someone by email. The link is theirs alone and works once. */
export function teamInviteLetter(to: { email: string; name: string | null }, from: { readonly name: string }, invite: { link: string; expiresAt: string }): Letter {
  return {
    to: to.email,
    from: fromReviewer(from),
    subject: `An invite to ${social}`,
    lines: [
      to.name ? hi(to.name) : 'Hi,',
      `${social} is a free room for people in accountancy, where every account is one we know. I would like you in it.`,
      { href: invite.link, label: 'Accept the invite' },
      `The link works once, until ${formatDay(invite.expiresAt)}. You pick a handle and set a password; that is all.`,
      'Not for you? Ignore this email and nothing happens.',
      firstName(from.name),
    ],
  };
}

/**
 * The team approved a request. Someone new gets the link to set a password, and picks their handle after it; someone
 * who already signs in is told to, never sent a reset.
 */
export function requestApprovedLetter(
  to: { email: string; name: string },
  next: { readonly link: string; readonly expiresAt: string } | { readonly signIn: string; readonly hasProfile: boolean },
): Letter {
  return {
    to: to.email,
    subject: `You're in: ${social}`,
    lines: [
      hi(to.name),
      'We read your request to join, and you are in.',
      ...('link' in next
        ? [
            { href: next.link, label: 'Set your password' },
            `Then pick your handle. The link works once and runs out on ${formatDay(next.expiresAt)}. If it does, ask for a new one on the sign-in page.`,
          ]
        : [
            next.hasProfile ? 'You already sign in here, so there is nothing new to set up.' : 'You already have an account with us. Sign in with it and pick your handle.',
            { href: next.signIn, label: 'Sign in' },
          ]),
      'Social is free. There is nothing to pay.',
    ],
  };
}

/** The team declined a request. Short and kind; it leaves the door open. */
export function requestDeclinedLetter(to: { email: string; name: string }): Letter {
  return {
    to: to.email,
    subject: `Your request to join ${social}`,
    lines: [
      hi(to.name),
      'Thank you for asking to join. We read every request, and we are not adding you for now.',
      'Social is small on purpose while it grows. If a member invites you, the invite works straight away.',
    ],
  };
}
