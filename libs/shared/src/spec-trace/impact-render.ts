/**
 * impact-render — presentation helpers for the sticky impact comment.
 *
 * Kept apart from the graph walk because they are pure string work with their
 * own failure modes: a statement is stored verbatim, so it arrives carrying the
 * author's inline `([validated by …](path#Lnn))` links, arbitrary newlines, and
 * any pipe character that happens to be in the prose — all of which have to be
 * neutralised before it can sit in a markdown table cell.
 */

/** Longest statement text a table cell shows before it is cut. */
const MAX_STATEMENT_CHARS = 120;

/**
 * A trailing parenthetical containing a markdown link — the v3 inline coverage
 * annotation. Matched with one level of nesting allowed, because a link target
 * may itself contain parentheses.
 */
const TRAILING_LINK_GROUP = /\s*\((?:[^()]|\([^()]*\))*\)\s*$/;

/**
 * One statement, safe and readable in a markdown table cell: coverage links
 * dropped (they belong in the Covering-test column, not glued to the prose),
 * whitespace collapsed, pipes escaped, length bounded.
 */
export function summarizeStatement(text: string): string {
  let stripped = text;

  // Repeat: a statement can end with several link parentheticals in a row.
  for (;;) {
    const match = stripped.match(TRAILING_LINK_GROUP);

    if (!match || !match[0].includes("](")) {
      break;
    }
    stripped = stripped.slice(0, match.index).trimEnd();
  }
  const flat = stripped
    // Leading blockquote / list markers: the renderer supplies its own quoting,
    // and a statement that already starts with ">" produced "> >". The marker
    // must be followed by whitespace, or "**bold" loses a star to the strip.
    .replace(/^[>\s]*(?:[-*+]\s+|\d+\.\s+)?/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\|/g, "\\|");

  return flat.length > MAX_STATEMENT_CHARS
    ? `${flat.slice(0, MAX_STATEMENT_CHARS - 1)}…`
    : flat;
}

/**
 * Slices a rewritten pair down to the neighbourhood of what actually changed.
 *
 * Truncating both sides at a fixed length hides the edit whenever it falls past
 * the cut — a spec statement is often a paragraph, and the first 120 characters
 * of before and after are usually identical. Anchoring on the first divergence
 * is what makes the diff show the change rather than merely prove one happened.
 */
export function windowRewrite(
  before: string,
  after: string,
  width = 110,
): { before: string; after: string } {
  let head = 0;

  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  ) {
    head += 1;
  }
  let tail = 0;

  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  const start = Math.max(0, head - Math.floor(width / 3));
  const slice = (text: string) => {
    const end = Math.min(
      text.length,
      Math.max(head, text.length - tail) + width,
    );
    const body = text.slice(start, end);

    return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
  };

  return { before: slice(before), after: slice(after) };
}
