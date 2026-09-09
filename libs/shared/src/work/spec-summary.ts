/** Pure helpers for deriving a title/summary from a spec's markdown and reassembling a spec from stored chunks; canonical home, imported by the spec-coverage API (mcp-server) via @re-cinq/lore-shared. */

import type { Chunk } from "../domain/models/chunk.js";
import { specFeatureSlug } from "../domain/spec-judge-signals.js";

const TITLE_PREFIX_RE =
  /^(?:feature\s+specification|spec(?:ification)?)\s*:\s*/i;

/** First H1 with a leading "Feature Specification:" prefix stripped; falls back to the feature directory, then the raw file path. */
export function parseSpecTitle(content: string, filePath: string): string {
  const h1 = content.split("\n").find((line) => /^#\s+\S/.test(line));

  if (h1) {
    return h1.replace(/^#\s+/, "").replace(TITLE_PREFIX_RE, "").trim();
  }

  return specFeatureSlug(filePath) ?? filePath;
}

/** First real prose paragraph (skips headings, tables, blockquotes, code fences, lists), whitespace-collapsed and truncated to `maxLength` with an ellipsis. */
export function extractSummary(content: string, maxLength = 280): string {
  const paragraphs = content.split(/\n\s*\n/);

  for (const block of paragraphs) {
    const lines = paragraphLines(block);

    if (lines.length === 0 || isMarkdownSyntaxLine(lines[0])) {
      continue;
    }

    const text = lines.join(" ").replace(/\s+/g, " ").trim();

    if (text.length === 0) {
      continue;
    }

    return truncateWithEllipsis(text, maxLength);
  }

  return "";
}

function paragraphLines(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** True when a paragraph's first line is markdown structure (heading, table, blockquote, code fence, list) rather than prose. */
function isMarkdownSyntaxLine(first: string): boolean {
  if (first.startsWith("#") || first.startsWith("|") || first.startsWith(">")) {
    return true;
  }

  return first.startsWith("```") || /^[-*]\s/.test(first);
}

function truncateWithEllipsis(text: string, maxLength: number): string {
  return text.length > maxLength
    ? text.slice(0, maxLength).trimEnd() + "…"
    : text;
}

type SpecChunk = Pick<Chunk, "content"> & {
  ingested_at: string | Date;
  chunk_index?: number | null;
};

/** Joins a spec's chunks in `metadata.chunk_index` order (falling back to ingest order for legacy chunks, sorted last), de-duplicating identical content since re-ingests insert new rows rather than upserting. */
export function reassembleSpec(chunks: SpecChunk[]): string {
  const ordered = [...chunks].sort(byChunkIndexThenIngest);
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const chunk of ordered) {
    if (seen.has(chunk.content)) {
      continue;
    }
    seen.add(chunk.content);
    parts.push(chunk.content);
  }

  return parts.join("\n\n");
}

/** Chunk-index order, legacy chunks without an index sorted last and broken by ingest time. */
function byChunkIndexThenIngest(a: SpecChunk, b: SpecChunk): number {
  const aIndex = a.chunk_index ?? Number.POSITIVE_INFINITY;
  const bIndex = b.chunk_index ?? Number.POSITIVE_INFINITY;

  if (aIndex !== bIndex) {
    return aIndex < bIndex ? -1 : 1;
  }

  return new Date(a.ingested_at).getTime() - new Date(b.ingested_at).getTime();
}

/** A spec is stored as several chunks, so every pass over a repo's chunks starts by putting each file's back together. */
export function groupChunksByPath<T extends { filePath: string }>(
  chunks: T[],
): Map<string, T[]> {
  const byPath = new Map<string, T[]>();

  for (const chunk of chunks) {
    const list = byPath.get(chunk.filePath) ?? [];

    list.push(chunk);
    byPath.set(chunk.filePath, list);
  }

  return byPath;
}
