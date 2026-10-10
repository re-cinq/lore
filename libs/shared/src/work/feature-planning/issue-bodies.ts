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
  /** The approved plan as Markdown, folded into the story so it reads without the plan page. */
  planMarkdown?: string;
  stories: readonly UserStory[];
  /** Task id → filed issue number, once the task issues exist. */
  taskIssues?: ReadonlyMap<string, number>;
  /** How many of the spec's testable statements the tasks name, as `issueCoverageBrief` writes it. */
  coverage?: string;
}

// GitHub refuses a body over 65,536 characters; the rest is headroom for the plan marker the filing appends after this fit.
const GITHUB_BODY_LIMIT = 65_000;

export function storyIssueBody(input: StoryIssueInput): string {
  const links = [planLine(input), ...specLine(input), ""];
  const stories = [
    "Each task below is its own sub-issue of this story.",
    "",
    ...input.stories.flatMap((story) => storySection(story, input.taskIssues)),
    ...(input.coverage ? [input.coverage] : []),
  ];
  const room = GITHUB_BODY_LIMIT - [...links, ...stories].join("\n").length - 1;

  return [...links, ...planFold(input, room), ...stories].join("\n");
}

const FOLD_OPEN = "<details><summary>The approved plan</summary>";
const FOLD_CLOSE = "</details>";

// The plan is cut short rather than the stories: the plan page holds the rest, the stories are what this issue tracks.
function planFold(
  { planMarkdown, planUrl }: StoryIssueInput,
  room: number,
): string[] {
  if (!planMarkdown) {
    return [];
  }
  const fold = (text: string) => [FOLD_OPEN, "", text, "", FOLD_CLOSE, ""];
  const whole = fold(planMarkdown);

  if (whole.join("\n").length + 1 <= room) {
    return whole;
  }
  const pointer = `\n\n*The plan continues on ${planUrl ? `[its page](${planUrl})` : "its page"}.*`;
  const kept = room - fold(pointer).join("\n").length - 1;

  return kept > 0 ? fold(planMarkdown.slice(0, kept) + pointer) : [];
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
  /** The spec statements the task implements, each with the link to its line. */
  specStatements?: readonly SpecStatementLink[];
}

export interface SpecStatementLink {
  text: string;
  link: string;
}

export function taskIssueBody(input: TaskIssueInput): string {
  return withinLimit(taskIssueLines(input).join("\n"));
}

function taskIssueLines({
  repo,
  storyNumber,
  task,
  dependsOn,
  specStatements,
}: TaskIssueInput): string[] {
  return [
    ...(storyNumber === undefined ? [] : [`Part of #${storyNumber}.`, ""]),
    ...dependencyLine(dependsOn),
    ...implementsSection(specStatements),
    ...section("Context", task.context),
    ...quotes("From the plan", task.plan_quotes),
    ...section("What to change", task.changes ?? task.description),
    ...(task.file_path ? [`Target file: \`${task.file_path}\``, ""] : []),
    ...checklist("## Acceptance criteria", task.acceptance_criteria ?? []),
    ...section("How to test", task.test_plan),
    ...references(repo, task.references ?? []),
  ];
}

const CUT_NOTE = "\n\n*Cut short: GitHub holds 65,536 characters.*\n";

function withinLimit(body: string): string {
  return body.length <= GITHUB_BODY_LIMIT
    ? body
    : body.slice(0, GITHUB_BODY_LIMIT - CUT_NOTE.length) + CUT_NOTE;
}

function dependencyLine(dependsOn: readonly (number | string)[]): string[] {
  const named = dependsOn.map((dep) =>
    typeof dep === "number" ? `#${dep}` : dep,
  );

  return named.length ? [`**Depends on:** ${named.join(", ")}`, ""] : [];
}

function implementsSection(
  statements: readonly SpecStatementLink[] | undefined,
): string[] {
  return statements?.length
    ? [
        "## Implements",
        "",
        ...statements.map(({ text, link }) => `- [${quoted(text)}](${link})`),
        "",
      ]
    : [];
}

const QUOTE_LENGTH = 80;

// Short enough to read as a pointer, with its brackets escaped so they cannot end the link text.
function quoted(text: string): string {
  const short =
    text.length > QUOTE_LENGTH
      ? `${text.slice(0, QUOTE_LENGTH - 1).trimEnd()}…`
      : text;

  return short.replace(/[[\]]/g, "\\$&");
}

function section(heading: string, text: string | undefined): string[] {
  return text ? [`## ${heading}`, "", text, ""] : [];
}

function quotes(heading: string, passages: readonly string[] = []): string[] {
  return passages.length
    ? [
        `## ${heading}`,
        "",
        ...passages.flatMap((passage) => [blockquote(passage), ""]),
      ]
    : [];
}

function blockquote(passage: string): string {
  return passage
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
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
