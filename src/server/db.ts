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
  `
  CREATE TABLE subscribers (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
    source TEXT NOT NULL,
    token_hash TEXT UNIQUE,
    token_expires_at TEXT,
    confirm_sent_at TEXT,
    unsubscribe_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    confirmed_at TEXT,
    unsubscribed_at TEXT
  );
  `,
  `
  ALTER TABLE members ADD COLUMN email_onboarding INTEGER NOT NULL DEFAULT 1 CHECK (email_onboarding IN (0, 1));
  ALTER TABLE members ADD COLUMN onboarding_sent INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE members ADD COLUMN onboarding_last_at TEXT;
  UPDATE members SET onboarding_sent = 3 WHERE EXISTS (SELECT 1 FROM payments p WHERE p.member_id = members.id AND p.status = 'paid');
  `,
  `
  ALTER TABLE members ADD COLUMN joined_via TEXT NOT NULL DEFAULT 'club' CHECK (joined_via IN ('club', 'social'));

  CREATE TABLE profiles (
    member_id INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
    handle TEXT NOT NULL UNIQUE CHECK (length(handle) BETWEEN 3 AND 30 AND handle NOT GLOB '*[^a-z0-9_]*'),
    headline TEXT NOT NULL DEFAULT '',
    sector TEXT,
    city TEXT NOT NULL DEFAULT '',
    jurisdictions TEXT NOT NULL DEFAULT '[]',
    topics TEXT NOT NULL DEFAULT '[]',
    creator INTEGER NOT NULL DEFAULT 0 CHECK (creator IN (0, 1)),
    listed INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE follows (
    follower_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id != followee_id)
  );
  CREATE INDEX follows_by_followee ON follows (followee_id);
  `,
  `
  ALTER TABLE members ADD COLUMN club_approved_at TEXT;

  CREATE TABLE social_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    handle TEXT NOT NULL,
    code TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'proven', 'rejected')),
    note TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by INTEGER REFERENCES members (id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX one_live_account_per_platform ON social_accounts (member_id, platform) WHERE state != 'rejected';
  CREATE UNIQUE INDEX one_owner_per_proven_account ON social_accounts (platform, handle) WHERE state = 'proven';
  CREATE INDEX social_accounts_by_state ON social_accounts (state, created_at);

  CREATE TABLE claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('body', 'licence', 'employer', 'academic', 'experience')),
    body_id TEXT,
    label TEXT NOT NULL,
    status_level TEXT,
    reference TEXT,
    source TEXT NOT NULL CHECK (source IN ('register', 'document', 'email', 'vouch', 'self')),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ticked', 'rejected', 'lapsed')),
    evidence_key TEXT,
    until TEXT CHECK (until IS NULL OR until GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
    reminded INTEGER NOT NULL DEFAULT 0 CHECK (reminded BETWEEN 0 AND 2),
    note TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by INTEGER REFERENCES members (id) ON DELETE SET NULL
  );
  CREATE INDEX claims_by_member ON claims (member_id, created_at);
  CREATE INDEX claims_by_state ON claims (state, created_at);
  CREATE INDEX claims_with_evidence ON claims (id) WHERE evidence_key IS NOT NULL;

  CREATE TABLE email_checks (
    token_hash TEXT PRIMARY KEY,
    claim_id INTEGER NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX email_checks_by_claim ON email_checks (claim_id, created_at);

  CREATE TABLE vouches (
    claim_id INTEGER NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
    voucher_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (claim_id, voucher_id)
  );
  CREATE INDEX vouches_by_voucher ON vouches (voucher_id);
  `,
  `
  CREATE TABLE nominations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    handle TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'invited', 'claimed', 'removed', 'rejected')),
    invite_token_hash TEXT UNIQUE,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by INTEGER REFERENCES members (id) ON DELETE SET NULL,
    UNIQUE (platform, handle)
  );
  CREATE INDEX nominations_by_state ON nominations (state, created_at);

  CREATE TABLE nominators (
    nomination_id INTEGER NOT NULL REFERENCES nominations (id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    topics TEXT NOT NULL DEFAULT '[]',
    why_url TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (nomination_id, member_id)
  );
  CREATE INDEX nominators_by_member ON nominators (member_id);
  `,
  `
  CREATE TABLE floor_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    room TEXT NOT NULL,
    jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('MY', 'SG', 'AU', 'UK', 'Any')),
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    edited_at TEXT,
    removed_at TEXT,
    removed_by INTEGER REFERENCES members (id) ON DELETE SET NULL
  );
  CREATE INDEX floor_posts_by_time ON floor_posts (created_at, id);
  CREATE INDEX floor_posts_by_member ON floor_posts (member_id, created_at);

  CREATE TABLE floor_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES floor_posts (id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
    correction INTEGER NOT NULL DEFAULT 0 CHECK (correction IN (0, 1)),
    created_at TEXT NOT NULL,
    edited_at TEXT,
    removed_at TEXT,
    removed_by INTEGER REFERENCES members (id) ON DELETE SET NULL
  );
  CREATE INDEX floor_replies_by_post ON floor_replies (post_id, created_at);
  CREATE UNIQUE INDEX one_accepted_reply_per_post ON floor_replies (post_id) WHERE accepted = 1;

  CREATE TABLE useful (
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    target TEXT NOT NULL CHECK (target IN ('post', 'reply', 'item')),
    target_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (member_id, target, target_id)
  );
  CREATE INDEX useful_by_target ON useful (target, target_id);

  CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
    target TEXT NOT NULL CHECK (target IN ('post', 'reply', 'profile')),
    target_id INTEGER NOT NULL,
    target_member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'actioned', 'dismissed')),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by INTEGER REFERENCES members (id) ON DELETE SET NULL
  );
  CREATE INDEX reports_by_state ON reports (state, created_at);
  CREATE UNIQUE INDEX one_open_report_per_reporter ON reports (reporter_id, target, target_id) WHERE state = 'open';
  `,
  `
  CREATE TABLE problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL UNIQUE CHECK (number > 0),
    tag TEXT NOT NULL,
    jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('MY', 'SG', 'AU', 'UK', 'Any')),
    title TEXT NOT NULL,
    scenario TEXT NOT NULL,
    ask TEXT NOT NULL,
    options TEXT NOT NULL,
    opens_at TEXT NOT NULL,
    closes_at TEXT NOT NULL CHECK (closes_at > opens_at),
    created_by INTEGER REFERENCES members (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX problems_by_window ON problems (opens_at, closes_at);

  CREATE TABLE answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    problem_id INTEGER NOT NULL REFERENCES problems (id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    pick TEXT NOT NULL CHECK (pick IN ('A', 'B', 'C', 'D')),
    reasoning TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (problem_id, member_id)
  );
  CREATE INDEX answers_by_member ON answers (member_id, created_at);

  CREATE TABLE ratings (
    answer_id INTEGER NOT NULL REFERENCES answers (id) ON DELETE CASCADE,
    rater_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    verdict TEXT NOT NULL CHECK (verdict IN ('sound', 'partly', 'unsound')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (answer_id, rater_id)
  );
  CREATE INDEX ratings_by_rater ON ratings (rater_id);
  `,
  `
  ALTER TABLE profiles ADD COLUMN badge_copied_at TEXT;

  CREATE TABLE casebook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    service TEXT NOT NULL,
    industry TEXT NOT NULL,
    band TEXT NOT NULL,
    framework TEXT NOT NULL,
    year TEXT NOT NULL,
    role TEXT NOT NULL,
    areas TEXT NOT NULL DEFAULT '[]',
    note TEXT NOT NULL DEFAULT '',
    cosigner_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
    cosign TEXT CHECK (cosign IN ('pending', 'signed', 'declined')),
    cosigned_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX casebook_by_member ON casebook (member_id, created_at);
  CREATE INDEX casebook_by_cosigner ON casebook (cosigner_id, cosign);

  CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    from_year INTEGER NOT NULL,
    to_year INTEGER CHECK (to_year IS NULL OR to_year >= from_year),
    title TEXT NOT NULL,
    employer TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX roles_by_member ON roles (member_id, from_year);

  CREATE TABLE shelf_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL CHECK (url LIKE 'https://%'),
    created_at TEXT NOT NULL,
    removed_at TEXT
  );
  CREATE INDEX shelf_items_by_member ON shelf_items (member_id, created_at);

  CREATE TABLE saves (
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES shelf_items (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (member_id, item_id)
  );
  CREATE INDEX saves_by_item ON saves (item_id, created_at);

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    actor_id INTEGER REFERENCES members (id) ON DELETE CASCADE,
    subject_id INTEGER,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    read_at TEXT,
    UNIQUE (member_id, key)
  );
  CREATE INDEX notifications_by_member ON notifications (member_id, created_at);
  `,
  `
  CREATE TABLE social_entries (
    member_id INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
    joined_via TEXT NOT NULL CHECK (joined_via IN ('open', 'team', 'member', 'nomination', 'club', 'request')),
    inviter_id INTEGER REFERENCES members (id) ON DELETE SET NULL CHECK (inviter_id IS NULL OR joined_via = 'member'),
    created_at TEXT NOT NULL
  );
  CREATE INDEX social_entries_by_inviter ON social_entries (inviter_id) WHERE inviter_id IS NOT NULL;
  INSERT INTO social_entries (member_id, joined_via, created_at) SELECT member_id, 'open', created_at FROM profiles;
  CREATE TRIGGER profiles_need_an_entry BEFORE INSERT ON profiles
  WHEN NOT EXISTS (SELECT 1 FROM social_entries WHERE member_id = NEW.member_id)
  BEGIN
    SELECT RAISE(ABORT, 'a Social profile needs an entry');
  END;

  CREATE TABLE social_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('team', 'member')),
    inviter_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    email TEXT COLLATE NOCASE,
    name TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by INTEGER REFERENCES members (id) ON DELETE SET NULL,
    revoked_at TEXT,
    CHECK (expires_at > created_at),
    CHECK (kind = 'team' OR (email IS NULL AND name IS NULL)),
    CHECK (kind = 'member' OR email IS NOT NULL),
    CHECK (used_at IS NULL OR revoked_at IS NULL),
    CHECK (used_by IS NULL OR used_at IS NOT NULL)
  );
  CREATE INDEX social_invites_by_inviter ON social_invites (inviter_id, kind, created_at);
  CREATE INDEX social_invites_by_user ON social_invites (used_by) WHERE used_by IS NOT NULL;

  CREATE TABLE social_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    about TEXT NOT NULL,
    link TEXT CHECK (link IS NULL OR link LIKE 'https://%'),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'declined')),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by INTEGER REFERENCES members (id) ON DELETE SET NULL,
    CHECK ((state = 'pending') = (decided_at IS NULL))
  );
  CREATE UNIQUE INDEX one_pending_social_request ON social_requests (email) WHERE state = 'pending';
  CREATE INDEX social_requests_by_state ON social_requests (state, created_at);
  `,
  `
  CREATE TABLE sign_ins (
    token_hash TEXT PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    epoch INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    CHECK (expires_at > created_at)
  );
  CREATE INDEX sign_ins_by_expiry ON sign_ins (expires_at);
  `,
  `
  CREATE TABLE renewal_stops (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    reason TEXT,
    note TEXT
  );
  CREATE INDEX renewal_stops_by_member ON renewal_stops (member_id, at);
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
