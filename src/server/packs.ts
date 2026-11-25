import { programmes, type Programme } from '../data/programmes.ts';
import { allResources, type Resource } from './resources.ts';

/** A builder pack: one programme's templates, ready to use with a member's own clients. */
export interface Pack {
  readonly programme: Programme;
  readonly resources: readonly Resource[];
}

export const packPath = (pack: Pick<Pack, 'programme'>) => `/packs/${pack.programme.slug}` as const;
export const packName = (pack: Pick<Pack, 'programme'>) => `The ${pack.programme.name} pack`;

/** Every programme that has templates, in programme order. A programme gets a pack once its first template is written. */
export async function allPacks(): Promise<Pack[]> {
  const resources = await allResources();
  return programmes
    .map((programme) => ({ programme, resources: resources.filter((r) => r.data.programme === programme.slug) }))
    .filter((pack) => pack.resources.length > 0);
}
