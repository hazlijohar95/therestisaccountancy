import { week } from '../data/club.ts';
import { FIRST_STEPS, firstSteps } from '../data/onboarding.ts';
import { joiningRate, stopReasonLabel, TERMS, terms, type StopReason, type Term } from '../data/membership.ts';
import { site } from '../data/site.ts';
import { capitalised, firstName, formatDay, formatMoment, listOf, numberWord, tally } from '../lib/format.ts';
import type { JoinedVia, JoinRequest, LinkPurpose, PasswordLink } from './club.ts';
import type { ActivityKind } from './activity.ts';
import { calendarFile, sessionEvent } from './calendar.ts';
import type { List, OnboardingStep, Recipient, Subscriber } from './mailings.ts';
import { cpeHost, welcomeUrl } from './paths.ts';
import type { LiveSession } from './schedule.ts';

/*
 * The copy follows how PostHog writes its emails: get to the point, sound like a person, make it about this reader,
 * one thing to do, say why they are getting it, and keep bad news plain and kind. Emails that start or keep up a
 * relationship come from a host, so a reply reaches someone; the rest come from the club.
 */

/**
 * A paragraph of typed text, or a link the club built. Only built links become clickable: typed input never does. A
 * link with a label is a button; with text it is those words, linked; with neither it shows the address.
 */
/** A numbered row in a list of steps: a linked title and a few words under it. */
export interface StepLine {
  readonly title: string;
  readonly detail: string;
  readonly href: string;
}

export type Line = string | { readonly href: string; readonly label?: string; readonly text?: string } | { readonly steps: readonly StepLine[] };

/** One email, written once. The React Email template turns its lines into the HTML and the text part. */
export interface Letter {
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly lines: readonly Line[];
  /** The sender's display name, when a host sends it. The address is always the club's. */
  readonly from?: string;
  readonly attachments?: readonly { readonly filename: string; readonly type: string; readonly content: string }[];
  /** Where one click stops this kind of email, and which kind it is. Sent as List-Unsubscribe too, so mail apps offer it. */
  readonly unsubscribe?: { readonly url: string; readonly list: List };
}

const fromHost = `${site.host} from ${site.name}`;
const hi = (name: string) => `Hi ${firstName(name)},`;
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
/** Typed titles go into subjects on one line. */
const flat = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * The letter for a password link the club issued. Admins do not pay, and Social is free until the club accepts
 * someone, so only a club member who may pay is told the rate, with the first month's price.
 */
export function passwordLetterFor({ member, purpose, token, expiresAt }: PasswordLink, siteUrl: string): Letter {
  return passwordLetter({
    name: member.name,
    email: member.email,
    purpose,
    link: welcomeUrl(siteUrl, token),
    expiresAt,
    rate: member.role === 'admin' || !member.clubApproved ? null : joiningRate,
    welcomeTo: member.clubApproved ? 'club' : 'social',
  });
}

/**
 * An invitation for someone without a password, or a reset for a member who has one. Someone who joined the social
 * site from an invite, and has not been accepted into the club, is finishing joining: their first link says that and
 * nothing about paying.
 */
export function passwordLetter(link: { email: string; name: string; purpose: LinkPurpose; link: string; expiresAt: string; rate: string | null; welcomeTo: JoinedVia }): Letter {
  const until = formatDay(link.expiresAt);
  if (link.purpose === 'welcome' && link.welcomeTo === 'social') {
    return {
      to: link.email,
      subject: 'Set a password to finish joining',
      lines: [
        hi(link.name),
        `You joined ${site.name} Social. Set a password and your profile goes live.`,
        { href: link.link, label: 'Set your password' },
        `The link works once and runs out on ${until}. If it does, ask for a new one on the sign-in page.`,
        'Social is free. There is nothing to pay.',
        "Didn't join? Ignore this email. Without a password, the account never goes live.",
      ],
    };
  }
  if (link.purpose === 'welcome') {
    return {
      to: link.email,
      from: fromHost,
      subject: 'Your invitation to the club',
      lines: [
        hi(link.name),
        "Your membership is ready. All that's left is a password.",
        { href: link.link, label: 'Set your password' },
        `The link works once and runs out on ${until}. If it does, ask for a new one on the sign-in page.`,
        link.rate
          ? `${link.rate} You pay straight after setting your password, and you can stop any time.`
          : "You're an admin, so there's nothing to pay.",
        "What we'll email you: replies to what you post in the community, reminders for sessions you sign up for, and anything about your membership. Nothing else unless you ask for it.",
        'Questions? Reply to this email. It comes straight to me.',
        site.host,
      ],
    };
  }
  return {
    to: link.email,
    subject: 'Reset your password',
    lines: [
      hi(link.name),
      'Someone, hopefully you, asked to reset your password.',
      { href: link.link, label: 'Choose a new password' },
      `The link works once, until ${until}. A new password signs you out on your other devices.`,
      "Didn't ask for this? Ignore this email and nothing changes.",
    ],
  };
}

/**
 * Tells someone who already uses the social site that the club accepted their request. Their account is the club
 * account too, so the letter asks only for the payment.
 */
export function clubApprovedLetter(to: { email: string; name: string; rate: string; payUrl: string }): Letter {
  return {
    to: to.email,
    from: fromHost,
    subject: 'You can join the club now',
    lines: [
      hi(to.name),
      'We read your request, and you are in. You sign in to the club with the account you use on Social, so there is nothing new to set up.',
      `${to.rate} Pay, and the members' area opens straight after.`,
      { href: to.payUrl, label: 'Pay for membership' },
      'Social stays free whatever you decide.',
      'Questions? Reply to this email. It comes straight to me.',
      site.host,
    ],
  };
}

/** Asks someone who signed up for the free newsletter to confirm the address is theirs. Nothing goes to it until they do. */
export function newsletterConfirmLetter(to: { email: string; link: string; expiresAt: string }): Letter {
  return {
    to: to.email,
    subject: 'Confirm your email for the newsletter',
    lines: [
      `Someone, hopefully you, signed up for the newsletter from ${site.name} with this address. Confirm it and you're on the list.`,
      { href: to.link, label: 'Yes, send me the newsletter' },
      `The link works until ${formatDay(to.expiresAt)}. After that, subscribe again on the site and we'll send a new one.`,
      "Didn't subscribe? Ignore this email. We won't write again.",
    ],
  };
}

/** Tells the admins a request has come in. Only ever sent to them, never to the address typed into the form. */
export function joinRequestLetter(admins: readonly string[], request: Pick<JoinRequest, 'name' | 'email' | 'stage'>, adminUrl: string): Letter {
  return {
    to: admins,
    subject: flat(`${request.name} wants to join`),
    lines: [`${request.name} (${request.email}) just asked to join. Where they are: ${request.stage}.`, { href: adminUrl, label: 'Review the request' }],
  };
}

/** One click on this stops the one kind of email, without signing in. Built on the site the settings link names. */
const unsubscribeUrl = (settingsUrl: string, to: Subscriber, list: List) => {
  const url = new URL('/unsubscribe', settingsUrl);
  url.searchParams.set('k', to.key);
  url.searchParams.set('list', list);
  return { url: url.href, list };
};

/** Tells a member someone replied to a post on the Floor that they wrote or replied to. */
export function replyLetter(to: Subscriber, reply: { title: string; by: string; url: string; settingsUrl: string }): Letter {
  return {
    to: to.email,
    unsubscribe: unsubscribeUrl(reply.settingsUrl, to, 'replies'),
    subject: flat(`${firstName(reply.by)} replied to “${reply.title}”`),
    lines: [
      hi(to.name),
      `${reply.by} replied to “${reply.title}”.`,
      { href: reply.url, label: 'Read the reply' },
      "You're getting this because you wrote that post or replied to it. You'll hear about it at most once every six hours, however busy it gets.",
    ],
  };
}

export interface DigestNews {
  /** Posts on the Floor this week, each with its room's name and a link on the social host. */
  readonly posts: readonly { readonly title: string; readonly room: string; readonly replies: number; readonly url: string }[];
  readonly replies: number;
  readonly sessions: readonly { readonly title: string; readonly startsAt: string }[];
  readonly communityUrl: string;
  readonly sessionsUrl: string;
  readonly settingsUrl: string;
}

/** The week in the club, from a host. Only written when something happened or is coming up. */
export function digestLetter(to: Subscriber, news: DigestNews): Letter {
  const headline = [news.posts.length ? plural(news.posts.length, 'new post', 'new posts') : null, news.sessions.length ? plural(news.sessions.length, 'session', 'sessions') + ' coming up' : null]
    .filter(Boolean)
    .join(' and ');
  const posts: Line[] = news.posts.length
    ? ['New in the community:', ...news.posts.map((p): Line => ({ href: p.url, text: `${p.title} · ${p.room}, ${plural(p.replies, 'reply', 'replies')}` }))]
    : [];
  const replies: Line[] = news.replies ? [{ href: news.communityUrl, text: `${plural(news.replies, 'reply', 'replies')} across the community this week` }] : [];
  const sessions: Line[] = news.sessions.length
    ? ['Coming up:', ...news.sessions.map((s) => `${s.title}, ${formatMoment(s.startsAt)} Malaysia time`), { href: news.sessionsUrl, label: 'See the sessions' }]
    : [];
  return {
    to: to.email,
    from: fromHost,
    unsubscribe: unsubscribeUrl(news.settingsUrl, to, 'digest'),
    subject: `This week: ${headline || 'news from the club'}`,
    lines: [hi(to.name), "Here's the week in the club, in case you missed it.", ...posts, ...replies, ...sessions, "You're getting this because you turned on the Monday email.", site.host],
  };
}

/**
 * Sent once, when a member's first payment goes through: what the club holds for them, as the steps the members'
 * home then tracks. From the host, so a reply reaches a person.
 */
export function welcomeLetter(to: Recipient, siteUrl: string): Letter {
  const url = (path: string) => new URL(path, siteUrl).href;
  return {
    to: to.email,
    from: fromHost,
    subject: "You're in.",
    lines: [
      hi(to.name),
      `Your membership is live. ${capitalised(numberWord(FIRST_STEPS.length))} steps get the most out of it:`,
      { steps: FIRST_STEPS.map((step) => ({ title: firstSteps[step].label, detail: firstSteps[step].detail, href: url(firstSteps[step].path) })) },
      { href: url('/members'), label: 'Open your dashboard' },
      { href: `https://${cpeHost}`, text: 'Also yours: CPE credit for listening to the episodes.' },
      'Questions? Reply to this email. It comes straight to me.',
      site.host,
    ],
  };
}

export interface Onboarding {
  /** The next few sessions, soonest first. The job sends nothing until there is at least one to name. */
  readonly sessions: readonly { readonly title: string; readonly startsAt: string }[];
  readonly sessionsUrl: string;
  readonly settingsUrl: string;
}

/**
 * The getting-started emails, from a host. Each leads to one thing, a first live session, and names the real ones
 * coming up. They stop once the member says they are coming to a session.
 */
export function onboardingLetter(to: Subscriber, step: OnboardingStep, news: Onboarding): Letter {
  const coming = news.sessions.map((s) => `${s.title}, ${formatMoment(s.startsAt)} Malaysia time`);
  const body: Record<OnboardingStep, { readonly subject: string; readonly lines: readonly Line[] }> = {
    0: {
      subject: 'Your first live session',
      lines: [
        'The quickest way to get something out of the club is to come to one live session, with a real problem from your practice.',
        'Coming up:',
        ...coming,
        { href: news.sessionsUrl, label: 'Save your seat' },
        "Say you're coming and you'll get a calendar invite now and a reminder the day before.",
        "You're getting this because you joined recently. I'll send at most two more short notes about sessions, then stop. Book one and they stop sooner.",
      ],
    },
    1: {
      subject: 'Which session to start with',
      lines: [
        `Not sure which session to come to first? There are ${numberWord(week.sessions.length)} kinds:`,
        ...week.sessions.map((k) => `${k.term}: ${k.detail}`),
        'Coming up:',
        ...coming,
        { href: news.sessionsUrl, label: 'Pick a session' },
        "You're getting this because you haven't booked a session yet.",
      ],
    },
    2: {
      subject: 'Do any of these times work?',
      lines: [
        "This is my last note about sessions. Here's what's on:",
        ...coming,
        { href: news.sessionsUrl, label: 'Save your seat' },
        "If none of the times suit you, reply and tell me when would. It comes straight to me, and it shapes when we hold the next ones.",
      ],
    },
  };
  return {
    to: to.email,
    from: fromHost,
    unsubscribe: unsubscribeUrl(news.settingsUrl, to, 'onboarding'),
    subject: body[step].subject,
    lines: [hi(to.name), ...body[step].lines, site.host],
  };
}

export type SessionNews = 'confirmed' | 'reminder' | 'cancelled';

/** About a session members said they would come to, one letter each. The confirmation and the cancellation carry a calendar file. */
export function sessionLetters(news: SessionNews, session: LiveSession, members: readonly Recipient[], siteUrl: string): Letter[] {
  const when = `${formatMoment(session.startsAt)} Malaysia time (${session.minutes} minutes)`;
  const sessionsUrl = new URL('/members/sessions', siteUrl).href;
  const body = {
    confirmed: {
      subject: `You're down for ${session.title}`,
      lines: [`See you on ${when}.`, 'The calendar invite is attached. The call link is in it, and here:', { href: session.link, label: 'Join the call' }, { href: sessionsUrl, text: "Can't make it after all? Change it on the sessions page." }],
    },
    reminder: {
      subject: `Starting soon: ${session.title}`,
      lines: [`${session.title} starts ${when}.`, { href: session.link, label: 'Join the call' }, "You're getting this because you said you're coming."],
    },
    cancelled: {
      subject: `Cancelled: ${session.title}`,
      lines: [`Sorry, ${session.title} on ${when} is off.`, 'The attached file takes it out of your calendar. The next sessions are on the sessions page.', { href: sessionsUrl, label: 'See the sessions' }],
    },
  } as const satisfies Record<SessionNews, { subject: string; lines: readonly Line[] }>;
  const { subject, lines } = body[news];
  const attachments = news === 'reminder' ? null : [{ filename: 'session.ics', type: 'text/calendar; charset=utf-8', content: calendarFile(sessionEvent(session), news === 'cancelled') }];
  return members.map((to) => {
    const letter = { to: to.email, subject: flat(subject), lines: [hi(to.name), ...lines] };
    return attachments ? { ...letter, attachments } : letter;
  });
}

/** What a member did in the term being renewed, in the words of a sentence. Null when they did none of it. */
const recapOf = (term: Term, counts: Readonly<Record<ActivityKind, number>>): string | null => {
  const parts: string[] = [];
  if (counts.session) parts.push(`said yes to ${tally(counts.session, 'session')}`);
  if (counts.post) parts.push(`posted ${tally(counts.post, 'time')}`);
  if (counts.lesson) parts.push(`finished ${tally(counts.lesson, 'lesson')}`);
  if (counts.call) parts.push(`booked ${tally(counts.call, 'call')}`);
  if (counts.plan) parts.push('worked on your plan');
  return parts.length ? `In your last ${term} you ${listOf(parts)}.` : null;
};

/**
 * A saved card is about to be charged for a long term: when, how much, what the member got from the last one, what is
 * coming up, and how to stop it first.
 */
export function renewalNoticeLetter(
  to: Recipient,
  notice: {
    term: Term;
    chargesAt: string;
    accountUrl: string;
    counts: Readonly<Record<ActivityKind, number>>;
    upcoming: readonly { readonly title: string; readonly startsAt: string }[];
  },
): Letter {
  const date = formatDay(notice.chargesAt);
  const recap = recapOf(notice.term, notice.counts);
  return {
    to: to.email,
    subject: `Your membership renews on ${date}`,
    lines: [
      hi(to.name),
      `On ${date} we renew your membership for another ${notice.term} and charge ${terms[notice.term].price} to the card you saved.`,
      ...(recap ? [recap] : []),
      ...(notice.upcoming.length ? ['Coming up:', ...notice.upcoming.map((s) => `${s.title}, ${formatMoment(s.startsAt)}`)] : []),
      `Nothing to do if that suits you. To stop it, turn renewal off on your account page before ${date}. You keep access to the end of what you paid for, and can pay by the month after that.`,
      { href: notice.accountUrl, label: 'Open your account' },
      `You're getting this because a ${notice.term}'s charge is worth a warning.`,
    ],
  };
}

/** Tells the admins a member turned renewal off, with what they said about why. Only ever sent to them. */
export function renewalOffLetter(
  admins: readonly string[],
  stop: { readonly name: string; readonly paidUntil: string; readonly reason: StopReason | null; readonly note: string | null },
  memberUrl: string,
): Letter {
  return {
    to: admins,
    subject: `${flat(stop.name)} turned renewal off`,
    lines: [
      `${stop.name} turned renewal off. They keep access until ${formatDay(stop.paidUntil)}.`,
      stop.reason ? `Reason: ${stopReasonLabel[stop.reason]}.` : 'No reason given.',
      ...(stop.note ? [`They wrote: ${stop.note}`] : []),
      { href: memberUrl, label: 'Open their page' },
    ],
  };
}

/** A card renewal did not go through. The member keeps access through the grace period while it is retried. */
export function renewalLetter(to: Recipient, failure: { term: Term; cardRefused: boolean; accessUntil: string; payUrl: string }): Letter {
  const tried = `We tried to charge your card ${terms[failure.term].price} for your next ${failure.term}`;
  return {
    to: to.email,
    subject: "Your membership payment didn't go through",
    lines: [
      hi(to.name),
      failure.cardRefused
        ? `${tried}, but the card can't be charged any more. It may have expired or been replaced.`
        : `${tried}, but the payment was declined. We'll try the same card again tomorrow.`,
      `Nothing changes yet: you keep full access until ${formatDay(failure.accessUntil)}.`,
      { href: failure.payUrl, label: 'Pay now' },
      "If you meant to leave, you don't need to do anything.",
    ],
  };
}

/** A member who pays by hand: the term they paid for ends soon. */
export function paymentDueLetter(to: Recipient, due: { term: Term; paidUntil: string; payUrl: string }): Letter {
  const date = formatDay(due.paidUntil);
  return {
    to: to.email,
    subject: `Your paid ${due.term} ends on ${date}`,
    lines: [
      hi(to.name),
      `Your paid ${due.term} ends on ${date}. To keep going, pay for the next one (${terms[due.term].label}) any time before then.`,
      { href: due.payUrl, label: `Pay for next ${due.term}` },
      `You can change between paying by the ${TERMS.join(' and by the ')} on the same page.`,
      'Not staying? No need to reply. Your access ends a few days after that date.',
    ],
  };
}

/** For admins: what failed since the last summary, so nothing goes wrong unseen. */
export function incidentsLetter(admins: readonly string[], incidents: readonly { at: string; kind: string; detail: string }[], adminUrl: string): Letter {
  const shown = incidents.slice(0, 50);
  return {
    to: admins,
    subject: `${plural(incidents.length, 'thing', 'things')} went wrong on the site`,
    lines: [
      "Here's what failed since the last summary. Each one is in the Cloudflare logs too.",
      ...shown.map((i) => `${formatMoment(i.at)} · ${i.kind} · ${i.detail}`),
      ...(incidents.length > shown.length ? [`And ${incidents.length - shown.length} more.`] : []),
      { href: adminUrl, label: 'Open the admin page' },
    ],
  };
}
