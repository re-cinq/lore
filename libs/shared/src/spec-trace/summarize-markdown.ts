/** Matches an ATX heading line, capturing the text after the `#` marker(s). */
const ATX_HEADING = /^#{1,6}\s+(.*)$/;

/** A YAML frontmatter block opening the document (ADRs carry one); a `---`
 *  appearing later is a horizontal rule and stays. */
const LEADING_FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** First ATX heading text as title, first non-blank non-heading line as description (both trimmed, or ""). */
export function summarizeMarkdown(source: string): {
  title: string;
  description: string;
} {
  let title = "";
  let description = "";

  for (const line of source.replace(LEADING_FRONTMATTER, "").split("\n")) {
    const heading = ATX_HEADING.exec(line);

    if (heading && title === "") {
      title = heading[1].trim();
    }

    if (!heading && description === "" && line.trim() !== "") {
      description = line.trim();
    }

    if (title !== "" && description !== "") {
      break;
    }
  }

  return { title, description };
}
