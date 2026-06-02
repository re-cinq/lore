import {
  segmentStatements,
  classifyByHeuristic,
  buildIntroOrdinals,
  reassembleSpec,
  isTestFile,
  selectCandidates,
  staleLinkKeys,
  staleStatementOrdinals,
  argmaxByTest,
  deriveTestName,
  parseEmbedding,
  hashSpecContent,
  MAX_CANDIDATES_PER_SPEC,
  JUDGE_SCORE_THRESHOLD,
  type Statement,
  type Classification,
  type UntestableCategory,
  type Assertion,
  type TestChunk,
  type JudgeCandidate,
  type Judgment,
  type SpecTestLink,
} from "@re-cinq/lore-shared";
import { query } from "../../db.js";
import { callLLMWithTool } from "../../anthropic.js";
import { isAssertionSource } from "./spec-drift-rules.js";

// Re-export shared symbols the agent codebase + tests have historically
// imported from this module; keeps the public API stable.
export {
  isTestFile,
  selectCandidates,
  staleLinkKeys,
  staleStatementOrdinals,
  argmaxByTest,
  deriveTestName,
  parseEmbedding,
  hashSpecContent,
  MAX_CANDIDATES_PER_SPEC,
  JUDGE_SCORE_THRESHOLD,
  type TestChunk,
  type JudgeCandidate,
  type Judgment,
  type SpecTestLink,
};
export {
  specFeatureSlug,
  hasDirectoryAffinity,
  cosineSimilarity,
  matchedAssertion,
  type MatchKind,
} from "@re-cinq/lore-shared";

const ACTIVITY_WINDOW_DAYS = 7;
const CLASSIFIER_BATCH_LIMIT = 60;

// ── LLM judge (statement-level) ──────────────────────────────────────

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
  return statements
    .map((s) => `[${s.ordinal}] ${s.text}`)
    .join("\n");
}

export async function judgeLink(
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
  const result = await callLLMWithTool<{
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
    jobName: "spec_test_linker",
  });

  const data = result.data;
  const matches = data.matches === true;
  const rationale = (data.rationale || "").trim();
  const safeRationale = rationale.length > 0 ? rationale : "Judged relevant; no rationale returned.";

  if (!matches) {
    return {
      matches: false,
      statement_ordinal: null,
      statement_text: null,
      match_score: 0,
      rationale: safeRationale,
    };
  }
  const ordinal = typeof data.statement_ordinal === "number" ? data.statement_ordinal : null;
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
  const score = typeof data.score === "number" && data.score >= 0 && data.score <= 1
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

// ── LLM statement classifier (batched fallback) ──────────────────────

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

interface LLMClassification {
  ordinal: number;
  testability: "testable" | "untestable";
  category?: UntestableCategory;
}

/**
 * Batched LLM fallback classifier for statements the section heuristic
 * couldn't decide. Bias is toward `testable` — if the model is unsure or the
 * returned payload doesn't cover a statement, it stays testable so a real gap
 * never hides behind grey.
 */
export async function classifyLLM(
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
    const llm = await callLLMWithTool<{ classifications: LLMClassification[] }>({
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
      jobName: "spec_test_linker",
    });

    for (const c of llm.data.classifications || []) {
      if (typeof c.ordinal !== "number") continue;
      result.set(c.ordinal, {
        testability: c.testability === "untestable" ? "untestable" : "testable",
        category: c.testability === "untestable" ? (c.category ?? null) : null,
      });
    }
  } catch (err) {
    console.warn(`[job] spec-test-linker: LLM classifier failed for ${specPath}; defaulting to testable —`, err);
  }
  return result;
}

/** Combine the heuristic + LLM fallback into a single classification map. */
export async function classifyAllStatements(
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

// ── Persistence ───────────────────────────────────────────────────────

async function persistStatements(
  schema: string,
  repo: string,
  specPath: string,
  statements: Statement[],
  classifications: Map<number, Classification>,
): Promise<number> {
  for (const s of statements) {
    const c = classifications.get(s.ordinal);
    if (!c) continue;
    await query(
      `INSERT INTO ${schema}.spec_statements
         (repo, spec_path, ordinal, text, kind, testability, category, classified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (repo, spec_path, ordinal)
       DO UPDATE SET
         text          = EXCLUDED.text,
         kind          = EXCLUDED.kind,
         testability   = EXCLUDED.testability,
         category      = EXCLUDED.category,
         classified_at = now()`,
      [repo, specPath, s.ordinal, s.text, s.kind, c.testability, c.category],
    );
  }

  const existing = await query<{ ordinal: number }>(
    `SELECT ordinal FROM ${schema}.spec_statements WHERE repo = $1 AND spec_path = $2`,
    [repo, specPath],
  );
  const currentOrdinals = statements.map((s) => s.ordinal);
  const stale = staleStatementOrdinals(existing.map((r) => r.ordinal), currentOrdinals);
  for (const ord of stale) {
    await query(
      `DELETE FROM ${schema}.spec_statements WHERE repo = $1 AND spec_path = $2 AND ordinal = $3`,
      [repo, specPath, ord],
    );
  }
  return stale.length;
}

async function persistLinks(
  schema: string,
  repo: string,
  specPath: string,
  confirmed: Judgment[],
): Promise<number> {
  for (const link of confirmed) {
    await query(
      `INSERT INTO ${schema}.spec_test_links
         (repo, spec_path, test_file, test_name, test_line, symbol, match_kind,
          rationale, statement_ordinal, statement_text, match_score, linked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (repo, spec_path, test_file, test_name)
       DO UPDATE SET
         test_line         = EXCLUDED.test_line,
         symbol            = EXCLUDED.symbol,
         match_kind        = EXCLUDED.match_kind,
         rationale         = EXCLUDED.rationale,
         statement_ordinal = EXCLUDED.statement_ordinal,
         statement_text    = EXCLUDED.statement_text,
         match_score       = EXCLUDED.match_score,
         linked_at         = now()`,
      [
        repo,
        specPath,
        link.test_file,
        link.test_name,
        link.test_line,
        link.symbol,
        link.match_kind,
        link.rationale,
        link.statement_ordinal,
        link.statement_text,
        link.match_score,
      ],
    );
  }

  const existing = await query<{ test_file: string; test_name: string }>(
    `SELECT test_file, test_name FROM ${schema}.spec_test_links WHERE repo = $1 AND spec_path = $2`,
    [repo, specPath],
  );
  const stale = staleLinkKeys(existing, confirmed);
  for (const link of stale) {
    await query(
      `DELETE FROM ${schema}.spec_test_links
       WHERE repo = $1 AND spec_path = $2 AND test_file = $3 AND test_name = $4`,
      [repo, specPath, link.test_file, link.test_name],
    );
  }
  return stale.length;
}

// ── Content-hash freshness gate ──────────────────────────────────────
// `hashSpecContent` re-exported from @re-cinq/lore-shared at the top.

async function getLastContentHash(
  schema: string,
  repo: string,
  specPath: string,
): Promise<string | null> {
  try {
    const rows = await query<{ content_hash: string }>(
      `SELECT content_hash FROM ${schema}.spec_coverage_runs
       WHERE repo = $1 AND spec_path = $2`,
      [repo, specPath],
    );
    return rows[0]?.content_hash ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return null;
    throw err;
  }
}

export async function recordContentHash(
  schema: string,
  repo: string,
  specPath: string,
  contentHash: string,
  linkedBy: string,
): Promise<void> {
  await query(
    `INSERT INTO ${schema}.spec_coverage_runs (repo, spec_path, content_hash, run_at, linked_by)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (repo, spec_path)
     DO UPDATE SET content_hash = EXCLUDED.content_hash,
                   run_at       = now(),
                   linked_by    = EXCLUDED.linked_by`,
    [repo, specPath, contentHash, linkedBy],
  );
}

// ── Schema enumeration + assertion extraction ────────────────────────

async function getLinkSchemas(): Promise<string[]> {
  const rows = await query<{ table_schema: string }>(
    `SELECT table_schema FROM information_schema.tables
     WHERE table_name = 'spec_test_links'
     ORDER BY table_schema`,
  );
  return rows.map((row) => row.table_schema);
}

async function extractAssertions(specContent: string, filePath: string): Promise<Assertion[]> {
  const result = await callLLMWithTool<{ assertions: Assertion[] }>({
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
    jobName: "spec_test_linker",
  });
  return result.data.assertions || [];
}

// ── Orchestration ────────────────────────────────────────────────────

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

/**
 * Spec → Test Coverage Linker (weekly + on-demand).
 *
 * Per schema, for each assertion-source spec in an active repo:
 *   1. Reassemble + hash the spec's chunks; skip when the hash is unchanged
 *      since the last successful run (`spec_coverage_runs`).
 *   2. Segment + classify statements (section heuristic + LLM fallback) and
 *      persist them to `spec_statements`, pruning ordinals no longer present.
 *   3. Pre-filter candidate tests (assertion overlap + directory affinity +
 *      embedding proximity), cap with truncation log, ask the LLM judge which
 *      ENUMERATED TESTABLE STATEMENT each candidate validates (with score),
 *      argmax-per-test, then upsert confirmed links and prune stale ones.
 *   4. Record the new content hash.
 *
 * Active-repo pre-filter (mirrors spec-drift): a repo that hasn't re-ingested
 * code in ACTIVITY_WINDOW_DAYS can't have new coverage, so scanning is pure
 * LLM waste.
 */
export interface SpecTestLinkerOptions {
  /** When set, only specs whose `repo` column matches this `owner/name` are
   * processed. Used by the post-ingest trigger so we don't sweep every team
   * schema on every push. The content-hash gate still skips unchanged specs. */
  repoFilter?: string;
  /** Attribution written to spec_coverage_runs.linked_by. Defaults to `cron`
   * for direct job-runner invocations; the webhook trigger sets `webhook`;
   * the BYO-compute MCP `persist_spec_link` sets `local:{agent_id}`. */
  linkedBy?: string;
}

export async function specTestLinkerJob(opts: SpecTestLinkerOptions = {}): Promise<string> {
  const schemas = await getLinkSchemas();
  if (schemas.length === 0) {
    console.log("[job] spec-test-linker: no spec_test_links tables found (run migrations)");
    return "No spec_test_links tables found";
  }
  const { repoFilter, linkedBy = "cron" } = opts;

  let totalSpecs = 0;
  let totalSkipped = 0;
  let totalLinks = 0;
  let totalPruned = 0;
  let totalStatements = 0;
  let truncatedSpecs = 0;

  for (const schema of schemas) {
    const specs = repoFilter
      ? await query<SpecRow>(
          `SELECT repo, file_path, content, ingested_at, embedding
           FROM ${schema}.chunks
           WHERE content_type = 'spec' AND repo = $1
           ORDER BY file_path, ingested_at`,
          [repoFilter],
        )
      : await query<SpecRow>(
          `SELECT repo, file_path, content, ingested_at, embedding
           FROM ${schema}.chunks
           WHERE content_type = 'spec'
           ORDER BY repo, file_path, ingested_at`,
        );
    if (specs.length === 0) continue;

    // The 7-day activity window is a sweep optimisation; a triggered run
    // for a known-just-ingested repo (`repoFilter`) bypasses it.
    let activeRepos: Set<string> | null = null;
    if (!repoFilter) {
      const activeRepoRows = await query<{ repo: string }>(
        `SELECT DISTINCT repo FROM ${schema}.chunks
         WHERE content_type = 'code'
           AND ingested_at > now() - ($1 || ' days')::interval`,
        [String(ACTIVITY_WINDOW_DAYS)],
      );
      activeRepos = new Set(activeRepoRows.map((row) => row.repo));
    }

    const codeCache = new Map<string, TestChunk[]>();
    const specsByPath = new Map<string, SpecRow[]>();
    for (const s of specs) {
      const key = `${s.repo} ${s.file_path}`;
      const list = specsByPath.get(key) ?? [];
      list.push(s);
      specsByPath.set(key, list);
    }

    for (const [key, chunks] of specsByPath) {
      const head = chunks[0];
      if (activeRepos && !activeRepos.has(head.repo)) continue;
      if (!isAssertionSource(head.file_path)) continue;

      try {
        const fullContent = reassembleSpec(chunks);
        const contentHash = hashSpecContent(fullContent);
        const lastHash = await getLastContentHash(schema, head.repo, head.file_path);
        if (lastHash === contentHash) {
          totalSkipped++;
          continue;
        }

        const statements = segmentStatements(fullContent);
        const classifications = await classifyAllStatements(head.file_path, statements);
        const prunedStmts = await persistStatements(
          schema, head.repo, head.file_path, statements, classifications,
        );
        totalStatements += statements.length;

        const testable = statements
          .filter((s) => classifications.get(s.ordinal)?.testability === "testable")
          .map((s) => ({ ordinal: s.ordinal, text: s.text }));

        const assertions = await extractAssertions(fullContent, head.file_path);

        let testChunks = codeCache.get(head.repo);
        if (!testChunks) {
          const codeRows = await query<CodeRow>(
            `SELECT file_path, content, metadata, embedding
             FROM ${schema}.chunks
             WHERE repo = $1 AND content_type = 'code'`,
            [head.repo],
          );
          testChunks = codeRows
            .filter((row) => isTestFile(row.file_path))
            .map((row) => ({
              file_path: row.file_path,
              content: row.content,
              test_name: deriveTestName(row.metadata) ?? "",
              test_line: toLine(row.metadata),
              embedding: parseEmbedding(row.embedding),
            }))
            .filter((chunk) => chunk.test_name.length > 0);
          codeCache.set(head.repo, testChunks);
        }

        const { candidates, truncated, total } = selectCandidates(
          {
            repo: head.repo,
            file_path: head.file_path,
            content: fullContent,
            embedding: parseEmbedding(head.embedding),
          },
          assertions,
          testChunks,
        );
        if (truncated) {
          truncatedSpecs++;
          console.log(
            `[job] spec-test-linker: ${schema}/${head.repo}:${head.file_path} — ${total} candidates capped at ${MAX_CANDIDATES_PER_SPEC} (${total - MAX_CANDIDATES_PER_SPEC} not judged)`,
          );
        }

        const allJudgments: Judgment[] = [];
        for (const candidate of candidates) {
          const verdict = await judgeLink(
            { file_path: head.file_path, content: fullContent },
            testable,
            candidate,
          );
          allJudgments.push({
            test_file: candidate.test_file,
            test_name: candidate.test_name,
            test_line: candidate.test_line,
            symbol: candidate.symbol,
            match_kind: candidate.match_kind,
            ...verdict,
          });
        }
        const confirmed = argmaxByTest(allJudgments);
        const pruned = await persistLinks(schema, head.repo, head.file_path, confirmed);
        await recordContentHash(schema, head.repo, head.file_path, contentHash, linkedBy);

        totalSpecs++;
        totalLinks += confirmed.length;
        totalPruned += pruned;
        console.log(
          `[job] spec-test-linker: ${schema}/${head.repo}:${head.file_path} — ${statements.length} statements (${testable.length} testable, ${prunedStmts} pruned), ${confirmed.length} links (${pruned} pruned)`,
        );
        void key;
      } catch (err) {
        console.error(`[job] spec-test-linker: error on ${schema}/${head.repo}:${head.file_path}:`, err);
      }
    }
  }

  const summary = `Linked ${totalLinks} tests across ${totalSpecs} specs (${totalSkipped} unchanged-skipped, ${totalStatements} statements, ${totalPruned} pruned links, ${truncatedSpecs} candidate-capped)`;
  console.log(`[job] spec-test-linker: ${summary}`);
  return summary;
}

function toLine(metadata: Record<string, unknown> | null): number | null {
  const raw = metadata?.["start_line"];
  const line = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(line) ? line : null;
}
