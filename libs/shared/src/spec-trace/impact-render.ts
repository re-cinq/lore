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
  const flat = stripped.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");

  return flat.length > MAX_STATEMENT_CHARS
    ? `${flat.slice(0, MAX_STATEMENT_CHARS - 1)}…`
    : flat;
}
