import type { queryLiveGraph } from "./live-graph.js";
import type { searchMemories } from "./memory-search.js";
import type { SourceItem } from "./context-assembly-format.js";

/** Token estimation, item construction, and budget-packing helpers shared by every context-assembly source. */

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate at a paragraph boundary; no inline marker — the `truncated="true"` document attribute carries that signal instead. */
export function truncateText(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;

  if (text.length <= maxChars) {
    return text;
  }
  const cut = text.substring(0, maxChars);
  const lastParagraph = cut.lastIndexOf("\n\n");

  return lastParagraph > maxChars * 0.5 ? cut.substring(0, lastParagraph) : cut;
}

export function mkItem(
  text: string,
  extra: Partial<SourceItem> = {},
): SourceItem {
  return { text, tokens: estimateTokens(text), ...extra };
}

/** Append one graph item per relation line not already in `seen`. */
export function addUniqueGraphLines(
  graphResults: Awaited<ReturnType<typeof queryLiveGraph>>,
  seen: Set<string>,
  sources: SourceItem[],
): void {
  for (const r of graphResults) {
    const line = `${r.entity} (${r.entity_type}) --${r.relation}--> ${r.related_entity} (${r.related_type})`;

    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    sources.push(mkItem(line, { content_type: "graph" }));
  }
}

/** Split search-result ids into memory refs and fact refs (outcome feedback). */
export function collectContextRefIds(
  results: Awaited<ReturnType<typeof searchMemories>>,
  memoryIds: string[],
  factIds: string[],
): void {
  for (const r of results) {
    if (!r.id) {
      continue;
    }

    if (r.source === "memory") {
      memoryIds.push(r.id);
      continue;
    }
    factIds.push(r.id);
  }
}

export function toScore(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  const n = typeof value === "number" ? value : Number(value);

  return Number.isFinite(n) ? n : undefined;
}

export function toIso(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new Date(value as string | number | Date).toISOString();
  } catch {
    return undefined;
  }
}

/** Pack sources into a token budget: keep whole sources, truncate the overflow source, drop the rest. `maxPerDocTokens` caps any single document so a mega-doc can't crowd out smaller ones. */
export function fitItemsToBudget(
  sources: SourceItem[],
  budgetTokens: number,
  maxPerDocTokens?: number,
): { kept: SourceItem[]; truncated: boolean } {
  const kept: SourceItem[] = [];
  let used = 0;
  let truncated = false;

  for (const it of sources) {
    const remaining = budgetTokens - used;

    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const limit = Math.min(remaining, maxPerDocTokens ?? Infinity);

    if (it.tokens <= limit) {
      kept.push(it);
      used += it.tokens;
      continue;
    }
    const text = truncateText(it.text, limit);
    const tokens = estimateTokens(text);

    kept.push({ ...it, text, tokens });
    used += tokens;
    truncated = true;

    // Stop only when the BUDGET was the binding limit; a per-doc cap leaves room to keep packing.
    if (limit >= remaining) {
      break;
    }
  }

  return { kept, truncated };
}

// Common words dropped from the keyword leg so a paragraph-length query matches on its distinctive terms, not filler.
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "that",
  "this",
  "these",
  "those",
  "is",
  "are",
  "be",
  "as",
  "it",
  "its",
  "into",
  "via",
  "per",
  "add",
  "use",
  "using",
  "new",
  "update",
  "edit",
  "change",
  "make",
  "set",
  "get",
  "also",
  "should",
  "would",
  "can",
  "will",
  "not",
  "but",
  "so",
  "if",
  "when",
  "then",
  "than",
  "they",
  "their",
  "you",
  "your",
  "we",
  "our",
]);

/** Distinctive terms from a query: drop stopwords + ≤2-char words, de-dupe case-insensitively, preserve order, cap at `max`. */
function isKeyTermCandidate(lower: string, seen: Set<string>): boolean {
  return lower.length > 2 && !STOPWORDS.has(lower) && !seen.has(lower);
}

export function extractKeyTerms(query: string, max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of query.split(/[^A-Za-z0-9_.-]+/)) {
    const lower = raw.toLowerCase();

    if (!isKeyTermCandidate(lower, seen)) {
      continue;
    }
    seen.add(lower);
    out.push(raw);

    if (out.length >= max) {
      break;
    }
  }

  return out;
}

/** Filter out sources already emitted in an earlier section (keyed by source path, else text) — keeps a document in its highest-priority section only. */
export function dropSeen(
  sources: SourceItem[],
  seen: Set<string>,
): SourceItem[] {
  const kept: SourceItem[] = [];

  for (const it of sources) {
    const key = it.source_path || it.text;

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(it);
  }

  return kept;
}

/** Rescale item scores so the top result is 1.0 — RRF/ts_rank raw scores are tiny (~0.02) and unreadable as relevance. No-op with no positive score. */
export function normalizeScores(sources: SourceItem[]): SourceItem[] {
  const max = Math.max(0, ...sources.map((s) => s.score ?? 0));

  if (max <= 0) {
    return sources;
  }

  return sources.map((i) =>
    i.score != null ? { ...i, score: i.score / max } : i,
  );
}
