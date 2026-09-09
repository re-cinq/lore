/** The distinctive terms of a natural-language query — what every keyword leg (chunks, memories, facts) searches for instead of the whole sentence. */

// Common words dropped so a paragraph-length query matches on its distinctive terms, not filler.
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

function isKeyTermCandidate(lower: string, seen: Set<string>): boolean {
  return lower.length > 2 && !STOPWORDS.has(lower) && !seen.has(lower);
}

/** The terms as a `websearch_to_tsquery` input: any one of them matches, so a memory about one distinctive word of the question still surfaces. Falls back to the raw query when nothing distinctive is left. */
export function keyTermsQuery(query: string): string {
  return extractKeyTerms(query).join(" OR ") || query;
}
