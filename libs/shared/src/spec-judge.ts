/**
 * Pure judge helpers shared by the spec-test linker and the
 * spec-coverage prepare/persist endpoints.
 *
 * The linker (agent-side, batches LLM judgments) and the BYO-compute
 * prepare/persist endpoints (mcp-server-side, surfaces the same shape
 * to a developer's Claude session) both need:
 *   - candidate pre-filtering (assertion overlap / directory affinity /
 *     embedding proximity, capped, truncation-flagged)
 *   - best-match-per-test dedup (argmax over score, threshold τ)
 *   - stale-row identification for re-run pruning
 *   - content hashing for the freshness gate
 *
 * Lives in shared so both sides import the same source of truth — the
 * `(ordinal, text)` segmentation contract from spec-segment.ts MUST
 * stay deterministic across server-side prep and client-side judging,
 * and so must the candidate selection contract.
 */

import { createHash } from "node:crypto";
import { isTestFile, normalizeTestName } from "./test-paths.js";

// ── Types ────────────────────────────────────────────────────────────

export interface Assertion {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "endpoint" | "other";
  description: string;
}

export type MatchKind = "assertion" | "directory" | "embedding";

export interface SpecTestLink {
  test_file: string;
  test_name: string;
  test_line: number | null;
  symbol: string | null;
  match_kind: MatchKind;
  statement_ordinal: number | null;
  statement_text: string | null;
  match_score: number | null;
}

export interface TestChunk {
  file_path: string;
  content: string;
  test_name: string;
  test_line: number | null;
  embedding: number[] | null;
}

export type JudgeCandidate = Omit<
  SpecTestLink,
  "statement_ordinal" | "statement_text" | "match_score"
> & { content: string };

export interface SpecInput {
  repo: string;
  file_path: string;
  content: string;
  embedding: number[] | null;
}

export interface CandidateSelection {
  candidates: JudgeCandidate[];
  truncated: boolean;
  total: number;
}

export interface Judgment {
  test_file: string;
  test_name: string;
  test_line: number | null;
  symbol: string | null;
  match_kind: MatchKind;
  matches: boolean;
  statement_ordinal: number | null;
  statement_text: string | null;
  match_score: number;
  rationale: string;
}

// ── Constants ────────────────────────────────────────────────────────

export const MAX_CANDIDATES_PER_SPEC = 25;
export const EMBEDDING_THRESHOLD = 0.75;
export const JUDGE_SCORE_THRESHOLD = 0.5;

/** Strongest-first ranking so truncation keeps the best signals. */
const KIND_RANK: Record<MatchKind, number> = {
  assertion: 3,
  directory: 2,
  embedding: 1,
};

// ── Pure helpers ─────────────────────────────────────────────────────

/** `specs/local-task-runner/spec.md` → `local-task-runner`. Falls back to the
 * spec file's parent directory. */
export function specFeatureSlug(specPath: string): string | null {
  const parts = specPath.split("/").filter(Boolean);
  const specsIdx = parts.indexOf("specs");

  if (specsIdx >= 0 && parts.length > specsIdx + 2) {
    return parts[specsIdx + 1];
  }

  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }

  return null;
}

function significantTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

/** A test shares a feature directory with the spec when it overlaps at least
 * half of the spec slug's significant tokens. */
export function hasDirectoryAffinity(
  specPath: string,
  testPath: string,
): boolean {
  const slug = specFeatureSlug(specPath);

  if (!slug) {
    return false;
  }
  const slugTokens = new Set(significantTokens(slug));

  if (slugTokens.size === 0) {
    return false;
  }
  const testTokens = new Set(significantTokens(testPath));
  let overlap = 0;

  for (const token of slugTokens) {
    if (testTokens.has(token)) {
      overlap++;
    }
  }

  return overlap >= Math.max(1, Math.ceil(slugTokens.size / 2));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** First assertion symbol the test chunk literally references, or null. */
export function matchedAssertion(
  content: string,
  assertions: Assertion[],
): string | null {
  const lower = content.toLowerCase();

  for (const assertion of assertions) {
    const name = assertion.name.toLowerCase();

    if (name.length >= 3 && lower.includes(name)) {
      return assertion.name;
    }
  }

  return null;
}

/** Builds the normalized `describe › it` name from a chunk's AST metadata, or
 * null when the chunk names no test symbol. */
export function deriveTestName(
  metadata: Record<string, unknown> | null,
): string | null {
  if (!metadata) {
    return null;
  }
  const it = metadata["symbol_name"];

  if (typeof it !== "string" || it.length === 0) {
    return null;
  }
  const parent = metadata["parent_symbol"] ?? metadata["describe"];
  const describe = typeof parent === "string" ? parent : "";

  return normalizeTestName(describe, it);
}

/** pgvector returns embeddings as `"[0.1,0.2,...]"`; parse defensively. */
export function parseEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    return raw as number[];
  }

  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function candidateKey(link: { test_file: string; test_name: string }): string {
  return `${link.test_file} ${link.test_name}`;
}

/**
 * Pre-filters test chunks into judge candidates by three signals — assertion
 * overlap (strongest), directory affinity, embedding proximity. De-duplicates
 * by (test_file, test_name) keeping the strongest signal, then caps at
 * `maxCandidates` keeping the highest-ranked. Returns a `truncated` flag so the
 * caller can log dropped candidates (never silently under-report coverage).
 */
export function selectCandidates(
  spec: SpecInput,
  assertions: Assertion[],
  codeChunks: TestChunk[],
  options: { maxCandidates?: number; embeddingThreshold?: number } = {},
): CandidateSelection {
  const maxCandidates = options.maxCandidates ?? MAX_CANDIDATES_PER_SPEC;
  const threshold = options.embeddingThreshold ?? EMBEDDING_THRESHOLD;
  const byKey = new Map<string, JudgeCandidate>();

  for (const chunk of codeChunks) {
    if (!isTestFile(chunk.file_path) || chunk.test_name.length === 0) {
      continue;
    }

    const symbol = matchedAssertion(chunk.content, assertions);
    let kind: MatchKind | null = null;

    if (symbol) {
      kind = "assertion";
    } else if (hasDirectoryAffinity(spec.file_path, chunk.file_path)) {
      kind = "directory";
    } else if (
      spec.embedding &&
      chunk.embedding &&
      cosineSimilarity(spec.embedding, chunk.embedding) >= threshold
    ) {
      kind = "embedding";
    }

    if (!kind) {
      continue;
    }

    const candidate: JudgeCandidate = {
      test_file: chunk.file_path,
      test_name: chunk.test_name,
      test_line: chunk.test_line,
      symbol: kind === "assertion" ? symbol : null,
      match_kind: kind,
      content: chunk.content,
    };
    const key = candidateKey(candidate);
    const existing = byKey.get(key);

    if (!existing || KIND_RANK[kind] > KIND_RANK[existing.match_kind]) {
      byKey.set(key, candidate);
    }
  }

  const ranked = [...byKey.values()].sort(
    (a, b) => KIND_RANK[b.match_kind] - KIND_RANK[a.match_kind],
  );

  return {
    candidates: ranked.slice(0, maxCandidates),
    truncated: ranked.length > maxCandidates,
    total: ranked.length,
  };
}

/** Existing links no longer confirmed this run — the rows to prune. */
export function staleLinkKeys<
  T extends { test_file: string; test_name: string },
>(existing: T[], confirmed: { test_file: string; test_name: string }[]): T[] {
  const keep = new Set(confirmed.map(candidateKey));

  return existing.filter((link) => !keep.has(candidateKey(link)));
}

/** Existing statement ordinals no longer present this run — to prune. */
export function staleStatementOrdinals(
  existingOrdinals: number[],
  currentOrdinals: number[],
): number[] {
  const keep = new Set(currentOrdinals);

  return existingOrdinals.filter((o) => !keep.has(o));
}

/**
 * Best-match-per-test reducer. For each (test_file, test_name), keep the row
 * with the highest `match_score`; drop everything below `threshold`. A
 * statement may be the best match for several tests; a test is only ever the
 * best match for one statement.
 */
export function argmaxByTest(
  judgments: Judgment[],
  threshold = JUDGE_SCORE_THRESHOLD,
): Judgment[] {
  const best = new Map<string, Judgment>();

  for (const j of judgments) {
    if (!j.matches) {
      continue;
    }

    if (j.match_score < threshold) {
      continue;
    }
    const key = candidateKey(j);
    const existing = best.get(key);

    if (!existing || j.match_score > existing.match_score) {
      best.set(key, j);
    }
  }

  return [...best.values()];
}

/** sha-256 hex digest of the spec content; used by the freshness gate. */
export function hashSpecContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
