// Creates the club admin from ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD in .env. Run again to reset them.
import { createClub, memberNumber } from '../src/server/club.ts';
import { openDatabase } from '../src/server/db.ts';
import { MIN_PASSWORD_LENGTH } from '../src/server/password.ts';

const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, DATABASE_PATH } = process.env;

if (!ADMIN_EMAIL || !ADMIN_NAME || !ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD in .env, then run this again.');
  process.exit(1);
}
if (ADMIN_PASSWORD.length < MIN_PASSWORD_LENGTH) {
  console.error(`ADMIN_PASSWORD needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}

const club = createClub(openDatabase(DATABASE_PATH ?? 'data/club.sqlite'));
const admin = await club.ensureAdmin({ email: ADMIN_EMAIL.trim().toLowerCase(), name: ADMIN_NAME, password: ADMIN_PASSWORD });
console.log(`Admin ready: ${admin.name}, No. ${memberNumber(admin)}. Sign in at /sign-in.`);
