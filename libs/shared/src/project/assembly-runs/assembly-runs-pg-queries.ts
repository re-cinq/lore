import type { PgPool } from "../../memory-store.js";
import type { AssemblyRunQuery } from "./assembly-runs-port.js";
import type {
  AssemblyRunRecord,
  AssemblyRunSummary,
  OpenRunSummary,
  ClosedRunRef,
} from "./assembly-runs-port.js";
import {
  LINE_COLUMNS,
  SUMMARY_COLUMNS,
  OPEN_SUMMARY_COLUMNS,
  toRecord,
  toOpenSummary,
  type OpenRunRow,
} from "./assembly-runs-pg-rows.js";

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

/** `value ?? null`, spelled as a call so a chain of optional filters isn't one branch per field. */
function orNull<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

/** Clones a readonly filter list, or null when absent. */
function toArrayOrNull<T>(value: readonly T[] | undefined): T[] | null {
  return value ? [...value] : null;
}

export async function listOpen(pool: PgPool): Promise<AssemblyRunRecord[]> {
  const { rows } = await pool.query(
    `SELECT ${LINE_COLUMNS}
       FROM pipeline.assembly_runs
      WHERE status IN ('queued', 'running')
      ORDER BY created_at`,
  );

  return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
}

export async function findOpenOnBranch(
  pool: PgPool,
  repo: string,
  branch: string,
): Promise<OpenRunSummary[]> {
  const { rows } = await pool.query<OpenRunRow>(
    `${OPEN_SUMMARY_COLUMNS}
      WHERE status IN ('queued', 'running')
        AND repo = $1
        AND branch = $2
      ORDER BY created_at, id`,
    [repo, branch],
  );

  return rows.map(toOpenSummary);
}

export async function findOpenBySubject(
  pool: PgPool,
  repo: string,
  subjectKey: string,
): Promise<OpenRunSummary | null> {
  // LIMIT 1 states intent; the partial unique index makes it a fact. Still ordered so a DB predating (or missing) the index answers deterministically.
  const { rows } = await pool.query<OpenRunRow>(
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

export async function countBySubject(
  pool: PgPool,
  repo: string,
  subjectKey: string,
): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM pipeline.assembly_runs
      WHERE repo = $1 AND subject_key = $2`,
    [repo, subjectKey],
  );

  return Number(rows[0]?.n ?? 0);
}

export async function mergeArgs(
  pool: PgPool,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  // Merged in SQL (not read-modify-write): two nodes producing artifacts in the same tick would otherwise race and drop one's output; || is jsonb concat, right operand wins per key.
  await pool.query(
    `UPDATE pipeline.assembly_runs
        SET args = COALESCE(args, '{}'::jsonb) || $2::jsonb
      WHERE id = $1`,
    [id, JSON.stringify(patch)],
  );
}

export async function getById(
  pool: PgPool,
  id: string,
): Promise<AssemblyRunRecord | null> {
  const { rows } = await pool.query(
    `SELECT ${LINE_COLUMNS}
       FROM pipeline.assembly_runs WHERE id = $1`,
    [id],
  );

  if (rows.length === 0) {
    return null;
  }

  return toRecord(rows[0] as Parameters<typeof toRecord>[0]);
}

/** The one filtered read both list shapes run; NULL-guarded predicate per field (not concatenated clauses) so every param is bound and the plan is reusable. */
async function selectList(
  pool: PgPool,
  columns: string,
  query: AssemblyRunQuery,
): Promise<unknown[]> {
  const blueprints = blueprintNameList(query.blueprintName);
  const { rows } = await pool.query(
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
      orNull(query.repo),
      blueprints,
      toArrayOrNull(query.status),
      orNull(query.taskId),
      orNull(query.prNumber),
      orNull(query.createdAfter),
      query.limit ?? 50,
      orNull(query.subjectKey),
      orNull(query.clusterAgentId),
    ],
  );

  return rows;
}

export async function list(
  pool: PgPool,
  query: AssemblyRunQuery,
): Promise<AssemblyRunRecord[]> {
  const rows = await selectList(pool, LINE_COLUMNS, query);

  return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
}

export async function listSummaries(
  pool: PgPool,
  query: AssemblyRunQuery,
): Promise<AssemblyRunSummary[]> {
  const rows = await selectList(pool, SUMMARY_COLUMNS, query);

  return rows.map((r) => {
    // toRecord also maps graph, absent here — drop the key rather than read back a null the run doesn't have.
    const { graph: _graph, ...summary } = toRecord({
      ...(r as Parameters<typeof toRecord>[0]),
      graph: null,
    });

    return summary;
  });
}

export async function listForTask(
  pool: PgPool,
  taskId: string,
): Promise<AssemblyRunRecord[]> {
  const { rows } = await pool.query(
    `SELECT ${LINE_COLUMNS}
       FROM pipeline.assembly_runs
      WHERE task_id = $1
      ORDER BY created_at DESC`,
    [taskId],
  );

  return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
}

export async function findOpenByPr(
  pool: PgPool,
  repo: string,
  prNumber: number,
): Promise<AssemblyRunRecord[]> {
  const { rows } = await pool.query(
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

export async function finishOpenByPr(
  pool: PgPool,
  repo: string,
  prNumber: number,
  closing: { outcome: string; definitions?: readonly string[] },
): Promise<ClosedRunRef[]> {
  // null $4 means "every definition" — callers that own only part of the PR lifecycle pass their own family so closing a PR can't close an unrelated line.
  const { rows } = await pool.query<{
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
    [
      closing.outcome,
      repo,
      prNumber,
      closing.definitions ? [...closing.definitions] : null,
    ],
  );

  return rows.map((row) => ({ id: row.id, taskId: row.task_id }));
}

export async function hasReviewedPr(
  pool: PgPool,
  repo: string,
  prNumber: number,
): Promise<boolean> {
  const { rows } = await pool.query(
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
