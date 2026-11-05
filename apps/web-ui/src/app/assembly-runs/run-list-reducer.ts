// The run list's page-level fold: the loaded page of runs, its cursor, and the live socket's connection state.

import type { AssemblyRun } from "@/lib/assembly-run-rows";
import type { ChannelState } from "@/lib/live-socket/connection-machine";

export interface RunListPage {
  runs: AssemblyRun[];
  nextCursor: string | null;
}

export interface RunListState extends RunListPage {
  connection: ChannelState;
}

export type RunListAction =
  | ({ type: "page_loaded" } & RunListPage)
  | { type: "run_row"; run: AssemblyRun }
  | { type: "connection"; state: ChannelState };

export function initialRunList(page: RunListPage): RunListState {
  return { ...page, connection: "connecting" };
}

type Handlers = {
  [Type in RunListAction["type"]]: (
    state: RunListState,
    action: Extract<RunListAction, { type: Type }>,
  ) => RunListState;
};

/** A run's cost only goes from unknown to known, so a row that comes without one for a run that showed one is a cost read that failed: the row keeps the cost it had. */
function keepingKnownCost(run: AssemblyRun, before: AssemblyRun | undefined) {
  return run.costUsd === null && before?.costUsd != null
    ? { ...run, costUsd: before.costUsd }
    : run;
}

const handlers: Handlers = {
  page_loaded: (state, { runs, nextCursor }) => {
    const before = new Map(state.runs.map((row) => [row.id, row]));

    return {
      ...state,
      runs: runs.map((run) => keepingKnownCost(run, before.get(run.id))),
      nextCursor,
    };
  },
  run_row: (state, { run }) => ({
    ...state,
    runs: state.runs.map((row) =>
      row.id === run.id ? keepingKnownCost(run, row) : row,
    ),
  }),
  connection: (state, { state: connection }) => ({ ...state, connection }),
};

export function reduceRunList(
  state: RunListState,
  action: RunListAction,
): RunListState {
  const handle = handlers[action.type] as (
    state: RunListState,
    action: RunListAction,
  ) => RunListState;

  return handle(state, action);
}
