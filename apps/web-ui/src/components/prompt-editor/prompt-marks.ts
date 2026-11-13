import { fencedBlocks, type FencedBlock } from "./fenced-blocks";
import { lineBlocks, type LineBlock } from "./line-blocks";
import { tableBlocks, type Table, type TableBlock } from "./tables";
import { inlineMarks, type InlineMark } from "./inline-marks";
import { codeTokens, type CodeToken } from "./code-tokens";
import {
  blanked,
  linesOf,
  type KindMark,
  type Line,
  type MarkRange,
  type Range,
} from "./ranges";

export type { Range };

export type PromptMark =
  | (MarkRange & { kind: "heading"; level: number })
  | KindMark<"placeholder" | "tag">
  | (MarkRange & { kind: "token"; className: string })
  | InlineMark
  | LineBlock
  | (MarkRange & { kind: "fence"; block: true; lineStarts: number[] })
  | (MarkRange & {
      kind: "table";
      block: true;
      lineStarts: number[];
      table: Table;
    });

const HEADING = /^(#{1,6}) /gm;
const PLACEHOLDER = /\{[a-z_]+\}/g;
const TAG = /<\/?[a-z_-]+>/g;

/** What a prompt's text formats, as ranges into the text itself, in text order; nothing here changes a character. */
export function promptMarks(text: string): PromptMark[] {
  const fences = fencedBlocks(linesOf(text));
  const prose = blanked(text, fences);
  const tables = tableBlocks(linesOf(prose));
  const formatted = blanked(prose, tables);
  const inline = inlineMarks(formatted);
  const codes = inline.filter((mark) => mark.kind === "code");
  const unquoted = blanked(formatted, codes);
  // A placeholder or a tag in a table is still one: the run reads it whatever draws the table.
  const tokenText = blanked(prose, codes);

  return [
    ...fences.map(fenceMark),
    ...codeTokens(text, fences).map(tokenMark),
    ...tables.map(tableMark),
    ...headings(unquoted),
    ...lineBlocks(linesOf(unquoted)),
    ...inline,
    ...tokens(tokenText, PLACEHOLDER, "placeholder"),
    ...tokens(tokenText, TAG, "tag"),
  ].sort((a, b) => a.from - b.from);
}

function tableMark(block: TableBlock): PromptMark {
  return {
    kind: "table",
    block: true,
    from: block.from,
    to: block.to,
    lineStarts: block.lines.map((line) => line.from),
    markup: [{ from: block.from, to: block.to }],
    table: block.table,
  };
}

function tokenMark(token: CodeToken): PromptMark {
  return { kind: "token", markup: [], ...token };
}

function fenceMark(block: FencedBlock): PromptMark {
  return {
    kind: "fence",
    block: true,
    from: block.from,
    to: block.to,
    lineStarts: block.lines.map((line) => line.from),
    markup: [block.opening, ...(block.closing ? [block.closing] : [])].map(
      ({ from, to }) => ({ from, to }),
    ),
  };
}

function headings(text: string): PromptMark[] {
  return [...text.matchAll(HEADING)].map((match) => {
    const from = match.index;
    const lineEnd = text.indexOf("\n", from);

    return {
      kind: "heading",
      level: match[1].length,
      from,
      to: lineEnd === -1 ? text.length : lineEnd,
      markup: [{ from, to: from + match[0].length }],
    };
  });
}

// A placeholder or a tag is shown whole: the run reads its braces and brackets, so none of it is markup.
function tokens(
  text: string,
  pattern: RegExp,
  kind: "placeholder" | "tag",
): PromptMark[] {
  return [...text.matchAll(pattern)].map((match) => ({
    kind,
    from: match.index,
    to: match.index + match[0].length,
    markup: [],
  }));
}

/** The markup to hide: every mark's markup except on the lines the selection touches, where it shows so it can be edited; a null selection, nothing being edited, hides it all. */
export function collapsedMarkup(
  text: string,
  marks: PromptMark[],
  selection: Range | null,
): Range[] {
  if (selection === null) {
    return marks.flatMap((mark) => mark.markup);
  }
  const shown = linesAround(text, selection);

  return marks.flatMap((mark) =>
    mark.markup.filter((range) => {
      // A block's markup shows while the selection is anywhere in the block.
      const zone = "block" in mark ? mark : range;

      return zone.to <= shown.from || zone.from > shown.to;
    }),
  );
}

// From the start of the selection's first line to the end of its last.
function linesAround(text: string, selection: Range): Range {
  const lineEnd = text.indexOf("\n", selection.to);

  return {
    from: text.lastIndexOf("\n", selection.from - 1) + 1,
    to: lineEnd === -1 ? text.length : lineEnd,
  };
}

const BLOCK_LINE = /^\s*(#{1,6} |[-*+] |\d+\. |>|\||-{3,}\s*$)/;

/** The prompt with each paragraph's wrapping line breaks turned into spaces; list, heading, quote, table and code lines keep theirs. */
export function joinedParagraphs(saved: string): string {
  // A form submission turns every line break into CRLF, and CodeMirror breaks a line at a lone CR too.
  const text = saved.replace(/\r\n?/g, "\n");
  const soft = new Set(softBreaks(text).map((lineBreak) => lineBreak.from));

  return text
    .split("")
    .map((character, index) => (soft.has(index) ? " " : character))
    .join("");
}

/** The line breaks that only wrap a paragraph. */
export function softBreaks(text: string): Range[] {
  const lines = linesOf(text);
  const prose = proseLines(lines);

  return lines
    .slice(0, -1)
    .filter((_line, index) => prose[index] && prose[index + 1])
    .map((line) => ({ from: line.to, to: line.to + 1 }));
}

// The lines of a fenced block or a table are code and rows, never prose.
function proseLines(lines: Line[]): boolean[] {
  const fenced = fencedBlocks(lines).flatMap((block) => block.lines);
  const outsideFences = lines.map((line) =>
    fenced.includes(line) ? { ...line, text: "" } : line,
  );
  const tabled = tableBlocks(outsideFences).flatMap((block) => block.lines);
  const structured = new Set([...fenced, ...tabled].map((line) => line.from));

  return lines.map(
    ({ from, text }) =>
      !structured.has(from) && text.trim() !== "" && !BLOCK_LINE.test(text),
  );
}
