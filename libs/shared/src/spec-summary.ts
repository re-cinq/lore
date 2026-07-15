/**
 * Pure helpers for deriving a human title + summary from a spec's markdown,
 * and for reassembling a spec from its stored chunks. Canonical home: the
 * spec-coverage API (mcp-server) imports these via @re-cinq/lore-shared. The
 * web-ui keeps its own mirror (it is not a workspace member), kept in sync.
 */

const TITLE_PREFIX_RE =
  /^(?:feature\s+specification|spec(?:ification)?)\s*:\s*/i;

/** First H1, with a leading "Feature Specification:" prefix stripped. Falls
 * back to the spec's feature directory, then the raw file path. */
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

/** First real prose paragraph (skips headings, tables, blockquotes, code fences, lists),
 * whitespace-collapsed and truncated to `maxLength` with an ellipsis. */
export function extractSummary(content: string, maxLength = 280): string {
  const paragraphs = content.split(/\n\s*\n/);

  for (const block of paragraphs) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      continue;
    }
    const first = lines[0];

    const isBlockPrefix =
      first.startsWith("#") || first.startsWith("|") || first.startsWith(">");
    const isMarkdownSyntax =
      isBlockPrefix || first.startsWith("```") || /^[-*]\s/.test(first);

    if (isMarkdownSyntax) {
      continue;
    }
    const text = lines.join(" ").replace(/\s+/g, " ").trim();

    if (text.length === 0) {
      continue;
    }

    return text.length > maxLength
      ? text.slice(0, maxLength).trimEnd() + "…"
      : text;
  }

  return "";
}

interface SpecChunk {
  content: string;
  ingested_at: string | Date;
}

/** Joins a spec's chunks in ingest order, de-duplicating identical content
 * (re-ingests create new rows rather than upserting). */
export function reassembleSpec(chunks: SpecChunk[]): string {
  const ordered = [...chunks].sort(
    (a, b) =>
      new Date(a.ingested_at).getTime() - new Date(b.ingested_at).getTime(),
  );
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
