// The Markdown the issues station files: one story issue per plan, with its decomposed slices as sections, and one issue per task that a developer implements from alone. Pure.

import type {
  DecompTask,
  UserStory,
} from "../../domain/feature-planning/decomposition-result.js";

export interface StoryIssueInput {
  repo: string;
  planTitle?: string;
  /** The plan page; the plan is named without a link when there is none. */
  planUrl?: string;
  /** `specs/<slug>/`, where the spec-kit set lives. */
  specSlug?: string;
  stories: readonly UserStory[];
  /** Task id → filed issue number, once the task issues exist. */
  taskIssues?: ReadonlyMap<string, number>;
}

export function storyIssueBody(input: StoryIssueInput): string {
  const header = [
    planLine(input),
    ...specLine(input),
    "",
    "Each task below is its own sub-issue of this story.",
    "",
  ];

  return [
    ...header,
    ...input.stories.flatMap((story) => storySection(story, input.taskIssues)),
  ].join("\n");
}

function planLine({ planTitle, planUrl, stories }: StoryIssueInput): string {
  const title = planTitle ?? stories.at(0)?.title ?? "this plan";

  return planUrl ? `**Plan:** [${title}](${planUrl})` : `**Plan:** ${title}`;
}

function specLine({ repo, specSlug }: StoryIssueInput): string[] {
  if (!specSlug) {
    return [];
  }
  const base = `${blobBase(repo)}/specs/${specSlug}`;
  const files = ["spec.md", "plan.md", "tasks.md"].map(
    (file) => `[${file}](${base}/${file})`,
  );

  return [`**Spec:** ${files.join(" · ")}`];
}

function storySection(
  story: UserStory,
  taskIssues: ReadonlyMap<string, number> | undefined,
): string[] {
  return [
    `## ${story.title}`,
    "",
    ...(story.summary ? [story.summary, ""] : []),
    ...checklist("**Acceptance criteria**", story.acceptance_criteria),
    "**Tasks**",
    "",
    ...story.tasks.map((task) => taskLine(task, taskIssues)),
    "",
  ];
}

function taskLine(
  task: DecompTask,
  taskIssues: ReadonlyMap<string, number> | undefined,
): string {
  const label = `${task.id}: ${task.title ?? task.description}`;
  const number = taskIssues?.get(task.id);

  return number === undefined ? `- ${label}` : `- [ ] #${number} ${label}`;
}

export interface TaskIssueInput {
  repo: string;
  /** The story issue this task is part of; absent when there is none to name. */
  storyNumber?: number;
  task: DecompTask;
  /** The tasks this one waits on: an issue number once filed, the task id while its issue doesn't exist yet. */
  dependsOn: readonly (number | string)[];
}

export function taskIssueBody({
  repo,
  storyNumber,
  task,
  dependsOn,
}: TaskIssueInput): string {
  return [
    ...(storyNumber === undefined ? [] : [`Part of #${storyNumber}.`, ""]),
    ...dependencyLine(dependsOn),
    ...section("Context", task.context),
    ...section("What to change", task.changes ?? task.description),
    ...(task.file_path ? [`Target file: \`${task.file_path}\``, ""] : []),
    ...checklist("## Acceptance criteria", task.acceptance_criteria ?? []),
    ...section("How to test", task.test_plan),
    ...references(repo, task.references ?? []),
  ].join("\n");
}

function dependencyLine(dependsOn: readonly (number | string)[]): string[] {
  const named = dependsOn.map((dep) =>
    typeof dep === "number" ? `#${dep}` : dep,
  );

  return named.length ? [`**Depends on:** ${named.join(", ")}`, ""] : [];
}

function section(heading: string, text: string | undefined): string[] {
  return text ? [`## ${heading}`, "", text, ""] : [];
}

function checklist(heading: string, criteria: readonly string[]): string[] {
  return criteria.length
    ? [heading, "", ...criteria.map((criterion) => `- [ ] ${criterion}`), ""]
    : [];
}

function references(repo: string, refs: readonly string[]): string[] {
  return refs.length
    ? [
        "## References",
        "",
        ...refs.map((ref) => `- ${referenceLink(repo, ref)}`),
        "",
      ]
    : [];
}

// A repository path becomes a link at the default branch; anything else (an ADR id, a URL) stays as written.
function referenceLink(repo: string, ref: string): string {
  if (!/^(specs|adrs)\//.test(ref)) {
    return ref;
  }
  // Only the first `#` ends the path: a heading may hold one itself (`C#`).
  const hash = ref.indexOf("#");
  const target =
    hash === -1
      ? ref
      : `${ref.slice(0, hash)}#${headingAnchor(ref.slice(hash + 1))}`;

  return `[${ref}](${blobBase(repo)}/${target})`;
}

// Decompose names a section by its heading as written; GitHub's anchor for it is lowercased, stripped of punctuation other than `-` and `_`, with each space a `-`.
function headingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function blobBase(repo: string): string {
  return `https://github.com/${repo}/blob/HEAD`;
}
