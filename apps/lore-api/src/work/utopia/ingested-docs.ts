// Which of a repo's paths CI ingests as specs and ADRs: the globs `.lore/ingest.yml` declares for a kind, or its built-in prefixes (`isDocOfKind` in apps/lore-code-trace). The backfill mirrors these documents; the commit mirror names a changed path by the same kinds.

import { parse as parseYaml } from "yaml";
import { parseIngestPatterns, selectIngestFiles } from "@re-cinq/lore-shared";
import type { MirroredDoc } from "./utopia-mirror.js";

export interface DocToMirror {
  path: string;
  kind: MirroredDoc["kind"];
}

export const INGEST_MANIFEST_PATH = ".lore/ingest.yml";
const MIRRORED_KINDS = { specs: "spec", adrs: "adr" } as const;

export function docsToMirror(
  tree: string[],
  manifest: string | null,
): DocToMirror[] {
  const patterns = parseIngestPatterns(parseYaml(manifest ?? ""));

  return Object.entries(MIRRORED_KINDS).flatMap(([ingestKind, kind]) =>
    selectIngestFiles(tree, ingestKind, {
      patterns: patterns[ingestKind],
    }).map((path) => ({ path, kind })),
  );
}
