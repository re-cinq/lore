"use client";

// Both readers fold rows through the SAME reducer the live stream feeds, so a run looks identical however its events arrived.
import { useCallback, useEffect, useState } from "react";
import type { RunStreamEvent, RunStreamFrame } from "@/lib/run-stream-types";

type HistoryDispatch = (event: RunStreamEvent) => void;
import {
  nextPageCursor,
  resolveChipState,
  resolveStreamMode,
  type ChipState,
  type ConnectionState,
} from "@/lib/run-stream-presenter";
import { useRunEventStream } from "./useRunEventStream";
import {
  dispatchParsedRows,
  fetchPage,
  useHistoryPoll,
} from "./use-history-poll";

export { useHistoryPoll };

export interface RunHistory {
  /** Ordered persisted events, as folded. */
  historyEvents: RunStreamEvent[];
  /** The run whose history finished loading — compared to runId (not a boolean) so a stale "loaded" gate is impossible by construction. */
  historyLoadedFor: string | null;
  streamUnavailable: boolean;
  connection: ConnectionState;
  setConnection: (next: ConnectionState) => void;
  setStreamUnavailable: (next: boolean) => void;
}

export interface RunStreamWiring {
  historyEvents: RunStreamEvent[];
  /** What the connection chip should read right now. */
  chipState: ChipState;
}

interface TransportTarget {
  runId: string;
  lastEventId: string;
  dispatch: RunStreamInput["dispatch"];
  onFrame: RunStreamInput["onFrame"];
}

/** How events reach the panel: the one-off history fold, then either the live SSE stream or — when a browser or a server cannot hold one open — a poll from the reducer's own cursor. The caller never learns which; both dispatch the same events. */
export interface RunStreamInput {
  runId: string;
  runStatus: string;
  runIsLive: boolean;
  lastEventId: string;
  dispatch: (event: RunStreamEvent) => void;
  /** Receives every non-agent frame (node status, run status, task events, CI); absent when the caller only folds agent events. */
  onFrame?: (frame: RunStreamFrame) => void;
}

export function useRunStream(input: RunStreamInput): RunStreamWiring {
  const { runId, runStatus, runIsLive, lastEventId, dispatch, onFrame } = input;
  const history = useRunHistory(runId, dispatch);
  const mode = resolveStreamMode({
    runStatus,
    eventSourceAvailable: typeof EventSource !== "undefined",
    streamUnavailable: history.streamUnavailable,
  });
  // Both transports wait for the history fold to finish: dispatching a live event before the run's past is in would fold it into a timeline missing everything before it.
  const historyReady = history.historyLoadedFor === runId;
  const fallbackPollActive =
    runIsLive && mode === "history-only" && historyReady;

  useTransports(
    { runId, lastEventId, dispatch, onFrame },
    { live: mode === "live" && historyReady, poll: fallbackPollActive },
    history,
  );

  return runStreamWiring(history, { mode, fallbackPollActive });
}

export function useRunHistory(runId: string, dispatch: HistoryDispatch) {
  const [historyEvents, setHistoryEvents] = useState<RunStreamEvent[]>([]);
  const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);
  const [streamUnavailable, setStreamUnavailable] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useHistoryFold(runId, dispatch, {
    setHistoryEvents,
    setHistoryLoadedFor,
    setConnection,
    setStreamUnavailable,
  });

  return {
    historyEvents,
    historyLoadedFor,
    streamUnavailable,
    connection,
    setConnection,
    setStreamUnavailable,
  };
}

/** Arms both transports; each is inert unless its own flag says otherwise. Both are always CALLED — hooks cannot be conditional — so the choice is expressed as an `enabled` flag rather than as a branch. */
function useTransports(
  target: TransportTarget,
  enabled: { live: boolean; poll: boolean },
  history: RunHistory,
): void {
  const { runId, lastEventId, dispatch, onFrame } = target;

  useRunEventStream({
    runId,
    afterId: lastEventId,
    enabled: enabled.live,
    onFrame: useFrameRouter(dispatch, onFrame),
    onConnectionChange: useStreamHandoff(
      history.setConnection,
      history.setStreamUnavailable,
    ),
  });
  useHistoryPoll({ active: enabled.poll, runId, lastEventId, dispatch });
}

/** What the panel reads: the persisted events, and the chip that says how they are arriving. */
function runStreamWiring(
  history: RunHistory,
  chip: {
    mode: ReturnType<typeof resolveStreamMode>;
    fallbackPollActive: boolean;
  },
): RunStreamWiring {
  return {
    historyEvents: history.historyEvents,
    chipState: resolveChipState({ ...chip, connection: history.connection }),
  };
}

interface HistoryLoad {
  runId: string;
  dispatch: (event: RunStreamEvent) => void;
  cancelled: () => boolean;
}

interface HistorySetters {
  setHistoryEvents: (events: RunStreamEvent[]) => void;
  setHistoryLoadedFor: (runId: string) => void;
  setConnection: (state: ConnectionState) => void;
  setStreamUnavailable: (unavailable: boolean) => void;
}

/** Runs once per run; a rejection degrades to the seeded graph plus an Offline chip rather than an unhandled rejection or a blank page. */
function useHistoryFold(
  runId: string,
  dispatch: HistoryDispatch,
  set: HistorySetters,
): void {
  useEffect(() => {
    let cancelled = false;

    void foldHistory({ runId, dispatch, cancelled: () => cancelled }, set);

    return () => {
      cancelled = true;
    };
    // `set` is rebuilt each render but holds only useState setters, which React guarantees stable — including it would re-fold the history on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, dispatch]);
}

/** Reports connection changes, and hands off to the poll when the stream gives up for good. "offline" is not a transient state — the stream hook only reports it after STREAM_MAX_ATTEMPTS — so it flips the mode to history-only, which disables the stream and starts the fallback poll. */
function useStreamHandoff(
  setConnection: (next: ConnectionState) => void,
  setStreamUnavailable: (unavailable: boolean) => void,
): (next: ConnectionState) => void {
  return useCallback(
    (next: ConnectionState) => {
      setConnection(next);

      if (next === "offline") {
        setStreamUnavailable(true);
      }
    },
    [setConnection, setStreamUnavailable],
  );
}

/** Splits the one stream by family: agent events fold into the event reducer, everything else is the page's state to apply. */
function useFrameRouter(
  dispatch: RunStreamInput["dispatch"],
  onFrame: RunStreamInput["onFrame"],
): (frame: RunStreamFrame) => void {
  return useCallback(
    (frame: RunStreamFrame) => {
      if (frame.type === "agent_event") {
        dispatch(frame.event);

        return;
      }
      onFrame?.(frame);
    },
    [dispatch, onFrame],
  );
}

/** Folds the run's persisted history in, page by page. */
async function foldHistory(load: HistoryLoad, set: HistorySetters) {
  const { runId, cancelled } = load;

  try {
    const { ok, collected } = await loadAllPages(load);

    if (cancelled()) {
      return;
    }

    if (!ok) {
      reportHistoryUnavailable(set);

      return;
    }
    set.setHistoryEvents(collected);
    set.setHistoryLoadedFor(runId);
  } catch {
    if (!cancelled()) {
      set.setConnection("offline");
    }
  }
}

/** Reads every page of the run's history, dispatching each row as it arrives so the reducer folds them in order. `cancelled` is checked between pages: a run change must not let the previous run's later pages land in the new run's state. */
async function loadAllPages(load: HistoryLoad) {
  const { runId, dispatch, cancelled } = load;
  let cursor = "0";
  const collected: RunStreamEvent[] = [];

  for (;;) {
    const page = await fetchPage(runId, cursor);

    if (cancelled()) {
      return { ok: true, collected };
    }

    if (!page.ok) {
      return { ok: false, collected };
    }
    const next = foldPage(page, dispatch, collected);

    if (next === null) {
      return { ok: true, collected };
    }
    cursor = next;
  }
}

/** A partial read is reported as offline rather than shown: half a run's events look like a run that did less than it did, which is worse than saying the history could not be loaded. */
function reportHistoryUnavailable(set: HistorySetters): void {
  set.setStreamUnavailable(true);
  set.setConnection("offline");
}

/** Folds one page into the collection and reports the cursor the next page starts from, or null when this was the last one. */
function foldPage(
  page: { rows: unknown[] },
  dispatch: (event: RunStreamEvent) => void,
  collected: RunStreamEvent[],
): string | null {
  collected.push(...dispatchParsedRows(page.rows, dispatch));

  return nextPageCursor(identifiedRows(page.rows));
}

/** Rows that carry a string id — the only ones that can advance the page cursor. */
function identifiedRows(rows: unknown[]): { id: string }[] {
  return rows.filter(
    (row): row is { id: string } =>
      typeof (row as { id?: unknown } | null)?.id === "string",
  );
}
