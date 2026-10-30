import { Box, Text, useApp, useInput } from "ink";
import React, { useEffect, useReducer } from "react";
import type { RowStatus, Tone } from "./health.ts";
import {
  type DashboardAction,
  type DashboardState,
  initialState,
  reduce,
} from "./reducer.ts";
import type { ServiceSpec } from "./services.ts";

export interface DashboardController {
  attach: (dispatch: (action: DashboardAction) => void) => void;
  restart: (name: string) => void;
  quit: () => Promise<void>;
}

export interface DashboardProps {
  specs: ServiceSpec[];
  headerLines: string[];
  controller: DashboardController;
}

const TONE_COLOR: Record<Tone, string> = {
  ok: "green",
  wait: "yellow",
  bad: "red",
  dim: "gray",
};
const NAME_WIDTH = 15;
const WHERE_WIDTH = 30;
const STATUS_WIDTH = 18;
const CHROME_LINES = 4;
const MIN_LOG_LINES = 5;

function StatusCell({ status }: { status: RowStatus }) {
  const glyph = status.tone === "ok" || status.tone === "bad" ? "●" : "○";

  return (
    <Text color={TONE_COLOR[status.tone]}>
      {`${glyph} ${status.text}`.padEnd(STATUS_WIDTH)}
    </Text>
  );
}

function ServiceTable({ state }: { state: DashboardState }) {
  return (
    <Box flexDirection="column">
      <Text bold>
        {"  "}
        {"SERVICE".padEnd(NAME_WIDTH)}
        {"WHERE".padEnd(WHERE_WIDTH)}
        {"STATUS".padEnd(STATUS_WIDTH)}ROLE
      </Text>
      {state.rows.map((row, index) => (
        <Box key={row.name}>
          <Text inverse={index === state.selected} wrap="truncate">
            {index === state.selected ? "> " : "  "}
          </Text>
          <Text color={row.color} wrap="truncate">
            {row.name.padEnd(NAME_WIDTH)}
          </Text>
          <Text wrap="truncate">{row.where.padEnd(WHERE_WIDTH)}</Text>
          <StatusCell status={row.status} />
          <Box flexShrink={1} flexGrow={1}>
            <Text dimColor wrap="truncate">
              {row.role}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function selectedRow(state: DashboardState) {
  return state.rows[state.selected];
}

function LogPane({ state, height }: { state: DashboardState; height: number }) {
  const selected = selectedRow(state);
  const colorByService = new Map(
    state.rows.map((row) => [row.name, row.color]),
  );
  const colorOf = (service: string) => colorByService.get(service);
  const visible =
    state.logMode === "all"
      ? state.allLines.slice(-height)
      : (state.linesByService[selected.name] ?? [])
          .slice(-height)
          .map((text) => ({ service: selected.name, text }));
  const title = state.logMode === "all" ? "all" : selected.name;

  return (
    <Box flexDirection="column">
      <Text dimColor>{`── logs: ${title} ──`}</Text>
      {visible.map((line, index) => (
        <Text key={index} wrap="truncate">
          {state.logMode === "all" ? (
            <Text color={colorOf(line.service)}>{`[${line.service}] `}</Text>
          ) : null}
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

export function Dashboard({ specs, headerLines, controller }: DashboardProps) {
  const [state, dispatch] = useReducer(reduce, specs, initialState);
  const { exit } = useApp();

  useEffect(() => {
    controller.attach(dispatch);
  }, [controller]);

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      dispatch({ type: "select", delta: -1 });
    }

    if (key.downArrow || input === "j") {
      dispatch({ type: "select", delta: 1 });
    }

    if (key.return || input === "l") {
      dispatch({ type: "showSelected" });
    }

    if (input === "a") {
      dispatch({ type: "toggleAll" });
    }

    if (input === "r") {
      controller.restart(selectedRow(state).name);
    }

    if (input === "q") {
      void controller.quit().then(() => exit());
    }
  });

  const usedLines = headerLines.length + state.rows.length + CHROME_LINES;
  const logHeight = Math.max(
    MIN_LOG_LINES,
    (process.stdout.rows || 24) - usedLines,
  );

  return (
    <Box flexDirection="column">
      {headerLines.map((line) => (
        <Text key={line}>{line}</Text>
      ))}
      <Text> </Text>
      <ServiceTable state={state} />
      <Text> </Text>
      <Text dimColor>
        ↑/↓ select · enter/l logs of selected · a all logs · r restart · q quit
      </Text>
      <LogPane state={state} height={logHeight} />
    </Box>
  );
}
