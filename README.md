# The Rest Is Accountancy brand system

One coded design system for two brands:

- **The Rest Is Accountancy**: the club and community, and the parent brand. Black and white, quiet, exact. `data-brand="club"` (the default).
- **Stick to Accounting**: the podcast. A tape-yellow page, white panels, ink and marker. `data-brand="podcast"`.

There is no grey anywhere. Hierarchy comes from size and weight, and every rule is ink. A test enforces this.

```bash
pnpm install
pnpm dev       # the brand guide at http://localhost:4173
pnpm test      # compiles, then 42 checks with node:test
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

Any other `<svg>` prop passes through. The types reject what makes no sense: a `color` on a non-mono logo, a `layout` on the club logo, an unknown layout or variant. `type-tests/logo.ts` holds that contract and fails the build if it breaks.

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
<section data-brand="podcast">
  <span class="tape">Ep. 44</span>
  <h1 class="title">Who signs off <span class="mark">the AI audit</span>?</h1>
  <a class="btn" href="/listen">Listen now</a>
</section>
```

`brand.css` is the only stylesheet a page needs. It loads `fonts.css` (self-hosted, nothing fetched from Google at runtime) and `tokens.css`. Brands nest safely both ways: every per-brand difference is a custom property set in the brand scope, never a descendant selector.

Semantic variables: `--bg`, `--surface`, `--ink`, `--muted`, `--rule`, `--accent`, `--on-accent`, `--mark`, `--on-mark`, `--alert`. Each resolves per brand and per light or dark mode. Raw colours are `--color-*`; use them only for artwork that must not follow the theme.

## Logos

The React components are the single source. `npm run build:logos` renders them into the files below, and a test fails if a file differs from its component by one byte. `assets/logos/catalog.json` lists every file with its brand, layout, variant, aspect ratio, byte size and PNG size.

| File | What |
| --- | --- |
| `tria-wordmark-{color,reversed,mono}.svg` | The Rest Is Accountancy |
| `sta-lockup-{color,reversed,mono}.svg` | Tape label and wordmark |
| `sta-tagline-{color,reversed,mono}.svg` | Lockup with "Death, Taxes and Ai." |
| `sta-wordmark-{color,reversed,mono}.svg` | Wordmark only, for where the tape won't fit |
| `png/*.png` | 2000px-wide transparent PNG of every non-mono file |

`mono` draws in `currentColor`; in the podcast mono files, "Podcast Show" is cut out of the tape. Every SVG is tight-cropped, has a `viewBox` and no fixed size, carries an accessible name, and contains plain paths only: no ids, styles, transforms, filters, masks or bitmaps.

The geometry (`src/logo/geometry.ts`) comes from the designer's files. The Illustrator export of `source/sta-artwork.ai` (the designer's "STA_artwork share.ai") wraps the artwork in masks, filters and bitmap textures; `scripts/extract-logos.py` follows those references back to the original vector paths and bakes them into plain coordinates. The result matches the original render at 99.95% pixel overlap. The tape's photographic crinkle is dropped: the tape is a flat `#F7D52A` shape.

## Files

| Path | What |
| --- | --- |
| `tokens/tokens.json` | Source of truth: colours, type, space, strokes, shadow, per-brand roles and style, and the contrast contract |
| `css/tokens.css`, `src/generated/tokens.ts` | Generated from the JSON |
| `src/logo/` | `ClubLogo`, `PodcastLogo`, the `logoAssets` manifest and the extracted geometry |
| `dist/` | Compiled ES modules and `.d.ts` files (built by `pnpm build`) |
| `css/fonts.css`, `assets/fonts/` | Fraunces, Gochi Hand and Instrument Sans, latin and latin-ext subsets, each with its `unicode-range` |
| `css/brand.css` | Type, graphic devices and components |
| `css/guide.css`, `js/guide.js`, `index.html` | The brand guide only |
| `llms.txt` | The rules and file map for AI agents |
| `source/` | The designer's artwork the logo geometry is extracted from |
| `tests/`, `type-tests/` | Tokens, components, logos, fonts, package exports, the guide, and the public types |

## Commands

```bash
pnpm build:tokens    # after editing tokens/tokens.json (fails on a contrast breach)
pnpm extract:logos   # after the designer sends new artwork (needs poppler)
pnpm build:logos     # render the SVG files and PNGs from the components (PNGs need librsvg)
pnpm fonts           # re-download the font subsets
```

## What the tests guard

- `css/tokens.css` and `src/generated/tokens.ts` are exactly what the build would write, and every theme role resolves in both brands and both modes.
- Every logo file is byte-identical to its component's output. Components handle accessibility, sizing, colour, mono knockout, layouts and prop pass-through as documented.
- The public types accept what they should and reject what they shouldn't. Every package export resolves to a shipped file, the root entry never imports React, and React is a peer dependency.
- Every text pair passes its WCAG contrast minimum, and no theme role is grey.
- Every logo is a clean, safe, tight vector within an 80 KB budget, uses only palette fills or `currentColor`, has its PNG at the stated size, and is listed in the catalog. `assets/` stays under 3 MB.
- Every font face points at a bundled woff2 with a `unicode-range`, and every brand typeface is bundled.
- Every file the guide references exists, nothing loads from another host, every id the script uses exists, and no grey is hardcoded.

## Where the values come from

- Ink `#231F20` and tape `#F7D52A` were read from the fills in `source/sta-artwork.ai`.
- Highlighter `#F4DD6C` comes from the Canva banner (design DAGMKtAnOXY). The banner's grey paper `#EAEAEA` was dropped.
- Redline `#A8180F` is new to this system, dark enough to read on tape yellow (5.2:1).
- Both wordmarks are outlined artwork, and their original typefaces are not in the files. Fraunces, Gochi Hand and Instrument Sans are open-licence companions, not the logo fonts.
- Logo design by Kavindu Sooriya Design; copyright transferred to The Rest Is Accountancy on 6 January 2024.
