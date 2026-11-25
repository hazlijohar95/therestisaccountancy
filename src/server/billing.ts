import { DEFAULT_TERM, TERMS, terms, type Term } from '../data/membership.ts';
import { STATUS_SQL } from './club.ts';
import { integer, oneOf, optionalText, text, type Db } from './db.ts';
import type { Recipient } from './mailings.ts';

/** Whether a member may use the members' area. Grace keeps a renewing member in for a few days past the paid term. */
export const ACCESS = ['paid', 'grace', 'unpaid'] as const;
export type Access = (typeof ACCESS)[number];

export interface Standing {
  readonly access: Access;
  /** The end of the time paid for. Null before the first payment. */
  readonly paidUntil: string | null;
  /** What the member last chose at a paid checkout, and what a saved card is charged for next. */
  readonly term: Term;
  /** CHIP holds a card to charge each term. */
  readonly cardOnFile: boolean;
  /** The member means to carry on: a saved card is charged, otherwise they are reminded to pay. */
  readonly renews: boolean;
}

export type PaymentKind = 'checkout' | 'renewal';

/** A renewal to charge: the member, the term to charge for, and the card token CHIP saved at checkout. */
export interface Renewal extends Recipient {
  readonly memberId: number;
  readonly token: string;
  readonly term: Term;
  readonly paidUntil: string;
}

/** A member who pays by hand, and the term that is about to end. */
export interface PaymentReminder extends Recipient {
  readonly term: Term;
  readonly paidUntil: string;
}

/** What a payment did to a membership: whose, the term it added or took off, and where that leaves them. */
export interface Settled {
  readonly memberId: number;
  readonly term: Term;
  readonly standing: Standing;
}

export const GRACE_MS = 3 * 86_400_000;
/** A renewal is charged this long before the paid term ends, and retried at most this often. */
const RENEW_AHEAD_MS = 12 * 3_600_000;
const RETRY_GAP_MS = 20 * 3_600_000;
/** Members who pay by hand are reminded this long before the paid term ends. */
export const PAY_REMINDER_LEAD_MS = 3 * 86_400_000;

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Who has paid for how long, the payments behind it, and the renewals owed. Money moves in CHIP; this records it. */
export function createBilling(db: Db, now: () => Date = () => new Date()) {
  const standing = (memberId: number): Standing => {
    const row = db.prepare('SELECT * FROM subscriptions WHERE member_id = ?').get(memberId);
    if (!row) return { access: 'unpaid', paidUntil: null, term: DEFAULT_TERM, cardOnFile: false, renews: true };
    const paidUntil = text(row, 'paid_until');
    const until = new Date(paidUntil).getTime();
    const at = now().getTime();
    const cardOnFile = optionalText(row, 'card_token') !== null;
    const renews = integer(row, 'renews') === 1;
    const grace = renews ? GRACE_MS : 0;
    return { access: until > at ? 'paid' : until + grace > at ? 'grace' : 'unpaid', paidUntil, term: oneOf(row, 'term', TERMS), cardOnFile, renews };
  };

  return {
    standing,
    access: (memberId: number): Access => standing(memberId).access,

    /**
     * Notes a purchase made in CHIP for a member, before they pay it. The term is fixed here, with its price, and is
     * the only thing that later decides how much time the payment adds or a refund takes off.
     */
    opened(purchaseId: string, memberId: number, kind: PaymentKind, term: Term): void {
      db.prepare('INSERT INTO payments (purchase_id, member_id, kind, term, amount, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (purchase_id) DO NOTHING').run(
        purchaseId,
        memberId,
        kind,
        term,
        terms[term].sen,
        iso(now()),
      );
    },

    /** The member's recent purchases of a kind still waiting to be paid, newest first, to ask CHIP about before acting again. */
    unpaid(memberId: number, kind: PaymentKind): string[] {
      return db
        .prepare(`SELECT purchase_id FROM payments WHERE member_id = ? AND kind = ? AND status = 'created' ORDER BY created_at DESC, rowid DESC LIMIT 5`)
        .all(memberId, kind)
        .map((row) => text(row, 'purchase_id'));
    },

    /**
     * Records a purchase CHIP says is paid: its term added from the later of now and the end of the time paid for. A
     * paid checkout sets the term the subscription renews at, and if it saved the card keeps its id as the token for
     * renewals. A second report of the same payment changes nothing, so CHIP's repeated callbacks are harmless. Null
     * if the purchase is not one of the club's or was already counted.
     */
    paid(purchaseId: string, savedCard: boolean): Settled | null {
      return db.transaction(() => {
        const payment = db.prepare(`SELECT * FROM payments WHERE purchase_id = ? AND status != 'paid'`).get(purchaseId);
        if (!payment) return null;
        const memberId = integer(payment, 'member_id');
        const kind = oneOf(payment, 'kind', ['checkout', 'renewal'] as const);
        const term = oneOf(payment, 'term', TERMS);
        const at = now();
        db.prepare(`UPDATE payments SET status = 'paid', paid_at = ? WHERE purchase_id = ?`).run(iso(at), purchaseId);
        const current = db.prepare('SELECT paid_until FROM subscriptions WHERE member_id = ?').get(memberId);
        const from = current ? new Date(Math.max(at.getTime(), new Date(text(current, 'paid_until')).getTime())) : at;
        const until = iso(terms[term].after(from));
        const token = kind === 'checkout' && savedCard ? purchaseId : null;
        /* A renewal was charged at the subscription's term, and never changes it: only a checkout does. */
        const chosen = kind === 'checkout' ? term : null;
        db.prepare(
          `INSERT INTO subscriptions (member_id, paid_until, card_token, term) VALUES (?, ?, ?, coalesce(?, '${DEFAULT_TERM}'))
           ON CONFLICT (member_id) DO UPDATE SET paid_until = excluded.paid_until, card_token = coalesce(excluded.card_token, card_token),
             term = coalesce(?, term), renews = CASE WHEN excluded.card_token IS NULL THEN renews ELSE 1 END, last_attempt_at = NULL`,
        ).run(memberId, until, token, chosen, chosen);
        return { memberId, term, standing: standing(memberId) };
      });
    },

    /**
     * A paid purchase refunded in full, or charged back: the term it bought comes off the end of the paid time, and a
     * card saved by it is no longer used. A refunded checkout no longer says what the member chose, so the term goes
     * back to that of the last paid checkout still standing. Counted once, however often CHIP reports it. Null for a
     * purchase that is not the club's, was never paid, or was already reversed.
     */
    reversed(purchaseId: string): Settled | null {
      return db.transaction(() => {
        const payment = db.prepare(`SELECT member_id, term FROM payments WHERE purchase_id = ? AND status = 'paid' AND reversed_at IS NULL`).get(purchaseId);
        if (!payment) return null;
        const memberId = integer(payment, 'member_id');
        const term = oneOf(payment, 'term', TERMS);
        db.prepare('UPDATE payments SET reversed_at = ? WHERE purchase_id = ?').run(iso(now()), purchaseId);
        const current = db.prepare('SELECT paid_until FROM subscriptions WHERE member_id = ?').get(memberId);
        if (current) {
          /* Paid times are kept to the second. Two checkouts paid in the same one fall back to the order they were opened in. */
          const standingCheckout = db
            .prepare(`SELECT term FROM payments WHERE member_id = ? AND kind = 'checkout' AND status = 'paid' AND reversed_at IS NULL ORDER BY paid_at DESC, rowid DESC LIMIT 1`)
            .get(memberId);
          db.prepare(`UPDATE subscriptions SET paid_until = ?, term = ?, card_token = CASE WHEN card_token = ? THEN NULL ELSE card_token END WHERE member_id = ?`).run(
            iso(terms[term].before(new Date(text(current, 'paid_until')))),
            standingCheckout ? oneOf(standingCheckout, 'term', TERMS) : DEFAULT_TERM,
            purchaseId,
            memberId,
          );
        }
        return { memberId, term, standing: standing(memberId) };
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
     * Members without a saved card whose paid term ends within three days, not yet reminded for this term. Each is
     * marked as reminded for that end date, so they hear once per term, and again only after paying for the next.
     */
    paymentReminders(): PaymentReminder[] {
      return db.transaction(() => {
        const at = now().getTime();
        const rows = db
          .prepare(
            `SELECT s.member_id, s.paid_until, s.term, m.email, m.name FROM subscriptions s JOIN members m ON m.id = s.member_id
             WHERE s.renews = 1 AND s.card_token IS NULL AND s.paid_until > ? AND s.paid_until <= ?
               AND (s.reminded_for IS NULL OR s.reminded_for != s.paid_until) AND ${STATUS_SQL.active}`,
          )
          .all(iso(new Date(at)), iso(new Date(at + PAY_REMINDER_LEAD_MS)));
        const mark = db.prepare('UPDATE subscriptions SET reminded_for = paid_until WHERE member_id = ?');
        return rows.map((row) => {
          mark.run(integer(row, 'member_id'));
          return { email: text(row, 'email'), name: text(row, 'name'), term: oneOf(row, 'term', TERMS), paidUntil: text(row, 'paid_until') };
        });
      });
    },

    /**
     * Renewals to charge now: active members renewing by card whose paid term ends within half a day, or ended within the
     * grace period, and not tried in the last 20 hours. Each is marked as tried, so a rerun of the hourly job skips it.
     */
    dueRenewals(): Renewal[] {
      return db.transaction(() => {
        const at = now().getTime();
        const rows = db
          .prepare(
            `SELECT s.member_id, s.card_token, s.paid_until, s.term, m.email, m.name FROM subscriptions s JOIN members m ON m.id = s.member_id
             WHERE s.renews = 1 AND s.card_token IS NOT NULL AND s.paid_until <= ? AND s.paid_until > ?
               AND (s.last_attempt_at IS NULL OR s.last_attempt_at <= ?) AND ${STATUS_SQL.active}`,
          )
          .all(iso(new Date(at + RENEW_AHEAD_MS)), iso(new Date(at - GRACE_MS)), iso(new Date(at - RETRY_GAP_MS)));
        const mark = db.prepare('UPDATE subscriptions SET last_attempt_at = ? WHERE member_id = ?');
        return rows.map((row) => {
          mark.run(iso(new Date(at)), integer(row, 'member_id'));
          return { memberId: integer(row, 'member_id'), token: text(row, 'card_token'), term: oneOf(row, 'term', TERMS), paidUntil: text(row, 'paid_until'), email: text(row, 'email'), name: text(row, 'name') };
        });
      });
    },
  };
}
