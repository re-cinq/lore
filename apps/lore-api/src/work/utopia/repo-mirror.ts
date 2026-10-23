// What every ingest-side door to the Utopia mirror shares: a repo whose settings name its Utopia knowledge base, on a deployment given a Utopia, has what it ingests pushed there; on a deployment holding a Utopia write token, a repo not set up yet is set up first.

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
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import {
  mirrorFailure,
  type MirrorOutcome,
} from "@re-cinq/lore-shared/utopia/push-items.js";
import type { Pool } from "pg";
import { projectFor } from "../../outbound/project-boot.js";
import { autoSetUpRepo, autoUpgradeOntology } from "./utopia-auto-setup.js";

/** The id of the knowledge base a repo's mirrors push to, the repo set up first where the deployment may; null when it has none. */
export async function repoKnowledgeBase(
  pool: Pool,
  repo: string,
  env: UtopiaEnv = process.env,
): Promise<string | null> {
  const settings = await (await projectFor(repo)).settings.rawSettings();

  return knowledgeBaseToMirror(pool, repo, settings, env);
}

/** The knowledge base the repo's settings name, its ontology upgraded first where the base holds an older one, else a fresh setup where the deployment may run one itself, else null; null too on a deployment with no Utopia. A failed setup throws, so the ingest logs and counts it as a failed mirror. */
export async function knowledgeBaseToMirror(
  pool: Pool,
  repo: string,
  settings: Record<string, unknown> | null,
  env: UtopiaEnv = process.env,
): Promise<string | null> {
  const mirror = UtopiaMirrorSettingsSchema.safeParse(settings?.utopia);

  if (utopiaConfigured(env) && mirror.success) {
    await upgradeOntologyQuietly(pool, repo, mirror.data, env);

    return mirror.data.kb_id;
  }

  return utopiaAutoSetupConfigured(env) ? autoSetUpRepo(pool, repo, env) : null;
}

/** Without a write token the push goes ahead on the old ontology, its new attributes landing unbound; a failed upgrade is logged and counted as a failed mirror, and the push goes ahead all the same. */
async function upgradeOntologyQuietly(
  pool: Pool,
  repo: string,
  mirror: UtopiaMirrorSettings,
  env: UtopiaEnv,
): Promise<void> {
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
