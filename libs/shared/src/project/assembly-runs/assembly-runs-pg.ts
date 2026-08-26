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
} from "./assembly-runs-port.js";

/** The graph-less projection both open-run reads use. `listOpen` hauls every open
 *  run's graph clone org-wide; these two compare a handful of scalars. */
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

/** Postgres `unique_violation`. The subject guard is a partial unique index, so
 *  this is how "someone is already working that subject" arrives. */
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

/**
 * Every column `toRecord` maps except `id`, which both lists lead with, and
 * `graph`, the blueprint clone only the full read carries.
 *
 * The two read lists are otherwise identical, so the summary is DERIVED rather
 * than restated: two hand-kept lists differing by one token is a column added to
 * one of them and forgotten in the other.
 */
const SUMMARY_TAIL = `blueprint_name, task_id, repo, branch, subject_key, args, status, outcome, reason,
         blueprint_hash, resumed_from_run_id, resumed_from_node_id, inherited_node_count,
         created_at, started_at, finished_at`;

/** {@link LINE_COLUMNS} without the blueprint clone — see `listSummaries`. */
const SUMMARY_COLUMNS = `id, ${SUMMARY_TAIL}`;

/** Every column `toRecord` maps, single-sourced so the four read sites cannot drift. */
const LINE_COLUMNS = `id, graph, ${SUMMARY_TAIL}`;

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

    try {
      return await this.insertStart(input);
    } catch (err) {
      if (!isUniqueViolation(err) || !input.subjectKey) {
        throw err;
      }
      // Start-or-JOIN: the subject is already in flight, so hand back the run
      // doing the work instead of a second one. The index — not this branch — is
      // what makes that true under concurrency; reaching here means it fired.
      const open = await this.findOpenBySubject(input.repo, input.subjectKey);

      if (open) {
        return open.id;
      }

      // The holder settled between the violation and this read, freeing the key.
      // Retry ONCE: looping would spin against a subject being restarted in a
      // tight cycle, and a second violation is a genuine race worth surfacing.
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
    //
    // `failure_class` / `failure_detail` are dropped alongside `agent_cr_name`,
    // and for the same reason: all three describe the ATTEMPT that is over, not
    // the history the fork inherits. Copying the verdict would be worse than
    // untidy — `getNextTransition` replays every visit from the entry node and
    // fails the run on a permanent failure it meets on a revisit edge, so an
    // inherited `anthropic-credit` visit anywhere in the copied prefix kills the
    // fork on its first `advanceLine`. That is exactly the operation someone
    // performs after topping the account up.
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
                  'resumedFrom', jsonb_build_object('lineId', $7, 'nodeId', $8)
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
        // A fork re-runs the SAME work: it takes over its source's subject, so it
        // holds the guard and a subject query finds it. Legal only from a
        // terminal run, so the key is free by the time we get here.
        // `?? null` and not just `??`: a bound parameter must be a VALUE. An
        // undefined here reaches the driver as an absent parameter rather than
        // SQL NULL, which is a different thing from "this run has no subject".
        input.subjectKey ?? source.subjectKey ?? null,
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
    // One statement: the FOR UPDATE SKIP LOCKED subquery and the UPDATE share a
    // snapshot, so two concurrent claimants can never take the same row.
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
    const { rows } = await this.pool.query(
      `UPDATE pipeline.station_runs
          SET status = 'queued', cluster_agent_id = NULL, claimed_at = NULL
        WHERE id = $1 AND outcome IS NULL
       RETURNING id`,
      [nodeRowId],
    );

    return rows.length === 1;
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
    // LIMIT 1 states the intent; the partial unique index makes it a fact rather
    // than a hope. Ordered anyway so that a database predating the index (or one
    // where it was dropped) answers deterministically instead of returning
    // whichever row the planner reached first.
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
    const rows = await this.selectList(LINE_COLUMNS, query);

    return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
  }

  async listSummaries(query: AssemblyRunQuery): Promise<AssemblyRunSummary[]> {
    const rows = await this.selectList(SUMMARY_COLUMNS, query);

    return rows.map((r) => {
      // toRecord maps `graph` too, and the column is absent here — so drop the
      // key rather than let it read back as a null the run does not have.
      const { graph: _graph, ...summary } = toRecord({
        ...(r as Parameters<typeof toRecord>[0]),
        graph: null,
      });

      return summary;
    });
  }

  /**
   * The one filtered read both list shapes run.
   *
   * Built as a NULL-guarded predicate per field rather than by concatenating
   * clauses: every parameter is bound, the statement text is identical for
   * every filter combination (so Postgres can reuse the plan), and no caller
   * input reaches the SQL as text.
   */
  private async selectList(
    columns: string,
    query: AssemblyRunQuery,
  ): Promise<unknown[]> {
    const blueprints =
      query.blueprintName === undefined
        ? null
        : typeof query.blueprintName === "string"
          ? [query.blueprintName]
          : [...query.blueprintName];
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
    // Pre-migration reads (SELECT lists without the lifecycle columns) default
    // to the push-era meaning, same as the InMemory double.
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
    // A shape the schema rejects reads as "not captured" rather than throwing:
    // this column is diagnostics, and a bad row must not break the walk that
    // reads the visits beside it.
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
