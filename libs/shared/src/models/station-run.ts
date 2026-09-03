import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.station_runs` — one visit `(run, node, iteration)` to a Station; `id` is physical/replay order, `stationRunId` is the public identity telemetry/cost key on (FR6.39). */

/** What a visit was GIVEN at dispatch — captured because the Agent CR (the only other place it lived) is pruned after the run; excludes the assembled `{context}` (reproducible, ~34KB). */
export const StationRunInputSchema = z.object({
  /** The round content the node worked from — `resolveRoundContent(task, conversation)`. */
  description: z.string(),
  /** The resolved prompt an agent node's pod rendered; null for station nodes. */
  prompt: z.string().nullable(),
  /** A station node's `station_input` params; null for agent nodes. */
  params: z.record(z.string()).nullable(),
  /** The checkout the pod clones — a visit's input files, honestly and cheaply. */
  repo: z.string(),
  ref: z.string(),
});

export type StationRunInput = z.infer<typeof StationRunInputSchema>;

/** Pre-terminal lifecycle under pull-based dispatch: queued -> claimed -> running (default/backfill); meaningful only while `outcome IS NULL`. */
export const StationRunStatusSchema = z.enum(["queued", "claimed", "running"]);

export type StationRunStatus = z.infer<typeof StationRunStatusSchema>;

export const StationRunSchema = z.object({
  id: z.string(),
  stationRunId: z.string(),
  assemblyRunId: z.string(),
  nodeId: z.string(),
  iteration: z.number(),
  status: StationRunStatusSchema,
  /** The registered cluster-agent holding the claim; null while queued (and on pre-flip rows). */
  clusterAgentId: z.string().nullable(),
  /** Capability tags a claimant must carry (`required_tags <@ tags`). */
  requiredTags: z.array(z.string()),
  /** The execution clock: node timeouts measure from here, never from `startedAt` (row creation / enqueue time). */
  claimedAt: z.date().nullable(),
  outcome: z.string().nullable(),
  /** WHY a `failed` visit failed: the shared `FailureCategory`; null on non-failures and on failures predating migration 0042. */
  failureClass: z.string().nullable(),
  failureDetail: z.string().nullable(),
  agentCrName: z.string().nullable(),
  /** What this visit was dispatched WITH; null pre-migration-0046 means "not captured", never "no input". */
  input: StationRunInputSchema.nullable(),
  commitSha: z.string().nullable(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
});

export type StationRun = z.infer<typeof StationRunSchema>;

export const STATION_RUN_COLUMNS = {
  id: "id",
  stationRunId: "station_run_id",
  assemblyRunId: "assembly_run_id",
  nodeId: "node_id",
  iteration: "iteration",
  status: "status",
  clusterAgentId: "cluster_agent_id",
  requiredTags: "required_tags",
  claimedAt: "claimed_at",
  outcome: "outcome",
  failureClass: "failure_class",
  failureDetail: "failure_detail",
  agentCrName: "agent_cr_name",
  input: "input",
  commitSha: "commit_sha",
  startedAt: "started_at",
  finishedAt: "finished_at",
} as const satisfies ColumnMap<StationRun>;

export const STATION_RUN_TABLE = "pipeline.station_runs";
