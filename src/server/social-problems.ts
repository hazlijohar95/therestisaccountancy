import { OPTION_KEYS, POST_JURISDICTIONS, RATING_IDS, TOPICS, type OptionKey, type PostJurisdiction, type Rating, type Topic } from '../data/social.ts';
import { STATUS_SQL } from './club.ts';
import { attempt, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import { fail, ok, type Result } from './result.ts';
import { notify, unnotify } from './social-notify.ts';
import { activeSql, authorOf, claimFacts, sealedSql, sealOf, type Author } from './social-profiles.ts';

/*
 * Weekly problems: the team writes them, members with a handle answer once, and members with the seal rate the
 * reasoning. One rule decides what a viewer sees of the answers: nothing, not even the spread, until they have
 * answered or the problem has closed. Rating checks the same rule, so nobody rates what they cannot read.
 */

export type ProblemState = 'scheduled' | 'open' | 'closed';

export interface ProblemDraft {
  readonly number: number;
  readonly tag: Topic;
  readonly jurisdiction: PostJurisdiction;
  readonly title: string;
  /** Two to four lines, in order. */
  readonly scenario: readonly string[];
  readonly ask: string;
  /** Two to four options. Their letters come from their order. */
  readonly options: readonly string[];
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface Problem {
  readonly id: number;
  readonly number: number;
  readonly tag: Topic;
  readonly jurisdiction: PostJurisdiction;
  readonly title: string;
  readonly scenario: readonly string[];
  readonly ask: string;
  readonly options: readonly { readonly key: OptionKey; readonly text: string }[];
  readonly opensAt: string;
  readonly closesAt: string;
  readonly state: ProblemState;
  /** Answers from members the public can see. */
  readonly answers: number;
}

export interface ProblemViewer {
  readonly memberId: number | null;
  /** Answering needs a handle: answers are signed with it. */
  readonly hasHandle: boolean;
  /** Rating needs the seal. */
  readonly sealed: boolean;
  /** The team sees scheduled problems, as a preview. */
  readonly admin: boolean;
}

export type RatingCounts = Readonly<Record<Rating, number>>;

export interface AnswerCard {
  readonly id: number;
  readonly author: Author;
  readonly pick: OptionKey;
  readonly reasoning: string;
  readonly createdAt: string;
  readonly mine: boolean;
  /** Ratings from members who hold the seal now. */
  readonly ratings: RatingCounts;
  readonly viewerRating: Rating | null;
}

export interface Spread {
  readonly key: OptionKey;
  readonly count: number;
  readonly percent: number;
}

export interface ProblemView {
  readonly problem: Problem;
  readonly viewer: ProblemViewer;
  readonly mine: { readonly pick: OptionKey; readonly reasoning: string } | null;
  /** The viewer answered, or the problem closed. Until then the spread and the answers are empty. */
  readonly revealed: boolean;
  /** Holds the seal, answered, and the problem is still open. */
  readonly canRate: boolean;
  readonly spread: readonly Spread[];
  /** The most common pick, once revealed. */
  readonly most: OptionKey | null;
  /** The viewer's own first, then the most Sound. */
  readonly answers: readonly AnswerCard[];
}

export interface ArchiveEntry {
  readonly number: number;
  readonly title: string;
  readonly tag: Topic;
  readonly answers: number;
}

/**
 * A member's judgment record. Each rated answer is judged by its most common rating, ties going to the harsher one,
 * so a split between Sound and Unsound never reads as Sound. Unrated answers count as answers only.
 */
export interface JudgmentRecord {
  readonly answers: number;
  readonly rated: number;
  readonly sound: number;
  readonly partly: number;
  readonly unsound: number;
}

export interface RateOutcome {
  readonly answerId: number;
  readonly rating: Rating | null;
  readonly ratings: RatingCounts;
}

export type CreateRefusal = 'number-taken' | 'window' | 'overlaps';
export type RemoveProblemRefusal = 'not-found' | 'answered';
export type AnswerRefusal = 'not-found' | 'not-open' | 'no-handle' | 'already' | 'no-option';
export type RateRefusal = 'not-found' | 'no-seal' | 'self' | 'closed';

const ANONYMOUS: ProblemViewer = { memberId: null, hasHandle: false, sealed: false, admin: false };
/** Harshest first: the order a tie is broken in. */
const HARSHEST_FIRST: readonly Rating[] = ['unsound', 'partly', 'sound'];
const NO_RATINGS: RatingCounts = { sound: 0, partly: 0, unsound: 0 };

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Answers the public can see: from an active member with a profile. */
const VISIBLE_ANSWER = (a: string) => `${activeSql(`${a}.member_id`)} AND EXISTS (SELECT 1 FROM profiles WHERE member_id = ${a}.member_id)`;
/** Ratings that count: from a rater who is active and holds the seal now. */
const COUNTED_RATING = (r: string) => `${activeSql(`${r}.rater_id`)} AND ${sealedSql(`${r}.rater_id`)}`;

const strings = (row: Row, column: string): string[] => {
  const stored: unknown = JSON.parse(text(row, column));
  if (!Array.isArray(stored) || !stored.every((entry) => typeof entry === 'string')) throw new TypeError(`${column} is not a list of text`);
  return stored;
};

/** The most common rating, ties going to the harsher one. Null when nobody rated it. */
export function judged(ratings: RatingCounts): Rating | null {
  const most = Math.max(...RATING_IDS.map((id) => ratings[id]));
  return most === 0 ? null : (HARSHEST_FIRST.find((id) => ratings[id] === most) ?? null);
}

export function createSocialProblems(db: Db, now: () => Date = () => new Date()) {
  const viewerOf = (memberId: number | null): ProblemViewer => {
    if (memberId === null) return ANONYMOUS;
    const row = db.prepare(`SELECT m.role, p.handle FROM members m LEFT JOIN profiles p ON p.member_id = m.id WHERE m.id = ? AND ${STATUS_SQL.active}`).get(memberId);
    if (!row) return ANONYMOUS;
    return { memberId, hasHandle: optionalText(row, 'handle') !== null, sealed: sealOf(claimFacts(db, memberId)), admin: text(row, 'role') === 'admin' };
  };

  const stateOf = (row: Row): ProblemState => {
    const at = iso(now());
    if (text(row, 'opens_at') > at) return 'scheduled';
    return text(row, 'closes_at') > at ? 'open' : 'closed';
  };

  const PROBLEM = `SELECT pr.*, (SELECT count(*) FROM answers a WHERE a.problem_id = pr.id AND ${VISIBLE_ANSWER('a')}) AS answer_count FROM problems pr`;

  const toProblem = (row: Row): Problem => ({
    id: integer(row, 'id'),
    number: integer(row, 'number'),
    tag: oneOf(row, 'tag', TOPICS),
    jurisdiction: oneOf(row, 'jurisdiction', POST_JURISDICTIONS),
    title: text(row, 'title'),
    scenario: strings(row, 'scenario'),
    ask: text(row, 'ask'),
    options: strings(row, 'options').flatMap((option, i) => {
      const key = OPTION_KEYS[i];
      return key ? [{ key, text: option }] : [];
    }),
    opensAt: text(row, 'opens_at'),
    closesAt: text(row, 'closes_at'),
    state: stateOf(row),
    answers: integer(row, 'answer_count'),
  });

  const ratingCounts = (answerId: number): RatingCounts => {
    const counts: Record<Rating, number> = { ...NO_RATINGS };
    for (const row of db.prepare(`SELECT rt.verdict, count(*) AS n FROM ratings rt WHERE rt.answer_id = ? AND ${COUNTED_RATING('rt')} GROUP BY rt.verdict`).all(answerId)) {
      counts[oneOf(row, 'verdict', RATING_IDS)] = integer(row, 'n');
    }
    return counts;
  };

  /** What this viewer sees of a problem. Scheduled problems are the team's alone. */
  const viewOf = (viewer: ProblemViewer, row: Row): ProblemView | null => {
    const problem = toProblem(row);
    if (problem.state === 'scheduled' && !viewer.admin) return null;
    const own = viewer.memberId === null ? undefined : db.prepare('SELECT pick, reasoning FROM answers WHERE problem_id = ? AND member_id = ?').get(problem.id, viewer.memberId);
    const mine = own ? { pick: oneOf(own, 'pick', OPTION_KEYS), reasoning: text(own, 'reasoning') } : null;
    const revealed = mine !== null || problem.state === 'closed';
    if (!revealed) return { problem, viewer, mine, revealed, canRate: false, spread: [], most: null, answers: [] };

    const answers = db
      .prepare(`SELECT a.* FROM answers a WHERE a.problem_id = ? AND ${VISIBLE_ANSWER('a')} ORDER BY a.created_at, a.id`)
      .all(problem.id)
      .map((answer): AnswerCard => {
        const id = integer(answer, 'id');
        const memberId = integer(answer, 'member_id');
        const rated = viewer.memberId === null ? undefined : db.prepare('SELECT verdict FROM ratings WHERE answer_id = ? AND rater_id = ?').get(id, viewer.memberId);
        return {
          id,
          author: authorOf(db, memberId),
          pick: oneOf(answer, 'pick', OPTION_KEYS),
          reasoning: text(answer, 'reasoning'),
          createdAt: text(answer, 'created_at'),
          mine: memberId === viewer.memberId,
          ratings: ratingCounts(id),
          viewerRating: rated ? oneOf(rated, 'verdict', RATING_IDS) : null,
        };
      })
      .sort((a, b) => Number(b.mine) - Number(a.mine) || b.ratings.sound - a.ratings.sound);
    const spread = problem.options.map(({ key }) => {
      const picked = answers.filter((answer) => answer.pick === key).length;
      return { key, count: picked, percent: answers.length ? Math.round((picked / answers.length) * 100) : 0 };
    });
    const top = Math.max(0, ...spread.map((s) => s.count));
    return {
      problem,
      viewer,
      mine,
      revealed,
      canRate: viewer.sealed && mine !== null && problem.state === 'open',
      spread,
      most: top > 0 ? (spread.find((s) => s.count === top)?.key ?? null) : null,
      answers,
    };
  };

  const openRow = () => {
    const at = iso(now());
    return db.prepare(`${PROBLEM} WHERE pr.opens_at <= ? AND pr.closes_at > ? ORDER BY pr.opens_at LIMIT 1`).get(at, at);
  };

  return {
    viewer: viewerOf,

    /** A problem by number, or the open one when number is null. Null when there is none this viewer may see. */
    view(viewerId: number | null, number: number | null): ProblemView | null {
      const row = number === null ? openRow() : db.prepare(`${PROBLEM} WHERE pr.number = ?`).get(number);
      return row ? viewOf(viewerOf(viewerId), row) : null;
    },

    /** When the next scheduled problem opens, if one is. Its title stays with the team until then. */
    nextOpens(): string | null {
      const row = db.prepare('SELECT opens_at FROM problems WHERE opens_at > ? ORDER BY opens_at LIMIT 1').get(iso(now()));
      return row ? text(row, 'opens_at') : null;
    },

    /** Closed problems, newest first. */
    archive(): ArchiveEntry[] {
      return db
        .prepare(`${PROBLEM} WHERE pr.closes_at <= ? ORDER BY pr.closes_at DESC, pr.number DESC`)
        .all(iso(now()))
        .map(toProblem)
        .map(({ number, title, tag, answers }) => ({ number, title, tag, answers }));
    },

    /** Every problem, for the team: scheduled, open and closed, the latest first. */
    schedule(): Problem[] {
      return db.prepare(`${PROBLEM} ORDER BY pr.opens_at DESC`).all().map(toProblem);
    },

    /** The number after the highest so far, for the team's form. */
    nextNumber(): number {
      const row = db.prepare('SELECT max(number) AS n FROM problems').get();
      return row && row.n !== null ? integer(row, 'n') + 1 : 1;
    },

    /** The team writes a problem. Only one is open at a time, so its window may not overlap another's. */
    create(adminId: number, draft: ProblemDraft): Result<{ readonly number: number }, CreateRefusal> {
      return attempt<{ readonly number: number }, CreateRefusal>(db, (refuse) => {
        if (draft.closesAt <= draft.opensAt) refuse('window');
        if (db.prepare('SELECT 1 FROM problems WHERE number = ?').get(draft.number)) refuse('number-taken');
        if (db.prepare('SELECT 1 FROM problems WHERE opens_at < ? AND closes_at > ?').get(draft.closesAt, draft.opensAt)) refuse('overlaps');
        db.prepare(
          `INSERT INTO problems (number, tag, jurisdiction, title, scenario, ask, options, opens_at, closes_at, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          draft.number,
          draft.tag,
          draft.jurisdiction,
          draft.title,
          JSON.stringify(draft.scenario),
          draft.ask,
          JSON.stringify(draft.options.slice(0, OPTION_KEYS.length)),
          draft.opensAt,
          draft.closesAt,
          adminId,
          iso(now()),
        );
        return { number: draft.number };
      });
    },

    /** The team takes back a problem nobody has answered yet, to fix and write again. */
    remove(number: number): Result<null, RemoveProblemRefusal> {
      return attempt<null, RemoveProblemRefusal>(db, (refuse) => {
        const row = db.prepare('SELECT id FROM problems WHERE number = ?').get(number) ?? refuse('not-found');
        if (db.prepare('SELECT 1 FROM answers WHERE problem_id = ?').get(integer(row, 'id'))) refuse('answered');
        db.prepare('DELETE FROM problems WHERE id = ?').run(integer(row, 'id'));
        return null;
      });
    },

    /** A member answers the open problem, once. */
    answer(memberId: number, number: number, input: { readonly pick: OptionKey; readonly reasoning: string }): Result<{ readonly number: number }, AnswerRefusal> {
      const viewer = viewerOf(memberId);
      const row = db.prepare(`${PROBLEM} WHERE pr.number = ?`).get(number);
      if (!row) return fail('not-found');
      const problem = toProblem(row);
      if (problem.state === 'scheduled' && !viewer.admin) return fail('not-found');
      if (problem.state !== 'open') return fail('not-open');
      if (!viewer.hasHandle) return fail('no-handle');
      if (!problem.options.some((option) => option.key === input.pick)) return fail('no-option');
      const { changes } = db
        .prepare('INSERT INTO answers (problem_id, member_id, pick, reasoning, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .run(problem.id, memberId, input.pick, input.reasoning, iso(now()));
      return changes ? ok({ number }) : fail('already');
    },

    /**
     * A member with the seal rates an answer they can see, never their own, while the problem is open. Null takes their
     * rating back. Rating again replaces it, and counts from now.
     */
    rate(raterId: number, answerId: number, rating: Rating | null): Result<RateOutcome, RateRefusal> {
      return attempt<RateOutcome, RateRefusal>(db, (refuse) => {
        const viewer = viewerOf(raterId);
        const row = db.prepare(`SELECT a.member_id, pr.number FROM answers a JOIN problems pr ON pr.id = a.problem_id WHERE a.id = ? AND ${VISIBLE_ANSWER('a')}`).get(answerId) ?? refuse('not-found');
        const problem = db.prepare(`${PROBLEM} WHERE pr.number = ?`).get(integer(row, 'number')) ?? refuse('not-found');
        const seen = viewOf(viewer, problem) ?? refuse('not-found');
        if (!seen.revealed) refuse('not-found');
        if (!viewer.sealed) refuse('no-seal');
        if (integer(row, 'member_id') === raterId) refuse('self');
        if (seen.problem.state !== 'open') refuse('closed');
        if (rating === null) {
          db.prepare('DELETE FROM ratings WHERE answer_id = ? AND rater_id = ?').run(answerId, raterId);
          unnotify(db, integer(row, 'member_id'), 'rating', `${answerId}:${raterId}`);
        } else {
          db.prepare(
            `INSERT INTO ratings (answer_id, rater_id, verdict, created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (answer_id, rater_id) DO UPDATE SET verdict = excluded.verdict, created_at = excluded.created_at WHERE verdict != excluded.verdict`,
          ).run(answerId, raterId, rating, iso(now()));
          notify(db, now(), integer(row, 'member_id'), { kind: 'rating', key: `${answerId}:${raterId}`, actorId: raterId, subjectId: integer(row, 'number'), detail: rating });
        }
        return { answerId, rating, ratings: ratingCounts(answerId) };
      });
    },

    /** A member's judgment record, from every answer they gave. */
    record(memberId: number): JudgmentRecord {
      const verdicts = db
        .prepare('SELECT id FROM answers WHERE member_id = ?')
        .all(memberId)
        .map((row) => judged(ratingCounts(integer(row, 'id'))));
      const of = (rating: Rating) => verdicts.filter((v) => v === rating).length;
      return { answers: verdicts.length, rated: verdicts.filter((v) => v !== null).length, sound: of('sound'), partly: of('partly'), unsound: of('unsound') };
    },

    /**
     * Problems answered in a row, counting back from the latest to open. The open one breaks nothing until it closes
     * unanswered.
     */
    streak(memberId: number): number {
      const at = iso(now());
      let streak = 0;
      for (const row of db
        .prepare('SELECT pr.closes_at, EXISTS (SELECT 1 FROM answers a WHERE a.problem_id = pr.id AND a.member_id = ?) AS answered FROM problems pr WHERE pr.opens_at <= ? ORDER BY pr.opens_at DESC')
        .all(memberId, at)) {
        if (integer(row, 'answered') === 1) streak += 1;
        else if (text(row, 'closes_at') > at) continue;
        else break;
      }
      return streak;
    },
  };
}

export type SocialProblems = ReturnType<typeof createSocialProblems>;
