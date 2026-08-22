import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.station_runs` — ONE visit to a Station within an AssemblyRun,
 * i.e. `(run, node, iteration)` (ADR-024).
 *
 * DDL: migration `0025_assembly_lines.sql` (as `assembly_line_nodes`), the
 * attempt-uniqueness index in `0029`, renamed and given `station_run_id` by
 * `0040_assembly_runs.sql`.
 *
 * Two ids on purpose. `id` is the physical row id and ALSO the visit order the
 * replay depends on; `stationRunId` is the visit's public identity, which
 * telemetry and cost rows key on instead of string-matching an Agent CR name
 * (FR6.39).
 */

/**
 * What a visit was GIVEN, captured at dispatch.
 *
 * The prompt and description a pod runs on lived only on its Agent CR, which is
 * pruned after the run — so an hour later "what was this node actually asked to
 * do" meant kubectl against an object that no longer existed, and a node fed the
 * wrong input (a stale plan, a rejected draft) looked identical to one fed the
 * right input and reasoning badly.
 *
 * Bounded at write time. The assembled `{context}` is deliberately NOT here: it
 * is ~34 KB per visit, it is assembled after this row is minted, and it is
 * reproducible from the context system.
 */
export const StationRunInputSchema = z.object({
  /** The round content the node worked from — `roundContent(task, conversation)`. */
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

export const StationRunSchema = z.object({
  id: z.string(),
  stationRunId: z.string(),
  assemblyRunId: z.string(),
  nodeId: z.string(),
  iteration: z.number(),
  outcome: z.string().nullable(),
  /** WHY a `failed` visit failed: the shared `FailureCategory` the Floor
   *  classified, and the agent's own error text that produced it. Null on every
   *  non-failure, and on failures that predate migration 0042. */
  failureClass: z.string().nullable(),
  failureDetail: z.string().nullable(),
  agentCrName: z.string().nullable(),
  /** What this visit was dispatched WITH. Null for visits recorded before
   *  migration 0046 — "not captured", never "no input". */
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
