// Which repository a plan belongs to, for the check that a person may open it (FR-488).
import type { Pool } from "pg";
import { PLAN_TABLE } from "@re-cinq/lore-shared/models/plan.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_REPO = `SELECT repo FROM ${PLAN_TABLE} WHERE id = $1`;

/** The plan's repository, or null when the id is not a plan's; an id that cannot be one is not asked about. */
export async function planRepoOf(
  pool: Pool,
  planId: string,
): Promise<string | null> {
  if (!UUID.test(planId)) {
    return null;
  }
  const { rows } = await pool.query<{ repo: string }>(SELECT_REPO, [planId]);

  return rows[0]?.repo ?? null;
}
