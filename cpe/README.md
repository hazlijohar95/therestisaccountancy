# CPE · The Rest Is Accountancy

cpe.therestisaccountancy.com. Accountants earn CPE by listening to episodes. Review questions arrive inside the episode, a short assessment confirms the learning, and the credit posts to a ledger with a certificate attached.

## Run

```bash
cd cpe
pnpm install
pnpm dev
```

The app opens on http://localhost:5180. Sign-in comes from the club, so run the club's dev server too (`pnpm dev` in `site/`). The CPE Worker reaches it through the local dev registry. Set `CLUB_URL` to the club dev server's address for sign-in links. Set `CLUB_WORKER` if your club dev server runs under another Worker name. Serve both on the same hostname, so the club's host-only dev cookie reaches CPE.

`pnpm test` runs the server tests. `pnpm typecheck` checks the app and the Worker as separate TypeScript projects.

## Deploy

CPE is its own Worker (`therestisaccountancy-cpe`), separate from the main site Worker. It serves the built app as static assets and its API under `/api`, on `cpe.therestisaccountancy.com`. The configuration is in `cloudflare.config.ts`. Read `PRODUCTION.md` before the first deploy: it lists the resources to create and the deploy order.

```bash
pnpm run deploy
```

Use `pnpm run deploy`: a bare `pnpm deploy` runs pnpm's own built-in deploy command instead of this script.

This typechecks, builds with Vite and the Cloudflare Vite plugin, checks that no answers reached the browser bundle, and deploys with `cf`.

## Regenerate the course audio

The sample courses are narrated with macOS `say` and joined with `ffmpeg`. The script also measures exact segment timings and waveform peaks.

```bash
pnpm audio
```

Edit a script in `worker/seed/catalog.ts` and rerun the command. New courses are written and published in the Studio at `/studio` instead. Unchanged courses are skipped. In a sandboxed shell, `say` writes silent files, so run the command outside the sandbox. The script stops with an error if a segment renders no audio.

## Design

- `src/tokens.css` mirrors the token names and values from therestisaccountancy.com, then adds the CPE layer on top: the sub-brand green (`--cpe`, the green of columnar ledger pads) and a radius scale. The green has one job only: play, progress and earned credit.
- The wordmark in `src/assets/tria-wordmark.svg` is the club's own file, inlined unaltered.
- Cover art is generated in `src/components/Cover.tsx` in the club's image language: a black grid panel, a halftone object, tape and the red tick.
- Interactive parts are Base UI (`@base-ui/react`): Dialog for review questions and ledger forms, AlertDialog for reset, Slider for the waveform scrubber, Select, RadioGroup, ToggleGroup, Field, Form, NumberField, Progress, Meter, Toast and Tooltip. They ship unstyled and are styled in `src/styles.css` through their data attributes.
- The layout follows Spotify's model in light mode: a rail, a library, shelves, a persistent player bar, and a tab bar on phones.

## How it is built

- `worker/` is the server: the API router (`index.ts`), the Studio routes (`studio.ts`), the catalogue and learner stores (`catalogue.ts`, `learner.ts`, as Durable Objects in `objects.ts`), audio streaming and uploads (`audio.ts`), and segment alignment (`alignment.ts`). `worker/seed/` holds the sample courses' scripts, with answers. It reaches only the Worker bundle.
- `src/domain/routes.ts` is the API contract: every route with what it takes and replies. The Worker's handlers (`route()` in `worker/http.ts`) and the app's `api()` are both typed from it, so changing a reply breaks the build on whichever side is out of date. Identity from the club follows `../src/server/cpe-contract.ts`, which the club's `CpeIdentity` entrypoint implements.
- `src/domain/rules.ts` holds the credit rules, shared by the server, which decides credit, and the app, which shows it. A course's phase is derived from the server's evidence: the ranges heard, the review questions answered, and the attempts made.
- `src/domain/ledger.ts` turns certificates and logged entries into ledger lines, the standing against the cycle, and the CSV export.
- `src/player.tsx` runs one shared audio element. It reports the element's own played ranges to the server, so seeking never counts. Playback stops at each unanswered review question, unless hands-free is on.
- `src/studio/` is the Studio for club admins.

## Rules

- 95% of the audio must be heard, and every review question answered, before the assessment opens.
- The pass mark is 70%. A half-credit course has 3 questions, so it needs 3 of 3. A one-credit course has 5 questions and needs 4.
- Retakes are unlimited, and the options are reshuffled each time.

## Not real yet

- The sample courses use synthetic voices and shortened audio. Credits and certificates are not accredited, and the professional body whose rules they must meet is still to be decided.
