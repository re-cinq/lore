// The sections a loop pull request's body carries. A repository's PR-description check judges the body on every push and on every edit, so the draft already carries the headings the repository's template asks for, and the description the ready-for-review round writes is completed with any it left out (mark-ready).

export const PR_TEMPLATE_PATH = ".github/PULL_REQUEST_TEMPLATE.md";

/** The sections Lore's own onboarding makes a repository require, for a repository with no template to read them from. */
const REQUIRED_SECTIONS = ["## Why", "## What Changed", "## Testing"];

const PLACEHOLDER = "_Written by the ready-for-review round._";

const NOT_COVERED = "_Not covered separately in this description._";

const SECTION_HEADING = /^##\s+\S/;

/** Every `## ` heading of the template, or the required three when it has none. */
export function requiredSections(template: string | null): string[] {
  const headings = sectionHeadingsOf(template ?? "");

  return headings.length > 0 ? headings : REQUIRED_SECTIONS;
}

/** The opening line, then every required section over a placeholder line. The footer is the caller's. */
export function draftBody(template: string | null, branch: string): string {
  const sections = requiredSections(template).map(
    (heading) => `${heading}\n\n${PLACEHOLDER}`,
  );

  return [
    `Opened by the Lore implementation loop from \`${branch}\`.`,
    ...sections,
  ].join("\n\n");
}

/** The sections the body lacks, matched by heading text (case and surrounding spaces aside). */
export function missingSections(body: string, sections: string[]): string[] {
  const present = new Set(sectionHeadingsOf(body).map(normalizeHeading));

  return sections.filter((heading) => !present.has(normalizeHeading(heading)));
}

/** The prose with every section it lacks appended over a line saying so: the repository's check passes, and the reviewer sees what was not written separately instead of a check that reads red for a reason the author cannot fix. */
export function withSections(prose: string, sections: string[]): string {
  const missing = missingSections(prose, sections).map(
    (heading) => `${heading}\n\n${NOT_COVERED}`,
  );

  return [prose.trimEnd(), ...missing].join("\n\n");
}

function sectionHeadingsOf(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => SECTION_HEADING.test(line));
}

function normalizeHeading(heading: string): string {
  return heading.replace(/\s+/g, " ").trim().toLowerCase();
}
