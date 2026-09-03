// Per-repo override of WHICH files become specs/adrs, authored as `.lore/ingest.yml` (sibling of `.lore/test-commands.yml`); a declared kind REPLACES the built-in prefix defaults (see {@link selectIngestFiles}).

import { minimatch } from "minimatch";

/** Parses the manifest object into `kind → glob[]`, dropping non-array values and non-string entries. */
export function parseIngestPatterns(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string[]> = {};

  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const globs = value.filter(
      (entry): entry is string => typeof entry === "string",
    );

    if (globs.length) {
      out[kind] = globs;
    }
  }

  return out;
}

/** True when `path` matches at least one of the glob `patterns` (minimatch semantics: `**`, `*`, `?`). */
export function matchesAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(path, pattern));
}
