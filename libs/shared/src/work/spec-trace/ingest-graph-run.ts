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
} from "./ingest-graph-registry.js";

/** Per-repo override of which files become specs/adrs; sibling of `.lore/test-commands.yml`. */
const INGEST_MANIFEST_PATH = ".lore/ingest.yml";

export async function ingestTestsKind(
  repo: string,
  dgraph: NonNullable<IngestGraphPorts["dgraph"]>,
  buildTestReport: IngestGraphPorts["buildTestReport"],
): Promise<IngestGraphSummary> {
  // No builder means this process is not a trusted sandbox: test ingest RUNS the repo's suite, so it belongs to CI and the developer's machine, never the shared server.
  if (!buildTestReport) {
    return testsSummary(
      0,
      "skipped",
      "test ingest runs locally / in CI only (trusted sandbox)",
    );
  }
  const report = await buildTestReport();

  await ingestSpecTrace(dgraph, repo, "test-report", report);
  const count = Array.isArray((report as { tests?: unknown[] }).tests)
    ? (report as { tests: unknown[] }).tests.length
    : 0;

  return testsSummary(count, "completed", `tests: ingested ${count} test(s)`);
}

/** A tests-kind summary. `failed` and `failedFiles` are always empty here on purpose: a test report is ingested whole or not at all, so there is no per-file failure to report the way a doc projection has. */
function testsSummary(
  projected: number,
  status: IngestGraphSummary["status"],
  message: string,
): IngestGraphSummary {
  return {
    kind: "tests",
    projected,
    skipped: 0,
    failed: 0,
    failedFiles: [],
    status,
    message,
  };
}

interface RunKindIngestContext extends ProjectFilesContext {
  registry: Record<string, IngestKindDef>;
}

/** The known-kind path: select files, project them, prune disappeared docs, summarize. */
export async function runKindIngest(
  ctx: RunKindIngestContext,
): Promise<IngestGraphSummary> {
  const { params, ports, dgraph, def, registry } = ctx;
  const selected = await selectFiles(params, ports, registry);
  const result = await projectFiles(
    { params, ports, dgraph, def },
    selected.files,
  );
  const pruned = await pruneAfterProjection(ctx, selected, result);

  return summarizeIngest(params.kind, {
    attempted: selected.files.length,
    ...result,
    pruned,
  });
}

/** The files this kind ingests at this ref, and the patterns that chose them. The patterns are returned alongside because the prune needs the SAME scope test — a doc is only a prune candidate if it would have been ingested. */
async function selectFiles(
  params: IngestGraphParams,
  ports: IngestGraphPorts,
  registry: Record<string, IngestKindDef>,
): Promise<{
  files: string[];
  patterns: Awaited<ReturnType<typeof loadKindPatterns>>;
}> {
  const patterns = await loadKindPatterns(ports, params.kind, params.ref);

  return {
    patterns,
    files: selectIngestFiles(
      await ports.listTree(params.ref),
      params.kind,
      { glob: params.glob, patterns },
      registry,
    ),
  };
}

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

/** Projects one file, folding the outcome into `result` in place. */
async function projectOneFile(
  ctx: ProjectFilesContext,
  filePath: string,
  result: ProjectFilesResult,
): Promise<void> {
  const { params } = ctx;

  try {
    if (await projectFileContent(ctx, filePath)) {
      result.projected += 1;

      return;
    }
    result.skipped += 1;
  } catch (err) {
    // Per-file isolation must NOT mean a silent failure — log the reason the projection failed.
    console.error(
      `[ingest-graph] ${params.kind} ${params.repo} :: ${filePath} failed to project: ${errorReason(err)}`,
    );
    result.failedFiles.push(filePath);
  }
}

/** Reads and projects one file; true when the graph actually changed, false when the projection found it unchanged. */
async function projectFileContent(
  ctx: ProjectFilesContext,
  filePath: string,
): Promise<boolean> {
  const { params, ports, dgraph, def } = ctx;
  const content = await ports.readFile(filePath, params.ref);
  const outcome = await def.project(
    { repo: params.repo, filePath, content },
    dgraph,
    { embed: ports.embed, force: params.force },
  );

  return outcome.projected;
}

/** `allAttemptedFailed` is the prune's safety catch: if EVERY projection failed, the tree read is suspect, and pruning against it would delete docs that are still there. */
async function pruneAfterProjection(
  ctx: RunKindIngestContext,
  selected: { files: string[]; patterns?: string[] },
  result: ProjectFilesResult,
): Promise<number | undefined> {
  const { params, ports, registry, def } = ctx;
  const { projected, skipped, failedFiles } = result;

  return pruneDisappearedDocs(params, ports, registry, {
    def,
    files: selected.files,
    patterns: selected.patterns,
    allAttemptedFailed:
      projected === 0 && skipped === 0 && failedFiles.length > 0,
  });
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
  const dgraph = ports.dgraph!;
  const candidates = await selectPruneTargets(params, dgraph, registry, run);

  if (candidates === undefined) {
    return undefined;
  }

  return deletePruneCandidates(
    { def: run.def, dgraph, repo: params.repo, kind: params.kind },
    candidates,
  );
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

/** The doc paths this run may delete, or undefined when the prune could not safely decide — a failed doc listing or a tree read too suspicious to act on. */
async function selectPruneTargets(
  params: IngestGraphParams,
  dgraph: NonNullable<IngestGraphPorts["dgraph"]>,
  registry: Record<string, IngestKindDef>,
  run: PruneRun,
): Promise<string[] | undefined> {
  const { def, files, patterns } = run;
  const graphDocPaths = await listGraphDocs(def, dgraph, params);

  if (graphDocPaths === undefined) {
    return undefined;
  }
  const selection = chooseCandidates(
    { params, registry, patterns },
    graphDocPaths,
    files,
  );

  return refusedSuspiciousTree(selection, params)
    ? undefined
    : selection.candidates;
}

/** The docs the graph currently holds, or undefined when the listing itself failed. That distinction matters: a failed read means the prune NEVER RAN, and reporting "pruned 0" instead would look like a clean pass over a graph nobody checked. */
async function listGraphDocs(
  def: IngestKindDef,
  dgraph: NonNullable<IngestGraphPorts["dgraph"]>,
  params: IngestGraphParams,
): Promise<string[] | undefined> {
  try {
    return await def.prune!.listDocPaths(dgraph, params.repo);
  } catch (err) {
    console.error(
      `[ingest-graph] ${params.kind} ${params.repo} :: prune listing failed: ${errorReason(err)}`,
    );

    return undefined;
  }
}

/** Which graph docs no longer exist in the tree. A doc counts only if it is IN SCOPE for this kind and glob — the same test that selected the files — or a narrowed run would prune everything it did not happen to look at. */
function chooseCandidates(
  scope: {
    params: IngestGraphParams;
    registry: Record<string, IngestKindDef>;
    patterns: PruneRun["patterns"];
  },
  graphDocPaths: string[],
  files: string[],
): ReturnType<typeof selectPruneCandidates> {
  const { params, registry, patterns } = scope;
  const scopeOpts = { glob: params.glob, patterns };
  const isInScope = (path: string) =>
    selectIngestFiles([path], params.kind, scopeOpts, registry).length === 1;

  return selectPruneCandidates(
    graphDocPaths,
    files,
    isInScope,
    params.force ? "forced" : "guarded",
  );
}

/** A tree read that lost most of its in-scope docs is a FAILED read, not a mass deletion — a shallow clone or a bad ref looks exactly like every spec disappearing at once. Refused rather than pruned, with the counts, so the operator can override deliberately. */
function refusedSuspiciousTree(
  selection: ReturnType<typeof selectPruneCandidates>,
  params: IngestGraphParams,
): selection is Extract<
  ReturnType<typeof selectPruneCandidates>,
  { outcome: "refused-suspicious-tree" }
> {
  if (selection.outcome !== "refused-suspicious-tree") {
    return false;
  }
  console.error(
    `[ingest-graph] ${params.kind} ${params.repo} :: prune refused: suspicious tree read (${selection.candidateCount} of ${selection.inScopeDocCount} in-scope docs missing — rerun with force to override)`,
  );

  return true;
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
      console.error(
        `[ingest-graph] ${kind} ${repo} :: failed to prune ${filePath}: ${errorReason(err)}`,
      );
    }
  }

  return pruned;
}

/** An error's stack when it carries one, so a swallowed per-file failure is still debuggable from pod/runner logs. */
function errorReason(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
