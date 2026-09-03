// Spec → Test Coverage Backfill Cron (v3): reuses the v2 judge pipeline but emits edits to spec.md via a PR per spec, not spec_test_links rows (dropped in v3). Runs weekly Mon 11:00 UTC.
import {
  dropIngestExcluded,
  parseTestLinksInStatement,
  segmentStatements,
  buildIntroOrdinals,
  classifyByHeuristic,
  selectCandidates,
  argmaxByTest,
  deriveTestName,
  parseEmbedding,
  isTestFile,
  reassembleSpec,
  type Statement,
  type Classification,
  type UntestableCategory,
  type TestChunk,
  type JudgeCandidate,
  type Judgment,
  type MatchKind,
  extractAssertions,
  type Project,
  type SpecChunkWithEmbedding,
} from "../index.js";
import { Llm } from "../index.js";
import { isAssertionSource } from "./spec-drift-rules.js";

// ── Pure helper: which statements need backfill? ───────────────────

// Statements classified `testable` with no inline test link yet — excludes narrative sections and already-linked statements so the cron never overwrites author-curated links.
export function pickStatementsForBackfill(
  statements: Statement[],
  classifications: Map<number, Classification>,
): Array<{ ordinal: number; text: string }> {
  const out: Array<{ ordinal: number; text: string }> = [];

  for (const s of statements) {
    const c = classifications.get(s.ordinal);

    if (!c || c.testability !== "testable") {
      continue;
    }

    if (parseTestLinksInStatement(s.text).length > 0) {
      continue;
    }
    out.push({ ordinal: s.ordinal, text: s.text });
  }

  return out;
}

// ── Suggestion + propose helper (pure) ─────────────────────────────

export interface Suggestion {
  statement_ordinal: number;
  /** Exact statement text expected verbatim in the content; skipped if not found. */
  statement_text: string;
  test_file: string;
  test_line: number | null;
  /** Markdown label for the inserted `[label](href)` token, e.g. "validated by `runner.test.ts:88`". */
  label: string;
}

export interface SkipReason {
  statement_ordinal: number;
  reason: "already-linked" | "not-found";
}

export interface InsertionResult {
  newContent: string;
  diffPreview: string;
  applied: number;
  skipped: SkipReason[];
}

function renderLink(s: Suggestion): string {
  const anchor = s.test_line ? `#L${s.test_line}` : "";

  return `[${s.label}](${s.test_file}${anchor})`;
}

// For each statement_ordinal, locates the matching text and appends a `(...)` parenthetical of `[label](path#Lline)` links (comma-separated when multiple); skips already-linked or not-found statements.
export function proposeLinkInsertions(
  content: string,
  suggestions: Suggestion[],
): InsertionResult {
  if (suggestions.length === 0) {
    return { newContent: content, diffPreview: "", applied: 0, skipped: [] };
  }

  const byOrdinal = new Map<number, Suggestion[]>();

  for (const s of suggestions) {
    const list = byOrdinal.get(s.statement_ordinal) ?? [];

    list.push(s);
    byOrdinal.set(s.statement_ordinal, list);
  }

  const skipped: SkipReason[] = [];
  let applied = 0;
  let newContent = content;

  // Process ordinals deepest (latest) first so prior insertions don't shift later match indices.
  const ordered = [...byOrdinal.entries()]
    .map(([ord, list]) => ({
      ord,
      list,
      text: list[0].statement_text,
      idx: newContent.indexOf(list[0].statement_text),
    }))
    .sort((a, b) => b.idx - a.idx);

  for (const { ord, list, text } of ordered) {
    if (text.length === 0) {
      skipped.push({ statement_ordinal: ord, reason: "not-found" });
      continue;
    }
    const idx = newContent.indexOf(text);

    if (idx < 0) {
      skipped.push({ statement_ordinal: ord, reason: "not-found" });
      continue;
    }
    const existingLinks = parseTestLinksInStatement(text);

    if (existingLinks.length > 0) {
      skipped.push({ statement_ordinal: ord, reason: "already-linked" });
      continue;
    }
    const tail = ` (${list.map(renderLink).join(", ")})`;
    const insertionPoint = idx + text.length;

    newContent =
      newContent.slice(0, insertionPoint) +
      tail +
      newContent.slice(insertionPoint);
    applied += list.length;
  }

  const diffPreview = applied > 0 ? buildUnifiedDiff(content, newContent) : "";

  return { newContent, diffPreview, applied, skipped };
}

/** Tiny unified-diff renderer for the PR body. */
function buildUnifiedDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const out: string[] = ["--- a/spec.md", "+++ b/spec.md"];
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i] ?? "";
    const a = afterLines[i] ?? "";

    if (b === a) {
      continue;
    }

    if (b) {
      out.push(`-${b}`);
    }

    if (a) {
      out.push(`+${a}`);
    }
  }

  return out.join("\n");
}

// ── LLM judge (statement-level), inlined from the v2 linker ────────

const JUDGE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "boolean",
      description:
        "True only if this test actually validates a SPECIFIC enumerated statement.",
    },
    statement_ordinal: {
      type: "integer",
      description:
        "The ordinal of the SINGLE statement most strongly validated, from the enumerated TESTABLE STATEMENTS list. Required when matches=true.",
    },
    score: {
      type: "number",
      description:
        "Confidence 0.0–1.0 that this test validates the chosen statement.",
    },
    rationale: {
      type: "string",
      description: "One sentence referencing the behavior validated.",
    },
  },
  required: ["matches", "rationale"],
};

function formatTestableStatements(
  statements: { ordinal: number; text: string }[],
): string {
  return statements.map((s) => `[${s.ordinal}] ${s.text}`).join("\n");
}

const JUDGE_SCORE_THRESHOLD = 0.5;

async function judgeLink(
  spec: { file_path: string; content: string },
  testable: { ordinal: number; text: string }[],
  candidate: JudgeCandidate,
): Promise<
  Omit<
    Judgment,
    "test_file" | "test_name" | "test_line" | "symbol" | "match_kind"
  >
> {
  if (testable.length === 0) {
    return {
      matches: false,
      statement_ordinal: null,
      statement_text: null,
      match_score: 0,
      rationale: "No testable statements; nothing to validate.",
    };
  }
  const result = await Llm.instance.completeWithTool<{
    matches: boolean;
    statement_ordinal?: number;
    score?: number;
    rationale: string;
  }>({
    prompt: `Decide whether the TEST validates a SPECIFIC enumerated TESTABLE STATEMENT below. Answer true only when the test exercises a behaviour described by ONE statement — not merely shared vocabulary.

If true, pick the SINGLE statement most strongly validated (its ordinal) and a confidence \`score\` 0.0–1.0. If false, omit ordinal/score.

SPEC: ${spec.file_path}

TESTABLE STATEMENTS:
${formatTestableStatements(testable)}

TEST (${candidate.test_file} › ${candidate.test_name}):
---
${candidate.content.substring(0, 4000)}
---`,
    systemPrompt:
      "You judge whether a test validates one specific enumerated statement of a specification. Be strict: shared vocabulary is not validation. Pick a single best-match statement when matches=true and give a one-sentence rationale.",
    toolName: "judge_link",
    toolDescription:
      "Decide whether a test validates one enumerated spec statement",
    toolSchema: JUDGE_TOOL_SCHEMA,
    jobName: "spec_coverage_backfill",
  });

  const data = result.data;
  const matches = data.matches === true;
  const rationale = (data.rationale || "").trim();
  const safeRationale =
    rationale.length > 0
      ? rationale
      : "Judged relevant; no rationale returned.";

  if (!matches) {
    return {
      matches: false,
      statement_ordinal: null,
      statement_text: null,
      match_score: 0,
      rationale: safeRationale,
    };
  }
  const ordinal =
    typeof data.statement_ordinal === "number" ? data.statement_ordinal : null;
  const match = testable.find((s) => s.ordinal === ordinal);

  if (!match) {
    return {
      matches: false,
      statement_ordinal: null,
      statement_text: null,
      match_score: 0,
      rationale: `Judge picked ordinal ${ordinal} not in the enumerated set; dropped.`,
    };
  }
  const score =
    typeof data.score === "number" && data.score >= 0 && data.score <= 1
      ? data.score
      : JUDGE_SCORE_THRESHOLD;

  return {
    matches: true,
    statement_ordinal: match.ordinal,
    statement_text: match.text,
    match_score: score,
    rationale: safeRationale,
  };
}

// ── LLM classifier (batched fallback), inlined from the v2 linker ──

const CLASSIFIER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ordinal: { type: "integer" },
          testability: { type: "string", enum: ["testable", "untestable"] },
          category: {
            type: "string",
            enum: [
              "intro",
              "vision",
              "background",
              "clarification",
              "open-question",
              "limitation",
              "rationale",
            ],
            description: "Only required when testability=untestable",
          },
        },
        required: ["ordinal", "testability"],
      },
    },
  },
  required: ["classifications"],
};

const CLASSIFIER_BATCH_LIMIT = 60;

interface LLMClassification {
  ordinal: number;
  testability: "testable" | "untestable";
  category?: UntestableCategory;
}

async function classifyLLM(
  specPath: string,
  unclassified: Statement[],
): Promise<
  Map<
    number,
    {
      testability: "testable" | "untestable";
      category: UntestableCategory | null;
    }
  >
> {
  const result = new Map<
    number,
    {
      testability: "testable" | "untestable";
      category: UntestableCategory | null;
    }
  >();

  if (unclassified.length === 0) {
    return result;
  }

  const batch = unclassified.slice(0, CLASSIFIER_BATCH_LIMIT);
  const formatted = batch
    .map(
      (s) =>
        `[${s.ordinal}] (under "${s.enclosingHeading ?? "<intro>"}") ${s.text}`,
    )
    .join("\n");

  try {
    const llm = await Llm.instance.completeWithTool<{
      classifications: LLMClassification[];
    }>({
      prompt: `Classify each enumerated statement as either a NORMATIVE TESTABLE REQUIREMENT (something that could be validated by an automated test) or NARRATIVE (intro / vision / background / clarification / open-question / limitation / rationale).

Bias toward "testable" — if you're unsure, return "testable". A false "untestable" hides a real coverage gap.

For "untestable", pick the closest category from: intro, vision, background, clarification, open-question, limitation, rationale.

SPEC: ${specPath}

STATEMENTS:
${formatted}`,
      systemPrompt:
        "You classify spec statements as testable requirements or narrative prose. Bias toward testable when unsure.",
      toolName: "classify_statements",
      toolDescription: "Classify each statement as testable or untestable",
      toolSchema: CLASSIFIER_TOOL_SCHEMA,
      jobName: "spec_coverage_backfill",
    });

    for (const c of llm.data.classifications || []) {
      if (typeof c.ordinal !== "number") {
        continue;
      }
      result.set(c.ordinal, {
        testability: c.testability === "untestable" ? "untestable" : "testable",
        category: c.testability === "untestable" ? (c.category ?? null) : null,
      });
    }
  } catch (err) {
    console.warn(
      `[job] spec-coverage-backfill: LLM classifier failed for ${specPath}; defaulting to testable —`,
      err,
    );
  }

  return result;
}

async function classifyAllStatements(
  specPath: string,
  statements: Statement[],
): Promise<Map<number, Classification>> {
  const introOrdinals = buildIntroOrdinals(statements);
  const out = new Map<number, Classification>();
  const unclassified: Statement[] = [];

  for (const s of statements) {
    const c = classifyByHeuristic(s, introOrdinals);

    if (c.matchedBySection) {
      out.set(s.ordinal, c);
      continue;
    }
    unclassified.push(s);
  }
  const llm = await classifyLLM(specPath, unclassified);

  for (const s of unclassified) {
    const decision = llm.get(s.ordinal);

    const classification: Classification =
      decision && decision.testability === "untestable"
        ? {
            testability: "untestable",
            category: decision.category,
            matchedBySection: false,
          }
        : {
            testability: "testable",
            category: null,
            matchedBySection: false,
          };

    out.set(s.ordinal, classification);
  }

  return out;
}

// ── Orchestration (per repo, via the Project facade) ────────────────

const PR_BRANCH_PREFIX = "lore/spec-coverage-backfill";

function toLine(metadata: Record<string, unknown> | null): number | null {
  const raw = metadata?.["start_line"];

  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }

  const line = typeof raw === "string" ? Number(raw) : raw;

  return Number.isFinite(line) ? line : null;
}

function buildLabel(testFile: string, testLine: number | null): string {
  const base = testFile.split("/").pop() ?? testFile;

  return testLine
    ? `validated by \`${base}:${testLine}\``
    : `validated by \`${base}\``;
}

function buildBranchName(specPath: string): string {
  const safe = specPath
    .replace(/^specs\//, "")
    .replace(/\.md$/, "")
    .replace(/[^a-zA-Z0-9._/-]/g, "-")
    .replace(/\/+/g, "-")
    .slice(0, 60);
  // Add a short timestamp so re-runs land on distinct branches.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, "");

  return `${PR_BRANCH_PREFIX}/${safe}-${stamp}`;
}

function buildPrBody(
  specPath: string,
  applied: number,
  judgments: Judgment[],
  diffPreview: string,
): string {
  const summary = `${applied} suggestion${applied === 1 ? "" : "s"} for \`${specPath}\``;
  const rationales = judgments
    .slice(0, applied)
    .map(
      (j) =>
        `- **${j.test_file}${j.test_line ? `:${j.test_line}` : ""}** (score ${j.match_score.toFixed(2)}): ${j.rationale}`,
    )
    .join("\n");

  return [
    `# Suggested test links for \`${specPath}\``,
    "",
    summary + ".",
    "",
    "Each suggestion adds an inline `([validated by ...](path#Lline))` parenthetical at end of a testable statement that currently has no test link. Review each — merging this PR makes the linked tests the source of truth for that statement's coverage; rejecting it leaves the statement uncovered (red in the UI) and you can write a different link in a follow-up.",
    "",
    "## Rationales",
    "",
    rationales,
    "",
    "## Diff",
    "",
    "```diff",
    diffPreview.slice(0, 8000),
    "```",
    "",
    "_Posted by Lore's `spec-coverage-backfill` cron. Re-runs weekly Mon 11:00 UTC; this PR is idempotent against later runs as long as the statement text isn't edited._",
  ].join("\n");
}

export interface BackfillOptions {
  /** The repo this run covers (per-repo fan-out / manual single-repo run). */
  repoFilter: string;
  /** Limit to a single spec path within the repo. */
  specPathFilter?: string;
  /** Data facade — projectFor(repo) on the Floor, createStationProject(env) in a pod. */
  project: Project;
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
  const specs = opts.specPathFilter
    ? specRows.filter((s) => s.filePath === opts.specPathFilter)
    : specRows;

  if (specs.length === 0) {
    console.log(`[job] spec-coverage-backfill: no specs for ${repo}`);

    return "No specs found";
  }

  // Test chunks loaded once per repo and reused for every spec.
  const codeChunks = await buildTestChunks(project);

  // Group spec chunks by file_path for reassembly.
  const byPath = new Map<string, SpecChunkWithEmbedding[]>();

  for (const s of specs) {
    const list = byPath.get(s.filePath) ?? [];

    list.push(s);
    byPath.set(s.filePath, list);
  }

  let totalSpecs = 0;
  let totalSuggestions = 0;
  let totalPrsOpened = 0;

  for (const [specPath, chunks] of byPath) {
    if (!isAssertionSource(specPath)) {
      continue;
    }

    try {
      const summary = await runBackfillForSpec(
        project,
        repo,
        specPath,
        chunks,
        codeChunks,
      );

      totalSpecs++;
      totalSuggestions += summary.suggestions;

      if (summary.prUrl) {
        totalPrsOpened++;
      }
      console.log(
        `[job] spec-coverage-backfill: ${repo}:${specPath} — ${summary.suggestions} suggestions, ${summary.prUrl ?? "no PR"}`,
      );
    } catch (err) {
      console.error(
        `[job] spec-coverage-backfill: error on ${repo}:${specPath}:`,
        err,
      );
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

async function runBackfillForSpec(
  project: Project,
  repo: string,
  specPath: string,
  chunks: SpecChunkWithEmbedding[],
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
  const specEmbedding = parseEmbedding(chunks[0]?.embedding);
  const { candidates } = selectCandidates(
    { repo, file_path: specPath, content, embedding: specEmbedding },
    assertions,
    codeChunks,
  );

  if (candidates.length === 0) {
    return { suggestions: 0, prUrl: null };
  }

  // Judge each candidate against the un-linked testable subset.
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
  const confirmed = argmaxByTest(judgments);

  if (confirmed.length === 0) {
    return { suggestions: 0, prUrl: null };
  }

  // Build Suggestion[] from confirmed judgments + the unlinked text map.
  const textByOrdinal = new Map(unlinked.map((u) => [u.ordinal, u.text]));
  const suggestions: Suggestion[] = confirmed
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

  // Open the PR.
  const branch = buildBranchName(specPath);
  const title = `Suggested test links for ${specPath}`;
  const body = buildPrBody(specPath, applied, confirmed, diffPreview);

  try {
    await project.repo.createBranch(branch);
    await project.repo.commitFile(
      branch,
      specPath,
      newContent,
      `lore: backfill suggested test links for ${specPath}`,
    );
    const pr = await project.pulls.open(branch, title, body, undefined, [
      "lore-managed",
      "spec-coverage-backfill",
    ]);

    return { suggestions: applied, prUrl: pr.url };
  } catch (err) {
    console.error(
      `[job] spec-coverage-backfill: failed to open PR for ${repo}:${specPath}:`,
      err,
    );

    return { suggestions: applied, prUrl: null };
  }
}
