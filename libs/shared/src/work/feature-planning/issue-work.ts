// What the `issues` station files, decided from the decomposition alone. Pure: the station does the IO, this decides.

import type {
  DecompositionResult,
  UserStory,
} from "../../domain/feature-planning/decomposition-result.js";

/** Every Lore-filed issue carries this, so a repo can find or ignore them all. */
export const BASE_STORY_LABELS = ["lore-managed", "user-story"] as const;

/** Every task issue carries these: filterable as Lore's, and as a spec-task. */
export const BASE_TASK_LABELS = ["lore-managed", "spec-task"] as const;

/** The ONE issue a plan becomes; its decomposed slices are sections inside it. */
export interface PlannedStory {
  title: string;
  labels: string[];
}

export interface PlannedTask {
  /** The task issue's title: its id, then its own title or its description. */
  title: string;
  description: string;
  labels: string[];
  /** Which slice (story section) this task belongs to. */
  storyIndex: number;
  task: UserStory["tasks"][number];
}

export type IssueWork =
  | { outcome: "proceed"; story: PlannedStory; tasks: PlannedTask[] }
  | { outcome: "changes_requested"; objection: string };

/** The story issue and task issues a decomposition calls for, or the objection that sends it back; rejects invented labels because GitHub's create-issue silently adds unknown ones to the repo's real taxonomy. */
export function decideIssueWork(
  decomposition: DecompositionResult,
  repoLabels: readonly string[],
  planTitle?: string,
): IssueWork {
  const objection = firstObjection(decomposition, repoLabels);

  if (objection) {
    return { outcome: "changes_requested", objection };
  }
  const { stories } = decomposition;

  return {
    outcome: "proceed",
    story: plannedStory(stories, planTitle),
    tasks: plannedTasks(stories),
  };
}

/** Why this decomposition cannot be filed, if it cannot. Each objection is written to be ACTED ON by the model that produced it — this text goes back as the rework prompt, so "no user stories" and a list of the exact unknown labels are instructions, not diagnostics. Labels are checked against the repo because inventing one silently files an Issue nobody's filters will ever show. */
function firstObjection(
  decomposition: DecompositionResult,
  repoLabels: readonly string[],
): string | null {
  if (decomposition.stories.length === 0) {
    return "the decomposition contains no user stories";
  }
  const { stories } = decomposition;
  const taskless = stories.find((s) => s.tasks.length === 0);

  if (taskless) {
    return `the story "${taskless.title}" breaks into no tasks — a story nobody can start is not an implementation plan`;
  }

  return unknownLabelObjection(stories, repoLabels);
}

/** The objection naming every label the decomposition invented, or null when all of them already exist in the repo. */
function unknownLabelObjection(
  stories: DecompositionResult["stories"],
  repoLabels: readonly string[],
): string | null {
  const known = new Set(repoLabels);
  const unknown = new Set(
    stories
      .flatMap((story) => proposedLabels(story))
      .filter((label) => !known.has(label)),
  );

  if (unknown.size === 0) {
    return null;
  }
  const named = [...unknown]
    .sort()
    .map((l) => `"${l}"`)
    .join(", ");

  return `these labels do not exist in this repository: ${named}. Use only labels the repo already has.`;
}

/** Every label the decomposition proposes for a story and its tasks. */
function proposedLabels(story: UserStory): string[] {
  return [
    ...(story.labels ?? []),
    ...story.tasks.flatMap((t) => t.labels ?? []),
  ];
}

function plannedStory(
  stories: DecompositionResult["stories"],
  planTitle: string | undefined,
): PlannedStory {
  return {
    title: `User story: ${planTitle ?? stories[0].title}`,
    labels: distinct([
      ...stories.flatMap((story) => story.labels ?? []),
      ...BASE_STORY_LABELS,
    ]),
  };
}

function plannedTasks(stories: DecompositionResult["stories"]): PlannedTask[] {
  return stories.flatMap((story, storyIndex) =>
    story.tasks.map((task) => ({
      title: `${task.id}: ${task.title ?? task.description}`,
      description: task.description,
      labels: distinct([...(task.labels ?? []), ...BASE_TASK_LABELS]),
      storyIndex,
      task,
    })),
  );
}

function distinct(labels: string[]): string[] {
  return [...new Set(labels)];
}
