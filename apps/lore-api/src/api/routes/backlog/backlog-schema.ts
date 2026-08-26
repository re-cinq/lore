/**
 * Contracts for the implementation-loop repo surface (implementation-loop
 * FR10). The named `ImplementationLoop` component is what web-ui aliases from
 * the generated schema.d.ts — name it deliberately, keep it stable.
 */

import { z } from "zod";

/** One node of a ticket's run, in graph order — the mini pipeline's dot. */
export const PipelineNodeSchema = z.object({
  node_id: z.string(),
  /** success | failed | changes_requested | running | waiting | pending */
  state: z.string(),
});

export const TicketSchema = z.object({
  issue_number: z.number().int(),
  issue_url: z.string().nullable(),
  title: z.string(),
  /** The `priority:*` label, when the issue is still open to read it from. */
  priority: z.string().nullable(),
  pr_url: z.string().nullable(),
  /** Task status for current/recent; `queued` for the not-yet-picked. */
  state: z.string(),
  /** Task creation for worked tickets, issue creation for queued ones. */
  created_at: z.string().nullable(),
  /** The ticket's run, for the mini graph + live-view link; null pre-pick. */
  run_id: z.string().nullable(),
  /** Node states in graph order; null when no run exists yet. */
  pipeline: z.array(PipelineNodeSchema).nullable(),
});

export const ImplementationLoopSchema = z.object({
  enabled: z.boolean(),
  current: TicketSchema.nullable(),
  /** The open backlog run's id — the live run view at /assembly-runs/{id}. */
  current_run_id: z.string().nullable(),
  next: z.array(TicketSchema),
  recent: z.array(TicketSchema),
});

export const ToggleBodySchema = z.object({ enabled: z.boolean() });

export const ToggleResultSchema = z.object({
  ok: z.literal(true),
  enabled: z.boolean(),
});

export type Ticket = z.infer<typeof TicketSchema>;
