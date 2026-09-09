// The three pre-filter signals the spec-test judge ranks candidates by — path affinity, embedding similarity, literal assertion mention — plus the embedding parsing they need; split out of spec-judge.ts, which keeps the candidate/judgment pipeline.
import type { Assertion } from "./spec-judge.js";

/** A test shares a feature directory with the spec when it overlaps at least half the spec slug's significant tokens. */
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
  const overlap = countOverlap(slugTokens, significantTokens(testPath));

  return overlap >= Math.max(1, Math.ceil(slugTokens.size / 2));
}

/** `specs/local-task-runner/spec.md` → `local-task-runner`; falls back to the spec's parent directory. */
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

/** How many of `slugTokens` also appear in `testTokens`. */
function countOverlap(slugTokens: Set<string>, testTokens: string[]): number {
  const present = new Set(testTokens);
  let overlap = 0;

  for (const token of slugTokens) {
    if (present.has(token)) {
      overlap++;
    }
  }

  return overlap;
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
