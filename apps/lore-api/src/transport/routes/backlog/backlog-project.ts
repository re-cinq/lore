import { heldBacklog, orderBacklog } from "@re-cinq/lore-shared";
import type { Ticket } from "./backlog-schema.js";
import {
  guardsIssue,
  isAwaitingMerge,
  isCurrentTask,
  taskTicket,
  waitingTicket,
  type LoopTaskRow,
} from "./backlog-ticket.js";
import type { BacklogState } from "./backlog.js";
import { capSections, type SectionLimits } from "../loops/loop-sections.js";

export interface BacklogBuckets {
  current: Ticket[];
  next: Ticket[];
  parked: Ticket[];
  recent: Ticket[];
  awaiting_merge: Ticket[];
}

export function projectBacklog(state: BacklogState): BacklogBuckets {
  const currentRows = currentTaskRows(state);
  const currentIds = new Set(currentRows.map((t) => t.id));
  const parkedIssues = heldBacklog(state.openIssues);
  const parkedIssueNumbers = new Set(parkedIssues.map((issue) => issue.number));

  return {
    current: currentRows
      .map((t) => taskTicket(t, state))
      .filter((t): t is Ticket => t !== null),
    next: nextTickets(state),
    parked: parkedIssues.map((issue) => waitingTicket(issue, "parked", state)),
    recent: recentTickets(state, currentIds, parkedIssueNumbers),
    awaiting_merge: awaitingMergeTickets(state, currentIds),
  };
}

function currentTaskRows(state: BacklogState): LoopTaskRow[] {
  return state.taskRows.filter((t) => isCurrentTask(t, state.runByTask));
}

function awaitingMergeTickets(
  state: BacklogState,
  currentIds: ReadonlySet<string>,
): Ticket[] {
  return settledTaskRows(state, currentIds)
    .filter((t) => isAwaitingMerge(t, state.openPrBranches))
    .map((t) => taskTicket(t, state))
    .filter((t): t is Ticket => t !== null);
}

function nextTickets(state: BacklogState): Ticket[] {
  const { taskRows, openIssues, runByTask, openPrBranches } = state;
  const guardedIssues = new Set(
    taskRows
      .filter((t) => guardsIssue(t, runByTask, openPrBranches))
      .map((t) => t.issue_number),
  );

  return orderBacklog(openIssues, { criteria: state.criteria })
    .filter((i) => !guardedIssues.has(i.number))
    .map((issue) => waitingTicket(issue, "queued", state));
}

function recentTickets(
  state: BacklogState,
  currentIds: ReadonlySet<string>,
  parkedIssueNumbers: ReadonlySet<number>,
): Ticket[] {
  return settledTaskRows(state, currentIds)
    .filter((t) => !isAwaitingMerge(t, state.openPrBranches))
    .filter((t) => !parkedIssueNumbers.has(t.issue_number ?? -1))
    .slice(0, state.recentLimit)
    .map((t) => taskTicket(t, state))
    .filter((t): t is Ticket => t !== null);
}

function settledTaskRows(
  state: BacklogState,
  currentIds: ReadonlySet<string>,
): LoopTaskRow[] {
  return state.taskRows.filter((t) => !currentIds.has(t.id));
}

export function cappedBacklog(
  buckets: BacklogBuckets,
  limits: SectionLimits,
): BacklogBuckets {
  const { next, ...rest } = buckets;
  const { backlog, ...capped } = capSections(
    { ...rest, backlog: next },
    limits,
  );

  return { ...capped, next: backlog };
}
