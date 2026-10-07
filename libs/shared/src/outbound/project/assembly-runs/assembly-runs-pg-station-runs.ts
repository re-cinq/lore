import { enforceTrue } from "../../../lib/enforce.js";
import type { PgPool } from "../../memory-store.js";
import type {
  StationRunFailure,
  StationRunRecord,
  StationRunStartInput,
} from "./assembly-runs-port.js";
import { toNodeRecord } from "./assembly-runs-pg-rows.js";

/** DO UPDATE rather than DO NOTHING, so the statement always locks and RETURNS the row — including in the concurrent-duplicate race, where DO NOTHING would return nothing and the caller could not tell a duplicate from a failure. `xmax = 0` is what distinguishes the row this call created from the one it converged on. The input is COALESCEd rather than overwritten: a re-dispatch keeps the input the first one recorded. */
const ENSURE_SQL = `INSERT INTO pipeline.station_runs
       (assembly_run_id, node_id, iteration, agent_cr_name, input, requested_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
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
    jsonOrNull(input.input),
    input.requestedBy ?? null,
  ];
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
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

/** Every column `toNodeRecord` maps, single-sourced so the two station-run reads cannot drift. */
const STATION_RUN_COLUMNS = `id, station_run_id, assembly_run_id, node_id, iteration, outcome,
            status, cluster_agent_id, required_tags, claimed_at,
            failure_class, failure_detail,
            agent_cr_name, input, commit_sha, requested_by, started_at, finished_at`;

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

export async function findStationRunById(
  pool: PgPool,
  stationRunId: string,
): Promise<StationRunRecord | null> {
  const { rows } = await pool.query(
    `SELECT ${STATION_RUN_COLUMNS}
       FROM pipeline.station_runs
      WHERE station_run_id = $1`,
    [stationRunId],
  );

  return rows[0] ? toStationRun(rows[0]) : null;
}

const toStationRun = (row: unknown): StationRunRecord =>
  toNodeRecord(row as Parameters<typeof toNodeRecord>[0]);
