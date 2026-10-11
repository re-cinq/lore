// One `pipeline.station_runs` visit as the run page reads it — shared by the nodes read and the stream's node_status frame so the two cannot drift.

import { z } from "zod";
import { StationRunInputSchema } from "@re-cinq/lore-shared/models/station-run.js";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

export const StationRunRowSchema = z.object({
  node_id: z.string(),
  iteration: z.number(),
  outcome: z.string().nullable(),
  // The node's own words about why it stopped; null when it gave none.
  failure_detail: z.string().nullable(),
  agent_cr_name: z.string().nullable(),
  station_run_id: z.string().nullable(),
  // What the visit was dispatched with; null for visits predating the column means "not captured", not "no input".
  input: StationRunInputSchema.nullable(),
  // The floor's brief: the bag as the pod saw it at start (name → ref); null for a visit Lore's own engine walked.
  needs: z.record(z.string(), z.string()).nullable(),
  // What the visit reported it produced, name → value or blob hash; null until it reports, and for a visit Lore's own engine walked.
  produced: z.record(z.string(), z.string()).nullable(),
  // A human station's page, resolved from its route template; null when it names none or a placeholder had nothing to fill it.
  route_url: z.string().nullable(),
  // Who reported the visit: a worker, `station:<name>`, a person, or `event:<name>` for an outside event that answered it.
  worker: z.string().nullable(),
  // The person or event that ran the node by hand; null when the walk opened it.
  requested_by: z.string().nullable(),
  commit_sha: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  // Pre-terminal lifecycle under pull dispatch (queued -> claimed -> running); meaningful only while outcome is null.
  status: z.string(),
  claimed_at: z.string().nullable(),
});

export type StationRunRow = z.infer<typeof StationRunRowSchema>;

/** One station visit as the run page reads it; shared by the nodes read and the stream's node_status frame so the two cannot drift. */
export function toStationRunRow(visit: StationRunRecord): StationRunRow {
  return {
    node_id: visit.nodeId,
    station_run_id: visit.stationRunId,
    iteration: visit.iteration,
    outcome: visit.outcome,
    failure_detail: visit.failureDetail,
    agent_cr_name: visit.agentCrName,
    input: visit.input,
    ...floorVisitFacts(visit),
    commit_sha: visit.commitSha,
    started_at: visit.startedAt.toISOString(),
    finished_at: visit.finishedAt?.toISOString() ?? null,
    status: visit.status,
    claimed_at: visit.claimedAt?.toISOString() ?? null,
  };
}

/** What a visit on the external floor adds: what it was handed and produced, its page, who reported it and who ran it by hand. A visit Lore's own engine walked has none of the first three. */
function floorVisitFacts(
  visit: StationRunRecord,
): Pick<
  StationRunRow,
  "needs" | "produced" | "route_url" | "worker" | "requested_by"
> {
  return {
    needs: visit.needs ?? null,
    produced: visit.produced ?? null,
    route_url: visit.routeUrl ?? null,
    worker: visit.clusterAgentId,
    requested_by: visit.requestedBy,
  };
}
