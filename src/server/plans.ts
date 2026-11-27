import { z } from 'zod';
import { PLAN_ANSWER_MAX, planSections, type PlanSectionSlug } from '../data/plan.ts';
import { hostFirstName } from '../data/authors.ts';
import { site } from '../data/site.ts';
import { firstName, numberWord } from '../lib/format.ts';
import { paragraphs } from '../lib/text.ts';
import { tidy } from '../lib/text.ts';
import { attempt, integer, optionalText, text, type Db, type Param, type Row } from './db.ts';
import type { Letter } from './letters.ts';
import type { Recipient } from './mailings.ts';
import type { Result } from './result.ts';

/** A plan's answers by section. A section left blank has no entry. */
export type PlanAnswers = Readonly<Partial<Record<PlanSectionSlug, string>>>;

/** The member who wrote a plan. */
export interface PlanAuthor extends Recipient {
  readonly id: number;
}

/** A host's written answer. by is null once that host is no longer a member. */
export interface PlanReply {
  readonly text: string;
  readonly by: string | null;
  readonly at: string;
}

interface PlanBase {
  readonly id: number;
  readonly member: PlanAuthor;
  readonly answers: PlanAnswers;
  readonly createdAt: string;
  /** When the member last saved it. */
  readonly updatedAt: string;
}

/** Being written. The member can change it as often as they like. */
export interface DraftPlan extends PlanBase {
  readonly status: 'draft';
}

/** With the hosts. The member can take it back to change it until one of them answers. */
export interface SentPlan extends PlanBase {
  readonly status: 'sent';
  readonly sentAt: string;
}

/** Answered, and closed: from here it is read, never changed. */
export interface AnsweredPlan extends PlanBase {
  readonly status: 'answered';
  readonly sentAt: string;
  readonly reply: PlanReply;
}

/** A member has at most one open plan: a draft, or one with the hosts. */
export type OpenPlan = DraftPlan | SentPlan;
export type Plan = OpenPlan | AnsweredPlan;
export type PlanStatus = Plan['status'];
export type ReplyRefusal = 'not-found' | 'not-sent' | 'changed' | 'answered';

const statusOf = (row: Row): PlanStatus =>
  optionalText(row, 'replied_at') !== null ? 'answered' : optionalText(row, 'submitted_at') !== null ? 'sent' : 'draft';

/** The SQL condition for each status. Kept beside statusOf so the two cannot drift apart. */
const STATUS_SQL = {
  draft: 'submitted_at IS NULL AND replied_at IS NULL',
  sent: 'submitted_at IS NOT NULL AND replied_at IS NULL',
  answered: 'replied_at IS NOT NULL',
} as const satisfies Record<PlanStatus, string>;

/** What makes a plan open. It is the condition of the unique index that allows each member one. */
const OPEN = 'replied_at IS NULL';

const answersOf = (answer: z.ZodType<string>) =>
  z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((raw): PlanAnswers => {
      const answers: Partial<Record<PlanSectionSlug, string>> = {};
      for (const { slug } of planSections) {
        const parsed = answer.safeParse(raw[slug]);
        if (parsed.success && parsed.data !== '') answers[slug] = parsed.data;
      }
      return answers;
    });

/** Answers as stored. Lenient, so a section taken out of the plan, or a lower cap, never breaks a member's page. */
const storedAnswers = answersOf(z.string());
/** Answers on their way in: only the plan's own sections, tidied and capped, whatever the caller sent. */
const writtenAnswers = answersOf(z.string().transform((value) => tidy(value).slice(0, PLAN_ANSWER_MAX).trimEnd()));

/** The sections still blank, in the plan's order. A plan goes to the hosts only when there are none. */
export const missingSections = (answers: PlanAnswers): PlanSectionSlug[] => planSections.filter(({ slug }) => !answers[slug]).map(({ slug }) => slug);

const PLANS = `
  SELECT p.*, m.name AS member_name, m.email AS member_email, h.name AS host_name
  FROM plans p JOIN members m ON m.id = p.member_id LEFT JOIN members h ON h.id = p.replied_by`;

const toPlan = (row: Row): Plan => {
  const stored: unknown = JSON.parse(text(row, 'answers'));
  const base: PlanBase = {
    id: integer(row, 'id'),
    member: { id: integer(row, 'member_id'), name: text(row, 'member_name'), email: text(row, 'member_email') },
    answers: storedAnswers.parse(stored),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
  const status = statusOf(row);
  switch (status) {
    case 'draft':
      return { ...base, status };
    case 'sent':
      return { ...base, status, sentAt: text(row, 'submitted_at') };
    case 'answered':
      return { ...base, status, sentAt: text(row, 'submitted_at'), reply: { text: text(row, 'reply'), by: optionalText(row, 'host_name'), at: text(row, 'replied_at') } };
  }
};

const isOpen = (plan: Plan): plan is OpenPlan => plan.status !== 'answered';
const isSent = (plan: Plan): plan is SentPlan => plan.status === 'sent';
const isAnswered = (plan: Plan): plan is AnsweredPlan => plan.status === 'answered';
const sameAnswers = (a: PlanAnswers, b: PlanAnswers) => JSON.stringify(a) === JSON.stringify(b);
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const HOUR_MS = 3_600_000;

/** Members' written plans and the hosts' answers. Each member has one open plan at most, and the database holds them to it. */
export function createPlans(db: Db, now: () => Date = () => new Date()) {
  const plans = (clause: string, ...params: Param[]) => db.prepare(`${PLANS} WHERE ${clause}`).all(...params).map(toPlan);
  const openOf = (memberId: number): OpenPlan | null => plans(`p.member_id = ? AND ${OPEN}`, memberId).find(isOpen) ?? null;

  /** Writes the answers into the member's draft, opening one if they have none. A plan with the hosts is left as it is. */
  const write = (memberId: number, answers: PlanAnswers): OpenPlan => {
    const at = iso(now());
    db.prepare(
      `INSERT INTO plans (member_id, answers, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (member_id) WHERE ${OPEN} DO UPDATE SET answers = excluded.answers, updated_at = excluded.updated_at WHERE ${STATUS_SQL.draft}`,
    ).run(memberId, JSON.stringify(answers), at, at);
    const plan = openOf(memberId);
    if (!plan) throw new Error(`Member ${memberId} has no open plan after writing one`);
    return plan;
  };

  return {
    /** The member's open plan, if they have one, and the plans the hosts have answered, newest first. */
    ofMember(memberId: number): { readonly open: OpenPlan | null; readonly answered: readonly AnsweredPlan[] } {
      const mine = plans('p.member_id = ? ORDER BY p.created_at DESC, p.id DESC', memberId);
      return { open: mine.find(isOpen) ?? null, answered: mine.filter(isAnswered) };
    },

    /** Saves the member's draft, opening one if they have none. Refused while their plan is with the hosts. */
    save(memberId: number, answers: Readonly<Record<string, unknown>>): Result<DraftPlan, 'sent'> {
      return attempt<DraftPlan, 'sent'>(db, (refuse) => {
        const plan = write(memberId, writtenAnswers.parse(answers));
        return plan.status === 'draft' ? plan : refuse('sent');
      });
    },

    /**
     * Saves the answers, then sends the plan to the hosts if every section is written. The plan comes back as it now
     * stands, still a draft if a section is blank, with whether this sent it. Sending the same plan twice changes
     * nothing. Other answers for a plan already with the hosts are refused, so nothing typed is silently dropped.
     */
    send(memberId: number, answers: Readonly<Record<string, unknown>>): Result<{ readonly plan: OpenPlan; readonly changed: boolean }, 'sent'> {
      return attempt<{ readonly plan: OpenPlan; readonly changed: boolean }, 'sent'>(db, (refuse) => {
        const written = writtenAnswers.parse(answers);
        const plan = write(memberId, written);
        if (plan.status === 'sent') return sameAnswers(plan.answers, written) ? { plan, changed: false } : refuse('sent');
        if (missingSections(plan.answers).length > 0) return { plan, changed: false };
        db.prepare('UPDATE plans SET submitted_at = ? WHERE id = ?').run(iso(now()), plan.id);
        const sent = openOf(memberId);
        if (sent?.status !== 'sent') throw new Error(`Plan ${plan.id} was not sent`);
        return { plan: sent, changed: true };
      });
    },

    /** Takes the member's plan back from the hosts to change it. Safe to repeat; refused once a host has answered. */
    takeBack(memberId: number): Result<DraftPlan, 'answered'> {
      return attempt<DraftPlan, 'answered'>(db, (refuse) => {
        db.prepare(`UPDATE plans SET submitted_at = NULL WHERE member_id = ? AND ${STATUS_SQL.sent}`).run(memberId);
        const plan = openOf(memberId);
        return plan?.status === 'draft' ? plan : refuse('answered');
      });
    },

    /**
     * Opens the member's next plan from their last answered one: each section that carries over is copied, the rest
     * start blank. Their open plan if they already have one, so a second click opens nothing new.
     */
    startNext(memberId: number): OpenPlan {
      return db.transaction(() => {
        const last = plans(`p.member_id = ? AND ${STATUS_SQL.answered} ORDER BY p.replied_at DESC, p.id DESC LIMIT 1`, memberId)[0];
        const carried = Object.fromEntries(planSections.filter((s) => s.carriesOver).map(({ slug }) => [slug, last?.answers[slug]]));
        const at = iso(now());
        db.prepare(`INSERT INTO plans (member_id, answers, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (member_id) WHERE ${OPEN} DO NOTHING`).run(
          memberId,
          JSON.stringify(writtenAnswers.parse(carried)),
          at,
          at,
        );
        const plan = openOf(memberId);
        if (!plan) throw new Error(`Member ${memberId} has no open plan after starting one`);
        return plan;
      });
    },

    /** Plans with the hosts, the one waiting longest first. */
    waiting(): SentPlan[] {
      return plans(`${STATUS_SQL.sent} ORDER BY p.submitted_at, p.id`).filter(isSent);
    },

    /** The most recently answered plans, newest first. */
    answered(limit: number): AnsweredPlan[] {
      return plans(`${STATUS_SQL.answered} ORDER BY p.replied_at DESC, p.id DESC LIMIT ?`, limit).filter(isAnswered);
    },

    /**
     * A host's written answer to the plan as they read it. It closes the plan: from then on the member reads it and
     * cannot change it. If the member has taken the plan back and sent it again since, the answer is refused, so a
     * plan never closes on text the host did not read.
     */
    reply(hostId: number, read: { readonly id: number; readonly sentAt: string }, reply: string): Result<AnsweredPlan, ReplyRefusal> {
      return attempt<AnsweredPlan, ReplyRefusal>(db, (refuse) => {
        const plan = plans('p.id = ?', read.id)[0];
        if (!plan) return refuse('not-found');
        if (plan.status !== 'sent') return refuse(plan.status === 'draft' ? 'not-sent' : 'answered');
        if (plan.sentAt !== read.sentAt) return refuse('changed');
        db.prepare('UPDATE plans SET reply = ?, replied_by = ?, replied_at = ? WHERE id = ?').run(reply, hostId, iso(now()), plan.id);
        const answered = plans('p.id = ?', plan.id)[0];
        if (answered?.status !== 'answered') throw new Error(`Plan ${plan.id} was not answered`);
        return answered;
      });
    },
  };
}

/** How long a plan has been with the hosts, in words: "under an hour", "five hours", "three days". */
export function waited(since: string, at: Date): string {
  const hours = Math.floor((at.getTime() - new Date(since).getTime()) / HOUR_MS);
  if (hours < 1) return 'under an hour';
  if (hours < 24) return hours === 1 ? 'an hour' : `${numberWord(hours)} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'a day' : `${numberWord(days)} days`;
}

/** Tells the admins a plan has come in, with the member's question. Only ever sent to them. */
export function planSentLetter(admins: readonly string[], plan: SentPlan, planUrl: string): Letter {
  const question = plan.answers.question;
  return {
    to: admins,
    subject: `${plan.member.name} sent their plan`,
    lines: [
      `${plan.member.name} has written down the firm they want and sent it to the hosts. It waits on the plans page until one of you answers.`,
      ...(question ? ['Their question for you:', ...paragraphs(question)] : []),
      { href: planUrl, label: 'Read and answer it' },
    ],
  };
}

/** Tells the member their plan has an answer. It comes from the host who wrote it, so a reply reaches a person. */
export function planAnsweredLetter(plan: AnsweredPlan, host: { readonly name: string }, planUrl: string): Letter {
  const signature = firstName(host.name);
  return {
    to: plan.member.email,
    from: `${signature} from ${site.name}`,
    subject: `${signature} answered your plan`,
    lines: [
      `Hi ${firstName(plan.member.name)},`,
      "I've read your plan and written back. The answer sits under your plan, so you can read the two together.",
      { href: planUrl, label: 'Read the answer' },
      "When you're ready for the next one, start it from there. It begins from this plan, so you only change what has moved.",
      `You're getting this because you sent your plan to ${hostFirstName}. Reply if you'd like to talk it over.`,
      signature,
    ],
  };
}
