import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { check } from '../lib/access.server.ts';

/** Why the visitor may not open a page that membership pays for, or null when they may. Billing lives in the store, so a route guard asks the server. */
export const gate = createServerFn({ method: 'GET' })
  .validator((level: 'paid') => z.literal('paid').parse(level))
  .handler(async ({ data: level }) => {
    const decision = await check(level);
    return decision.ok ? null : decision.denial;
  });
