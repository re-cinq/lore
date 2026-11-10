export interface Range {
  from: number;
  to: number;
}

export interface MarkRange extends Range {
  /** The characters that format the mark rather than say anything, hidden away from the cursor. */
  markup: Range[];
}

/** A mark of each of the given kinds, one union member per kind so that a kind selects its member. */
export type KindMark<Kind extends string> = Kind extends string
  ? MarkRange & { kind: Kind }
  : never;

export interface Line extends Range {
  text: string;
}

export function linesOf(text: string): Line[] {
  let from = 0;

  return text.split("\n").map((lineText) => {
    const line = { from, to: from + lineText.length, text: lineText };

    from = line.to + 1;

    return line;
  });
}

/** The text with every character inside `ranges` blanked to a space, line breaks kept, so a detector run over it finds nothing there and reports positions that still fit the original. */
export function blanked(text: string, ranges: Range[]): string {
  return ranges.reduce(
    (kept, { from, to }) =>
      kept.slice(0, from) +
      kept.slice(from, to).replace(/[^\n]/g, " ") +
      kept.slice(to),
    text,
  );
}
