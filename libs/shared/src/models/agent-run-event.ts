import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.agent_run_events` (migration `0031`, + `station_run_id` in `0040`) — one projected tool call from an agent's stream-json output, behind the live run viz (ADR-037); no FKs (skip-not-fail ingest); `id` is a string-encoded bigint doubling as the SSE `Last-Event-ID` cursor; `assemblyLineId` keeps its pre-rename spelling since 0040 gave the pointed-at tables no compat view (0040:130-137) — `stationRunId` is the go-forward key. */

/** The seven stream-json line kinds the projector persists (others dropped); `hook` covers only a hook's TERMINAL line since `hook_progress` restates the whole output each time and this store has no fold. */
export const AgentRunEventTypeSchema = z.enum([
  "init",
  "message",
  "thinking",
  "tool_call",
  "tool_result",
  "result",
  "hook",
]);

export type AgentRunEventType = z.infer<typeof AgentRunEventTypeSchema>;

export const AgentRunEventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentCrName: z.string().nullable(),
  assemblyLineId: z.string().nullable(),
  stationRunId: z.string().nullable(),
  nodeId: z.string().nullable(),
  iteration: z.number().nullable(),
  eventType: AgentRunEventTypeSchema,
  toolName: z.string().nullable(),
  toolUseId: z.string().nullable(),
  isError: z.boolean(),
  filePaths: z.array(z.string()),
  summary: z.string().nullable(),
  payload: z.record(z.unknown()),
  createdAt: z.date(),
});

export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>;

export const AGENT_RUN_EVENT_COLUMNS = {
  id: "id",
  taskId: "task_id",
  agentCrName: "agent_cr_name",
  assemblyLineId: "assembly_line_id",
  stationRunId: "station_run_id",
  nodeId: "node_id",
  iteration: "iteration",
  eventType: "event_type",
  toolName: "tool_name",
  toolUseId: "tool_use_id",
  isError: "is_error",
  filePaths: "file_paths",
  summary: "summary",
  payload: "payload",
  createdAt: "created_at",
} as const satisfies ColumnMap<AgentRunEvent>;

export const AGENT_RUN_EVENT_TABLE = "pipeline.agent_run_events";
