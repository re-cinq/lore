// How the issues station recognises the issues it already filed for a plan, so a rerun updates them instead of filing a second set. Each body ends with an HTML comment naming its plan (and task), invisible on GitHub and kept through a person's edits of the visible text. Pure.

import type { IssueRef } from "../../outbound/project/lib/github-port.js";

export function storyMarker(planId: string): string {
  return `<!-- lore-plan: ${planId} -->`;
}

export function taskMarker(planId: string, taskId: string): string {
  return `<!-- lore-plan-task: ${planId}/${taskId} -->`;
}

export function withMarker(body: string, marker: string): string {
  return `${body.trimEnd()}\n\n${marker}\n`;
}

export interface PlanIssues {
  story?: IssueRef;
  /** Task id → its issue, open or closed. */
  tasks: Map<string, IssueRef>;
}

const TASK_MARKER = /<!-- lore-plan-task: ([^/\s]+)\/(\S+) -->/;

export function findPlanIssues(
  issues: readonly IssueRef[],
  planId: string,
): PlanIssues {
  const story = issues.find((issue) =>
    issue.body?.includes(storyMarker(planId)),
  );
  const tasks = new Map<string, IssueRef>();

  for (const issue of issues) {
    const match = issue.body?.match(TASK_MARKER);

    if (match?.[1] === planId) {
      tasks.set(match[2], issue);
    }
  }

  return { ...(story ? { story } : {}), tasks };
}
