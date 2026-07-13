/** Matches an ATX heading line, capturing the text after the `#` marker(s). */
const ATX_HEADING = /^#{1,6}\s+(.*)$/;

/** First ATX heading text as title, first non-blank non-heading line as description (both trimmed, or ""). */
export function summarizeMarkdown(source: string): {
  title: string;
  description: string;
} {
  let title = "";
  let description = "";
  for (const line of source.split("\n")) {
    const heading = ATX_HEADING.exec(line);
    if (heading && title === "") title = heading[1].trim();
    else if (!heading && description === "" && line.trim() !== "")
      description = line.trim();
    if (title !== "" && description !== "") break;
  }
  return { title, description };
}
