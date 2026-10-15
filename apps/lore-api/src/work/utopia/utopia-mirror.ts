// The ingest-side door to the Utopia mirror: a repo whose settings hold a Utopia source, on a deployment given a Utopia, has every spec and ADR it ingests pushed there.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { UtopiaMirrorSettingsSchema } from "@re-cinq/lore-shared/models/repo-settings.js";
import {
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
import { projectFor } from "../../outbound/project-boot.js";

export interface MirroredDoc {
  path: string;
  content: string;
  kind: "spec" | "adr";
  commit: string;
}

/** The source the repo's documents are pushed to, or null when the deployment has no Utopia or the repo was never set up there. */
export function mirrorSource(
  settings: Record<string, unknown> | null,
  env: UtopiaEnv = process.env,
): UtopiaSource | null {
  if (!utopiaConfigured(env)) {
    return null;
  }
  const parsed = UtopiaMirrorSettingsSchema.safeParse(settings?.utopia);

  return parsed.success
    ? { id: parsed.data.source_id, key: parsed.data.source_key }
    : null;
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
  const source = mirrorSource(await settings.rawSettings());

  return (
    source && {
      push: (pushed) => utopiaClient().pushStatements(source, pushed),
    }
  );
}

/** One failed item fails the document, named by its first failure, so the ingest logs and counts it. */
function settled(outcome: MirrorOutcome): void {
  enforceTrue(
    outcome.failed.length === 0,
    Error,
    `${outcome.failed.length} of ${outcome.items} items failed: ${outcome.failed[0]}`,
  );
}
