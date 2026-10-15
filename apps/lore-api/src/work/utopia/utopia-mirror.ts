// The ingest-side door to the Utopia mirror: a repo whose settings name a Utopia source whose key lore.utopia_sources holds, on a deployment given a Utopia, has every spec and ADR it ingests pushed there; on a deployment holding a Utopia write token, a repo not set up yet is set up first.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { UtopiaMirrorSettingsSchema } from "@re-cinq/lore-shared/models/repo-settings.js";
import {
  utopiaAutoSetupConfigured,
  utopiaClient,
  utopiaConfigured,
  type UtopiaEnv,
  type UtopiaSource,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import {
  mirrorDocument,
  tombstoneDocument,
  type MirrorDeps,
  type MirrorOutcome,
} from "@re-cinq/lore-shared/utopia/mirror-document.js";
import { getPool } from "@re-cinq/lore-server-core/platform/db.js";
import type { Pool } from "pg";
import { projectFor } from "../../outbound/project-boot.js";
import {
  utopiaSourceFor,
  type StoredUtopiaSource,
} from "../../outbound/utopia-sources.js";
import { autoSetUpRepo } from "./utopia-auto-setup.js";

export interface MirroredDoc {
  path: string;
  content: string;
  kind: "spec" | "adr";
  commit: string;
}

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

export async function mirrorDocFor(
  repo: string,
  doc: MirroredDoc,
): Promise<void> {
  const deps = await mirrorDepsFor(repo);

  if (deps) {
    settled(await mirrorDocument(deps, { repo, ...doc }));
  }
}

export async function unmirrorDocFor(
  repo: string,
  path: string,
): Promise<void> {
  const deps = await mirrorDepsFor(repo);

  if (deps) {
    settled(await tombstoneDocument(deps, { repo, path }));
  }
}

async function mirrorDepsFor(repo: string): Promise<MirrorDeps | null> {
  if (!utopiaConfigured()) {
    return null;
  }
  const { settings } = await projectFor(repo);
  const source = await sourceToMirror(
    getPool(),
    repo,
    await settings.rawSettings(),
  );

  return (
    source && {
      push: (pushed) => utopiaClient().pushStatements(source, pushed),
    }
  );
}

/** The source the repo was set up with, else a fresh setup where the deployment may run one itself, else null. A failed setup throws, so the ingest logs and counts it as a failed mirror. */
export async function sourceToMirror(
  pool: Pool,
  repo: string,
  settings: Record<string, unknown> | null,
  env: UtopiaEnv = process.env,
): Promise<UtopiaSource | null> {
  const stored = await utopiaSourceFor(pool, repo);
  const source = mirrorSource(settings, stored, env);

  if (source || !utopiaAutoSetupConfigured(env)) {
    return source;
  }

  return autoSetUpRepo(pool, repo, stored, env);
}

/** One failed item fails the document, named by its first failure, so the ingest logs and counts it. */
function settled(outcome: MirrorOutcome): void {
  enforceTrue(
    outcome.failed.length === 0,
    Error,
    `${outcome.failed.length} of ${outcome.items} items failed: ${outcome.failed[0]}`,
  );
}
