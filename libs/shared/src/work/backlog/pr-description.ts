// The loop's pull request description, written from the diff (#3503): a small model reads the ticket, the definition of done and the pull request's diff, and answers the title, the description under the repository's headings, and whether the branch covers the whole ticket. The agent this replaces read 786k input tokens a visit on Gemini 3.1 Pro with the repository, the skills and Lore's MCP loaded.

/** How much of the diff the model reads. */
export const PR_DESCRIPTION_DIFF_CHARS = 60_000;

const TITLE_CHARS = 70;

const DEFAULT_HEADINGS = ["Why", "What Changed", "Testing"];

/** The `## ` headings of the repository's pull request template, or Why, What Changed and Testing without one. */
export function templateHeadings(template: string | null): string[] {
  const headings = [...(template ?? "").matchAll(/^## (.+)$/gm)].map((match) =>
    match[1]!.trim(),
  );

  return headings.length > 0 ? headings : DEFAULT_HEADINGS;
}

/** What the model answers. */
export interface PullDescription {
  title: string;
  body: string;
  issue_coverage: string;
}

export const PR_DESCRIPTION_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: `One imperative line under ${TITLE_CHARS} characters naming what the branch did, no prefix.`,
    },
    body: {
      type: "string",
      description:
        "The description in markdown, prose under exactly the headings given.",
    },
    issue_coverage: {
      type: "string",
      enum: ["full", "partial"],
      description:
        "full when the branch resolves everything the ticket reports, partial when only part of it.",
    },
  },
  required: ["title", "body", "issue_coverage"],
} as const;

export interface PullDescriptionInput {
  ticket: string;
  dod: string | null;
  headings: readonly string[];
  diff: string;
}

export function prDescriptionPrompt(input: PullDescriptionInput): string {
  const { headings: names } = input;
  const headings = names.map((heading) => `\`## ${heading}\``).join(", ");

  return [
    "Write the pull request description a human reviewer will read, for the finished ticket below. CI is green on this branch.",
    `Use exactly these headings, in this order: ${headings}. Under them, in prose: what the ticket asked for, what changed and why that shape, which acceptance tests define done, and anything a reviewer would otherwise have to ask. Say so when the change deviates from the definition of done, and why. No checklists, no emoji, no other headings, no restating the diff line by line, no closing keywords such as Closes or Refs, and do not repeat the title as a heading.`,
    "Then give a title: one imperative line naming what the branch did, not the ticket. Then judge whether the branch resolves everything the ticket reports (full) or only part of it (partial).",
    `# The ticket\n\n${input.ticket}`,
    `# The definition of done\n\n${input.dod ?? "(none on the branch)"}`,
    `# The diff\n\n\`\`\`diff\n${input.diff.slice(0, PR_DESCRIPTION_DIFF_CHARS)}\n\`\`\``,
  ].join("\n\n");
}

/** The answer as the pull request takes it, or null when it lacks a title or a description. */
export function describedPull(
  answer: PullDescription,
): { title: string; body: string; coverage: "full" | "partial" } | null {
  const [firstLine = ""] = answer.title.split("\n");
  const title = firstLine.trim().slice(0, TITLE_CHARS);
  const body = answer.body.trim();

  if (!title || !body) {
    return null;
  }

  return {
    title,
    body,
    coverage: answer.issue_coverage === "partial" ? "partial" : "full",
  };
}
