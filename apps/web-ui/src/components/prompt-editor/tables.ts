import type { Line, Range } from "./ranges";

export type Alignment = "left" | "center" | "right" | null;

export interface Table {
  header: string[];
  /** One per column, from the delimiter row's colons. */
  align: Alignment[];
  rows: string[][];
}

export interface TableBlock extends Range {
  /** Every line of the table: header, delimiter row and body rows. */
  lines: Line[];
  table: Table;
}

const DELIMITER_CELL = /^:?-+:?$/;

/** The pipe tables of a text's lines: a header row, a delimiter row of the same width, then the rows up to the next blank or pipe-less line. */
export function tableBlocks(lines: Line[]): TableBlock[] {
  const blocks: TableBlock[] = [];
  let index = 0;

  while (index < lines.length - 1) {
    const end = tableEnd(lines, index);

    if (end === index) {
      index += 1;
      continue;
    }
    blocks.push(blockOf(lines.slice(index, end)));
    index = end;
  }

  return blocks;
}

// The index just past the table starting at `start`, or `start` when none does.
function tableEnd(lines: Line[], start: number): number {
  if (!isTableHead(lines[start].text, lines[start + 1].text)) {
    return start;
  }
  let end = start + 2;

  while (end < lines.length && isRow(lines[end].text)) {
    end += 1;
  }

  return end;
}

function isTableHead(headerText: string, delimiterText: string): boolean {
  const header = cellsOf(headerText);
  const delimiter = cellsOf(delimiterText);
  const hasPipes = [headerText, delimiterText].every((text) =>
    text.includes("|"),
  );

  return (
    hasPipes &&
    delimiter.length === header.length &&
    delimiter.every((cell) => DELIMITER_CELL.test(cell))
  );
}

function isRow(text: string): boolean {
  return text.includes("|") && text.trim() !== "";
}

function blockOf(lines: Line[]): TableBlock {
  const [header, delimiter, ...rows] = lines.map((line) => cellsOf(line.text));

  return {
    from: lines[0].from,
    to: lines[lines.length - 1].to,
    lines,
    table: {
      header,
      align: delimiter.map(alignmentOf),
      rows: rows.map((row) => header.map((_cell, column) => row[column] ?? "")),
    },
  };
}

/** The cells of a table row: split on every `|` not escaped as `\|`, outer pipes dropped, each cell trimmed. */
export function cellsOf(rowText: string): string[] {
  return rowText
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

const ALIGNMENTS: Record<string, Alignment> = {
  "": null,
  left: "left",
  right: "right",
  "left right": "center",
};

function alignmentOf(delimiterCell: string): Alignment {
  const edges = [
    ...(delimiterCell.startsWith(":") ? ["left"] : []),
    ...(delimiterCell.endsWith(":") ? ["right"] : []),
  ];

  return ALIGNMENTS[edges.join(" ")];
}
