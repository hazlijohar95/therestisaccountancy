import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type Db } from './db.ts';

/** A node:sqlite database with the club's schema, for tests. Pass ':memory:' for a throwaway one. */
export function openDatabase(path: string): Db & { close(): void } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const db: Db & { close(): void } = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
        run: (...params) => {
          const { changes, lastInsertRowid } = statement.run(...params);
          return { changes: Number(changes), lastInsertRowid: Number(lastInsertRowid) };
        },
      };
    },
    exec: (sql) => sqlite.exec(sql),
    transaction(fn) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => sqlite.close(),
  };
  migrate(db);
  return db;
}
