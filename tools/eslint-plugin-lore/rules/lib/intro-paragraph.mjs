/**
 * intro-paragraph — the pure core behind `require-intro-paragraph`.
 *
 * The web-UI spec/ADR cards render a short description drawn from the top of each
 * doc; a doc that opens straight into a metadata table, a bare `## Status` word,
 * or a `## Section` heading gives the card nothing good to show. This checks that a
 * doc opens with a real *lead paragraph* — prose sitting after the title (and, for
 * specs, the metadata table / for ADRs, the frontmatter) and BEFORE the first `##`
 * section.
 *
 * A region-bounded cousin of `extractSummary` (@re-cinq/lore-shared/spec-summary):
 * that one grabs the first prose paragraph anywhere in the doc; here the prose must
 * fall in the intro region, so the placement — not just the existence — is enforced.
 *
 * Split out of the rule so it is testable without a RuleTester.
 */

const MIN_INTRO_CHARS = 40;

/** First line of a block is markdown structure, not prose, when it opens a heading,
 * table row, blockquote, code fence, list item, or a `**Status:** …` metadata line. */
function isProseLine(line) {
  const trimmed = line.trim();

  if (trimmed === "") {
    return false;
  }

  const isStructure =
    trimmed.startsWith("#") ||
    trimmed.startsWith("|") ||
    trimmed.startsWith(">") ||
    trimmed.startsWith("```") ||
    /^[-*]\s/.test(trimmed) ||
    /^\*\*status\b/i.test(trimmed);

  return !isStructure;
}

/** The intro region is every line before the first `## ` section, past any leading
 * `---` … `---` frontmatter (ADRs). */
function introRegion(content, kind) {
  const lines = content.split("\n");
  let start = 0;

  if (kind === "adr" && lines[0]?.trim() === "---") {
    let i = 1;

    while (i < lines.length && lines[i].trim() !== "---") {
      i++;
    }
    start = i + 1;
  }
  const region = [];

  for (let i = start; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      break;
    }
    region.push(lines[i]);
  }

  return region;
}

/**
 * @param {string} content markdown body of a spec.md / ADR file
 * @param {"spec" | "adr"} kind
 * @returns {boolean} true when a lead paragraph of at least MIN_INTRO_CHARS exists
 */
export function hasLeadParagraph(content, kind) {
  const region = introRegion(content, kind);

  let paragraph = [];

  const meetsMinimum = () => {
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();

    return text.length >= MIN_INTRO_CHARS;
  };

  for (const line of region) {
    if (line.trim() === "") {
      if (paragraph.length > 0 && meetsMinimum()) {
        return true;
      }
      paragraph = [];
      continue;
    }

    if (paragraph.length === 0 && !isProseLine(line)) {
      continue;
    }

    if (paragraph.length > 0 || isProseLine(line)) {
      paragraph.push(line.trim());
    }
  }

  return paragraph.length > 0 && meetsMinimum();
}
