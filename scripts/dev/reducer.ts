import type { RowStatus } from "./health.ts";
import type { ServiceSpec } from "./services.ts";

export interface Row {
  name: string;
  role: string;
  where: string;
  color: string;
  status: RowStatus;
}

export interface LogLine {
  service: string;
  text: string;
}

export interface DashboardState {
  rows: Row[];
  selected: number;
  logMode: "selected" | "all";
  linesByService: Record<string, string[]>;
  allLines: LogLine[];
}

export type DashboardAction =
  | { type: "select"; delta: 1 | -1 }
  | { type: "toggleAll" }
  | { type: "showSelected" }
  | { type: "status"; name: string; status: RowStatus }
  | { type: "line"; service: string; text: string }
  | { type: "exit"; service: string; code: number | null };

export const LOG_BUFFER_LINES = 500;

function initialStatus(spec: ServiceSpec): RowStatus {
  if (spec.kind === "note") {
    return { text: "absent", tone: "dim" };
  }

  if (spec.kind === "status") {
    return { text: "checking", tone: "wait" };
  }

  return { text: "starting", tone: "wait" };
}

export function initialState(specs: ServiceSpec[]): DashboardState {
  return {
    rows: specs.map((spec) => ({
      name: spec.name,
      role: spec.role,
      where: spec.where,
      color: spec.color,
      status: initialStatus(spec),
    })),
    selected: 0,
    logMode: "selected",
    linesByService: {},
    allLines: [],
  };
}

function hasRow(state: DashboardState, name: string): boolean {
  return state.rows.some((row) => row.name === name);
}

function withStatus(
  state: DashboardState,
  name: string,
  status: RowStatus,
): DashboardState {
  return {
    ...state,
    rows: state.rows.map((row) =>
      row.name === name ? { ...row, status } : row,
    ),
  };
}

function exitStatus(code: number | null): RowStatus {
  return code === null
    ? { text: "stopped", tone: "dim" }
    : { text: `crashed (${code})`, tone: "bad" };
}

export function reduce(
  state: DashboardState,
  action: DashboardAction,
): DashboardState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selected:
          (state.selected + action.delta + state.rows.length) %
          state.rows.length,
      };
    case "toggleAll":
      return {
        ...state,
        logMode: state.logMode === "all" ? "selected" : "all",
      };
    case "showSelected":
      return { ...state, logMode: "selected" };
    case "status":
      return hasRow(state, action.name)
        ? withStatus(state, action.name, action.status)
        : state;
    case "line":
      if (!hasRow(state, action.service)) {
        return state;
      }

      return {
        ...state,
        linesByService: {
          ...state.linesByService,
          [action.service]: [
            ...(state.linesByService[action.service] ?? []),
            action.text,
          ].slice(-LOG_BUFFER_LINES),
        },
        allLines: [
          ...state.allLines,
          { service: action.service, text: action.text },
        ].slice(-LOG_BUFFER_LINES),
      };
    case "exit":
      return hasRow(state, action.service)
        ? withStatus(state, action.service, exitStatus(action.code))
        : state;
  }
}
