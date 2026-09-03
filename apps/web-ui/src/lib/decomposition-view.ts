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

/** Group spec-task rows by story Issue (issue order, null last). */
export function groupDecomposition(rows: DecompTaskRow[]): {
  stories: DecompStoryGroup[];
  total: number;
} {
  const byStory = new Map<number | null, DecompTask[]>();

  for (const r of rows) {
    const key = r.context_bundle?.story_issue ?? null;
    const task: DecompTask = {
      specTaskId: r.context_bundle?.spec_task_id ?? "",
      description: r.description,
      status: r.status,
      phase: r.context_bundle?.phase ?? 0,
    };
    const list = byStory.get(key);

    if (list) {
      list.push(task);
      continue;
    }
    byStory.set(key, [task]);
  }

  const stories = [...byStory.entries()]
    .map(([storyIssue, tasks]) => ({
      storyIssue,
      tasks: tasks.sort((a, b) => a.specTaskId.localeCompare(b.specTaskId)),
    }))
    .sort((a, b) => {
      if (a.storyIssue === null) {
        return 1;
      }

      if (b.storyIssue === null) {
        return -1;
      }

      return a.storyIssue - b.storyIssue;
    });

  return { stories, total: rows.length };
}
