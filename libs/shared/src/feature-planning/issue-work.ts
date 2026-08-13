// What the `issues` station files, decided from the decomposition alone.
//
// Pure: the station does the IO, this decides. It is also the first place the
// decomposition is read as DATA rather than prose, so it is where "the agent made
// something unusable" actually becomes visible — and where the station sends it back.

import type { DecompositionResult, UserStory } from "./decomposition-result.js";

/** Every Lore-filed issue carries this, so a repo can find or ignore them all. */
export const BASE_STORY_LABELS = ["lore-managed", "user-story"] as const;

export interface PlannedIssue {
  title: string;
  labels: string[];
  storyIndex: number;
}

export interface PlannedTask {
  description: string;
  labels: string[];
  /** Which story this task belongs to, so the caller can attach the filed issue. */
  storyIndex: number;
  task: UserStory["tasks"][number];
}

export type IssueWork =
  | { outcome: "proceed"; issues: PlannedIssue[]; tasks: PlannedTask[] }
  | { outcome: "changes_requested"; objection: string };

/**
 * The issues and spec-tasks a decomposition calls for, or the objection that sends
 * it back.
 *
 * Labels are checked against the repo's REAL labels because GitHub's create-issue
 * silently creates one it does not know: an agent that invents `area:frontend` would
 * not fail, it would permanently add that label to the taxonomy. Rejecting is the
 * only way the agent finds out it guessed — and naming every unknown label at once
 * means one correction fixes them all rather than one per round.
 *
 * A repo with no labels of its own is not an error; the work still gets filed under
 * the base labels. The check is "did you invent one", not "does this repo have a
 * taxonomy".
 */
export function decideIssueWork(
  decomposition: DecompositionResult,
  repoLabels: readonly string[],
): IssueWork {
  if (decomposition.stories.length === 0) {
    return {
      outcome: "changes_requested",
      objection: "the decomposition contains no user stories",
    };
  }
  const taskless = decomposition.stories.find((s) => s.tasks.length === 0);

  if (taskless) {
    return {
      outcome: "changes_requested",
      objection: `the story "${taskless.title}" breaks into no tasks — a story nobody can start is not an implementation plan`,
    };
  }
  const known = new Set(repoLabels);
  const unknown = new Set<string>();

  for (const story of decomposition.stories) {
    for (const label of proposedLabels(story)) {
      if (!known.has(label)) {
        unknown.add(label);
      }
    }
  }

  if (unknown.size > 0) {
    const named = [...unknown]
      .sort()
      .map((l) => `"${l}"`)
      .join(", ");

    return {
      outcome: "changes_requested",
      objection: `these labels do not exist in this repository: ${named}. Use only labels the repo already has.`,
    };
  }

  return {
    outcome: "proceed",
    issues: decomposition.stories.map((story, storyIndex) => ({
      title: `User story: ${story.title}`,
      labels: [...(story.labels ?? []), ...BASE_STORY_LABELS],
      storyIndex,
    })),
    tasks: decomposition.stories.flatMap((story, storyIndex) =>
      story.tasks.map((task) => ({
        description: task.description,
        labels: task.labels ?? [],
        storyIndex,
        task,
      })),
    ),
  };
}

/** Every label the decomposition proposes for a story and its tasks. */
function proposedLabels(story: UserStory): string[] {
  return [
    ...(story.labels ?? []),
    ...story.tasks.flatMap((t) => t.labels ?? []),
  ];
}
