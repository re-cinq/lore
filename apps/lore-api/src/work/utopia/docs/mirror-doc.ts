// The ingest-side door for specs, ADRs and other markdown documents: pushed to the repo's Utopia source when it has one, a failed item failing the ingest so it is logged and counted.

import type { MirroredDocKind } from "@re-cinq/lore-shared/utopia/doc-statements.js";
import {
  mirrorDocument,
  tombstoneDocument,
} from "@re-cinq/lore-shared/utopia/mirror-document.js";
import { mirrorDepsFor, settled } from "../repo-mirror.js";

export interface MirroredDoc {
  path: string;
  content: string;
  kind: MirroredDocKind;
  commit: string;
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
