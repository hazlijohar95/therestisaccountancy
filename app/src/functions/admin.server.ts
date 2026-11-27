import { everyRate } from '../../../src/data/membership.ts';
import type { PasswordLink } from '../../../src/server/club.ts';
import { passwordLetter } from '../../../src/server/letters.ts';
import { send } from '../../../src/server/mail.ts';
import { formatDay } from '../../../src/lib/format.ts';
import { pagingOf } from '../../../src/lib/paging.ts';
import { absolute } from '../lib/mail.server.ts';

/** Today's date in Malaysia, as a date input's min. */
export const malaysiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());

/** The page asked for, read as ?page= is everywhere else. */
export const pagingFor = (page: number | undefined, size: number) => pagingOf(new URL(`http://admin/?page=${page ?? ''}`), size);

/** What the admin sees of a link they issued: who it is for, whether it was emailed, and the link to send by hand if not. */
export interface Issued {
  readonly name: string;
  readonly email: string;
  readonly purpose: PasswordLink['purpose'];
  readonly link: string;
  /** The day it runs out, as the admin reads it. */
  readonly expires: string;
  readonly emailed: boolean;
}

/** Emails a link an admin issued, and waits for it, so the admin sees whether it went. */
export async function deliver({ member, purpose, token, expiresAt }: PasswordLink): Promise<Issued> {
  const shared = {
    name: member.name,
    email: member.email,
    purpose,
    link: absolute(`/welcome?token=${encodeURIComponent(token)}`),
    expiresAt,
    /** What they can pay, told with the invitation. Admins do not pay, and the social site is free until the club accepts them. */
    rate: member.role === 'admin' || !member.clubApproved ? null : everyRate,
    welcomeTo: member.clubApproved ? ('club' as const) : ('social' as const),
  };
  const emailed = await send(passwordLetter(shared));
  return { name: shared.name, email: shared.email, purpose, link: shared.link, expires: formatDay(expiresAt), emailed };
}
