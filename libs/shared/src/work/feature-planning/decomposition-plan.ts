// Pure transforms from a DecompositionResult into spec-task rows + Issue bodies (ADR-029); no I/O.

import type { UserStory } from "../../domain/feature-planning/decomposition-result.js";

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

function taskMetadata(
  task: UserStory["tasks"][number],
  ctx: SpecTaskContext,
): SpecTaskRow["metadata"] {
  return {
    spec_task_id: task.id,
    depends_on: task.depends_on,
    spec_slug: ctx.specSlug,
    parallelizable: task.parallelizable,
    phase: task.phase,
    feature_id: ctx.featureId,
    ...(task.file_path ? { file_path: task.file_path } : {}),
    ...(ctx.storyIssue !== undefined ? { story_issue: ctx.storyIssue } : {}),
  };
}

/** Build the spec-task rows for one story's tasks, linked to the story Issue (when created) and the owning feature. */
export function specTaskRows(
  story: UserStory,
  ctx: SpecTaskContext,
): SpecTaskRow[] {
  return story.tasks.map((task) => ({
    title: `${task.id}: ${task.description}`,
    metadata: taskMetadata(task, ctx),
  }));
}

/** A heading followed by its bullets and a trailing blank, or nothing at all when there are no bullets. */
function bulletSection(heading: string, bullets: string[]): string[] {
  return bullets.length ? [heading, ...bullets, ""] : [];
}

/** Build the GitHub Issue body for a user story. */
export function storyIssueBody(
  story: UserStory,
  opts: { specPath: string; featureTitle: string },
): string {
  const parts = [
    story.summary,
    "",
    ...bulletSection(
      "## Acceptance criteria",
      story.acceptance_criteria.map((c) => `- [ ] ${c}`),
    ),
    ...bulletSection(
      "## Tasks",
      story.tasks.map((t) => `- ${t.id}: ${t.description}`),
    ),
    "---",
    `Decomposed from **${opts.featureTitle}** — spec: \`${opts.specPath}\`.`,
  ];

  return parts.join("\n");
}
