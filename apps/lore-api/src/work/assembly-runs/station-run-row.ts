// One `pipeline.station_runs` visit as the run page reads it — shared by the nodes read and the stream's node_status frame so the two cannot drift.

import { z } from "zod";
import {
  StationRunInputSchema,
  type StationRun,
} from "@re-cinq/lore-shared/models/station-run.js";

export const StationRunRowSchema = z.object({
  node_id: z.string(),
  iteration: z.number(),
  outcome: z.string().nullable(),
  agent_cr_name: z.string().nullable(),
  station_run_id: z.string().nullable(),
  // What the visit was dispatched with; null for visits predating the column means "not captured", not "no input".
  input: StationRunInputSchema.nullable(),
  commit_sha: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  // Pre-terminal lifecycle under pull dispatch (queued -> claimed -> running); meaningful only while outcome is null.
  status: z.string(),
  claimed_at: z.string().nullable(),
});

export type StationRunRow = z.infer<typeof StationRunRowSchema>;

/** One station visit as the run page reads it; shared by the nodes read and the stream's node_status frame so the two cannot drift. */
export function toStationRunRow(visit: StationRun): StationRunRow {
  return {
    node_id: visit.nodeId,
    station_run_id: visit.stationRunId,
    iteration: visit.iteration,
    outcome: visit.outcome,
    agent_cr_name: visit.agentCrName,
    input: visit.input,
    commit_sha: visit.commitSha,
    started_at: visit.startedAt.toISOString(),
    finished_at: visit.finishedAt?.toISOString() ?? null,
    status: visit.status,
    claimed_at: visit.claimedAt?.toISOString() ?? null,
  };
}
