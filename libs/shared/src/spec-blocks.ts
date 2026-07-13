/**
 * Lossless source-reconstruction layer for the spec-traceability graph.
 *
 * THE CORE INVARIANT — for ANY string `content`:
 *
 *     reassembleBlocks(segmentBlocks(content)) === content
 *
 * Every cycle that extends `segmentBlocks` MUST preserve this. The partition
 * is over `content.split("\n")`: every input line lands in exactly one block,
 * and `reassembleBlocks` rejoins block texts with `"\n"`, so the join is the
 * exact inverse of the split. (Note: the split is on `"\n"` — NOT `\r?\n` — so
 * a `\r` rides along inside its line's block and round-trips verbatim.)
 *
 * This is the SOURCE layer: paragraphs are kept WHOLE (multiple lines joined
 * by their original `"\n"`), never sentence-split. That whole-paragraph rule
 * is what makes reconstruction lossless. The lossy, testable-overlay layer
 * that DOES sentence-split (and drops headings/fences/tables) lives in the
 * sibling `spec-segment.ts` and serves a different purpose (statement
 * ordinals for spec→test links).
 *
 * The per-line dispatch in the walk classifies every source line into one of
 * six kinds: blank, heading (`kind: "heading"` + `level`), fenced code (a
 * ```` ```…``` ```` run is ONE multi-line `code` block — consumed until its
 * closing fence, never line-split), table rows, list items (each bullet is its
 * own `list-item` block), and prose paragraphs. All six ship today.
 *
 * NOTE on the sibling: `spec-segment.ts` carries its OWN line classifiers
 * (`isHeading` / `isListItem` / `isTableRow`) that look similar but encode
 * deliberately different rules — e.g. it treats ordered-list markers (`1.`) as
 * list items, whereas this lossless layer matches bullets only. The two are
 * NOT interchangeable, so they are intentionally kept separate rather than
 * promoted to a shared classifier (see backlog: ordered-list markers).
 */

/** Structural classification of a source block. All six kinds — `blank`,
 * `paragraph`, `heading`, `code`, `table`, and `list-item` — are emitted
 * today. */
export type BlockKind =
  "heading" | "paragraph" | "list-item" | "code" | "table" | "blank";

/** One contiguous run of source lines. `text` holds the verbatim source for
 * this block (paragraphs join their lines with `"\n"`); `ordinal` is the
 * block's index in emission order; `level` carries heading depth where the
 * `kind` defines one. */
export interface Block {
  ordinal: number;
  kind: BlockKind;
  text: string;
  level?: number;
}

/**
 * Partition `content` into ordered blocks losslessly (see module header for
 * the round-trip invariant). Per source line the walk dispatches, in order:
 * an open fence accumulates every line into ONE `code` block until its closing
 * ```` ``` ```` (or EOF); a ```` ``` ```` line opens a fence; a blank line
 * becomes its own verbatim `blank` block; an ATX `#`..`######` line becomes a
 * `heading` block carrying its `level`; a bullet (`-`/`*`/`+`) line becomes its
 * own `list-item` block; a ```` | ````-leading line accumulates into a `table`
 * run; anything else accumulates into a `paragraph` run.
 * Accumulating kinds share ONE pending run (see `flushPending` / `accumulate`):
 * switching kind or hitting any boundary (blank, heading, list-item,
 * fence-open, EOF)
 * flushes the open run exactly once.
 */
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

  // The single accumulating-run mechanism. The multi-line accumulating kinds
  // (paragraph and table) share ONE pending run: an accumulating line either
  // continues a run of its own kind or flushes the previous run and starts a
  // new one; every block boundary flushes once. (List items and headings do
  // not accumulate — each is flushed and emitted as its own block.)
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
    if (inFence) {
      codeBuffer.push(line);

      if (/^```/.test(line)) {
        emit("code", codeBuffer.join("\n"));
        codeBuffer = [];
        inFence = false;
      }
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

/** Inverse of `segmentBlocks`: rejoin block texts with `"\n"` to reconstruct
 * the original source verbatim. */
export function reassembleBlocks(blocks: Block[]): string {
  return blocks.map((block) => block.text).join("\n");
}
