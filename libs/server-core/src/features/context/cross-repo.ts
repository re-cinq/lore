import type { Pool } from "pg";

interface RepoSettingsRow {
  settings?: { cross_repo?: boolean };
}

function rowAllowsCrossRepo(rows: RepoSettingsRow[]): boolean {
  const settings = rows[0]?.settings;

  return settings?.cross_repo === true;
}

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
    const { rows } = await pool.query<RepoSettingsRow>(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [repo],
    );

    return rowAllowsCrossRepo(rows);
  } catch {
    return false;
  }
}
