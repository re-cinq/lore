import type { Line, Range } from "./ranges";

export interface FencedBlock extends Range {
  /** Every line of the block, its opening and closing fence included. */
  lines: Line[];
  opening: Line;
  /** Null when the fence is never closed: the block then runs to the end of the text. */
  closing: Line | null;
}

// A backtick fence's info string may not hold a backtick, or it is inline code.
const OPENING = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const CLOSING = /^ {0,3}(`{3,}|~{3,}) *$/;

/** The ``` and ~~~ fenced blocks of a text's lines. */
export function fencedBlocks(lines: Line[]): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const block = blockFrom(lines, index);

    blocks.push(...(block ? [block] : []));
    index += block ? block.lines.length : 1;
  }

  return blocks;
}

// The block that opens on the line at `start`, if one does.
function blockFrom(lines: Line[], start: number): FencedBlock | null {
  const marker = OPENING.exec(lines[start].text)?.[1];

  if (marker === undefined) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const closingAt = rest.findIndex((line) => closes(line.text, marker));
  const body = closingAt === -1 ? rest : rest.slice(0, closingAt + 1);

  const closing = closingAt === -1 ? null : body[closingAt];

  return blockOf([lines[start], ...body], closing);
}

function closes(text: string, marker: string): boolean {
  const closing = CLOSING.exec(text)?.[1] ?? "";

  return closing[0] === marker[0] && closing.length >= marker.length;
}

function blockOf(lines: Line[], closing: Line | null): FencedBlock {
  return {
    from: lines[0].from,
    to: lines[lines.length - 1].to,
    lines,
    opening: lines[0],
    closing,
  };
}
