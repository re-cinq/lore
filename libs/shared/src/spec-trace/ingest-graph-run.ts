/** ingest-graph execution — walks a kind's selected files through projection, then prunes graph docs whose files disappeared from the tree. */

import { parse as parseYaml } from "yaml";
import { ingestSpecTrace } from "./ingest-spec-trace.js";
import { parseIngestPatterns } from "./ingest-patterns.js";
import { selectPruneCandidates } from "./prune-removed-docs.js";
import {
  selectIngestFiles,
  summarizeIngest,
  type IngestGraphParams,
  type IngestGraphPorts,
  type IngestGraphSummary,
  type IngestKind,
  type IngestKindDef,
} from "./ingest-graph-task.js";

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

export async function ingestTestsKind(
  repo: string,
  dgraph: NonNullable<IngestGraphPorts["dgraph"]>,
  buildTestReport: IngestGraphPorts["buildTestReport"],
): Promise<IngestGraphSummary> {
  if (!buildTestReport) {
    return {
      kind: "tests",
      projected: 0,
      skipped: 0,
      failed: 0,
      failedFiles: [],
      status: "skipped",
      message: "test ingest runs locally / in CI only (trusted sandbox)",
    };
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
export async function runKindIngest({
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
