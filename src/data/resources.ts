/* What kind of thing a template is. Kept apart from the page copy because the resources collection validates against it. */
export const RESOURCE_KINDS = ['Template', 'Checklist', 'Script', 'Prompts', 'Worksheet'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
