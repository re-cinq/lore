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

const handlers: Handlers = {
  page_loaded: (state, { runs, nextCursor }) => ({
    ...state,
    runs,
    nextCursor,
  }),
  run_row: (state, { run }) => ({
    ...state,
    runs: state.runs.map((row) => (row.id === run.id ? run : row)),
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
