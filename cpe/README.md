# CPE · The Rest Is Accountancy

A working prototype of cpe.therestisaccountancy.com. Accountants earn CPE by listening to episodes. Review questions arrive inside the episode, a short assessment confirms the learning, and the credit posts to a ledger with a certificate attached.

## Run

```bash
cd cpe
pnpm install
pnpm dev
```

The app opens on http://127.0.0.1:5180.

## Deploy

CPE is its own Worker (`therestisaccountancy-cpe`), separate from the main site Worker. It serves the built app as static assets on `cpe.therestisaccountancy.com`. The configuration is in `cloudflare.config.ts`.

```bash
pnpm deploy
```

This typechecks, builds with Vite and the Cloudflare Vite plugin, and deploys with `cf`.

## Regenerate the course audio

The sample courses are narrated with macOS `say` and joined with `ffmpeg`. The script also measures exact segment timings and waveform peaks.

```bash
pnpm audio
```

Edit a script in `src/content/catalog.ts` and rerun the command. Unchanged courses are skipped. In a sandboxed shell, `say` writes silent files, so run the command outside the sandbox. The script stops with an error if a segment renders no audio.

## Design

- `src/tokens.css` mirrors the token names and values from therestisaccountancy.com, then adds the CPE layer on top: the sub-brand green (`--cpe`, the green of columnar ledger pads) and a radius scale. The green has one job only: play, progress and earned credit.
- The wordmark in `src/assets/tria-wordmark.svg` is the club's own file, inlined unaltered.
- Cover art is generated in `src/components/Cover.tsx` in the club's image language: a black grid panel, a halftone object, tape and the red tick.
- Interactive parts are Base UI (`@base-ui/react`): Dialog for review questions and ledger forms, AlertDialog for reset, Slider for the waveform scrubber, Select, RadioGroup, ToggleGroup, Field, Form, NumberField, Progress, Meter, Toast and Tooltip. They ship unstyled and are styled in `src/styles.css` through their data attributes.
- The layout follows Spotify's model in light mode: a rail, a library, shelves, a persistent player bar, and a tab bar on phones.

## How it is built

- `src/content/catalog.ts` holds the shows and the course scripts: segments, review questions, the assessment, objectives and glossary.
- `src/domain/progress.ts` holds the credit rules. A course's phase is derived from evidence: the ranges heard, the review questions answered, and the attempts made. It is never stored as a flag.
- `src/domain/ledger.ts` turns certificates and logged entries into ledger lines, the standing against the cycle, and the CSV export.
- `src/player.tsx` runs one shared audio element. Heard ranges come from the element's own `played` ranges, so seeking never counts. Playback stops at each unanswered review question.
- Progress is stored in `localStorage` under `tria-cpe:v1`.

## Rules in the prototype

- 95% of the audio must be heard, and every review question answered, before the assessment opens.
- The pass mark is 70%. A half-credit course has 3 questions, so it needs 3 of 3. A one-credit course has 5 questions and needs 4.
- Retakes are unlimited, and the options are reshuffled each time.

## Not real yet

- The sample courses use synthetic voices and shortened audio. Credits and certificates are illustrative and not accredited.
- There are no accounts and no server. Each browser keeps its own progress.
