import { enforceTrue } from "../../../lib/enforce.js";
import type { PgPool } from "../../memory-store.js";
import type {
  StationRunFailure,
  StationRunStartInput,
  ClaimedStationRun,
  StationRunRecord,
} from "./assembly-runs-port.js";
import { toNodeRecord } from "./assembly-runs-pg-rows.js";

/** DO UPDATE rather than DO NOTHING, so the statement always locks and RETURNS the row — including in the concurrent-duplicate race, where DO NOTHING would return nothing and the caller could not tell a duplicate from a failure. `xmax = 0` is what distinguishes the row this call created from the one it converged on. The input is COALESCEd rather than overwritten: a re-dispatch must keep the spec the first one was armed with. */
const ENSURE_SQL = `INSERT INTO pipeline.station_runs
       (assembly_run_id, node_id, iteration, agent_cr_name, input,
        status, required_tags, dispatch_spec)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)
     ON CONFLICT (assembly_run_id, node_id, iteration)
       DO UPDATE SET input = COALESCE(pipeline.station_runs.input, EXCLUDED.input)
     RETURNING id, station_run_id, (xmax = 0) AS created`;

export async function ensureStationRun(
  pool: PgPool,
  input: StationRunStartInput,
): Promise<{ nodeRowId: string; stationRunId: string; created: boolean }> {
  const { rows } = await pool.query<{
    id: number | string;
    station_run_id: string;
    created: boolean;
  }>(ENSURE_SQL, ensureParams(input));

  enforceSingleUpsertRow(rows, input);
  const row = rows[0];

  return {
    nodeRowId: String(row.id),
    stationRunId: row.station_run_id,
    created: row.created,
  };
}

/** The upsert's bound values, in the order `ENSURE_SQL` declares them. Kept beside nothing else because the pairing is positional: a value inserted here without its placeholder binds silently into the wrong column. */
function ensureParams(input: StationRunStartInput): unknown[] {
  return [
    input.assemblyRunId,
    input.nodeId,
    input.iteration,
    input.agentCrName ?? null,
    input.input ? JSON.stringify(input.input) : null,
    input.status ?? "running",
    input.requiredTags ?? [],
    input.dispatchSpec !== undefined
      ? JSON.stringify(input.dispatchSpec)
      : null,
  ];
}

/** The upsert names one visit, so anything but one row back means the ON CONFLICT target no longer identifies it. */
function enforceSingleUpsertRow(
  rows: unknown[],
  input: StationRunStartInput,
): void {
  enforceTrue(
    rows.length === 1,
    Error,
    `ensureStationRun: expected exactly one row for (${input.assemblyRunId}, ${input.nodeId}, ${input.iteration}), got ${rows.length}`,
  );
}

export async function finishStationRunOnce(
  pool: PgPool,
  nodeRowId: string,
  outcome: string,
  finishing: { commitSha?: string; failure?: StationRunFailure } = {},
): Promise<boolean> {
  const commitSha = finishing.commitSha ?? null;
  const { failureClass, failureDetail } = finishStationRunFailureFields(
    finishing.failure,
  );
  const { rows } = await pool.query(
    `UPDATE pipeline.station_runs
       SET outcome = $1, commit_sha = $2, finished_at = now(),
           failure_class = $4, failure_detail = $5
     WHERE id = $3 AND outcome IS NULL
     RETURNING id`,
    [outcome, commitSha, nodeRowId, failureClass, failureDetail],
  );

  return rows.length === 1;
}

function finishStationRunFailureFields(
  failure: StationRunFailure | undefined,
): {
  failureClass: string | null;
  failureDetail: string | null;
} {
  const empty = { failureClass: null, failureDetail: null };

  return failure
    ? {
        failureClass: failure.failureClass ?? null,
        failureDetail: failure.failureDetail ?? null,
      }
    : empty;
}

export async function enqueueStationRunDispatch(
  pool: PgPool,
  nodeRowId: string,
  dispatchSpec: unknown,
): Promise<void> {
  await pool.query(
    `UPDATE pipeline.station_runs
        SET dispatch_spec = $2::jsonb
      WHERE id = $1 AND outcome IS NULL AND status = 'queued'`,
    [nodeRowId, JSON.stringify(dispatchSpec)],
  );
}

/** ONE statement: the `FOR UPDATE SKIP LOCKED` subquery and the UPDATE share a snapshot, so two claimants can never take the same row. `required_tags <@ $2` is containment, not overlap — an agent must satisfy EVERY tag a node asks for, or a run needing `gpu` would go to a cluster that has none. Ordered by id so the oldest queued work is claimed first. */
const CLAIM_SQL = `WITH next AS (
       SELECT id FROM pipeline.station_runs
        WHERE status = 'queued' AND outcome IS NULL
          AND dispatch_spec IS NOT NULL
          AND required_tags <@ $2::text[]
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE pipeline.station_runs sr
        SET status = 'claimed', cluster_agent_id = $1, claimed_at = now()
       FROM next
      WHERE sr.id = next.id
     RETURNING sr.id, sr.station_run_id, sr.assembly_run_id, sr.node_id,
               sr.iteration, sr.agent_cr_name, sr.dispatch_spec`;

export async function claimNextStationRun(
  pool: PgPool,
  claimant: {
    clusterAgentId: string;
    tags: string[];
  },
): Promise<ClaimedStationRun | null> {
  const { rows } = await pool.query(CLAIM_SQL, [
    claimant.clusterAgentId,
    claimant.tags,
  ]);

  return rows[0] ? toClaimed(rows[0]) : null;
}

/** The claimed row in the caller's spelling. `id` is stringified because it is a bigint: it outgrows a JS number, and the cluster-agent round-trips it as an identifier rather than doing arithmetic on it. */
function toClaimed(row: unknown): ClaimedStationRun {
  const r = row as {
    id: number | string;
    station_run_id: string;
    assembly_run_id: string;
    node_id: string;
    iteration: number;
    agent_cr_name: string | null;
    dispatch_spec: unknown;
  };

  return {
    nodeRowId: String(r.id),
    stationRunId: r.station_run_id,
    assemblyRunId: r.assembly_run_id,
    nodeId: r.node_id,
    iteration: r.iteration,
    agentCrName: r.agent_cr_name,
    dispatchSpec: r.dispatch_spec,
  };
}

export async function requeueStationRun(
  pool: PgPool,
  nodeRowId: string,
): Promise<boolean> {
  // started_at is the queue-wait clock the reaper bounds by, so requeue must restart it — else a claimed-then-lost visit arrives back already past the wait and fails terminally.
  const { rows } = await pool.query(
    `UPDATE pipeline.station_runs
        SET status = 'queued',
            cluster_agent_id = NULL,
            claimed_at = NULL,
            started_at = now()
      WHERE id = $1 AND outcome IS NULL
     RETURNING id`,
    [nodeRowId],
  );

  return rows.length === 1;
}

export async function countOpenClaimsByAgent(
  pool: PgPool,
): Promise<Record<string, number>> {
  const { rows } = await pool.query<{
    cluster_agent_id: string;
    open_claims: string;
  }>(
    `SELECT cluster_agent_id, count(*)::text AS open_claims
       FROM pipeline.station_runs
      WHERE outcome IS NULL AND cluster_agent_id IS NOT NULL
      GROUP BY cluster_agent_id`,
  );

  return Object.fromEntries(
    rows.map((row) => [row.cluster_agent_id, Number(row.open_claims)]),
  );
}

/** Every column `toNodeRecord` maps, single-sourced so the two station-run reads cannot drift. */
const STATION_RUN_COLUMNS = `id, station_run_id, assembly_run_id, node_id, iteration, outcome,
            status, cluster_agent_id, required_tags, claimed_at,
            failure_class, failure_detail,
            agent_cr_name, input, commit_sha, started_at, finished_at`;

export async function listStationRuns(
  pool: PgPool,
  assemblyRunId: string,
): Promise<StationRunRecord[]> {
  const { rows } = await pool.query(
    `SELECT ${STATION_RUN_COLUMNS}
       FROM pipeline.station_runs
      WHERE assembly_run_id = $1
      ORDER BY id`,
    [assemblyRunId],
  );

  return rows.map(toStationRun);
}

export async function findStationRunByAgentCrName(
  pool: PgPool,
  agentCrName: string,
): Promise<StationRunRecord | null> {
  const { rows } = await pool.query(
    `SELECT ${STATION_RUN_COLUMNS}
       FROM pipeline.station_runs
      WHERE agent_cr_name = $1
      ORDER BY id DESC
      LIMIT 1`,
    [agentCrName],
  );

  return rows[0] ? toStationRun(rows[0]) : null;
}

const toStationRun = (row: unknown): StationRunRecord =>
  toNodeRecord(row as Parameters<typeof toNodeRecord>[0]);
