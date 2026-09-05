/** ingest-graph shared shape — kind registry, file selection, and summary building shared by ingest-graph-task.ts (the orchestrator) and ingest-graph-run.ts (the per-kind executor). */

import type { SourceDocument } from "./project-blocks.js";
import type { ProjectionOptions } from "./project-spec-file.js";
import type { DgraphClientPort } from "./deps.js";
import { projectSpecFile } from "./project-spec-file.js";
import { projectAdrFile } from "./project-adr-file.js";
import { matchesAnyGlob } from "./ingest-patterns.js";
import {
  listGraphDocPaths,
  deleteSpecSubtree,
  deleteAdrSubtree,
} from "./prune-removed-docs.js";

/** Kind of artifact to ingest. Extensible — driven by {@link INGEST_KINDS}. */
export type IngestKind = string;

export interface IngestGraphParams {
  kind: IngestKind;
  repo: string;
  ref?: string;
  glob?: string;
  /** Bypass each file's content-hash freshness gate — re-project unchanged files (e.g. after a parser/segmenter change). */
  force?: boolean;
}

export interface IngestGraphSummary {
  kind: IngestKind;
  projected: number;
  skipped: number;
  failed: number;
  failedFiles: string[];
  /** Whole-file subtrees deleted for disappeared files; absent when the prune didn't run (no seam, empty selection, all-failed run, failed doc-list read, or suspicious-tree refusal). */
  pruned?: number;
  status: "completed" | "skipped" | "failed";
  message: string;
}

/** Injected runtime — the only thing that differs cluster-vs-local. */
export interface IngestGraphPorts {
  dgraph: DgraphClientPort | null;
  listTree(ref?: string): Promise<string[]>;
  readFile(path: string, ref?: string): Promise<string>;
  buildTestReport?: () => Promise<unknown>;
  /** Statement embedder passed to each kind's project; omitted = the projector's default (Vertex via GCP ADC, absent in station pods). */
  embed?: (text: string) => Promise<number[] | null>;
}

/** One file-projectable kind: how to discover its files + how to project one. */
export interface IngestKindDef {
  prefixes: string[];
  project(
    doc: SourceDocument,
    dgraph: DgraphClientPort,
    options?: ProjectionOptions,
  ): Promise<{ projected: boolean }>;
  runsOn: "runner+local" | "local-only";
  /** Whole-file pruning: how to list this kind's graph docs + delete one subtree. Absent = disappeared files are never pruned. */
  prune?: {
    listDocPaths(dgraph: DgraphClientPort, repo: string): Promise<string[]>;
    deleteSubtree(
      dgraph: DgraphClientPort,
      repo: string,
      filePath: string,
    ): Promise<void>;
  };
}

/** The seed kind registry — specs/adrs are markdown file-projectable; tests is special-cased in runIngestGraph; CodeChunks are coverage-defined (minted by ingestCoverageReport), not an ingest kind. */
export const INGEST_KINDS: Record<string, IngestKindDef> = {
  specs: {
    prefixes: ["specs/", ".specify/"],
    project: projectSpecFile,
    runsOn: "runner+local",
    prune: {
      listDocPaths: (dgraph, repo) => listGraphDocPaths(dgraph, "Spec", repo),
      deleteSubtree: deleteSpecSubtree,
    },
  },
  adrs: {
    prefixes: ["adrs/"],
    project: projectAdrFile,
    runsOn: "runner+local",
    prune: {
      listDocPaths: (dgraph, repo) => listGraphDocPaths(dgraph, "ADR", repo),
      deleteSubtree: deleteAdrSubtree,
    },
  },
};

/** The directory glob a single markdown path chunks into for `def`, or undefined when the path isn't one of this kind's files. */
function chunkGlobForPath(
  path: string,
  def: IngestKindDef,
): string | undefined {
  if (!path.endsWith(".md")) {
    return undefined;
  }
  const prefix = def.prefixes.find((p) => path.startsWith(p));

  if (!prefix) {
    return undefined;
  }
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf("/");

  return slash === -1 ? prefix : `${prefix}${rest.slice(0, slash + 1)}`;
}

/** Per-directory chunk globs for a kind's files, so a forced full-repo re-embed (which outlives the event bus's stuck-row timeout as one event) can be split into per-glob chunks that finish in seconds. */
export function chunkGlobsForKind(
  kind: string,
  tree: string[],
  registry: Record<string, IngestKindDef> = INGEST_KINDS,
): string[] {
  const def = registry[kind];

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- kind is a caller-controlled string; registry[kind] is undefined for an unknown kind
  if (!def) {
    return [];
  }
  const globs = new Set<string>();

  for (const path of tree) {
    const glob = chunkGlobForPath(path, def);

    if (glob) {
      globs.add(glob);
    }
  }

  return [...globs].sort();
}

/** How an ingest narrows the tree: `glob` is a substring filter, `patterns` (from `.lore/ingest.yml`) REPLACE the kind's built-in prefix/`.md` defaults. */
export interface IngestScope {
  glob?: string;
  patterns?: string[];
}

/** Files of `kind` in the tree, optionally narrowed by `glob`; `patterns` (from `.lore/ingest.yml`) REPLACES the built-in prefix/`.md` defaults when given. */
export function selectIngestFiles(
  tree: string[],
  kind: IngestKind,
  { glob, patterns }: IngestScope = {},
  registry: Record<string, IngestKindDef> = INGEST_KINDS,
): string[] {
  if (patterns && patterns.length > 0) {
    return tree.filter(
      (path) =>
        matchesAnyGlob(path, patterns) && (!glob || path.includes(glob)),
    );
  }
  const def = registry[kind];

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- kind is a caller-controlled string; registry[kind] is undefined for an unknown kind
  if (!def) {
    return [];
  }

  return tree.filter(
    (path) =>
      path.endsWith(".md") &&
      def.prefixes.some((prefix) => path.startsWith(prefix)) &&
      (!glob || path.includes(glob)),
  );
}

/** Builds the run summary. `failed` only fails the task when EVERY attempted file failed; a partial failure stays `completed`. */
export interface IngestCounts {
  attempted: number;
  projected: number;
  skipped: number;
  failedFiles: string[];
  pruned?: number;
}

function ingestStatus(
  attempted: number,
  allAttemptedFailed: boolean,
): IngestGraphSummary["status"] {
  return attempted > 0 && allAttemptedFailed ? "failed" : "completed";
}

function ingestMessage(
  kind: IngestKind,
  status: IngestGraphSummary["status"],
  counts: IngestCounts & { failed: number },
): string {
  if (status === "failed") {
    return `${kind}: all ${counts.attempted} file(s) failed to project`;
  }
  const prunedSuffix =
    counts.pruned !== undefined ? `, pruned ${counts.pruned}` : "";

  return `${kind}: projected ${counts.projected}, skipped ${counts.skipped}, failed ${counts.failed}${prunedSuffix}`;
}

export function summarizeIngest(
  kind: IngestKind,
  counts: IngestCounts,
): IngestGraphSummary {
  const { attempted, projected, skipped, failedFiles, pruned } = counts;
  const failed = failedFiles.length;
  const allAttemptedFailed = projected === 0 && skipped === 0 && failed > 0;
  const status = ingestStatus(attempted, allAttemptedFailed);
  const message = ingestMessage(kind, status, { ...counts, failed });

  return {
    kind,
    projected,
    skipped,
    failed,
    failedFiles,
    ...(pruned !== undefined ? { pruned } : {}),
    status,
    message,
  };
}

export function skippedSummary(
  kind: IngestKind,
  message: string,
): IngestGraphSummary {
  return {
    kind,
    projected: 0,
    skipped: 0,
    failed: 0,
    failedFiles: [],
    status: "skipped",
    message,
  };
}
