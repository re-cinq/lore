// The one multiplexed run stream's frame contract (specs/assembly-line-run-viz FR7): five row families on one SSE connection, published in OpenAPI as `RunStreamFrame` so the web-ui reads it as a generated type rather than a hand mirror.

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
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { StationRun } from "@re-cinq/lore-shared/models/station-run.js";
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

export const nodeStatusFrame = (node: StationRun): RunStreamFrame => ({
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

/** One SSE message. Only an agent event carries an `id:` line: per the SSE spec a frame without one leaves the browser's `Last-Event-ID` untouched, so the cursor stays the agent_run_events row id and every other family is a snapshot the client applies idempotently. */
export function sseFrame(frame: RunStreamFrame): string {
  const id = frame.type === "agent_event" ? `id: ${frame.event.id}\n` : "";

  return `${id}event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`;
}

export function sseComment(text: string): string {
  return `: ${text}\n\n`;
}
