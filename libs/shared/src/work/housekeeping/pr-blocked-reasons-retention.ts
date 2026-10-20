// The 30-day purge of pipeline.pr_blocked_reasons rows whose PR merged or closed (specs/protected-branch-merge); an open PR's row has no closed_at and is never purged.
import type { PgPool } from "../../domain/memory-store-types.js";

export const PR_BLOCKED_REASONS_RETENTION_DAYS = 30;

export async function prunePrBlockedReasons(
  pool: PgPool,
  days: number = PR_BLOCKED_REASONS_RETENTION_DAYS,
): Promise<string> {
  const { rows } = await pool.query<{ count: number }>(
    `WITH deleted AS (
       DELETE FROM pipeline.pr_blocked_reasons
        WHERE closed_at < now() - make_interval(days => $1)
      RETURNING 1
     )
     SELECT count(*)::int AS count FROM deleted`,
    [days],
  );

  return `pruned pr_blocked_reasons closed more than ${days}d ago — ${rows[0]?.count ?? 0}`;
}
