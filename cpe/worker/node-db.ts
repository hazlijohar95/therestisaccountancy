import { DatabaseSync } from "node:sqlite";
import type { Db } from "./db.ts";

/** A throwaway node:sqlite database as a Db, for tests. */
export function memoryDb(): Db {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
        run: (...params) => ({ changes: Number(statement.run(...params).changes) }),
      };
    },
    exec: (sql) => sqlite.exec(sql),
    transaction(fn) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
