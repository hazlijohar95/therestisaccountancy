import { site } from '../data/site.ts';
import { firstName, formatMoment } from '../lib/format.ts';
import { calendarFile, type CalendarEvent } from './calendar.ts';
import { attempt, count, integer, oneOf, optionalText, text, type Db, type Param, type Row } from './db.ts';
import type { Letter, Line } from './letters.ts';
import type { Recipient } from './mailings.ts';
import type { Result } from './result.ts';
import { REMINDER_LEAD_MS } from './schedule.ts';

export const SLOT_STATES = ['open', 'booked', 'cancelled', 'over'] as const;
export type SlotState = (typeof SLOT_STATES)[number];

/** Booking closes this long before a call starts, and a member who cancels later than this gives the slot up. */
export const BOOKING_CLOSES_MS = 2 * 3_600_000;
/** How long a call can run, in minutes. */
export const CALL_MINUTES = { min: 15, max: 60 } as const;
/** The most a member can write about what they are stuck on. */
export const TOPIC_MAX = 500;

/** Who booked a slot, and what they want help with. */
export interface Booking {
  readonly member: Recipient;
  readonly topic: string;
  readonly bookedAt: string;
}

interface Times {
  readonly id: number;
  readonly startsAt: string;
  readonly minutes: number;
  readonly link: string;
}

/** A slot in each of its states. The state is derived from the row and the clock, in SLOT below, and never stored. */
export type Slot =
  | (Times & { readonly state: 'open'; readonly host: Recipient })
  | (Times & { readonly state: 'booked'; readonly host: Recipient; readonly booking: Booking })
  | (Times & { readonly state: 'over'; readonly host: Recipient; readonly booking: Booking | null })
  | (Times & { readonly state: 'cancelled'; readonly host: Recipient | null; readonly booking: Booking | null });

/** A booked call that has not ended. Its link is for the host and the member who booked it, no one else. */
export type Call = Extract<Slot, { state: 'booked' }>;
/** What the hosts look after: slots still to come, open or booked. */
export type UpcomingSlot = Extract<Slot, { state: 'open' | 'booked' }>;

/** A slot as members see it before booking: when, for how long and with whom. Never the call link. */
export interface OpenSlot {
  readonly id: number;
  readonly startsAt: string;
  readonly minutes: number;
  readonly host: string;
}

export interface NewSlot {
  readonly startsAt: string;
  readonly minutes: number;
  readonly link: string;
}

export type AddRefusal = 'too-soon' | 'overlaps';
export type BookRefusal = 'closed' | 'taken' | 'own-slot' | 'one-at-a-time';

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const later = (at: Date, ms: number) => new Date(at.getTime() + ms);

/**
 * Every slot with its state, the one place the state is worked out. A slot without a host is off. A booked slot
 * stays booked until the call ends. An unbooked one is open until booking closes, then over. Binds two instants
 * first, in this order: now, then the moment booking closes for a call starting now.
 */
const SLOT = `WITH slot AS (
  SELECT s.id, s.starts_at, s.minutes, s.link, s.host_id, s.booked_by, s.booked_at, s.topic, s.reminded_at,
    h.name AS host_name, h.email AS host_email, b.name AS member_name, b.email AS member_email,
    CASE
      WHEN s.cancelled_at IS NOT NULL OR s.host_id IS NULL THEN 'cancelled'
      WHEN s.booked_by IS NOT NULL THEN
        CASE WHEN strftime('%Y-%m-%dT%H:%M:%SZ', s.starts_at, printf('+%d minutes', s.minutes)) > ? THEN 'booked' ELSE 'over' END
      WHEN s.starts_at > ? THEN 'open'
      ELSE 'over'
    END AS state
  FROM call_slots s
  LEFT JOIN members h ON h.id = s.host_id
  LEFT JOIN members b ON b.id = s.booked_by
)`;
const clock = (at: Date): [string, string] => [iso(at), iso(later(at, BOOKING_CLOSES_MS))];

const toSlot = (row: Row): Slot => {
  const times = { id: integer(row, 'id'), startsAt: text(row, 'starts_at'), minutes: integer(row, 'minutes'), link: text(row, 'link') };
  const hostName = optionalText(row, 'host_name');
  const host = hostName === null ? null : { name: hostName, email: text(row, 'host_email') };
  const memberName = optionalText(row, 'member_name');
  const booking = memberName === null ? null : { member: { name: memberName, email: text(row, 'member_email') }, topic: text(row, 'topic'), bookedAt: text(row, 'booked_at') };
  const state = oneOf(row, 'state', SLOT_STATES);
  if (state === 'cancelled') return { ...times, state, host, booking };
  if (!host) throw new TypeError(`Slot ${times.id} is ${state} without a host`);
  if (state === 'open') return { ...times, state, host };
  if (state === 'over') return { ...times, state, host, booking };
  if (!booking) throw new TypeError(`Slot ${times.id} is booked without a booker`);
  return { ...times, state, host, booking };
};

const toCall = (row: Row): Call => {
  const slot = toSlot(row);
  if (slot.state !== 'booked') throw new TypeError(`Slot ${slot.id} is ${slot.state}, not booked`);
  return slot;
};

const isUpcoming = (slot: Slot): slot is UpcomingSlot => slot.state === 'open' || slot.state === 'booked';

const malaysianDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });

/** Slots grouped by their date in Malaysia, as YYYY-MM-DD, keeping their order. */
export function byDay<T extends { readonly startsAt: string }>(slots: readonly T[]): { readonly date: string; readonly slots: readonly T[] }[] {
  const days: { date: string; slots: T[] }[] = [];
  for (const slot of slots) {
    const date = malaysianDate.format(new Date(slot.startsAt));
    const last = days.at(-1);
    if (last?.date === date) last.slots.push(slot);
    else days.push({ date, slots: [slot] });
  }
  return days;
}

/** One-to-one call slots the hosts open and members book. */
export function createCalls(db: Db, now: () => Date = () => new Date()) {
  const read = (where: string, at: Date, ...params: Param[]): Row[] =>
    db.prepare(`${SLOT} SELECT * FROM slot WHERE ${where} ORDER BY starts_at, id`).all(...clock(at), ...params);

  const bookedBy = (memberId: number, slotId: number, at: Date) => {
    const [row] = read(`id = ? AND booked_by = ? AND state = 'booked'`, at, slotId, memberId);
    return row ? toCall(row) : null;
  };

  return {
    /** Slots a member can book, soonest first. A host never sees their own here. */
    open(viewerId: number): OpenSlot[] {
      return read(`state = 'open' AND host_id != ?`, now(), viewerId).map((row) => ({
        id: integer(row, 'id'),
        startsAt: text(row, 'starts_at'),
        minutes: integer(row, 'minutes'),
        host: text(row, 'host_name'),
      }));
    },

    /** The member's call, from booking until it ends. Null when they hold none. */
    booking(memberId: number): Call | null {
      const [row] = read(`state = 'booked' AND booked_by = ?`, now(), memberId);
      return row ? toCall(row) : null;
    },

    upcoming(): UpcomingSlot[] {
      return read(`state IN ('open', 'booked')`, now()).map(toSlot).filter(isUpcoming);
    },

    /** The call link a host used last, to start their next slot with. */
    lastLink(hostId: number): string | null {
      const row = db.prepare('SELECT link FROM call_slots WHERE host_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(hostId);
      return row ? text(row, 'link') : null;
    },

    /** Opens a slot. Refused when booking would already be closed, or when it overlaps one the host already has. */
    add(hostId: number, slot: NewSlot): Result<number, AddRefusal> {
      return attempt<number, AddRefusal>(db, (refuse) => {
        const at = now();
        const start = new Date(slot.startsAt);
        if (start.getTime() <= later(at, BOOKING_CLOSES_MS).getTime()) refuse('too-soon');
        const id = db
          .prepare('INSERT INTO call_slots (host_id, starts_at, minutes, link, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(hostId, iso(start), slot.minutes, slot.link, iso(at)).lastInsertRowid;
        const overlapping = db.prepare(
          `${SLOT} SELECT count(*) AS n FROM slot WHERE host_id = ? AND id != ? AND state IN ('open', 'booked')
           AND starts_at < ? AND strftime('%Y-%m-%dT%H:%M:%SZ', starts_at, printf('+%d minutes', minutes)) > ?`,
        );
        if (count(overlapping.get(...clock(at), hostId, id, iso(later(start, slot.minutes * 60_000)), iso(start))) > 0) refuse('overlaps');
        return id;
      });
    },

    /**
     * Books an open slot, with what the member is stuck on. Both rules are checked after the write, so of two members
     * racing for one slot only one gets it, and a member never ends up holding two calls. Booking the slot you already
     * hold changes nothing. A call booked within a day of its start gets no reminder: the confirmation has just gone.
     */
    book(memberId: number, slotId: number, topic: string): Result<{ readonly call: Call; readonly changed: boolean }, BookRefusal> {
      return attempt<{ call: Call; changed: boolean }, BookRefusal>(db, (refuse) => {
        const at = now();
        if (db.prepare('SELECT 1 FROM call_slots WHERE id = ? AND host_id = ?').get(slotId, memberId)) refuse('own-slot');
        const { changes } = db
          .prepare(
            `${SLOT} UPDATE call_slots SET booked_by = ?, booked_at = ?, topic = ?, reminded_at = CASE WHEN starts_at <= ? THEN ? END
             WHERE id = ? AND id IN (SELECT id FROM slot WHERE state = 'open')`,
          )
          .run(...clock(at), memberId, iso(at), topic, iso(later(at, REMINDER_LEAD_MS)), iso(at), slotId);
        if (changes === 0) {
          const held = bookedBy(memberId, slotId, at);
          if (held) return { call: held, changed: false };
          const [row] = read('id = ?', at, slotId);
          return refuse(row && oneOf(row, 'state', SLOT_STATES) === 'booked' ? 'taken' : 'closed');
        }
        if (count(db.prepare(`${SLOT} SELECT count(*) AS n FROM slot WHERE booked_by = ? AND state = 'booked'`).get(...clock(at), memberId)) > 1) refuse('one-at-a-time');
        const call = bookedBy(memberId, slotId, at);
        if (!call) throw new Error(`Slot ${slotId} was booked and then was not`);
        return { call, changed: true };
      });
    },

    /** The member gives up their call. The slot opens again unless booking for it has closed. The call is returned for the host's letter. */
    cancelBooking(memberId: number, slotId: number): Result<Call, 'not-booked'> {
      return attempt<Call, 'not-booked'>(db, (refuse) => {
        const call = bookedBy(memberId, slotId, now());
        if (!call) return refuse('not-booked');
        db.prepare('UPDATE call_slots SET booked_by = NULL, booked_at = NULL, topic = NULL, reminded_at = NULL WHERE id = ?').run(slotId);
        return call;
      });
    },

    /** A host calls a slot off. Returns the booked call, so its member can be told, or null when nobody had booked it. */
    cancelSlot(slotId: number): Result<Call | null, 'not-upcoming'> {
      return attempt<Call | null, 'not-upcoming'>(db, (refuse) => {
        const at = now();
        const [row] = read(`id = ? AND state IN ('open', 'booked')`, at, slotId);
        if (!row) return refuse('not-upcoming');
        const slot = toSlot(row);
        db.prepare('UPDATE call_slots SET cancelled_at = ? WHERE id = ?').run(iso(at), slotId);
        return slot.state === 'booked' ? slot : null;
      });
    },

    /** Booked calls starting within a day that have not been reminded, now marked as reminded. A rerun finds none. */
    dueReminders(): Call[] {
      return db.transaction(() => {
        const at = now();
        const rows = read(`state = 'booked' AND reminded_at IS NULL AND starts_at > ? AND starts_at <= ?`, at, iso(at), iso(later(at, REMINDER_LEAD_MS)));
        const mark = db.prepare('UPDATE call_slots SET reminded_at = ? WHERE id = ?');
        return rows.map((row) => {
          const call = toCall(row);
          mark.run(iso(at), call.id);
          return call;
        });
      });
    },
  };
}

type Side = 'member' | 'host';

/**
 * A call as an event in one side's calendar. Each booking has its own UID, never a session's, so cancelling one
 * booking cannot hide the next booking of the same slot in a host's calendar.
 */
export function callEvent(call: Call, side: Side, host: string): CalendarEvent {
  const { member, topic, bookedAt } = call.booking;
  return {
    uid: `call-${call.id}-${bookedAt.replace(/\D/g, '')}@${host}`,
    title: `One-to-one with ${side === 'member' ? call.host.name : member.name}`,
    startsAt: call.startsAt,
    minutes: call.minutes,
    description: side === 'member' ? `What you are stuck on: ${topic}` : `${member.name} is stuck on: ${topic}`,
    link: call.link,
  };
}

export type CallNews = 'booked' | 'reminder' | 'cancelled-by-member' | 'cancelled-by-host';

interface Draft {
  readonly subject: string;
  readonly lines: readonly Line[];
  /** The calendar file it carries: the event, or the notice that takes it out again. */
  readonly calendar?: 'add' | 'remove';
}

const hi = (name: string) => `Hi ${firstName(name)},`;
const flat = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * The letters about a call, to whichever side needs to know: both on booking and the day before, the host when the
 * member cancels, the member when a host does. What the member wrote stays typed text, and never goes in a subject.
 */
export function callLetters(news: CallNews, call: Call, siteUrl: string): Letter[] {
  const url = (path: string) => new URL(path, siteUrl).href;
  const { member, topic } = call.booking;
  const host = call.host;
  const at = formatMoment(call.startsAt);
  const when = `${at} Malaysia time, for ${call.minutes} minutes`;
  const join: Line = { href: call.link, label: 'Join the call' };
  const quoted = `“${topic}”`;
  const drafts: Record<CallNews, Partial<Record<Side, Draft>>> = {
    booked: {
      member: {
        subject: `Booked: your call with ${firstName(host.name)} on ${at}`,
        lines: [
          `You're booked in with ${host.name} on ${when}.`,
          `${firstName(host.name)} has what you wrote, so you can start straight in:`,
          quoted,
          'The calendar invite is attached. The call link is in it, and here:',
          join,
          { href: url('/members/calls'), text: "Can't make it after all? Cancel on the one-to-one page, and the time goes back for someone else." },
        ],
        calendar: 'add',
      },
      host: {
        subject: `${member.name} booked a call with you on ${at}`,
        lines: [`${member.name} (${member.email}) booked your one-to-one on ${when}. What they are stuck on:`, quoted, 'The calendar invite is attached, with the call link.', { href: url('/admin/calls'), label: 'See your calls' }],
        calendar: 'add',
      },
    },
    reminder: {
      member: {
        subject: `Coming up: your call with ${firstName(host.name)}`,
        lines: [`Your call with ${host.name} is on ${when}.`, join, { href: url('/members/calls'), text: "Can't make it? Cancel on the one-to-one page, so the host knows." }, "You're getting this because you booked the call."],
      },
      host: {
        subject: `Coming up: your call with ${firstName(member.name)}`,
        lines: [`Your call with ${member.name} is on ${when}. What they are stuck on:`, quoted, join],
      },
    },
    'cancelled-by-member': {
      host: {
        subject: `Cancelled: ${member.name}'s call on ${at}`,
        lines: [`${member.name} can't make your call on ${when}, so it's off.`, 'The attached file takes it out of your calendar.', { href: url('/admin/calls'), label: 'See your calls' }],
        calendar: 'remove',
      },
    },
    'cancelled-by-host': {
      member: {
        subject: `Cancelled: your call with ${firstName(host.name)} on ${at}`,
        lines: [`Sorry, your call with ${host.name} on ${when} is off.`, 'The attached file takes it out of your calendar. If another time works, you can book it now.', { href: url('/members/calls'), label: 'Pick another time' }],
        calendar: 'remove',
      },
    },
  };
  const to: Record<Side, Recipient> = { member, host };
  const sides: readonly Side[] = ['member', 'host'];
  return sides.flatMap((side) => {
    const draft = drafts[news][side];
    if (!draft) return [];
    const letter: Letter = { to: to[side].email, subject: flat(draft.subject), lines: [hi(to[side].name), ...draft.lines] };
    const from = side === 'member' ? { from: `${firstName(host.name)} from ${site.name}` } : {};
    const attachments = draft.calendar
      ? { attachments: [{ filename: 'call.ics', type: 'text/calendar; charset=utf-8', content: calendarFile(callEvent(call, side, new URL(siteUrl).hostname), draft.calendar === 'remove') }] }
      : {};
    return [{ ...letter, ...from, ...attachments }];
  });
}
