// Pure judge helpers shared by the spec-test linker and the spec-coverage prepare/persist endpoints, so both sides use the same candidate-selection and segmentation contract.
import { createHash } from "node:crypto";
import { isTestFile, normalizeTestName } from "./test-paths.js";
import {
  cosineSimilarity,
  hasDirectoryAffinity,
  matchedAssertion,
  parseEmbedding,
  specFeatureSlug,
} from "./spec-judge-signals.js";
import type { Chunk } from "./models/chunk.js";

export {
  cosineSimilarity,
  hasDirectoryAffinity,
  matchedAssertion,
  parseEmbedding,
  specFeatureSlug,
};

// ── Types ────────────────────────────────────────────────────────────

export interface Assertion {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "endpoint" | "other";
  description: string;
}

export type MatchKind = "assertion" | "directory" | "embedding";

// Judge-pipeline output, not a DB row — spec_test_links was dropped in migration 0008; the source of truth is now the inline markdown link.
// eslint-disable-next-line re-lint/no-row-types-outside-models
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

/** A code chunk read as a candidate test; content pinned to the chunks model. */
export type TestChunk = Pick<Chunk, "content"> & {
  file_path: string;
  test_name: string;
  test_line: number | null;
  embedding: number[] | null;
};

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

// Judge-pipeline output, not a DB row — same as SpecTestLink above.
// eslint-disable-next-line re-lint/no-row-types-outside-models
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

/** Normalized `describe › it` name from a chunk's AST metadata, or null when it names no test symbol. */
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

// Pre-filters test chunks by three signals (assertion/directory/embedding), dedupes by (test_file, test_name) keeping the strongest, caps at maxCandidates, and flags `truncated` so the caller can log drops instead of silently under-reporting coverage.
export function selectCandidates(
  spec: SpecInput,
  assertions: Assertion[],
  codeChunks: TestChunk[],
  options: { maxCandidates?: number; embeddingThreshold?: number } = {},
): CandidateSelection {
  const maxCandidates = options.maxCandidates ?? MAX_CANDIDATES_PER_SPEC;
  const threshold = options.embeddingThreshold ?? EMBEDDING_THRESHOLD;
  const byKey = strongestByTest(codeChunks, assertions, spec, threshold);
  const ranked = [...byKey.values()].sort(
    (a, b) => KIND_RANK[b.match_kind] - KIND_RANK[a.match_kind],
  );

  return {
    candidates: ranked.slice(0, maxCandidates),
    truncated: ranked.length > maxCandidates,
    total: ranked.length,
  };
}

/** One strongest candidate per (test_file, test_name), keyed for dedupe. */
function strongestByTest(
  codeChunks: TestChunk[],
  assertions: Assertion[],
  spec: SpecInput,
  threshold: number,
): Map<string, JudgeCandidate> {
  const byKey = new Map<string, JudgeCandidate>();

  for (const chunk of codeChunks) {
    const candidate = buildCandidate(chunk, assertions, spec, threshold);

    if (candidate) {
      upsertStrongestCandidate(byKey, candidate);
    }
  }

  return byKey;
}

/** The candidate for one test chunk, or null when it isn't a test or matches none of the three signals. */
function buildCandidate(
  chunk: TestChunk,
  assertions: Assertion[],
  spec: SpecInput,
  threshold: number,
): JudgeCandidate | null {
  if (!isTestFile(chunk.file_path) || chunk.test_name.length === 0) {
    return null;
  }

  const symbol = matchedAssertion(chunk.content, assertions);
  const kind = matchKindFor(symbol, spec, chunk, threshold);

  if (!kind) {
    return null;
  }

  return candidateFrom(chunk, kind, symbol);
}

/** The strongest pre-filter signal linking a test chunk to the spec, or null. */
function matchKindFor(
  symbol: string | null,
  spec: SpecInput,
  chunk: TestChunk,
  threshold: number,
): MatchKind | null {
  if (symbol) {
    return "assertion";
  }

  if (hasDirectoryAffinity(spec.file_path, chunk.file_path)) {
    return "directory";
  }

  if (embeddingMatches(spec, chunk, threshold)) {
    return "embedding";
  }

  return null;
}

/** True when both sides carry an embedding and their cosine similarity clears `threshold`. */
function embeddingMatches(
  spec: SpecInput,
  chunk: TestChunk,
  threshold: number,
): boolean {
  const { embedding } = spec;

  return Boolean(
    embedding &&
    chunk.embedding &&
    cosineSimilarity(embedding, chunk.embedding) >= threshold,
  );
}

/** The candidate row for a matched chunk; the symbol is kept only for an assertion match. */
function candidateFrom(
  chunk: TestChunk,
  kind: MatchKind,
  symbol: string | null,
): JudgeCandidate {
  return {
    test_file: chunk.file_path,
    test_name: chunk.test_name,
    test_line: chunk.test_line,
    symbol: kind === "assertion" ? symbol : null,
    match_kind: kind,
    content: chunk.content,
  };
}

/** Keeps `candidate` in `byKey` only if it beats (or there is no) existing entry for the same test. */
function upsertStrongestCandidate(
  byKey: Map<string, JudgeCandidate>,
  candidate: JudgeCandidate,
): void {
  const key = candidateKey(candidate);
  const existing = byKey.get(key);

  if (
    !existing ||
    KIND_RANK[candidate.match_kind] > KIND_RANK[existing.match_kind]
  ) {
    byKey.set(key, candidate);
  }
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

// Best-match-per-test reducer: keeps the highest `match_score` per (test_file, test_name), drops rows below `threshold` — a statement may win several tests, but a test only ever keeps one.
export function argmaxByTest(
  judgments: Judgment[],
  threshold = JUDGE_SCORE_THRESHOLD,
): Judgment[] {
  const best = new Map<string, Judgment>();

  for (const j of judgments) {
    if (isEligibleJudgment(j, threshold)) {
      keepIfHigherScore(best, j);
    }
  }

  return [...best.values()];
}

function isEligibleJudgment(j: Judgment, threshold: number): boolean {
  return j.matches && j.match_score >= threshold;
}

function keepIfHigherScore(best: Map<string, Judgment>, j: Judgment): void {
  const key = candidateKey(j);
  const existing = best.get(key);

  if (!existing || j.match_score > existing.match_score) {
    best.set(key, j);
  }
}

function candidateKey(link: { test_file: string; test_name: string }): string {
  return `${link.test_file} ${link.test_name}`;
}

/** sha-256 hex digest of the spec content; used by the freshness gate. */
export function hashSpecContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
