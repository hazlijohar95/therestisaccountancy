/* The kinds of live session. Kept apart from the page copy because the recordings collection validates against it. */
export const SESSION_KINDS = ['Guest sessions', 'Live programmes', 'Clinics'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
