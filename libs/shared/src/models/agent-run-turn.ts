import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.agent_run_turns` — the UNTRUNCATED stream-json line, kept whole.
 *
 * DDL: migration `0037_agent_run_turns.sql`, plus `station_run_id` (0040). The
 * sibling `agent_run_events` stores a truncated PROJECTION for the graph; this
 * stores `envelope`, the raw `{source, event}` line, which is what the
 * transcript view reads. Retiring the earlier fire-and-forget GCS archive is
 * recorded as an amendment on ADR-037.
 *
 * `id` is a string-encoded bigint and a cursor; `assemblyLineId` keeps its
 * pre-rename spelling for the reason given on `agent-run-event.ts`.
 */

export const AgentRunTurnSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  agentCrName: z.string().nullable(),
  assemblyLineId: z.string().nullable(),
  stationRunId: z.string().nullable(),
  nodeId: z.string().nullable(),
  iteration: z.number().nullable(),
  eventType: z.string().nullable(),
  envelope: z.record(z.unknown()),
  createdAt: z.date(),
});

export type AgentRunTurn = z.infer<typeof AgentRunTurnSchema>;

export const AGENT_RUN_TURN_COLUMNS = {
  id: "id",
  taskId: "task_id",
  agentCrName: "agent_cr_name",
  assemblyLineId: "assembly_line_id",
  stationRunId: "station_run_id",
  nodeId: "node_id",
  iteration: "iteration",
  eventType: "event_type",
  envelope: "envelope",
  createdAt: "created_at",
} as const satisfies ColumnMap<AgentRunTurn>;

export const AGENT_RUN_TURN_TABLE = "pipeline.agent_run_turns";
