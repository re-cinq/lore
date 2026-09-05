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
} from "./run-stream-presenter";
import { useRunEventStream } from "./useRunEventStream";

interface HistoryPage {
  events?: unknown[];
}

const HISTORY_TIMEOUT_MS = 15_000;

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

/** Runs once per run; a rejection degrades to the seeded graph plus an Offline chip rather than an unhandled rejection or a blank page. */
export function useRunHistory(
  runId: string,
  dispatch: (event: RunStreamEvent) => void,
): RunHistory {
  const [historyEvents, setHistoryEvents] = useState<RunStreamEvent[]>([]);
  const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);
  const [streamUnavailable, setStreamUnavailable] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    let cancelled = false;

    async function loadAllPages(): Promise<{
      ok: boolean;
      collected: RunStreamEvent[];
    }> {
      let cursor = "0";
      const collected: RunStreamEvent[] = [];

      for (;;) {
        const page = await fetchPage(runId, cursor);

        if (cancelled) {
          return { ok: true, collected };
        }

        if (!page.ok) {
          return { ok: false, collected };
        }
        collected.push(...dispatchParsedRows(page.rows, dispatch));
        const next = nextPageCursor(identifiedRows(page.rows));

        if (next === null) {
          break;
        }
        cursor = next;
      }

      return { ok: true, collected };
    }

    async function foldHistory() {
      try {
        const { ok, collected } = await loadAllPages();

        if (cancelled) {
          return;
        }

        if (!ok) {
          setStreamUnavailable(true);
          setConnection("offline");

          return;
        }
        setHistoryEvents(collected);
        setHistoryLoadedFor(runId);
      } catch {
        if (!cancelled) {
          setConnection("offline");
        }
      }
    }

    void foldHistory();

    return () => {
      cancelled = true;
    };
  }, [runId, dispatch]);

  return {
    historyEvents,
    historyLoadedFor,
    streamUnavailable,
    connection,
    setConnection,
    setStreamUnavailable,
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

    let cancelled = false;
    let inFlight = false;

    async function poll() {
      if (inFlight) {
        return;
      }

      inFlight = true;

      try {
        const page = await fetchPage(runId, lastEventIdRef.current);

        if (cancelled || !page.ok) {
          return;
        }
        dispatchParsedRows(page.rows, dispatch);
      } catch {
        // The next tick retries; the chip already reads Polling.
      } finally {
        inFlight = false;
      }
    }

    const id = setInterval(() => void poll(), HISTORY_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, runId, dispatch]);
}

export interface RunStreamWiring {
  /** Ordered persisted events; the replay scrubber's source on a terminal run. */
  historyEvents: RunStreamEvent[];
  /** What the connection chip should read right now. */
  chipState: ChipState;
}

/** How events reach the panel: the one-off history fold, then either the live SSE stream or — when a browser or a server cannot hold one open — a poll from the reducer's own cursor. The caller never learns which; both dispatch the same events. */
export function useRunStream({
  runId,
  runStatus,
  runIsLive,
  lastEventId,
  dispatch,
}: {
  runId: string;
  runStatus: string;
  runIsLive: boolean;
  lastEventId: string;
  dispatch: (event: RunStreamEvent) => void;
}): RunStreamWiring {
  const {
    historyEvents,
    historyLoadedFor,
    streamUnavailable,
    connection,
    setConnection,
    setStreamUnavailable,
  } = useRunHistory(runId, dispatch);
  const mode = resolveStreamMode({
    runStatus,
    eventSourceAvailable: typeof EventSource !== "undefined",
    streamUnavailable,
  });
  // "offline" means the stream hook gave up for good (STREAM_MAX_ATTEMPTS); flipping mode to history-only disables it and hands off to the poll.
  const onConnectionChange = useCallback(
    (next: ConnectionState) => {
      setConnection(next);

      if (next === "offline") {
        setStreamUnavailable(true);
      }
    },
    [setConnection, setStreamUnavailable],
  );

  useRunEventStream({
    runId,
    afterId: lastEventId,
    enabled: mode === "live" && historyLoadedFor === runId,
    onEvent: dispatch,
    onConnectionChange,
  });
  const fallbackPollActive =
    runIsLive && mode === "history-only" && historyLoadedFor === runId;

  useHistoryPoll(fallbackPollActive, runId, lastEventId, dispatch);

  return {
    historyEvents,
    chipState: resolveChipState({ mode, connection, fallbackPollActive }),
  };
}
