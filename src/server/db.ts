import { fail, ok, type Result } from './result.ts';

export type Value = string | number | bigint | null | Uint8Array | ArrayBuffer;
export type Param = string | number | null;
export type Row = Record<string, Value>;

export interface Statement {
  get(...params: Param[]): Row | undefined;
  all(...params: Param[]): Row[];
  run(...params: Param[]): { changes: number; lastInsertRowid: number };
}

/**
 * The SQLite the club runs on: a Durable Object's storage in production, node:sqlite in tests. Both are synchronous,
 * which is what lets attempt() check an invariant after a write and still roll the write back.
 */
export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
}

/**
 * The schema as an append-only list of migrations. The schema_version table records how many have run, so each runs
 * once, in order, inside its own transaction. Never edit a migration that has shipped: add a new one.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS join_requests (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    stage TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'declined')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    decided_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request_per_email ON join_requests (email) WHERE status = 'pending';

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    password_hash TEXT,
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS invites (
    token_hash TEXT PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS lesson_progress (
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (member_id, lesson_id)
  );
  `,
  `
  ALTER TABLE members ADD COLUMN suspended_at TEXT;
  ALTER TABLE members ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE join_requests ADD COLUMN member_id INTEGER REFERENCES members (id) ON DELETE CASCADE;
  UPDATE join_requests SET member_id = (SELECT id FROM members WHERE members.email = join_requests.email) WHERE status = 'invited';
  `,
  `
  CREATE TABLE threads (
    id INTEGER PRIMARY KEY,
    channel TEXT NOT NULL,
    title TEXT NOT NULL,
    author_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    last_post_at TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    removed_at TEXT
  );
  CREATE INDEX threads_by_channel ON threads (channel, pinned DESC, last_post_at DESC, id DESC) WHERE removed_at IS NULL;
  CREATE INDEX threads_by_activity ON threads (last_post_at DESC, id DESC) WHERE removed_at IS NULL;

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    thread_id INTEGER NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    edited_at TEXT,
    deleted_at TEXT
  );
  CREATE INDEX posts_by_thread ON posts (thread_id, id);
  CREATE INDEX posts_by_author ON posts (author_id, created_at);
  `,
  `
  ALTER TABLE invites ADD COLUMN created_at TEXT;
  `,
  `
  CREATE TABLE form_posts (key TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX form_posts_by_key ON form_posts (key);
  CREATE INDEX form_posts_by_time ON form_posts (at);
  `,
  `
  ALTER TABLE members ADD COLUMN email_replies INTEGER NOT NULL DEFAULT 1 CHECK (email_replies IN (0, 1));
  ALTER TABLE members ADD COLUMN email_digest INTEGER NOT NULL DEFAULT 1 CHECK (email_digest IN (0, 1));

  CREATE TABLE reply_notices (
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    thread_id INTEGER NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (member_id, thread_id)
  );

  CREATE TABLE digests (week TEXT PRIMARY KEY, sent_at TEXT NOT NULL);

  CREATE TABLE live_sessions (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes > 0),
    link TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    reminded_at TEXT,
    cancelled_at TEXT
  );
  CREATE INDEX live_sessions_by_start ON live_sessions (starts_at);

  CREATE TABLE rsvps (
    session_id INTEGER NOT NULL REFERENCES live_sessions (id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, member_id)
  );
  `,
  `
  CREATE TABLE subscriptions (
    member_id INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
    paid_until TEXT NOT NULL,
    card_token TEXT,
    renews INTEGER NOT NULL DEFAULT 1 CHECK (renews IN (0, 1)),
    last_attempt_at TEXT
  );

  CREATE TABLE payments (
    purchase_id TEXT PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('checkout', 'renewal')),
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
    created_at TEXT NOT NULL,
    paid_at TEXT
  );
  CREATE INDEX payments_by_member ON payments (member_id, created_at);
  `,
  `
  ALTER TABLE subscriptions ADD COLUMN reminded_for TEXT;
  `,
  `
  ALTER TABLE members ADD COLUMN digest_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (digest_opt_in IN (0, 1));
  ALTER TABLE members DROP COLUMN email_digest;
  ALTER TABLE members ADD COLUMN unsubscribe_key TEXT;
  UPDATE members SET unsubscribe_key = lower(hex(randomblob(16)));
  CREATE UNIQUE INDEX members_by_unsubscribe_key ON members (unsubscribe_key);
  `,
  `
  CREATE TABLE incidents (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, reported_at TEXT);
  CREATE INDEX incidents_unreported ON incidents (reported_at, id);
  `,
  `
  ALTER TABLE payments ADD COLUMN reversed_at TEXT;
  `,
  `
  CREATE TABLE plans (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    answers TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    submitted_at TEXT,
    reply TEXT,
    replied_by INTEGER REFERENCES members (id) ON DELETE SET NULL,
    replied_at TEXT
  );
  CREATE UNIQUE INDEX one_open_plan_per_member ON plans (member_id) WHERE replied_at IS NULL;
  CREATE INDEX plans_by_member ON plans (member_id, created_at);

  CREATE TABLE call_slots (
    id INTEGER PRIMARY KEY,
    host_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
    starts_at TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes > 0),
    link TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cancelled_at TEXT,
    booked_by INTEGER REFERENCES members (id) ON DELETE SET NULL,
    booked_at TEXT,
    topic TEXT,
    reminded_at TEXT
  );
  CREATE INDEX call_slots_by_start ON call_slots (starts_at);
  CREATE INDEX call_slots_by_booker ON call_slots (booked_by) WHERE booked_by IS NOT NULL;

  CREATE TABLE listings (
    member_id INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
    practice TEXT NOT NULL,
    state TEXT NOT NULL,
    town TEXT NOT NULL,
    remote INTEGER NOT NULL DEFAULT 0 CHECK (remote IN (0, 1)),
    services TEXT NOT NULL DEFAULT '[]',
    niche TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL,
    qualifications TEXT NOT NULL,
    website TEXT,
    contact_email TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_at TEXT,
    approved_by INTEGER REFERENCES members (id) ON DELETE SET NULL,
    returned_note TEXT,
    paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1))
  );

  CREATE TABLE fee_responses (
    id INTEGER PRIMARY KEY,
    edition INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    stage TEXT NOT NULL,
    years TEXT NOT NULL,
    state TEXT NOT NULL,
    team TEXT NOT NULL,
    niche INTEGER NOT NULL CHECK (niche IN (0, 1)),
    pricing TEXT NOT NULL,
    hourly INTEGER,
    bookkeeping INTEGER,
    tax_return INTEGER,
    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 5),
    CHECK (hourly IS NOT NULL OR bookkeeping IS NOT NULL OR tax_return IS NOT NULL)
  );
  CREATE INDEX fee_responses_by_edition ON fee_responses (edition);

  CREATE TABLE fee_editions (
    edition INTEGER PRIMARY KEY,
    published_at TEXT,
    published_by INTEGER REFERENCES members (id) ON DELETE SET NULL
  );

  ALTER TABLE subscriptions ADD COLUMN term TEXT NOT NULL DEFAULT 'month' CHECK (term IN ('month', 'year'));
  ALTER TABLE payments ADD COLUMN term TEXT NOT NULL DEFAULT 'month' CHECK (term IN ('month', 'year'));
  `,
  `
  ALTER TABLE listings ADD COLUMN declared_at TEXT;
  `,
  `
  ALTER TABLE subscriptions ADD COLUMN noticed_for TEXT;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Brings the schema up to date. Safe to run on every start. */
export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  const applied = count(db.prepare('SELECT count(*) AS n FROM schema_version').get());
  if (applied > MIGRATIONS.length) throw new Error(`The database is at schema ${applied}, newer than this code (${MIGRATIONS.length}).`);
  MIGRATIONS.slice(applied).forEach((sql, i) => {
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(applied + i + 1);
    });
  });
}

/* Rows come back loosely typed. These read one column and fail loudly if the schema and the code disagree. */
export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new TypeError(`${column} is not text`);
  return value;
}

export function optionalText(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${column} is not text`);
  return value;
}

export function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(`${column} is not an integer`);
  return value;
}

export function oneOf<const T extends string>(row: Row, column: string, allowed: readonly T[]): T {
  const value = text(row, column);
  const match = allowed.find((option) => option === value);
  if (match === undefined) throw new TypeError(`${column} is ${value}, not one of ${allowed.join(', ')}`);
  return match;
}

class Refused extends Error {}

/**
 * Runs fn in one transaction. fn may call refuse(reason) at any point, before or after writing: the transaction
 * rolls back and the caller gets that reason. Checking an invariant after the write is what makes it race-proof.
 */
export function attempt<T, R extends string>(db: Db, fn: (refuse: (reason: R) => never) => T): Result<T, R> {
  let refusal: R | undefined;
  const refuse = (reason: R): never => {
    refusal = reason;
    throw new Refused(reason);
  };
  try {
    return ok(db.transaction(() => fn(refuse)));
  } catch (error) {
    if (error instanceof Refused && refusal !== undefined) return fail(refusal);
    throw error;
  }
}

/** A single number from a COUNT(*) AS n query. */
export function count(row: Row | undefined): number {
  return row ? integer(row, 'n') : 0;
}
