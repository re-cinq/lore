/**
 * statement-pairing — works out which new statement replaced which old one.
 *
 * Statements have no stable identity across an edit: the graph holds the text
 * it last projected, the head file holds the text as it stands now, and nothing
 * links the two. That is why the delta reports "changed" without distinguishing
 * edited from deleted.
 *
 * For rendering, though, the distinction is the whole value — quoting only the
 * text the file no longer contains tells a reviewer nothing about what it
 * became. Pairing by similarity recovers enough to show a real before/after,
 * and declines to guess when nothing is close enough.
 */

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

/**
 * Jaccard overlap of the two token sets. Deliberately crude: an edit that keeps
 * most of a sentence scores high, an unrelated sentence scores near zero, and
 * nothing in between needs to be precise because the result is only used to
 * decide whether a diff is worth showing.
 */
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

/**
 * Below this, two statements are treated as unrelated and the old one is
 * reported as deleted rather than rewritten. Set where a one-clause edit still
 * pairs but a different sentence in the same section does not.
 */
const MIN_SIMILARITY = 0.45;

/**
 * Maps each removed statement to its most likely replacement, or null when
 * nothing is close enough. Greedy by descending similarity, and each addition
 * is consumed once — two statements cannot both claim the same replacement.
 */
export function pairRewrites(
  removed: string[],
  added: string[],
): Map<string, string | null> {
  const candidates = removed
    .flatMap((before) =>
      added.map((after) => ({
        before,
        after,
        score: similarity(before, after),
      })),
    )
    .filter((c) => c.score >= MIN_SIMILARITY)
    // Ties broken by text so the output is stable run to run.
    .sort((a, b) => b.score - a.score || a.after.localeCompare(b.after));

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
