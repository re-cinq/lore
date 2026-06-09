/**
 * ingest-graph-task — the deterministic, zero-LLM core that turns a repo's
 * specs / ADRs / tests into the spec-traceability graph. The agent worker
 * (cluster) and the local MCP runner both just CALL `runIngestGraph`; only the
 * injected runtime differs (content source + dgraph client + the LORE_DB_HOST
 * trust context). Idempotent by construction: `projectSpecFile`/`projectAdrFile`
 * return `{ projected: false }` when the file's `content_hash` is unchanged, so a
 * no-change re-run is a pure no-op (tallied as `skipped`).
 */

import type { DgraphClientPort } from "./deps.js";
import { projectSpecFile } from "./project-spec-file.js";
import { projectAdrFile } from "./project-adr-file.js";
import { ingestSpecTrace } from "./ingest-spec-trace.js";

/** Kind of artifact to ingest. Extensible — driven by {@link INGEST_KINDS}. */
export type IngestKind = string;

export interface IngestGraphParams {
  kind: IngestKind;
  repo: string;
  ref?: string;
  glob?: string;
}

export interface IngestGraphSummary {
  kind: IngestKind;
  projected: number;
  skipped: number;
  failed: number;
  failedFiles: string[];
  status: "completed" | "skipped" | "failed";
  message: string;
}

/** Injected runtime — the only thing that differs cluster-vs-local. */
export interface IngestGraphPorts {
  dgraph: DgraphClientPort | null;
  listTree(ref?: string): Promise<string[]>;
  readFile(path: string, ref?: string): Promise<string>;
  buildTestReport?: () => Promise<unknown>;
}

/** One file-projectable kind: how to discover its files + how to project one. */
export interface IngestKindDef {
  prefixes: string[];
  project(repo: string, filePath: string, content: string, dgraph: DgraphClientPort): Promise<{ projected: boolean }>;
  runsOn: "runner+local" | "local-only";
}

/**
 * The seed kind registry. specs/adrs are file-projectable; tests is special
 * (runs the test interface, not a per-file projection — handled in
 * runIngestGraph). MORE kinds (code, coverage, docs) slot in as one entry here.
 */
export const INGEST_KINDS: Record<string, IngestKindDef> = {
  specs: { prefixes: ["specs/", ".specify/"], project: projectSpecFile, runsOn: "runner+local" },
  adrs: { prefixes: ["adrs/"], project: projectAdrFile, runsOn: "runner+local" },
};

/** Files of `kind` in the tree: markdown under one of the kind's prefixes (optionally narrowed by `glob` substring). */
export function selectIngestFiles(
  tree: string[],
  kind: IngestKind,
  glob?: string,
  registry: Record<string, IngestKindDef> = INGEST_KINDS,
): string[] {
  const def = registry[kind];
  if (!def) return [];
  return tree.filter(
    (path) =>
      path.endsWith(".md") &&
      def.prefixes.some((prefix) => path.startsWith(prefix)) &&
      (!glob || path.includes(glob)),
  );
}

/** Builds the run summary. `failed` only fails the task when EVERY attempted file failed; a partial failure stays `completed`. */
export function summarizeIngest(
  kind: IngestKind,
  attempted: number,
  projected: number,
  skipped: number,
  failedFiles: string[],
): IngestGraphSummary {
  const failed = failedFiles.length;
  const status: IngestGraphSummary["status"] =
    attempted > 0 && projected === 0 && skipped === 0 && failed > 0 ? "failed" : "completed";
  const message =
    status === "failed"
      ? `${kind}: all ${attempted} file(s) failed to project`
      : `${kind}: projected ${projected}, skipped ${skipped}, failed ${failed}`;
  return { kind, projected, skipped, failed, failedFiles, status, message };
}

function skippedSummary(kind: IngestKind, message: string): IngestGraphSummary {
  return { kind, projected: 0, skipped: 0, failed: 0, failedFiles: [], status: "skipped", message };
}

export async function runIngestGraph(
  params: IngestGraphParams,
  ports: IngestGraphPorts,
  registry: Record<string, IngestKindDef> = INGEST_KINDS,
): Promise<IngestGraphSummary> {
  if (!ports.dgraph) {
    return skippedSummary(params.kind, "Dgraph not configured (LORE_DGRAPH_HTTP unset)");
  }

  if (params.kind === "tests") {
    if (!ports.buildTestReport) {
      return skippedSummary("tests", "test ingest runs locally / in CI only (trusted sandbox)");
    }
    const report = await ports.buildTestReport();
    await ingestSpecTrace(ports.dgraph, params.repo, "test-report", report);
    const count = Array.isArray((report as { tests?: unknown[] }).tests) ? (report as { tests: unknown[] }).tests.length : 0;
    return { kind: "tests", projected: count, skipped: 0, failed: 0, failedFiles: [], status: "completed", message: `tests: ingested ${count} test(s)` };
  }

  const def = registry[params.kind];
  if (!def) return skippedSummary(params.kind, `unknown ingest kind "${params.kind}"`);

  const files = selectIngestFiles(await ports.listTree(params.ref), params.kind, params.glob, registry);
  // SEQUENTIAL on purpose: every file's projection upserts the shared Repo node,
  // so running them through one unbounded Promise.all causes Dgraph transaction
  // conflicts at scale (a 100+-spec repo failed most files on the first pass).
  // Per-file failures are isolated so one bad file never aborts the batch.
  let projected = 0;
  let skipped = 0;
  const failedFiles: string[] = [];
  for (const filePath of files) {
    try {
      const content = await ports.readFile(filePath, params.ref);
      const result = await def.project(params.repo, filePath, content, ports.dgraph);
      if (result.projected) projected += 1;
      else skipped += 1;
    } catch {
      failedFiles.push(filePath);
    }
  }
  return summarizeIngest(params.kind, files.length, projected, skipped, failedFiles);
}
