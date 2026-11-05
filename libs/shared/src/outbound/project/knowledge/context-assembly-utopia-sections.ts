// A doc hit widened to the whole statement it was cut from (specs/utopia-graph-mirror FR13.10): Utopia's chunk ends where the chunker cut, mid-sentence as often as not, so the item is re-read from the stored document as the block (a paragraph or a list item) around the hit, under the heading it stands beneath.

import type { StoredDocument } from "../../../domain/utopia/read-shapes.js";
import type { UtopiaReads } from "../../utopia/utopia-reads.js";

const HEADING_RE = /^#{1,6} /;

/** Each stored document of the docs source read once per assembly however many sections widen their hits from it; a read that fails leaves the hits as they came. */
export function storedDocuments(arm: {
  reads: UtopiaReads;
  kbId: string;
  docsSourceId: string;
}): (path: string) => Promise<StoredDocument | null> {
  const documents = new Map<string, Promise<StoredDocument | null>>();
  const { reads, kbId, docsSourceId } = arm;

  return (path) => {
    const started =
      documents.get(path) ??
      reads
        .documentByExternalId(kbId, docsSourceId, `doc:${path}`)
        .catch(() => null);

    documents.set(path, started);

    return started;
  };
}

/** The blocks of the document the chunks fall in, each once, in the order they stand in the file, a run of blocks under one heading led by that heading once; a chunk the document does not contain stays as it came. */
export function widenedChunks(content: string, chunks: string[]): string[] {
  const lines = content.split("\n");
  const starts = new Set<number>();
  const strays: string[] = [];

  for (const chunk of chunks) {
    const line = lineOf(lines, chunk);

    if (line === null) {
      strays.push(chunk);
      continue;
    }
    starts.add(blockStart(lines, line));
  }

  return [
    ...headedBlocks(
      lines,
      [...starts].sort((a, b) => a - b),
    ),
    ...strays,
  ];
}

function headedBlocks(lines: string[], starts: number[]): string[] {
  let lastHeading: number | null = null;

  return starts.map((start) => {
    const heading = headingLineOf(lines, start);
    const led = heading !== null && heading !== lastHeading;

    lastHeading = heading;

    return [...(led ? [lines[heading]] : []), ...blockOf(lines, start)].join(
      "\n",
    );
  });
}

/** The line the chunk's first words of prose stand on; null when the document has no such line. Utopia leads a chunk with the path of headings above it, so the anchor is the chunk's first line that is no heading. */
function lineOf(lines: string[], chunk: string): number | null {
  const prose = chunk
    .split("\n")
    .find((line) => line.trim() !== "" && !HEADING_RE.test(line));
  const words = (prose ?? "").trim().split(/\s+/).slice(0, 6).join(" ");
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

function headingLineOf(lines: string[], start: number): number | null {
  for (let back = start - 1; back >= 0; back -= 1) {
    if (HEADING_RE.test(lines[back])) {
      return back;
    }
  }

  return null;
}
