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

/** The item as it will be kept — itself when it fits, otherwise a truncated copy. Returning the SAME object when nothing was cut is what lets the caller tell "kept whole" from "kept in part" without re-measuring. */
function fitOne(source: SourceItem, limit: number): SourceItem {
  if (source.tokens <= limit) {
    return source;
  }
  const text = truncateText(source.text, limit);

  return { ...source, text, tokens: estimateTokens(text) };
}

interface PackState {
  kept: SourceItem[];
  used: number;
  truncated: boolean;
}

interface PackBudget {
  budgetTokens: number;
  maxPerDocTokens?: number;
}

/** Pack one source into `state`; false when the budget is spent and packing must stop. */
function packItem(
  state: PackState,
  source: SourceItem,
  { budgetTokens, maxPerDocTokens }: PackBudget,
): boolean {
  const remaining = budgetTokens - state.used;

  if (remaining <= 0) {
    state.truncated = true;

    return false;
  }
  const limit = Math.min(remaining, maxPerDocTokens ?? Infinity);
  const fitted = fitOne(source, limit);

  state.kept.push(fitted);
  state.used += fitted.tokens;

  if (fitted !== source) {
    state.truncated = true;
  }

  // Stop only when the BUDGET was the binding limit; a per-doc cap leaves room to keep packing.
  return fitted === source || limit < remaining;
}

/** Pack sources into a token budget: keep whole sources, truncate the overflow source, drop the rest. `maxPerDocTokens` caps any single document so a mega-doc can't crowd out smaller ones. */
export function fitItemsToBudget(
  sources: SourceItem[],
  budgetTokens: number,
  maxPerDocTokens?: number,
): { kept: SourceItem[]; truncated: boolean } {
  const state: PackState = { kept: [], used: 0, truncated: false };

  for (const source of sources) {
    if (!packItem(state, source, { budgetTokens, maxPerDocTokens })) {
      break;
    }
  }

  return { kept: state.kept, truncated: state.truncated };
}

export { extractKeyTerms } from "../../../domain/key-terms.js";

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
