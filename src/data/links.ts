/** A link that sets a member's password. For someone without one it is an invitation; for an active member it is a reset. */
export type LinkPurpose = 'welcome' | 'reset';

/** A reset is short-lived: the member asked for it and is waiting. A newcomer may take a while to open their invitation. */
export const LINK_DAYS = { welcome: 14, reset: 3 } as const satisfies Record<LinkPurpose, number>;
