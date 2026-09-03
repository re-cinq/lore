import {
  StationRunInputSchema,
  StationRunStatusSchema,
} from "../../models/station-run.js";
import { enforceTrue } from "../../lib/enforce.js";
import { resolveResumePrefix } from "./resume.js";
import { fanOutClause } from "../events/fan-out.js";
import { RUN_START_EVENT } from "./run-events.js";
import type { RunGraph } from "./run-graph.js";
import type { AssemblyRunQuery } from "./assembly-runs-port.js";
import type { PgPool } from "../../memory-store.js";
import type {
  AssemblyRunsPort,
  AssemblyRunResumeFrom,
  AssemblyRunStartInput,
  StationRunFailure,
  StationRunStartInput,
  ClaimedStationRun,
  AssemblyRunRecord,
  AssemblyRunSummary,
  StationRunRecord,
  OpenRunSummary,
  ClosedRunRef,
} from "./assembly-runs-port.js";

/** Graph-less projection shared by both open-run reads (avoids listOpen's org-wide graph clone haul). */
const OPEN_SUMMARY_COLUMNS = `SELECT id, status, repo, branch, subject_key, created_at
         FROM pipeline.assembly_runs`;

interface OpenRunRow {
  id: string;
  status: "queued" | "running";
  repo: string;
  branch: string | null;
  subject_key: string | null;
  created_at: Date;
}

/** Postgres unique_violation; the subject guard is a partial unique index. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

function toOpenSummary(row: OpenRunRow): OpenRunSummary {
  return {
    id: row.id,
    status: row.status,
    repo: row.repo,
    branch: row.branch,
    subjectKey: row.subject_key,
    createdAt: new Date(row.created_at),
  };
}

// SUMMARY_TAIL: every toRecord column except id/graph, kept single-sourced so the two read lists cannot drift.
const SUMMARY_TAIL = `blueprint_name, task_id, repo, branch, subject_key, args, status, outcome, reason,
         blueprint_hash, resumed_from_run_id, resumed_from_node_id, inherited_node_count,
         created_at, started_at, finished_at`;

/** {@link LINE_COLUMNS} without the blueprint clone — see `listSummaries`. */
const SUMMARY_COLUMNS = `id, ${SUMMARY_TAIL}`;

/** Every column `toRecord` maps, single-sourced so the four read sites cannot drift. */
const LINE_COLUMNS = `id, graph, ${SUMMARY_TAIL}`;

// Postgres-backed AssemblyRunsPort (migration 0025); start() writes row + assembly_line.start event atomically since PgPool has no pool.connect().
/** Normalize the blueprint filter: absent → null, one name → a singleton list. */
function blueprintNameList(
  blueprintName: string | readonly string[] | undefined,
): string[] | null {
  if (blueprintName === undefined) {
    return null;
  }

  if (typeof blueprintName === "string") {
    return [blueprintName];
  }

  return [...blueprintName];
}

export class PgAssemblyRuns implements AssemblyRunsPort {
  constructor(private readonly pool: PgPool) {}

  async start(input: AssemblyRunStartInput): Promise<string> {
    if (input.resumeFrom) {
      return this.startResumed(input, input.resumeFrom);
    }

    try {
      return await this.insertStart(input);
    } catch (err) {
      if (!isUniqueViolation(err) || !input.subjectKey) {
        throw err;
      }
      // Start-or-JOIN: subject already in flight — hand back the run doing the work (the index enforces this under concurrency).
      const open = await this.findOpenBySubject(input.repo, input.subjectKey);

      if (open) {
        return open.id;
      }

      // Holder settled between the violation and this read; retry once (a second violation is a genuine race).
      return await this.insertStart(input);
    }
  }

  /** The plain-start write: row + `assembly_line.start` event in ONE CTE. */
  private async insertStart(input: AssemblyRunStartInput): Promise<string> {
    const { rows } = await this.pool.query(
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

  async markRunning(id: string): Promise<void> {
    // Never resurrect a terminal row — a retried start event must not flip an already-finished row back to running.
    await this.pool.query(
      `UPDATE pipeline.assembly_runs
         SET status = 'running', started_at = now()
       WHERE id = $1
         AND status IN ('queued', 'running')`,
      [id],
    );
  }

  /** Fork-and-rerun (specs/fork-rerun-from-node): validates then writes line+event+inherited node rows in one CTE; agent_cr_name nulled on copies so run-viz/cost joins never misattribute to the fork. */
  private async startResumed(
    input: AssemblyRunStartInput,
    resumeFrom: AssemblyRunResumeFrom,
  ): Promise<string> {
    const { source, prefix } = resolveResumePrefix(
      input,
      await this.getById(resumeFrom.lineId),
      await this.listStationRuns(resumeFrom.lineId),
    );
    // Copy bounds on n.id <= cutoff (node-row ids are monotone in walk order); failure_class/detail/agent_cr_name dropped since they describe the finished attempt, not inherited history (replay would otherwise fail the fork on an inherited permanent-failure visit).
    const cutoffNodeRowId = prefix[prefix.length - 1].id;
    const { rows } = await this.pool.query(
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

  async stampBlueprint(
    id: string,
    hash: string,
    graph?: RunGraph,
  ): Promise<void> {
    // Write-once under one guard on hash: both columns describe a single blueprint load, so stamping independently could mismatch graph vs hash.
    await this.pool.query(
      `UPDATE pipeline.assembly_runs
         SET blueprint_hash = $2, graph = $3::jsonb
       WHERE id = $1
         AND blueprint_hash IS NULL`,
      [id, hash, graph ? JSON.stringify(graph) : null],
    );
  }

  async finish(id: string, outcome: string, reason?: string): Promise<boolean> {
    // First writer decides — duplicate/late finishers never overwrite a terminal row; RETURNING reports the win for once-only side effects.
    // Closing the run also closes any visit still open under it, in the SAME statement: the reaper sweeps OPEN runs only, so a visit left open when its run went terminal was never revisited (86 rows stranded since 2026-08-21, each billing phantom pod-hours at the spend page's 2h cap). Gated on `won`, COALESCE-guarded so a visit that DID report keeps its outcome.
    const { rows } = await this.pool.query(
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

  async ensureStationRun(
    input: StationRunStartInput,
  ): Promise<{ nodeRowId: string; stationRunId: string; created: boolean }> {
    // DO UPDATE (not DO NOTHING) so the statement always locks+returns the row, including the concurrent-duplicate race; xmax=0 distinguishes create from converged duplicate.
    const { rows } = await this.pool.query(
      `INSERT INTO pipeline.station_runs
         (assembly_run_id, node_id, iteration, agent_cr_name, input,
          status, required_tags, dispatch_spec)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)
       ON CONFLICT (assembly_run_id, node_id, iteration)
         DO UPDATE SET input = COALESCE(pipeline.station_runs.input, EXCLUDED.input)
       RETURNING id, station_run_id, (xmax = 0) AS created`,
      [
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
      ],
    );

    enforceTrue(
      rows.length === 1,
      Error,
      `ensureStationRun: expected exactly one row for (${input.assemblyRunId}, ${input.nodeId}, ${input.iteration}), got ${rows.length}`,
    );
    const row = rows[0] as {
      id: number | string;
      station_run_id: string;
      created: boolean;
    };

    return {
      nodeRowId: String(row.id),
      stationRunId: row.station_run_id,
      created: row.created,
    };
  }

  async finishStationRunOnce(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
    failure?: StationRunFailure,
  ): Promise<boolean> {
    const { rows } = await this.pool.query(
      `UPDATE pipeline.station_runs
         SET outcome = $1, commit_sha = $2, finished_at = now(),
             failure_class = $4, failure_detail = $5
       WHERE id = $3 AND outcome IS NULL
       RETURNING id`,
      [
        outcome,
        commitSha ?? null,
        nodeRowId,
        failure?.failureClass ?? null,
        failure?.failureDetail ?? null,
      ],
    );

    return rows.length === 1;
  }

  async enqueueStationRunDispatch(
    nodeRowId: string,
    dispatchSpec: unknown,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.station_runs
          SET dispatch_spec = $2::jsonb
        WHERE id = $1 AND outcome IS NULL AND status = 'queued'`,
      [nodeRowId, JSON.stringify(dispatchSpec)],
    );
  }

  async claimNextStationRun(claimant: {
    clusterAgentId: string;
    tags: string[];
  }): Promise<ClaimedStationRun | null> {
    // One statement: FOR UPDATE SKIP LOCKED subquery + UPDATE share a snapshot, so concurrent claimants never take the same row.
    const { rows } = await this.pool.query(
      `WITH next AS (
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
                 sr.iteration, sr.agent_cr_name, sr.dispatch_spec`,
      [claimant.clusterAgentId, claimant.tags],
    );

    if (!rows[0]) {
      return null;
    }
    const row = rows[0] as {
      id: number | string;
      station_run_id: string;
      assembly_run_id: string;
      node_id: string;
      iteration: number;
      agent_cr_name: string | null;
      dispatch_spec: unknown;
    };

    return {
      nodeRowId: String(row.id),
      stationRunId: row.station_run_id,
      assemblyRunId: row.assembly_run_id,
      nodeId: row.node_id,
      iteration: row.iteration,
      agentCrName: row.agent_cr_name,
      dispatchSpec: row.dispatch_spec,
    };
  }

  async requeueStationRun(nodeRowId: string): Promise<boolean> {
    // started_at is the queue-wait clock the reaper bounds by, so requeue must restart it — else a claimed-then-lost visit arrives back already past the wait and fails terminally.
    const { rows } = await this.pool.query(
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

  async countOpenClaimsByAgent(): Promise<Record<string, number>> {
    const { rows } = await this.pool.query<{
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

  async listStationRuns(assemblyRunId: string): Promise<StationRunRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT id, station_run_id, assembly_run_id, node_id, iteration, outcome,
              status, cluster_agent_id, required_tags, claimed_at,
              failure_class, failure_detail,
              agent_cr_name, input, commit_sha, started_at, finished_at
         FROM pipeline.station_runs
        WHERE assembly_run_id = $1
        ORDER BY id`,
      [assemblyRunId],
    );

    return rows.map((r) =>
      toNodeRecord(r as Parameters<typeof toNodeRecord>[0]),
    );
  }

  async listOpen(): Promise<AssemblyRunRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT ${LINE_COLUMNS}
         FROM pipeline.assembly_runs
        WHERE status IN ('queued', 'running')
        ORDER BY created_at`,
    );

    return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
  }

  async findOpenOnBranch(
    repo: string,
    branch: string,
  ): Promise<OpenRunSummary[]> {
    const { rows } = await this.pool.query<OpenRunRow>(
      `${OPEN_SUMMARY_COLUMNS}
        WHERE status IN ('queued', 'running')
          AND repo = $1
          AND branch = $2
        ORDER BY created_at, id`,
      [repo, branch],
    );

    return rows.map(toOpenSummary);
  }

  async findOpenBySubject(
    repo: string,
    subjectKey: string,
  ): Promise<OpenRunSummary | null> {
    // LIMIT 1 states intent; the partial unique index makes it a fact. Still ordered so a DB predating (or missing) the index answers deterministically.
    const { rows } = await this.pool.query<OpenRunRow>(
      `${OPEN_SUMMARY_COLUMNS}
        WHERE status IN ('queued', 'running')
          AND repo = $1
          AND subject_key = $2
        ORDER BY created_at, id
        LIMIT 1`,
      [repo, subjectKey],
    );

    return rows[0] ? toOpenSummary(rows[0]) : null;
  }

  async countBySubject(repo: string, subjectKey: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM pipeline.assembly_runs
        WHERE repo = $1 AND subject_key = $2`,
      [repo, subjectKey],
    );

    return Number(rows[0]?.n ?? 0);
  }

  async mergeArgs(id: string, patch: Record<string, unknown>): Promise<void> {
    // Merged in SQL (not read-modify-write): two nodes producing artifacts in the same tick would otherwise race and drop one's output; || is jsonb concat, right operand wins per key.
    await this.pool.query(
      `UPDATE pipeline.assembly_runs
          SET args = COALESCE(args, '{}'::jsonb) || $2::jsonb
        WHERE id = $1`,
      [id, JSON.stringify(patch)],
    );
  }

  async getById(id: string): Promise<AssemblyRunRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT ${LINE_COLUMNS}
         FROM pipeline.assembly_runs WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) {
      return null;
    }

    return toRecord(rows[0] as Parameters<typeof toRecord>[0]);
  }

  async list(query: AssemblyRunQuery): Promise<AssemblyRunRecord[]> {
    const rows = await this.selectList(LINE_COLUMNS, query);

    return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
  }

  async listSummaries(query: AssemblyRunQuery): Promise<AssemblyRunSummary[]> {
    const rows = await this.selectList(SUMMARY_COLUMNS, query);

    return rows.map((r) => {
      // toRecord also maps graph, absent here — drop the key rather than read back a null the run doesn't have.
      const { graph: _graph, ...summary } = toRecord({
        ...(r as Parameters<typeof toRecord>[0]),
        graph: null,
      });

      return summary;
    });
  }

  /** The one filtered read both list shapes run; NULL-guarded predicate per field (not concatenated clauses) so every param is bound and the plan is reusable. */
  private async selectList(
    columns: string,
    query: AssemblyRunQuery,
  ): Promise<unknown[]> {
    const blueprints = blueprintNameList(query.blueprintName);
    const { rows } = await this.pool.query(
      `SELECT ${columns}
         FROM pipeline.assembly_runs
        WHERE ($1::text   IS NULL OR repo = $1)
          AND ($2::text[] IS NULL OR blueprint_name = ANY($2::text[]))
          AND ($3::text[] IS NULL OR status = ANY($3::text[]))
          AND ($4::uuid   IS NULL OR task_id = $4)
          AND ($5::int    IS NULL OR (args->>'pr_number')::int = $5)
          AND ($6::timestamptz IS NULL OR created_at >= $6)
          AND ($8::text   IS NULL OR subject_key = $8)
          AND ($9::uuid   IS NULL OR EXISTS (
                SELECT 1 FROM pipeline.station_runs claims
                 WHERE claims.assembly_run_id = pipeline.assembly_runs.id
                   AND claims.cluster_agent_id = $9
                   AND claims.outcome IS NULL))
        -- id breaks the tie: two runs started in the same millisecond would
        -- otherwise come back in an order Postgres is free to vary between
        -- calls, which reads as rows jumping around a paged list.
        ORDER BY created_at DESC, id DESC
        LIMIT $7`,
      [
        query.repo ?? null,
        blueprints,
        query.status ? [...query.status] : null,
        query.taskId ?? null,
        query.prNumber ?? null,
        query.createdAfter ?? null,
        query.limit ?? 50,
        query.subjectKey ?? null,
        query.clusterAgentId ?? null,
      ],
    );

    return rows;
  }

  async listForTask(taskId: string): Promise<AssemblyRunRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT ${LINE_COLUMNS}
         FROM pipeline.assembly_runs
        WHERE task_id = $1
        ORDER BY created_at DESC`,
      [taskId],
    );

    return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
  }

  async findOpenByPr(
    repo: string,
    prNumber: number,
  ): Promise<AssemblyRunRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT ${LINE_COLUMNS}
         FROM pipeline.assembly_runs
        WHERE repo = $1
          AND (args->>'pr_number')::int = $2
          AND status IN ('queued', 'running')
        ORDER BY created_at DESC`,
      [repo, prNumber],
    );

    return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
  }

  async finishOpenByPr(
    repo: string,
    prNumber: number,
    outcome: string,
    definitions?: readonly string[],
  ): Promise<ClosedRunRef[]> {
    // null $4 means "every definition" — callers that own only part of the PR lifecycle pass their own family so closing a PR can't close an unrelated line.
    const { rows } = await this.pool.query<{
      id: string;
      task_id: string | null;
    }>(
      `UPDATE pipeline.assembly_runs
          SET status = 'finished', outcome = $1, finished_at = now()
        WHERE repo = $2
          AND (args->>'pr_number')::int = $3
          AND status IN ('queued', 'running')
          AND ($4::text[] IS NULL OR blueprint_name = ANY($4::text[]))
      RETURNING id, task_id`,
      [outcome, repo, prNumber, definitions ? [...definitions] : null],
    );

    return rows.map((row) => ({ id: row.id, taskId: row.task_id }));
  }

  async hasReviewedPr(repo: string, prNumber: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1
         FROM pipeline.assembly_runs
        WHERE repo = $1
          AND blueprint_name = 'code-review'
          AND (args->>'pr_number')::int = $2
        LIMIT 1`,
      [repo, prNumber],
    );

    return rows.length > 0;
  }
}

function toNodeRecord(row: {
  id: number | string;
  station_run_id: string;
  assembly_run_id: string;
  node_id: string;
  iteration: number;
  status?: string | null;
  cluster_agent_id?: string | null;
  required_tags?: string[] | null;
  claimed_at?: Date | null;
  outcome: string | null;
  failure_class: string | null;
  failure_detail: string | null;
  agent_cr_name: string | null;
  input: unknown;
  commit_sha: string | null;
  started_at: Date;
  finished_at: Date | null;
}): StationRunRecord {
  return {
    id: String(row.id),
    stationRunId: row.station_run_id,
    assemblyRunId: row.assembly_run_id,
    nodeId: row.node_id,
    iteration: row.iteration,
    // Pre-migration reads (no lifecycle columns) default to the push-era "running" meaning, same as the InMemory double.
    status: StationRunStatusSchema.catch("running").parse(
      row.status ?? "running",
    ),
    clusterAgentId: row.cluster_agent_id ?? null,
    requiredTags: row.required_tags ?? [],
    claimedAt: row.claimed_at ?? null,
    outcome: row.outcome,
    failureClass: row.failure_class,
    failureDetail: row.failure_detail,
    agentCrName: row.agent_cr_name,
    // A shape the schema rejects reads as "not captured" rather than throwing — this column is diagnostics and must not break the walk.
    input: StationRunInputSchema.nullable()
      .catch(null)
      .parse(row.input ?? null),
    commitSha: row.commit_sha,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toRecord(row: {
  id: string;
  blueprint_name: string;
  task_id: string | null;
  repo: string;
  branch: string | null;
  subject_key: string | null;
  args: Record<string, unknown> | null;
  status: AssemblyRunRecord["status"];
  outcome: string | null;
  reason: string | null;
  blueprint_hash: string | null;
  graph: RunGraph | null;
  resumed_from_run_id: string | null;
  resumed_from_node_id: string | null;
  inherited_node_count: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}): AssemblyRunRecord {
  return {
    id: row.id,
    blueprintName: row.blueprint_name,
    taskId: row.task_id,
    repo: row.repo,
    branch: row.branch,
    subjectKey: row.subject_key,
    args: row.args ?? {},
    status: row.status,
    outcome: row.outcome,
    reason: row.reason,
    blueprintHash: row.blueprint_hash,
    graph: row.graph,
    resumedFromRunId: row.resumed_from_run_id,
    resumedFromNodeId: row.resumed_from_node_id,
    inheritedNodeCount: row.inherited_node_count,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
