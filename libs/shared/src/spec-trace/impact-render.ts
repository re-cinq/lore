/** impact-render: pure string helpers normalizing verbatim statement text (inline links, newlines, pipes) for the sticky-impact markdown table. */

/** Longest statement text a table cell shows before it is cut. */
const MAX_STATEMENT_CHARS = 120;

/** Trailing markdown-link parenthetical (v3 inline coverage annotation); one level of paren nesting allowed for link targets. */
const TRAILING_LINK_GROUP = /\s*\((?:[^()]|\([^()]*\))*\)\s*$/;

/** Statement text made safe for a markdown table cell: coverage links stripped, whitespace collapsed, pipes escaped, length bounded. */
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
    // Strip leading blockquote/list markers only when followed by whitespace (renderer adds its own quoting; otherwise "**bold" loses a star).
    .replace(/^[>\s]*(?:[-*+]\s+|\d+\.\s+)?/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\|/g, "\\|");

  return flat.length > MAX_STATEMENT_CHARS
    ? `${flat.slice(0, MAX_STATEMENT_CHARS - 1)}…`
    : flat;
}

/** Slices a before/after pair to the neighbourhood of the first divergence, not a fixed prefix — a long shared prefix would otherwise hide the actual edit. */
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
