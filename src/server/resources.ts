import { getCollection, type CollectionEntry } from 'astro:content';
import { programmeSlugs, type ProgrammeSlug } from '../data/programmes.ts';
import { templateParts, type TemplateParts } from '../lib/template.ts';

export type Resource = CollectionEntry<'resources'>;

const inPlace = (a: Resource, b: Resource) =>
  programmeSlugs.indexOf(a.data.programme) - programmeSlugs.indexOf(b.data.programme) || a.data.module - b.data.module || a.data.title.localeCompare(b.data.title);

/** Every template, in programme order, then by module and title. */
export async function allResources(): Promise<Resource[]> {
  return (await getCollection('resources')).sort(inPlace);
}

/** A programme's templates, or one module's when a module is given. */
export async function resourcesOf(programme: ProgrammeSlug, module?: number): Promise<Resource[]> {
  const found = await getCollection('resources', (r) => r.data.programme === programme && (module === undefined || r.data.module === module));
  return found.sort(inPlace);
}

export const resourcePath = (resource: Pick<Resource, 'id'>) => `/members/resources/${resource.id}`;
export const downloadPath = (resource: Pick<Resource, 'id'>) => `${resourcePath(resource)}.md`;

/** The note to the member and the template itself, as the template's page shows them. */
export const partsOf = (resource: Resource): TemplateParts => templateParts(resource.rendered?.html ?? '');
