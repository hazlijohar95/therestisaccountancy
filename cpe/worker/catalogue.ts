import type { StudioVersion, VersionStatus } from "../src/domain/api.ts";
import { wholeUnder, type TagMinutes } from "../src/domain/subjects.ts";
import type { Audio, CourseScript, Field, Level, Show, Timing } from "../src/domain/types.ts";
import { integer, json, migrate, oneOf, optionalText, readable, real, text, type Db, type Row, type Warn } from "./db.ts";
import { scripts as seedScripts, shows as seedShows } from "./seed/catalog.ts";
import seedTimings from "./seed/timings.json" with { type: "json" };
import * as check from "./validate.ts";

/**
 * The catalogue: shows, courses and every version of each course, and the public register of issued certificates.
 * One instance serves everyone. A published version never changes; editing a course starts a new draft version.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE shows (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    blurb TEXT NOT NULL,
    art TEXT NOT NULL CHECK (art IN ('mic', 'papers'))
  );

  CREATE TABLE courses (
    id TEXT PRIMARY KEY,
    show_id TEXT NOT NULL REFERENCES shows (id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE versions (
    course_id TEXT NOT NULL REFERENCES courses (id),
    version INTEGER NOT NULL CHECK (version > 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
    script TEXT NOT NULL,
    audio TEXT,
    timing TEXT,
    author TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    PRIMARY KEY (course_id, version)
  );
  CREATE UNIQUE INDEX one_draft_per_course ON versions (course_id) WHERE status = 'draft';

  CREATE TABLE issued (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    course_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    field TEXT NOT NULL,
    level TEXT NOT NULL,
    credits REAL NOT NULL,
    issued_at TEXT NOT NULL
  );
  `,
  /* The register carries a certificate's minutes per subject. One recorded before this reads as its whole credit under its field. */
  `ALTER TABLE issued ADD COLUMN tags TEXT;`,
];

export type Status = VersionStatus;

/** One version of a course as stored: the author's script with answers, and its audio and timings once attached. */
export type Entry = StudioVersion;

/** A published version with everything needed to play it. */
export interface Published extends Entry {
  readonly status: "published";
  readonly show: Show;
  readonly audio: Audio;
  readonly timing: Timing;
}

/** What the public verification page shows: enough to confirm a certificate, nothing more. */
export interface Issued {
  readonly id: string;
  readonly name: string;
  readonly courseId: string;
  readonly version: number;
  readonly title: string;
  readonly field: Field;
  readonly level: Level;
  readonly credits: number;
  readonly tags: TagMinutes;
  readonly issuedAt: string;
}

export interface CourseSummary {
  readonly id: string;
  readonly title: string;
  readonly showId: string;
  readonly versions: readonly { version: number; status: Status; updatedAt: string; publishedAt: string | null }[];
}

export type PublishProblem = string;

const toEntry = (row: Row): Entry => ({
  courseId: text(row, "course_id"),
  version: integer(row, "version"),
  status: oneOf(row, "status", ["draft", "published"] as const),
  script: check.script(json(row, "script")),
  audio: optionalText(row, "audio") === null ? null : check.audio(json(row, "audio")),
  timing: optionalText(row, "timing") === null ? null : check.timing(json(row, "timing")),
  author: text(row, "author"),
  updatedAt: text(row, "updated_at"),
  publishedAt: optionalText(row, "published_at"),
});

const versionName = (row: Row) => `version ${String(row.version)} of course "${String(row.course_id)}"`;

const toShow = (row: Row): Show => check.show({ id: row.id, title: row.title, blurb: row.blurb, art: row.art });

/** Why a version cannot be published yet, in words an author can act on. Empty when it can. */
export function publishProblems(entry: Pick<Entry, "script" | "audio" | "timing">): PublishProblem[] {
  const { script, audio, timing } = entry;
  const problems: string[] = [];
  if (script.segments.length === 0) problems.push("Add the transcript.");
  if (script.quiz.length === 0) problems.push("Add at least one assessment question.");
  if (!audio) problems.push("Upload the audio.");
  if (!timing) problems.push("Set when each transcript segment starts.");
  if (timing && timing.segments.length !== script.segments.length) problems.push("Every transcript segment needs a start time. Set the timings again.");
  if (audio && timing && Math.abs(audio.duration - timing.duration) > 1) problems.push("The timings were set for different audio. Set them again.");
  for (const [i, c] of script.checkpoints.entries()) {
    if (c.afterSegment >= script.segments.length) problems.push(`Review question ${i + 1} is placed after a segment that no longer exists.`);
  }
  return problems;
}

/** The sample courses' scripts and the timings measured from their rendered audio. */
export interface SeedSource {
  readonly shows: readonly Show[];
  readonly scripts: readonly CourseScript[];
  readonly timings: Readonly<Record<string, SeedTiming | undefined>>;
}

export interface SeedTiming {
  readonly duration: number;
  readonly segments: readonly { start: number; end: number }[];
  readonly peaks: readonly number[];
}

/** Why a sample course cannot be seeded from its timings, or null when it can. */
export function seedProblem(script: CourseScript, timing: SeedTiming | undefined): string | null {
  if (!timing) return `Seed audio for "${script.id}" is missing. Run pnpm audio.`;
  if (timing.segments.length !== script.segments.length) return `Seed audio for "${script.id}" is stale: ${timing.segments.length} timed segments for ${script.segments.length} in the script. Run pnpm audio.`;
  return null;
}

export function createCatalogue(db: Db, now: () => Date = () => new Date(), warn: Warn = console.error) {
  migrate(db, MIGRATIONS);
  const iso = () => now().toISOString();

  const showById = (id: string): Show | null => {
    const row = db.prepare("SELECT * FROM shows WHERE id = ?").get(id);
    return row ? toShow(row) : null;
  };

  const entry = (courseId: string, version: number): Entry | null => {
    const row = db.prepare("SELECT * FROM versions WHERE course_id = ? AND version = ?").get(courseId, version);
    return row ? toEntry(row) : null;
  };

  const asPublished = (e: Entry | null): Published | null => {
    if (!e || e.status !== "published" || !e.audio || !e.timing) return null;
    const show = showById(e.script.showId);
    return show ? { ...e, status: "published", show, audio: e.audio, timing: e.timing } : null;
  };

  const draftOf = (courseId: string): Entry | null => {
    const row = db.prepare("SELECT * FROM versions WHERE course_id = ? AND status = 'draft'").get(courseId);
    return row ? toEntry(row) : null;
  };

  const write = (courseId: string, version: number, status: Status, script: CourseScript, audio: Audio | null, timing: Timing | null, author: string) => {
    const at = iso();
    db.prepare(
      `INSERT INTO versions (course_id, version, status, script, audio, timing, author, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(courseId, version, status, JSON.stringify(script), audio ? JSON.stringify(audio) : null, timing ? JSON.stringify(timing) : null, author, at, at, status === "published" ? at : null);
  };

  const catalogue = {
    /**
     * Puts the sample courses in the catalogue where they are missing, with their audio served from the app's static
     * files. Safe on every start. A course already in the catalogue is never checked or touched again, and a sample whose
     * timings no longer fit its script is skipped and logged rather than failing the start: the catalogue serves
     * everyone. `pnpm test` refuses stale timings before they ship.
     */
    seed(source: SeedSource = { shows: seedShows, scripts: seedScripts, timings: seedTimings }): void {
      db.transaction(() => {
        for (const show of source.shows) {
          db.prepare("INSERT OR IGNORE INTO shows (id, title, blurb, art) VALUES (?, ?, ?, ?)").run(show.id, show.title, show.blurb, show.art);
        }
        for (const script of source.scripts) {
          if (db.prepare("SELECT 1 FROM courses WHERE id = ?").get(script.id)) continue;
          const problem = seedProblem(script, source.timings[script.id]);
          if (problem) {
            warn(problem);
            continue;
          }
          const t = source.timings[script.id]!;
          db.prepare("INSERT INTO courses (id, show_id, created_at) VALUES (?, ?, ?)").run(script.id, script.showId, iso());
          write(script.id, 1, "published", script, { url: `/audio/${script.id}.m4a`, duration: t.duration, peaks: t.peaks }, { duration: t.duration, segments: t.segments }, "seed");
        }
      });
    },

    shows(): Show[] {
      return db.prepare("SELECT * FROM shows ORDER BY rowid").all().map(toShow);
    },

    /**
     * The newest published version of every course, in the order courses were added. A version that no longer reads is
     * logged and passed over for the one before it, so one bad row hides nothing that can still be played.
     */
    latest(): Published[] {
      const rows = db
        .prepare(
          `SELECT v.* FROM versions v JOIN courses c ON c.id = v.course_id
           WHERE v.status = 'published' ORDER BY c.rowid, v.version DESC`,
        )
        .all();
      const chosen = new Map<string, Published>();
      for (const row of rows) {
        const courseId = text(row, "course_id");
        if (chosen.has(courseId)) continue;
        const [p] = readable([row], (r) => asPublished(toEntry(r)), warn, versionName);
        if (p) chosen.set(courseId, p);
      }
      return [...chosen.values()];
    },

    /** One published version, for playing, grading or pinning a listener to it. Null for drafts and unknown versions. */
    published(courseId: string, version: number): Published | null {
      return asPublished(entry(courseId, version));
    },

    /* Studio */

    courses(): CourseSummary[] {
      const rows = db.prepare("SELECT c.id, c.show_id, c.rowid FROM courses c ORDER BY c.rowid").all();
      return rows.map((row) => {
        const id = text(row, "id");
        const versions = readable(
          db.prepare("SELECT course_id, version, status, updated_at, published_at, script FROM versions WHERE course_id = ? ORDER BY version DESC").all(id),
          (v) => ({ version: integer(v, "version"), status: oneOf(v, "status", ["draft", "published"] as const), updatedAt: text(v, "updated_at"), publishedAt: optionalText(v, "published_at"), title: check.script(json(v, "script")).title }),
          warn,
          versionName,
        );
        return { id, showId: text(row, "show_id"), title: versions[0]?.title ?? id, versions: versions.map(({ title: _t, ...v }) => v) };
      });
    },

    entry,
    draft: draftOf,

    /** A new course, as a first draft. Refused if the id is taken or the show does not exist. */
    create(script: CourseScript, author: string): Entry | "taken" | "no-show" {
      return db.transaction(() => {
        if (!showById(script.showId)) return "no-show";
        if (db.prepare("SELECT 1 FROM courses WHERE id = ?").get(script.id)) return "taken";
        db.prepare("INSERT INTO courses (id, show_id, created_at) VALUES (?, ?, ?)").run(script.id, script.showId, iso());
        write(script.id, 1, "draft", script, null, null, author);
        return entry(script.id, 1)!;
      });
    },

    /**
     * The course's draft, starting one from its newest version if there is none. The new draft copies the script, audio
     * and timings, so a small edit needs no new upload.
     */
    openDraft(courseId: string, author: string): Entry | null {
      return db.transaction(() => {
        const existing = draftOf(courseId);
        if (existing) return existing;
        const last = db.prepare("SELECT * FROM versions WHERE course_id = ? ORDER BY version DESC LIMIT 1").get(courseId);
        if (!last) return null;
        const from = toEntry(last);
        write(courseId, from.version + 1, "draft", from.script, from.audio, from.timing, author);
        return draftOf(courseId);
      });
    },

    /** Saves changes to the draft. The script's id cannot change, and a changed transcript keeps timings only if they still fit. */
    saveDraft(courseId: string, changes: { script?: CourseScript; audio?: Audio | null; timing?: Timing | null }, author: string): Entry | "no-draft" | "no-show" {
      return db.transaction(() => {
        const draft = draftOf(courseId);
        if (!draft) return "no-draft";
        const script = changes.script ? { ...changes.script, id: courseId } : draft.script;
        if (!showById(script.showId)) return "no-show";
        const audio = changes.audio === undefined ? draft.audio : changes.audio;
        let timing = changes.timing === undefined ? draft.timing : changes.timing;
        if (changes.audio !== undefined && changes.timing === undefined) timing = null;
        db.prepare("UPDATE versions SET script = ?, audio = ?, timing = ?, author = ?, updated_at = ? WHERE course_id = ? AND version = ?").run(
          JSON.stringify(script),
          audio ? JSON.stringify(audio) : null,
          timing ? JSON.stringify(timing) : null,
          author,
          iso(),
          courseId,
          draft.version,
        );
        if (script.showId !== draft.script.showId) db.prepare("UPDATE courses SET show_id = ? WHERE id = ?").run(script.showId, courseId);
        return draftOf(courseId)!;
      });
    },

    /** Publishes the draft as it stands. From here on that version never changes. */
    publish(courseId: string, author: string): Published | PublishProblem[] {
      return db.transaction(() => {
        const draft = draftOf(courseId);
        if (!draft) return ["There is no draft to publish."];
        const problems = publishProblems(draft);
        if (problems.length) return problems;
        db.prepare("UPDATE versions SET status = 'published', published_at = ?, author = ? WHERE course_id = ? AND version = ?").run(iso(), author, courseId, draft.version);
        return asPublished(entry(courseId, draft.version)) ?? ["The course's show no longer exists."];
      });
    },

    discardDraft(courseId: string): boolean {
      return db.transaction(() => {
        const draft = draftOf(courseId);
        if (!draft) return false;
        db.prepare("DELETE FROM versions WHERE course_id = ? AND version = ?").run(courseId, draft.version);
        if (!db.prepare("SELECT 1 FROM versions WHERE course_id = ?").get(courseId)) db.prepare("DELETE FROM courses WHERE id = ?").run(courseId);
        return true;
      });
    },

    /* The register of issued certificates */

    /** Records a certificate on the public register. Recording the same one twice changes nothing. */
    register(cert: Issued): void {
      db.prepare(
        `INSERT OR IGNORE INTO issued (id, name, course_id, version, title, field, level, credits, tags, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(cert.id, cert.name, cert.courseId, cert.version, cert.title, cert.field, cert.level, cert.credits, JSON.stringify(cert.tags), cert.issuedAt);
    },

    verify(id: string): Issued | null {
      const row = db.prepare("SELECT * FROM issued WHERE id = ?").get(id);
      if (!row) return null;
      const field = oneOf(row, "field", check.FIELDS);
      const credits = real(row, "credits");
      const minutes = Math.round(credits * 60);
      return {
        id: text(row, "id"),
        name: text(row, "name"),
        courseId: text(row, "course_id"),
        version: integer(row, "version"),
        title: text(row, "title"),
        field,
        level: oneOf(row, "level", check.LEVELS),
        credits,
        tags: optionalText(row, "tags") === null ? wholeUnder(field, minutes) : check.tagMinutes(json(row, "tags"), "tags", minutes),
        issuedAt: text(row, "issued_at"),
      };
    },
  };
  return catalogue;
}

export type Catalogue = ReturnType<typeof createCatalogue>;
