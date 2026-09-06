/** Matches an ATX heading line, capturing the text after the `#` marker(s). */
const ATX_HEADING = /^#{1,6}\s+(.*)$/;

/** A YAML frontmatter block opening the document (ADRs carry one); a `---` appearing later is a horizontal rule and stays. */
const LEADING_FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

interface MarkdownSummary {
  title: string;
  description: string;
}

/** Folds one source line into the in-progress summary: the first heading becomes the title, the first non-blank non-heading line becomes the description. Already-filled fields are left untouched. */
function foldSummaryLine(
  summary: MarkdownSummary,
  line: string,
): MarkdownSummary {
  const heading = ATX_HEADING.exec(line);

  if (heading) {
    return summary.title === ""
      ? { ...summary, title: heading[1].trim() }
      : summary;
  }

  if (summary.description !== "" || line.trim() === "") {
    return summary;
  }

  return { ...summary, description: line.trim() };
}

/** First ATX heading text as title, first non-blank non-heading line as description (both trimmed, or ""). */
export function summarizeMarkdown(source: string): MarkdownSummary {
  let summary: MarkdownSummary = { title: "", description: "" };

  for (const line of source.replace(LEADING_FRONTMATTER, "").split("\n")) {
    summary = foldSummaryLine(summary, line);

    if (summary.title !== "" && summary.description !== "") {
      break;
    }
  }

  return summary;
}
