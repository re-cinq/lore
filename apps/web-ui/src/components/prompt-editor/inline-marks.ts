import { blanked, type KindMark } from "./ranges";

export type InlineMark = KindMark<"bold" | "italic" | "code" | "link">;

interface Delimiter {
  kind: InlineMark["kind"];
  pattern: RegExp;
  /** How many characters open and close the mark: the markup around what it says. */
  widths(match: RegExpMatchArray): [number, number];
  /** Whether what the mark holds may carry marks of its own, so it does not blank its text for the kinds after it. */
  transparent?: boolean;
}

const symmetric = (width: number) => (): [number, number] => [width, width];

const CODE: Delimiter = {
  kind: "code",
  pattern: /`[^`\n]+`/g,
  widths: symmetric(1),
};
const LINK: Delimiter = {
  kind: "link",
  pattern: /(?<!!)\[([^\]\n]+)\]\([^)\s]+\)/g,
  widths: (match) => [1, match[0].length - match[1].length - 1],
  transparent: true,
};
const BOLD: Delimiter = {
  kind: "bold",
  pattern: /\*\*[^*\n]+\*\*/g,
  widths: symmetric(2),
};
const STAR_ITALIC: Delimiter = {
  kind: "italic",
  pattern: /(?<![\w*])\*(?![\s*])[^*\n]+?(?<![\s*])\*(?![\w*])/g,
  widths: symmetric(1),
};
const UNDERSCORE_ITALIC: Delimiter = {
  kind: "italic",
  pattern: /(?<![\w_])_(?![\s_])[^_\n]+?(?<![\s_])_(?![\w_])/g,
  widths: symmetric(1),
};

const DELIMITERS = [CODE, LINK, BOLD, STAR_ITALIC, UNDERSCORE_ITALIC];

/** The inline formatting of a text, in text order. Each kind is found in what the kinds before it left, so what sits inside a code span is code and nothing else, and a bold's stars are never an italic's. */
export function inlineMarks(text: string): InlineMark[] {
  const found = DELIMITERS.reduce<{ marks: InlineMark[]; left: string }>(
    ({ marks, left }, delimiter) => {
      const more = delimited(left, delimiter);

      return {
        marks: [...marks, ...more],
        left: delimiter.transparent ? left : blanked(left, more),
      };
    },
    { marks: [], left: text },
  );

  return found.marks.sort((a, b) => a.from - b.from);
}

function delimited(text: string, delimiter: Delimiter): InlineMark[] {
  return [...text.matchAll(delimiter.pattern)].map((match) => {
    const from = match.index;
    const to = from + match[0].length;
    const [open, close] = delimiter.widths(match);

    return {
      kind: delimiter.kind,
      from,
      to,
      markup: [
        { from, to: from + open },
        { from: to - close, to },
      ],
    };
  });
}
