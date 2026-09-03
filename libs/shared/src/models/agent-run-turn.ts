import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** The untruncated stream-json line (not the truncated agent_run_events projection); id is a string-encoded bigint cursor; see ADR-037. */

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
