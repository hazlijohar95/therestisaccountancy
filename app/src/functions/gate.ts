import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { check } from '../lib/access.server.ts';

/** Why the visitor may not open a club page at this level, or null when they may. For route guards, which run in the browser too. */
export const gate = createServerFn({ method: 'GET' })
  .validator((level: 'member' | 'paid' | 'admin') => z.enum(['member', 'paid', 'admin']).parse(level))
  .handler(async ({ data: level }) => {
    const decision = await check(level);
    return decision.ok ? null : decision.denial;
  });
