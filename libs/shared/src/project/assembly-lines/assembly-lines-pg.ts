import { enforceTrue } from "../../lib/enforce.js";
import { resolveResumePrefix } from "./resume.js";
import type { PgPool } from "../../memory-store.js";
import type {
  AssemblyLinesPort,
  AssemblyLineResumeFrom,
  AssemblyLineStartInput,
  AssemblyLineNodeStartInput,
  AssemblyLineRecord,
  AssemblyLineNodeRecord,
} from "./assembly-lines-port.js";

/** Every column `toRecord` maps, single-sourced so the four read sites cannot drift. */
const LINE_COLUMNS = `id, definition_name, task_id, repo, branch, args, status, outcome, reason,
         definition_hash, resumed_from_line_id, resumed_from_node_id, inherited_node_count,
         created_at, started_at, finished_at`;

/**
 * Postgres-backed {@link AssemblyLinesPort} over `pipeline.assembly_lines` /
 * `pipeline.assembly_line_nodes` (migration 0025). `start` writes the row and
 * the `assembly_line.start` event in ONE data-modifying CTE — atomic without
 * `pool.connect()`, which the narrow {@link PgPool} does not expose. The event
 * columns mirror the shared `insertEvent` writer (`events.ts`).
 */
export class PgAssemblyLines implements AssemblyLinesPort {
  constructor(private readonly pool: PgPool) {}

  async start(input: AssemblyLineStartInput): Promise<string> {
    if (input.resumeFrom) {
      return this.startResumed(input, input.resumeFrom);
    }

    const { rows } = await this.pool.query(
      `WITH al AS (
         INSERT INTO pipeline.assembly_lines (definition_name, task_id, repo, branch, args)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id
       ), ev AS (
         INSERT INTO pipeline.events (event_name, source, params, repo, dedupe_key)
         SELECT 'assembly_line.start', 'internal',
                jsonb_build_object(
                  'assemblyLineId', al.id,
                  'definitionName', $1,
                  'repo', $3,
                  'branch', $4,
                  'taskId', $2,
                  'args', $5::jsonb
                ),
                $3, 'assembly_line.start:' || al.id
         FROM al
       )
       SELECT id FROM al`,
      [
        input.definitionName,
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
      `UPDATE pipeline.assembly_lines
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
   */
  private async startResumed(
    input: AssemblyLineStartInput,
    resumeFrom: AssemblyLineResumeFrom,
  ): Promise<string> {
    const { source, prefix } = resolveResumePrefix(
      input,
      await this.getById(resumeFrom.lineId),
      await this.listNodes(resumeFrom.lineId),
    );
    const cutoffNodeRowId = prefix[prefix.length - 1].id;
    const { rows } = await this.pool.query(
      `WITH al AS (
         INSERT INTO pipeline.assembly_lines
           (definition_name, task_id, repo, branch, args, definition_hash,
            resumed_from_line_id, resumed_from_node_id, inherited_node_count)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $10)
         RETURNING id
       ), ev AS (
         INSERT INTO pipeline.events (event_name, source, params, repo, dedupe_key)
         SELECT 'assembly_line.start', 'internal',
                jsonb_build_object(
                  'assemblyLineId', al.id,
                  'definitionName', $1,
                  'repo', $3,
                  'branch', $4,
                  'taskId', $2,
                  'args', $5::jsonb,
                  'resumedFrom', jsonb_build_object('lineId', $7, 'nodeId', $8)
                ),
                $3, 'assembly_line.start:' || al.id
         FROM al
       ), copied AS (
         INSERT INTO pipeline.assembly_line_nodes
           (assembly_line_id, node_id, iteration, outcome, agent_cr_name,
            commit_sha, started_at, finished_at)
         SELECT al.id,
                n.node_id, n.iteration, n.outcome, n.agent_cr_name, n.commit_sha, n.started_at, n.finished_at
           FROM pipeline.assembly_line_nodes n, al
          WHERE n.assembly_line_id = $7
            AND n.id <= $9::bigint
          ORDER BY n.id
       )
       SELECT id FROM al`,
      [
        input.definitionName,
        source.taskId,
        input.repo,
        source.branch,
        JSON.stringify(input.args ?? source.args),
        source.definitionHash,
        resumeFrom.lineId,
        resumeFrom.nodeId,
        cutoffNodeRowId,
        prefix.length,
      ],
    );

    return rows[0].id as string;
  }

  async stampDefinitionHash(id: string, hash: string): Promise<void> {
    // Write-once: the stored hash is the graph this line's node rows were
    // produced by. A redelivered start that loads a since-edited definition
    // would otherwise silently re-point the row at a graph it never ran.
    await this.pool.query(
      `UPDATE pipeline.assembly_lines
         SET definition_hash = $2
       WHERE id = $1
         AND definition_hash IS NULL`,
      [id, hash],
    );
  }

  async finish(id: string, outcome: string, reason?: string): Promise<boolean> {
    // First writer decides: duplicate/late finishers (event redelivery, reaper vs
    // watch race) never overwrite a terminal row. RETURNING reports the win so
    // callers can gate once-only side effects on it.
    const { rows } = await this.pool.query(
      `UPDATE pipeline.assembly_lines
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

  async ensureNodeStart(
    input: AssemblyLineNodeStartInput,
  ): Promise<{ nodeRowId: string; created: boolean }> {
    // DO UPDATE (not DO NOTHING) so the statement locks and RETURNS the row in
    // EVERY case, including the concurrent-duplicate race the primitive exists to
    // absorb: a DO NOTHING + fallback SELECT sees the winner's not-yet-committed
    // row as absent under its snapshot and returns zero rows. `xmax = 0` is true
    // only for a fresh insert, so it distinguishes create from converged duplicate.
    const { rows } = await this.pool.query(
      `INSERT INTO pipeline.assembly_line_nodes (assembly_line_id, node_id, iteration, agent_cr_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (assembly_line_id, node_id, iteration)
         DO UPDATE SET node_id = EXCLUDED.node_id
       RETURNING id, (xmax = 0) AS created`,
      [
        input.assemblyLineId,
        input.nodeId,
        input.iteration,
        input.agentCrName ?? null,
      ],
    );

    enforceTrue(
      rows.length === 1,
      Error,
      `ensureNodeStart: expected exactly one row for (${input.assemblyLineId}, ${input.nodeId}, ${input.iteration}), got ${rows.length}`,
    );
    const row = rows[0] as { id: number | string; created: boolean };

    return { nodeRowId: String(row.id), created: row.created };
  }

  async finishNodeOnce(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
  ): Promise<boolean> {
    const { rows } = await this.pool.query(
      `UPDATE pipeline.assembly_line_nodes
         SET outcome = $1, commit_sha = $2, finished_at = now()
       WHERE id = $3 AND outcome IS NULL
       RETURNING id`,
      [outcome, commitSha ?? null, nodeRowId],
    );

    return rows.length === 1;
  }

  async listNodes(assemblyLineId: string): Promise<AssemblyLineNodeRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT id, assembly_line_id, node_id, iteration, outcome, agent_cr_name,
              commit_sha, started_at, finished_at
         FROM pipeline.assembly_line_nodes
        WHERE assembly_line_id = $1
        ORDER BY id`,
      [assemblyLineId],
    );

    return rows.map((r) =>
      toNodeRecord(r as Parameters<typeof toNodeRecord>[0]),
    );
  }

  async listOpen(): Promise<AssemblyLineRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT ${LINE_COLUMNS}
         FROM pipeline.assembly_lines
        WHERE status IN ('queued', 'running')
        ORDER BY created_at`,
    );

    return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
  }

  async getById(id: string): Promise<AssemblyLineRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT ${LINE_COLUMNS}
         FROM pipeline.assembly_lines WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) {
      return null;
    }

    return toRecord(rows[0] as Parameters<typeof toRecord>[0]);
  }

  async listForTask(taskId: string): Promise<AssemblyLineRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT ${LINE_COLUMNS}
         FROM pipeline.assembly_lines
        WHERE task_id = $1
        ORDER BY created_at DESC`,
      [taskId],
    );

    return rows.map((r) => toRecord(r as Parameters<typeof toRecord>[0]));
  }

  async findOpenByPr(
    repo: string,
    prNumber: number,
  ): Promise<AssemblyLineRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT ${LINE_COLUMNS}
         FROM pipeline.assembly_lines
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
  ): Promise<number> {
    const { rows } = await this.pool.query(
      `UPDATE pipeline.assembly_lines
          SET status = 'finished', outcome = $1, finished_at = now()
        WHERE repo = $2
          AND (args->>'pr_number')::int = $3
          AND status IN ('queued', 'running')
      RETURNING id`,
      [outcome, repo, prNumber],
    );

    return rows.length;
  }

  async hasReviewedPr(repo: string, prNumber: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1
         FROM pipeline.assembly_lines
        WHERE repo = $1
          AND definition_name = 'code-review'
          AND (args->>'pr_number')::int = $2
        LIMIT 1`,
      [repo, prNumber],
    );

    return rows.length > 0;
  }
}

function toNodeRecord(row: {
  id: number | string;
  assembly_line_id: string;
  node_id: string;
  iteration: number;
  outcome: string | null;
  agent_cr_name: string | null;
  commit_sha: string | null;
  started_at: Date;
  finished_at: Date | null;
}): AssemblyLineNodeRecord {
  return {
    id: String(row.id),
    assemblyLineId: row.assembly_line_id,
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
  definition_name: string;
  task_id: string | null;
  repo: string;
  branch: string | null;
  args: Record<string, unknown> | null;
  status: AssemblyLineRecord["status"];
  outcome: string | null;
  reason: string | null;
  definition_hash: string | null;
  resumed_from_line_id: string | null;
  resumed_from_node_id: string | null;
  inherited_node_count: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}): AssemblyLineRecord {
  return {
    id: row.id,
    definitionName: row.definition_name,
    taskId: row.task_id,
    repo: row.repo,
    branch: row.branch,
    args: row.args ?? {},
    status: row.status,
    outcome: row.outcome,
    reason: row.reason,
    definitionHash: row.definition_hash,
    resumedFromLineId: row.resumed_from_line_id,
    resumedFromNodeId: row.resumed_from_node_id,
    inheritedNodeCount: row.inherited_node_count,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
