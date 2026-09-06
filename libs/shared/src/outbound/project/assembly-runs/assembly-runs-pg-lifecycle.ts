import { resolveResumePrefix } from "./resume.js";
import { fanOutClause } from "../events/fan-out.js";
import { RUN_START_EVENT } from "./run-events.js";
import type { RunGraph } from "./run-graph.js";
import type { PgPool } from "../../memory-store.js";
import type {
  AssemblyRunResumeFrom,
  AssemblyRunStartInput,
} from "./assembly-runs-port.js";
import { isUniqueViolation } from "./assembly-runs-pg-rows.js";
import { findOpenBySubject, getById } from "./assembly-runs-pg-queries.js";
import { listStationRuns } from "./assembly-runs-pg-station-runs.js";

/** The plain-start write: row + `assembly_line.start` event in ONE CTE. */
async function insertStart(
  pool: PgPool,
  input: AssemblyRunStartInput,
): Promise<string> {
  const { rows } = await pool.query(
    `WITH al AS (
       INSERT INTO pipeline.assembly_runs (blueprint_name, task_id, repo, branch, subject_key, args)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id
     ), ev AS (
       INSERT INTO pipeline.events (event_name, source, params, repo, dedupe_key)
       SELECT '${RUN_START_EVENT}', 'internal',
              jsonb_build_object(
                'assemblyLineId', al.id,
                'blueprintName', $1,
                'repo', $3,
                'branch', $4,
                'taskId', $2,
                'args', $6::jsonb,
                'resumedFrom', NULL::jsonb
              ),
              $3, '${RUN_START_EVENT}:' || al.id
       FROM al
       RETURNING id, event_name
     ), fan AS (
       ${fanOutClause("ev")}
     )
     SELECT id FROM al`,
    [
      input.blueprintName,
      input.taskId ?? null,
      input.repo,
      input.branch ?? null,
      input.subjectKey ?? null,
      JSON.stringify(input.args ?? {}),
    ],
  );

  return rows[0].id as string;
}

/** Fork-and-rerun (specs/fork-rerun-from-node): validates then writes line+event+inherited node rows in one CTE; agent_cr_name nulled on copies so run-viz/cost joins never misattribute to the fork. */
async function startResumed(
  pool: PgPool,
  input: AssemblyRunStartInput,
  resumeFrom: AssemblyRunResumeFrom,
): Promise<string> {
  const { source, prefix } = resolveResumePrefix(
    input,
    await getById(pool, resumeFrom.lineId),
    await listStationRuns(pool, resumeFrom.lineId),
  );
  // Copy bounds on n.id <= cutoff (node-row ids are monotone in walk order); failure_class/detail/agent_cr_name dropped since they describe the finished attempt, not inherited history (replay would otherwise fail the fork on an inherited permanent-failure visit).
  const cutoffNodeRowId = prefix[prefix.length - 1].id;
  const { rows } = await pool.query(
    `WITH al AS (
       INSERT INTO pipeline.assembly_runs
         (blueprint_name, task_id, repo, branch, args, blueprint_hash, graph,
          resumed_from_run_id, resumed_from_node_id, inherited_node_count, subject_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $11::jsonb, $7, $8, $10, $12)
       RETURNING id
     ), ev AS (
       INSERT INTO pipeline.events (event_name, source, params, repo, dedupe_key)
       SELECT '${RUN_START_EVENT}', 'internal',
              jsonb_build_object(
                'assemblyLineId', al.id,
                'blueprintName', $1,
                'repo', $3,
                'branch', $4,
                'taskId', $2,
                'args', $5::jsonb,
                'resumedFrom', jsonb_build_object('lineId', $7, 'nodeId', $8, 'iteration', $13::int)
              ),
              $3, '${RUN_START_EVENT}:' || al.id
       FROM al
       RETURNING id, event_name
     ), fan AS (
       ${fanOutClause("ev")}
     ), copied AS (
       INSERT INTO pipeline.station_runs
         (assembly_run_id, node_id, iteration, outcome, failure_class,
          failure_detail, agent_cr_name, input, commit_sha, started_at, finished_at)
       SELECT al.id,
              n.node_id, n.iteration, n.outcome, NULL,
              NULL, NULL, n.input, n.commit_sha, n.started_at, n.finished_at
         FROM pipeline.station_runs n, al
        WHERE n.assembly_run_id = $7
          AND n.id <= $9::bigint
        ORDER BY n.id
     )
     SELECT id FROM al`,
    [
      input.blueprintName,
      source.taskId,
      input.repo,
      source.branch,
      JSON.stringify(input.args ?? source.args),
      source.blueprintHash,
      resumeFrom.lineId,
      resumeFrom.nodeId,
      cutoffNodeRowId,
      prefix.length,
      // A fork replays its source's rows, so it walks the same graph.
      source.graph ? JSON.stringify(source.graph) : null,
      // Fork takes over source's subject (legal only from a terminal run, so the key is free); `?? null` since a bound param needs a value, not undefined.
      input.subjectKey ?? source.subjectKey ?? null,
      resumeFrom.iteration ?? null,
    ],
  );

  return rows[0].id as string;
}

/** Plain start, or start-or-JOIN onto an in-flight run sharing the same subject key, or a fork from a prior run's node. */
export async function start(
  pool: PgPool,
  input: AssemblyRunStartInput,
): Promise<string> {
  if (input.resumeFrom) {
    return startResumed(pool, input, input.resumeFrom);
  }

  try {
    return await insertStart(pool, input);
  } catch (err) {
    if (!isUniqueViolation(err) || !input.subjectKey) {
      throw err;
    }
    // Start-or-JOIN: subject already in flight — hand back the run doing the work (the index enforces this under concurrency).
    const open = await findOpenBySubject(pool, input.repo, input.subjectKey);

    if (open) {
      return open.id;
    }

    // Holder settled between the violation and this read; retry once (a second violation is a genuine race).
    return await insertStart(pool, input);
  }
}

export async function markRunning(pool: PgPool, id: string): Promise<void> {
  // Never resurrect a terminal row — a retried start event must not flip an already-finished row back to running.
  await pool.query(
    `UPDATE pipeline.assembly_runs
       SET status = 'running', started_at = now()
     WHERE id = $1
       AND status IN ('queued', 'running')`,
    [id],
  );
}

export async function stampBlueprint(
  pool: PgPool,
  id: string,
  hash: string,
  graph?: RunGraph,
): Promise<void> {
  // Write-once under one guard on hash: both columns describe a single blueprint load, so stamping independently could mismatch graph vs hash.
  await pool.query(
    `UPDATE pipeline.assembly_runs
       SET blueprint_hash = $2, graph = $3::jsonb
     WHERE id = $1
       AND blueprint_hash IS NULL`,
    [id, hash, graph ? JSON.stringify(graph) : null],
  );
}

export async function finish(
  pool: PgPool,
  id: string,
  outcome: string,
  reason?: string,
): Promise<boolean> {
  // First writer decides — duplicate/late finishers never overwrite a terminal row; RETURNING reports the win for once-only side effects. Closing the run also closes any visit still open under it in the SAME statement: the reaper sweeps OPEN runs only, so a visit left open when its run went terminal was never revisited (86 rows stranded since 2026-08-21, each billing phantom pod-hours at the spend page's 2h cap). Gated on `won`, COALESCE-guarded so a visit that DID report keeps its outcome.
  const { rows } = await pool.query(
    `WITH won AS (
       UPDATE pipeline.assembly_runs
          SET status = CASE WHEN $1 = 'error' THEN 'failed' ELSE 'finished' END,
              outcome = $1,
              reason = $2,
              finished_at = now()
        WHERE id = $3
          AND status IN ('queued', 'running')
        RETURNING id
     ), stranded AS (
       UPDATE pipeline.station_runs
          SET finished_at = now(),
              outcome = COALESCE(outcome, 'failed'),
              failure_class = COALESCE(failure_class, 'unknown'),
              failure_detail = COALESCE(
                failure_detail,
                'the run finished while this visit was still open — the visit never reported an outcome'
              )
        WHERE assembly_run_id IN (SELECT id FROM won)
          AND finished_at IS NULL
        RETURNING 1
     )
     SELECT id FROM won`,
    [outcome, reason ?? null, id],
  );

  return rows.length > 0;
}
