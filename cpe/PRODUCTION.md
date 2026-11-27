# CPE in production

CPE at cpe.therestisaccountancy.com is a Worker: the app as static assets, plus an API under `/api`. Who is signed in comes from the club Worker. Records live in SQLite Durable Objects, and Studio audio lives in R2.

Nothing on this branch has been deployed, and no Cloudflare resources have been created.

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| Club identity | Club Worker `better-accountant`, named entrypoint `CpeIdentity` | `member(cookie)` resolves the session exactly as `src/middleware.ts` does: session `signedIn`, then `club.sessionMember`, then `billing.access` and `paidAccess`. It runs the internal route `/internal/cpe-identity` in-process. The public fetch handler returns 404 for that path, and the route also requires a per-isolate random token, so it is reachable only through the binding. |
| CPE API and app | CPE Worker `therestisaccountancy-cpe` | `/api/*` runs in the Worker first. Everything else is static assets with SPA fallback. |
| Catalogue | Durable Object `CatalogueStore`, one instance named `catalogue` | Shows, courses, every version of every course (draft or published), and the public certificate register. |
| Learner records | Durable Object `LearnerStore`, one instance per member, named `member:<club member id>` | Heard ranges, review answers, assessment sittings and attempts, certificates, logged hours, requirement and the name printed on certificates. |
| Studio audio | R2 bucket `therestisaccountancy-cpe-audio` | Keys `courses/<course>/<random>.<ext>`. Served only to paid members, at `/api/audio/<key>`, with byte ranges. |
| Sample audio | Static assets `public/audio/*.m4a` | The four seeded courses point at these files, so the public landing page can still play them. |

## Resources to create

Create these before the first deploy. The club does the same for its evidence bucket.

1. **R2 bucket** `therestisaccountancy-cpe-audio`:

   ```bash
   pnpm exec cf r2 buckets create --name therestisaccountancy-cpe-audio
   ```

2. **Durable Objects.** `CatalogueStore` and `LearnerStore` are declared as SQLite exports in `cloudflare.config.ts`. The first deploy creates them. There is nothing to create by hand.

3. **Secret, optional:** `ELEVENLABS_API_KEY`. With it set, the Studio offers automatic timing through ElevenLabs forced alignment. Without it, the Studio offers only the manual timing editor. It is deliberately not declared in `cloudflare.config.ts`, which would make every deploy require it. Set it after the Worker exists, and it stays across deploys. Pass the key from an environment variable so it stays out of shell history:

   ```bash
   pnpm exec cf workers secrets update ELEVENLABS_API_KEY --worker therestisaccountancy-cpe --type secret_text --text "$ELEVENLABS_API_KEY"
   ```

   Not verified: whether `cf deploy` refuses to deploy while a declared secret is unset. The club declares its secrets the same way.

## Bindings

CPE (`cpe/cloudflare.config.ts`):

| Binding | Kind | Value |
| --- | --- | --- |
| `ASSETS` | assets | the built app |
| `CLUB` | service binding | Worker `better-accountant`, `exportName: "CpeIdentity"` |
| `AUDIO` | R2 | `therestisaccountancy-cpe-audio` |
| `CLUB_URL` | text | `https://therestisaccountancy.com`, used for sign-in and payment links |
| `ELEVENLABS_API_KEY` | secret, optional | see above |
| `CatalogueStore`, `LearnerStore` | Durable Object exports | SQLite |

`cf/config` declares the service binding with `bindings.worker({ worker, exportName })`, so no alternative was needed. The binding names the club Worker as a string, not by importing the club's config, so CPE's build never loads the Astro app. `CLUB_WORKER` and `CLUB_URL` environment variables override the defaults for a local dev server.

Club (`site/cloudflare.config.ts`): one new export, `CpeIdentity: exports.worker()`.

## Deploy order

1. **Deploy the club first.** CPE's binding points at the `CpeIdentity` entrypoint, which must already exist. The club deploy also brings the `safeNext` change that lets sign-in return to `https://cpe.therestisaccountancy.com/...`, and the sign-in page fix that labels that case "Sign in to the club".
2. Create the R2 bucket.
3. Deploy CPE: `pnpm run deploy` in `cpe/`. This runs `cf workers types`, `tsc -b`, `cf build`, the bundle check and `cf deploy`.
4. Optionally, set `ELEVENLABS_API_KEY`.

The club's session cookie is already set on the whole domain in production (`site/astro.config.mjs`), so requests to cpe.therestisaccountancy.com carry it. CPE forwards the Cookie header to the club unread.

## Migrations

- **Schemas.** Both Durable Objects run an append-only migration list on start, in the club's style (`worker/db.ts`, with `MIGRATIONS` in `catalogue.ts` and `learner.ts`). Never edit a migration that has shipped. Add a new one.
- **Seed.** On every start the catalogue inserts the two shows and the four sample courses as published version 1, but only where they are missing (`INSERT OR IGNORE`). Their timings and peaks come from `worker/seed/timings.json` and their audio from `/audio/<id>.m4a`. Seeding never touches a course an admin has since edited.
- **The prototype's browser data.** On a member's first signed-in load, the app reads `localStorage["tria-cpe:v1"]` and posts it to `/api/import`. After the server acknowledges, the key is removed.
  - Hand-logged hours come across as **self-reported** ledger entries.
  - Certificates the browser made come across as **unverified** ledger entries. They are never certificates, never on the register and never shown as verified.
  - The name and requirement come across only if the account has none yet.
  - **Listening evidence is not imported.** Heard ranges, review answers and attempts from the browser are unverifiable, and importing them would bypass the heard-time limit. Only the resume position comes across.
  - Each item is keyed by its old id, so importing the same browser twice, or a second browser, adds only what is new.

## What the server decides

- **Heard time.** The app reports the media element's played ranges every 5 seconds while there is something new, and on pause, seek, page hide and track change. The server accepts new audio only from a per-member budget, and keeps ranges exactly as played: it never joins two ranges across a gap, however small. Real time fills the budget at the fastest playback rate (2×) and banks at most 10 minutes of real time. Every course and tab draws on the one budget. Audio that arrives early is accepted on later reports, not lost (`acceptHeard` and `refill` in `src/domain/rules.ts`).
  - **This limits cheating. It does not prove listening.** A client can still report audio it never played, as long as the claims stay within real time × 2. The numbers are policy (`MAX_RATE`, `BANK_SECONDS`).
- **Review questions.** Options are shuffled per member and question. The order is seeded, so it stays the same across reloads. The app sends a position and the server checks it. The explanation is sent only once the answer is right.
- **Assessments.** The server opens a sitting only once 95% of the audio has been heard and every review question answered, or as practice after the course is certified. The sitting gets fresh random option orders, stored on the server. The app sends positions back. The server grades each sitting once, at 70% to pass. A failed sitting says only which questions were right. The correct answers and explanations come back only with a pass, so a failed attempt can't be copied into the next one.
- **Certificates.** The server issues one per course per member, with an id like `TRIA-SC-20261126-PGKUHJ7EGX`, where the last ten characters are random. Each certificate records the exact course version and a snapshot of title, field, level and credit. It is written to the public register in `CatalogueStore`. That write is idempotent and retried on every session load. `/verify/<id>` is public and shows only the holder's name, course, credit, field and completion date.
- **Identity.** The CPE Worker keeps a signed-in identity for 60 seconds per cookie, so the heard reports don't open the club's database every few seconds. A suspension, sign-out or lapsed payment therefore reaches CPE within a minute. Signed-out answers are never kept.
- **Published versions.** Each Worker isolate keeps the published versions it has read (`worker/published.ts`), up to 200, because a published version never changes. Heard reports, review answers and sittings therefore reach `CatalogueStore` only for a version that isolate has not seen. The newest-of-each listing for `/api/catalogue` still reads the catalogue on every request.
- **Shared rules.** The same pure functions run on the server and in the app: `merge`, `coverage`, `readyForAssessment` and `passes` in `src/domain/rules.ts`.
- **No answers in the bundle.** `scripts/check-bundle.ts` runs in `pnpm build`. It fails if any review or assessment explanation appears in the built browser assets. The course scripts live in `worker/seed/` and reach only the Worker bundle.
- **Versions.** Published versions never change. Editing in the Studio opens a draft as the next version. A member stays on the version they have evidence for until they are certified.

## Verified, and not

Verified locally (club dev server and CPE dev server, cross-Worker binding through the dev registry, in Chrome):

- Signed out, CPE shows the sign-in state, with a link to the club carrying `next=` back to CPE. Signed in without payment, it shows "Membership needed" with the club's pay page. Hitting the identity route directly returns 404.
- An admin creates a course in the Studio and works through it:
  - adds transcript, review and assessment questions
  - uploads audio (browser-measured 1:14, multipart into local R2)
  - sets timings with Mark and by typing
  - previews, then publishes version 1
- A paid member works through that course:
  - listens at 2×; all of it is accepted
  - answers the review question; a wrong answer is refused and the right one is accepted
  - passes 3/3, gets a server-issued certificate and opens it on the public verify page; the verify API answers without a cookie
- Hands-free on a sample course: both review questions queued while playing, came up one after another at the end, and unlocked the assessment once answered.
- Media Session reports playing and paused, with metadata.
- Signed out, a landing-page sample plays straight past a review question: only members are asked them.
- The one-time localStorage import produced:
  - a self-reported entry
  - an unverified entry
  - no listening credit, but the resume position
  - the key cleared
  - no duplicates on reload
- The club build bundles `cpe-identity.ts` once, imported by both the entrypoint and the internal route, so they share the token.
- Tests pass: 25 CPE server tests (rules, learner, catalogue, alignment, audio ranges, the member and admin guards) and the club suite with the new identity and `safeNext` tests. Typecheck and build pass in both apps.

How sign-in was simulated locally: the club dev server ran from this branch under the Worker name `club-cpe-dev`. That name is an uncommitted local tweak to `site/cloudflare.config.ts`, because another session's club dev server holds `better-accountant` in the dev registry. CPE ran with `CLUB_WORKER=club-cpe-dev`. Both servers were reached on `cpe.localhost` so the host-only dev cookie was shared without touching other sessions' `localhost` cookies. A scratch script (not committed) wrote three accounts into the club dev server's own SQLite: the admin, a paid member and an unpaid member. Passwords were hashed with the club's `hashPassword`, and the paid member got a `subscriptions` row. Each sign-in then went through the real club sign-in action, and the real session cookie went through the real binding.

Not verified:

- **Any deployed environment.** In particular, the domain-wide cookie reaching cpe.therestisaccountancy.com.
- **ElevenLabs alignment.** No key was available. The request and response shape follow the API reference: `POST https://api.elevenlabs.io/v1/forced-alignment` as multipart with `file` and `text`, the `xi-api-key` header, and `words[]` with `text`, `start` and `end` in seconds. The mapping from words to segment starts has unit tests.
- **Large uploads.** The upload went in one part. Uploads of more than 8 MiB use more parts, which have not been run.
- **Lock-screen buttons on a real phone,** and playback of R2 audio on iOS.
- **Email delivery of certificates.** Not built. The club sends mail through its own `send_email` binding. Sending from CPE would need either a new club RPC method or a second `send_email` binding on the club's sender address, and that is a decision about the club's mail.

## Open decisions

- **Which professional body's CPE rules the credit must meet.** The 95% / 70% / unlimited-retake rules are the prototype's own. The "not accredited" disclosure stays on certificates, the verify page and the landing page until this is decided.
- **Audio source:** recorded hosts or generated voices. The Studio accepts any uploaded audio either way.
- **Public content.** The catalogue (titles, transcripts, timings) is public so the landing page can show samples. Studio audio is paid-only; sample audio stays public.
- **Certificate email.** See above.
- **"Reset everything".** The prototype's ledger had a "Reset everything" button. It is gone, because issued certificates are records on the public register.
