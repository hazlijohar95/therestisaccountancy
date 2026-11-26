import { DurableObject } from 'cloudflare:workers';
import { createBilling } from './billing.ts';
import { createCalls } from './calls.ts';
import { createClub } from './club.ts';
import { createCommunity } from './community.ts';
import { createFees } from './fees.ts';
import { migrate, type Db } from './db.ts';
import { createIncidents } from './incidents.ts';
import { createLimits } from './limits.ts';
import { createListings } from './listings.ts';
import { createMailings } from './mailings.ts';
import { createNewsletter } from './newsletter.ts';
import { createPlans } from './plans.ts';
import { createSchedule } from './schedule.ts';
import { createSignIns } from './sign-ins.ts';
import { createSocialCasebook } from './social-casebook.ts';
import { createSocialClaims } from './social-claims.ts';
import { createSocialFloor } from './social-floor.ts';
import { createSocialInvites } from './social-invites.ts';
import { createSocialNominations } from './social-nominations.ts';
import { createSocialNotifications } from './social-notifications.ts';
import { createSocialProblems } from './social-problems.ts';
import { createSocialProfiles } from './social-profiles.ts';
import { createSocialRequests } from './social-requests.ts';
import { createSocialShelf } from './social-shelf.ts';

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
  readonly #limits;
  readonly #mailings;
  readonly #schedule;
  readonly #billing;
  readonly #incidents;
  readonly #plans;
  readonly #calls;
  readonly #listings;
  readonly #fees;
  readonly #newsletter;
  readonly #socialProfiles;
  readonly #socialClaims;
  readonly #socialNominations;
  readonly #socialFloor;
  readonly #socialProblems;
  readonly #socialCasebook;
  readonly #socialShelf;
  readonly #socialNotifications;
  readonly #socialInvites;
  readonly #socialRequests;
  readonly #signIns;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = durableDb(ctx.storage);
    migrate(db);
    this.#club = createClub(db);
    this.#community = createCommunity(db);
    this.#limits = createLimits(db);
    this.#mailings = createMailings(db);
    this.#schedule = createSchedule(db);
    this.#billing = createBilling(db);
    this.#incidents = createIncidents(db);
    this.#plans = createPlans(db);
    this.#calls = createCalls(db);
    this.#listings = createListings(db);
    this.#fees = createFees(db);
    this.#newsletter = createNewsletter(db);
    this.#socialProfiles = createSocialProfiles(db);
    this.#socialClaims = createSocialClaims(db);
    this.#socialNominations = createSocialNominations(db);
    this.#socialFloor = createSocialFloor(db);
    this.#socialProblems = createSocialProblems(db);
    this.#socialCasebook = createSocialCasebook(db);
    this.#socialShelf = createSocialShelf(db);
    this.#socialNotifications = createSocialNotifications(db);
    this.#socialInvites = createSocialInvites(db);
    this.#socialRequests = createSocialRequests(db);
    this.#signIns = createSignIns(db);
    const email = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
    if (email) this.#club.appointAdmin({ email, name: 'Admin' });
  }

  open() {
    return { club: this.#club, community: this.#community, limits: this.#limits, mailings: this.#mailings, schedule: this.#schedule, billing: this.#billing, incidents: this.#incidents, plans: this.#plans, calls: this.#calls, listings: this.#listings, fees: this.#fees, newsletter: this.#newsletter, socialProfiles: this.#socialProfiles, socialClaims: this.#socialClaims, socialNominations: this.#socialNominations, socialFloor: this.#socialFloor, socialProblems: this.#socialProblems, socialCasebook: this.#socialCasebook, socialShelf: this.#socialShelf, socialNotifications: this.#socialNotifications, socialInvites: this.#socialInvites, socialRequests: this.#socialRequests, signIns: this.#signIns };
  }
}
