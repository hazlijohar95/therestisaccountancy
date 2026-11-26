import { DurableObject, exports } from 'cloudflare:workers';
import { migrate, type Db } from './db.ts';
import { createStore } from './store.ts';

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
  readonly #store;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = durableDb(ctx.storage);
    migrate(db);
    this.#store = createStore(db);
    const email = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
    if (email) this.#store.club.appointAdmin({ email, name: 'Admin' });
  }

  open() {
    return this.#store;
  }
}

type Remote<Module> = { readonly [K in keyof Module]: Module[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never };

/** The store as the app reaches it, across to the ClubStore. Every call is a round trip, so each returns a promise. */
export type Store = { readonly [M in keyof ReturnType<typeof createStore>]: Remote<ReturnType<typeof createStore>[M]> };

/**
 * The ClubStore's stub, typed as the plain data it answers. The RPC types also give each result a disposer; a result
 * here holds no stub, so nothing calls it, and leaving it in the type would bar the result from a server function.
 */
export const openStore = (): Promise<Store & Disposable> => exports.ClubStore.getByName('club').open();
