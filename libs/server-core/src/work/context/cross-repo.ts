import type { Pool } from "pg";
import {
  KnowledgeBackendSchema,
  type KnowledgeBackend,
} from "@re-cinq/lore-shared/knowledge-backend.js";
import { UtopiaMirrorSettingsSchema } from "@re-cinq/lore-shared/models/repo-settings.js";
import type { UtopiaMirror } from "@re-cinq/lore-shared/project/knowledge/context-assembly-utopia.js";

interface RepoSettingsRow {
  settings?: {
    cross_repo?: boolean;
    context_backend?: unknown;
    utopia?: unknown;
  };
}

/** What a repo's own settings say about assembling its context: whether linked repos join in (`cross_repo`), which store answers when the request names none (`context_backend`), and where its Utopia mirror lives (`utopia`). */
export interface RepoContextSettings {
  crossRepo: boolean;
  contextBackend?: KnowledgeBackend;
  utopiaMirror?: UtopiaMirror;
}

const NO_REPO_SETTINGS: RepoContextSettings = { crossRepo: false };

// One read of the repo's settings for every answer. Best-effort: a settings lookup failure degrades to the defaults rather than throwing — losing an enrichment must not cost the caller its own repo's context.
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
  const utopiaMirror = utopiaMirrorOf(settings?.utopia);

  return {
    crossRepo: settings?.cross_repo === true,
    ...(backend.success ? { contextBackend: backend.data } : {}),
    ...(utopiaMirror ? { utopiaMirror } : {}),
  };
}

/** The mirror to read when the settings name the knowledge base and the docs source; none before the first document is pushed. */
function utopiaMirrorOf(utopia: unknown): UtopiaMirror | null {
  const mirror = UtopiaMirrorSettingsSchema.safeParse(utopia);

  return mirror.success && mirror.data.docs_source_id
    ? { kbId: mirror.data.kb_id, docsSourceId: mirror.data.docs_source_id }
    : null;
}
