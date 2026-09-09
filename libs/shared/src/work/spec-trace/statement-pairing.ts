/** Match which new statement replaced which old one; pure, no stable statement identity across edits. */

/** Threshold below which statements are unrelated; set where single-clause edits pair but different sentences do not. */
const MIN_SIMILARITY = 0.45;

/** Pair removed statements to replacements by similarity; each addition claimed once. */
export function pairRewrites(
  removed: string[],
  added: string[],
): Map<string, string | null> {
  const candidates = rankedCandidates(removed, added);
  const pairs = new Map<string, string | null>(
    removed.map((before) => [before, null]),
  );
  const claimed = new Set<string>();

  for (const { before, after } of candidates) {
    if (pairs.get(before) !== null || claimed.has(after)) {
      continue;
    }
    pairs.set(before, after);
    claimed.add(after);
  }

  return pairs;
}

/** Every above-threshold before/after combination, best score first; ties broken by text so the output is stable run to run. */
function rankedCandidates(
  removed: string[],
  added: string[],
): Array<{ before: string; after: string; score: number }> {
  return removed
    .flatMap((before) =>
      added.map((after) => ({
        before,
        after,
        score: similarity(before, after),
      })),
    )
    .filter((candidate) => candidate.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score || a.after.localeCompare(b.after));
}

/** Jaccard overlap of token sets; deliberately crude for diff rendering only. */
function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);

  if (!ta.size || !tb.size) {
    return 0;
  }
  let shared = 0;

  for (const token of ta) {
    if (tb.has(token)) {
      shared += 1;
    }
  }

  return shared / (ta.size + tb.size - shared);
}

/** Words, lowercased, punctuation stripped — the unit similarity is measured in. */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}
