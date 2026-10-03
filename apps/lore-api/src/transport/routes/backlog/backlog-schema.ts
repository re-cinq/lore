// Contracts for the implementation-loop repo surface (FR10); the named ImplementationLoop component is what web-ui aliases from generated schema.d.ts — keep it stable.

import { z } from "zod";
import { TICKET_HOLD_KINDS } from "@re-cinq/lore-shared";
import { OkTrue } from "../../http/ok-schema.js";
import { PipelineNodeSchema } from "../../../work/assembly-line-station/mini-pipeline.js";

/** Why the loop is not working a ticket and what its reader does about it, worded once by the shared `ticketHold`. */
const TicketHoldSchema = z.object({
  kind: z.enum(TICKET_HOLD_KINDS),
  message: z.string(),
  fix: z.string(),
});

export const TicketSchema = z.object({
  issue_number: z.number().int(),
  issue_url: z.string().nullable(),
  title: z.string(),
  /** The `priority:*` label, when the issue is still open to read it from. */
  priority: z.string().nullable(),
  pr_url: z.string().nullable(),
  /** Task status for current/recent; `queued` for the not-yet-picked, `parked` for the ones the picker leaves out. */
  state: z.string(),
  /** Task creation for worked tickets, issue creation for queued ones. */
  created_at: z.string().nullable(),
  /** What holds the ticket, null when nothing does. */
  hold: TicketHoldSchema.nullable(),
  /** The ticket's newest run, for the mini graph + live-view link; null before its first pick. */
  run_id: z.string().nullable(),
  /** Node states in graph order; null when no run exists yet. */
  pipeline: z.array(PipelineNodeSchema).nullable(),
});

/** Why the loop may not be picking. It never picks for a repo whose onboarding PR has not merged, so the page needs whether it merged, the open onboarding PR if there is one, and the newest onboard task with why it failed. */
export const OnboardingSchema = z.object({
  merged: z.boolean(),
  /** The open onboarding PR; null once it merged, or when none was opened. */
  pr_url: z.string().nullable(),
  last_task: z
    .object({
      id: z.string(),
      status: z.string(),
      failure_reason: z.string().nullable(),
      /** Still running by the onboard guard's own definition, so the page links to it rather than offering a retry the guard would refuse. */
      in_flight: z.boolean(),
    })
    .nullable(),
});

export type Onboarding = z.infer<typeof OnboardingSchema>;

export const ImplementationLoopSchema = z.object({
  enabled: z.boolean(),
  onboarding: OnboardingSchema,
  current: TicketSchema.nullable(),
  /** The open backlog run's id — the live run view at /assembly-runs/{id}. */
  current_run_id: z.string().nullable(),
  next: z.array(TicketSchema),
  /** Open tickets someone queued that the picker leaves out (`lore:blocked`, or two priority labels), each with its hold. */
  parked: z.array(TicketSchema),
  recent: z.array(TicketSchema),
});

export const ToggleBodySchema = z.object({ enabled: z.boolean() });

export const ToggleResultSchema = z.object({
  ok: OkTrue,
  enabled: z.boolean(),
});

export type Ticket = z.infer<typeof TicketSchema>;
