// What a plan's task is told to build, and where it builds it: the ticket its implementation-loop run reads.
import { taskIssueDetail } from "../../domain/feature-planning/decomposition-result.js";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type { ReadySpecTask } from "../../outbound/project/tasks/task-queue-port.js";
import { taskIssueBody } from "../feature-planning/issue-bodies.js";

/** The task issue as it reads now. */
export type LiveIssue = Pick<IssueRef, "title" | "body">;

export interface SpecTaskBrief {
  /** The task issue's number, absent for a task that was never filed as one. */
  issueNumber: number | undefined;
  description: string;
  issueTitle: string;
  branchName: string;
}

type Bundle = Record<string, unknown> & {
  spec_slug?: string;
  spec_task_id?: string;
};

/** The brief reads the task issue as it is now, so a person's edit between filing and dispatch reaches the agent; with no live issue it reads what was filed. */
export function specTaskBrief(
  task: ReadySpecTask,
  live?: LiveIssue,
): SpecTaskBrief {
  const cb = (task.context_bundle ?? {}) as Bundle;
  const detail = live?.body ?? briefDetail(task, cb);

  return {
    issueNumber: taskIssueOf(task),
    description: `${briefHeader(task, cb, live?.title)}\n\n${detail}${specRef(cb.spec_slug)}`,
    issueTitle: issueTitleOf(task, cb, live),
    branchName: specTaskBranch(task, cb),
  };
}

export function taskIssueOf(task: ReadySpecTask): number | undefined {
  const number = task.context_bundle?.task_issue;

  return typeof number === "number" ? number : undefined;
}

function specRef(specSlug: string | undefined): string {
  return specSlug
    ? `\n\nREAD specs/${specSlug}/spec.md, specs/${specSlug}/plan.md and specs/${specSlug}/tasks.md first for full context.`
    : "";
}

function specTaskBranch(task: ReadySpecTask, cb: Bundle): string {
  const slug = cb.spec_slug || "spec-task";

  return `lore/spec-task/${slug}-${(cb.spec_task_id || "").toLowerCase()}-${task.id.substring(0, 8)}`;
}

// The task issue's title as it reads now, else as the issues station filed it (`T001: <title>`).
function issueTitleOf(
  task: ReadySpecTask,
  cb: Bundle,
  live: LiveIssue | undefined,
): string {
  return live?.title ?? `${String(cb.spec_task_id)}: ${filedTitle(task, cb)}`;
}

function filedTitle(task: ReadySpecTask, cb: Bundle): string {
  return typeof cb.title === "string" ? cb.title : task.description;
}

// The issue is filed as `T001: <title>`, so its live title is read back without that prefix.
function briefHeader(
  task: ReadySpecTask,
  cb: Bundle,
  liveTitle?: string,
): string {
  const taskId = String(cb.spec_task_id);
  const issue =
    typeof cb.task_issue === "number" ? ` (issue #${cb.task_issue})` : "";
  const title = liveTitle?.replace(`${taskId}: `, "") ?? filedTitle(task, cb);

  return `Implement spec-task ${taskId}${issue}: ${title}`;
}

// The same Markdown its task issue carries, so the agent works from what a developer would read.
function briefDetail(task: ReadySpecTask, cb: Bundle): string {
  return taskIssueBody({
    repo: task.target_repo,
    ...(typeof cb.story_issue === "number"
      ? { storyNumber: cb.story_issue }
      : {}),
    dependsOn: [],
    task: {
      id: String(cb.spec_task_id),
      description: task.description,
      depends_on: [],
      parallelizable: false,
      phase: 0,
      ...(typeof cb.file_path === "string" ? { file_path: cb.file_path } : {}),
      ...taskIssueDetail(cb),
    },
  });
}
