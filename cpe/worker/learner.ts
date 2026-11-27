import type { AppState, Attempt, Certificate, CourseProgress, LoggedEntry, Requirement } from "../src/domain/progress.ts";
import { exampleRequirement } from "../src/domain/progress.ts";
import { acceptHeard, passes, readyForAssessment, refill, type Range } from "../src/domain/rules.ts";
import type { Field, Level, Question } from "../src/domain/types.ts";
import { integer, json, migrate, oneOf, optionalText, readable, real, text, type Db, type Row, type Warn } from "./db.ts";
import { randomPermutation, unguessable } from "./shuffle.ts";
import * as check from "./validate.ts";

/**
 * One member's record: what they heard, the review questions they answered, their assessment sittings and attempts,
 * the certificates issued to them, and the hours they logged themselves. One instance per member.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE learner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL DEFAULT '',
    requirement TEXT,
    credit REAL NOT NULL DEFAULT 0,
    credit_at INTEGER
  );
  INSERT INTO learner (id) VALUES (1);

  CREATE TABLE listening (
    course_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    ranges TEXT NOT NULL DEFAULT '[]',
    position REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (course_id, version)
  );

  CREATE TABLE reviews (
    course_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    checkpoint INTEGER NOT NULL,
    answered_at TEXT NOT NULL,
    PRIMARY KEY (course_id, version, checkpoint)
  );

  CREATE TABLE sittings (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    orders TEXT NOT NULL,
    created_at TEXT NOT NULL,
    submitted_at TEXT
  );

  CREATE TABLE attempts (
    sitting_id TEXT PRIMARY KEY REFERENCES sittings (id),
    course_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    at TEXT NOT NULL,
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    passed INTEGER NOT NULL
  );

  CREATE TABLE certificates (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL UNIQUE,
    version INTEGER NOT NULL,
    issued_at TEXT NOT NULL,
    name TEXT NOT NULL,
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    field TEXT NOT NULL,
    level TEXT NOT NULL,
    credits REAL NOT NULL,
    registered INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE logged (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    field TEXT NOT NULL,
    hours REAL NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('self-reported', 'unverified')),
    legacy_id TEXT UNIQUE,
    created_at TEXT NOT NULL
  );
  `,
];

/** What a published version tells the learner store to grade and certify. Kept apart from the catalogue's own types. */
export interface Assessed {
  readonly courseId: string;
  readonly version: number;
  readonly duration: number;
  readonly checkpoints: number;
  readonly quiz: readonly Question[];
  readonly title: string;
  readonly provider: string;
  readonly field: Field;
  readonly level: Level;
  readonly credits: number;
}

export interface Sitting {
  readonly id: string;
  /** For each question, the source index of the option shown at each position. */
  readonly orders: readonly (readonly number[])[];
}

export interface Graded {
  readonly correct: number;
  readonly total: number;
  readonly passed: boolean;
  /** For each question: the source index picked (null for none), and the right one. Sent only after grading. */
  readonly results: readonly { picked: number | null; answer: number }[];
  /** Issued by this sitting. Null when it failed or the course was already certified. */
  readonly certificate: Certificate | null;
}

export type SitRefusal = "not-ready";
export type SubmitRefusal = "no-sitting" | "submitted" | "wrong-length";

/** The prototype's browser record, read loosely: anything malformed is skipped rather than refused. */
export interface Legacy {
  readonly learner?: string;
  readonly requirement?: Requirement;
  readonly logged: readonly { id: string; date: string; title: string; provider: string; field: Field; hours: number }[];
  readonly certificates: readonly { id: string; date: string; title: string; provider: string; field: Field; hours: number }[];
  readonly positions: readonly { courseId: string; version: number; position: number }[];
}

const toCertificate = (row: Row): Certificate => ({
  id: text(row, "id"),
  courseId: text(row, "course_id"),
  version: integer(row, "version"),
  issuedAt: text(row, "issued_at"),
  name: text(row, "name"),
  correct: integer(row, "correct"),
  total: integer(row, "total"),
  title: text(row, "title"),
  provider: text(row, "provider"),
  field: oneOf(row, "field", check.FIELDS),
  level: oneOf(row, "level", check.LEVELS),
  credits: real(row, "credits"),
});

const toLogged = (row: Row): LoggedEntry => ({
  id: text(row, "id"),
  date: text(row, "date"),
  title: text(row, "title"),
  provider: text(row, "provider"),
  field: oneOf(row, "field", check.FIELDS),
  hours: real(row, "hours"),
  source: oneOf(row, "source", ["self-reported", "unverified"] as const),
});

const orders = (value: unknown): number[][] => check.list(value, "orders").map((o, i) => check.list(o, `orders[${i}]`, 4).map((n, j) => check.integerIn(n, `orders[${i}][${j}]`, 0, 3)));

/** A certificate id: readable prefix, then ten random characters so ids cannot be guessed or walked. */
function certificateId(courseId: string, at: Date): string {
  const code = courseId
    .split("-")
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 6);
  return `TRIA-${code}-${at.toISOString().slice(0, 10).replaceAll("-", "")}-${unguessable(10)}`;
}

export function createLearner(db: Db, now: () => Date = () => new Date(), warn: Warn = console.error) {
  migrate(db, MIGRATIONS);
  const iso = () => now().toISOString();

  const learnerRow = () => db.prepare("SELECT * FROM learner WHERE id = 1").get()!;

  const listening = (courseId: string, version: number) => {
    const row = db.prepare("SELECT * FROM listening WHERE course_id = ? AND version = ?").get(courseId, version);
    return row ? { ranges: check.ranges(json(row, "ranges"), "ranges"), position: real(row, "position") } : { ranges: [] as Range[], position: 0 };
  };

  const answered = (courseId: string, version: number): number[] =>
    db
      .prepare("SELECT checkpoint FROM reviews WHERE course_id = ? AND version = ? ORDER BY checkpoint")
      .all(courseId, version)
      .map((r) => integer(r, "checkpoint"));

  const attemptsOf = (courseId: string, version: number): Attempt[] =>
    db
      .prepare("SELECT * FROM attempts WHERE course_id = ? AND version = ? ORDER BY at")
      .all(courseId, version)
      .map((r) => ({ at: text(r, "at"), correct: integer(r, "correct"), total: integer(r, "total"), passed: integer(r, "passed") === 1 }));

  const progress = (courseId: string, version: number): CourseProgress => ({
    version,
    ...listening(courseId, version),
    checkpoints: answered(courseId, version),
    attempts: attemptsOf(courseId, version),
  });

  const certificateFor = (courseId: string): Certificate | null => {
    const row = db.prepare("SELECT * FROM certificates WHERE course_id = ?").get(courseId);
    return row ? toCertificate(row) : null;
  };

  /**
   * The version of each course this listener is on: the newest one they have any evidence for. A course they are
   * part-way through stays on that version when a new one is published.
   */
  const pins = (): Record<string, number> => {
    const rows = db
      .prepare(
        `SELECT course_id, max(version) AS version FROM (
           SELECT course_id, version FROM listening UNION ALL SELECT course_id, version FROM reviews UNION ALL SELECT course_id, version FROM attempts
         ) GROUP BY course_id`,
      )
      .all();
    return Object.fromEntries(rows.map((r) => [text(r, "course_id"), integer(r, "version")]));
  };

  const learner = {
    pins,

    /** The whole record. A part whose stored shape no longer reads is left out and logged, so the rest still loads. */
    snapshot(): AppState {
      const row = learnerRow();
      const own = readable([row], (r) => {
        const saved = optionalText(r, "requirement");
        return saved === null ? null : check.requirement(JSON.parse(saved));
      }, warn, () => "requirement")[0];
      const courses = Object.entries(pins()).map(([courseId, version]) => ({ course_id: courseId, version }));
      return {
        learner: text(row, "name"),
        progress: Object.fromEntries(readable(courses, (c) => [text(c, "course_id"), progress(text(c, "course_id"), integer(c, "version"))] as const, warn, (c) => `progress on "${String(c.course_id)}"`)),
        certificates: readable(db.prepare("SELECT * FROM certificates ORDER BY issued_at").all(), toCertificate, warn, (r) => `certificate ${String(r.id)}`),
        requirement: own ?? exampleRequirement(now()),
        logged: readable(db.prepare("SELECT * FROM logged ORDER BY date, created_at").all(), toLogged, warn, (r) => `logged entry ${String(r.id)}`),
      };
    },

    /** The name printed on certificates issued from now on. Certificates already issued keep theirs. */
    setName(name: string): void {
      db.prepare("UPDATE learner SET name = ? WHERE id = 1").run(name);
    },

    /**
     * Takes a report of the audio played. New audio is accepted only as fast as real time allows at the fastest
     * playback rate, from a bucket shared by every course and tab (see refill in rules.ts). The position is kept for resuming.
     */
    heard(courseId: string, version: number, duration: number, reported: readonly Range[], position: number): CourseProgress {
      return db.transaction(() => {
        const at = now().getTime();
        const row = learnerRow();
        const creditAt = row.credit_at === null ? at : integer(row, "credit_at");
        const credit = refill(real(row, "credit"), (at - creditAt) / 1000);
        const before = listening(courseId, version);
        const { ranges, spent } = acceptHeard(before.ranges, reported, credit, duration);
        db.prepare("UPDATE learner SET credit = ?, credit_at = ? WHERE id = 1").run(credit - spent, at);
        const clamped = Math.max(0, Math.min(duration, position));
        db.prepare(
          `INSERT INTO listening (course_id, version, ranges, position, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (course_id, version) DO UPDATE SET ranges = excluded.ranges, position = excluded.position, updated_at = excluded.updated_at`,
        ).run(courseId, version, JSON.stringify(ranges), clamped, iso());
        return progress(courseId, version);
      });
    },

    /** Records a review question answered correctly. Answering again changes nothing. */
    answerReview(courseId: string, version: number, checkpoint: number): CourseProgress {
      db.prepare("INSERT OR IGNORE INTO reviews (course_id, version, checkpoint, answered_at) VALUES (?, ?, ?, ?)").run(courseId, version, checkpoint, iso());
      return progress(courseId, version);
    },

    /**
     * Opens an assessment sitting with every question's options in a fresh order. Open only once the audio is heard
     * and the review questions answered, or for practice once the course is certified.
     */
    sit(course: Assessed): Sitting | SitRefusal {
      return db.transaction(() => {
        const { ranges } = listening(course.courseId, course.version);
        const ready = readyForAssessment(ranges, course.duration, answered(course.courseId, course.version).length, course.checkpoints);
        if (!ready && !certificateFor(course.courseId)) return "not-ready";
        const sitting: Sitting = { id: unguessable(16), orders: course.quiz.map((q) => randomPermutation(q.options.length)) };
        db.prepare("INSERT INTO sittings (id, course_id, version, orders, created_at) VALUES (?, ?, ?, ?, ?)").run(sitting.id, course.courseId, course.version, JSON.stringify(sitting.orders), iso());
        return sitting;
      });
    },

    /** Grades a sitting from the positions picked, once. A pass issues the course's certificate if it has none. */
    submit(sittingId: string, picks: readonly (number | null)[], course: Assessed): Graded | SubmitRefusal {
      return db.transaction(() => {
        const row = db.prepare("SELECT * FROM sittings WHERE id = ? AND course_id = ? AND version = ?").get(sittingId, course.courseId, course.version);
        if (!row) return "no-sitting";
        if (optionalText(row, "submitted_at") !== null) return "submitted";
        const order = orders(json(row, "orders"));
        if (picks.length !== course.quiz.length || order.length !== course.quiz.length) return "wrong-length";
        const results = course.quiz.map((q, i) => {
          const shown = picks[i];
          const picked = shown === null || shown === undefined ? null : (order[i]![shown] ?? null);
          return { picked, answer: q.answer };
        });
        const correct = results.filter((r) => r.picked === r.answer).length;
        const total = results.length;
        const passed = passes(correct, total);
        const at = now();
        db.prepare("UPDATE sittings SET submitted_at = ? WHERE id = ?").run(at.toISOString(), sittingId);
        db.prepare("INSERT INTO attempts (sitting_id, course_id, version, at, correct, total, passed) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
          sittingId,
          course.courseId,
          course.version,
          at.toISOString(),
          correct,
          total,
          passed ? 1 : 0,
        );
        let certificate: Certificate | null = null;
        if (passed && !certificateFor(course.courseId)) {
          certificate = {
            id: certificateId(course.courseId, at),
            courseId: course.courseId,
            version: course.version,
            issuedAt: at.toISOString(),
            name: text(learnerRow(), "name"),
            correct,
            total,
            title: course.title,
            provider: course.provider,
            field: course.field,
            level: course.level,
            credits: course.credits,
          };
          const c = certificate;
          db.prepare(
            `INSERT INTO certificates (id, course_id, version, issued_at, name, correct, total, title, provider, field, level, credits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(c.id, c.courseId, c.version, c.issuedAt, c.name, c.correct, c.total, c.title, c.provider, c.field, c.level, c.credits);
        }
        return { correct, total, passed, results, certificate };
      });
    },

    certificate(id: string): Certificate | null {
      const row = db.prepare("SELECT * FROM certificates WHERE id = ?").get(id);
      return row ? toCertificate(row) : null;
    },

    /** Certificates not yet confirmed on the public register, to record there again. */
    unregistered(): Certificate[] {
      return db.prepare("SELECT * FROM certificates WHERE registered = 0").all().map(toCertificate);
    },

    markRegistered(id: string): void {
      db.prepare("UPDATE certificates SET registered = 1 WHERE id = ?").run(id);
    },

    setRequirement(requirement: Requirement): void {
      const { isExample: _example, ...own } = requirement;
      db.prepare("UPDATE learner SET requirement = ? WHERE id = 1").run(JSON.stringify(own));
    },

    log(entry: Omit<LoggedEntry, "id" | "source">): LoggedEntry {
      const logged: LoggedEntry = { ...entry, id: unguessable(12), source: "self-reported" };
      db.prepare("INSERT INTO logged (id, date, title, provider, field, hours, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        logged.id,
        logged.date,
        logged.title,
        logged.provider,
        logged.field,
        logged.hours,
        logged.source,
        iso(),
      );
      return logged;
    },

    /** Removes an entry the learner logged or brought across. Issued certificates are not entries and stay. */
    unlog(id: string): boolean {
      return db.prepare("DELETE FROM logged WHERE id = ?").run(id).changes > 0;
    },

    /**
     * Brings the prototype's browser record into the account. Each item is keyed by its old id, so importing the same
     * browser twice, or a second browser, adds only what is new. Logged hours come in as self-reported and old
     * certificates as unverified claims. Listening evidence never comes in: only a resume position does.
     */
    importLegacy(legacy: Legacy): void {
      db.transaction(() => {
        const row = learnerRow();
        if (legacy.learner && !text(row, "name")) db.prepare("UPDATE learner SET name = ? WHERE id = 1").run(legacy.learner);
        if (legacy.requirement && !legacy.requirement.isExample && optionalText(row, "requirement") === null) learner.setRequirement(legacy.requirement);
        const add = (legacyId: string, e: Legacy["logged"][number], source: LoggedEntry["source"]) =>
          db
            .prepare("INSERT OR IGNORE INTO logged (id, date, title, provider, field, hours, source, legacy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(unguessable(12), e.date, e.title, e.provider, e.field, e.hours, source, legacyId, iso());
        for (const e of legacy.logged) add(`logged:${e.id}`, e, "self-reported");
        for (const c of legacy.certificates) add(`certificate:${c.id}`, c, "unverified");
        for (const p of legacy.positions) {
          db.prepare("INSERT OR IGNORE INTO listening (course_id, version, position, updated_at) VALUES (?, ?, ?, ?)").run(p.courseId, p.version, p.position, iso());
        }
      });
    },
  };
  return learner;
}

export type Learner = ReturnType<typeof createLearner>;
