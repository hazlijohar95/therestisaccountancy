// Compile-time contract for the public types. `pnpm test` type-checks this file; a wrong line fails it.
import type { ClubLogoProps, PodcastLogoProps } from "../src/logo/index.js";
import type { ThemeRole } from "../src/index.js";

type Accepts<Props, Value> = [Value] extends [Props] ? true : false;
type Expect<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;

export type Contract = [
  Expect<Accepts<ClubLogoProps, { variant: "mono"; color: "#A8180F" }>>,
  Expect<Accepts<ClubLogoProps, { title: "The Rest Is Accountancy"; size: 120 }>>,
  Expect<Accepts<PodcastLogoProps, { layout: "tagline"; variant: "reversed" }>>,
  Expect<Accepts<PodcastLogoProps, { layout: "wordmark"; variant: "mono" }>>,
  // A colour only means something for mono; the other variants are fixed artwork.
  Expect<Not<Accepts<ClubLogoProps, { variant: "color"; color: "#A8180F" }>>>,
  Expect<Not<Accepts<PodcastLogoProps, { color: "#A8180F" }>>>,
  // The club has one layout, so it takes no layout prop.
  Expect<Not<Accepts<ClubLogoProps, { layout: "lockup" }>>>,
  Expect<Not<Accepts<PodcastLogoProps, { layout: "banner" }>>>,
  Expect<Not<Accepts<PodcastLogoProps, { variant: "gradient" }>>>,
  Expect<Accepts<ThemeRole, "onAccent">>,
  Expect<Not<Accepts<ThemeRole, "grey">>>,
];
