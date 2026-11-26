# Social: build plan

social.therestisaccountancy.com is a public, free community for people in accountancy. Members prove their social accounts, add credentials that the team checks, and show their work. Everyone reads; signed-in members post, answer and rate.

The visual and interaction spec is the static design in `../social/` at the workspace root: `index.html`, `social.css`, `app.js` (every screen and state) and `data.js` (the demo data). Port its look and copy. Never ship its invented people: production starts empty and fills with real sign-ups.

## Decisions

- **Same Worker, same database.** Social lives in this repo and this Worker and shares `members`, sessions, the guards, letters and migrations. It is not a separate app.
- **Host routing.** `social.<site host>` is added to the Worker's domains and `security.allowedDomains`. Middleware rewrites a request on that host from `/x` to `/social/x`. Pages live under `src/pages/social/`. A helper `socialPath(url, path)` builds links: `/path` on the social host, `/social/path` on the main host (local dev and tests use the main host).
- **One sign-in across hosts.** The session cookie domain is the registrable domain (`.therestisaccountancy.com`) in production and unset on localhost.
- **Open, free sign-up.** A new `members.joined_via` column ('club' or 'social'). Social sign-up creates an `invited` member and emails the existing welcome link to set a password. Social actions need `signedIn`, never `paidMember`. Club pages keep their payment rule.
- **Verification by people first.** No body publishes a register we have confirmed we can query, so the team checks every claim by hand in a review queue. Work email is the only automatic check: we email a link to the work address.
- **Evidence files.** Uploaded certificates and licences go to an R2 bucket bound as `EVIDENCE`, and are deleted as soon as the claim is decided. Only the decision is kept.
- **Seal.** A member shows the seal when one social account is proven and at least one other claim is ticked.
- **Track.** Worked out from claims: `qualified` (a ticked body claim at member or fellow level), `training` (a ticked student, affiliate or provisional claim), `field` (anything else), `creator` (chosen by the member in their profile).
- **Lapsing.** A claim with an expiry date lapses at the end of that month. The hourly job marks lapses and notifies 60 days and 14 days before.
- **Notifications** are rows in a table, written when the event happens.
- **Drafts** stay in the browser (`localStorage`), never on the server.
- **Peer points** for The List: answers rated sound by ticked members plus saves of shelf items, in the current quarter.

## Constraints from the domain move (another session, landing on main before this branch merges)

- Migration 16 on main adds onboarding columns to `members`. This branch's migrations are appended after it, so they run as 17 and up. Until that rebase, tests run them as 16 and up, which is fine. Never deploy this branch before the rebase.
- The domain comes from `src/data/site.ts` (`site.domain`) once that lands. Until then, derive the social host from Astro's configured `site` URL in one place, so the rebase changes one line.
- The Worker stays named `better-accountant`. Renaming it would orphan the ClubStore Durable Object and its data.
- Calendar UIDs are pinned to `better-accountant.com` on purpose. Leave them.

## Data (new migrations, appended after whatever is on main)

```
members            + joined_via TEXT NOT NULL DEFAULT 'club'
profiles           member_id PK, handle UNIQUE (lowercase, 3-30, [a-z0-9_]), headline, sector, city,
                   jurisdictions JSON, topics JSON, creator INTEGER, listed INTEGER, created_at, updated_at
social_accounts    id, member_id, platform, handle, code, state pending|proven|rejected, note,
                   created_at, decided_at, decided_by
claims             id, member_id, kind body|licence|employer|academic|experience, body_id NULL,
                   label, status_level NULL (Student|Affiliate|Member|Fellow|…), number NULL,
                   source register|document|email|vouch|self, state pending|ticked|rejected|lapsed,
                   evidence_key NULL, until NULL ('YYYY-MM'), note, created_at, decided_at, decided_by
email_checks       token_hash PK, claim_id, address, expires_at, used_at
vouches            claim_id, voucher_id, created_at  (PK claim_id+voucher_id)
nominations        id, platform, handle, topics JSON, why_url, nominated_by, created_at,
                   state pending|invited|claimed|removed|rejected, invite_token_hash NULL
follows            follower_id, followee_id, created_at (PK both)
floor_posts        id, member_id, room, jurisdiction, title, body, created_at, edited_at, removed_at
floor_replies      id, post_id, member_id, body, accepted INTEGER, correction INTEGER, created_at, removed_at
useful             member_id, target post|reply|item, target_id, created_at (PK all three)
problems           id, number UNIQUE, tag, jurisdiction, title, scenario JSON, ask, options JSON,
                   opens_at, closes_at, created_by
answers            id, problem_id, member_id, pick, reasoning, created_at (UNIQUE problem+member)
ratings            answer_id, rater_id, verdict sound|partly|unsound, created_at (PK both)
casebook           id, member_id, service, industry, band, framework, year, role, areas JSON, note,
                   cosigner_id NULL, cosign pending|signed|declined NULL, created_at
shelf_items        id, member_id, kind, title, url, created_at, removed_at
saves              member_id, item_id, created_at (PK both)
notifications      id, member_id, kind, payload JSON, created_at, read_at
reports            id, reporter_id, target_member_id, reason, note, state open|actioned|dismissed,
                   created_at, decided_by, decided_at
```

Lists that the code checks against (bodies, platforms, rooms, topics, sectors, services, industries, bands, frameworks, report reasons) live in `src/data/social.ts`, typed with `as const`.

## Server modules (each `createX(db, now)`, synchronous, tested with node:sqlite like the rest)

- `social-profiles.ts`: handles, profiles, track and seal, follows, the List and peer points, search.
- `social-claims.ts`: social accounts, claims, vouches, email checks, the review queue, lapsing and reminders.
- `social-nominations.ts`: nominate, invite, claim, remove.
- `social-floor.ts`: posts, replies, accept, corrections, useful, the Following feed, reports.
- `social-problems.ts`: problems, answers (hidden until you answer), ratings (ticked members only), judgment record, streak.
- `social-casebook.ts`: entries, the client-identifying guard, co-sign.
- `social-shelf.ts`: shelf items and saves.
- `social-notifications.ts`: write, list, mark read, unread count.

Each module is wired into `ClubStore.open()`, `src/env.d.ts` and the middleware's `locals`, and has a `.test.ts` beside it.

## Pages (`src/pages/social/`)

`index` (Floor), `list`, `problems`, `problems/[number]`, `post/[id]`, `@[handle]` (profile), `me` (redirects to own profile), `edit`, `verify` (accounts, bodies, licence upload, work email), `badge`, `nominate`, `claim/[token]`, `casebook/new`, `notifications`, `ticks`, `search` (JSON for the dialog), `sign-up`, and the team's `review` (admin only). Actions live in `src/actions/social.ts`.

## Slices (each ends with `pnpm test` and `pnpm check` green, and is one commit)

1. **Foundations.** Host routing, `socialPath`, cookie domain, `joined_via`, profiles and handles, sign-up and welcome, the social layout and stylesheet ported from the design, the Floor shell, The List (empty state), profile page, edit profile, the ticks page.
2. **Ticks.** Social accounts, claims, evidence upload to R2, work-email checks, vouches, the review queue, seal and track on every surface, expiry and lapsing in the hourly job.
3. **Nominations.** Nominate, team invite, claim page, remove.
4. **Floor.** Posts, replies, accepted answers, corrections, useful, Following, rooms (the practitioners' room needs a ticked practising licence), reports, search.
5. **Problems.** Team authoring, answering, hidden answers, ratings, archive, judgment record, streak.
6. **The rest.** Casebook and co-sign, shelf and saves, notifications and the bell, badge, checklist, drafts.

## Not in scope

LinkedIn or X sign-in, automated register lookups, direct messages, image uploads in posts.
