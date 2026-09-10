"use client";

// The degraded transport: when a browser or a server cannot hold a stream open, the run's history endpoint is polled from the reducer's own cursor, so the same rows reach the same reducer.
import { useEffect, useRef } from "react";
import { parseRunStreamRow, type RunStreamEvent } from "@/lib/run-stream-types";
import { HISTORY_POLL_MS, historyUrl } from "@/lib/run-stream-presenter";

const HISTORY_TIMEOUT_MS = 15_000;

interface HistoryPage {
  events?: unknown[];
}

interface PollTarget {
  runId: string;
  lastEventIdRef: { current: string };
  dispatch: (event: RunStreamEvent) => void;
}

/** Degraded path for a live run without a stream: polls from the reducer's cursor, kept in a ref so a poll result never restarts the interval. */
export function useHistoryPoll(
  input: Omit<PollTarget, "lastEventIdRef"> & {
    active: boolean;
    lastEventId: string;
  },
): void {
  const { active, runId, lastEventId, dispatch } = input;
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

export async function fetchPage(
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

/** Parses each row and dispatches the ones that classify, returning them in order. */
export function dispatchParsedRows(
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
