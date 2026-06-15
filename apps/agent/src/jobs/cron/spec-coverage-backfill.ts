/**
 * Spec → Test Coverage Backfill Cron (v3 of spec-test-coverage).
 *
 * Reuses the v2 judge pipeline (segment → classify → candidate
 * selection → LLM judge) but emits its output as **edits to spec.md**
 * via a PR per spec, instead of as rows in spec_test_links /
 * spec_statements / spec_coverage_runs (all dropped in v3). The
 * author reviews the suggestion PR and either merges (the inline
 * `([validated by ...](path#Lline))` parenthetical becomes the
 * source of truth) or rejects.
 *
 * Runs weekly Mon 11:00 UTC. The pure parts
 * (`pickStatementsForBackfill`, `proposeLinkInsertions`) are unit-
 * tested below; the orchestration calls `project.pulls.open` once
 * per spec with non-zero suggestions.
 */

import {
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
  type Assertion,
  type TestChunk,
  type JudgeCandidate,
  type Judgment,
  type MatchKind,
} from "@re-cinq/lore-shared";
import { query } from "../../platform/db.js";
import { Llm } from "@re-cinq/lore-shared";
import { projectFor } from "../../platform/project-boot.js";
import { isAssertionSource } from "./spec-drift-rules.js";

// ── Pure helper: which statements need backfill? ───────────────────

/**
 * Returns the (ordinal, text) tuples for statements that:
 *   - are classified `testable`, AND
 *   - carry no inline test link in their trailing parenthetical.
 *
 * These are the statements the cron should run the judge against.
 * Untestable statements (narrative sections) are excluded by
 * definition; already-linked statements are excluded so the cron
 * never overwrites author-curated links.
 */
export function pickStatementsForBackfill(
  statements: Statement[],
  classifications: Map<number, Classification>,
): Array<{ ordinal: number; text: string }> {
  const out: Array<{ ordinal: number; text: string }> = [];
  for (const s of statements) {
    const c = classifications.get(s.ordinal);
    if (!c || c.testability !== "testable") continue;
    if (parseTestLinksInStatement(s.text).length > 0) continue;
    out.push({ ordinal: s.ordinal, text: s.text });
  }
  return out;
}

// ── Suggestion + propose helper (pure) ─────────────────────────────

export interface Suggestion {
  statement_ordinal: number;
  /** The exact statement text we expect to find verbatim in the
   * content. If not found, the suggestion is skipped. */
  statement_text: string;
  test_file: string;
  test_line: number | null;
  /** Markdown label to use inside the inserted `[label](href)` token.
   * The caller picks something readable like
   * "validated by `runner.test.ts:88`". */
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

/**
 * For each statement_ordinal, locate the matching statement_text in
 * the content and append a trailing `(...)` parenthetical containing
 * one or more `[label](path#Lline)` markdown links. Statements that
 * already carry any test link are skipped with `already-linked`;
 * statements whose text can't be located are skipped with `not-found`.
 *
 * Multiple suggestions for the same statement collapse into one
 * parenthetical, comma-separated.
 */
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

  // Process ordinals deepest (latest) first so prior insertions don't
  // shift the indices of later matches.
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
      newContent.slice(0, insertionPoint) + tail + newContent.slice(insertionPoint);
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
    if (b === a) continue;
    if (b) out.push(`-${b}`);
    if (a) out.push(`+${a}`);
  }
  return out.join("\n");
}

// ── LLM judge (statement-level), inlined from the v2 linker ────────

const JUDGE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "boolean",
      description: "True only if this test actually validates a SPECIFIC enumerated statement.",
    },
    statement_ordinal: {
      type: "integer",
      description:
        "The ordinal of the SINGLE statement most strongly validated, from the enumerated TESTABLE STATEMENTS list. Required when matches=true.",
    },
    score: {
      type: "number",
      description: "Confidence 0.0–1.0 that this test validates the chosen statement.",
    },
    rationale: {
      type: "string",
      description: "One sentence referencing the behavior validated.",
    },
  },
  required: ["matches", "rationale"],
};

function formatTestableStatements(statements: { ordinal: number; text: string }[]): string {
  return statements.map((s) => `[${s.ordinal}] ${s.text}`).join("\n");
}

const JUDGE_SCORE_THRESHOLD = 0.5;

async function judgeLink(
  spec: { file_path: string; content: string },
  testable: { ordinal: number; text: string }[],
  candidate: JudgeCandidate,
): Promise<Omit<Judgment, "test_file" | "test_name" | "test_line" | "symbol" | "match_kind">> {
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
    toolDescription: "Decide whether a test validates one enumerated spec statement",
    toolSchema: JUDGE_TOOL_SCHEMA,
    jobName: "spec_coverage_backfill",
  });

  const data = result.data;
  const matches = data.matches === true;
  const rationale = (data.rationale || "").trim();
  const safeRationale = rationale.length > 0 ? rationale : "Judged relevant; no rationale returned.";

  if (!matches) {
    return {
      matches: false, statement_ordinal: null, statement_text: null,
      match_score: 0, rationale: safeRationale,
    };
  }
  const ordinal = typeof data.statement_ordinal === "number" ? data.statement_ordinal : null;
  const match = testable.find((s) => s.ordinal === ordinal);
  if (!match) {
    return {
      matches: false, statement_ordinal: null, statement_text: null,
      match_score: 0,
      rationale: `Judge picked ordinal ${ordinal} not in the enumerated set; dropped.`,
    };
  }
  const score = typeof data.score === "number" && data.score >= 0 && data.score <= 1
    ? data.score
    : JUDGE_SCORE_THRESHOLD;
  return {
    matches: true, statement_ordinal: match.ordinal, statement_text: match.text,
    match_score: score, rationale: safeRationale,
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
            enum: ["intro", "vision", "background", "clarification", "open-question", "limitation", "rationale"],
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
): Promise<Map<number, { testability: "testable" | "untestable"; category: UntestableCategory | null }>> {
  const result = new Map<number, { testability: "testable" | "untestable"; category: UntestableCategory | null }>();
  if (unclassified.length === 0) return result;

  const batch = unclassified.slice(0, CLASSIFIER_BATCH_LIMIT);
  const formatted = batch
    .map((s) => `[${s.ordinal}] (under "${s.enclosingHeading ?? "<intro>"}") ${s.text}`)
    .join("\n");

  try {
    const llm = await Llm.instance.completeWithTool<{ classifications: LLMClassification[] }>({
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
      if (typeof c.ordinal !== "number") continue;
      result.set(c.ordinal, {
        testability: c.testability === "untestable" ? "untestable" : "testable",
        category: c.testability === "untestable" ? (c.category ?? null) : null,
      });
    }
  } catch (err) {
    console.warn(`[job] spec-coverage-backfill: LLM classifier failed for ${specPath}; defaulting to testable —`, err);
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
    } else {
      unclassified.push(s);
    }
  }
  const llm = await classifyLLM(specPath, unclassified);
  for (const s of unclassified) {
    const decision = llm.get(s.ordinal);
    if (decision && decision.testability === "untestable") {
      out.set(s.ordinal, {
        testability: "untestable",
        category: decision.category,
        matchedBySection: false,
      });
    } else {
      out.set(s.ordinal, { testability: "testable", category: null, matchedBySection: false });
    }
  }
  return out;
}

async function extractAssertions(specContent: string, filePath: string): Promise<Assertion[]> {
  const result = await Llm.instance.completeWithTool<{ assertions: Assertion[] }>({
    prompt: `Analyze this specification and extract testable assertions — concrete names of functions, classes, interfaces, types, or API endpoints that SHOULD exist in the codebase based on this spec.

Only extract items that are explicitly named in the spec. Do not infer or guess.

Spec file: ${filePath}
---
${specContent.substring(0, 12000)}`,
    systemPrompt:
      "You extract testable code assertions from specifications. Return only explicitly named items.",
    toolName: "extract_assertions",
    toolDescription: "Extract testable assertions from a spec",
    toolSchema: {
      type: "object",
      properties: {
        assertions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "The exact name of the function, class, type, or endpoint" },
              kind: { type: "string", enum: ["function", "class", "interface", "type", "endpoint", "other"] },
              description: { type: "string", description: "What this assertion checks for" },
            },
            required: ["name", "kind", "description"],
          },
        },
      },
      required: ["assertions"],
    },
    jobName: "spec_coverage_backfill",
  });
  return result.data.assertions || [];
}

// ── Orchestration ──────────────────────────────────────────────────

const ACTIVITY_WINDOW_DAYS = 7;
const PR_BRANCH_PREFIX = "lore/spec-coverage-backfill";

interface SpecRow {
  repo: string;
  file_path: string;
  content: string;
  ingested_at: string | Date;
  embedding: unknown;
}

interface CodeRow {
  file_path: string;
  content: string;
  metadata: Record<string, unknown> | null;
  embedding: unknown;
}

interface SchemaRow { schema: string }

async function getSchemasWithSpecs(): Promise<string[]> {
  const rows = await query<SchemaRow>(
    `SELECT n.nspname AS schema
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'chunks' AND c.relkind = 'r'
     ORDER BY n.nspname`,
  );
  return rows.map((r) => r.schema);
}

function toLine(metadata: Record<string, unknown> | null): number | null {
  const raw = metadata?.["start_line"];
  const line = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(line) ? line : null;
}

function buildLabel(testFile: string, testLine: number | null): string {
  const base = testFile.split("/").pop() ?? testFile;
  return testLine ? `validated by \`${base}:${testLine}\`` : `validated by \`${base}\``;
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
    .map((j) => `- **${j.test_file}${j.test_line ? `:${j.test_line}` : ""}** (score ${j.match_score.toFixed(2)}): ${j.rationale}`)
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
  /** Limit to a single repo (e.g. for a manual run on a known spec). */
  repoFilter?: string;
  /** Limit to a single spec path within the repo. */
  specPathFilter?: string;
}

export async function specCoverageBackfillJob(opts: BackfillOptions = {}): Promise<string> {
  const schemas = await getSchemasWithSpecs();
  if (schemas.length === 0) {
    console.log("[job] spec-coverage-backfill: no chunks tables found");
    return "No chunks tables found";
  }

  let totalRepos = 0;
  let totalSpecs = 0;
  let totalSuggestions = 0;
  let totalPrsOpened = 0;

  for (const schema of schemas) {
    const specs = opts.repoFilter
      ? await query<SpecRow>(
          `SELECT repo, file_path, content, ingested_at, embedding
           FROM ${schema}.chunks
           WHERE content_type = 'spec' AND repo = $1
             ${opts.specPathFilter ? "AND file_path = $2" : ""}
           ORDER BY repo, file_path, ingested_at`,
          opts.specPathFilter ? [opts.repoFilter, opts.specPathFilter] : [opts.repoFilter],
        )
      : await query<SpecRow>(
          `SELECT repo, file_path, content, ingested_at, embedding
           FROM ${schema}.chunks
           WHERE content_type = 'spec'
           ORDER BY repo, file_path, ingested_at`,
        );
    if (specs.length === 0) continue;

    // Active-repo gate (mirrors the v2 linker's): if the repo hasn't
    // re-ingested code in the last 7 days, there's no point running.
    // Triggered runs (repoFilter set) bypass the gate.
    let activeRepos: Set<string> | null = null;
    if (!opts.repoFilter) {
      const rows = await query<{ repo: string }>(
        `SELECT DISTINCT repo FROM ${schema}.chunks
         WHERE content_type = 'code'
           AND ingested_at > now() - ($1 || ' days')::interval`,
        [String(ACTIVITY_WINDOW_DAYS)],
      );
      activeRepos = new Set(rows.map((r) => r.repo));
    }

    // Group spec chunks by (repo, file_path) for reassembly.
    const byRepoPath = new Map<string, Map<string, SpecRow[]>>();
    for (const s of specs) {
      const byPath = byRepoPath.get(s.repo) ?? new Map<string, SpecRow[]>();
      const list = byPath.get(s.file_path) ?? [];
      list.push(s);
      byPath.set(s.file_path, list);
      byRepoPath.set(s.repo, byPath);
    }

    for (const [repo, byPath] of byRepoPath) {
      if (activeRepos && !activeRepos.has(repo)) continue;
      totalRepos++;

      // Test chunks loaded once per repo and reused for every spec.
      const codeChunks = await loadTestChunks(schema, repo);

      for (const [specPath, chunks] of byPath) {
        if (!isAssertionSource(specPath)) continue;
        try {
          const summary = await runBackfillForSpec(repo, specPath, chunks, codeChunks);
          totalSpecs++;
          totalSuggestions += summary.suggestions;
          if (summary.prUrl) totalPrsOpened++;
          console.log(`[job] spec-coverage-backfill: ${repo}:${specPath} — ${summary.suggestions} suggestions, ${summary.prUrl ?? "no PR"}`);
        } catch (err) {
          console.error(`[job] spec-coverage-backfill: error on ${repo}:${specPath}:`, err);
        }
      }
    }
  }

  const out = `Backfill: ${totalSpecs} specs across ${totalRepos} repos — ${totalSuggestions} suggestions, ${totalPrsOpened} PRs opened`;
  console.log(`[job] spec-coverage-backfill: ${out}`);
  return out;
}

async function loadTestChunks(schema: string, repo: string): Promise<TestChunk[]> {
  const rows = await query<CodeRow>(
    `SELECT file_path, content, metadata, embedding
     FROM ${schema}.chunks
     WHERE repo = $1 AND content_type = 'code'`,
    [repo],
  );
  return rows
    .filter((r) => isTestFile(r.file_path))
    .map((r) => ({
      file_path: r.file_path,
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
  repo: string,
  specPath: string,
  chunks: SpecRow[],
  codeChunks: TestChunk[],
): Promise<SpecBackfillSummary> {
  const content = reassembleSpec(chunks);
  const statements = segmentStatements(content);
  const classifications = await classifyAllStatements(specPath, statements);

  const unlinked = pickStatementsForBackfill(statements, classifications);
  if (unlinked.length === 0) {
    return { suggestions: 0, prUrl: null };
  }

  const assertions = await extractAssertions(content, specPath);
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
    const verdict = await judgeLink({ file_path: specPath, content }, unlinked, candidate);
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
    .filter((j) => j.statement_ordinal !== null && textByOrdinal.has(j.statement_ordinal))
    .map((j) => ({
      statement_ordinal: j.statement_ordinal as number,
      statement_text: textByOrdinal.get(j.statement_ordinal as number) as string,
      test_file: j.test_file,
      test_line: j.test_line,
      label: buildLabel(j.test_file, j.test_line),
    }));
  if (suggestions.length === 0) {
    return { suggestions: 0, prUrl: null };
  }

  const { newContent, diffPreview, applied } = proposeLinkInsertions(content, suggestions);
  if (applied === 0) {
    return { suggestions: 0, prUrl: null };
  }

  // Open the PR.
  const branch = buildBranchName(specPath);
  const title = `Suggested test links for ${specPath}`;
  const body = buildPrBody(specPath, applied, confirmed, diffPreview);
  try {
    const project = await projectFor(repo);
    await project.repo.createBranch(branch);
    await project.repo.commitFile(branch, specPath, newContent, `lore: backfill suggested test links for ${specPath}`);
    const pr = await project.pulls.open(branch, title, body, undefined, ["lore-managed", "spec-coverage-backfill"]);
    return { suggestions: applied, prUrl: pr.url };
  } catch (err) {
    console.error(`[job] spec-coverage-backfill: failed to open PR for ${repo}:${specPath}:`, err);
    return { suggestions: applied, prUrl: null };
  }
}
