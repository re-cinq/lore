import type { Pool } from "pg";

interface RepoSettingsRow {
  settings?: { cross_repo?: boolean };
}

function rowAllowsCrossRepo(rows: RepoSettingsRow[]): boolean {
  const settings = rows[0]?.settings;

  return settings?.cross_repo === true;
}

// What the repo's own settings say. Best-effort: a settings lookup that fails degrades to DISABLED rather than throwing — cross-repo context is an enrichment, and losing it must not cost the caller its own repo's context.
async function repoAllowsCrossRepo(pool: Pool, repo: string): Promise<boolean> {
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

// Whether the REPO's own settings.cross_repo flag enables cross-repo context; a caller that was asked for it explicitly never needs to ask. Best-effort: a settings lookup failure degrades to disabled rather than throwing.
export async function repoWantsCrossRepo(
  pool: Pool | null,
  repo: string | undefined,
): Promise<boolean> {
  if (!repo || !pool) {
    return false;
  }

  return repoAllowsCrossRepo(pool, repo);
}
