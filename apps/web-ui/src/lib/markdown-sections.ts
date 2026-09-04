const HEADING_LINE = /^## /;

/** A markdown region: a `## ` section (heading text) or the leading preamble (heading null). */
type Section = { heading: string | null; body: string };

/** Closes off `current` into `sections` (if any) and starts a fresh one at `line`. */
function startNewSection(
  sections: Section[],
  current: string[] | null,
  line: string,
): string[] {
  if (current) {
    sections.push(buildSection(current));
  }

  return [line];
}

/** Split markdown into sections at each `## ` heading; content before the first heading becomes a leading `heading: null` section. */
export function splitMarkdownSections(source: string): Section[] {
  const sections: Section[] = [];
  let current: string[] | null = null;

  for (const line of source.split("\n")) {
    if (HEADING_LINE.test(line)) {
      current = startNewSection(sections, current, line);
      continue;
    }
    current ??= [];
    current.push(line);
  }

  // split("\n") always yields >=1 line, so the loop above always set `current`.
  sections.push(buildSection(current!));

  return sections;
}

function buildSection(lines: string[]): Section {
  const heading = HEADING_LINE.test(lines[0])
    ? lines[0].replace(HEADING_LINE, "").trim()
    : null;

  return { heading, body: lines.join("\n") };
}
