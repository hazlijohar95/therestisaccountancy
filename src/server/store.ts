import { DurableObject } from 'cloudflare:workers';
import { createClub } from './club.ts';
import { createCommunity } from './community.ts';
import { migrate, type Db } from './db.ts';

/** The Durable Object's SQLite behind the club's Db interface. */
function durableDb(storage: DurableObjectStorage): Db {
  const { sql } = storage;
  return {
    prepare: (query) => ({
      get: (...params) => sql.exec(query, ...params).toArray()[0],
      all: (...params) => sql.exec(query, ...params).toArray(),
      run: (...params) => {
        sql.exec(query, ...params);
        const row = sql.exec<{ changes: number; id: number }>('SELECT changes() AS changes, last_insert_rowid() AS id').one();
        return { changes: row.changes, lastInsertRowid: row.id };
      },
    }),
    exec: (query) => {
      sql.exec(query);
    },
    transaction: (fn) => storage.transactionSync(fn),
  };
}

/**
 * The club's one database. A single instance serves every request, one at a time, which is what the synchronous
 * club and community code assumes. Pages reach it through open(), once per request.
 */
export class ClubStore extends DurableObject<Env> {
  readonly #club;
  readonly #community;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = durableDb(ctx.storage);
    migrate(db);
    this.#club = createClub(db);
    this.#community = createCommunity(db);
    const email = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
    if (email) this.#club.appointAdmin({ email, name: 'Admin' });
  }

  open() {
    return { club: this.#club, community: this.#community };
  }
}
