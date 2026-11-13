import type { KindMark, Line, MarkRange, Range } from "./ranges";

export type LineBlock =
  | (MarkRange & { kind: "list"; depth: number; marker: Range })
  | KindMark<"quote" | "rule">;

const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,}) *$/;
const LIST_ITEM = /^( *)([-*+]|\d+\.)(?= )/;
const QUOTE = /^ {0,3}> ?/;
const INDENT_PER_DEPTH = 2;

/** The lines that are a list item, a quote or a horizontal rule, one mark each over the line. */
export function lineBlocks(lines: Line[]): LineBlock[] {
  return lines.flatMap((line) => {
    const block = ruleOf(line) ?? quoteOf(line) ?? listItemOf(line);

    return block ? [block] : [];
  });
}

function ruleOf({ from, to, text }: Line): LineBlock | null {
  return RULE.test(text)
    ? { kind: "rule", from, to, markup: [{ from, to }] }
    : null;
}

function quoteOf({ from, to, text }: Line): LineBlock | null {
  const opener = QUOTE.exec(text)?.[0];

  return opener === undefined
    ? null
    : { kind: "quote", from, to, markup: [{ from, to: from + opener.length }] };
}

function listItemOf({ from, to, text }: Line): LineBlock | null {
  const match = LIST_ITEM.exec(text);

  if (match === null) {
    return null;
  }
  const [, indent, marker] = match;
  const markerFrom = from + indent.length;

  return {
    kind: "list",
    from,
    to,
    depth: Math.floor(indent.length / INDENT_PER_DEPTH),
    marker: { from: markerFrom, to: markerFrom + marker.length },
    markup: [],
  };
}
