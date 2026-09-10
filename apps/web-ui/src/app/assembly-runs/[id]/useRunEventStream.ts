"use client";

// IO shell: the EventSource lifecycle and nothing else — every decision (URL, backoff, whether to connect) is computed and tested in run-stream-presenter.
import { useEffect, useRef } from "react";
import {
  parseRunStreamFrame,
  type RunStreamFrame,
} from "@/lib/run-stream-types";
import type { ConnectionState } from "@/lib/run-stream-presenter";
import { reconnectAction, streamUrl } from "@/lib/run-stream-presenter";

export interface RunEventStreamOptions {
  runId: string;
  afterId: string;
  enabled: boolean;
  onFrame: (frame: RunStreamFrame) => void;
  onConnectionChange: (state: ConnectionState) => void;
}

/** The frame families the stream multiplexes (run-viz FR7.1); `catchup_complete` is the live signal rather than a frame to fold. */
const FRAME_EVENTS = [
  "agent_event",
  "node_status",
  "run_status",
  "task_event",
  "ci_check",
] as const;

export function useRunEventStream(options: RunEventStreamOptions): void {
  const { runId, enabled, onFrame, onConnectionChange } = options;
  const { onFrameRef, onConnectionChangeRef } = useCallbackRefs(
    onFrame,
    onConnectionChange,
  );
  const afterIdRef = useAfterIdRef(options.afterId);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") {
      return;
    }

    return openRunStream(runId, {
      afterId: () => afterIdRef.current,
      onFrame: (frame) => onFrameRef.current(frame),
      onConnectionChange: (status) => onConnectionChangeRef.current(status),
    });
  }, [runId, enabled, afterIdRef, onFrameRef, onConnectionChangeRef]);
}

/** The latest callbacks, held in refs so an inline-closure caller does not rebuild the socket on every render. */
function useCallbackRefs(
  onFrame: RunEventStreamOptions["onFrame"],
  onConnectionChange: RunEventStreamOptions["onConnectionChange"],
) {
  const onFrameRef = useRef(onFrame);
  const onConnectionChangeRef = useRef(onConnectionChange);

  // Declared before the socket effect so it has already run when that effect fires (refs may not be written during render).
  useEffect(() => {
    onFrameRef.current = onFrame;
    onConnectionChangeRef.current = onConnectionChange;
  });

  return { onFrameRef, onConnectionChangeRef };
}

// afterId changes on EVERY live event, so it must stay OUT of the socket effect's deps or each event would tear down and rebuild the EventSource.
function useAfterIdRef(afterId: string) {
  const afterIdRef = useRef(afterId);

  useEffect(() => {
    afterIdRef.current = afterId;
  }, [afterId]);

  return afterIdRef;
}

interface StreamHandlers {
  afterId: () => string;
  onFrame: (frame: RunStreamFrame) => void;
  onConnectionChange: (state: ConnectionState) => void;
}

/** The reconnect bookkeeping, held in a plain object rather than React state on purpose: an attempt counter that triggered a re-render would tear down the socket it is counting for. */
interface StreamState {
  source: EventSource | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  disposed: boolean;
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

// Subscribes to the SSE proxy while `enabled`; manual backoff covers repeated failures. Callbacks live in refs so inline-closure callers don't rebuild the socket every render.
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
  listenOn(stream.source, handlers.onFrame, {
    onLive: () => {
      stream.attempt = 0;
      handlers.onConnectionChange("live");
    },
    onError: streamErrorHandler(stream, runId, handlers),
  });
}

/** Wires one EventSource's signals. Both `catchup_complete` and `open` mean the connection is good — the first fires when the server finishes replaying, the second when there was nothing to replay — so either one counts as live. An unparseable frame is dropped rather than thrown: one malformed frame must not take down a stream that is otherwise healthy. */
function listenOn(
  source: EventSource,
  onFrame: (frame: RunStreamFrame) => void,
  { onLive, onError }: { onLive: () => void; onError: () => void },
): void {
  const deliver = (message: MessageEvent) => {
    const parsed = parseRunStreamFrame(String(message.data));

    if (parsed !== null) {
      onFrame(parsed);
    }
  };

  for (const name of FRAME_EVENTS) {
    source.addEventListener(name, deliver);
  }

  for (const live of ["catchup_complete", "open"]) {
    source.addEventListener(live, onLive);
  }
  source.onerror = onError;
}

/** Closes the dead socket and arms the next attempt, keeping the retry chain in one place. */
function streamErrorHandler(
  stream: StreamState,
  runId: string,
  handlers: StreamHandlers,
): () => void {
  return () => {
    stream.source?.close();
    stream.attempt += 1;
    stream.retryTimer = scheduleReconnect(
      stream.attempt,
      () => connectStream(stream, runId, handlers),
      handlers.onConnectionChange,
    );
  };
}

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
