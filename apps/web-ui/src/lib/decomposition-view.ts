// Group a feature's spec-task rows (ADR-029) into the story tree the detail view
// renders. Pure — the page does the DB read, this shapes it. Mirrors the
// metadata the feature-decompose handler writes into context_bundle.

export interface DecompTaskRow {
  description: string;
  status: string;
  context_bundle: {
    spec_task_id?: string;
    story_issue?: number;
    phase?: number;
  } | null;
}

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

/** Group spec-task rows by their story Issue (issue order, null last); tasks
 *  within a story keep spec-task-id order. */
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
    if (list) list.push(task);
    else byStory.set(key, [task]);
  }

  const stories = [...byStory.entries()]
    .map(([storyIssue, tasks]) => ({
      storyIssue,
      tasks: tasks.sort((a, b) => a.specTaskId.localeCompare(b.specTaskId)),
    }))
    .sort((a, b) => {
      if (a.storyIssue === null) return 1;
      if (b.storyIssue === null) return -1;
      return a.storyIssue - b.storyIssue;
    });

  return { stories, total: rows.length };
}
