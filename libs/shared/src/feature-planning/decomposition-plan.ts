// Pure transforms from a parsed DecompositionResult into the artifacts the
// coordinator persists (ADR-029): one spec-task row per task and the GitHub
// Issue body per story. No I/O — the handler creates the Issue, then feeds its
// number back here to stamp the rows.

import type { UserStory } from "./decomposition-result.js";

export interface SpecTaskRow {
  /** "T001: <description>" — matches the tasks.md-sync convention. */
  title: string;
  metadata: {
    spec_task_id: string;
    depends_on: string[];
    spec_slug: string;
    parallelizable: boolean;
    phase: number;
    file_path?: string;
    story_issue?: number;
    feature_id: string;
  };
}

export interface SpecTaskContext {
  specSlug: string;
  featureId: string;
  /** The story's GitHub Issue number, when one was created. */
  storyIssue?: number;
}

/** Build the spec-task rows for one story's tasks, linked to the story Issue
 *  (when created) and the owning feature. */
export function specTaskRows(
  story: UserStory,
  ctx: SpecTaskContext,
): SpecTaskRow[] {
  return story.tasks.map((task) => {
    const metadata: SpecTaskRow["metadata"] = {
      spec_task_id: task.id,
      depends_on: task.depends_on,
      spec_slug: ctx.specSlug,
      parallelizable: task.parallelizable,
      phase: task.phase,
      feature_id: ctx.featureId,
    };
    if (task.file_path) metadata.file_path = task.file_path;
    if (ctx.storyIssue !== undefined) metadata.story_issue = ctx.storyIssue;
    return { title: `${task.id}: ${task.description}`, metadata };
  });
}

/** Build the GitHub Issue body for a user story. */
export function storyIssueBody(
  story: UserStory,
  opts: { specPath: string; featureTitle: string },
): string {
  const parts = [story.summary, ""];
  if (story.acceptance_criteria.length) {
    parts.push(
      "## Acceptance criteria",
      ...story.acceptance_criteria.map((c) => `- [ ] ${c}`),
      "",
    );
  }
  if (story.tasks.length) {
    parts.push(
      "## Tasks",
      ...story.tasks.map((t) => `- ${t.id}: ${t.description}`),
      "",
    );
  }
  parts.push(
    "---",
    `Decomposed from **${opts.featureTitle}** — spec: \`${opts.specPath}\`.`,
  );
  return parts.join("\n");
}
