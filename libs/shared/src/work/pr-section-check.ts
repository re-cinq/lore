/** Pure mirror of the emptiness test in .github/workflows/pr-description-check.yml — replicates the bash pipeline (slice section, strip HTML comments+whitespace) so it's unit-testable without sed/tr. */

/** Lines between `## <heading>` and the next `## ` heading, exclusive; mirrors `sed -n '/^## <heading>/,/^## /{ /^## /d; p; }'`. */
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

/** Drops single-line HTML comments then whitespace; mirrors `sed 's/<!--.*-->//g' | tr -d '[:space:]'` (no dotAll, so `.*` stays within a line). */
export function stripCommentsAndWhitespace(content: string): string {
  return content.replace(/<!--.*-->/g, "").replace(/\s/g, "");
}

/** True when the `## <heading>` section holds only comments/whitespace, or is absent entirely. */
export function sectionIsEmpty(body: string, heading: string): boolean {
  return stripCommentsAndWhitespace(extractSection(body, heading)) === "";
}
