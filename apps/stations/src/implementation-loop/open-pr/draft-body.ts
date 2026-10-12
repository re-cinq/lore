// The body a loop's DRAFT pull request opens with. A repository's PR-description check judges the body on every push, so the draft already carries the headings the repository's template asks for; the ready-for-review round writes the prose under them (mark-ready).

const TEMPLATE_PATH = ".github/PULL_REQUEST_TEMPLATE.md";

/** The sections Lore's own onboarding makes a repository require, for a repository with no template to read them from. */
const REQUIRED_SECTIONS = ["## Why", "## What Changed", "## Testing"];

const PLACEHOLDER = "_Written by the ready-for-review round._";

const SECTION_HEADING = /^##\s+\S/;

export { TEMPLATE_PATH as PR_TEMPLATE_PATH };

/** The opening line, then every `## ` heading of the template (or the required three when it has none) over a placeholder line. The footer is the caller's. */
export function draftBody(template: string | null, branch: string): string {
  const headings = sectionHeadingsOf(template ?? "");
  const sections = (headings.length > 0 ? headings : REQUIRED_SECTIONS).map(
    (heading) => `${heading}\n\n${PLACEHOLDER}`,
  );

  return [
    `Opened by the Lore implementation loop from \`${branch}\`.`,
    ...sections,
  ].join("\n\n");
}

function sectionHeadingsOf(template: string): string[] {
  return template
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => SECTION_HEADING.test(line));
}
