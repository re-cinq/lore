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
  /** Issue numbers of the tasks this one waits on. */
  dependsOn: readonly number[];
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

function dependencyLine(dependsOn: readonly number[]): string[] {
  return dependsOn.length
    ? [`**Depends on:** ${dependsOn.map((n) => `#${n}`).join(", ")}`, ""]
    : [];
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
  return /^(specs|adrs)\//.test(ref)
    ? `[${ref}](${blobBase(repo)}/${ref})`
    : ref;
}

function blobBase(repo: string): string {
  return `https://github.com/${repo}/blob/HEAD`;
}
