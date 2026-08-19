import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.agent_run_events` — one projected tool call from an agent's
 * stream-json output, behind the live run visualization (ADR-037).
 *
 * DDL: migration `0031_agent_run_events.sql`, plus `station_run_id` (0040).
 * No foreign keys, deliberately: ingest is skip-not-fail, and an FK would let
 * one unknown id drop a whole batch.
 *
 * `id` is a string-encoded bigint — it outgrows `Number.MAX_SAFE_INTEGER` and
 * doubles as the SSE `Last-Event-ID` cursor, so it is never a JS number.
 *
 * `assemblyLineId` keeps the PRE-RENAME spelling: 0040 renamed the tables this
 * column points AT, but a pointer column on a same-named table has no compat
 * view to hide behind (0040:130-137). `stationRunId` is the go-forward key.
 */

export const AgentRunEventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentCrName: z.string().nullable(),
  assemblyLineId: z.string().nullable(),
  stationRunId: z.string().nullable(),
  nodeId: z.string().nullable(),
  iteration: z.number().nullable(),
  eventType: z.string(),
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
