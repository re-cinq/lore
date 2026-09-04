// Spec → Test Coverage Backfill Cron (v3): reuses the v2 judge pipeline but emits edits to spec.md via a PR per spec, not spec_test_links rows (dropped in v3). Runs weekly Mon 11:00 UTC.
import {
  dropIngestExcluded,
  segmentStatements,
  selectCandidates,
  argmaxByTest,
  deriveTestName,
  parseEmbedding,
  isTestFile,
  reassembleSpec,
  type TestChunk,
  type JudgeCandidate,
  type Judgment,
  type MatchKind,
  extractAssertions,
  type Project,
  type SpecChunkWithEmbedding,
} from "../index.js";
import { isAssertionSource } from "./spec-drift-rules.js";
import {
  pickStatementsForBackfill,
  proposeLinkInsertions,
  type Suggestion,
} from "./backfill-insertion.js";
import { judgeLink } from "./backfill-judge.js";
import { classifyAllStatements } from "./backfill-classifier.js";
import { buildLabel, openBackfillPr } from "./backfill-pr.js";

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

function firstChunkEmbedding(
  chunks: SpecChunkWithEmbedding[],
): SpecChunkWithEmbedding["embedding"] | undefined {
  const first = chunks[0];

  return first ? first.embedding : undefined;
}

// Judge each candidate against the un-linked testable subset.
async function judgeCandidates(
  specPath: string,
  content: string,
  unlinked: Array<{ ordinal: number; text: string }>,
  candidates: JudgeCandidate[],
): Promise<Judgment[]> {
  const judgments: Judgment[] = [];

  for (const candidate of candidates) {
    const verdict = await judgeLink(
      { file_path: specPath, content },
      unlinked,
      candidate,
    );

    judgments.push({
      test_file: candidate.test_file,
      test_name: candidate.test_name,
      test_line: candidate.test_line,
      symbol: candidate.symbol,
      match_kind: candidate.match_kind as MatchKind,
      ...verdict,
    });
  }

  return judgments;
}

// Build Suggestion[] from confirmed judgments + the unlinked text map.
function buildSuggestionsFromJudgments(
  confirmed: Judgment[],
  unlinked: Array<{ ordinal: number; text: string }>,
): Suggestion[] {
  const textByOrdinal = new Map(unlinked.map((u) => [u.ordinal, u.text]));

  return confirmed
    .filter(
      (j) =>
        j.statement_ordinal !== null && textByOrdinal.has(j.statement_ordinal),
    )
    .map((j) => ({
      statement_ordinal: j.statement_ordinal as number,
      statement_text: textByOrdinal.get(
        j.statement_ordinal as number,
      ) as string,
      test_file: j.test_file,
      test_line: j.test_line,
      label: buildLabel(j.test_file, j.test_line),
    }));
}

async function runBackfillForSpec(
  project: Project,
  repo: string,
  {
    path: specPath,
    chunks,
  }: { path: string; chunks: SpecChunkWithEmbedding[] },
  codeChunks: TestChunk[],
): Promise<SpecBackfillSummary> {
  const content = reassembleSpec(
    chunks.map((c) => ({
      content: c.content,
      ingested_at: c.ingestedAt,
      chunk_index: c.chunkIndex,
    })),
  );
  const statements = segmentStatements(content);
  const classifications = await classifyAllStatements(specPath, statements);

  const unlinked = pickStatementsForBackfill(statements, classifications);

  if (unlinked.length === 0) {
    return { suggestions: 0, prUrl: null };
  }

  const assertions = await extractAssertions(content, specPath, {
    jobName: "spec_coverage_backfill",
  });
  const specEmbedding = parseEmbedding(firstChunkEmbedding(chunks));
  const { candidates } = selectCandidates(
    { repo, file_path: specPath, content, embedding: specEmbedding },
    assertions,
    codeChunks,
  );

  if (candidates.length === 0) {
    return { suggestions: 0, prUrl: null };
  }

  const judgments = await judgeCandidates(
    specPath,
    content,
    unlinked,
    candidates,
  );
  const confirmed = argmaxByTest(judgments);

  if (confirmed.length === 0) {
    return { suggestions: 0, prUrl: null };
  }

  const suggestions = buildSuggestionsFromJudgments(confirmed, unlinked);

  if (suggestions.length === 0) {
    return { suggestions: 0, prUrl: null };
  }

  const { newContent, diffPreview, applied } = proposeLinkInsertions(
    content,
    suggestions,
  );

  if (applied === 0) {
    return { suggestions: 0, prUrl: null };
  }

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
