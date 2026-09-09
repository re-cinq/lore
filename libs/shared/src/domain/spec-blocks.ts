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

type SingleLineKind = "blank" | "heading" | "list-item";
type AccumulatingKind = "table" | "paragraph";

interface LineClassification {
  kind: SingleLineKind | AccumulatingKind;
  headingLevel?: number;
}

/** Classifies one non-fence, non-blank-checked-elsewhere line by its leading syntax. */
function classifyLine(line: string): LineClassification {
  if (line.trim() === "") {
    return { kind: "blank" };
  }

  const headingMatch = line.match(/^(#{1,6})\s/);

  if (headingMatch) {
    return { kind: "heading", headingLevel: headingMatch[1].length };
  }

  if (/^\s*[-*+]\s/.test(line)) {
    return { kind: "list-item" };
  }

  if (/^\s*\|/.test(line)) {
    return { kind: "table" };
  }

  return { kind: "paragraph" };
}

/** Line-by-line lossless block accumulator behind `segmentBlocks`; see module header for the round-trip invariant. */
class BlockAccumulator {
  private blocks: Block[] = [];
  // Single accumulating-run for multi-line kinds (paragraph, table); per-line/heading are flushed separately.
  private pending: { kind: BlockKind; lines: string[] } | null = null;
  private inFence = false;
  private codeBuffer: string[] = [];

  private emit(kind: BlockKind, text: string, level?: number): void {
    const block: Block = { ordinal: this.blocks.length, kind, text };

    if (level !== undefined) {
      block.level = level;
    }
    this.blocks.push(block);
  }

  private flushPending(): void {
    if (this.pending === null) {
      return;
    }
    this.emit(this.pending.kind, this.pending.lines.join("\n"));
    this.pending = null;
  }

  private accumulate(kind: BlockKind, line: string): void {
    if (this.pending !== null && this.pending.kind !== kind) {
      this.flushPending();
    }

    if (this.pending === null) {
      this.pending = { kind, lines: [] };
    }
    this.pending.lines.push(line);
  }

  /** A ``` line either closes the fence in progress or opens a new one. */
  private handleFenceDelimiter(line: string): void {
    if (!this.inFence) {
      this.flushPending();
      this.inFence = true;
      this.codeBuffer = [line];

      return;
    }

    this.codeBuffer.push(line);
    this.emit("code", this.codeBuffer.join("\n"));
    this.codeBuffer = [];
    this.inFence = false;
  }

  private handleClassifiedLine(line: string): void {
    const { kind, headingLevel } = classifyLine(line);

    if (!(kind === "table" || kind === "paragraph")) {
      this.flushPending();
      this.emit(kind, line, headingLevel);

      return;
    }

    this.accumulate(kind, line);
  }

  addLine(line: string): void {
    if (/^```/.test(line)) {
      this.handleFenceDelimiter(line);

      return;
    }

    if (this.inFence) {
      this.codeBuffer.push(line);

      return;
    }

    this.handleClassifiedLine(line);
  }

  finish(): Block[] {
    this.flushPending();

    if (this.inFence) {
      this.emit("code", this.codeBuffer.join("\n"));
    }

    return this.blocks;
  }
}

/** Partitions `content` into ordered blocks losslessly (see module header for the round-trip invariant), dispatching each line to fence/blank/heading/list-item/table/paragraph. */
export function segmentBlocks(content: string): Block[] {
  const accumulator = new BlockAccumulator();

  for (const line of content.split("\n")) {
    accumulator.addLine(line);
  }

  return accumulator.finish();
}

/** Inverse of segmentBlocks: rejoin blocks with newlines. */
export function reassembleBlocks(blocks: Block[]): string {
  return blocks.map((block) => block.text).join("\n");
}
