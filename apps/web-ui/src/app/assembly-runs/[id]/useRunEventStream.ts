"use client";

// IO shell: the EventSource lifecycle and nothing else — every decision (URL, backoff, whether to connect) is computed and tested in run-stream-presenter.
import { useEffect, useRef } from "react";
import {
  parseRunStreamEvent,
  type RunStreamEvent,
} from "@/lib/run-stream-types";
import type { ConnectionState } from "@/lib/run-stream-presenter";
import { reconnectAction, streamUrl } from "@/lib/run-stream-presenter";

export interface RunEventStreamOptions {
  runId: string;
  afterId: string;
  enabled: boolean;
  onEvent: (event: RunStreamEvent) => void;
  onConnectionChange: (state: ConnectionState) => void;
}

// Subscribes to the SSE proxy while `enabled`; manual backoff covers repeated failures. Callbacks live in refs so inline-closure callers don't rebuild the socket every render.
/** Schedules the next attempt, or gives up. Giving up returns NO timer: the caller reacts to "offline" by dropping to history-only mode, so there is nothing left to cancel. */
function scheduleReconnect(
  attempt: number,
  connect: () => void,
  onConnectionChange: (state: ConnectionState) => void,
): ReturnType<typeof setTimeout> | null {
  const action = reconnectAction(attempt);

  if (action.kind === "give-up") {
    onConnectionChange("offline");

    return null;
  }
  onConnectionChange("reconnecting");

  return setTimeout(connect, action.delayMs);
}

/** Wires one EventSource's three signals. Both `catchup-complete` and `open` mean the connection is good — the first fires when the server finishes replaying history, the second when there was none to replay — so either one counts as live. An unparseable frame is dropped rather than thrown: one malformed event must not take down a stream that is otherwise healthy. */
function listenOn(
  source: EventSource,
  onEvent: (event: RunStreamEvent) => void,
  { onLive, onError }: { onLive: () => void; onError: () => void },
): void {
  source.addEventListener("agent-event", (event: MessageEvent) => {
    const parsed = parseRunStreamEvent(String(event.data));

    if (parsed !== null) {
      onEvent(parsed);
    }
  });

  for (const live of ["catchup-complete", "open"]) {
    source.addEventListener(live, onLive);
  }
  source.onerror = onError;
}

/** Opens the run's event stream and keeps it open, returning its disposer. Reconnect state lives here rather than in React state on purpose: an attempt counter that triggered a re-render would tear down the socket it is counting for. `afterId` is read as a FUNCTION so a resumed connection starts from the newest event seen, not from the id captured when the stream first opened. */
function openRunStream(runId: string, handlers: StreamHandlers): () => void {
  const stream: StreamState = {
    source: null,
    retryTimer: null,
    attempt: 0,
    disposed: false,
  };

  connectStream(stream, runId, handlers);

  return () => {
    stream.disposed = true;

    if (stream.retryTimer !== null) {
      clearTimeout(stream.retryTimer);
    }
    stream.source?.close();
  };
}

interface StreamHandlers {
  afterId: () => string;
  onEvent: (event: RunStreamEvent) => void;
  onConnectionChange: (state: ConnectionState) => void;
}

/** The reconnect bookkeeping, held in a plain object rather than React state on purpose: an attempt counter that triggered a re-render would tear down the socket it is counting for. */
interface StreamState {
  source: EventSource | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  disposed: boolean;
}

/** Opens one connection and arms the next. Calls itself through `scheduleReconnect` on error, so the retry chain lives in this one function; a disposed stream returns immediately rather than reconnecting to a run nobody is watching. */
function connectStream(
  stream: StreamState,
  runId: string,
  handlers: StreamHandlers,
): void {
  if (stream.disposed) {
    return;
  }

  handlers.onConnectionChange(
    stream.attempt === 0 ? "connecting" : "reconnecting",
  );
  stream.source = new EventSource(streamUrl(runId, handlers.afterId()));
  listenOn(stream.source, handlers.onEvent, {
    onLive: () => {
      stream.attempt = 0;
      handlers.onConnectionChange("live");
    },
    onError: () => {
      stream.source?.close();
      stream.attempt += 1;
      stream.retryTimer = scheduleReconnect(
        stream.attempt,
        () => connectStream(stream, runId, handlers),
        handlers.onConnectionChange,
      );
    },
  });
}

export function useRunEventStream({
  runId,
  afterId,
  enabled,
  onEvent,
  onConnectionChange,
}: RunEventStreamOptions): void {
  const onEventRef = useRef(onEvent);
  const onConnectionChangeRef = useRef(onConnectionChange);
  // afterId changes on EVERY live event, so it must stay OUT of the socket effect's deps or each event would tear down and rebuild the EventSource.
  const afterIdRef = useRef(afterId);

  // Declared before the socket effect so it has already run when that effect fires (refs may not be written during render).
  useEffect(() => {
    onEventRef.current = onEvent;
    onConnectionChangeRef.current = onConnectionChange;
  });

  useEffect(() => {
    afterIdRef.current = afterId;
  }, [afterId]);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") {
      return;
    }

    return openRunStream(runId, {
      afterId: () => afterIdRef.current,
      onEvent: (event) => onEventRef.current(event),
      onConnectionChange: (status) => onConnectionChangeRef.current(status),
    });
  }, [runId, enabled]);
}
