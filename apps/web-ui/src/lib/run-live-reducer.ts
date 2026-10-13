// The page-level fold for the stream's STATE families (run-viz FR7.2): the run's own facts, its visit rows, its task events and its CI check. Seeded from the server render, then replaced or upserted by frames — every apply is idempotent, so a reconnect's snapshot is a no-op for state already seen.

import {
  durationSeconds,
  type AssemblyRun,
  type AssemblyRunNode,
} from "./assembly-run-rows";
import {
  ifFrame,
  nodeStatusBranch,
  runStatusFacts,
  upsertBy,
} from "./run-stream-fold";
import type { CiCheckFrame, RunStreamFrame } from "./run-stream-types";
import type { TaskRuntimeEvent } from "./task-runtime";

export interface RunLiveFacts {
  status: string;
  outcome: string | null;
  reason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export type CiCheck = CiCheckFrame["check"];

export interface RunLiveState {
  run: RunLiveFacts;
  /** Visit rows in visit order; a re-sent row replaces its `(nodeId, iteration)` predecessor in place. */
  nodes: AssemblyRunNode[];
  taskEvents: TaskRuntimeEvent[];
  ciCheck: CiCheck | null;
}

export function initialRunLive(
  run: AssemblyRun,
  nodes: readonly AssemblyRunNode[],
  taskEvents: readonly TaskRuntimeEvent[],
): RunLiveState {
  return {
    run: {
      status: run.status,
      outcome: run.outcome,
      reason: run.reason,
      startedAt: run.startedAt,
      finishedAt: finishedAtOf(run),
    },
    nodes: [...nodes],
    taskEvents: [...taskEvents],
    ciCheck: null,
  };
}

/** The server row carries a duration, not an end; the end is what the stream sends, so it is reconstructed once here. */
function finishedAtOf(run: AssemblyRun): string | null {
  if (run.startedAt === null || run.durationSeconds === null) {
    return null;
  }

  return new Date(
    new Date(run.startedAt).getTime() + run.durationSeconds * 1000,
  ).toISOString();
}

/** The server-rendered run with the live facts laid over it, for the header and the option buttons that read a whole `AssemblyRun`. */
export function withLiveFacts(
  run: AssemblyRun,
  live: RunLiveFacts,
): AssemblyRun {
  return {
    ...run,
    status: live.status,
    outcome: live.outcome,
    reason: live.reason,
    startedAt: live.startedAt,
    durationSeconds: durationSeconds(live.startedAt, live.finishedAt),
  };
}

const APPLY: Record<
  RunStreamFrame["type"],
  (state: RunLiveState, frame: RunStreamFrame) => RunLiveState
> = {
  agent_event: (state) => state,
  catchup_complete: (state) => state,
  node_status: nodeStatusBranch(),
  run_status: ifFrame("run_status", (state, frame) => ({
    ...state,
    run: {
      ...runStatusFacts(frame),
      startedAt: frame.run.started_at,
      finishedAt: frame.run.finished_at,
    },
  })),
  task_event: ifFrame("task_event", (state, frame) => ({
    ...state,
    taskEvents: upsertBy(
      state.taskEvents,
      frame.event,
      (row) => row.id === frame.event.id,
    ),
  })),
  ci_check: ifFrame("ci_check", (state, frame) => ({
    ...state,
    ciCheck: frame.check,
  })),
};

/** Applies one frame. Agent events belong to the event reducer and pass through untouched (same object identity), so a caller can route by identity as well as by type. */
export function reduceRunLive(
  state: RunLiveState,
  frame: RunStreamFrame,
): RunLiveState {
  return APPLY[frame.type](state, frame);
}
