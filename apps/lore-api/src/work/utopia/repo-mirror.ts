// What every ingest-side door to the Utopia mirror shares: a repo whose settings name a Utopia source whose key lore.utopia_sources holds, on a deployment given a Utopia, has what it ingests pushed there; on a deployment holding a Utopia write token, a repo not set up yet is set up first.

import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { LORE_ONTOLOGY_VERSION } from "@re-cinq/lore-shared/lore-ontology.js";
import {
  UtopiaMirrorSettingsSchema,
  type UtopiaMirrorSettings,
} from "@re-cinq/lore-shared/models/repo-settings.js";
import { recordUtopiaMirrorFailure } from "@re-cinq/lore-shared/otel/metrics.js";
import {
  utopiaAutoSetupConfigured,
  utopiaConfigured,
  type UtopiaEnv,
  type UtopiaSource,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import {
  mirrorFailure,
  type MirrorOutcome,
} from "@re-cinq/lore-shared/utopia/push-items.js";
import type { Pool } from "pg";
import { projectFor } from "../../outbound/project-boot.js";
import {
  utopiaSourceFor,
  type StoredUtopiaSource,
} from "../../outbound/utopia-sources.js";
import { autoSetUpRepo, autoUpgradeOntology } from "./utopia-auto-setup.js";

/** The source the repo's documents are pushed to, or null when the deployment has no Utopia, the repo was never set up there, or the stored key belongs to another source than the one its settings name. */
export function mirrorSource(
  settings: Record<string, unknown> | null,
  stored: StoredUtopiaSource | null,
  env: UtopiaEnv = process.env,
): UtopiaSource | null {
  const named = namedSourceId(settings);

  if (!utopiaConfigured(env) || !stored || stored.id !== named) {
    return null;
  }

  return { id: stored.id, key: stored.key };
}

function namedSourceId(
  settings: Record<string, unknown> | null,
): string | null {
  const parsed = UtopiaMirrorSettingsSchema.safeParse(settings?.utopia);

  return parsed.success ? parsed.data.source_id : null;
}

/** The source the repo was set up with, its ontology upgraded first where the base holds an older one, else a fresh setup where the deployment may run one itself, else null. A failed setup throws, so the ingest logs and counts it as a failed mirror. */
export async function sourceToMirror(
  pool: Pool,
  repo: string,
  settings: Record<string, unknown> | null,
  env: UtopiaEnv = process.env,
): Promise<UtopiaSource | null> {
  const base = await repoBaseFor(pool, repo, settings, env);

  return base && { id: base.id, key: base.key };
}

/** {@link sourceToMirror}'s source with the knowledge base it belongs to, for the mirrors that push through sources of their own in the same base. */
export async function repoBaseFor(
  pool: Pool,
  repo: string,
  settings: Record<string, unknown> | null,
  env: UtopiaEnv = process.env,
): Promise<StoredUtopiaSource | null> {
  const stored = await utopiaSourceFor(pool, repo);

  if (mirrorSource(settings, stored, env)) {
    await upgradeOntologyQuietly(pool, repo, settings?.utopia, env);

    return stored;
  }

  return utopiaAutoSetupConfigured(env)
    ? autoSetUpRepo(pool, repo, stored, env)
    : null;
}

/** The id of the knowledge base a repo's mirrors push to, the repo set up first where the deployment may; null when it has none. */
export async function repoKnowledgeBase(
  pool: Pool,
  repo: string,
  env: UtopiaEnv = process.env,
): Promise<string | null> {
  const settings = await (await projectFor(repo)).settings.rawSettings();

  return (await repoBaseFor(pool, repo, settings, env))?.kbId ?? null;
}

/** Without a write token the push goes ahead on the old ontology, its new attributes landing unbound; a failed upgrade is logged and counted as a failed mirror, and the push goes ahead all the same. */
async function upgradeOntologyQuietly(
  pool: Pool,
  repo: string,
  utopia: unknown,
  env: UtopiaEnv,
): Promise<void> {
  const mirror = UtopiaMirrorSettingsSchema.parse(utopia);

  if (ontologyUpgradable(mirror, env)) {
    await autoUpgradeOntology(pool, repo, mirror, env).catch(
      (error: unknown) => {
        console.error(
          `[utopia-mirror] ${repo} ontology upgrade: ${errorMessage(error)}`,
        );
        recordUtopiaMirrorFailure(repo);
      },
    );
  }
}

function ontologyUpgradable(
  mirror: UtopiaMirrorSettings,
  env: UtopiaEnv,
): boolean {
  return (
    (mirror.ontology_version ?? 0) < LORE_ONTOLOGY_VERSION &&
    utopiaAutoSetupConfigured(env)
  );
}

/** One failed item fails the document, so the ingest logs and counts it. */
export function settled(outcome: MirrorOutcome): void {
  const failure = mirrorFailure(outcome);

  enforceTrue(failure === null, Error, failure ?? "");
}
