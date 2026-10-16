import type { Pool } from "pg";
import {
  KnowledgeBackendSchema,
  type KnowledgeBackend,
} from "@re-cinq/lore-shared/knowledge-backend.js";

interface RepoSettingsRow {
  settings?: { cross_repo?: boolean; context_backend?: unknown };
}

/** What a repo's own settings say about assembling its context: whether linked repos join in (`cross_repo`) and which store answers when the request names none (`context_backend`). */
export interface RepoContextSettings {
  crossRepo: boolean;
  contextBackend?: KnowledgeBackend;
}

const NO_REPO_SETTINGS: RepoContextSettings = { crossRepo: false };

// One read of the repo's settings for both answers. Best-effort: a settings lookup failure degrades to the defaults rather than throwing — losing an enrichment must not cost the caller its own repo's context.
export async function repoContextSettings(
  pool: Pool | null,
  repo: string | undefined,
): Promise<RepoContextSettings> {
  if (!repo || !pool) {
    return NO_REPO_SETTINGS;
  }

  try {
    const { rows } = await pool.query<RepoSettingsRow>(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [repo],
    );

    return contextSettingsOf(rows[0]?.settings);
  } catch {
    return NO_REPO_SETTINGS;
  }
}

function contextSettingsOf(
  settings: RepoSettingsRow["settings"],
): RepoContextSettings {
  const backend = KnowledgeBackendSchema.safeParse(settings?.context_backend);

  return {
    crossRepo: settings?.cross_repo === true,
    ...(backend.success ? { contextBackend: backend.data } : {}),
  };
}
