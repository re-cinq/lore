// Ticket projection: task/run/node rows read for the backlog view, folded into the pure `Ticket` shape the route hands back.

import type { IssueRef } from "@re-cinq/lore-shared";
import type { WireOf } from "@re-cinq/lore-shared/lib/wire-schema.js";
import { pickColumns } from "@re-cinq/lore-shared/lib/row.js";
import {
  PipelineTaskSchema,
  PIPELINE_TASK_COLUMNS,
} from "@re-cinq/lore-shared/models/pipeline-task.js";
import { PRIORITY_LABELS } from "@re-cinq/lore-shared";
import { ticketHold } from "@re-cinq/lore-shared/backlog/ticket-hold.js";
import { isSettledTask } from "@re-cinq/lore-shared/backlog/ticket-holder.js";
import { OPEN_TASK_STATES } from "@re-cinq/lore-shared/project/tasks/task-store-port.js";
import { implementationLoopBranch } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
import {
  miniPipeline,
  type PipelineNode,
} from "../../../work/assembly-line-station/mini-pipeline.js";
import type { Ticket } from "./backlog-schema.js";

// The implementation-loop task fields the backlog view reads, picked from the pipeline.tasks wire contract.
const LOOP_TASK_FIELDS = [
  "id",
  "createdAt",
  "status",
  "description",
  "issueNumber",
  "issueUrl",
  "prUrl",
  "failureReason",
] as const;

export const LOOP_TASK_COLUMNS = pickColumns(
  PIPELINE_TASK_COLUMNS,
  LOOP_TASK_FIELDS,
);

export type LoopTaskRow = Pick<
  WireOf<typeof PipelineTaskSchema.shape, typeof PIPELINE_TASK_COLUMNS>,
  | "id"
  | "created_at"
  | "status"
  | "description"
  | "issue_number"
  | "issue_url"
  | "pr_url"
  | "failure_reason"
>;

export const priorityOf = (issue: IssueRef | undefined): string | null =>
  issue?.labels.find((l) =>
    (PRIORITY_LABELS as readonly string[]).includes(l),
  ) ?? null;

export interface LoopRunRow {
  id: string;
  task_id: string;
  status: string;
  reason: string | null;
  graph: { nodes?: Array<{ id: string; type: string }> } | null;
}

export interface NodeRow {
  assembly_run_id: string;
  node_id: string;
  iteration: number;
  outcome: string | null;
}

/** What a task row's own ticket projection reads: the repo's open issues (to find the ticket's title/priority), the run it belongs to per task id, the node visits of every such run, and which loop branches still have an open pull request. `BacklogState` satisfies this structurally, so the route passes it straight through. */
export interface TaskTicketContext {
  openIssues: readonly IssueRef[];
  runByTask: ReadonlyMap<string, LoopRunRow>;
  nodeRows: readonly NodeRow[];
  openPrBranches: ReadonlySet<string>;
}

/** A settled task (`completed`/`merged`) whose loop branch still has an open pull request — the reason a ticket a human has not merged yet still holds its backlog slot. */
export function isAwaitingMerge(
  row: LoopTaskRow,
  openPrBranches: ReadonlySet<string>,
): boolean {
  return (
    isSettledTask(row.status) &&
    row.issue_number !== null &&
    openPrBranches.has(implementationLoopBranch(row.issue_number))
  );
}

/** A task counts as "being worked" either by its own stored status, or because its run is live on the floor right now — a ticket someone revived by hand after its task had already settled as `failed`. */
export function isCurrentTask(
  t: LoopTaskRow,
  runByTask: ReadonlyMap<string, LoopRunRow>,
): boolean {
  return (
    (OPEN_TASK_STATES as readonly string[]).includes(t.status) ||
    isLiveRun(runByTask.get(t.id))
  );
}

/** Whether a task still holds its issue's backlog slot: in flight (or revived live), or settled with its pull request still open (the driver's own rule, `taskHoldingTicket`) — a `failed`/`cancelled` task normally frees the issue to requeue, unless a by-hand run revived it. */
export function guardsIssue(
  t: LoopTaskRow,
  runByTask: ReadonlyMap<string, LoopRunRow>,
  openPrBranches: ReadonlySet<string>,
): boolean {
  if (["failed", "cancelled"].includes(t.status)) {
    return isLiveRun(runByTask.get(t.id));
  }

  return (
    !isSettledTask(t.status) ||
    (t.issue_number !== null &&
      openPrBranches.has(implementationLoopBranch(t.issue_number)))
  );
}

/** The newest run on the floor for a task is actually live right now — independent of what `pipeline.tasks.status` says, which a by-hand revival of a settled task never updates (ADR-049's start-by-hand posts a floor event only). */
function isLiveRun(run: LoopRunRow | undefined): boolean {
  return run?.status === "running" || run?.status === "queued";
}

export function taskTicket(
  row: LoopTaskRow,
  context: TaskTicketContext,
): Ticket | null {
  const { issue_number } = row;

  if (!issue_number) {
    return null;
  }
  const { openIssues, runByTask, nodeRows, openPrBranches } = context;
  const issue = openIssues.find((i) => i.number === issue_number);
  const run = runByTask.get(row.id);

  return {
    ...ticketIssueFields(row, issue_number, issue),
    ...ticketTaskFields(row),
    hold: pickedHold(row, issue, run, openPrBranches),
    run_id: run?.id ?? null,
    pipeline: pipelineOf(run, nodeRows),
  };
}

/** The hold on a ticket a task already picked: its last attempt, and whether its loop branch still has an open pull request. */
function pickedHold(
  row: LoopTaskRow,
  issue: IssueRef | undefined,
  run: LoopRunRow | undefined,
  openPrBranches: ReadonlySet<string>,
) {
  return ticketHold({
    issue,
    openBlockers: [],
    lastAttempt: attemptOf(row, run),
    picked: true,
    openPr: isAwaitingMerge(row, openPrBranches),
  });
}

/** How a task's attempt ended: the run's own reason where Postgres holds the run, otherwise what the settling hook stored on the task. */
function attemptOf(row: LoopTaskRow, run: LoopRunRow | undefined) {
  return { status: row.status, why: run?.reason ?? row.failure_reason };
}

/** What the queue and the parked list know about a ticket no task is working: its open blockers and its newest attempt, if it had one. */
export interface WaitingContext {
  openBlockers: ReadonlyMap<number, number[]>;
  taskRows: readonly LoopTaskRow[];
  runByTask: ReadonlyMap<string, LoopRunRow>;
  nodeRows: readonly NodeRow[];
}

/** A ticket read from its issue: `queued` when the picker will take it, `parked` when it will not. The pull request, run and Stages of its newest attempt ride along, since that is where its reader goes next. */
export function waitingTicket(
  issue: IssueRef,
  state: "queued" | "parked",
  context: WaitingContext,
): Ticket {
  const last = context.taskRows.find((t) => t.issue_number === issue.number);
  const run = last && context.runByTask.get(last.id);

  return {
    ...waitingIssueFields(issue),
    ...lastAttemptLinks(last, run),
    state,
    hold: ticketHold({
      issue,
      openBlockers: context.openBlockers.get(issue.number) ?? [],
      lastAttempt: last && attemptOf(last, run),
    }),
    pipeline: pipelineOf(run, context.nodeRows),
  };
}

function lastAttemptLinks(
  last: LoopTaskRow | undefined,
  run: LoopRunRow | undefined,
) {
  return { pr_url: last?.pr_url ?? null, run_id: run?.id ?? null };
}

function waitingIssueFields(issue: IssueRef) {
  return {
    issue_number: issue.number,
    issue_url: issue.url ?? null,
    title: issue.title,
    priority: priorityOf(issue),
    created_at: issue.createdAt
      ? new Date(issue.createdAt).toISOString()
      : null,
  };
}

function ticketIssueFields(
  row: LoopTaskRow,
  issueNumber: number,
  issue: IssueRef | undefined,
) {
  return {
    issue_number: issueNumber,
    issue_url: row.issue_url,
    title: ticketTitle(issue, row),
    priority: priorityOf(issue),
  };
}

function ticketTitle(issue: IssueRef | undefined, row: LoopTaskRow): string {
  return issue?.title ?? row.description.split("\n")[0]; // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
}

function ticketTaskFields(row: LoopTaskRow) {
  return {
    pr_url: row.pr_url,
    state: row.status,
    created_at: new Date(row.created_at).toISOString(),
  };
}

// The mini graph: every graph node in definition order, colored by its latest station-run outcome.
export function pipelineOf(
  run: LoopRunRow | undefined,
  nodeRows: readonly NodeRow[],
): PipelineNode[] | null {
  if (!run?.graph?.nodes) {
    return null;
  }
  const visits = nodeRows
    .filter((row) => row.assembly_run_id === run.id)
    .map(({ node_id, iteration, outcome }) => ({
      nodeId: node_id,
      iteration,
      outcome,
    }));

  return miniPipeline(run.graph.nodes, visits);
}
