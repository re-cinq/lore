/** impact-render: pure string helpers normalizing verbatim statement text (inline links, newlines, pipes) for the sticky-impact markdown table. */

/** Longest statement text a table cell shows before it is cut. */
const MAX_STATEMENT_CHARS = 120;

/** Trailing markdown-link parenthetical (v3 inline coverage annotation), and the period a statement may close on after it; one level of paren nesting allowed for link targets. */
const TRAILING_LINK_GROUP = /\s*\((?:[^()]|\([^()]*\))*\)\s*(\.?)\s*$/;

/** Statement text made safe for a markdown table cell: {@link statementProse} with pipes escaped. */
export const summarizeStatement = (text: string): string =>
  statementProse(text).replace(/\|/g, "\\|");

/** A statement as one bounded line of prose: {@link wholeProse} with its length bounded. */
export function statementProse(text: string): string {
  const flat = wholeProse(text);

  return flat.length > MAX_STATEMENT_CHARS
    ? `${flat.slice(0, MAX_STATEMENT_CHARS - 1)}…`
    : flat;
}

/** A statement as one unbounded line of prose, coverage links stripped and whitespace collapsed, so two statements match here only when their words do. */
export function wholeProse(text: string): string {
  return (
    withoutTrailingLinks(text)
      // Strip leading blockquote/list markers only when followed by whitespace (renderer adds its own quoting; otherwise "**bold" loses a star).
      .replace(/^[>\s]*(?:[-*+]\s+|\d+\.\s+)?/, "")
      .replace(/\s+/g, " ")
      .trim()
      // Removing a link group by hand can leave its closing period standing apart.
      .replace(/ \.$/, ".")
  );
}

/** The statement without the link groups it ends on, keeping a period that closed it after them. */
function withoutTrailingLinks(text: string): string {
  const match = text.match(TRAILING_LINK_GROUP);

  if (!match?.[0].includes("](")) {
    return text;
  }
  // Recursive: a statement can end with several link parentheticals in a row.
  const rest = withoutTrailingLinks(text.slice(0, match.index).trimEnd());

  return match[1] && !rest.endsWith(".") ? `${rest}.` : rest;
}

/** Slices a before/after pair to the neighbourhood of the first divergence, not a fixed prefix — a long shared prefix would otherwise hide the actual edit. */
export function windowRewrite(
  before: string,
  after: string,
  width = 110,
): { before: string; after: string } {
  const head = commonPrefixLength(before, after);
  const tail = commonSuffixLength(before, after, head);
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

function commonPrefixLength(before: string, after: string): number {
  let head = 0;

  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  ) {
    head += 1;
  }

  return head;
}

function commonSuffixLength(
  before: string,
  after: string,
  head: number,
): number {
  let tail = 0;

  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  return tail;
}
