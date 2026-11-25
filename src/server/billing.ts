import { STATUS_SQL } from './club.ts';
import { integer, oneOf, optionalText, text, type Db } from './db.ts';
import type { Recipient } from './mailings.ts';

/** Whether a member may use the members' area. Grace keeps a renewing member in for a few days past the paid month. */
export const ACCESS = ['paid', 'grace', 'unpaid'] as const;
export type Access = (typeof ACCESS)[number];

export interface Standing {
  readonly access: Access;
  /** The end of the month paid for. Null before the first payment. */
  readonly paidUntil: string | null;
  /** CHIP holds a card to charge each month. */
  readonly cardOnFile: boolean;
  /** The member means to carry on: a saved card is charged, otherwise they are reminded to pay. */
  readonly renews: boolean;
}

export type PaymentKind = 'checkout' | 'renewal';

/** A renewal to charge: the member and the card token CHIP saved at checkout. */
export interface Renewal extends Recipient {
  readonly memberId: number;
  readonly token: string;
  readonly paidUntil: string;
}

export const GRACE_MS = 3 * 86_400_000;
/** A renewal is charged this long before the paid month ends, and retried at most this often. */
const RENEW_AHEAD_MS = 12 * 3_600_000;
const RETRY_GAP_MS = 20 * 3_600_000;
/** Members who pay by hand are reminded this long before the paid month ends. */
export const PAY_REMINDER_LEAD_MS = 3 * 86_400_000;

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** One calendar month on: 31 January becomes 28 or 29 February, not 3 March. */
export function monthAfter(from: Date): Date {
  const next = new Date(from);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}

/** Who has paid for how long, the payments behind it, and the renewals owed. Money moves in CHIP; this records it. */
export function createBilling(db: Db, now: () => Date = () => new Date()) {
  const standing = (memberId: number): Standing => {
    const row = db.prepare('SELECT * FROM subscriptions WHERE member_id = ?').get(memberId);
    if (!row) return { access: 'unpaid', paidUntil: null, cardOnFile: false, renews: true };
    const paidUntil = text(row, 'paid_until');
    const until = new Date(paidUntil).getTime();
    const at = now().getTime();
    const cardOnFile = optionalText(row, 'card_token') !== null;
    const renews = integer(row, 'renews') === 1;
    const grace = renews ? GRACE_MS : 0;
    return { access: until > at ? 'paid' : until + grace > at ? 'grace' : 'unpaid', paidUntil, cardOnFile, renews };
  };

  return {
    standing,
    access: (memberId: number): Access => standing(memberId).access,

    /** Notes a purchase made in CHIP for a member, before they pay it. */
    opened(purchaseId: string, memberId: number, kind: PaymentKind, amount: number): void {
      db.prepare('INSERT INTO payments (purchase_id, member_id, kind, amount, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (purchase_id) DO NOTHING').run(
        purchaseId,
        memberId,
        kind,
        amount,
        iso(now()),
      );
    },

    /** The member's most recent purchase of a kind still waiting to be paid, to ask CHIP about before acting again. */
    unpaid(memberId: number, kind: PaymentKind): string | null {
      const row = db.prepare(`SELECT purchase_id FROM payments WHERE member_id = ? AND kind = ? AND status = 'created' ORDER BY created_at DESC LIMIT 1`).get(memberId, kind);
      return row ? text(row, 'purchase_id') : null;
    },

    /**
     * Records a purchase CHIP says is paid: a month added from the later of now and the end of the month paid for. A
     * paid checkout that saved the card keeps its id as the token for renewals. A second report of the same payment
     * changes nothing, so CHIP's repeated callbacks are harmless. Returns the member's standing, or null if the
     * purchase is not one of the club's or was already counted.
     */
    paid(purchaseId: string, savedCard: boolean): { readonly memberId: number; readonly standing: Standing } | null {
      return db.transaction(() => {
        const payment = db.prepare(`SELECT * FROM payments WHERE purchase_id = ? AND status != 'paid'`).get(purchaseId);
        if (!payment) return null;
        const memberId = integer(payment, 'member_id');
        const kind = oneOf(payment, 'kind', ['checkout', 'renewal'] as const);
        const at = now();
        db.prepare(`UPDATE payments SET status = 'paid', paid_at = ? WHERE purchase_id = ?`).run(iso(at), purchaseId);
        const current = db.prepare('SELECT paid_until FROM subscriptions WHERE member_id = ?').get(memberId);
        const from = current ? new Date(Math.max(at.getTime(), new Date(text(current, 'paid_until')).getTime())) : at;
        const until = iso(monthAfter(from));
        const token = kind === 'checkout' && savedCard ? purchaseId : null;
        db.prepare(
          `INSERT INTO subscriptions (member_id, paid_until, card_token) VALUES (?, ?, ?)
           ON CONFLICT (member_id) DO UPDATE SET paid_until = excluded.paid_until, card_token = coalesce(excluded.card_token, card_token),
             renews = CASE WHEN excluded.card_token IS NULL THEN renews ELSE 1 END, last_attempt_at = NULL`,
        ).run(memberId, until, token);
        return { memberId, standing: standing(memberId) };
      });
    },

    /** Marks a renewal charge that did not go through. A refused card is dropped, so it is not tried again. */
    failed(purchaseId: string, cardRefused: boolean): void {
      db.transaction(() => {
        const payment = db.prepare(`SELECT member_id FROM payments WHERE purchase_id = ? AND status = 'created'`).get(purchaseId);
        if (!payment) return;
        db.prepare(`UPDATE payments SET status = 'failed' WHERE purchase_id = ?`).run(purchaseId);
        if (cardRefused) db.prepare('UPDATE subscriptions SET card_token = NULL WHERE member_id = ?').run(integer(payment, 'member_id'));
      });
    },

    /** Turns automatic renewal on or off. Returns the card token when turning off, so it can be revoked in CHIP. */
    setRenews(memberId: number, renews: boolean): Standing {
      db.prepare('UPDATE subscriptions SET renews = ? WHERE member_id = ?').run(renews ? 1 : 0, memberId);
      return standing(memberId);
    },

    /**
     * Members without a saved card whose paid month ends within three days, not yet reminded for this month. Each is
     * marked as reminded for that month, so they hear once per month, and again only after paying for the next.
     */
    paymentReminders(): (Recipient & { readonly paidUntil: string })[] {
      return db.transaction(() => {
        const at = now().getTime();
        const rows = db
          .prepare(
            `SELECT s.member_id, s.paid_until, m.email, m.name FROM subscriptions s JOIN members m ON m.id = s.member_id
             WHERE s.renews = 1 AND s.card_token IS NULL AND s.paid_until > ? AND s.paid_until <= ?
               AND (s.reminded_for IS NULL OR s.reminded_for != s.paid_until) AND ${STATUS_SQL.active}`,
          )
          .all(iso(new Date(at)), iso(new Date(at + PAY_REMINDER_LEAD_MS)));
        const mark = db.prepare('UPDATE subscriptions SET reminded_for = paid_until WHERE member_id = ?');
        return rows.map((row) => {
          mark.run(integer(row, 'member_id'));
          return { email: text(row, 'email'), name: text(row, 'name'), paidUntil: text(row, 'paid_until') };
        });
      });
    },

    /**
     * Renewals to charge now: active members renewing by card whose month ends within half a day, or ended within the
     * grace period, and not tried in the last 20 hours. Each is marked as tried, so a rerun of the hourly job skips it.
     */
    dueRenewals(): Renewal[] {
      return db.transaction(() => {
        const at = now().getTime();
        const rows = db
          .prepare(
            `SELECT s.member_id, s.card_token, s.paid_until, m.email, m.name FROM subscriptions s JOIN members m ON m.id = s.member_id
             WHERE s.renews = 1 AND s.card_token IS NOT NULL AND s.paid_until <= ? AND s.paid_until > ?
               AND (s.last_attempt_at IS NULL OR s.last_attempt_at <= ?) AND ${STATUS_SQL.active}`,
          )
          .all(iso(new Date(at + RENEW_AHEAD_MS)), iso(new Date(at - GRACE_MS)), iso(new Date(at - RETRY_GAP_MS)));
        const mark = db.prepare('UPDATE subscriptions SET last_attempt_at = ? WHERE member_id = ?');
        return rows.map((row) => {
          mark.run(iso(new Date(at)), integer(row, 'member_id'));
          return { memberId: integer(row, 'member_id'), token: text(row, 'card_token'), paidUntil: text(row, 'paid_until'), email: text(row, 'email'), name: text(row, 'name') };
        });
      });
    },
  };
}
