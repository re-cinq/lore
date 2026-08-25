/**
 * Contracts for the implementation-loop repo surface (implementation-loop
 * FR10). The named `ImplementationLoop` component is what web-ui aliases from
 * the generated schema.d.ts — name it deliberately, keep it stable.
 */

import { z } from "zod";

export const TicketSchema = z.object({
  issue_number: z.number().int(),
  issue_url: z.string().nullable(),
  title: z.string(),
  /** The `priority:*` label, when the issue is still open to read it from. */
  priority: z.string().nullable(),
  pr_url: z.string().nullable(),
  /** Task status for current/recent; `queued` for the not-yet-picked. */
  state: z.string(),
});

export const ImplementationLoopSchema = z.object({
  enabled: z.boolean(),
  current: TicketSchema.nullable(),
  next: z.array(TicketSchema),
  recent: z.array(TicketSchema),
});

export const ToggleBodySchema = z.object({ enabled: z.boolean() });

export const ToggleResultSchema = z.object({
  ok: z.literal(true),
  enabled: z.boolean(),
});

export type Ticket = z.infer<typeof TicketSchema>;
