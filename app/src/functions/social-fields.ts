import { z } from 'zod';
import { joinSection } from '../../../src/data/club.ts';

/* Field rules several Social forms share, said the way the club's forms say them. */

/** Text on one line: runs of whitespace, line breaks included, become one space. Names go into email subjects. */
export const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
export const email = z.string().trim().toLowerCase().pipe(z.email(joinSection.messages.email));
export const memberName = z.string().transform(oneLine).pipe(z.string().min(1, 'Enter a name.').max(60, 'Keep the name under 60 characters.'));
