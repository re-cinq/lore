// The implementation loop on the external floor (ADR-049): how a ticket the tick has minted a task for becomes a run there, and how the tick asks whether a repository already has one open.
import type { FloorClient } from "@re-cinq/floor-client";
import { errorMessage } from "../../lib/error-classify.js";
import {
  fileItem,
  floorRepoOf,
  gitItem,
  valueItem,
} from "../../outbound/floor/floor-items.js";
import { startLine } from "../review/floor-line-start.js";
import type { StartedTicket } from "./implementation-loop-tick.js";

export const LOOP_LINE = "implementation-loop";

/** The value every loop run of a repository is keyed on, so the floor holds one open run per repository: one ticket at a time. */
const BACKLOG = "tickets";

/** The floor's subject key for a repository's loop run: `<the line's subject argument>:<its value>`. */
export const FLOOR_BACKLOG_SUBJECT = `backlog:${BACKLOG}`;

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
    await startLoopRun(deps.floor, ticket);
  } catch (err) {
    await deps.failTask(
      ticket.taskId,
      `the ticket could not be started on the floor: ${errorMessage(err)}`,
    );
    throw err;
  }
}

async function startLoopRun(
  floor: LoopFloor,
  { repo, branch, taskId, issue, description }: StartedTicket,
): Promise<void> {
  const stored = await floor.blobs.put(
    new TextEncoder().encode(description),
    "text/markdown",
  );

  await startLine(floor.lines, LOOP_LINE, {
    repo: floorRepoOf(repo),
    startItems: {
      repo: gitItem(repo, branch),
      backlog: valueItem(BACKLOG),
      task_id: valueItem(taskId),
      ticket: fileItem(stored.hash),
      issue_title: valueItem(issue.title),
      issue_number: valueItem(issue.number),
    },
  });
}

export interface LoopRunsFloor {
  runs: Pick<FloorClient["runs"], "list">;
}

/** The repository's open loop run, or null: what keeps the tick from picking a second ticket while one is being worked. */
export async function openFloorLoopRun(
  floor: LoopRunsFloor,
  repo: string,
): Promise<{ id: string } | null> {
  const { items: openRuns } = await floor.runs.list({
    repo: floorRepoOf(repo),
    line: LOOP_LINE,
    subject: FLOOR_BACKLOG_SUBJECT,
    open: true,
  });
  const run = openRuns.at(0);

  return run ? { id: run.id } : null;
}
