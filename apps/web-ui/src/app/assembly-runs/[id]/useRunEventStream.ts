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
/** Opens the run's event stream and keeps it open, returning its disposer. Reconnect state lives here rather than in React state on purpose: an attempt counter that triggered a re-render would tear down the socket it is counting for. `afterId` is read as a FUNCTION so a resumed connection starts from the newest event seen, not from the id captured when the stream first opened. */
function openRunStream(
  runId: string,
  handlers: {
    afterId: () => string;
    onEvent: (event: RunStreamEvent) => void;
    onConnectionChange: (state: ConnectionState) => void;
  },
): () => void {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let disposed = false;

  const handleMessage = (event: MessageEvent) => {
    const parsed = parseRunStreamEvent(String(event.data));

    if (parsed !== null) {
      handlers.onEvent(parsed);
    }
  };

  const connect = () => {
    if (disposed) {
      return;
    }

    handlers.onConnectionChange(attempt === 0 ? "connecting" : "reconnecting");
    source = new EventSource(streamUrl(runId, handlers.afterId()));
    source.addEventListener("agent-event", handleMessage);
    source.addEventListener("catchup-complete", () => {
      attempt = 0;
      handlers.onConnectionChange("live");
    });
    source.addEventListener("open", () => {
      attempt = 0;
      handlers.onConnectionChange("live");
    });
    source.onerror = () => {
      source?.close();
      attempt += 1;

      const action = reconnectAction(attempt);

      // Terminal for this session — no timer scheduled; the caller reacts to "offline" by dropping to history-only mode.
      if (action.kind === "give-up") {
        handlers.onConnectionChange("offline");

        return;
      }

      handlers.onConnectionChange("reconnecting");
      retryTimer = setTimeout(connect, action.delayMs);
    };
  };

  connect();

  return () => {
    disposed = true;

    if (retryTimer !== null) {
      clearTimeout(retryTimer);
    }
    source?.close();
  };
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
