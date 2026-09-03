/** Structured metadata the ingester stores on each chunk (JSONB). */
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

/** Derive the one-line header shown above a chunk: for code, the symbol and
 * line range (`function foo · L10–42`); for prose, the section title. Empty
 * when there's nothing to show. */
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
