// The ingest-side door for specs, ADRs and other markdown documents: the whole file goes to the repo's `docs` Utopia source and its statements to the `test-coverage` one, a failed item failing the ingest so it is logged and counted.

import { getPool } from "@re-cinq/lore-server-core/platform/db.js";
import type { MirroredDocKind } from "@re-cinq/lore-shared/utopia/doc-statements.js";
import {
  mirrorDocument,
  unmirrorDocument,
  type DocTargets,
} from "@re-cinq/lore-shared/utopia/mirror-document.js";
import { utopiaConfigured } from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { Pool } from "pg";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  pushedItemsFor,
  savePushedItems,
} from "../../../outbound/utopia/pushed-items.js";
import {
  kindDocumentDeps,
  kindMirrorDeps,
  sweepKindSource,
} from "../kind-source.js";
import { settled } from "../repo-mirror.js";

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
  const targets = utopiaConfigured()
    ? await docTargetsFor(getPool(), repo)
    : null;

  if (targets) {
    settled(await mirrorDocument(targets, { repo, ...doc }));
  }
}

export async function unmirrorDocFor(
  repo: string,
  path: string,
): Promise<void> {
  const targets = utopiaConfigured()
    ? await docTargetsFor(getPool(), repo)
    : null;

  if (targets) {
    settled(await unmirrorDocument(targets, path));
  }
}

/** The repo's `docs` and `test-coverage` sources, or null when it has no knowledge base to mirror to. The statements read a linked test file from GitHub when its link names no title; a sweep clears both sources of what their tombstones marked. */
export async function docTargetsFor(
  pool: Pool,
  repo: string,
): Promise<DocTargets | null> {
  const text = await kindDocumentDeps(pool, repo, "docs");
  const statements =
    text && (await kindMirrorDeps(pool, repo, "test-coverage"));
  const { repo: files } = await projectFor(repo);

  return (
    text &&
    statements && {
      text,
      statements: {
        ...statements,
        readTest: (path, commit) => files.read(path, commit),
      },
      ...docUpkeep(pool, repo),
    }
  );
}

/** The ids last pushed per path, and the sweep of both sources that deletes what a tombstone only marked. */
function docUpkeep(
  pool: Pool,
  repo: string,
): Pick<DocTargets, "ledger" | "sweepMissing"> {
  return {
    ledger: {
      pushedFor: (path) => pushedItemsFor(pool, repo, path),
      record: (path, externalIds) =>
        savePushedItems(pool, repo, path, externalIds),
    },
    sweepMissing: async () => {
      await Promise.all([
        sweepKindSource(pool, repo, "docs"),
        sweepKindSource(pool, repo, "test-coverage"),
      ]);
    },
  };
}
