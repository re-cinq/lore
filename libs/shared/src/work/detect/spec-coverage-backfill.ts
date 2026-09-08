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
import { groupChunksByPath } from "../spec-summary.js";
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

interface BackfillOneSpecArgs {
  project: Project;
  repo: string;
  specPath: string;
  chunks: SpecChunkWithEmbedding[];
  codeChunks: TestChunk[];
}

/** One spec's backfill plus the line that says what came of it; the log is here so the caller's catch stays about failure only. */
async function backfillAndLog(
  args: BackfillOneSpecArgs,
): Promise<SpecBackfillSummary> {
  const { project, repo, specPath, chunks, codeChunks } = args;
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
}

async function backfillOneSpec(
  args: BackfillOneSpecArgs,
): Promise<SpecBackfillSummary | null> {
  if (!isAssertionSource(args.specPath)) {
    return null;
  }

  try {
    return await backfillAndLog(args);
  } catch (err) {
    console.error(
      `[job] spec-coverage-backfill: error on ${args.repo}:${args.specPath}:`,
      err,
    );

    return null;
  }
}

/** The specs this run may suggest links for. Chunks today's ingest policy would refuse are dropped: stale pre-exclusion debris must not receive suggested links, which would then be reviewed and merged into files nobody ingests any more (#1018). */
async function specsToBackfill(
  project: Project,
  specPathFilter: BackfillOptions["specPathFilter"],
) {
  return resolveSpecsToProcess(
    dropIngestExcluded(await project.chunks.specChunksForBackfill()),
    specPathFilter,
  );
}

/** Runs the backfill for each spec and tallies what came of it. A spec that produced nothing is NOT counted: "0 specs, 0 suggestions" and "40 specs, 0 suggestions" say different things about a repo, and only the second means the job looked and found nothing to suggest. */
async function backfillEach(
  byPath: Map<string, SpecChunkWithEmbedding[]>,
  ctx: { project: Project; repo: string; codeChunks: TestChunk[] },
): Promise<{ specs: number; suggestions: number; prs: number }> {
  const tally = { specs: 0, suggestions: 0, prs: 0 };

  for (const [specPath, chunks] of byPath) {
    const summary = await backfillOneSpec({ ...ctx, specPath, chunks });

    if (summary) {
      tally.specs++;
      tally.suggestions += summary.suggestions;
      tally.prs += summary.prUrl ? 1 : 0;
    }
  }

  return tally;
}

export async function specCoverageBackfillJob(
  opts: BackfillOptions,
): Promise<string> {
  const repo = opts.repoFilter;
  const project = opts.project;

  const specs = await specsToBackfill(project, opts.specPathFilter);

  if (specs.length === 0) {
    console.log(`[job] spec-coverage-backfill: no specs for ${repo}`);

    return "No specs found";
  }

  // Test chunks loaded once per repo and reused for every spec.
  const codeChunks = await buildTestChunks(project);
  const byPath = groupChunksByPath(specs);

  const tally = await backfillEach(byPath, { project, repo, codeChunks });
  const out = `Backfill: ${tally.specs} specs in ${repo} — ${tally.suggestions} suggestions, ${tally.prs} PRs opened`;

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

// Two gates before a PR: candidates must be FOUND, then each must survive the judge. A suggestion nobody vouched for costs a reviewer more than it saves.
async function judgeSpec(
  repo: string,
  spec: { path: string; chunks: SpecChunkWithEmbedding[] },
  codeChunks: TestChunk[],
) {
  const found = await findBackfillCandidates(
    repo,
    spec.path,
    spec.chunks,
    codeChunks,
  );

  return found ? judgeAndCompose(spec.path, found.content, found) : null;
}

async function runBackfillForSpec(
  project: Project,
  repo: string,
  spec: { path: string; chunks: SpecChunkWithEmbedding[] },
  codeChunks: TestChunk[],
): Promise<SpecBackfillSummary> {
  const judged = await judgeSpec(repo, spec, codeChunks);

  if (!judged) {
    return { suggestions: 0, prUrl: null };
  }
  const specPath = spec.path;

  return {
    suggestions: judged.applied,
    prUrl: await openBackfillPr({ project, repo, specPath, ...judged }),
  };
}
