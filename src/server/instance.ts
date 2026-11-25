import type { DatabaseSync } from 'node:sqlite';
import { DATABASE_PATH } from 'astro:env/server';
import { createClub, type Club } from './club.ts';
import { createCommunity, type Community } from './community.ts';
import { openDatabase } from './db.ts';

let db: DatabaseSync | undefined;
let club: Club | undefined;
let community: Community | undefined;

/** One connection, opened on first use so prerendering never touches the database. */
const database = () => (db ??= openDatabase(DATABASE_PATH));

export const getClub = (): Club => (club ??= createClub(database()));
export const getCommunity = (): Community => (community ??= createCommunity(database()));
