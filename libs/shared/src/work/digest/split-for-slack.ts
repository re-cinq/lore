/** Slack refuses a `chat.postMessage` over 40,000 characters and truncates the display far earlier, so a long digest goes out as consecutive thread replies (specs/daily-digest FR8). The break is by line and nothing cleverer: every item is one line, so no link is ever cut. */

export const SLACK_CHUNK_LIMIT = 3800;
const ELLIPSIS = "…";

export function splitForSlack(
  text: string,
  limit: number = SLACK_CHUNK_LIMIT,
): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n").map((raw) => fitLine(raw, limit))) {
    const joined = current ? `${current}\n${line}` : line;

    if (joined.length <= limit || !current) {
      current = joined;
      continue;
    }
    chunks.push(current);
    current = line;
  }
  chunks.push(current);

  return chunks.map((chunk) => chunk.replace(/^\n+|\n+$/g, "")).filter(Boolean);
}

function fitLine(line: string, limit: number): string {
  return line.length > limit ? `${line.slice(0, limit - 1)}${ELLIPSIS}` : line;
}
