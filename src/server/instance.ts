import { exports } from 'cloudflare:workers';

/** The club and community, called across to the ClubStore. Every call is a round trip, so each returns a promise. */
export const openStore = () => exports.ClubStore.getByName('club').open();

export type Store = Awaited<ReturnType<typeof openStore>>;
