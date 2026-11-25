import type { ReactNode, SVGProps } from "react";
import { colors } from "../generated/tokens.js";
import { type Box, clubGeometry, podcastGeometry } from "./geometry.js";

export type LogoVariant = "color" | "reversed" | "mono";
export type PodcastLayout = "lockup" | "tagline" | "wordmark";

const { ink: INK, paper: PAPER, tape: TAPE } = colors;

type SvgProps = Omit<SVGProps<SVGSVGElement>, "children" | "viewBox" | "color" | "width" | "height" | "ref">;

/** `color` exists only for `mono`; the colour and reversed files are fixed artwork. */
type Colouring =
  | { variant?: "color" | "reversed"; color?: never }
  | { variant: "mono"; color?: string };

interface Sizing {
  /** Rendered width. Height follows the artwork's aspect ratio, so nothing stretches. */
  size?: number | string;
  /** Accessible name. Without one the logo is treated as decoration and hidden from assistive tech. */
  title?: string;
}

export type ClubLogoProps = SvgProps & Sizing & Colouring & { layout?: never };
export type PodcastLogoProps = SvgProps & Sizing & Colouring & { layout?: PodcastLayout };

function wordFill(variant: LogoVariant | undefined, color: string | undefined): string {
  if (variant === "mono") return color ?? "currentColor";
  return variant === "reversed" ? PAPER : INK;
}

function Frame({ box, size, title, children, ...rest }: SvgProps & Sizing & { box: Box; children: ReactNode }) {
  const [x, y, w, h] = box;
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${x} ${y} ${w} ${h}`} width={size} {...a11y} {...rest}>
      {children}
    </svg>
  );
}

/** The Rest Is Accountancy wordmark. `mono` draws in `currentColor` unless you pass `color`. */
export function ClubLogo({ variant, color, layout: _layout, ...rest }: ClubLogoProps) {
  const fill = wordFill(variant, color);
  return (
    <Frame box={clubGeometry.box} {...rest}>
      {clubGeometry.wordmark.map((d, i) => <path key={i} fill={fill} d={d} />)}
    </Frame>
  );
}

/**
 * Stick to Accounting. `lockup` is the tape label and wordmark, `tagline` adds "Death, Taxes and Ai.",
 * `wordmark` drops the tape. In `mono`, "Podcast Show" is cut out of the tape.
 */
export function PodcastLogo({ variant, color, layout = "lockup", ...rest }: PodcastLogoProps) {
  const fill = wordFill(variant, color);
  const g = podcastGeometry;
  const tape = layout === "wordmark" ? null
    : variant === "mono"
      ? <path fill={fill} fillRule="evenodd" d={[...g.tape, ...g.label].join("")} />
      : <>
          {g.tape.map((d, i) => <path key={i} fill={TAPE} d={d} />)}
          {g.label.map((d, i) => <path key={i} fill={INK} d={d} />)}
        </>;
  return (
    <Frame box={g.boxes[layout]} {...rest}>
      {tape}
      {g.wordmark.map((d, i) => <path key={i} fill={fill} d={d} />)}
      {layout === "tagline" ? g.tagline.map((d, i) => <path key={i} fill={fill} d={d} />) : null}
    </Frame>
  );
}
