"use client";

// Both readers fold rows through the SAME reducer the live stream feeds, so a run looks identical however its events arrived.
import { useCallback, useEffect, useRef, useState } from "react";
import { parseRunStreamRow, type RunStreamEvent } from "@/lib/run-stream-types";
import {
  HISTORY_POLL_MS,
  historyUrl,
  nextPageCursor,
  resolveChipState,
  resolveStreamMode,
  type ChipState,
  type ConnectionState,
} from "@/lib/run-stream-presenter";
import { useRunEventStream } from "./useRunEventStream";

interface HistoryPage {
  events?: unknown[];
}

const HISTORY_TIMEOUT_MS = 15_000;

type HistoryDispatch = (event: RunStreamEvent) => void;

async function fetchPage(
  runId: string,
  cursor: string,
): Promise<{ ok: boolean; rows: unknown[] }> {
  const res = await fetch(historyUrl(runId, cursor), {
    signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS),
  });

  if (!res.ok) {
    return { ok: false, rows: [] };
  }
  const body = (await res.json()) as HistoryPage;

  return { ok: true, rows: Array.isArray(body.events) ? body.events : [] };
}

/** Rows that carry a string id — the only ones that can advance the page cursor. */
function identifiedRows(rows: unknown[]): { id: string }[] {
  return rows.filter(
    (row): row is { id: string } =>
      typeof (row as { id?: unknown } | null)?.id === "string",
  );
}

/** Parses each row and dispatches the ones that classify, returning them in order. */
function dispatchParsedRows(
  rows: unknown[],
  dispatch: (event: RunStreamEvent) => void,
): RunStreamEvent[] {
  const parsedRows: RunStreamEvent[] = [];

  for (const row of rows) {
    const parsed = parseRunStreamRow(row);

    if (parsed !== null) {
      dispatch(parsed);
      parsedRows.push(parsed);
    }
  }

  return parsedRows;
}

export interface RunHistory {
  /** Ordered persisted events, retained only to drive the replay scrubber on a terminal run; a live run never scrubs. */
  historyEvents: RunStreamEvent[];
  /** The run whose history finished loading — compared to runId (not a boolean) so a stale "loaded" gate is impossible by construction. */
  historyLoadedFor: string | null;
  streamUnavailable: boolean;
  connection: ConnectionState;
  setConnection: (next: ConnectionState) => void;
  setStreamUnavailable: (next: boolean) => void;
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

/** Folds one page into the collection and reports the cursor the next page starts from, or null when this was the last one. */
function foldPage(
  page: { rows: unknown[] },
  dispatch: (event: RunStreamEvent) => void,
  collected: RunStreamEvent[],
): string | null {
  collected.push(...dispatchParsedRows(page.rows, dispatch));

  return nextPageCursor(identifiedRows(page.rows));
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

interface PollTarget {
  runId: string;
  lastEventIdRef: { current: string };
  dispatch: (event: RunStreamEvent) => void;
}

/** One poll tick. Skipped while a previous request is still out, so a slow backend cannot stack requests faster than it answers them; a failed tick is swallowed because the next one retries and the chip already reads "Polling". */
async function pollOnce(
  state: { inFlight: boolean },
  cancelled: () => boolean,
  { runId, lastEventIdRef, dispatch }: PollTarget,
): Promise<void> {
  if (state.inFlight) {
    return;
  }

  state.inFlight = true;

  try {
    const page = await fetchPage(runId, lastEventIdRef.current);

    if (cancelled() || !page.ok) {
      return;
    }
    dispatchParsedRows(page.rows, dispatch);
  } catch {
    // The next tick retries; the chip already reads Polling.
  } finally {
    state.inFlight = false;
  }
}

/** Starts the poll interval and returns its disposer. The `cancelled` flag is separate from `clearInterval`: a request already in flight when the effect tears down still resolves, and dispatching its rows into an unmounted reducer is the classic late-write bug. */
function startPolling(target: PollTarget): () => void {
  let cancelled = false;
  const state = { inFlight: false };
  const id = setInterval(
    () => void pollOnce(state, () => cancelled, target),
    HISTORY_POLL_MS,
  );

  return () => {
    cancelled = true;
    clearInterval(id);
  };
}

/** Degraded path for a live run without a stream: polls from the reducer's cursor, kept in a ref so a poll result never restarts the interval. */
export function useHistoryPoll(
  active: boolean,
  runId: string,
  lastEventId: string,
  dispatch: (event: RunStreamEvent) => void,
): void {
  const lastEventIdRef = useRef(lastEventId);

  useEffect(() => {
    lastEventIdRef.current = lastEventId;
  }, [lastEventId]);

  useEffect(() => {
    if (!active) {
      return;
    }

    return startPolling({ runId, lastEventIdRef, dispatch });
  }, [active, runId, dispatch]);
}

export interface RunStreamWiring {
  /** Ordered persisted events; the replay scrubber's source on a terminal run. */
  historyEvents: RunStreamEvent[];
  /** What the connection chip should read right now. */
  chipState: ChipState;
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

interface TransportTarget {
  runId: string;
  lastEventId: string;
  dispatch: RunStreamInput["dispatch"];
}

/** Arms both transports; each is inert unless its own flag says otherwise. Both are always CALLED — hooks cannot be conditional — so the choice is expressed as an `enabled` flag rather than as a branch. */
function useTransports(
  target: TransportTarget,
  enabled: { live: boolean; poll: boolean },
  history: RunHistory,
): void {
  const { runId, lastEventId, dispatch } = target;

  useRunEventStream({
    runId,
    afterId: lastEventId,
    enabled: enabled.live,
    onEvent: dispatch,
    onConnectionChange: useStreamHandoff(
      history.setConnection,
      history.setStreamUnavailable,
    ),
  });
  useHistoryPoll(enabled.poll, runId, lastEventId, dispatch);
}

/** How events reach the panel: the one-off history fold, then either the live SSE stream or — when a browser or a server cannot hold one open — a poll from the reducer's own cursor. The caller never learns which; both dispatch the same events. */
export interface RunStreamInput {
  runId: string;
  runStatus: string;
  runIsLive: boolean;
  lastEventId: string;
  dispatch: (event: RunStreamEvent) => void;
}

/** What the panel reads: the persisted events, and the chip that says how they are arriving. */
function runStreamWiring(
  history: RunHistory,
  mode: ReturnType<typeof resolveStreamMode>,
  fallbackPollActive: boolean,
): RunStreamWiring {
  return {
    historyEvents: history.historyEvents,
    chipState: resolveChipState({
      mode,
      connection: history.connection,
      fallbackPollActive,
    }),
  };
}

export function useRunStream(input: RunStreamInput): RunStreamWiring {
  const { runId, runStatus, runIsLive, lastEventId, dispatch } = input;
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
    { runId, lastEventId, dispatch },
    { live: mode === "live" && historyReady, poll: fallbackPollActive },
    history,
  );

  return runStreamWiring(history, mode, fallbackPollActive);
}
