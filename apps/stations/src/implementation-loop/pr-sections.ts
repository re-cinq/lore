// The sections a loop pull request's body carries. A repository's PR-description check judges the body on every push and on every edit, so the draft already carries the headings the repository's template asks for, and the description the ready-for-review round writes is completed with any it left out (mark-ready).

/** Where GitHub itself looks for a pull request template, in the order it prefers them. */
const PR_TEMPLATE_PATHS = [
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
];

const PR_TEMPLATE_DIRECTORY = ".github/PULL_REQUEST_TEMPLATE";

/** The slice of a repository's files the template lookup needs, on its default branch. */
export interface TemplateSource {
  read(path: string): Promise<string | null>;
  list(path: string): Promise<string[]>;
}

/** The repository's pull request template: the first standard location that holds one, then the first file by name of the template directory; null when it has none. */
export async function findPullRequestTemplate(
  source: TemplateSource,
): Promise<string | null> {
  for (const path of PR_TEMPLATE_PATHS) {
    const template = await source.read(path);

    if (template !== null) {
      return template;
    }
  }
  const [first] = (await source.list(PR_TEMPLATE_DIRECTORY)).sort();

  return first ? source.read(`${PR_TEMPLATE_DIRECTORY}/${first}`) : null;
}

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

/** The opening line, then the template's whole text with the placeholder under every heading, so its guidance and checklists reach the reader. A repository with no usable template gets the required three. The footer is the caller's. */
export function draftBody(template: string | null, branch: string): string {
  const opening = `Opened by the Lore implementation loop from \`${branch}\`.`;

  return [opening, sectionsOf(template)].join("\n\n");
}

function sectionsOf(template: string | null): string {
  if (sectionHeadingsOf(template ?? "").length === 0) {
    return REQUIRED_SECTIONS.map(
      (heading) => `${heading}\n\n${PLACEHOLDER}`,
    ).join("\n\n");
  }

  return (template ?? "")
    .trimEnd()
    .split("\n")
    .flatMap((line) =>
      SECTION_HEADING.test(line.trim()) ? [line, "", PLACEHOLDER] : [line],
    )
    .join("\n");
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
