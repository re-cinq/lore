const MAX_CODE_LINES = 12;

/**
 * Extracts the lead of an ingested chunk for list-card previews so the list view
 * never parses thousands of full chunk bodies. Prose returns the first paragraph,
 * keeping a leading markdown heading attached; code returns its first lines.
 */
export function previewBlock(content: string, contentType: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (contentType === "code") {
    return trimmed.split("\n").slice(0, MAX_CODE_LINES).join("\n");
  }
  const blocks = trimmed.split(/\n[ \t]*\n/);
  const isHeading = /^#{1,6}\s/.test(blocks[0].trimStart());
  return blocks.length > 1 && isHeading
    ? `${blocks[0]}\n\n${blocks[1]}`
    : blocks[0];
}
