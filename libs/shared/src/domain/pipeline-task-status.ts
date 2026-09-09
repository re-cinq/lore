/** Status-column mutation for pipeline.tasks: the allowlisted extra-column writer and its compare-and-set sibling. */

import type { PgPool } from "./memory-store-types.js";

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
  const { setClauses, params } = buildStatusAssignment(status, extra);

  params.push(taskId);
  await pool.query(
    `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${params.length}`,
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
  const { setClauses, params } = buildStatusAssignment(status, extra);
  const idIdx = params.length + 1;
  const expectedIdx = idIdx + 1;

  params.push(taskId, expectedStatus);
  const { rows } = await pool.query(
    `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${idIdx} AND status = $${expectedIdx} RETURNING id`,
    params,
  );

  return rows.length > 0;
}

/** The shared SET list: status + updated_at plus one placeholder per allowlisted extra column, with the bind params in matching order. */
function buildStatusAssignment(
  status: string,
  extra: Record<string, unknown>,
): { setClauses: string[]; params: unknown[] } {
  const setClauses = ["status = $1", "updated_at = now()"];
  const params: unknown[] = [status];

  for (const [key, value] of Object.entries(extra)) {
    if (!ALLOWED_TASK_COLUMNS.has(key)) {
      continue;
    }
    setClauses.push(`${key} = $${params.length + 1}`);
    params.push(value);
  }

  return { setClauses, params };
}
