import type { Pool } from "pg";

// Cross-repo context is enabled by caller cross_repo=true or the repo's settings.cross_repo flag; shared by the MCP tool and /api/context route so both honor the same fallback. Best-effort: a settings lookup failure degrades to disabled rather than throwing.
export async function resolveCrossRepo(
  pool: Pool | null,
  repo: string | undefined,
  explicit: boolean,
): Promise<boolean> {
  if (explicit) {
    return true;
  }

  if (!repo || !pool) {
    return false;
  }

  try {
    const { rows } = await pool.query(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [repo],
    );

    return rows[0]?.settings?.cross_repo === true;
  } catch {
    return false;
  }
}
