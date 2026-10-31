// A doc hit widened to the whole statement it was cut from (specs/utopia-graph-mirror FR13.10): Utopia's chunk ends where the chunker cut, mid-sentence as often as not, so the item is re-read from the stored document as the block (a paragraph or a list item) around the hit, under the heading it stands beneath.

const HEADING_RE = /^#{1,6} /;

/** The blocks of the document the chunks fall in, each once, in the order they stand in the file, each led by its heading; a chunk the document does not contain stays as it came. */
export function widenedChunks(content: string, chunks: string[]): string[] {
  const lines = content.split("\n");
  const blocks = new Map<number, string>();
  const strays: string[] = [];

  for (const chunk of chunks) {
    const line = lineOf(lines, chunk);

    if (line === null) {
      strays.push(chunk);
      continue;
    }
    const start = blockStart(lines, line);

    blocks.set(start, blockText(lines, start));
  }

  return [...inFileOrder(blocks), ...strays];
}

function blockText(lines: string[], start: number): string {
  return [...headingOf(lines, start), ...blockOf(lines, start)].join("\n");
}

function inFileOrder(blocks: Map<number, string>): string[] {
  return [...blocks].sort(([a], [b]) => a - b).map(([, text]) => text);
}

/** The line the chunk's first words stand on; null when the document has no such line. */
function lineOf(lines: string[], chunk: string): number | null {
  const words = chunk.trim().split(/\s+/).slice(0, 6).join(" ");
  const index = lines.findIndex((line) => normalized(line).includes(words));

  return words && index >= 0 ? index : null;
}

function normalized(line: string): string {
  return line.replaceAll(/\s+/g, " ");
}

/** The first line of the paragraph or list item the line belongs to: back to the line after a blank, a heading or another list item. */
function blockStart(lines: string[], line: number): number {
  let start = line;

  while (start > 0 && continues(lines[start - 1], lines[start])) {
    start -= 1;
  }

  return start;
}

function continues(previous: string, current: string): boolean {
  return (
    previous.trim() !== "" && !HEADING_RE.test(previous) && !isListItem(current)
  );
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.) /.test(line);
}

function blockOf(lines: string[], start: number): string[] {
  const block = [lines[start]];

  for (let next = start + 1; next < lines.length; next += 1) {
    const line = lines[next];

    if (line.trim() === "" || HEADING_RE.test(line) || isListItem(line)) {
      break;
    }
    block.push(line);
  }

  return block;
}

function headingOf(lines: string[], start: number): string[] {
  for (let back = start - 1; back >= 0; back -= 1) {
    if (HEADING_RE.test(lines[back])) {
      return [lines[back]];
    }
  }

  return [];
}
