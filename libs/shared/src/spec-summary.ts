/** Pure helpers for deriving a title/summary from a spec's markdown and reassembling a spec from stored chunks; canonical home, imported by the spec-coverage API (mcp-server) via @re-cinq/lore-shared. */

const TITLE_PREFIX_RE =
  /^(?:feature\s+specification|spec(?:ification)?)\s*:\s*/i;

/** First H1 with a leading "Feature Specification:" prefix stripped; falls back to the feature directory, then the raw file path. */
export function parseSpecTitle(content: string, filePath: string): string {
  const h1 = content.split("\n").find((line) => /^#\s+\S/.test(line));

  if (h1) {
    return h1.replace(/^#\s+/, "").replace(TITLE_PREFIX_RE, "").trim();
  }

  return featureDir(filePath) ?? filePath;
}

function featureDir(filePath: string): string | null {
  const parts = filePath.split("/").filter(Boolean);
  const specsIdx = parts.indexOf("specs");

  if (specsIdx >= 0 && parts.length > specsIdx + 2) {
    return parts[specsIdx + 1];
  }

  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }

  return null;
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

interface SpecChunk {
  content: string;
  ingested_at: string | Date;
  chunk_index?: number | null;
}

/** Joins a spec's chunks in `metadata.chunk_index` order (falling back to ingest order for legacy chunks, sorted last), de-duplicating identical content since re-ingests insert new rows rather than upserting. */
export function reassembleSpec(chunks: SpecChunk[]): string {
  const ordered = [...chunks].sort((a, b) => {
    const aIndex = a.chunk_index ?? Number.POSITIVE_INFINITY;
    const bIndex = b.chunk_index ?? Number.POSITIVE_INFINITY;

    if (aIndex !== bIndex) {
      return aIndex < bIndex ? -1 : 1;
    }

    return (
      new Date(a.ingested_at).getTime() - new Date(b.ingested_at).getTime()
    );
  });
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
