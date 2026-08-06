/**
 * Pure mirror of the emptiness test in
 * `.github/workflows/pr-description-check.yml`.
 *
 * The workflow slices a `## <heading>` section out of the PR body, strips HTML
 * comments and whitespace, and treats the section as empty when nothing
 * remains. A missing section is empty too. These functions replicate that bash
 * pipeline so the rule is unit-testable without invoking `sed`/`tr`.
 */

/**
 * Return the lines between `## <heading>` and the next `## ` heading, exclusive
 * of both boundaries. A missing heading yields an empty string. Mirrors
 * `sed -n '/^## <heading>/,/^## /{ /^## /d; p; }'`.
 */
export function extractSection(body: string, heading: string): string {
  const lines = body.split("\n");
  const startMarker = `## ${heading}`;
  const startIndex = lines.findIndex((line) => line.startsWith(startMarker));

  if (startIndex === -1) {
    return "";
  }

  const sectionLines: string[] = [];

  for (let index = startIndex + 1; index < lines.length; index++) {
    if (lines[index].startsWith("## ")) {
      break;
    }
    sectionLines.push(lines[index]);
  }

  return sectionLines.join("\n");
}

/**
 * Drop single-line HTML comments, then every whitespace character. Mirrors
 * `sed 's/<!--.*-->//g' | tr -d '[:space:]'` — the greedy `.*` stays within a
 * line because the regex has no dotAll flag.
 */
export function stripCommentsAndWhitespace(content: string): string {
  return content.replace(/<!--.*-->/g, "").replace(/\s/g, "");
}

/**
 * True when the `## <heading>` section holds only comments and whitespace, or
 * is absent entirely.
 */
export function sectionIsEmpty(body: string, heading: string): boolean {
  return stripCommentsAndWhitespace(extractSection(body, heading)) === "";
}
