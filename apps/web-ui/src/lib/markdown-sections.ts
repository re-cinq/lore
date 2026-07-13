const HEADING_LINE = /^## /;

/** A markdown region: a `## ` section (heading text) or the leading preamble (heading null). */
type Section = { heading: string | null; body: string };

/** Split markdown into sections at each `## ` heading; content before the first heading becomes a leading `heading: null` section. */
export function splitMarkdownSections(source: string): Section[] {
  const sections: Section[] = [];
  let current: string[] | null = null;

  for (const line of source.split("\n")) {
    if (HEADING_LINE.test(line)) {
      if (current) {
        sections.push(buildSection(current));
      }
      current = [line];
      continue;
    }
    current ??= [];
    current.push(line);
  }

  if (current) {
    sections.push(buildSection(current));
  }

  return sections;
}

function buildSection(lines: string[]): Section {
  const heading = HEADING_LINE.test(lines[0])
    ? lines[0].replace(HEADING_LINE, "").trim()
    : null;

  return { heading, body: lines.join("\n") };
}
