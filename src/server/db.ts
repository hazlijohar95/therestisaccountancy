import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { fail, ok, type Result } from './result.ts';

/**
 * The schema as an append-only list of migrations. `PRAGMA user_version` records how many have run, so each runs once,
 * in order, inside its own transaction. Never edit a migration that has shipped: add a new one.
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
];

/** Opens the club's database and brings its schema up to date. Pass ':memory:' for a throwaway one. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get();
  const applied = row ? integer(row, 'user_version') : 0;
  if (applied > MIGRATIONS.length) throw new Error(`The database is at schema ${applied}, newer than this code (${MIGRATIONS.length}).`);
  MIGRATIONS.slice(applied).forEach((sql, i) => {
    transaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${applied + i + 1}`);
    });
  });
}

export type Row = Record<string, SQLOutputValue>;

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

/** Runs fn inside one transaction: all of it lands, or none of it does. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

class Refused extends Error {}

/**
 * Runs fn in one transaction. fn may call refuse(reason) at any point, before or after writing: the transaction
 * rolls back and the caller gets that reason. Checking an invariant after the write is what makes it race-proof.
 */
export function attempt<T, R extends string>(db: DatabaseSync, fn: (refuse: (reason: R) => never) => T): Result<T, R> {
  let refusal: R | undefined;
  const refuse = (reason: R): never => {
    refusal = reason;
    throw new Refused(reason);
  };
  try {
    return ok(transaction(db, () => fn(refuse)));
  } catch (error) {
    if (error instanceof Refused && refusal !== undefined) return fail(refusal);
    throw error;
  }
}

/** A single number from a COUNT(*) AS n query. */
export function count(row: Row | undefined): number {
  return row ? integer(row, 'n') : 0;
}
