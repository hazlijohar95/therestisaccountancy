import { clubGeometry, podcastGeometry } from "./geometry.js";
import type { LogoVariant, PodcastLayout } from "./logo.js";

export type Brand = "club" | "podcast";

/** Width of every bundled logo PNG; height follows the aspect ratio. */
export const LOGO_PNG_WIDTH = 2000;

export interface LogoAsset {
  brand: Brand;
  layout: "wordmark" | PodcastLayout;
  variant: LogoVariant;
  /** Width over height. */
  aspect: number;
  /** Package-relative path of the SVG file. */
  file: `assets/logos/${string}.svg`;
  /** Package-relative path of the PNG; mono logos have none (they take the surrounding colour). */
  png?: `assets/logos/png/${string}.png`;
  pngSize?: readonly [width: number, height: number];
}

const VARIANTS: readonly LogoVariant[] = ["color", "reversed", "mono"];

const entries: ReadonlyArray<{ brand: Brand; layout: LogoAsset["layout"]; prefix: string; size: readonly [number, number] }> = [
  { brand: "club", layout: "wordmark", prefix: "tria", size: [clubGeometry.box[2], clubGeometry.box[3]] },
  ...(["lockup", "tagline", "wordmark"] as const).map((layout) => ({
    brand: "podcast" as const,
    layout,
    prefix: "sta",
    size: [podcastGeometry.boxes[layout][2], podcastGeometry.boxes[layout][3]] as const,
  })),
];

/** Every logo file the package ships, in display order: club first, then each podcast layout. */
export const logoAssets: readonly LogoAsset[] = entries.flatMap(({ brand, layout, prefix, size: [w, h] }) =>
  VARIANTS.map((variant): LogoAsset => {
    const name = `${prefix}-${layout}-${variant}`;
    const base = { brand, layout, variant, aspect: Math.round((w / h) * 1e4) / 1e4, file: `assets/logos/${name}.svg` } as const;
    return variant === "mono"
      ? base
      : { ...base, png: `assets/logos/png/${name}.png`, pngSize: [LOGO_PNG_WIDTH, Math.ceil((LOGO_PNG_WIDTH * h) / w)] };
  }),
);
