/** Status-column mutation for pipeline.tasks: the allowlisted extra-column writer and its compare-and-set sibling. */

import type { PgPool } from "./memory-store.js";

/** Columns setTaskStatus may write alongside `status` (allowlisted against SQL injection via dynamic keys); silently skips unknown keys, unlike setColumns which throws. */
export const ALLOWED_TASK_COLUMNS = new Set([
  "pr_url",
  "pr_number",
  "target_branch",
  "failure_reason",
  "agent_id",
  "log_url",
  "claimed_by",
  "claimed_at",
  "issue_number",
  "issue_url",
  "review_iteration",
  "actor",
  "priority",
]);

/** Updates status + updated_at + allowlisted extra columns; does NOT record an event (use updateTaskStatus for that, or call recordEvent yourself). */
export async function setTaskStatus(
  pool: PgPool,
  taskId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const setClauses = ["status = $1", "updated_at = now()"];
  const params: unknown[] = [status];
  let idx = 2;

  for (const [key, value] of Object.entries(extra)) {
    if (!ALLOWED_TASK_COLUMNS.has(key)) {
      continue;
    }
    setClauses.push(`${key} = $${idx}`);
    params.push(value);
    idx++;
  }
  params.push(taskId);
  await pool.query(
    `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${idx}`,
    params,
  );
}

/** Compare-and-set status flip — updates only when the row is still `expectedStatus`, returning true iff this caller won the race (guards against double-processing). */
export async function setTaskStatusIf(
  pool: PgPool,
  taskId: string,
  { expected: expectedStatus, status }: { expected: string; status: string },
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const setClauses = ["status = $1", "updated_at = now()"];
  const params: unknown[] = [status];
  let idx = 2;

  for (const [key, value] of Object.entries(extra)) {
    if (!ALLOWED_TASK_COLUMNS.has(key)) {
      continue;
    }
    setClauses.push(`${key} = $${idx}`);
    params.push(value);
    idx++;
  }
  const idIdx = idx;

  params.push(taskId);
  const expectedIdx = idx + 1;

  params.push(expectedStatus);
  const { rows } = await pool.query(
    `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${idIdx} AND status = $${expectedIdx} RETURNING id`,
    params,
  );

  return rows.length > 0;
}
