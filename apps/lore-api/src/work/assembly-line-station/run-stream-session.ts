// The reads that turn one run's rows into frames (specs/assembly-line-run-viz FR7): every state family as a snapshot, the agent-event replay from a cursor, and the one-row re-reads a live notification asks for. Who receives them, and when, is run-feed.ts's business.

import type { AgentRunEventsRepository } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-port.js";
import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { TaskEventsRepository } from "@re-cinq/lore-shared/project/task-events/task-events-port.js";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import {
  agentEventFrame,
  catchupFrame,
  ciCheckFrame,
  nodeStatusFrame,
  runStatusFrame,
  taskEventFrame,
  type RunStreamFrame,
} from "./run-stream-frame.js";
import type { NotifyFilter } from "./run-notify-hub.js";

const PAGE_SIZE = 1000;

export type PrStatusReader = (
  repo: string,
  prNumber: number,
) => Promise<Record<string, unknown> | null>;

export interface RunReadDeps {
  events: Pick<AgentRunEventsRepository, "listSince">;
  runs: Pick<AssemblyRunsPort, "getById" | "listStationRuns">;
  taskEvents: TaskEventsRepository;
  prStatus: PrStatusReader;
  now?: () => Date;
  pageSize?: number;
}

/** One viewer as the catch-up sees it: where its frames go, how far its replay got, and whether it is still there. */
export interface Subscriber {
  emit(frame: RunStreamFrame): void;
  cursor(): string;
  closed(): boolean;
}

/** The PR a run's args name, if any: the identity its CI checks arrive under. */
export function prNumberOf(run: AssemblyRunRecord): number | null {
  const raw = run.args.pr_number;

  return typeof raw === "number" ? raw : null;
}

export function notifyFilterFor(run: AssemblyRunRecord): NotifyFilter {
  return {
    runId: run.id,
    taskId: run.taskId,
    repo: run.repo,
    prNumber: prNumberOf(run),
  };
}

export async function readRunStatus(
  deps: RunReadDeps,
  run: AssemblyRunRecord,
): Promise<RunStreamFrame | null> {
  const fresh = await deps.runs.getById(run.id);

  return fresh ? runStatusFrame(fresh) : null;
}

/** The visit a notification names, or null while the row is not there yet. */
export async function readNode(
  deps: RunReadDeps,
  run: AssemblyRunRecord,
  rowId: string | undefined,
): Promise<RunStreamFrame | null> {
  const rows = await deps.runs.listStationRuns(run.id);
  const row = rows.find((candidate) => candidate.id === rowId);

  return row ? nodeStatusFrame(row) : null;
}

export async function readTaskEvent(
  deps: RunReadDeps,
  run: AssemblyRunRecord,
  id: string | undefined,
): Promise<RunStreamFrame | null> {
  if (run.taskId === null) {
    return null;
  }
  const events = await deps.taskEvents.listForTask(run.taskId);
  const event = events.find((candidate) => candidate.id === id);

  return event ? taskEventFrame(event) : null;
}

export async function readCiCheck(
  deps: RunReadDeps,
  run: AssemblyRunRecord,
): Promise<RunStreamFrame | null> {
  const prNumber = prNumberOf(run);

  if (prNumber === null) {
    return null;
  }
  const status = await deps.prStatus(run.repo, prNumber);
  const now = deps.now ?? (() => new Date());

  return status ? ciCheckFrame(run.repo, prNumber, status, now()) : null;
}

/** Every state family as of now: the run, each visit, each task transition, the PR's checks. */
export async function snapshotFrames(
  deps: RunReadDeps,
  run: AssemblyRunRecord,
): Promise<RunStreamFrame[]> {
  const status = await readRunStatus(deps, run);
  const visits = await deps.runs.listStationRuns(run.id);
  const taskEvents =
    run.taskId === null ? [] : await deps.taskEvents.listForTask(run.taskId);
  const ci = await readCiCheck(deps, run);

  return [
    ...(status ? [status] : []),
    ...visits.map(nodeStatusFrame),
    ...taskEvents.map(taskEventFrame),
    ...(ci ? [ci] : []),
  ];
}

/** Pages agent events forward from the subscriber's cursor until a short page ends the history; stops early when the subscriber is gone. */
export async function replayAgentEvents(
  deps: RunReadDeps,
  run: AssemblyRunRecord,
  subscriber: Subscriber,
): Promise<void> {
  const pageSize = deps.pageSize ?? PAGE_SIZE;
  let drained = false;

  while (!drained && !subscriber.closed()) {
    const page = await deps.events.listSince(
      run.id,
      subscriber.cursor(),
      pageSize,
    );

    drained = page.length < pageSize;

    if (!subscriber.closed()) {
      emitPage(subscriber, page);
    }
  }
}

function emitPage(
  subscriber: Subscriber,
  page: readonly AgentRunEvent[],
): void {
  for (const row of page) {
    subscriber.emit(agentEventFrame(row));
  }
}

/** One viewer's catch-up (FR2.3/FR7.2): the snapshot, then the replay from ITS cursor, then catchup_complete. */
export async function catchUp(
  deps: RunReadDeps,
  run: AssemblyRunRecord,
  subscriber: Subscriber,
): Promise<void> {
  const snapshot = await snapshotFrames(deps, run);

  if (subscriber.closed()) {
    return;
  }

  for (const frame of snapshot) {
    subscriber.emit(frame);
  }
  await replayAgentEvents(deps, run, subscriber);

  if (!subscriber.closed()) {
    subscriber.emit(catchupFrame(subscriber.cursor()));
  }
}
