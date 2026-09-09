import type { RangeEntry } from "./spec-index.js";

/** Extracted from extension.ts so this logic can run outside a VS Code host. */
export function resolveCredentialField(
  raw: string | undefined,
  fallback: string | null,
): string | null {
  const trimmed = raw?.trim();

  return trimmed || fallback;
}

export interface LineRange {
  start: number;
  end: number;
}

export function decorationRange(
  entry: RangeEntry,
  lastLine: number,
): LineRange {
  const start = Math.min(Math.max(entry.startLine - 1, 0), lastLine);
  const end = Math.min(Math.max(entry.endLine - 1, start), lastLine);

  return { start, end };
}

export function entriesForPath(
  index: Map<string, RangeEntry[]>,
  relPath: string | null,
): RangeEntry[] {
  return relPath ? (index.get(relPath) ?? []) : [];
}

export interface EntriesByLayer {
  implemented: RangeEntry[];
  covered: RangeEntry[];
}

export function partitionByLayer(entries: RangeEntry[]): EntriesByLayer {
  const implemented: RangeEntry[] = [];
  const covered: RangeEntry[] = [];

  for (const entry of entries) {
    (entry.layer === "implemented" ? implemented : covered).push(entry);
  }

  return { implemented, covered };
}
