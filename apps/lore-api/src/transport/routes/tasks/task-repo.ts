// Looks up the repository a task or task-group record belongs to for `repoLevel` declarations.

import type { Request } from "@hapi/hapi";
import type { Pool } from "pg";

function repoByParamId(getPool: () => Pool | null, sql: string) {
  return (request: Request): Promise<string | null> =>
    queryTargetRepo(getPool(), sql, request.params.id);
}

async function queryTargetRepo(
  pool: Pool | null,
  sql: string,
  id: string | undefined,
): Promise<string | null> {
  if (!pool || !id) {
    return null;
  }
  const { rows } = await pool.query<{ target_repo?: string }>(sql, [id]);

  return rows[0]?.target_repo ?? null;
}

export const taskRepoByParamId = (getPool: () => Pool | null) =>
  repoByParamId(
    getPool,
    "SELECT target_repo FROM pipeline.tasks WHERE id = $1",
  );

export const groupRepoByParamId = (getPool: () => Pool | null) =>
  repoByParamId(
    getPool,
    "SELECT target_repo FROM pipeline.tasks WHERE task_group_id = $1 AND target_repo IS NOT NULL LIMIT 1",
  );

export function taskLogRepoOf(getPool: () => Pool | null) {
  return async (request: Request): Promise<string | null> => {
    const query = request.query as { task_id?: string; repo?: string };
    const fromTask = await queryTargetRepo(
      getPool(),
      "SELECT target_repo FROM pipeline.tasks WHERE id = $1",
      query.task_id,
    );

    return fromTask ?? nonEmpty(query.repo);
  };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
