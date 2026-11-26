import catalog from '@therestisaccountancy/brand/logos/catalog.json';
import staLockup from '@therestisaccountancy/brand/logos/sta-lockup-mono.svg?url';
import staWordmark from '@therestisaccountancy/brand/logos/sta-wordmark-mono.svg?url';
import tria from '@therestisaccountancy/brand/logos/tria-wordmark-mono.svg?url';
import type { CSSProperties } from 'react';

const aspectOf = (file: string): number => {
  const entry = catalog.find((e) => e.file === `assets/logos/${file}`);
  if (!entry) throw new Error(`${file} is not in the brand's logo catalog`);
  return entry.aspect;
};

const LOGOS = {
  club: { '--aspect': aspectOf('tria-wordmark-mono.svg'), '--logo': `url("${tria}")` },
  podcast: { '--aspect': aspectOf('sta-lockup-mono.svg'), '--logo': `url("${staLockup}")`, '--logo-narrow': `url("${staWordmark}")` },
} satisfies Record<'club' | 'podcast', CSSProperties>;

/** The brand's mark, drawn from its CSS mask. Without a label it is decorative. */
export function Logo({ brand, label, className }: { brand: 'club' | 'podcast'; label?: string | undefined; className?: string | undefined }) {
  return (
    <span
      className={className ? `logo ${className}` : 'logo'}
      style={LOGOS[brand]}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
