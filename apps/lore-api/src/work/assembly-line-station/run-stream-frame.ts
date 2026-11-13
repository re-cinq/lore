// The one multiplexed run stream's frame contract (specs/assembly-line-run-viz FR7): five row families on one channel of the live socket, published in OpenAPI as `RunStreamFrame` so the web-ui reads it as a generated type rather than a hand mirror.

import { z } from "zod";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  AgentRunEventSchema,
  type AgentRunEvent,
} from "@re-cinq/lore-shared/models/agent-run-event.js";
import {
  TASK_EVENT_COLUMNS,
  TaskEventSchema,
  type TaskEvent,
} from "@re-cinq/lore-shared/models/task-event.js";
import type {
  AssemblyRunRecord,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  StationRunRowSchema,
  toStationRunRow,
} from "../assembly-runs/station-run-row.js";

/** The run's own facts the header reads; everything a `run_status` frame can change. */
export const RunStatusSchema = z.object({
  id: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  reason: z.string().nullable(),
  started_at: z.date().nullable(),
  finished_at: z.date().nullable(),
});

/** What the plan page shows of the plan's current planning run beyond its status (specs/plan-detail-fast-open FR4): the user story it was started for, its spec PR as GitHub last described it, and the spec analysis's question. Sent whole in every `plan_run` message, so a frame never has to be merged into the one before it. */
export const PlanRunFactsSchema = RunStatusSchema.pick({
  id: true,
  status: true,
  outcome: true,
  reason: true,
}).extend({
  issue_url: z.string().nullable(),
  issue_number: z.number().nullable(),
  pr_url: z.string().nullable(),
  pr_number: z.number().nullable(),
  pr_title: z.string().nullable(),
  /** Null when GitHub would not say, so a failed read never passes for a PR with no open threads. */
  pr_unresolved_threads: z.number().nullable(),
  spec_plan_summary: z.string().nullable(),
});

export type PlanRunFacts = z.infer<typeof PlanRunFactsSchema>;

const TaskEventWireSchema = wireSchema(TaskEventSchema, TASK_EVENT_COLUMNS);

/** GitHub's own PR status read (`fetchPrStatus`) at one moment; the field names inside `status` are GitHub's. */
export const CiCheckSchema = z.object({
  repo: z.string(),
  pr_number: z.number(),
  observed_at: z.date(),
  status: z.record(z.string(), z.unknown()),
});

export const RunStreamFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent_event"), event: AgentRunEventSchema }),
  z.object({ type: z.literal("node_status"), node: StationRunRowSchema }),
  z.object({ type: z.literal("run_status"), run: RunStatusSchema }),
  z.object({ type: z.literal("task_event"), event: TaskEventWireSchema }),
  z.object({ type: z.literal("ci_check"), check: CiCheckSchema }),
  z.object({ type: z.literal("catchup_complete"), last_id: z.string() }),
]);

export type RunStreamFrame = z.infer<typeof RunStreamFrameSchema>;

export const agentEventFrame = (event: AgentRunEvent): RunStreamFrame => ({
  type: "agent_event",
  event,
});

export const nodeStatusFrame = (node: StationRunRecord): RunStreamFrame => ({
  type: "node_status",
  node: toStationRunRow(node),
});

export const runStatusFrame = (run: AssemblyRunRecord): RunStreamFrame => ({
  type: "run_status",
  run: {
    id: run.id,
    status: run.status,
    outcome: run.outcome,
    reason: run.reason,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
  },
});

export const taskEventFrame = (event: TaskEvent): RunStreamFrame => ({
  type: "task_event",
  event: {
    id: event.id,
    task_id: event.taskId,
    from_status: event.fromStatus,
    to_status: event.toStatus,
    metadata: event.metadata,
    created_at: event.createdAt,
  },
});

export const ciCheckFrame = (
  repo: string,
  prNumber: number,
  status: Record<string, unknown>,
  observedAt: Date,
): RunStreamFrame => ({
  type: "ci_check",
  check: { repo, pr_number: prNumber, observed_at: observedAt, status },
});

export const catchupFrame = (lastId: string): RunStreamFrame => ({
  type: "catchup_complete",
  last_id: lastId,
});
