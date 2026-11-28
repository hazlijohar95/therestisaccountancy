import { mytDate } from "../src/domain/calendar.ts";
import { defaultProfile, type AppState, type Attempt, type Certificate, type CourseProgress, type LoggedEntry, type MemberProfile } from "../src/domain/progress.ts";
import { acceptHeard, passes, readyForAssessment, refill, type Range } from "../src/domain/rules.ts";
import { isActivity, wholeUnder, type TagMinutes } from "../src/domain/subjects.ts";
import type { Field, Level, Question } from "../src/domain/types.ts";
import { integer, json, migrate, oneOf, optionalText, readable, real, text, Unreadable, type Db, type Row, type Warn } from "./db.ts";
import { randomPermutation, unguessable } from "./shuffle.ts";
import * as check from "./validate.ts";

/**
 * One member's record: what they heard, the review questions they answered, their assessment sittings and attempts,
 * the certificates issued to them, and the hours they logged themselves. One instance per member.
 */
export const MIGRATIONS: readonly string[] = [
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
  /*
   * MIA's model. The member's profile replaces the target they used to set themselves, whose column stays, unread.
   * Certificates carry minutes per subject; one issued before this has none and reads as its whole credit under its
   * field. Logged entries become minutes of an Appendix V activity: an old row is a course, its hours under its field.
   */
  `
  ALTER TABLE learner ADD COLUMN profile TEXT;
  ALTER TABLE certificates ADD COLUMN tags TEXT;

  CREATE TABLE logged_entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    organiser TEXT NOT NULL,
    activity TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes > 0),
    tags TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('self-reported', 'unverified')),
    legacy_id TEXT UNIQUE,
    created_at TEXT NOT NULL
  );
  INSERT INTO logged_entries (id, date, title, organiser, activity, minutes, tags, source, legacy_id, created_at)
    SELECT id, date, title, provider, 'course', max(1, CAST(round(hours * 60) AS INTEGER)),
      '{"' || CASE field
        WHEN 'Ethics' THEN 'ethics'
        WHEN 'Auditing' THEN 'auditing-standards'
        WHEN 'Accounting' THEN 'accounting-standards'
        WHEN 'Taxation' THEN 'tax'
        WHEN 'Practice Management' THEN 'practice'
        ELSE 'other'
      END || '":' || max(1, CAST(round(hours * 60) AS INTEGER)) || '}',
      source, legacy_id, created_at
    FROM logged;
  DROP TABLE logged;
  ALTER TABLE logged_entries RENAME TO logged;

  CREATE TABLE declared (
    entry_id TEXT PRIMARY KEY,
    declared_at TEXT NOT NULL
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
  readonly tags: TagMinutes;
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

/** An entry from the prototype, already in today's shape, with the id it had in the browser. */
export type LegacyEntry = Omit<LoggedEntry, "source">;

/** The prototype's browser record, read loosely: anything malformed is skipped rather than refused. */
export interface Legacy {
  readonly learner?: string;
  readonly logged: readonly LegacyEntry[];
  readonly certificates: readonly LegacyEntry[];
  readonly positions: readonly { courseId: string; version: number; position: number }[];
}

const toCertificate = (row: Row): Certificate => {
  const field = oneOf(row, "field", check.FIELDS);
  const credits = real(row, "credits");
  const minutes = Math.round(credits * 60);
  return {
    id: text(row, "id"),
    courseId: text(row, "course_id"),
    version: integer(row, "version"),
    issuedAt: text(row, "issued_at"),
    name: text(row, "name"),
    correct: integer(row, "correct"),
    total: integer(row, "total"),
    title: text(row, "title"),
    provider: text(row, "provider"),
    field,
    level: oneOf(row, "level", check.LEVELS),
    credits,
    tags: optionalText(row, "tags") === null ? wholeUnder(field, minutes) : check.tagMinutes(json(row, "tags"), "tags", minutes),
  };
};

const toLogged = (row: Row): LoggedEntry => {
  const minutes = integer(row, "minutes");
  const activity = text(row, "activity");
  if (!isActivity(activity)) throw new Unreadable(`activity is ${activity}`);
  return {
    id: text(row, "id"),
    date: check.isoDate(text(row, "date"), "date"),
    title: text(row, "title"),
    organiser: text(row, "organiser"),
    activity,
    minutes,
    tags: check.tagMinutes(json(row, "tags"), "tags", minutes),
    source: oneOf(row, "source", ["self-reported", "unverified"] as const),
  };
};

const orders = (value: unknown): number[][] => check.list(value, "orders").map((o, i) => check.list(o, `orders[${i}]`, 4).map((n, j) => check.integerIn(n, `orders[${i}][${j}]`, 0, 3)));

/** A certificate id: readable prefix, then ten random characters so ids cannot be guessed or walked. */
function certificateId(courseId: string, at: Date): string {
  const code = courseId
    .split("-")
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 6);
  return `TRIA-${code}-${mytDate(at).replaceAll("-", "")}-${unguessable(10)}`;
}

export function createLearner(db: Db, now: () => Date = () => new Date(), warn: Warn = console.error) {
  migrate(db, MIGRATIONS);
  const iso = () => now().toISOString();

  const learnerRow = () => db.prepare("SELECT * FROM learner WHERE id = 1").get()!;

  /**
   * What was heard of one version, and where to resume. Ranges that no longer read count as none heard and are logged:
   * the next accepted report rewrites them, so one bad row never stops a listener earning credit.
   */
  const listening = (courseId: string, version: number): { ranges: Range[]; position: number } => {
    const row = db.prepare("SELECT * FROM listening WHERE course_id = ? AND version = ?").get(courseId, version);
    if (!row) return { ranges: [], position: 0 };
    const [ranges] = readable([row], (r) => check.ranges(json(r, "ranges"), "ranges"), warn, () => `heard ranges on "${courseId}" version ${version}`);
    return { ranges: ranges ?? [], position: real(row, "position") };
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

  /** Adds a logged entry. One brought across from the prototype is keyed by its old id, so it is added once. */
  const insertLogged = (e: LoggedEntry, legacyId: string | null) =>
    db
      .prepare("INSERT OR IGNORE INTO logged (id, date, title, organiser, activity, minutes, tags, source, legacy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(e.id, e.date, e.title, e.organiser, e.activity, e.minutes, JSON.stringify(e.tags), e.source, legacyId, iso());

  const learner = {
    pins,

    /** The whole record. A part whose stored shape no longer reads is left out and logged, so the rest still loads. */
    snapshot(): AppState {
      const row = learnerRow();
      const [profile] = readable([row], (r): MemberProfile => (optionalText(r, "profile") === null ? defaultProfile : check.profile(json(r, "profile"))), warn, () => "profile");
      const courses = Object.entries(pins()).map(([courseId, version]) => ({ course_id: courseId, version }));
      return {
        learner: text(row, "name"),
        progress: Object.fromEntries(readable(courses, (c) => [text(c, "course_id"), progress(text(c, "course_id"), integer(c, "version"))] as const, warn, (c) => `progress on "${String(c.course_id)}"`)),
        certificates: readable(db.prepare("SELECT * FROM certificates ORDER BY issued_at").all(), toCertificate, warn, (r) => `certificate ${String(r.id)}`),
        profile: profile ?? defaultProfile,
        logged: readable(db.prepare("SELECT * FROM logged ORDER BY date, created_at").all(), toLogged, warn, (r) => `logged entry ${String(r.id)}`),
        declared: db.prepare("SELECT entry_id FROM declared ORDER BY entry_id").all().map((r) => text(r, "entry_id")),
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
            tags: course.tags,
          };
          const c = certificate;
          db.prepare(
            `INSERT INTO certificates (id, course_id, version, issued_at, name, correct, total, title, provider, field, level, credits, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(c.id, c.courseId, c.version, c.issuedAt, c.name, c.correct, c.total, c.title, c.provider, c.field, c.level, c.credits, JSON.stringify(c.tags));
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

    setProfile(profile: MemberProfile): void {
      db.prepare("UPDATE learner SET profile = ? WHERE id = 1").run(JSON.stringify(profile));
    },

    log(entry: Omit<LoggedEntry, "id" | "source">): LoggedEntry {
      const logged: LoggedEntry = { ...entry, id: unguessable(12), source: "self-reported" };
      insertLogged(logged, null);
      return logged;
    },

    /** Removes an entry the learner logged or brought across. Issued certificates are not entries and stay. */
    unlog(id: string): boolean {
      return db.transaction(() => {
        const removed = db.prepare("DELETE FROM logged WHERE id = ?").run(id).changes > 0;
        if (removed) db.prepare("DELETE FROM declared WHERE entry_id = ?").run(id);
        return removed;
      });
    },

    /**
     * Records whether the member has entered a certificate or a logged entry in the MIA portal. False when the id is
     * neither. Setting it to what it already is changes nothing.
     */
    setDeclared(id: string, declared: boolean): boolean {
      return db.transaction(() => {
        if (!db.prepare("SELECT 1 AS found FROM certificates WHERE id = ? UNION ALL SELECT 1 FROM logged WHERE id = ?").get(id, id)) return false;
        if (declared) db.prepare("INSERT OR IGNORE INTO declared (entry_id, declared_at) VALUES (?, ?)").run(id, iso());
        else db.prepare("DELETE FROM declared WHERE entry_id = ?").run(id);
        return true;
      });
    },

    /**
     * Brings the prototype's browser record into the account. Each item is keyed by its old id, so importing the same
     * browser twice, or a second browser, adds only what is new. Logged hours come in as self-reported and old
     * certificates as unverified claims. Listening evidence never comes in: only a resume position does. Nor does the
     * requirement the prototype let a learner set: MIA's rules replaced it.
     */
    importLegacy(legacy: Legacy): void {
      db.transaction(() => {
        const row = learnerRow();
        if (legacy.learner && !text(row, "name")) db.prepare("UPDATE learner SET name = ? WHERE id = 1").run(legacy.learner);
        for (const e of legacy.logged) insertLogged({ ...e, id: unguessable(12), source: "self-reported" }, `logged:${e.id}`);
        for (const c of legacy.certificates) insertLogged({ ...c, id: unguessable(12), source: "unverified" }, `certificate:${c.id}`);
        for (const p of legacy.positions) {
          db.prepare("INSERT OR IGNORE INTO listening (course_id, version, position, updated_at) VALUES (?, ?, ?, ?)").run(p.courseId, p.version, p.position, iso());
        }
      });
    },
  };
  return learner;
}

export type Learner = ReturnType<typeof createLearner>;
