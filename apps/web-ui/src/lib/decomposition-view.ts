import type { components } from "@/lib/api/schema";
// Group spec-task rows by story (ADR-029); context_bundle owned by issues station.

export type DecompTaskRow =
  components["schemas"]["FeatureDecomposition"]["tasks"][number];

export interface DecompTask {
  specTaskId: string;
  description: string;
  status: string;
  phase: number;
}

export interface DecompStoryGroup {
  /** The story's GitHub Issue number, or null for tasks created without an Issue. */
  storyIssue: number | null;
  tasks: DecompTask[];
}

function taskFromRow(r: DecompTaskRow): DecompTask {
  return {
    specTaskId: r.context_bundle?.spec_task_id ?? "",
    description: r.description,
    status: r.status,
    phase: r.context_bundle?.phase ?? 0,
  };
}

function groupByStory(rows: DecompTaskRow[]): Map<number | null, DecompTask[]> {
  const byStory = new Map<number | null, DecompTask[]>();

  for (const r of rows) {
    const key = r.context_bundle?.story_issue ?? null;
    const list = byStory.get(key);

    if (list) {
      list.push(taskFromRow(r));
      continue;
    }
    byStory.set(key, [taskFromRow(r)]);
  }

  return byStory;
}

/** null (no story issue) sorts last. */
function compareStoryIssues(a: number | null, b: number | null): number {
  if (a === null) {
    return 1;
  }

  if (b === null) {
    return -1;
  }

  return a - b;
}

/** Group spec-task rows by story Issue (issue order, null last). */
export function groupDecomposition(rows: DecompTaskRow[]): {
  stories: DecompStoryGroup[];
  total: number;
} {
  const stories = [...groupByStory(rows).entries()]
    .map(([storyIssue, tasks]) => ({
      storyIssue,
      tasks: tasks.sort((a, b) => a.specTaskId.localeCompare(b.specTaskId)),
    }))
    .sort((a, b) => compareStoryIssues(a.storyIssue, b.storyIssue));

  return { stories, total: rows.length };
}
