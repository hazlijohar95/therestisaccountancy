import { SESSION_KINDS, type SessionKind } from '../data/sessions.ts';
import { STATUS_SQL } from './club.ts';
import { integer, oneOf, text, type Db, type Row } from './db.ts';
import { toRecipient, type Recipient } from './mailings.ts';

/** A live session on the calendar, as one member sees it. */
export interface LiveSession {
  readonly id: number;
  readonly title: string;
  readonly kind: SessionKind;
  readonly startsAt: string;
  readonly minutes: number;
  /** Where it happens: the video call. Shown only to members. */
  readonly link: string;
  readonly detail: string;
  readonly going: number;
  readonly attending: boolean;
}

export interface NewSession {
  readonly title: string;
  readonly kind: SessionKind;
  readonly startsAt: string;
  readonly minutes: number;
  readonly link: string;
  readonly detail: string;
}

/** A session together with the members who said they are coming. */
export interface Roll {
  readonly session: LiveSession;
  readonly attendees: readonly Recipient[];
}

/** Reminders go out once a session is this close. */
export const REMINDER_LEAD_MS = 24 * 3_600_000;

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const NOT_OVER = `cancelled_at IS NULL AND julianday(starts_at) + minutes / 1440.0 > julianday(?)`;

/** Upcoming live sessions, who is coming, and the reminders owed. */
export function createSchedule(db: Db, now: () => Date = () => new Date()) {
  const columns = (memberId: number | null) =>
    `s.*, (SELECT count(*) FROM rsvps r WHERE r.session_id = s.id) AS going,
     EXISTS (SELECT 1 FROM rsvps r WHERE r.session_id = s.id AND r.member_id = ${memberId === null ? 'NULL' : Number(memberId)}) AS attending`;

  const toSession = (row: Row): LiveSession => ({
    id: integer(row, 'id'),
    title: text(row, 'title'),
    kind: oneOf(row, 'kind', SESSION_KINDS),
    startsAt: text(row, 'starts_at'),
    minutes: integer(row, 'minutes'),
    link: text(row, 'link'),
    detail: text(row, 'detail'),
    going: integer(row, 'going'),
    attending: integer(row, 'attending') === 1,
  });

  const open = (id: number, memberId: number | null) => {
    const row = db.prepare(`SELECT ${columns(memberId)} FROM live_sessions s WHERE s.id = ? AND ${NOT_OVER}`).get(id, iso(now()));
    return row ? toSession(row) : null;
  };

  const attendees = (sessionId: number): Recipient[] =>
    db
      .prepare(`SELECT m.email, m.name FROM rsvps r JOIN members m ON m.id = r.member_id WHERE r.session_id = ? AND ${STATUS_SQL.active} ORDER BY r.created_at`)
      .all(sessionId)
      .map(toRecipient);

  const upcoming = (memberId: number | null): LiveSession[] =>
    db.prepare(`SELECT ${columns(memberId)} FROM live_sessions s WHERE ${NOT_OVER} ORDER BY s.starts_at, s.id`).all(iso(now())).map(toSession);

  return {
    /** Sessions not yet over, soonest first. A session counts until it ends, so one in progress still shows. */
    upcoming,

    /** The sessions still to come, each with the active members coming, for the admin. */
    rolls(): Roll[] {
      return upcoming(null).map((session) => ({ session, attendees: attendees(session.id) }));
    },

    session: (id: number, memberId: number | null) => open(id, memberId),

    add(input: NewSession): number {
      return db
        .prepare('INSERT INTO live_sessions (title, kind, starts_at, minutes, link, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(input.title, input.kind, input.startsAt, input.minutes, input.link, input.detail, iso(now())).lastInsertRowid;
    },

    /** Calls a session off. The members who were coming are returned to be told. Null if it was already over or off. */
    cancel(id: number): Roll | null {
      return db.transaction(() => {
        const session = open(id, null);
        if (!session) return null;
        db.prepare('UPDATE live_sessions SET cancelled_at = ? WHERE id = ?').run(iso(now()), id);
        return { session, attendees: attendees(id) };
      });
    },

    /**
     * Says a member is coming, or not. Returns the session and whether this changed anything, so a confirmation goes
     * out once. Null when the session is over, called off or unknown.
     */
    rsvp(memberId: number, sessionId: number, going: boolean): { readonly session: LiveSession; readonly changed: boolean } | null {
      return db.transaction(() => {
        if (!open(sessionId, memberId)) return null;
        const changed = going
          ? db.prepare('INSERT INTO rsvps (session_id, member_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(sessionId, memberId, iso(now())).changes
          : db.prepare('DELETE FROM rsvps WHERE session_id = ? AND member_id = ?').run(sessionId, memberId).changes;
        const session = open(sessionId, memberId);
        if (!session) throw new Error(`Session ${sessionId} vanished`);
        return { session, changed: changed > 0 };
      });
    },

    /** Sessions starting within a day that have not been reminded, now marked as reminded. A rerun finds none. */
    dueReminders(): Roll[] {
      return db.transaction(() => {
        const at = now();
        const rows = db
          .prepare(`SELECT ${columns(null)} FROM live_sessions s WHERE s.reminded_at IS NULL AND ${NOT_OVER} AND s.starts_at <= ?`)
          .all(iso(at), iso(new Date(at.getTime() + REMINDER_LEAD_MS)));
        const mark = db.prepare('UPDATE live_sessions SET reminded_at = ? WHERE id = ?');
        return rows.map((row) => {
          const session = toSession(row);
          mark.run(iso(at), session.id);
          return { session, attendees: attendees(session.id) };
        });
      });
    },

  };
}
