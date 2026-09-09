const MAX_CODE_LINES = 12;

/** Extract lead of chunk for list-card previews: first paragraph (with heading) for prose, first lines for code. */
export function previewBlock(content: string, contentType: string): string {
  const trimmed = content.trim();

  if (!trimmed) {
    return "";
  }

  if (contentType === "code") {
    return trimmed.split("\n").slice(0, MAX_CODE_LINES).join("\n");
  }
  const blocks = trimmed.split(/\n[ \t]*\n/);
  const isHeading = /^#{1,6}\s/.test(blocks[0].trimStart());

  return blocks.length > 1 && isHeading
    ? `${blocks[0]}\n\n${blocks[1]}`
    : blocks[0];
}
