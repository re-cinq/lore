// The ingester's chunk-metadata JSONB shape (libs/shared chunker.ts `Chunk["metadata"]`), not a table row — web-ui has no dependency on libs/shared to derive it from.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface ChunkMeta {
  symbol_name?: string;
  symbol_type?: string;
  section_title?: string;
  start_line?: number;
  end_line?: number;
  chunk_index?: number;
  commit?: string;
}

function lineRangeLabel(metadata: ChunkMeta): string {
  if (metadata.start_line && metadata.end_line) {
    return `L${metadata.start_line}–${metadata.end_line}`;
  }

  if (metadata.start_line) {
    return `L${metadata.start_line}`;
  }

  return "";
}

/** One-line chunk header: code gets symbol + line range (`function foo · L10–42`), prose gets the section title, else empty. */
export function chunkHeader(
  contentType: string,
  metadata?: ChunkMeta | null,
): string {
  if (!metadata) {
    return "";
  }

  if (contentType === "code") {
    const symbol = [metadata.symbol_type, metadata.symbol_name]
      .filter(Boolean)
      .join(" ");

    return [symbol, lineRangeLabel(metadata)].filter(Boolean).join(" · ");
  }

  return metadata.section_title ?? "";
}
