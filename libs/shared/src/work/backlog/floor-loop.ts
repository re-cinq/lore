// The implementation loop on the external floor (ADR-049): how a ticket the tick has minted a task for becomes a run there, and how the tick asks whether a repository already has one open.
import type { FloorClient, RunView } from "@re-cinq/floor-client";
import { errorMessage } from "../../lib/error-classify.js";
import {
  fileItem,
  floorRepoOf,
  gitItem,
  valueItem,
} from "../../outbound/floor/floor-items.js";
import { startValueOf } from "../../outbound/floor/run-start-items.js";
import { startLine } from "../review/floor-line-start.js";
import type { StartedTicket } from "./implementation-loop-tick.js";
import type { OpenPr } from "./resume-branch.js";

export const LOOP_LINE = "implementation-loop";

/** What every ticket run was keyed on before a ticket had a key of its own: one open run per repository. Runs open at deploy still carry it. */
const LEGACY_TICKETS_BACKLOG = "tickets";

const TICKET_BACKLOG = "ticket-";

/** What a backlog ticket's run is keyed on: its issue, so the floor's unique subject index guards one open run per ticket. */
export function ticketBacklog(issueNumber: number): string {
  return `${TICKET_BACKLOG}${issueNumber}`;
}

const PLAN_TASK_BACKLOG = "spec-task-";

/** What a plan's task is keyed on instead: itself. Its run goes beside the backlog's, so it neither waits for the repository's ticket nor holds the next one back. */
export function planTaskBacklog(taskId: string): string {
  return `${PLAN_TASK_BACKLOG}${taskId}`;
}

export function isPlanTaskBacklog(backlog: string | undefined): boolean {
  return backlog?.startsWith(PLAN_TASK_BACKLOG) ?? false;
}

export interface LoopFloor {
  lines: Pick<FloorClient["lines"], "start">;
  blobs: Pick<FloorClient["blobs"], "put">;
}

export interface FloorTicketDeps {
  floor: LoopFloor;
  /** Takes the pending task for the floor; false when something else claimed it first. */
  claim(taskId: string): Promise<boolean>;
  ensureBranch(repo: string, branch: string): Promise<void>;
  failTask(taskId: string, reason: string): Promise<void>;
}

/** Claims the ticket's task and starts its run. A start that fails has to fail the task itself: claimed and left running, the ticket would be guarded as in flight and never picked again. */
export async function startTicketOnFloor(
  deps: FloorTicketDeps,
  ticket: StartedTicket,
): Promise<void> {
  if (!(await deps.claim(ticket.taskId))) {
    return;
  }

  try {
    await deps.ensureBranch(ticket.repo, ticket.branch);
    await startLoopRun(deps.floor, ticketRunStart(ticket));
  } catch (err) {
    await deps.failTask(
      ticket.taskId,
      `the ticket could not be started on the floor: ${errorMessage(err)}`,
    );
    throw err;
  }
}

function ticketRunStart(ticket: StartedTicket): LoopRunStart {
  return { ...ticket, backlog: ticketBacklog(ticket.issue.number) };
}

/** What a loop run is started for: a backlog ticket, or a plan's task. */
export interface LoopRunStart {
  repo: string;
  taskId: string;
  branch: string;
  /** A plan's task that was never filed as an issue has a title and no number. */
  issue: { title: string; number?: number };
  /** The work as the agents read it. */
  description: string;
  /** The value the run is keyed on. */
  backlog: string;
  /** The pull request the branch already has, a start item so the run page shows it before its open-pr node finds it again. */
  openPr?: OpenPr | null;
  /** The node the run starts at; left out, the line's entry. An upkeep run of a settled pull request starts at `sync-pr`. */
  entry?: string;
}

export async function startLoopRun(
  floor: LoopFloor,
  start: LoopRunStart,
): Promise<void> {
  const stored = await floor.blobs.put(
    new TextEncoder().encode(start.description),
    "text/markdown",
  );

  await startLine(floor.lines, LOOP_LINE, {
    repo: floorRepoOf(start.repo),
    startItems: loopStartItems(start, stored.hash),
    ...(start.entry ? { entry: start.entry } : {}),
  });
}

function loopStartItems(
  { repo, branch, taskId, issue, backlog, openPr }: LoopRunStart,
  ticketHash: string,
) {
  return {
    repo: gitItem(repo, branch),
    backlog: valueItem(backlog),
    task_id: valueItem(taskId),
    ticket: fileItem(ticketHash),
    issue_title: valueItem(issue.title),
    ...(issue.number ? { issue_number: valueItem(issue.number) } : {}),
    ...(openPr ? { pr_url: valueItem(openPr.url) } : {}),
  };
}

export interface LoopRunsFloor {
  runs: Pick<FloorClient["runs"], "list">;
}

/** Whether a run is a backlog ticket's, under either key: its issue's, or the one every ticket run shared before. An upkeep run and a plan's task are not. */
export function isTicketRun(run: RunView): boolean {
  const backlog = startValueOf(run, "backlog");

  return (
    backlog === LEGACY_TICKETS_BACKLOG ||
    (backlog?.startsWith(TICKET_BACKLOG) ?? false)
  );
}

/** The repository's open ticket runs: what keeps the tick from starting more than `implementation_loop.max_parallel`. */
export async function openFloorTicketRuns(
  floor: LoopRunsFloor,
  repo: string,
): Promise<RunView[]> {
  const { items: openRuns } = await floor.runs.list({
    repo: floorRepoOf(repo),
    line: LOOP_LINE,
    open: true,
  });

  return openRuns.filter(isTicketRun);
}

/** The open run of one ticket, or null: how a named ticket already running is told from one that can start. */
export async function openRunOfTicket(
  floor: LoopRunsFloor,
  repo: string,
  issueNumber: number,
): Promise<{ id: string } | null> {
  const run = (await openFloorTicketRuns(floor, repo)).find(
    (open) => startValueOf(open, "issue_number") === String(issueNumber),
  );

  return run ? { id: run.id } : null;
}
