import { enforceTrue } from "../../lib/enforce.js";
import { resolveResumePrefix } from "./resume.js";
import { RUN_START_EVENT } from "./run-events.js";
import type { RunGraph } from "./run-graph.js";
import type { AssemblyRunQuery } from "./assembly-runs-port.js";
import type { PgPool } from "../../memory-store.js";
import type {
  AssemblyRunsPort,
  AssemblyRunResumeFrom,
  AssemblyRunStartInput,
  StationRunStartInput,
  AssemblyRunRecord,
  StationRunRecord,
} from "./assembly-runs-port.js";

/** Every column `toRecord` maps, single-sourced so the four read sites cannot drift. */
const LINE_COLUMNS = `id, graph, blueprint_name, task_id, repo, branch, args, status, outcome, reason,
         blueprint_hash, resumed_from_run_id, resumed_from_node_id, inherited_node_count,
         created_at, started_at, finished_at`;

/**
 * Postgres-backed {@link AssemblyRunsPort} over `pipeline.assembly_runs` /
 * `pipeline.station_runs` (migration 0025). `start` writes the row and
 * the `assembly_line.start` event in ONE data-modifying CTE — atomic without
 * `pool.connect()`, which the narrow {@link PgPool} does not expose. The event
 * columns mirror the shared `insertEvent` writer (`events.ts`).
 */
export class PgAssemblyRuns implements AssemblyRunsPort {
  constructor(private readonly pool: PgPool) {}

  async start(input: AssemblyRunStartInput): Promise<string> {
    if (input.resumeFrom) {
      return this.startResumed(input, input.resumeFrom);
    }

    const { rows } = await this.pool.query(
      `WITH al AS (
         INSERT INTO pipeline.assembly_runs (blueprint_name, task_id, repo, branch, args)
         VALUES ($1, $2, $3, $4, $5::jsonb)
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
                  'resumedFrom', NULL::jsonb
                ),
                $3, '${RUN_START_EVENT}:' || al.id
         FROM al
       )
       SELECT id FROM al`,
      [
        input.blueprintName,
        input.taskId ?? null,
        input.repo,
        input.branch ?? null,
        JSON.stringify(input.args ?? {}),
      ],
    );

    return rows[0].id as string;
  }

  async markRunning(id: string): Promise<void> {
    // Never resurrect a terminal row: a retried assembly_line.start event must not
    // flip a row the watcher already finished back to `running` (it would then
    // never close again — the CR terminal event was already consumed).
    await this.pool.query(
      `UPDATE pipeline.assembly_runs
         SET status = 'running', started_at = now()
       WHERE id = $1
         AND status IN ('queued', 'running')`,
      [id],
    );
  }

  /**
   * Fork-and-rerun (specs/fork-rerun-from-node): read the source line and its
   * node rows, validate, then write the new line row, the `assembly_line.start`
   * event and every inherited node row in ONE data-modifying CTE. Nothing is
   * written until validation passes, and every property validated is immutable
   * on a terminal line — so the read-then-write split opens no window.
   *
   * Copied rows deliberately null agent_cr_name: the run-viz ingest and cost
   * correlation joins resolve a CR name to its line via the NEWEST matching
   * node row, so echoing the source's CR names onto the fork would steal any
   * late-arriving agent-event or cost row from the source run. A node row's
   * CR name always names a CR launched by that line; inherited rows launched
   * nothing. (Safe for the walk and the reaper: every inherited row is proven
   * terminal by resolveResumePrefix, and only open rows are ever read back by
   * CR name.)
   */
  private async startResumed(
    input: AssemblyRunStartInput,
    resumeFrom: AssemblyRunResumeFrom,
  ): Promise<string> {
    const { source, prefix } = resolveResumePrefix(
      input,
      await this.getById(resumeFrom.lineId),
      await this.listStationRuns(resumeFrom.lineId),
    );
    // The copy below bounds on `n.id <= cutoff`. That is sound because node-row
    // ids within one line are monotone in walk order: ensureStationRun inserts
    // sequentially and its upsert mints no new id on replay, so "rows up to the
    // chosen visit" and "rows with id <= its id" are the same set (including for
    // a fork of a fork, whose copied rows are inserted in ORDER BY n.id).
    const cutoffNodeRowId = prefix[prefix.length - 1].id;
    const { rows } = await this.pool.query(
      `WITH al AS (
         INSERT INTO pipeline.assembly_runs
           (blueprint_name, task_id, repo, branch, args, blueprint_hash, graph,
            resumed_from_run_id, resumed_from_node_id, inherited_node_count)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $11::jsonb, $7, $8, $10)
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
                  'resumedFrom', jsonb_build_object('lineId', $7, 'nodeId', $8)
                ),
                $3, '${RUN_START_EVENT}:' || al.id
         FROM al
       ), copied AS (
         INSERT INTO pipeline.station_runs
           (assembly_run_id, node_id, iteration, outcome, agent_cr_name,
            commit_sha, started_at, finished_at)
         SELECT al.id,
                n.node_id, n.iteration, n.outcome, NULL, n.commit_sha, n.started_at, n.finished_at
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
      ],
    );

    return rows[0].id as string;
  }

  async stampBlueprint(
    id: string,
    hash: string,
    graph?: RunGraph,
  ): Promise<void> {
    // Write-once, both columns under ONE guard on the hash: the pair describes a
    // single blueprint, and stamping them independently could leave a row whose
    // graph and hash came from different loads. A redelivered start that loaded a
    // since-edited blueprint would otherwise re-point the row at a graph it never
    // ran.
    await this.pool.query(
      `UPDATE pipeline.assembly_runs
         SET blueprint_hash = $2, graph = $3::jsonb
       WHERE id = $1
         AND blueprint_hash IS NULL`,
      [id, hash, graph ? JSON.stringify(graph) : null],
    );
  }

  async finish(id: string, outcome: string, reason?: string): Promise<boolean> {
    // First writer decides: duplicate/late finishers (event redelivery, reaper vs
    // watch race) never overwrite a terminal row. RETURNING reports the win so
    // callers can gate once-only side effects on it.
    const { rows } = await this.pool.query(
      `UPDATE pipeline.assembly_runs
         SET status = CASE WHEN $1 = 'error' THEN 'failed' ELSE 'finished' END,
             outcome = $1,
             reason = $2,
             finished_at = now()
       WHERE id = $3
         AND status IN ('queued', 'running')
       RETURNING id`,
      [outcome, reason ?? null, id],
    );

    return rows.length > 0;
  }

  async ensureStationRun(
    input: StationRunStartInput,
  ): Promise<{ nodeRowId: string; stationRunId: string; created: boolean }> {
    // DO UPDATE (not DO NOTHING) so the statement locks and RETURNS the row in
    // EVERY case, including the concurrent-duplicate race the primitive exists to
    // absorb: a DO NOTHING + fallback SELECT sees the winner's not-yet-committed
    // row as absent under its snapshot and returns zero rows. `xmax = 0` is true
    // only for a fresh insert, so it distinguishes create from converged duplicate.
    const { rows } = await this.pool.query(
      `INSERT INTO pipeline.station_runs (assembly_run_id, node_id, iteration, agent_cr_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (assembly_run_id, node_id, iteration)
         DO UPDATE SET node_id = EXCLUDED.node_id
       RETURNING id, station_run_id, (xmax = 0) AS created`,
      [
        input.assemblyRunId,
        input.nodeId,
        input.iteration,
        input.agentCrName ?? null,
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
  ): Promise<boolean> {
    const { rows } = await this.pool.query(
      `UPDATE pipeline.station_runs
         SET outcome = $1, commit_sha = $2, finished_at = now()
       WHERE id = $3 AND outcome IS NULL
       RETURNING id`,
      [outcome, commitSha ?? null, nodeRowId],
    );

    return rows.length === 1;
  }

  async listStationRuns(assemblyRunId: string): Promise<StationRunRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT id, station_run_id, assembly_run_id, node_id, iteration, outcome,
              agent_cr_name, commit_sha, started_at, finished_at
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

  async mergeArgs(id: string, patch: Record<string, unknown>): Promise<void> {
    // Merged in SQL, not read-modify-write: two nodes can produce artifacts within
    // the same tick, and a JS-side merge would let the second read stale args and
    // drop the first one's output. `||` is jsonb concatenation — right operand wins
    // per key, which is exactly the supersede-on-re-run rule.
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
    // Built as a NULL-guarded predicate per field rather than by concatenating
    // clauses: every parameter is bound, the statement text is identical for
    // every filter combination (so Postgres can reuse the plan), and no caller
    // input reaches the SQL as text.
    const blueprints =
      query.blueprintName === undefined
        ? null
        : typeof query.blueprintName === "string"
          ? [query.blueprintName]
          : [...query.blueprintName];
    const { rows } = await this.pool.query(
      `SELECT ${LINE_COLUMNS}
         FROM pipeline.assembly_runs
        WHERE ($1::text   IS NULL OR repo = $1)
          AND ($2::text[] IS NULL OR blueprint_name = ANY($2::text[]))
          AND ($3::text[] IS NULL OR status = ANY($3::text[]))
          AND ($4::uuid   IS NULL OR task_id = $4)
          AND ($5::int    IS NULL OR (args->>'pr_number')::int = $5)
          AND ($6::timestamptz IS NULL OR created_at >= $6)
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
      ],
    );

    return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
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
  ): Promise<number> {
    // A null $4 means "every definition" — the caller that owns only part of the
    // PR's lifecycle passes its own family instead, so closing a PR cannot close a
    // line that merely references it.
    const { rows } = await this.pool.query<{ id: string }>(
      `UPDATE pipeline.assembly_runs
          SET status = 'finished', outcome = $1, finished_at = now()
        WHERE repo = $2
          AND (args->>'pr_number')::int = $3
          AND status IN ('queued', 'running')
          AND ($4::text[] IS NULL OR blueprint_name = ANY($4::text[]))
      RETURNING id`,
      [outcome, repo, prNumber, definitions ? [...definitions] : null],
    );

    return rows.length;
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
  outcome: string | null;
  agent_cr_name: string | null;
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
    outcome: row.outcome,
    agentCrName: row.agent_cr_name,
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
