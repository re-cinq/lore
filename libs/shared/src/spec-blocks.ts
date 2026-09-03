/** Lossless source-reconstruction layer for the spec graph: the invariant `reassembleBlocks(segmentBlocks(content)) === content` MUST hold for any `content`; paragraphs are kept whole (unlike sibling `spec-segment.ts`, which sentence-splits for a different purpose and is NOT interchangeable with this one). */

/** Structural classification of a source block; all six kinds are emitted today. */
export type BlockKind =
  "heading" | "paragraph" | "list-item" | "code" | "table" | "blank";

/** One contiguous run of source lines: `text` is the verbatim source, `ordinal` the emission-order index, `level` the heading depth where applicable. */
export interface Block {
  ordinal: number;
  kind: BlockKind;
  text: string;
  level?: number;
}

/** Partitions `content` into ordered blocks losslessly (see module header for the round-trip invariant), dispatching each line to fence/blank/heading/list-item/table/paragraph. */
export function segmentBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];

  const emit = (kind: BlockKind, text: string, level?: number) => {
    const block: Block = { ordinal: blocks.length, kind, text };

    if (level !== undefined) {
      block.level = level;
    }
    blocks.push(block);
  };

  // Single accumulating-run for multi-line kinds (paragraph, table); per-line/heading are flushed separately.
  let pending: { kind: BlockKind; lines: string[] } | null = null;
  const flushPending = () => {
    if (pending === null) {
      return;
    }
    emit(pending.kind, pending.lines.join("\n"));
    pending = null;
  };
  const accumulate = (kind: BlockKind, line: string) => {
    if (pending !== null && pending.kind !== kind) {
      flushPending();
    }

    if (pending === null) {
      pending = { kind, lines: [] };
    }
    pending.lines.push(line);
  };

  let inFence = false;
  let codeBuffer: string[] = [];

  for (const line of lines) {
    if (inFence && /^```/.test(line)) {
      codeBuffer.push(line);
      emit("code", codeBuffer.join("\n"));
      codeBuffer = [];
      inFence = false;
      continue;
    }

    if (inFence) {
      codeBuffer.push(line);
      continue;
    }

    if (/^```/.test(line)) {
      flushPending();
      inFence = true;
      codeBuffer = [line];
      continue;
    }

    if (line.trim() === "") {
      flushPending();
      emit("blank", line);
      continue;
    }
    const headingMatch = line.match(/^(#{1,6})\s/);

    if (headingMatch) {
      flushPending();
      emit("heading", line, headingMatch[1].length);
      continue;
    }

    if (/^\s*[-*+]\s/.test(line)) {
      flushPending();
      emit("list-item", line);
      continue;
    }

    if (/^\s*\|/.test(line)) {
      accumulate("table", line);
      continue;
    }
    accumulate("paragraph", line);
  }
  flushPending();

  if (inFence) {
    emit("code", codeBuffer.join("\n"));
  }

  return blocks;
}

/** Inverse of segmentBlocks: rejoin blocks with newlines. */
export function reassembleBlocks(blocks: Block[]): string {
  return blocks.map((block) => block.text).join("\n");
}
