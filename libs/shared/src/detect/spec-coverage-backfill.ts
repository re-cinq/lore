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

function groupByOrdinal(suggestions: Suggestion[]): Map<number, Suggestion[]> {
  const byOrdinal = new Map<number, Suggestion[]>();

  for (const s of suggestions) {
    const list = byOrdinal.get(s.statement_ordinal) ?? [];

    list.push(s);
    byOrdinal.set(s.statement_ordinal, list);
  }

  return byOrdinal;
}

interface OrderedInsertion {
  ord: number;
  list: Suggestion[];
  text: string;
}

// Process ordinals deepest (latest) first so prior insertions don't shift later match indices.
function orderInsertions(
  byOrdinal: Map<number, Suggestion[]>,
  content: string,
): OrderedInsertion[] {
  return [...byOrdinal.entries()]
    .map(([ord, list]) => ({
      ord,
      list,
      text: list[0].statement_text,
      idx: content.indexOf(list[0].statement_text),
    }))
    .sort((a, b) => b.idx - a.idx);
}

type InsertionOutcome =
  | { kind: "skip"; reason: SkipReason }
  | { kind: "insert"; newContent: string; applied: number };

function insertOne(entry: OrderedInsertion, content: string): InsertionOutcome {
  const { ord, list, text } = entry;

  if (text.length === 0) {
    return {
      kind: "skip",
      reason: { statement_ordinal: ord, reason: "not-found" },
    };
  }

  const idx = content.indexOf(text);

  if (idx < 0) {
    return {
      kind: "skip",
      reason: { statement_ordinal: ord, reason: "not-found" },
    };
  }

  if (parseTestLinksInStatement(text).length > 0) {
    return {
      kind: "skip",
      reason: { statement_ordinal: ord, reason: "already-linked" },
    };
  }

  const tail = ` (${list.map(renderLink).join(", ")})`;
  const insertionPoint = idx + text.length;

  return {
    kind: "insert",
    newContent:
      content.slice(0, insertionPoint) + tail + content.slice(insertionPoint),
    applied: list.length,
  };
}

// For each statement_ordinal, locates the matching text and appends a `(...)` parenthetical of `[label](path#Lline)` links (comma-separated when multiple); skips already-linked or not-found statements.
export function proposeLinkInsertions(
  content: string,
  suggestions: Suggestion[],
): InsertionResult {
  if (suggestions.length === 0) {
    return { newContent: content, diffPreview: "", applied: 0, skipped: [] };
  }

  const ordered = orderInsertions(groupByOrdinal(suggestions), content);
  const skipped: SkipReason[] = [];
  let applied = 0;
  let newContent = content;

  for (const entry of ordered) {
    const outcome = insertOne(entry, newContent);

    if (outcome.kind === "skip") {
      skipped.push(outcome.reason);
      continue;
    }
    newContent = outcome.newContent;
    applied += outcome.applied;
  }

  const diffPreview = applied > 0 ? buildUnifiedDiff(content, newContent) : "";

  return { newContent, diffPreview, applied, skipped };
}

function diffLine(before: string, after: string): string[] {
  if (before === after) {
    return [];
  }

  const lines: string[] = [];

  if (before) {
    lines.push(`-${before}`);
  }

  if (after) {
    lines.push(`+${after}`);
  }

  return lines;
}

/** Tiny unified-diff renderer for the PR body. */
function buildUnifiedDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const out: string[] = ["--- a/spec.md", "+++ b/spec.md"];
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen; i++) {
    out.push(...diffLine(beforeLines[i] || "", afterLines[i] || ""));
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

type JudgeVerdict = Omit<
  Judgment,
  "test_file" | "test_name" | "test_line" | "symbol" | "match_kind"
>;

interface JudgeSuggestion {
  matches: boolean;
  statement_ordinal?: number;
  score?: number;
  rationale: string;
}

function noMatchVerdict(rationale: string): JudgeVerdict {
  return {
    matches: false,
    statement_ordinal: null,
    statement_text: null,
    match_score: 0,
    rationale,
  };
}

function cleanRationale(raw: string): string {
  const rationale = raw.trim();

  return rationale.length > 0
    ? rationale
    : "Judged relevant; no rationale returned.";
}

function isValidScore(score: unknown): score is number {
  return typeof score === "number" && score >= 0 && score <= 1;
}

function resolveJudgeVerdict(
  testable: { ordinal: number; text: string }[],
  suggestion: JudgeSuggestion,
): JudgeVerdict {
  const rationale = cleanRationale(suggestion.rationale || "");

  if (suggestion.matches !== true) {
    return noMatchVerdict(rationale);
  }

  const ordinal =
    typeof suggestion.statement_ordinal === "number"
      ? suggestion.statement_ordinal
      : null;
  const match = testable.find((s) => s.ordinal === ordinal);

  if (!match) {
    return noMatchVerdict(
      `Judge picked ordinal ${ordinal} not in the enumerated set; dropped.`,
    );
  }

  const score = isValidScore(suggestion.score)
    ? suggestion.score
    : JUDGE_SCORE_THRESHOLD;

  return {
    matches: true,
    statement_ordinal: match.ordinal,
    statement_text: match.text,
    match_score: score,
    rationale,
  };
}

async function judgeLink(
  spec: { file_path: string; content: string },
  testable: { ordinal: number; text: string }[],
  candidate: JudgeCandidate,
): Promise<JudgeVerdict> {
  if (testable.length === 0) {
    return noMatchVerdict("No testable statements; nothing to validate.");
  }
  const result = await Llm.instance.completeWithTool<JudgeSuggestion>({
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

  return resolveJudgeVerdict(testable, result.parsed);
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

interface ResolvedClassification {
  testability: "testable" | "untestable";
  category: UntestableCategory | null;
}

function classificationFromLLM(
  c: LLMClassification,
): [number, ResolvedClassification] | null {
  if (typeof c.ordinal !== "number") {
    return null;
  }

  const untestable = c.testability === "untestable";

  return [
    c.ordinal,
    {
      testability: untestable ? "untestable" : "testable",
      category: untestable ? (c.category ?? null) : null,
    },
  ];
}

async function classifyLLM(
  specPath: string,
  unclassified: Statement[],
): Promise<Map<number, ResolvedClassification>> {
  const result = new Map<number, ResolvedClassification>();

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

    for (const c of llm.parsed.classifications || []) {
      const entry = classificationFromLLM(c);

      if (!entry) {
        continue;
      }
      result.set(entry[0], entry[1]);
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

interface OpenBackfillPrArgs {
  project: Project;
  repo: string;
  specPath: string;
  newContent: string;
  applied: number;
  confirmed: Judgment[];
  diffPreview: string;
}

async function openBackfillPr(
  args: OpenBackfillPrArgs,
): Promise<string | null> {
  const {
    project,
    repo,
    specPath,
    newContent,
    applied,
    confirmed,
    diffPreview,
  } = args;
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
    const pr = await project.pulls.open(branch, {
      title,
      body,
      labels: ["lore-managed", "spec-coverage-backfill"],
    });

    return pr.url;
  } catch (err) {
    console.error(
      `[job] spec-coverage-backfill: failed to open PR for ${repo}:${specPath}:`,
      err,
    );

    return null;
  }
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
