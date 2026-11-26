# Social: build plan

social.therestisaccountancy.com is a public, free community for people in accountancy. Members prove their social accounts, add credentials that the team checks, and show their work. Everyone reads; signed-in members post, answer and rate. Joining is invite-only, so every account is one we know.

The visual and interaction spec is the static design in `../social/` at the workspace root: `index.html`, `social.css`, `app.js` (every screen and state) and `data.js` (the demo data). Port its look and copy. Never ship its invented people: production starts empty and fills with real sign-ups.

## Decisions

- **Same Worker, same database.** Social lives in this repo and this Worker and shares `members`, sessions, the guards, letters and migrations. It is not a separate app.
- **Host routing.** `social.<site host>` is added to the Worker's domains and `security.allowedDomains`. Middleware rewrites a request on that host from `/x` to `/social/x`. Pages live under `src/pages/social/`. A helper `socialPath(url, path)` builds links: `/path` on the social host, `/social/path` on the main host (local dev and tests use the main host).
- **One sign-in across hosts.** The session cookie domain is the registrable domain (`.therestisaccountancy.com`) in production and unset on localhost.
- **Free, invite-only.** `members.joined_via` ('club' or 'social') says where someone first joined. Social joining creates an `invited` member and emails the existing welcome link to set a password. Social actions need `signedIn`, never `paidMember`. Club pages keep their payment rule.
- **Ways in.** A profile needs a row in `social_entries`, which records how the member got in: `team` (an invite the team emailed), `member` (a member's invite, with the inviter), `nomination` (a claimed nomination), `club` (any member the club accepted, who needs no invite), `request` (a request to join the team approved) or `open` (everyone who joined before invites). A trigger refuses a profile without one. Invite links (`social_invites`) work once, for 14 days; only their hash is kept, so a link is shown once. A link is spent in the same transaction that makes the account. Each member with a ticked credential (a claim, not just a proven account) has 3 invites: a used one is spent, a revoked or expired one comes back. A profile says "Invited by X" for a member's invite while X's profile is public. Without an invite, people ask at `/request`; the team approves or declines in the review queue, and approving someone who already signs in never sends a reset.
- **Verification by people first.** No body publishes a register we have confirmed we can query, so the team checks every claim by hand in a review queue. Work email is the only automatic check: we email a link to the work address.
- **Evidence files.** Uploaded certificates and licences go to an R2 bucket bound as `EVIDENCE`, and are deleted as soon as the claim is decided. Only the decision is kept.
- **Seal.** A member shows the seal when one social account is proven and at least one other claim is ticked.
- **Track.** Worked out from claims: `qualified` (a ticked body claim at member or fellow level), `training` (a ticked student, affiliate or provisional claim), `field` (anything else), `creator` (chosen by the member in their profile).
- **Lapsing.** A claim with an expiry date lapses at the end of that month, in Malaysian time. The hourly job marks lapses and emails 60 days and 14 days before, once each. Body ticks run a year from the tick; licences run to the month on them. Renewing is a new claim; its tick replaces the older one.
- **Claims are never edited.** Changing one means removing it and sending it again, under a new id that is never reused, so a reviewer's decision always lands on what they read.
- **Work email needs the member.** Opening the emailed link confirms nothing (mail scanners open links). The member who asked confirms with a button, signed in.
- **Notifications** are rows in a table, written inside the same transaction as the event (`social-notify.ts`, which every module can import without a cycle). A row keeps ids, never copies: its actor, a subject id and a short detail, and it is read against what is true now, so one whose actor has gone or whose post was removed drops out. A key per member makes toggles (useful, follow, a changed rating) notify once; nobody is notified of their own doing. The bell's count is read in the middleware with the profile. "Needs you" (co-sign requests, ticks inside the renewal window) is read from live state, so a decided request never shows its buttons; viewing the page marks everything read.
- **Casebook.** Entries carry bands and years only; `src/lib/guard.ts` is the one client-identifying guard, used by the browser as people type and by the server, which refuses the same note. Role titles go through it too (allowing "first" and "sole"), and the employer is a kind from a list. The co-signer is named by handle and must hold the seal; only they decide, once. A co-sign counts on the heatmap while its co-signer holds the seal.
- **Shelf.** Links only, https with a host and no credentials; we never host the file. Removing an item is soft and takes it out of everyone's Saved. Saving your own item is refused.
- **Abandoned sign-ups.** The hourly job deletes members who joined through Social, never set a password, were never accepted by the club, are not paused by the team and are not the team, 14 days after joining. Their profile and handle go with them. A nomination they claimed at sign-up goes back to the team's queue as pending, so the nominee can be invited again, and a member's invite they used goes back to the member. Requests and unused invites are not members, so the job never reaches them. The same job deletes invite links dead for 30 days (never used ones) and requests declined 90 days ago.
- **Blank form fields.** Astro reads an empty form field as null and applies a schema default only when the field is missing, so optional text goes through `blankable()` in `src/actions/guards.ts`.
- **Drafts** stay in the browser (`localStorage`), never on the server.
- **Nominations stay private.** Only the nominator sees their own (on The List), the team sees the queue, and the nominee sees their invite. A handle counts as on The List once a member has proven that account; a pending account blocks nothing. We know only a handle, so the team sends the invite link by direct message themselves. The link is shown once, in the response to Invite (only its hash is kept); Make a new link replaces a lost one. Claiming signed out goes through sign-up with only the token, and the server reads the account from it.
- **What the Floor shows.** One rule for every read and write: not removed, written by an active member with a handle, and the practitioners' room only for a member with any ticked licence claim (or the team). Search, profiles and the feed all go through it. Posting needs a handle, never the seal.
- **Answers and corrections are read from current ticks.** "Answered by a ticked X" shows while the accepted reply's author holds the seal, X being their most telling ticked credential (a qualifying body status, then a training one, then a licence, then an academic post), or "member" when the seal rests on a workplace or experience. A member with the seal marks their own reply as a correction when they post it; it shows in red while they hold the seal.
- **Peer points** for The List: Sound ratings on the member's answers from raters who hold the seal now, plus saves of their shelf items, both in the current quarter (Malaysian time). A changed rating counts from when it changed.
- **Problems.** The team writes them at `/problems/new`; only one is open at a time, so windows may not overlap, and one nobody has answered can be taken back. A scheduled problem is the team's until it opens. Other answers and the spread stay hidden until you answer or it closes; rating checks the same rule, needs the seal now, never your own, and closes with the problem. The judgment record judges each rated answer by its most common rating, ties going to the harsher; unrated answers count only as answers. The streak counts problems answered in a row back from the latest to open; the open one breaks nothing until it closes unanswered.

## Constraints from the domain move (another session, landing on main before this branch merges)

- Migration 16 on main adds onboarding columns to `members`. This branch's migrations are appended after it, so they run as 17 and up. Until that rebase, tests run them as 16 and up, which is fine. Never deploy this branch before the rebase.
- The domain comes from `src/data/site.ts` (`site.domain`) once that lands. Until then, derive the social host from Astro's configured `site` URL in one place, so the rebase changes one line.
- The Worker stays named `better-accountant`. Renaming it would orphan the ClubStore Durable Object and its data.
- Calendar UIDs are pinned to `better-accountant.com` on purpose. Leave them.

## Data (new migrations, appended after whatever is on main)

```
members            + joined_via TEXT NOT NULL DEFAULT 'club', + club_approved_at TEXT (a social member may pay for
                   the club once a join request from them is accepted; club members always may)
profiles           member_id PK, handle UNIQUE (lowercase, 3-30, [a-z0-9_]), headline, sector, city,
                   jurisdictions JSON, topics JSON, creator INTEGER, listed INTEGER, created_at, updated_at
social_accounts    id AUTOINCREMENT, member_id, platform, handle, code, state pending|proven|rejected, note,
                   created_at, decided_at, decided_by  (one live account per platform; one owner per proven account)
claims             id AUTOINCREMENT, member_id, kind body|licence|employer|academic|experience, body_id NULL,
                   label, status_level NULL (the body's exact status), reference NULL (member or licence number,
                   or the staff page / ORCID URL; team-only), source register|document|email|vouch|self,
                   state pending|ticked|rejected|lapsed, evidence_key NULL, until NULL ('YYYY-MM'),
                   reminded 0|1|2, note (the team's reason), created_at, decided_at, decided_by
email_checks       token_hash PK, claim_id, address, created_at, expires_at, used_at
vouches            claim_id, voucher_id, created_at  (PK claim_id+voucher_id)
nominations        id AUTOINCREMENT, platform, handle (accountHandle form), state pending|invited|claimed|removed|rejected,
                   invite_token_hash NULL, created_at, decided_at, decided_by  (UNIQUE platform+handle: one row ever;
                   'removed' is the nominee's no, kept with its nominators deleted so the handle is never invited again)
nominators         nomination_id, member_id, topics JSON, why_url NULL, created_at (PK both: a member counts once)
follows            follower_id, followee_id, created_at (PK both)
floor_posts        id AUTOINCREMENT, member_id, room, jurisdiction MY|SG|AU|UK|Any, title, body, created_at, edited_at,
                   removed_at, removed_by  (removal is soft: the author's delete and the team's remove both set it)
floor_replies      id AUTOINCREMENT, post_id, member_id, body, accepted INTEGER (one per post), correction INTEGER,
                   created_at, edited_at, removed_at, removed_by
useful             member_id, target post|reply|item, target_id, created_at (PK all three; 'item' is unused: shelf items
                   have their own saves table)
problems           id, number UNIQUE, tag, jurisdiction, title, scenario JSON, ask, options JSON,
                   opens_at, closes_at, created_by
answers            id, problem_id, member_id, pick, reasoning, created_at (UNIQUE problem+member)
ratings            answer_id, rater_id, verdict sound|partly|unsound, created_at (PK both)
casebook           id, member_id, service, industry, band, framework, year, role, areas JSON, note,
                   cosigner_id NULL (SET NULL), cosign pending|signed|declined NULL, cosigned_at, created_at
roles              id, member_id, from_year, to_year NULL (still there), title, employer (a kind from a list), created_at
shelf_items        id, member_id, kind, title, url (https), created_at, removed_at
saves              member_id, item_id, created_at (PK both)
notifications      id, member_id, kind, key (UNIQUE with member_id), actor_id NULL (CASCADE), subject_id NULL, detail,
                   created_at, read_at
profiles           + badge_copied_at (the setup checklist's last step)
reports            id, reporter_id, target post|reply|profile, target_id (the member's id for a profile),
                   target_member_id, reason, note, state open|actioned|dismissed, created_at, decided_by, decided_at
                   (one open report per reporter and thing; the team decides all open reports on a thing at once)
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
- `social-notifications.ts`: list, mark read, unread count. Writing is `notify()` in `social-notify.ts`.
- `social-invites.ts`: team and member invite links, the allowance, joining from a link.
- `social-requests.ts`: requests to join, approve, decline.

Tests from slice 6 on share `social-fixtures.ts`: the whole social site on node:sqlite with a clock the test moves.

Each module is wired into `createStore` in `src/server/store.ts`, and has a `.test.ts` beside it.

## Pages (`src/pages/social/`)

`index` (Floor), `list`, `problems/[...number]` (the open problem at `/problems`, any number at `/problems/12`), `problems/new` (the team's), `post/[id]`, `@[handle]` (profile), `me` (redirects to own profile), `edit`, `verify` (accounts, bodies, licence upload, work email), `badge`, `nominate`, `claim/[token]`, `casebook/new` (entries and roles), `notifications`, `ticks`, `search` (JSON for the dialog), `sign-up` (where an invite or nomination link lands), `request` (Request to join), `invites` (a member's links), and the team's `review` (admin only, with requests and team invites). Actions live in `src/actions/` by area: `social.ts`, `ticks.ts`, `nominations.ts`, `floor.ts`, `problems.ts`, `casebook.ts` (casebook, roles, shelf, badge).

## Slices (each ends with `pnpm test` and `pnpm check` green, and is one commit)

1. **Foundations.** Host routing, `socialPath`, cookie domain, `joined_via`, profiles and handles, sign-up and welcome, the social layout and stylesheet ported from the design, the Floor shell, The List (empty state), profile page, edit profile, the ticks page.
2. **Ticks.** Social accounts, claims, evidence upload to R2, work-email checks, vouches, the review queue, seal and track on every surface, expiry and lapsing in the hourly job.
3. **Nominations.** Nominate, team invite, claim page, remove.
4. **Floor.** Posts, replies, accepted answers, corrections, useful, Following, rooms (the practitioners' room needs a ticked practising licence), reports, search.
5. **Problems.** Team authoring, answering, hidden answers, ratings, archive, judgment record, streak.
6. **The rest.** Casebook and co-sign, roles, shelf and saves, notifications and the bell, badge, checklist, abandoned sign-ups. (Drafts landed with the Floor in slice 4.)

## Not in scope

LinkedIn or X sign-in, automated register lookups, direct messages, image uploads in posts.
