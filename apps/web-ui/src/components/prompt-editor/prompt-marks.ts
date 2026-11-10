export interface Range {
  from: number;
  to: number;
}

interface MarkRange extends Range {
  /** The characters that format the mark rather than say anything, hidden away from the cursor. */
  markup: Range[];
}

export type PromptMark =
  | (MarkRange & { kind: "heading"; level: number })
  | (MarkRange & { kind: "bold" | "placeholder" | "tag" });

const HEADING = /^(#{1,6}) /gm;
const BOLD = /\*\*[^*\n]+\*\*/g;
const PLACEHOLDER = /\{[a-z_]+\}/g;
const TAG = /<\/?[a-z_-]+>/g;

/** What a prompt's text formats, as ranges into the text itself, in text order; nothing here changes a character. */
export function promptMarks(text: string): PromptMark[] {
  return [
    ...headings(text),
    ...bolds(text),
    ...tokens(text, PLACEHOLDER, "placeholder"),
    ...tokens(text, TAG, "tag"),
  ].sort((a, b) => a.from - b.from);
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

function bolds(text: string): PromptMark[] {
  return [...text.matchAll(BOLD)].map((match) => {
    const from = match.index;
    const to = from + match[0].length;

    return {
      kind: "bold",
      from,
      to,
      markup: [
        { from, to: from + 2 },
        { from: to - 2, to },
      ],
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
  const markup = marks.flatMap((mark) => mark.markup);

  if (selection === null) {
    return markup;
  }
  const shown = linesAround(text, selection);

  return markup.filter(
    (range) => range.to <= shown.from || range.from > shown.to,
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

const BLOCK_LINE = /^\s*(#{1,6} |[-*+] |\d+\. |>|\|)/;
const FENCE = /^\s*```/;

interface Line extends Range {
  text: string;
}

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

function linesOf(text: string): Line[] {
  let from = 0;

  return text.split("\n").map((lineText) => {
    const line = { from, to: from + lineText.length, text: lineText };

    from = line.to + 1;

    return line;
  });
}

// A fence line and every line inside a fence are code, never prose.
function proseLines(lines: Line[]): boolean[] {
  let fenced = false;

  return lines.map(({ text }) => {
    if (FENCE.test(text)) {
      fenced = !fenced;

      return false;
    }

    return !fenced && text.trim() !== "" && !BLOCK_LINE.test(text);
  });
}
