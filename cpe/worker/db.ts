/*
 * SQLite behind one small interface, in the club's style (site/src/server/db.ts): a Durable Object's storage in
 * production and node:sqlite in tests. Both are synchronous, so a transaction can check after it writes.
 */

import { Invalid } from "./validate.ts";

export type Value = string | number | bigint | null | Uint8Array | ArrayBuffer;
export type Param = string | number | null;
export type Row = Record<string, Value>;

export interface Statement {
  get(...params: Param[]): Row | undefined;
  all(...params: Param[]): Row[];
  run(...params: Param[]): { changes: number };
}

export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
}

/**
 * Brings a schema up to date from an append-only list of migrations. schema_version records how many have run, so
 * each runs once, in order, in its own transaction. Never edit a migration that has shipped: add a new one.
 */
export function migrate(db: Db, migrations: readonly string[]): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)");
  const applied = integer(db.prepare("SELECT count(*) AS n FROM schema_version").get() ?? { n: 0 }, "n");
  if (applied > migrations.length) throw new Error(`The database is at schema ${applied}, newer than this code (${migrations.length}).`);
  migrations.slice(applied).forEach((sql, i) => {
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(applied + i + 1);
    });
  });
}

/** A Durable Object's SQLite as a Db. */
export function durableDb(storage: DurableObjectStorage): Db {
  const { sql } = storage;
  return {
    prepare: (query) => ({
      get: (...params) => sql.exec(query, ...params).toArray()[0],
      all: (...params) => sql.exec(query, ...params).toArray(),
      run: (...params) => ({ changes: sql.exec(query, ...params).rowsWritten }),
    }),
    exec: (query) => {
      sql.exec(query);
    },
    transaction: (fn) => storage.transactionSync(fn),
  };
}

/** A stored value whose shape this code does not read: the schema or a stored document and the code disagree. */
export class Unreadable extends Error {}

/* Rows come back loosely typed. These read one column and fail loudly if the schema and the code disagree. */
export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new Unreadable(`${column} is not text`);
  return value;
}

export function optionalText(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== "string") throw new Unreadable(`${column} is not text`);
  return value;
}

export function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Unreadable(`${column} is not an integer`);
  return value;
}

export function real(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number") throw new Unreadable(`${column} is not a number`);
  return value;
}

export function oneOf<const T extends string>(row: Row, column: string, allowed: readonly T[]): T {
  const value = text(row, column);
  const match = allowed.find((option) => option === value);
  if (match === undefined) throw new Unreadable(`${column} is ${value}, not one of ${allowed.join(", ")}`);
  return match;
}

/** A JSON column, parsed. Its shape is the writer's: every JSON column here is written by this code only. */
export function json(row: Row, column: string): unknown {
  try {
    return JSON.parse(text(row, column));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Unreadable(`${column} is not JSON`);
    throw error;
  }
}

/** Where a store reports data it had to skip. console.error in production, which Workers observability keeps. */
export type Warn = (message: string) => void;

/**
 * A row whose stored shape the code no longer reads: a refusal from the readers above or from a validator. A TypeError
 * is a bug in the code, not in the data, so it is never caught here.
 */
const unreadable = (error: unknown): error is Error => error instanceof Unreadable || error instanceof Invalid;

/**
 * Reads every row it can and skips, with a warning, the ones whose stored shape no longer reads. One old or damaged
 * row then costs only itself, not every listing that includes it. Anything else, such as a SQL error or a bug, still throws.
 */
export function readable<T>(rows: readonly Row[], read: (row: Row) => T, warn: Warn, what: (row: Row) => string): T[] {
  return rows.flatMap((row) => {
    try {
      return [read(row)];
    } catch (error) {
      if (!unreadable(error)) throw error;
      warn(`Skipped unreadable ${what(row)}: ${error.message}`);
      return [];
    }
  });
}
