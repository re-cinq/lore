// The GitHub half of the backlog view: the repo's queued issues, the open blockers of the queued ones, and the open pull requests a settled task could still hold a ticket through.
import { orderBacklog } from "@re-cinq/lore-shared";
import type { IssueRef } from "@re-cinq/lore-shared";
import { PRIORITY_LABELS } from "@re-cinq/lore-shared/backlog/labels.js";
import { isSettledTask } from "@re-cinq/lore-shared/backlog/ticket-holder.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { memoizeWithTtl } from "../../../work/chunks/ttl-memo.js";
import type { LoopTaskRow } from "./backlog-ticket.js";

type OpenIssues = readonly IssueRef[];

type Project = Awaited<ReturnType<typeof projectFor>>;

/** The repository's open issues the board shows, read through a cache the route holds. */
export type QueuedIssues = (
  repo: string,
  issues: Project["issues"],
) => Promise<OpenIssues>;

/** How long a repository's queued issues are answered from memory: the board re-reads on every run frame, and a repository with hundreds of open issues takes seconds to list. */
const QUEUED_FRESH_MS = 30_000;

/** Every open issue that carries a priority label, which is every issue the board shows (queued, parked, or a picked ticket's), read once per label and held per repository for 30 seconds. A repository's other open issues are never read: re-cinq/lore has 555, which took five seconds a load. */
export function queuedIssuesReader(): QueuedIssues {
  const byRepo = new Map<string, () => Promise<OpenIssues>>();

  return (repo, issues) => {
    const read =
      byRepo.get(repo) ??
      memoizeWithTtl(() => priorityIssues(issues), QUEUED_FRESH_MS);

    byRepo.set(repo, read);

    return read();
  };
}

/** One read per priority label, since GitHub's label filter asks for all the labels it is given; an issue with two shows once. */
async function priorityIssues(issues: Project["issues"]): Promise<OpenIssues> {
  const lists = await Promise.all(
    PRIORITY_LABELS.map((label) =>
      issues.list({ state: "open", labels: [label] }),
    ),
  );

  return [...new Map(lists.flat().map((i) => [i.number, i])).values()];
}

export interface BacklogIssues {
  openIssues: OpenIssues;
  /** Open blockers of each queued ticket that carries a blocked-by link. */
  openBlockers: Map<number, number[]>;
  /** Head branches of the repo's open pull requests; read only when a settled task could still hold a queued ticket. */
  openPrBranches: Set<string>;
}

/** The loop's task rows, given the open issues the board shows: their own tasks are read whatever their age. */
export type LoopTasksFor = (
  openIssueNumbers: readonly number[],
) => Promise<LoopTaskRow[]>;

/** The repo's open issues, the loop's tasks for them, and the open blockers of the queued ones. Only a ticket whose listing reports a blocked-by link costs a second GitHub read, the driver's own rule (FR2). */
export async function readIssues(
  repo: string,
  queuedIssues: QueuedIssues,
  tasksFor: LoopTasksFor,
  criteria?: import("@re-cinq/lore-shared/backlog/select-next-issue.js").RankingCriterion[],
): Promise<BacklogIssues & { taskRows: LoopTaskRow[] }> {
  const project = await projectFor(repo);
  const openIssues = await queuedIssues(repo, project.issues);
  const queued = orderBacklog(openIssues, { criteria });
  const [taskRows, openBlockers] = await Promise.all([
    tasksFor(openIssues.map((i) => i.number)),
    readOpenBlockers(project.issues, queued),
  ]);

  return {
    openIssues,
    taskRows,
    openBlockers,
    openPrBranches: await readOpenPrBranches(project, queued, taskRows),
  };
}

async function readOpenBlockers(
  issues: Project["issues"],
  queued: OpenIssues,
): Promise<Map<number, number[]>> {
  const linked = queued.filter((i) => i.blockedByCount);
  const blockers = await Promise.all(
    linked.map((i) => issues.openBlockers(i.number)),
  );

  return new Map(linked.map((i, at) => [i.number, blockers[at]]));
}

/** Pull requests matter only to a queued ticket whose task settled, so a backlog with none of those costs no GitHub read. */
async function readOpenPrBranches(
  { pulls }: Project,
  queued: OpenIssues,
  taskRows: LoopTaskRow[],
): Promise<Set<string>> {
  const queuedNumbers = new Set(queued.map((i) => i.number));
  const settledOnQueued = taskRows.some(
    (t) =>
      isSettledTask(t.status) &&
      t.issue_number !== null &&
      queuedNumbers.has(t.issue_number),
  );
  const openPrs = settledOnQueued ? await pulls.list() : [];

  return new Set(openPrs.map((pr) => pr.branch));
}
