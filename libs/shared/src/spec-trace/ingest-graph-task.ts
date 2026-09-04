/** ingest-graph-task — deterministic, zero-LLM core turning specs/ADRs/tests into the spec-traceability graph; idempotent via content_hash (unchanged files tally as `skipped`). */

import { parse as parseYaml } from "yaml";
import type { SourceDocument } from "./project-blocks.js";
import type { ProjectionOptions } from "./project-spec-file.js";
import type { DgraphClientPort } from "./deps.js";
import { projectSpecFile } from "./project-spec-file.js";
import { projectAdrFile } from "./project-adr-file.js";
import { ingestSpecTrace } from "./ingest-spec-trace.js";
import { parseIngestPatterns, matchesAnyGlob } from "./ingest-patterns.js";
import {
  selectPruneCandidates,
  listGraphDocPaths,
  deleteSpecSubtree,
  deleteAdrSubtree,
} from "./prune-removed-docs.js";

/** Per-repo override of which files become specs/adrs; sibling of `.lore/test-commands.yml`. */
const INGEST_MANIFEST_PATH = ".lore/ingest.yml";

/** Reads `.lore/ingest.yml` and returns the kind's glob patterns, or undefined when absent/unreadable/undeclared (caller falls back to built-in prefix defaults). */
async function loadKindPatterns(
  ports: IngestGraphPorts,
  kind: IngestKind,
  ref?: string,
): Promise<string[] | undefined> {
  try {
    const raw = await ports.readFile(INGEST_MANIFEST_PATH, ref);

    return parseIngestPatterns(parseYaml(raw))[kind];
  } catch {
    return undefined;
  }
}

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

/** Files of `kind` in the tree, optionally narrowed by `glob`; `patterns` (from `.lore/ingest.yml`) REPLACES the built-in prefix/`.md` defaults when given. */
/** How an ingest narrows the tree: `glob` is a substring filter, `patterns` (from `.lore/ingest.yml`) REPLACE the kind's built-in prefix/`.md` defaults. */
export interface IngestScope {
  glob?: string;
  patterns?: string[];
}

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

function skippedSummary(kind: IngestKind, message: string): IngestGraphSummary {
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

async function ingestTestsKind(
  repo: string,
  dgraph: NonNullable<IngestGraphPorts["dgraph"]>,
  buildTestReport: IngestGraphPorts["buildTestReport"],
): Promise<IngestGraphSummary> {
  if (!buildTestReport) {
    return skippedSummary(
      "tests",
      "test ingest runs locally / in CI only (trusted sandbox)",
    );
  }
  const report = await buildTestReport();

  await ingestSpecTrace(dgraph, repo, "test-report", report);
  const count = Array.isArray((report as { tests?: unknown[] }).tests)
    ? (report as { tests: unknown[] }).tests.length
    : 0;

  return {
    kind: "tests",
    projected: count,
    skipped: 0,
    failed: 0,
    failedFiles: [],
    status: "completed",
    message: `tests: ingested ${count} test(s)`,
  };
}

interface ProjectFilesResult {
  projected: number;
  skipped: number;
  failedFiles: string[];
}

interface ProjectFilesContext {
  params: IngestGraphParams;
  ports: IngestGraphPorts;
  dgraph: NonNullable<IngestGraphPorts["dgraph"]>;
  def: IngestKindDef;
}

/** Projects one file, folding the outcome into `result` in place. */
async function projectOneFile(
  ctx: ProjectFilesContext,
  filePath: string,
  result: ProjectFilesResult,
): Promise<void> {
  const { params, ports, dgraph, def } = ctx;

  try {
    const content = await ports.readFile(filePath, params.ref);
    const projected = await def.project(
      { repo: params.repo, filePath, content },
      dgraph,
      { embed: ports.embed, force: params.force },
    );

    if (projected.projected) {
      result.projected += 1;

      return;
    }
    result.skipped += 1;
  } catch (err) {
    // Per-file isolation must NOT mean a silent failure — log the reason so a failed projection is debuggable from pod/runner logs.
    const reason =
      err instanceof Error ? (err.stack ?? err.message) : String(err);

    console.error(
      `[ingest-graph] ${params.kind} ${params.repo} :: ${filePath} failed to project: ${reason}`,
    );
    result.failedFiles.push(filePath);
  }
}

/** SEQUENTIAL on purpose: every file's projection upserts the shared Repo node, so an unbounded Promise.all causes Dgraph transaction conflicts at scale (a 100+-spec repo failed most files on the first pass). */
async function projectFiles(
  ctx: ProjectFilesContext,
  files: string[],
): Promise<ProjectFilesResult> {
  const result: ProjectFilesResult = {
    projected: 0,
    skipped: 0,
    failedFiles: [],
  };

  for (const filePath of files) {
    await projectOneFile(ctx, filePath, result);
  }

  return result;
}

interface RunKindIngestContext extends ProjectFilesContext {
  registry: Record<string, IngestKindDef>;
}

/** The known-kind path: select files, project them, prune disappeared docs, summarize. */
async function runKindIngest({
  params,
  ports,
  dgraph,
  def,
  registry,
}: RunKindIngestContext): Promise<IngestGraphSummary> {
  const patterns = await loadKindPatterns(ports, params.kind, params.ref);
  const files = selectIngestFiles(
    await ports.listTree(params.ref),
    params.kind,
    { glob: params.glob, patterns },
    registry,
  );
  const { projected, skipped, failedFiles } = await projectFiles(
    { params, ports, dgraph, def },
    files,
  );

  const pruned = await pruneDisappearedDocs(params, ports, registry, {
    def,
    files,
    patterns,
    allAttemptedFailed:
      projected === 0 && skipped === 0 && failedFiles.length > 0,
  });

  return summarizeIngest(params.kind, {
    attempted: files.length,
    projected,
    skipped,
    failedFiles,
    pruned,
  });
}

export async function runIngestGraph(
  params: IngestGraphParams,
  ports: IngestGraphPorts,
  registry: Record<string, IngestKindDef> = INGEST_KINDS,
): Promise<IngestGraphSummary> {
  if (!ports.dgraph) {
    return skippedSummary(
      params.kind,
      "Dgraph not configured (LORE_DGRAPH_HTTP unset)",
    );
  }

  if (params.kind === "tests") {
    return ingestTestsKind(params.repo, ports.dgraph, ports.buildTestReport);
  }

  const def = registry[params.kind];

  if (!def) {
    return skippedSummary(params.kind, `unknown ingest kind "${params.kind}"`);
  }

  return runKindIngest({ params, ports, dgraph: ports.dgraph, def, registry });
}

interface DeletePruneCandidatesContext {
  def: IngestKindDef;
  dgraph: NonNullable<IngestGraphPorts["dgraph"]>;
  repo: string;
  kind: IngestKind;
}

/** Deletes each candidate's subtree, logging (not throwing) on a per-file failure. Returns the count actually deleted. */
async function deletePruneCandidates(
  ctx: DeletePruneCandidatesContext,
  candidates: string[],
): Promise<number> {
  const { def, dgraph, repo, kind } = ctx;
  let pruned = 0;

  for (const filePath of candidates) {
    try {
      await def.prune!.deleteSubtree(dgraph, repo, filePath);
      pruned += 1;
    } catch (err) {
      const reason =
        err instanceof Error ? (err.stack ?? err.message) : String(err);

      console.error(
        `[ingest-graph] ${kind} ${repo} :: failed to prune ${filePath}: ${reason}`,
      );
    }
  }

  return pruned;
}

interface PruneRun {
  def: IngestKindDef;
  files: string[];
  patterns?: string[];
  allAttemptedFailed: boolean;
}

function prunePreflightSkipped(
  def: IngestKindDef,
  dgraph: IngestGraphPorts["dgraph"],
  run: PruneRun,
): boolean {
  return (
    !def.prune || !dgraph || run.files.length === 0 || run.allAttemptedFailed
  );
}

/** Deletes subtrees of graph docs whose files left the tree; skips on no prune seam/empty/suspicious selection/all-failed run/doc-list read error. INVARIANT: must run at the repo's default-branch HEAD (graph is branch-agnostic) — `lore-ingest.yml` enforces `branches: [main]`. */
async function pruneDisappearedDocs(
  params: IngestGraphParams,
  ports: IngestGraphPorts,
  registry: Record<string, IngestKindDef>,
  run: PruneRun,
): Promise<number | undefined> {
  if (prunePreflightSkipped(run.def, ports.dgraph, run)) {
    return undefined;
  }
  const { def, files, patterns } = run;
  const dgraph = ports.dgraph!;

  let graphDocPaths: string[];

  try {
    graphDocPaths = await def.prune!.listDocPaths(dgraph, params.repo);
  } catch (err) {
    const reason =
      err instanceof Error ? (err.stack ?? err.message) : String(err);

    console.error(
      `[ingest-graph] ${params.kind} ${params.repo} :: prune listing failed: ${reason}`,
    );

    // The list read failed, so the prune never ran — report "didn't run" (undefined), not a misleading "pruned 0".
    return undefined;
  }

  const isInScope = (path: string) =>
    selectIngestFiles(
      [path],
      params.kind,
      { glob: params.glob, patterns },
      registry,
    ).length === 1;

  const selection = selectPruneCandidates(
    graphDocPaths,
    files,
    isInScope,
    params.force,
  );

  if (selection.outcome === "refused-suspicious-tree") {
    console.error(
      `[ingest-graph] ${params.kind} ${params.repo} :: prune refused: suspicious tree read (${selection.candidateCount} of ${selection.inScopeDocCount} in-scope docs missing — rerun with force to override)`,
    );

    return undefined;
  }

  return deletePruneCandidates(
    { def, dgraph, repo: params.repo, kind: params.kind },
    selection.candidates,
  );
}
