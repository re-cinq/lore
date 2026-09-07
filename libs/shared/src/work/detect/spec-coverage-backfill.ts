// Spec → Test Coverage Backfill Cron (v3): reuses the v2 judge pipeline but emits edits to spec.md via a PR per spec, not spec_test_links rows (dropped in v3). Runs weekly Mon 11:00 UTC.
import { dropIngestExcluded } from "../../domain/content-classify.js";
import {
  deriveTestName,
  parseEmbedding,
  type TestChunk,
} from "../../domain/spec-judge.js";
import { isTestFile } from "../../domain/test-paths.js";
import { type SpecChunkWithEmbedding } from "../../outbound/project/chunks/chunks-port.js";
import { type Project } from "../../outbound/project/lib/project.js";
import { isAssertionSource } from "./spec-drift-rules.js";
import { openBackfillPr } from "./backfill-pr.js";

export {
  pickStatementsForBackfill,
  proposeLinkInsertions,
  type Suggestion,
  type SkipReason,
  type InsertionResult,
} from "./backfill-insertion.js";

// ── Orchestration (per repo, via the Project facade) ────────────────

function toLine(metadata: Record<string, unknown> | null): number | null {
  const raw = metadata?.["start_line"];

  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }

  const line = typeof raw === "string" ? Number(raw) : raw;

  return Number.isFinite(line) ? line : null;
}

export interface BackfillOptions {
  /** The repo this run covers (per-repo fan-out / manual single-repo run). */
  repoFilter: string;
  /** Limit to a single spec path within the repo. */
  specPathFilter?: string;
  /** Data facade — projectFor(repo) on the Floor, createStationProject(env) in a pod. */
  project: Project;
}

function resolveSpecsToProcess(
  specRows: SpecChunkWithEmbedding[],
  specPathFilter: string | undefined,
): SpecChunkWithEmbedding[] {
  if (!specPathFilter) {
    return specRows;
  }

  return specRows.filter((s) => s.filePath === specPathFilter);
}

// Group spec chunks by file_path for reassembly.
function groupSpecsByPath(
  specs: SpecChunkWithEmbedding[],
): Map<string, SpecChunkWithEmbedding[]> {
  const byPath = new Map<string, SpecChunkWithEmbedding[]>();

  for (const s of specs) {
    const list = byPath.get(s.filePath) ?? [];

    list.push(s);
    byPath.set(s.filePath, list);
  }

  return byPath;
}

interface BackfillOneSpecArgs {
  project: Project;
  repo: string;
  specPath: string;
  chunks: SpecChunkWithEmbedding[];
  codeChunks: TestChunk[];
}

async function backfillOneSpec(
  args: BackfillOneSpecArgs,
): Promise<SpecBackfillSummary | null> {
  const { project, repo, specPath, chunks, codeChunks } = args;

  if (!isAssertionSource(specPath)) {
    return null;
  }

  try {
    const summary = await runBackfillForSpec(
      project,
      repo,
      { path: specPath, chunks },
      codeChunks,
    );

    console.log(
      `[job] spec-coverage-backfill: ${repo}:${specPath} — ${summary.suggestions} suggestions, ${summary.prUrl || "no PR"}`,
    );

    return summary;
  } catch (err) {
    console.error(
      `[job] spec-coverage-backfill: error on ${repo}:${specPath}:`,
      err,
    );

    return null;
  }
}

export async function specCoverageBackfillJob(
  opts: BackfillOptions,
): Promise<string> {
  const repo = opts.repoFilter;
  const project = opts.project;

  // Skip chunks today's ingest policy refuses — stale pre-exclusion debris must not receive suggested links (#1018).
  const specRows = dropIngestExcluded(
    await project.chunks.specChunksForBackfill(),
  );
  const specs = resolveSpecsToProcess(specRows, opts.specPathFilter);

  if (specs.length === 0) {
    console.log(`[job] spec-coverage-backfill: no specs for ${repo}`);

    return "No specs found";
  }

  // Test chunks loaded once per repo and reused for every spec.
  const codeChunks = await buildTestChunks(project);
  const byPath = groupSpecsByPath(specs);

  let totalSpecs = 0;
  let totalSuggestions = 0;
  let totalPrsOpened = 0;

  for (const [specPath, chunks] of byPath) {
    const summary = await backfillOneSpec({
      project,
      repo,
      specPath,
      chunks,
      codeChunks,
    });

    if (!summary) {
      continue;
    }
    totalSpecs++;
    totalSuggestions += summary.suggestions;

    if (summary.prUrl) {
      totalPrsOpened++;
    }
  }

  const out = `Backfill: ${totalSpecs} specs in ${repo} — ${totalSuggestions} suggestions, ${totalPrsOpened} PRs opened`;

  console.log(`[job] spec-coverage-backfill: ${out}`);

  return out;
}

async function buildTestChunks(project: Project): Promise<TestChunk[]> {
  const rows = dropIngestExcluded(await project.chunks.codeChunksForBackfill());

  return rows
    .filter((r) => isTestFile(r.filePath))
    .map((r) => ({
      file_path: r.filePath,
      content: r.content,
      test_name: deriveTestName(r.metadata) ?? "",
      test_line: toLine(r.metadata),
      embedding: parseEmbedding(r.embedding),
    }))
    .filter((c) => c.test_name.length > 0);
}

interface SpecBackfillSummary {
  suggestions: number;
  prUrl: string | null;
}

// Judge each candidate against the un-linked testable subset.

// Build Suggestion[] from confirmed judgments + the unlinked text map.

import {
  findBackfillCandidates,
  judgeAndCompose,
} from "./spec-coverage-suggest.js";

async function runBackfillForSpec(
  project: Project,
  repo: string,
  {
    path: specPath,
    chunks,
  }: { path: string; chunks: SpecChunkWithEmbedding[] },
  codeChunks: TestChunk[],
): Promise<SpecBackfillSummary> {
  const found = await findBackfillCandidates(
    repo,
    specPath,
    chunks,
    codeChunks,
  );

  if (!found) {
    return { suggestions: 0, prUrl: null };
  }
  const { content } = found;

  const judged = await judgeAndCompose(specPath, content, found);

  if (!judged) {
    return { suggestions: 0, prUrl: null };
  }
  const { newContent, diffPreview, applied, confirmed } = judged;

  const prUrl = await openBackfillPr({
    project,
    repo,
    specPath,
    newContent,
    applied,
    confirmed,
    diffPreview,
  });

  return { suggestions: applied, prUrl };
}
