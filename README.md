# The Rest Is Accountancy brand system

One coded design system for two brands:

- **The Rest Is Accountancy**: club, membership and community. The parent brand. Black and white, quiet, exact. `data-brand="club"` (the default).
- **Stick to Accounting**: media and podcast. A tape-yellow page, white panels, ink and marker. `data-brand="podcast"`.

There is no grey. Hierarchy comes from size and weight, and every rule is ink.

```bash
pnpm install
pnpm dev       # the brand guide at http://localhost:4173
pnpm test      # compiles, then runs every check with node:test
```

## React

```tsx
import { ClubLogo, PodcastLogo } from "@therestisaccountancy/brand/logo"

<ClubLogo title="The Rest Is Accountancy" size={160} />
<ClubLogo variant="mono" />                       // draws in currentColor
<PodcastLogo layout="tagline" title="Stick to Accounting" />
<PodcastLogo variant="reversed" />                // on black
<PodcastLogo variant="mono" color="#A8180F" />    // one colour; "Podcast Show" cut out of the tape
```

| Prop | Values | Default |
| --- | --- | --- |
| `layout` (podcast only) | `"lockup"` · `"tagline"` · `"wordmark"` | `"lockup"` |
| `variant` | `"color"` · `"reversed"` · `"mono"` | `"color"` |
| `color` (mono only) | any CSS colour | `currentColor` |
| `size` | the width; height follows the artwork | intrinsic |
| `title` | accessible name; without it the logo is decorative (`aria-hidden`) | none |

Any other `<svg>` prop passes through. The types reject a `color` on a non-mono logo, a `layout` on the club logo, and an unknown layout or variant. `type-tests/logo.ts` holds that contract.

The root entry is React-free:

```ts
import { colors, themes, themeVariables, logoAssets } from "@therestisaccountancy/brand"

colors.tape                  // "#F7D52A"
themes.podcast.bg            // ["#F7D52A", "#000000"], as [light, dark]
`var(${themeVariables.onAccent})`  // "var(--on-accent)"
logoAssets                   // every logo file with brand, layout, variant, aspect and PNG size
```

## CSS

```html
<link rel="stylesheet" href="css/brand.css">
<section class="ground" data-brand="podcast">
  <span class="tape">Ep. 44</span>
  <h1 class="title">Who signs off <span class="mark">the AI audit</span>?</h1>
  <a class="btn" href="/listen">Listen now</a>
</section>
```

`brand.css` is the only stylesheet a page needs. It loads `fonts.css` (self-hosted) and `tokens.css`.

`data-brand` sets the brand for everything inside an element. It sets no background: `body` takes the brand's ground, and `.ground` gives it to any other element. Every per-brand difference is a custom property, so brands nest either way.

Semantic variables: `--bg`, `--surface`, `--ink`, `--accent`, `--on-accent`, `--mark`, `--on-mark`, `--alert`. Each resolves per brand and per light or dark mode. Raw colours are `--color-*`, for artwork that must not follow the theme.

Every class in `brand.css` is shown working in the guide.

## Logos

The React components are the single source. `pnpm build:logos` renders them into the files below, and a test fails if a file differs from its component by one byte. `assets/logos/catalog.json` lists every file with its brand, layout, variant, aspect ratio, byte size and PNG size.

| File | What |
| --- | --- |
| `tria-wordmark-{color,reversed,mono}.svg` | The Rest Is Accountancy |
| `sta-lockup-{color,reversed,mono}.svg` | Tape label and wordmark |
| `sta-tagline-{color,reversed,mono}.svg` | Lockup with "Death, Taxes and Ai." |
| `sta-wordmark-{color,reversed,mono}.svg` | Wordmark only, for where the tape won't fit |
| `png/*.png` | 2000px-wide transparent PNG of every non-mono file |

`mono` draws in `currentColor`; in the podcast mono files, "Podcast Show" is cut out of the tape. Every SVG is tight-cropped plain paths with a `viewBox`, no fixed size and an accessible name.

The geometry (`src/logo/geometry.ts`) comes from the designer's files. Illustrator wraps the artwork in `source/sta-artwork.ai` in masks, filters and bitmap textures; `scripts/extract-logos.py` follows those back to the original vector paths. The result matches the original render at 99.95% pixel overlap. The tape's photographic crinkle is dropped: the tape is a flat `#F7D52A` shape.

## Files

| Path | What |
| --- | --- |
| `tokens/tokens.json` | Source of truth: colours, type, space, strokes, angles, motion, per-brand roles and settings, and the contrast contract |
| `css/tokens.css`, `src/generated/tokens.ts` | Generated from the JSON |
| `css/brand.css` | Type, graphic devices and components |
| `css/fonts.css`, `assets/fonts/` | Geist Serif, Geist Mono, Geist Pixel, Fraunces, Gochi Hand and Instrument Sans, latin and latin-ext |
| `src/logo/` | `ClubLogo`, `PodcastLogo`, the `logoAssets` manifest and the extracted geometry |
| `dist/` | Compiled ES modules and `.d.ts` files (built by `pnpm build`) |
| `index.html`, `guide/` | The brand guide. Not part of the package. |
| `llms.txt` | The rules and file map for AI agents |
| `source/` | The designer's artwork |
| `tests/`, `type-tests/` | Checks on tokens, components, logos, fonts, package exports, the guide and the public types |

## Commands

```bash
pnpm build:tokens    # after editing tokens/tokens.json (fails on a contrast breach)
pnpm extract:logos   # after the designer sends new artwork (needs poppler)
pnpm build:logos     # render the SVG files and PNGs from the components (PNGs need librsvg)
pnpm fonts           # re-download the fonts (Google Fonts, and the geist npm package for Geist Serif)
```

## Where the values come from

- Ink `#231F20` and tape `#F7D52A` were read from the fills in `source/sta-artwork.ai`.
- Highlighter `#F4DD6C` comes from the Canva banner. The banner's grey paper was dropped.
- Redline `#A8180F` is new to this system, dark enough to read on tape yellow (5.2:1). On dark grounds it lifts to `#FF6A5C`.
- Both wordmarks are outlined artwork, and their original typefaces are not in the files. Geist Serif (club display), Fraunces (podcast display), Gochi Hand, Instrument Sans, Geist Mono (code) and Geist Pixel (podcast timecodes) are open-licence companions, not the logo fonts.
- Logo design by Kavindu Sooriya Design; copyright transferred to The Rest Is Accountancy on 6 January 2024.
