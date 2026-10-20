// Whether earlier work still holds a backlog ticket. A parked run settles its task as `completed` with no pull request, and counting every completed task as "its pull request awaits review" kept re-cinq/Otto's re-queued tickets out of the loop for weeks.
import { implementationLoopBranch } from "../../outbound/project/assembly-runs/subject-keys.js";
import type { Project } from "../../outbound/project/index.js";

const SETTLED_TASK_STATUSES: readonly string[] = ["completed", "merged"];

/** Whether the task's work ended; such a task holds its ticket only through a pull request still open on the loop branch. */
export function isSettledTask(status: string): boolean {
  return SETTLED_TASK_STATUSES.includes(status);
}

export interface TicketHolderDeps {
  activeTaskByIssue(
    repo: string,
    issueNumber: number,
  ): Promise<{ id: string; status: string } | null>;
  openPrForBranch(
    repo: string,
    branch: string,
  ): Promise<{ number: number } | null>;
}

/** The task still holding the ticket: one in flight, or a settled one whose pull request is still open. */
export async function taskHoldingTicket(
  deps: TicketHolderDeps,
  repo: string,
  issueNumber: number,
): Promise<{ id: string } | null> {
  const task = await deps.activeTaskByIssue(repo, issueNumber);

  if (!task || !isSettledTask(task.status)) {
    return task;
  }
  const openPr = await deps.openPrForBranch(
    repo,
    implementationLoopBranch(issueNumber),
  );

  return openPr ? task : null;
}

/** The open pull request whose head is the branch, or null. */
export async function openPrOnBranch(
  project: Pick<Project, "pulls">,
  branch: string,
): Promise<{ number: number; url: string } | null> {
  const open = await project.pulls.list();
  const forBranch = open.find((pr) => pr.branch === branch);

  return forBranch ? { number: forBranch.number, url: forBranch.url } : null;
}
