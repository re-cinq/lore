// Which of a repo's paths are mirrored as documents: the specs and ADRs CI ingests (the globs `.lore/ingest.yml` declares for a kind, or its built-in prefixes, `isDocOfKind` in apps/lore-code-trace), then every other markdown file `classifyFile` calls a doc, spec or ADR, as a doc. The backfill mirrors these documents; the file ingest mirrors the docs it is posted.

import { parse as parseYaml } from "yaml";
import {
  classifyFile,
  parseIngestPatterns,
  selectIngestFiles,
} from "@re-cinq/lore-shared";
import type { MirroredDoc } from "./utopia-mirror.js";

export interface DocToMirror {
  path: string;
  kind: MirroredDoc["kind"];
}

export const INGEST_MANIFEST_PATH = ".lore/ingest.yml";
const TRACED_KINDS = { specs: "spec", adrs: "adr" } as const;

export function docsToMirror(
  tree: string[],
  manifest: string | null,
): DocToMirror[] {
  const patterns = parseIngestPatterns(parseYaml(manifest ?? ""));
  const traced: DocToMirror[] = Object.entries(TRACED_KINDS).flatMap(
    ([ingestKind, kind]) =>
      selectIngestFiles(tree, ingestKind, {
        patterns: patterns[ingestKind],
      }).map((path) => ({ path, kind })),
  );
  const tracedPaths = new Set(traced.map((doc) => doc.path));
  const docs = tree
    .filter((path) => !tracedPaths.has(path) && isMarkdownDoc(path))
    .map((path) => ({ path, kind: "doc" as const }));

  return [...traced, ...docs];
}

const DOCUMENT_TYPES: ReadonlySet<string> = new Set(["doc", "spec", "adr"]);

/** A yaml doc is configuration with no headings or sentences to split into statements, so only markdown is mirrored; a spec or ADR CI does not trace (docs/specs/x.md) is still a document. */
function isMarkdownDoc(path: string): boolean {
  return path.endsWith(".md") && DOCUMENT_TYPES.has(classifyFile(path) ?? "");
}
