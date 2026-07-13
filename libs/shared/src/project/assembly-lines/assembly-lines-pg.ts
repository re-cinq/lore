import type { PgPool } from "../../memory-store.js";
import type {
  AssemblyLinesPort,
  AssemblyLineStartInput,
  AssemblyLineNodeStartInput,
  AssemblyLineRecord,
} from "./assembly-lines-port.js";

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

    return rows[0].id;
  }

  async markRunning(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.assembly_lines
         SET status = 'running', started_at = now()
       WHERE id = $1`,
      [id],
    );
  }

  async finish(id: string, outcome: string, reason?: string): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.assembly_lines
         SET status = CASE WHEN $1 = 'error' THEN 'failed' ELSE 'finished' END,
             outcome = $1,
             reason = $2,
             finished_at = now()
       WHERE id = $3`,
      [outcome, reason ?? null, id],
    );
  }

  async recordNodeStart(input: AssemblyLineNodeStartInput): Promise<string> {
    const { rows } = await this.pool.query(
      `INSERT INTO pipeline.assembly_line_nodes (assembly_line_id, node_id, iteration, agent_cr_name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        input.assemblyLineId,
        input.nodeId,
        input.iteration,
        input.agentCrName ?? null,
      ],
    );

    return String(rows[0].id);
  }

  async recordNodeFinish(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.assembly_line_nodes
         SET outcome = $1, commit_sha = $2, finished_at = now()
       WHERE id = $3`,
      [outcome, commitSha ?? null, nodeRowId],
    );
  }

  async getById(id: string): Promise<AssemblyLineRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT id, definition_name, task_id, repo, branch, args, status, outcome, reason,
              created_at, started_at, finished_at
         FROM pipeline.assembly_lines WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) {
      return null;
    }

    return toRecord(rows[0]);
  }

  async listForTask(taskId: string): Promise<AssemblyLineRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT id, definition_name, task_id, repo, branch, args, status, outcome, reason,
              created_at, started_at, finished_at
         FROM pipeline.assembly_lines
        WHERE task_id = $1
        ORDER BY created_at DESC`,
      [taskId],
    );

    return rows.map(toRecord);
  }

  async findOpenByPr(
    repo: string,
    prNumber: number,
  ): Promise<AssemblyLineRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT id, definition_name, task_id, repo, branch, args, status, outcome, reason,
              created_at, started_at, finished_at
         FROM pipeline.assembly_lines
        WHERE repo = $1
          AND (args->>'pr_number')::int = $2
          AND status IN ('queued', 'running')
        ORDER BY created_at DESC`,
      [repo, prNumber],
    );

    return rows.map(toRecord);
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
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
