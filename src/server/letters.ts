import { site } from '../data/site.ts';
import { firstName, formatDay, formatMoment } from '../lib/format.ts';
import type { JoinRequest, LinkPurpose } from './club.ts';
import { calendarFile } from './calendar.ts';
import type { Recipient, Subscriber } from './mailings.ts';
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
export type Line = string | { readonly href: string; readonly label?: string; readonly text?: string };

/** One email, written once. The React Email template turns its lines into the HTML and the text part. */
export interface Letter {
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly lines: readonly Line[];
  /** The sender's display name, when a host sends it. The address is always the club's. */
  readonly from?: string;
  readonly attachments?: readonly { readonly filename: string; readonly type: string; readonly content: string }[];
  /** Where one click stops this kind of email. Sent as List-Unsubscribe too, so mail apps offer it. */
  readonly unsubscribe?: string;
}

const fromHost = `${site.host} from ${site.name}`;
const hi = (name: string) => `Hi ${firstName(name)},`;
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
/** Typed titles go into subjects on one line. */
const flat = (value: string) => value.replace(/\s+/g, ' ').trim();

/** An invitation for someone without a password, or a reset for a member who has one. */
export function passwordLetter(link: { email: string; name: string; purpose: LinkPurpose; link: string; expiresAt: string; rate: string | null }): Letter {
  const until = formatDay(link.expiresAt);
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
          ? `Membership is ${link.rate}. You pay the first month straight after setting your password, and you can stop any time.`
          : "You're an admin, so there's nothing to pay.",
        "What we'll email you: replies in threads you post in, reminders for sessions you sign up for, and anything about your membership. Nothing else unless you ask for it.",
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

/** Tells the admins a request has come in. Only ever sent to them, never to the address typed into the form. */
export function joinRequestLetter(admins: readonly string[], request: Pick<JoinRequest, 'name' | 'email' | 'stage'>, adminUrl: string): Letter {
  return {
    to: admins,
    subject: flat(`${request.name} wants to join`),
    lines: [`${request.name} (${request.email}) just asked to join. Where they are: ${request.stage}.`, { href: adminUrl, label: 'Review the request' }],
  };
}

/** One click on this stops the one kind of email, without signing in. Built on the site the settings link names. */
const unsubscribeUrl = (settingsUrl: string, to: Subscriber, list: 'replies' | 'digest') => {
  const url = new URL('/unsubscribe', settingsUrl);
  url.searchParams.set('k', to.key);
  url.searchParams.set('list', list);
  return url.href;
};

/** Tells a member someone replied in a thread they posted in. */
export function replyLetter(to: Subscriber, reply: { title: string; by: string; url: string; settingsUrl: string }): Letter {
  return {
    to: to.email,
    unsubscribe: unsubscribeUrl(reply.settingsUrl, to, 'replies'),
    subject: flat(`${firstName(reply.by)} replied to “${reply.title}”`),
    lines: [
      hi(to.name),
      `${reply.by} replied in “${reply.title}”.`,
      { href: reply.url, label: 'Read the reply' },
      "You're getting this because you posted in that thread. You'll hear about it at most once every six hours, however busy it gets.",
    ],
  };
}

export interface DigestNews {
  readonly threads: readonly { readonly title: string; readonly channel: string; readonly replies: number; readonly url: string }[];
  readonly replies: number;
  readonly sessions: readonly { readonly title: string; readonly startsAt: string }[];
  readonly communityUrl: string;
  readonly sessionsUrl: string;
  readonly settingsUrl: string;
}

/** The week in the club, from a host. Only written when something happened or is coming up. */
export function digestLetter(to: Subscriber, news: DigestNews): Letter {
  const headline = [news.threads.length ? plural(news.threads.length, 'new thread', 'new threads') : null, news.sessions.length ? plural(news.sessions.length, 'session', 'sessions') + ' coming up' : null]
    .filter(Boolean)
    .join(' and ');
  const threads: Line[] = news.threads.length
    ? ['New in the community:', ...news.threads.map((t): Line => ({ href: t.url, text: `${t.title} · ${t.channel}, ${plural(t.replies, 'reply', 'replies')}` }))]
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
    lines: [hi(to.name), "Here's the week in the club, in case you missed it.", ...threads, ...replies, ...sessions, "You're getting this because you turned on the Monday email.", site.host],
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
  const attachments = news === 'reminder' ? null : [{ filename: 'session.ics', type: 'text/calendar; charset=utf-8', content: calendarFile(session, new URL(siteUrl).hostname, news === 'cancelled') }];
  return members.map((to) => {
    const letter = { to: to.email, subject: flat(subject), lines: [hi(to.name), ...lines] };
    return attachments ? { ...letter, attachments } : letter;
  });
}

/** A monthly card renewal did not go through. The member keeps access through the grace period while it is retried. */
export function renewalLetter(to: Recipient, failure: { cardRefused: boolean; accessUntil: string; payUrl: string }): Letter {
  return {
    to: to.email,
    subject: "Your membership payment didn't go through",
    lines: [
      hi(to.name),
      failure.cardRefused
        ? "We tried to renew your membership, but your card can't be charged any more. It may have expired or been replaced."
        : "We tried to renew your membership, but the payment was declined. We'll try the same card again tomorrow.",
      `Nothing changes yet: you keep full access until ${formatDay(failure.accessUntil)}.`,
      { href: failure.payUrl, label: 'Pay now' },
      "If you meant to leave, you don't need to do anything.",
    ],
  };
}

/** A member who pays by hand: their month ends soon. */
export function paymentDueLetter(to: Recipient, due: { paidUntil: string; rate: string; payUrl: string }): Letter {
  const date = formatDay(due.paidUntil);
  return {
    to: to.email,
    subject: `Your month ends on ${date}`,
    lines: [
      hi(to.name),
      `Your paid month ends on ${date}. To keep going, pay for the next one (${due.rate}) any time before then.`,
      { href: due.payUrl, label: 'Pay for next month' },
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
