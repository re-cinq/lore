// The GitHub half of the backlog view: the repo's open issues, the open blockers of the queued ones, and the open pull requests a settled task could still hold a ticket through.
import { orderBacklog } from "@re-cinq/lore-shared";
import { isSettledTask } from "@re-cinq/lore-shared/backlog/ticket-holder.js";
import { projectFor } from "../../../outbound/project-boot.js";
import type { LoopTaskRow, taskTicket } from "./backlog-ticket.js";

type OpenIssues = Parameters<typeof taskTicket>[1];

export interface BacklogIssues {
  openIssues: OpenIssues;
  /** Open blockers of each queued ticket that carries a blocked-by link. */
  openBlockers: Map<number, number[]>;
  /** Head branches of the repo's open pull requests; read only when a settled task could still hold a queued ticket. */
  openPrBranches: Set<string>;
}

/** The repo's open issues, and the open blockers of the queued ones. Only a ticket whose listing reports a blocked-by link costs a second GitHub read, the driver's own rule (FR2). */
export async function readIssues(
  repo: string,
  taskRows: LoopTaskRow[],
): Promise<BacklogIssues> {
  const project = await projectFor(repo);
  const { issues } = project;
  const openIssues = await issues.list({ state: "open" });
  const queued = orderBacklog(openIssues);
  const linked = queued.filter((i) => i.blockedByCount);
  const blockers = await Promise.all(
    linked.map((i) => issues.openBlockers(i.number)),
  );

  return {
    openIssues,
    openBlockers: new Map(linked.map((i, at) => [i.number, blockers[at]])),
    openPrBranches: await readOpenPrBranches(project, queued, taskRows),
  };
}

/** Pull requests matter only to a queued ticket whose task settled, so a backlog with none of those costs no GitHub read. */
async function readOpenPrBranches(
  { pulls }: Awaited<ReturnType<typeof projectFor>>,
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
