import { site } from '../../../src/data/site.ts';

/** A tab title: the page's own name, then the site's. Without a name, the site's full title. */
export const clubTitle = (name?: string) => [{ title: name ? `${name} · ${site.name}` : site.title }];
export const socialTitle = (name?: string) => [{ title: name ? `${name} · ${site.name} Social` : `${site.name} Social` }];
export const noindex = { name: 'robots', content: 'noindex' } as const;
